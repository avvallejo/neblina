// Solo base desechable: no toca datos de la cafetería.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { pool, query } = require('../src/db');
const app = require('../src/app');
const A = require('../src/services/accounting');
let server;
(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  assert.match(process.env.PGDATABASE, /^codex_costos_/);
  const one = async (sql, args = []) => (await query(sql, args)).rows[0];
  const branch = async label => one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES($1,$2) RETURNING id", [`QA ${label} ${randomUUID()}`, randomUUID().slice(0, 4).toUpperCase()]);
  const s = await branch('costos'), other = await branch('otra');
  const user = async (rol, branchId) => one("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES($1,$2,'no-login-qa',$3) RETURNING *", [`QA ${rol}`, rol, branchId]);
  const admin = await user('admin', s.id), cashier = await user('cajero', s.id), foreign = await user('admin', other.id);
  await query('INSERT INTO turnos(sucursal_id,abierto_por) VALUES($1,$2)', [s.id, admin.id]);
  const cm = await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA materia',$1) RETURNING id", [s.id]);
  const cp = await one("INSERT INTO categorias_producto(nombre,sucursal_id) VALUES('QA productos',$1) RETURNING id", [s.id]);
  const period = '2026-08', date = '2026-08-15T12:00:00-06:00';
  const material = async (name, cost, unit = 'pieza', stock = 100, lots = false) => one(`INSERT INTO materias_primas(nombre,categoria_id,unidad,costo_unitario,stock_actual,requiere_lote,sucursal_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [name, cm.id, unit, cost, stock, lots, s.id]);
  const product = async name => one(`INSERT INTO productos(nombre,categoria_id,tipo,precio_base,permite_tamanos,permite_leche,permite_tipo_cafe,permite_extras,sucursal_id,estacion)
    VALUES($1,$2,'alimento',50,false,false,false,false,$3,'parrilla') RETURNING id`, [name, cp.id, s.id]);
  const recipe = (p, m, qty = 1, unit = m.unidad) => query('INSERT INTO receta_insumos_fijos(producto_id,materia_prima_id,cantidad,unidad) VALUES($1,$2,$3,$4)', [p.id, m.id, qty, unit]);
  const sale = async (p, qty = 1, overrides = {}) => {
    const order = await one(`INSERT INTO pedidos(origen,sucursal_id,subtotal,total,cobrado,metodo_pago,destino,creado_en)
      VALUES('mostrador',$1,$2,$2,true,'efectivo','llevar',$3) RETURNING id`, [s.id, qty * 50, date]);
    const item = await one('INSERT INTO pedido_items(pedido_id,producto_id,cantidad,precio_unitario) VALUES($1,$2,$3,50) RETURNING id', [order.id, p.id, qty]);
    if (!overrides.pending) await query("UPDATE pedido_items SET estado='terminado',terminado_en=$2 WHERE id=$1", [item.id, date]);
    await query('UPDATE movimientos_inventario SET creado_en=$2 WHERE pedido_item_id=$1', [item.id, date]);
    return { ...item, pedidoId: order.id };
  };
  const stock = async m => Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1', [m.id])).stock_actual);
  const missingMat = await material('Pan faltante', 10), missingProd = await product('Sin receta anterior');
  const missing = await sale(missingProd, 2); await recipe(missingProd, missingMat);
  const usedMat = await material('Ya consumido', 0), usedProd = await product('Costo cero');
  await recipe(usedProd, usedMat); const used = await sale(usedProd, 3);
  await query('UPDATE materias_primas SET costo_unitario=5 WHERE id=$1', [usedMat.id]);
  const partA = await material('Parte A', 0), partB = await material('Parte B', 3), partProd = await product('Receta incompleta');
  await recipe(partProd, partA); const partial = await sale(partProd, 2);
  await query('UPDATE materias_primas SET costo_unitario=4 WHERE id=$1', [partA.id]); await recipe(partProd, partB);
  const lotsMat = await material('Con lotes', 7, 'pieza', 4, true), lotsProd = await product('Dos lotes');
  const lot = async (m, qty, days = 0) => one(`INSERT INTO lotes(materia_prima_id,cantidad_comprada,cantidad_disponible,unidad,costo_total,usuario_id,fecha_compra)
    VALUES($1,$2,$2,$3,0,$4,current_date-$5::integer) RETURNING id`, [m.id, qty, m.unidad, admin.id, days]);
  const l1 = await lot(lotsMat, 1, 2), l2 = await lot(lotsMat, 3, 1);
  const lotsItem = await sale(lotsProd, 2); await recipe(lotsProd, lotsMat);
  const kgMat = await material('Kilogramos', 100, 'kg', 2, true), kgProd = await product('Gramos');
  const kgLot = await lot(kgMat, 2); const kgItem = await sale(kgProd, 2); await recipe(kgProd, kgMat, 250, 'g');
  const goodMat = await material('Histórico válido', 12), goodProd = await product('Con costo');
  await recipe(goodProd, goodMat); const good = await sale(goodProd);
  await query('UPDATE materias_primas SET costo_unitario=99 WHERE id=$1', [goodMat.id]);
  const noRecipe = await sale(await product('Todavía sin receta'));
  const noCostMat = await material('Sin precio', 0), noCostProd = await product('Todavía sin costo');
  const noCost = await sale(noCostProd); await recipe(noCostProd, noCostMat);
  const shortMat = await material('Insuficiente', 2, 'pieza', 1), shortProd = await product('Sin existencia suficiente');
  const shortage = await sale(shortProd, 2); await recipe(shortProd, shortMat);
  const adjustedMat = await material('Con ajuste', 3), adjustedProd = await product('Requiere conciliación');
  const adjusted = await sale(adjustedProd); await recipe(adjustedProd, adjustedMat);
  await query("INSERT INTO movimientos_inventario(materia_prima_id,tipo,cantidad,motivo) VALUES($1,'ajuste',-1,'Conteo previo')", [adjustedMat.id]);
  const otherMonthMat = await material('Otro mes', 0), otherMonthProd = await product('Consumo en otro mes');
  await recipe(otherMonthProd, otherMonthMat); const otherMonth = await sale(otherMonthProd);
  await query("UPDATE movimientos_inventario SET creado_en='2026-07-31T12:00:00-06:00' WHERE pedido_item_id=$1", [otherMonth.id]);
  await query('UPDATE materias_primas SET costo_unitario=8 WHERE id=$1', [otherMonthMat.id]);
  const cancelled = await sale(await product('Cancelado')), unpaid = await sale(await product('Sin cobrar')), pending = await sale(await product('Pendiente'), 1, { pending: true });
  await query('UPDATE pedidos SET cancelado=true WHERE id=$1', [cancelled.pedidoId]);
  await query('UPDATE pedidos SET cobrado=false WHERE id=$1', [unpaid.pedidoId]);
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const req = async (method, path, body, u = admin) => {
    const token = jwt.sign({ tipo: 'staff', id: u.id, ver: u.token_version, suc: u.sucursal_id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/contabilidad${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'X-Sucursal-Id': s.id, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const path = `/regularizacion-costos?periodo=${period}`;
  const load = async () => { const r = await req('GET', path); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  assert.equal((await req('GET', path, undefined, cashier)).status, 403);
  const foreignPreview = await req('GET', path, undefined, foreign);
  assert.equal(foreignPreview.status, 200); assert.equal(foreignPreview.data.lineas.length, 0);
  let plan = await load();
  assert.equal(plan.resumen.costoAgregar, 113); assert.equal(plan.resumen.costoAntes, 12);
  assert.equal(plan.resumen.lineas, 5); assert.equal(plan.resumen.pendientes, 5);
  assert.equal(plan.resumen.productos, 11); assert.equal(plan.resumen.conDescuentoInventario, 4);
  for (const excluded of [good, cancelled, unpaid, pending]) assert.ok(!plan.lineas.find(l => l.itemId === excluded.id));
  for (const blocked of [noRecipe, noCost, shortage, adjusted, otherMonth]) assert.equal(plan.lineas.find(l => l.itemId === blocked.id).listo, false);
  const counts = Number((await one('SELECT count(*) AS n FROM movimientos_inventario')).n);
  assert.equal(await stock(missingMat), 100); assert.equal(await stock(usedMat), 97); // Preview no mueve nada.
  const initialFlow = await A.flujoDinero(query, s.id, period);
  const body = () => ({ periodo: period, huella: plan.huella, clientUuid: randomUUID(), confirmado: true });
  assert.equal((await req('POST', '/regularizacion-costos', { ...body(), confirmado: false })).status, 400);
  assert.equal((await req('POST', '/regularizacion-costos', body(), cashier)).status, 403);
  assert.equal((await req('POST', '/regularizacion-costos', body(), foreign)).status, 409);
  await query('UPDATE materias_primas SET costo_unitario=11 WHERE id=$1', [missingMat.id]);
  assert.equal((await req('POST', '/regularizacion-costos', body())).status, 409);
  assert.equal(Number((await one('SELECT count(*) AS n FROM movimientos_inventario')).n), counts);
  await query('UPDATE materias_primas SET costo_unitario=10 WHERE id=$1', [missingMat.id]);
  const close = await req('POST', '/cierres', { periodo: period }); assert.equal(close.status, 201, JSON.stringify(close.data));
  assert.equal((await req('POST', '/regularizacion-costos', body())).status, 409);
  await req('DELETE', `/cierres/${period}`, { motivo: 'QA regularización' });
  plan = await load(); const savedBody = body();
  const responses = await Promise.all([req('POST', '/regularizacion-costos', savedBody), req('POST', '/regularizacion-costos', savedBody)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201], JSON.stringify(responses));
  assert.equal(responses[0].data.folio, responses[1].data.folio);
  assert.equal(responses[0].data.costoAgregar, 113);
  assert.equal(await stock(missingMat), 98); assert.equal(await stock(usedMat), 97);
  assert.equal(await stock(partA), 98); assert.equal(await stock(partB), 98);
  assert.equal(await stock(lotsMat), 2); assert.equal(await stock(kgMat), 1.5);
  assert.equal(Number((await one('SELECT cantidad_disponible AS n FROM lotes WHERE id=$1', [l1.id])).n), 0);
  assert.equal(Number((await one('SELECT cantidad_disponible AS n FROM lotes WHERE id=$1', [l2.id])).n), 2);
  assert.equal(Number((await one('SELECT cantidad_disponible AS n FROM lotes WHERE id=$1', [kgLot.id])).n), 1.5);
  let state = await A.estadoResultados(query, s.id, period);
  assert.equal(state.costoVentas.total, 125); assert.equal(state.utilidadNeta, plan.resumen.utilidadDespues);
  assert.equal(state.costoVentas.regularizado.costo, 113); assert.equal(state.costoVentas.regularizado.lineas, 5);
  assert.equal(Number((await one('SELECT costo_unitario AS n FROM movimientos_inventario WHERE pedido_item_id=$1', [good.id])).n), 12);
  assert.equal(Number((await one('SELECT costo_real AS n FROM vw_costo_real_por_venta WHERE pedido_item_id=$1', [lotsItem.id])).n), 14);
  assert.deepEqual(await A.flujoDinero(query, s.id, period), initialFlow);
  assert.equal(Number((await one("SELECT count(*) AS n FROM movimientos_inventario WHERE pedido_item_id=ANY($1::uuid[]) AND to_char(creado_en AT TIME ZONE 'America/Mexico_City','YYYY-MM')<>$2", [[missing.id, used.id, partial.id, lotsItem.id, kgItem.id], period])).n), 0);
  assert.equal(Number((await one("SELECT count(*) AS n FROM auditoria WHERE entidad='regularizaciones_costo' AND entidad_id=$1", [savedBody.clientUuid])).n), 1);
  plan = await load(); assert.equal(plan.resumen.lineas, 0); assert.equal(plan.historial.length, 1);
  assert.equal((await req('POST', '/regularizacion-costos', body())).status, 409);
  // No revaloriza el historial al cambiar el precio; los costos quedan congelados.
  await query('UPDATE materias_primas SET costo_unitario=80 WHERE id=$1', [usedMat.id]);
  assert.equal((await A.estadoResultados(query, s.id, period)).costoVentas.total, 125);
  // Una cancelación posterior devuelve una sola vez el consumo regularizado.
  await query('SELECT fn_revertir_consumo_item($1,$2,$3)', [lotsItem.id, admin.id, 'QA devolver']);
  assert.equal(await stock(lotsMat), 4);
  await query('SELECT fn_revertir_consumo_item($1,$2,$3)', [lotsItem.id, admin.id, 'QA reintento']);
  assert.equal(await stock(lotsMat), 4);
  assert.equal(Number((await one("SELECT sum(cantidad*costo_unitario) AS n FROM movimientos_inventario WHERE pedido_item_id=$1 AND tipo='ajuste'", [lotsItem.id])).n), 14);
  // Un saldo compartido no se promete dos veces en la misma vista previa.
  const scarceMat = await material('Compartido', 5, 'pieza', 1), scarceProd = await product('Un solo disponible');
  await sale(scarceProd); await sale(scarceProd); await recipe(scarceProd, scarceMat);
  plan = await load(); assert.equal(plan.lineas.filter(l => l.producto === 'Un solo disponible' && l.listo).length, 1);
  // La composición de bebidas coincide con el consumo normal: tamaño, leche,
  // doble shot, empaque, ingrediente fijo y extra (con conversión kg/l).
  const coffeeMat = await material('Café', 250, 'kg', 10), milkMat = await material('Leche', 28, 'l', 10);
  const cupMat = await material('Vaso', 2), lidMat = await material('Tapa', 1), syrupMat = await material('Jarabe', 100, 'l', 10);
  const size = await one("INSERT INTO opciones_tamano(codigo,etiqueta,onzas,sucursal_id) VALUES('12','12 oz',12,$1) RETURNING id", [s.id]);
  const coffee = await one("INSERT INTO opciones_cafe(codigo,etiqueta,materia_prima_id,sucursal_id) VALUES('qa','QA café',$1,$2) RETURNING id", [coffeeMat.id, s.id]);
  const milk = await one("INSERT INTO opciones_leche(codigo,etiqueta,materia_prima_id,sucursal_id) VALUES('qa','QA leche',$1,$2) RETURNING id", [milkMat.id, s.id]);
  const shot = await one("INSERT INTO opciones_extra(codigo,etiqueta,es_shot_adicional,sucursal_id) VALUES('shot','Shot',true,$1) RETURNING id", [s.id]);
  const extra = await one("INSERT INTO opciones_extra(codigo,etiqueta,materia_prima_id,cantidad,unidad,sucursal_id) VALUES('jarabe','Jarabe',$1,15,'ml',$2) RETURNING id", [syrupMat.id, s.id]);
  for (const tipo of ['caliente', 'fria', 'frappe']) await query('INSERT INTO tamano_empaque(tamano_id,variante,materia_prima_vaso_id,materia_prima_tapa_id) VALUES($1,$2,$3,$4)', [size.id, tipo, cupMat.id, lidMat.id]);
  for (const tipo of ['bebida', 'frappe']) {
    const drink = await one(`INSERT INTO productos(nombre,categoria_id,tipo,precio_base,permite_tamanos,permite_leche,permite_tipo_cafe,permite_extras,sucursal_id,estacion)
      VALUES($1,$2,$3,50,true,true,true,true,$4,'barra') RETURNING id`, [`QA ${tipo}`, cp.id, tipo, s.id]);
    await query(`INSERT INTO recetas(producto_id,gramaje_por_shot,leche_ml_por_tamano) VALUES($1,18,'{"12":200}'::jsonb)
      ON CONFLICT(producto_id) DO UPDATE SET gramaje_por_shot=18,leche_ml_por_tamano='{"12":200}'::jsonb`, [drink.id]);
    await recipe(drink, syrupMat, 10, 'ml');
    const drinkItem = await sale(drink, 2, { pending: true });
    await query('UPDATE pedido_items SET tamano_id=$2,cafe_id=$3,leche_id=$4 WHERE id=$1', [drinkItem.id, size.id, coffee.id, milk.id]);
    for (const ex of [shot, extra]) await query('INSERT INTO pedido_item_extras(pedido_item_id,extra_id) VALUES($1,$2)', [drinkItem.id, ex.id]);
    await query("UPDATE pedido_items SET estado='terminado' WHERE id=$1", [drinkItem.id]);
    const expected = (await query('SELECT materia_prima_id, cantidad FROM fn_insumos_regularizacion($1) ORDER BY materia_prima_id', [drinkItem.id])).rows;
    const actual = (await query("SELECT materia_prima_id, sum(-cantidad) AS cantidad FROM movimientos_inventario WHERE pedido_item_id=$1 AND tipo='consumo' GROUP BY materia_prima_id ORDER BY materia_prima_id", [drinkItem.id])).rows;
    assert.deepEqual(expected.map(x => [x.materia_prima_id, Number(x.cantidad)]), actual.map(x => [x.materia_prima_id, Number(x.cantidad)]));
    assert.equal(Number(expected.find(x => x.materia_prima_id === coffeeMat.id).cantidad), 0.072);
    assert.equal(Number(expected.find(x => x.materia_prima_id === milkMat.id).cantidad), 0.4);
  }
  // Un ingrediente sin vincular aparece como pendiente, no rompe el mes.
  const badDrink = await product('Café sin vincular');
  await query("UPDATE productos SET tipo='bebida',permite_tipo_cafe=true WHERE id=$1", [badDrink.id]);
  const emptyCoffee = await one("INSERT INTO opciones_cafe(codigo,etiqueta,sucursal_id) VALUES('vacio','Sin insumo',$1) RETURNING id", [s.id]);
  const badItem = await sale(badDrink, 1, { pending: true });
  await query("UPDATE pedido_items SET cafe_id=$2,estado='terminado' WHERE id=$1", [badItem.id, emptyCoffee.id]);
  plan = await load(); assert.equal(plan.lineas.find(l => l.itemId === badItem.id).listo, false);
  // Guardar y revertir la transacción deja el lote completo sin cambios.
  const c = await pool.connect();
  const rollbackId = randomUUID();
  try {
    await c.query('BEGIN');
    await require('../src/services/costRegularization').apply(c, { sucursalId: s.id, usuarioId: admin.id,
      body: { periodo: period, huella: plan.huella, clientUuid: rollbackId, confirmado: true } });
  } finally { await c.query('ROLLBACK'); c.release(); }
  assert.equal(await stock(scarceMat), 1);
  assert.equal((await one('SELECT id FROM regularizaciones_costo WHERE id=$1', [rollbackId])), undefined);
  console.log('PASS: vista previa sin escrituras; costo cero, receta faltante/parcial, lotes y g/kg; histórico positivo intacto; caja/banco iguales; fechas históricas; mes cerrado; permisos; cambios concurrentes; doble envío y devolución sin duplicados.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (server) await new Promise(r => server.close(r)); await pool.end(); });
