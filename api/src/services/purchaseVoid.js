// ANULAR UNA COMPRA/ALTA CAPTURADA POR ERROR
//
// Caso típico: alguien da de alta "azúcar, 200 kg" por equivocación. Se corrige
// con un AJUSTE de inventario, pero el ajuste es una salida valuada al costo del
// insumo: el estado de resultados lo carga como pérdida (costo de ventas) y se
// infla, aunque nunca se perdió nada y el dinero de la "compra" nunca salió.
//
// La corrección correcta no es otro ajuste sino deshacer el error de origen:
//   1. el lote capturado se marca como ANULADO (no se borra: queda quién, cuándo
//      y por qué) y sus existencias salen con un movimiento 'anulacion_compra',
//      que no es costo de ventas;
//   2. los ajustes que se hicieron para "compensarlo" se REVIERTEN con un
//      movimiento contrario al mismo costo: en el estado de resultados suman
//      cero y el inventario queda igual que hoy (el error y su ajuste se
//      cancelan);
//   3. el egreso de la compra se anula, y el dinero vuelve a su cuenta;
//   4. si esa compra había cambiado el costo de referencia del insumo, vuelve
//      al de la compra vigente anterior.
// Todo en una transacción y con rastro en la bitácora. Respeta los meses
// cerrados: si alguna de las fechas involucradas está cerrada, no procede.
const { ApiError } = require('../utils/asyncHandler');
const { cleanText } = require('../utils/catalogValidation');
const A = require('./accounting');
const H = require('./stockAdjustmentHistory');
const B = require('./bitacora');

const TZ = 'America/Mexico_City';
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const r2 = n => Math.round(Number(n) * 100) / 100;
const exigirUuid = (valor, etiqueta) => {
  if (!B.UUID.test(String(valor || ''))) throw new ApiError(400, `${etiqueta} inválido.`);
  return String(valor);
};

const LOTE_SQL = `SELECT l.*, m.nombre AS insumo, m.unidad AS unidad_insumo, m.requiere_lote, m.stock_actual,
    m.costo_unitario AS costo_referencia, m.sucursal_id, u.nombre AS registrado_por,
    (l.creado_en AT TIME ZONE '${TZ}')::date AS fecha_captura,
    fn_convertir_unidad(l.cantidad_comprada, l.unidad, m.unidad) AS cantidad_comprada_insumo,
    fn_convertir_unidad(l.cantidad_disponible, l.unidad, m.unidad) AS cantidad_disponible_insumo
  FROM lotes l JOIN materias_primas m ON m.id = l.materia_prima_id LEFT JOIN usuarios u ON u.id = l.usuario_id`;

// Ajustes de ese insumo hechos desde que se capturó el lote y que siguen vigentes:
// los candidatos a ser "el ajuste que compensó el error".
async function ajustesCandidatos(queryFn, sucursalId, lote) {
  const { rows } = await queryFn(
    `SELECT a.id, a.creado_en, a.fecha_contable, a.motivo, a.cantidad_anterior, a.cantidad_contada, u.nombre AS usuario,
            COALESCE(SUM(mi.cantidad), 0) AS diferencia,
            COALESCE(SUM(-mi.cantidad * COALESCE(mi.costo_unitario, 0)), 0) AS costo
     FROM ajustes_stock a
     LEFT JOIN usuarios u ON u.id = a.usuario_id
     LEFT JOIN movimientos_inventario mi ON mi.ajuste_stock_id = a.id AND mi.tipo = 'ajuste'
     WHERE a.sucursal_id = $1 AND a.materia_prima_id = $2 AND a.creado_en >= $3 AND a.revertido_en IS NULL
     GROUP BY a.id, u.nombre ORDER BY a.creado_en`, [sucursalId, lote.materia_prima_id, lote.creado_en]);
  return rows.map(a => ({ ...a, fecha_contable: A.fechaISO(a.fecha_contable), diferencia: Number(a.diferencia), costo: r2(a.costo) }));
}

async function usosDelLote(queryFn, loteId) {
  const { rows: [uso] } = await queryFn(
    `SELECT count(*)::int AS movimientos, COALESCE(sum(-cantidad), 0) AS cantidad
     FROM movimientos_inventario mi
     WHERE mi.lote_id = $1 AND mi.tipo IN ('consumo','merma')
       AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id = mi.id)`, [loteId]);
  return { movimientos: uso.movimientos, cantidad: Number(uso.cantidad) };
}

async function egresosDelLote(queryFn, loteId) {
  const { rows } = await queryFn(
    `SELECT e.id, e.concepto, e.monto, e.fecha, e.pagado, e.pagado_en, e.anulado, c.nombre AS cuenta, d.nombre AS cuenta_dinero
     FROM egresos e JOIN cuentas_contables c ON c.id = e.cuenta_contable_id LEFT JOIN cuentas_dinero d ON d.id = e.cuenta_dinero_id
     WHERE e.lote_id = $1 ORDER BY e.creado_en`, [loteId]);
  return rows.map(e => A.normalizarFechas(e));
}

