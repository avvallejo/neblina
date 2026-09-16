// Prueba viva de mesas y estaciones contra la base local (NODE_ENV=development).
// Corre dentro de una transacción que se revierte al final.
//   node test/live-stations.js   (desde la raíz de la API, como los demás live-*)
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const { resolverDestino, normalizarMesas, normalizarEstacionProducto, normalizarEstacionesUsuario, entregarItemsDeCaja, estacionesDe, leerMesas, CLAVE_MESAS } = require('../src/services/stations');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const { rows: [caja] } = await q("SELECT id, sucursal_id FROM usuarios WHERE rol = 'cajero' AND sucursal_id IS NOT NULL LIMIT 1");
    const s = caja.sucursal_id;
    await q('DELETE FROM configuracion WHERE sucursal_id = $1 AND clave = $2', [s, CLAVE_MESAS]);

    // 1) Mesas: 4 por defecto; validación del destino.
    assert.equal(await leerMesas(q, s), 4);
    assert.deepEqual(await resolverDestino(q, s, { destino: 'mesa', mesa: 3 }), { destino: 'mesa', mesaNumero: 3 });
    assert.deepEqual(await resolverDestino(q, s, { destino: 'llevar' }), { destino: 'llevar', mesaNumero: null });
    assert.deepEqual(await resolverDestino(q, s, {}, { obligatorio: false }), { destino: null, mesaNumero: null });
    for (const body of [{}, { destino: 'terraza' }, { destino: 'mesa' }, { destino: 'mesa', mesa: 5 }, { destino: 'mesa', mesa: 0 }, { destino: 'barra', mesa: 2 }]) {
      await assert.rejects(() => resolverDestino(q, s, body), e => e.status === 400);
    }
    await q(`INSERT INTO configuracion (sucursal_id, clave, valor) VALUES ($1, $2, '6'::jsonb)`, [s, CLAVE_MESAS]);
    assert.equal((await resolverDestino(q, s, { destino: 'mesa', mesa: 6 })).mesaNumero, 6);
    assert.equal(normalizarMesas(''), 4); assert.equal(normalizarMesas('0'), 0);
    for (const v of [-1, 2.5, 'x', 201]) assert.throws(() => normalizarMesas(v), e => e.status === 400);

    // 2) Estaciones de producto y de usuario.
    assert.equal(normalizarEstacionProducto(undefined, { tipo: 'snack' }), 'parrilla');
    assert.equal(normalizarEstacionProducto(undefined, { tipo: 'bebida' }), 'barra');
    assert.equal(normalizarEstacionProducto('caja'), 'caja');
    assert.throws(() => normalizarEstacionProducto('horno'), e => e.status === 400);
    assert.deepEqual(normalizarEstacionesUsuario(['parrilla', 'barra', 'parrilla']), ['barra', 'parrilla']);
    assert.equal(normalizarEstacionesUsuario(undefined), undefined);
    for (const v of [[], ['caja'], 'barra']) assert.throws(() => normalizarEstacionesUsuario(v), e => e.status === 400);
    assert.deepEqual(await estacionesDe(q, { rol: 'admin' }), ['barra', 'parrilla']);
    assert.deepEqual(await estacionesDe(q, { rol: 'barista', id: caja.id, estaciones: ['parrilla'] }), ['parrilla']);
    await q("UPDATE usuarios SET estaciones = ARRAY['parrilla'] WHERE id = $1", [caja.id]);
    assert.deepEqual(await estacionesDe(q, { rol: 'barista', id: caja.id }), ['parrilla']);
    await q('SAVEPOINT sp_est');
    await assert.rejects(() => q("UPDATE usuarios SET estaciones = ARRAY['horno'] WHERE id = $1", [caja.id]), e => e.code === '23514');
    await q('ROLLBACK TO SAVEPOINT sp_est');

    // 3) Lo que se entrega en caja nace terminado; lo demás sigue pendiente.
    const { rows: [snack] } = await q("SELECT id FROM productos WHERE sucursal_id = $1 AND tipo = 'snack' AND activo LIMIT 1", [s]);
    const { rows: [bebida] } = await q("SELECT id FROM productos WHERE sucursal_id = $1 AND tipo = 'bebida' AND activo LIMIT 1", [s]);
    await q("UPDATE productos SET estacion = 'caja' WHERE id = $1", [snack.id]);
    const { rows: [p] } = await q(`INSERT INTO pedidos (origen, sucursal_id, cajero_id, subtotal, total, cobrado, metodo_pago, destino, mesa_numero)
      VALUES ('mostrador', $1, $2, 60, 60, true, 'efectivo', 'mesa', 2) RETURNING id`, [s, caja.id]);
    await q('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, 1, 30), ($1, $3, 1, 30)', [p.id, snack.id, bebida.id]);
    assert.equal(await entregarItemsDeCaja(c, p.id), 1);
    const { rows: estados } = await q('SELECT pi.estado, pr.estacion FROM pedido_items pi JOIN productos pr ON pr.id = pi.producto_id WHERE pi.pedido_id = $1 ORDER BY pr.estacion', [p.id]);
    assert.deepEqual(estados, [{ estado: 'pendiente', estacion: 'barra' }, { estado: 'terminado', estacion: 'caja' }]);
    assert.equal(await entregarItemsDeCaja(c, p.id), 0); // idempotente
    const { rows: [v] } = await q('SELECT estado, destino, mesa_numero FROM vw_pedidos_con_estado WHERE id = $1', [p.id]);
    assert.deepEqual(v, { estado: 'pendiente', destino: 'mesa', mesa_numero: 2 });

    // 4) Coherencia en la base.
    for (const sql of [
      "INSERT INTO pedidos (origen, sucursal_id, subtotal, total, destino) VALUES ('mostrador', $1, 10, 10, 'mesa')",
      "INSERT INTO pedidos (origen, sucursal_id, subtotal, total, destino, mesa_numero) VALUES ('mostrador', $1, 10, 10, 'barra', 1)",
      "INSERT INTO pedidos (origen, sucursal_id, subtotal, total, destino) VALUES ('mostrador', $1, 10, 10, 'terraza')",
    ]) {
      await q('SAVEPOINT sp');
      await assert.rejects(() => q(sql, [s]), e => e.code === '23514');
      await q('ROLLBACK TO SAVEPOINT sp');
    }
    console.log('PASS: mesas configurables, destino validado, estaciones de producto/usuario, ítems de caja auto-entregados, vista con destino y coherencia en BD.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
