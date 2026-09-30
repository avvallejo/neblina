const { createHash } = require('node:crypto');
const { ApiError } = require('../utils/asyncHandler');
const A = require('./accounting');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round = (n, digits = 7) => Number(Number(n).toFixed(digits));
const folio = (id, periodo) => `RC-${periodo.replace('-', '')}-${id.slice(0, 8).toUpperCase()}`;

// Solo líneas cobradas y terminadas cuyo consumo completo sigue sin valor.
// No reemplaza costos históricos positivos ni vuelve a ejecutar una comanda.
async function preview(client, sucursalId, value) {
  const periodo = A.validarPeriodo(value);
  if (periodo > A.hoyMx().slice(0, 7)) throw new ApiError(400, 'Elige un mes que ya haya comenzado.');
  const r = A.rangoPeriodo(periodo);
  const { rows: items } = await client.query(`
    SELECT pi.id, pi.cantidad, p.id AS pedido_id, p.folio, p.creado_en AS fecha,
      COALESCE(pr.nombre,pi.concepto_libre,'Producto') AS producto,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.materia_prima_id) FROM fn_insumos_regularizacion(pi.id) x) AS receta,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',mi.id,'insumoId',mi.materia_prima_id,'cantidad',-mi.cantidad,
        'costo',mi.costo_unitario,'fecha',mi.creado_en,'periodo',to_char(mi.creado_en AT TIME ZONE '${A.TZ}','YYYY-MM'),
        'revertido',EXISTS(SELECT 1 FROM movimientos_inventario rev WHERE rev.revierte_movimiento_id=mi.id)) ORDER BY mi.id)
        FROM movimientos_inventario mi WHERE mi.pedido_item_id=pi.id AND mi.tipo='consumo'),'[]'::jsonb) AS movimientos
    FROM pedido_items pi JOIN pedidos p ON p.id=pi.pedido_id LEFT JOIN productos pr ON pr.id=pi.producto_id
    WHERE p.sucursal_id=$1 AND p.cobrado AND NOT p.cancelado AND NOT p.no_show AND pi.estado='terminado'
      AND (p.creado_en AT TIME ZONE '${A.TZ}')::date BETWEEN $2 AND $3
      AND NOT EXISTS (SELECT 1 FROM regularizacion_costo_items rc WHERE rc.pedido_item_id=pi.id)
      AND NOT EXISTS (SELECT 1 FROM movimientos_inventario mi JOIN materias_primas mp ON mp.id=mi.materia_prima_id
        LEFT JOIN lotes l ON l.id=mi.lote_id WHERE mi.pedido_item_id=pi.id AND mi.tipo='consumo'
        AND COALESCE(mi.costo_unitario,l.costo_total/NULLIF(fn_convertir_unidad(l.cantidad_comprada,l.unidad,mp.unidad),0),mp.costo_unitario,0)>0)
    ORDER BY p.creado_en,pi.id`, [sucursalId, r.desde, r.hasta]);
  const ids = [...new Set(items.flatMap(i => [...(i.receta || []).map(x => x.materia_prima_id), ...i.movimientos.map(x => x.insumoId)]).filter(Boolean))].sort();
  const { rows: materials } = await client.query(`SELECT m.id,m.nombre,m.unidad,m.sucursal_id,m.costo_unitario,m.stock_actual,m.requiere_lote,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'saldo',l.cantidad_disponible,'unidad',l.unidad,
      'factor',fn_convertir_unidad(1,m.unidad,l.unidad)) ORDER BY l.fecha_compra,l.creado_en,l.id)
      FROM lotes l WHERE l.materia_prima_id=m.id AND l.cantidad_disponible>0),'[]'::jsonb) AS lotes,
    (SELECT max(mi.creado_en) FROM movimientos_inventario mi WHERE mi.materia_prima_id=m.id
      AND mi.tipo='ajuste' AND mi.pedido_item_id IS NULL) AS ultimo_ajuste
    FROM materias_primas m WHERE m.id=ANY($1::uuid[]) ORDER BY m.id`, [ids]);
  const mat = new Map(materials.map(m => [m.id, m]));
  const available = new Map(materials.map(m => [m.id, Number(m.stock_actual)]));
  const lotBalances = new Map(materials.flatMap(m => m.lotes.map(l => [l.id, Number(l.saldo)])));
  const lines = [];
  for (const i of items) {
    const reasons = [];
    if (i.movimientos.some(m => m.revertido)) reasons.push('Tiene consumos devueltos; requiere revisión individual.');
    if (i.movimientos.some(m => m.periodo !== periodo)) reasons.push('Su consumo está registrado en otro mes; requiere revisión individual.');
    if (i.movimientos.some(m => m.costo !== null && Number(m.costo) !== 0 || Number(m.cantidad) <= 0)) reasons.push('Tiene movimientos atípicos; requiere revisión individual.');
    const requirements = new Map();
    for (const part of i.receta || []) {
      if (!part.materia_prima_id || !(Number(part.cantidad) > 0)) { reasons.push('La receta tiene un insumo o cantidad sin definir.'); continue; }
      requirements.set(part.materia_prima_id, Number(part.cantidad));
    }
    for (const movement of i.movimientos) if (!requirements.has(movement.insumoId)) requirements.set(movement.insumoId, 0);
    const ingredients = [];
    const plannedLots = new Map(lotBalances);
    for (const [id, required] of [...requirements].sort(([a], [b]) => a.localeCompare(b))) {
      const m = mat.get(id);
      if (!m || m.sucursal_id !== sucursalId) { reasons.push('Un insumo no pertenece a esta sucursal.'); continue; }
      const previous = i.movimientos.filter(x => x.insumoId === id);
      const used = round(previous.reduce((sum, x) => sum + Number(x.cantidad), 0), 3);
      const missing = round(Math.max(0, required - used), 3);
      const cost = Number(m.costo_unitario);
      if (!(cost > 0)) reasons.push(`${m.nombre}: todavía no tiene costo.`);
      if (m.ultimo_ajuste && new Date(m.ultimo_ajuste) >= new Date(i.fecha)) reasons.push(`${m.nombre}: tuvo un ajuste de inventario posterior; revisa si el costo ya está incluido.`);
      if (missing > (available.get(id) || 0) + 0.00001) reasons.push(`${m.nombre}: faltan existencias registradas para descontar ${missing} ${m.unidad}.`);
      // El plan guarda lotes y cantidades exactos. No toma de nuevo lo ya consumido.
      const lots = [];
      if (m.requiere_lote && missing > 0) {
        const totalLots = round(m.lotes.reduce((sum, l) => sum + Number(l.saldo) / Number(l.factor), 0), 3);
        if (Math.abs(totalLots - Number(m.stock_actual)) > 0.00051) reasons.push(`${m.nombre}: los lotes no coinciden con la existencia.`);
        let remaining = missing;
        for (const lot of m.lotes) {
          if (remaining < 0.00001) break;
          const factor = Number(lot.factor);
          const old = plannedLots.get(lot.id);
          const take = Math.min(remaining, old / factor);
          const newBalance = round(old - take * factor, 3);
          const actual = round((old - newBalance) / factor, 3);
          if (actual <= 0) continue;
          lots.push({ id: lot.id, cantidad: actual, saldoAnterior: old, saldoNuevo: newBalance });
          plannedLots.set(lot.id, newBalance);
          remaining = round(remaining - actual, 3);
        }
        if (remaining > 0.00001) reasons.push(`${m.nombre}: sus lotes no alcanzan o necesitan revisar sus unidades.`);
      }
      ingredients.push({ id, nombre: m.nombre, unidad: m.unidad, costoUnitario: cost, yaConsumido: used, porDescontar: missing,
        costo: round((used + missing) * cost), movimientos: previous, lotes: lots });
    }
    if (!ingredients.length) reasons.push('Falta vincular una receta o un insumo a este producto.');
    const cost = round(ingredients.reduce((sum, x) => sum + x.costo, 0));
    if (!reasons.length && !(cost > 0)) reasons.push('El costo calculado sigue en cero.');
    const ready = !reasons.length;
    if (ready) {
      for (const x of ingredients) available.set(x.id, round(available.get(x.id) - x.porDescontar, 3));
      for (const [id, amount] of plannedLots) lotBalances.set(id, amount);
    }
    lines.push({ itemId: i.id, pedidoId: i.pedido_id, folio: i.folio, fecha: i.fecha, producto: i.producto, cantidad: Number(i.cantidad),
      listo: ready, motivos: [...new Set(reasons)], costo: ready ? cost : 0, insumos: ingredients });
  }
  const state = await A.estadoResultados(client.query.bind(client), sucursalId, periodo, undefined, { incluirPrecision: true });
  const ready = lines.filter(l => l.listo);
  const recovered = ready.reduce((s, l) => s + l.costo, 0);
  const costAfter = A.round2(state.costoVentasSinRedondear + recovered);
  const total = A.round2(costAfter - state.costoVentas.total);
  const { rows: history } = await client.query(`SELECT r.id,r.creado_en,r.resumen,u.nombre AS usuario
    FROM regularizaciones_costo r JOIN usuarios u ON u.id=r.usuario_id
    WHERE r.sucursal_id=$1 AND r.periodo=$2 ORDER BY r.creado_en DESC LIMIT 20`, [sucursalId, periodo]);
  const result = { periodo, nombre: r.nombre, cerrado: !!state.cerrado, lineas: lines,
    resumen: { productos: ready.reduce((sum, l) => sum + l.cantidad, 0), tickets: new Set(ready.map(l => l.pedidoId)).size,
      lineas: ready.length, pendientes: lines.length - ready.length, costoAgregar: total,
      costoAntes: state.costoVentas.total, costoDespues: costAfter,
      utilidadAntes: state.utilidadNeta, utilidadDespues: A.round2(state.utilidadNeta - total),
      conDescuentoInventario: ready.filter(l => l.insumos.some(x => x.porDescontar > 0)).length },
    historial: history.map(h => ({ ...h, folio: folio(h.id, periodo) })) };
  result.huella = createHash('sha256').update(JSON.stringify({ sucursalId, periodo, cerrado: result.cerrado, lines, materials, resumen: result.resumen })).digest('hex');
  return result;
}