// Lo que el administrador ve antes de confirmar.
async function vistaPrevia(queryFn, sucursalId, loteId) {
  exigirUuid(loteId, 'Compra');
  const { rows: [lote] } = await queryFn(`${LOTE_SQL} WHERE l.id = $1 AND m.sucursal_id = $2`, [loteId, sucursalId]);
  if (!lote) throw new ApiError(404, 'Compra no encontrada en esta sucursal.');
  const [ajustes, usos, egresos] = await Promise.all([
    ajustesCandidatos(queryFn, sucursalId, lote), usosDelLote(queryFn, lote.id), egresosDelLote(queryFn, lote.id)]);
  let bloqueo = null;
  if (lote.anulado_en) bloqueo = 'Esta compra ya fue anulada.';
  else if (usos.movimientos > 0) bloqueo = 'De este lote ya se descontaron existencias por ventas o mermas, así que no se puede anular completo. Corrige la diferencia con una merma o un ajuste.';
  return {
    lote: {
      id: lote.id, insumo: lote.insumo, unidad_insumo: lote.unidad_insumo, unidad: lote.unidad, numero_lote: lote.numero_lote,
      cantidad_comprada: Number(lote.cantidad_comprada), cantidad_disponible: Number(lote.cantidad_disponible),
      costo_total: Number(lote.costo_total), fecha_compra: A.fechaISO(lote.fecha_compra), fecha_captura: A.fechaISO(lote.fecha_captura),
      creado_en: lote.creado_en, registrado_por: lote.registrado_por, stock_actual: Number(lote.stock_actual),
      costo_referencia: Number(lote.costo_referencia), requiere_lote: lote.requiere_lote,
      anulado_en: lote.anulado_en, motivo_anulacion: lote.motivo_anulacion,
    },
    egresos, usos, ajustes, puedeAnular: !bloqueo, bloqueo,
  };
}

async function costoReferenciaAnterior(client, lote) {
  const { rows: [previo] } = await client.query(
    `SELECT l.costo_total / NULLIF(fn_convertir_unidad(l.cantidad_comprada, l.unidad, m.unidad), 0) AS costo
     FROM lotes l JOIN materias_primas m ON m.id = l.materia_prima_id
     WHERE l.materia_prima_id = $1 AND l.id <> $2 AND l.anulado_en IS NULL AND l.costo_total > 0
     ORDER BY l.fecha_compra DESC, l.creado_en DESC LIMIT 1`, [lote.materia_prima_id, lote.id]);
  return previo?.costo === null || previo?.costo === undefined ? null : Math.round(Number(previo.costo) * 10000) / 10000;
}

