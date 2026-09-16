// Prueba viva de compras con presentación y costo derivado (NODE_ENV=development).
// Transacción con rollback. node test/live-purchases.js (desde la raíz de la API).
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const { normalizarPresentacion, resolverCantidadCompra, registrarCompra } = require('../src/services/purchases');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const { rows: [u] } = await q("SELECT id, sucursal_id FROM usuarios WHERE sucursal_id IS NOT NULL LIMIT 1");
    const s = u.sucursal_id;
    const { rows: [cat] } = await q('SELECT id FROM categorias_materia_prima WHERE sucursal_id = $1 ORDER BY id LIMIT 1', [s]);
    const nueva = async (nombre, unidad, pres) => (await q(
      `INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, sucursal_id, presentacion_cantidad, presentacion_unidad, presentacion_nombre)
       VALUES ($1, $2, $3, 0, 1, 0, $4, $5, $6, $7) RETURNING *`, [nombre, cat.id, unidad, s, pres ? pres.cantidad : null, pres ? pres.unidad : null, pres ? pres.nombre : null])).rows[0];

    // 1) Presentación: convertible a la unidad de control; nombre por defecto.
    assert.deepEqual(await normalizarPresentacion(c, { cantidad: 900, unidad: 'g' }, 'kg'), { cantidad: 900, unidad: 'g', nombre: 'paquete' });
    assert.deepEqual(await normalizarPresentacion(c, { cantidad: '12', unidad: 'l', nombre: ' caja ' }, 'ml'), { cantidad: 12, unidad: 'l', nombre: 'caja' });
    assert.equal(await normalizarPresentacion(c, null, 'kg'), null);
    assert.equal(await normalizarPresentacion(c, undefined, 'kg'), undefined);
    await assert.rejects(() => normalizarPresentacion(c, { cantidad: 0, unidad: 'g' }, 'kg'), e => e.status === 400);
    await assert.rejects(() => normalizarPresentacion(c, { cantidad: 5, unidad: 'l' }, 'kg'), e => e.status === 400); // volumen → peso
    await assert.rejects(() => normalizarPresentacion(c, { cantidad: 5, unidad: 'kilo' }, 'kg'), e => e.status === 400);

    // 2) Bolsa de 900 g a $170, control en kg → 0.9 kg y $188.8889/kg.
    const cafe = await nueva('Café prueba compras', 'kg', { cantidad: 900, unidad: 'g', nombre: 'bolsa' });
    const l1 = await registrarCompra(c, { materiaId: cafe.id, sucursalId: s, usuarioId: u.id, body: { paquetes: 1, costoTotal: 170 } });
    assert.equal(Number(l1.paquetes), 1); assert.equal(Number(l1.cantidad_comprada), 900); assert.equal(l1.unidad, 'g');
    let { rows: [m] } = await q('SELECT stock_actual, costo_unitario FROM materias_primas WHERE id = $1', [cafe.id]);
    assert.equal(Number(m.stock_actual), 0.9); assert.equal(Number(m.costo_unitario), 188.8889);
    assert.equal(Number(l1.costo_unitario_referencia), 188.8889);
    // 3 bolsas más por $480 → +2.7 kg, costo de referencia = última compra (480/2.7 = 177.7778/kg).
    await registrarCompra(c, { materiaId: cafe.id, sucursalId: s, usuarioId: u.id, body: { paquetes: 3, costoTotal: 480 } });
    ({ rows: [m] } = await q('SELECT stock_actual, costo_unitario FROM materias_primas WHERE id = $1', [cafe.id]));
    assert.equal(Number(m.stock_actual), 3.6); assert.equal(Number(m.costo_unitario), 177.7778);
    assert.equal((await q("SELECT COUNT(*)::int AS n FROM movimientos_inventario WHERE materia_prima_id = $1 AND tipo = 'compra'", [cafe.id])).rows[0].n, 2);

    // 3) Cantidad suelta en otra unidad de la misma familia: 2 l de leche controlada en ml.
    const leche = await nueva('Leche prueba compras', 'ml', null);
    await registrarCompra(c, { materiaId: leche.id, sucursalId: s, usuarioId: u.id, body: { cantidadComprada: 2, unidad: 'l', costoTotal: 56 } });
    ({ rows: [m] } = await q('SELECT stock_actual, costo_unitario FROM materias_primas WHERE id = $1', [leche.id]));
    assert.equal(Number(m.stock_actual), 2000); assert.equal(Number(m.costo_unitario), 0.028);
    // paquetes sin presentación → 400; cantidad 0 → 400; unidad incompatible → 400
    await assert.rejects(() => registrarCompra(c, { materiaId: leche.id, sucursalId: s, usuarioId: u.id, body: { paquetes: 2, costoTotal: 10 } }), e => e.status === 400);
    await assert.rejects(() => registrarCompra(c, { materiaId: leche.id, sucursalId: s, usuarioId: u.id, body: { cantidadComprada: 0, costoTotal: 10 } }), e => e.status === 400);
    await assert.rejects(() => registrarCompra(c, { materiaId: leche.id, sucursalId: s, usuarioId: u.id, body: { cantidadComprada: 1, unidad: 'kg', costoTotal: 10 } }), e => e.status === 400);
    assert.throws(() => resolverCantidadCompra({ paquetes: 0 }, { presentacion_cantidad: 12 }), e => e.status === 400);
    assert.deepEqual(resolverCantidadCompra({ paquetes: 2 }, { presentacion_cantidad: '12.000', presentacion_unidad: 'l', unidad: 'ml' }), { cantidad: 24, unidad: 'l', paquetes: 2 });

    // 4) Insumo por lote (PEPS): la compra en paquetes también crea el lote y recalcula el stock.
    const vasos = await nueva('Vasos prueba compras', 'pieza', { cantidad: 50, unidad: 'pieza', nombre: 'paquete' });
    await q('UPDATE materias_primas SET requiere_lote = true WHERE id = $1', [vasos.id]);
    await registrarCompra(c, { materiaId: vasos.id, sucursalId: s, usuarioId: u.id, body: { paquetes: 4, costoTotal: 600 } });
    ({ rows: [m] } = await q('SELECT stock_actual, costo_unitario FROM materias_primas WHERE id = $1', [vasos.id]));
    assert.equal(Number(m.stock_actual), 200); assert.equal(Number(m.costo_unitario), 3);
    assert.equal((await q('SELECT SUM(cantidad_disponible)::int AS n FROM lotes WHERE materia_prima_id = $1', [vasos.id])).rows[0].n, 200);

    // 5) Coherencia en la base: presentación a medias.
    await q('SAVEPOINT sp');
    await assert.rejects(() => q('UPDATE materias_primas SET presentacion_cantidad = 5 WHERE id = $1', [leche.id]), e => e.code === '23514');
    await q('ROLLBACK TO SAVEPOINT sp');
    console.log('PASS: presentación validada, compras por paquetes y por cantidad con conversión de unidad, costo de referencia derivado (última compra), lotes PEPS y coherencia.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