async function apply(client, { sucursalId, usuarioId, body }) {
  const { clientUuid, huella } = body;
  const periodo = A.validarPeriodo(body.periodo);
  if (!UUID.test(clientUuid || '') || !/^[a-f0-9]{64}$/.test(huella || '')) throw new ApiError(400, 'Abre la vista previa antes de regularizar.');
  if (body.confirmado !== true) throw new ApiError(400, 'Confirma que revisaste los costos y que no se registraron antes como ajuste o egreso.');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`regularizar:${clientUuid}`]);
  const { rows: [previous] } = await client.query('SELECT * FROM regularizaciones_costo WHERE id=$1', [clientUuid]);
  if (previous) {
    if (previous.sucursal_id !== sucursalId || previous.usuario_id !== usuarioId || previous.huella !== huella || previous.periodo !== periodo) throw new ApiError(409, 'Ese identificador corresponde a otra regularización.');
    return { ...previous.resumen, repetido: true };
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`costos-mes:${sucursalId}:${periodo}`]);
  // Mantenimiento breve: bloquea escrituras mientras valida y guarda el lote.
  // Incluye cierre mensual, catálogo, devoluciones y conteos; una vista previa
  // nunca se aplica sobre recetas/existencias que cambiaron simultáneamente.
  await client.query(`LOCK TABLE pedidos,pedido_items,materias_primas,lotes,movimientos_inventario,
    productos,recetas,receta_insumos_fijos,pedido_item_extras,opciones_extra,opciones_cafe,opciones_leche,
    opciones_tamano,tamano_empaque,tamano_leche_cantidad,cierres_mes IN SHARE ROW EXCLUSIVE MODE`);
  const plan = await preview(client, sucursalId, periodo);
  if (plan.cerrado) throw new ApiError(409, 'Ese mes está cerrado. Reábrelo en Contabilidad antes de corregir sus costos.');
  if (plan.huella !== huella) throw new ApiError(409, 'Cambiaron las ventas, recetas o existencias. Actualiza la vista previa y revisa los nuevos importes.');
  if (!plan.resumen.lineas) throw new ApiError(409, 'No hay costos listos para regularizar. Revisa los pendientes.');
  const result = { id: clientUuid, folio: folio(clientUuid, periodo), periodo, ...plan.resumen };
  await client.query('INSERT INTO regularizaciones_costo(id,sucursal_id,usuario_id,periodo,huella,resumen) VALUES($1,$2,$3,$4,$5,$6)',
    [clientUuid, sucursalId, usuarioId, periodo, huella, result]);
  for (const line of plan.lineas.filter(l => l.listo)) {
    for (const ingredient of line.insumos) {
      if (ingredient.movimientos.length) {
        await client.query('UPDATE movimientos_inventario SET costo_unitario=$2 WHERE id=ANY($1::uuid[])',
          [ingredient.movimientos.map(m => m.id), ingredient.costoUnitario]);
      }
      if (ingredient.porDescontar > 0) {
        const parts = ingredient.lotes.length ? ingredient.lotes : [{ id: null, cantidad: ingredient.porDescontar }];
        for (const part of parts) {
          if (part.id) await client.query('UPDATE lotes SET cantidad_disponible=$2 WHERE id=$1', [part.id, part.saldoNuevo]);
          await client.query(`INSERT INTO movimientos_inventario(materia_prima_id,tipo,cantidad,lote_id,pedido_item_id,usuario_id,motivo,costo_unitario,creado_en)
            VALUES($1,'consumo',$2,$3,$4,$5,$6,$7,$8)`,
            [ingredient.id, -part.cantidad, part.id, line.itemId, usuarioId, `${result.folio}: receta y costo actuales; registro estimado`, ingredient.costoUnitario, line.fecha]);
        }
        await client.query('UPDATE materias_primas SET stock_actual=stock_actual-$2 WHERE id=$1', [ingredient.id, ingredient.porDescontar]);
      }
    }
    await client.query('INSERT INTO regularizacion_costo_items(pedido_item_id,regularizacion_id,costo_agregado,detalle) VALUES($1,$2,$3,$4)',
      [line.itemId, clientUuid, line.costo, line]);
  }
  await client.query(`INSERT INTO auditoria(entidad,entidad_id,accion,valor_nuevo,motivo,usuario_id,sucursal_id)
    VALUES('regularizaciones_costo',$1,'regularizar',$2,$3,$4,$5)`,
    [clientUuid, result, 'Costos estimados con recetas y costos actuales. El administrador confirmó que no fueron registrados como ajustes o egresos.', usuarioId, sucursalId]);
  return result;
}
module.exports = { preview, apply };