// Debe ejecutarse dentro de una transacción.
async function anularCompra(client, { sucursalId, usuarioId, loteId, ajusteIds = [], motivo }) {
  exigirUuid(loteId, 'Compra');
  const razon = cleanText(motivo, { required: true, field: 'el motivo de la anulación', max: 500 });
  if (!razon || razon.length < 5) throw new ApiError(400, 'Explica con unas palabras por qué anulas esta compra.');
  if (!Array.isArray(ajusteIds) || ajusteIds.length > 20) throw new ApiError(400, 'Selecciona hasta 20 ajustes a revertir.');
  const ajustes = [...new Set(ajusteIds.map(id => exigirUuid(id, 'Ajuste')))];

  await client.query("SET LOCAL lock_timeout='5s'");
  const { rows: [base] } = await client.query(`${LOTE_SQL} WHERE l.id = $1 AND m.sucursal_id = $2`, [loteId, sucursalId]);
  if (!base) throw new ApiError(404, 'Compra no encontrada en esta sucursal.');
  const { rows: [materia] } = await client.query('SELECT * FROM materias_primas WHERE id = $1 FOR UPDATE', [base.materia_prima_id]);
  const { rows: [lote] } = await client.query(`${LOTE_SQL} WHERE l.id = $1 FOR UPDATE OF l`, [loteId]);
  if (lote.anulado_en) throw new ApiError(409, 'Esta compra ya fue anulada.');
  const usos = await usosDelLote(client.query.bind(client), lote.id);
  if (usos.movimientos > 0) {
    throw new ApiError(409, 'De este lote ya se descontaron existencias por ventas o mermas, así que no se puede anular completo. Corrige la diferencia con una merma o un ajuste.');
  }

  // Egresos de la compra y ajustes elegidos, con sus fechas, para respetar meses cerrados.
  const { rows: egresos } = await client.query('SELECT * FROM egresos WHERE lote_id = $1 AND NOT anulado FOR UPDATE', [lote.id]);
  const aRevertir = [];
  for (const id of ajustes) {
    const { rows: [a] } = await client.query(
      `SELECT a.*, (a.creado_en AT TIME ZONE '${TZ}')::date AS fecha_captura FROM ajustes_stock a
       WHERE a.id = $1 AND a.sucursal_id = $2 FOR UPDATE`, [id, sucursalId]);
    if (!a || a.materia_prima_id !== materia.id) throw new ApiError(400, 'Uno de los ajustes no corresponde a este insumo.');
    if (a.revertido_en) throw new ApiError(409, 'Uno de los ajustes ya había sido revertido.');
    if (a.creado_en < lote.creado_en) throw new ApiError(400, 'Solo se pueden revertir ajustes hechos después de capturar esta compra.');
    aRevertir.push(a);
  }
  const fechas = [A.hoyMx(), A.fechaISO(lote.fecha_compra), A.fechaISO(lote.fecha_captura),
    ...egresos.flatMap(e => [A.fechaISO(e.fecha), e.pagado_en ? A.fechaISO(e.pagado_en) : null]),
    ...aRevertir.map(a => A.fechaISO(a.fecha_contable))].filter(Boolean);
  await H.mesesAbiertos(client, sucursalId, fechas);

  const stockAntes = Number(materia.stock_actual);
  const motivoMov = `Anulación de compra por error: ${razon}`.slice(0, 500);
  let deltaAjustes = 0;
  let impacto = 0;
  const revertidos = [];

  // 1. Revertir los ajustes elegidos, movimiento por movimiento y al mismo costo.
  for (const a of aRevertir) {
    const { rows: movs } = await client.query(
      `SELECT mi.* FROM movimientos_inventario mi
       WHERE mi.ajuste_stock_id = $1 AND mi.tipo = 'ajuste' AND mi.revierte_movimiento_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id = mi.id)
       ORDER BY mi.creado_en, mi.id`, [a.id]);
    for (const m of movs) {
      const devuelto = -Number(m.cantidad);
      if (m.lote_id) {
        const { rows: [origen] } = await client.query(
          `SELECT l.cantidad_disponible, l.cantidad_comprada, l.unidad, l.anulado_en,
                  fn_convertir_unidad($2::numeric, $3::unidad_medida, l.unidad) AS delta
           FROM lotes l WHERE l.id = $1 FOR UPDATE`, [m.lote_id, devuelto, materia.unidad]);
        if (origen.anulado_en && m.lote_id !== lote.id) throw new ApiError(409, 'Un ajuste toca un lote ya anulado; no se puede revertir.');
        const nuevo = Math.round((Number(origen.cantidad_disponible) + Number(origen.delta)) * 1000) / 1000;
        if (nuevo < 0) throw new ApiError(409, 'Ese ajuste sumó existencias que ya se usaron; no se puede revertir.');
        if (nuevo > Number(origen.cantidad_comprada) + 0.0005) throw new ApiError(409, 'Revertir ese ajuste excedería lo comprado en el lote.');
        await client.query('UPDATE lotes SET cantidad_disponible = LEAST(cantidad_comprada, $2) WHERE id = $1', [m.lote_id, nuevo]);
      }
      await client.query(
        `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, usuario_id, motivo, costo_unitario, revierte_movimiento_id, ajuste_stock_id)
         VALUES ($1,'ajuste',$2,$3,$4,$5,$6,$7,$8)`,
        [materia.id, devuelto, m.lote_id, usuarioId, motivoMov, m.costo_unitario, m.id, a.id]);
      deltaAjustes += devuelto;
      impacto += -Number(m.cantidad) * Number(m.costo_unitario || 0);
    }
    await client.query('UPDATE ajustes_stock SET revertido_en = now(), revertido_por = $2, motivo_reversion = $3 WHERE id = $1', [a.id, usuarioId, razon]);
    revertidos.push({ id: a.id, folio: `AJ-${a.id.slice(0, 8).toUpperCase()}`, movimientos: movs.length });
  }

  // 2. Sacar del inventario lo que esa compra metió.
  let retirado;
  if (materia.requiere_lote) {
    const { rows: [fresco] } = await client.query(
      'SELECT fn_convertir_unidad(cantidad_disponible, unidad, $2::unidad_medida) AS disponible FROM lotes WHERE id = $1', [lote.id, materia.unidad]);
    retirado = Number(fresco.disponible);
  } else {
    // Insumos sin lote: la entrada fue el movimiento 'compra' (el lote es solo el registro del costo).
    const { rows: [compra] } = await client.query(
      `SELECT COALESCE(sum(cantidad), 0) AS cantidad FROM movimientos_inventario WHERE lote_id = $1 AND tipo = 'compra'`, [lote.id]);
    retirado = Number(compra.cantidad) || Number(lote.cantidad_comprada_insumo);
  }
  if (retirado > 0) {
    await client.query(
      `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, usuario_id, motivo, costo_unitario)
       VALUES ($1,'anulacion_compra',$2,$3,$4,$5,
         (SELECT $6::numeric / NULLIF(fn_convertir_unidad($7::numeric, $8::unidad_medida, $9::unidad_medida), 0)))`,
      [materia.id, -retirado, lote.id, usuarioId, motivoMov, lote.costo_total, lote.cantidad_comprada, lote.unidad, materia.unidad]);
  }
  await client.query(
    'UPDATE lotes SET cantidad_disponible = 0, anulado_en = now(), anulado_por = $2, motivo_anulacion = $3 WHERE id = $1', [lote.id, usuarioId, razon]);

  // 3. Existencias resultantes.
  let stockDespues;
  if (materia.requiere_lote) {
    const { rows: [s] } = await client.query(
      `SELECT COALESCE(SUM(fn_convertir_unidad(cantidad_disponible, unidad, $2::unidad_medida)), 0) AS total FROM lotes WHERE materia_prima_id = $1`, [materia.id, materia.unidad]);
    stockDespues = r3(s.total);
  } else {
    stockDespues = r3(stockAntes + deltaAjustes - retirado);
  }
  if (stockDespues < -0.0005) {
    throw new ApiError(409, `Anular esta compra dejaría el inventario en negativo (${stockDespues}). Revierte también el ajuste que la compensó o corrige primero las existencias.`);
  }
  await client.query('UPDATE materias_primas SET stock_actual = $2 WHERE id = $1', [materia.id, Math.max(0, stockDespues)]);

  // 4. Costo de referencia: si lo había fijado esta compra, vuelve al de la compra vigente anterior.
  const costoDeEsta = lote.costo_total > 0
    ? Math.round((Number(lote.costo_total) / Number(lote.cantidad_comprada_insumo)) * 10000) / 10000 : null;
  let costoReferencia = { antes: Number(materia.costo_unitario), despues: Number(materia.costo_unitario), revisar: false };
  if (costoDeEsta !== null && Math.abs(costoDeEsta - Number(materia.costo_unitario)) < 0.0002) {
    const previo = await costoReferenciaAnterior(client, lote);
    if (previo !== null) {
      await client.query('UPDATE materias_primas SET costo_unitario = $2 WHERE id = $1', [materia.id, previo]);
      costoReferencia.despues = previo;
    } else costoReferencia.revisar = true; // no hay otra compra con costo: que el administrador lo confirme
  }

  // 5. El dinero: se anula el egreso de la compra.
  const egresosAnulados = [];
  for (const e of egresos) {
    await client.query('UPDATE egresos SET anulado = true, anulado_en = now(), anulado_por = $2, motivo_anulacion = $3 WHERE id = $1',
      [e.id, usuarioId, `Compra anulada por error: ${razon}`.slice(0, 200)]);
    await B.registrarCambio(client, { sucursalId, usuarioId, entidad: 'egresos', entidadId: e.id, accion: 'anular',
      anterior: { concepto: e.concepto, monto: e.monto, fecha: A.fechaISO(e.fecha) }, motivo: `Compra anulada por error: ${razon}`.slice(0, 200) });
    egresosAnulados.push({ id: e.id, concepto: e.concepto, monto: Number(e.monto), pagado: e.pagado });
  }

  // 6. Rastro.
  const resumen = {
    insumo: lote.insumo, cantidad: Number(lote.cantidad_comprada), unidad: lote.unidad, costoTotal: Number(lote.costo_total),
    registradoPor: lote.registrado_por, registradoEn: lote.creado_en,
  };
  await B.registrarCambio(client, { sucursalId, usuarioId, entidad: 'lotes', entidadId: lote.id, accion: 'anular_compra',
    anterior: resumen,
    nuevo: { ajustesRevertidos: revertidos, egresosAnulados, stockAntes, stockDespues, costoReferencia, impactoResultados: r2(impacto) },
    motivo: razon });
  for (const r of revertidos) {
    await B.registrarCambio(client, { sucursalId, usuarioId, entidad: 'ajustes_stock', entidadId: r.id, accion: 'revertir',
      nuevo: { porAnulacionDeCompra: lote.id }, motivo: razon });
  }
  return { loteId: lote.id, insumo: lote.insumo, stockAntes, stockDespues, ajustesRevertidos: revertidos, egresosAnulados,
    costoReferencia, impactoResultados: r2(impacto) };
}

module.exports = { vistaPrevia, anularCompra, ajustesCandidatos };
