// Prueba viva de snacks de reventa (NODE_ENV=development). Transacción con rollback.
//   node test/live-resale.js   (desde la raíz de la API, como los demás live-*)
const assert = require('node:assert/strict');
const { pool } = require('./src/db');
const { normalizarReventa, guardarReventa } = require('./src/services/resale');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const { rows: [snack] } = await q("SELECT id, sucursal_id, precio_base FROM productos WHERE tipo = 'snack' AND activo LIMIT 1");
    const { rows: [bebida] } = await q("SELECT id FROM productos WHERE tipo = 'bebida' AND activo AND sucursal_id = $1 LIMIT 1", [snack.sucursal_id]);
    const s = snack.sucursal_id;
    const { rows: [cat] } = await q('SELECT id FROM categorias_materia_prima WHERE sucursal_id = $1 ORDER BY id LIMIT 1', [s]);
    const { rows: [m] } = await q(`INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, stock_maximo, costo_unitario, sucursal_id)
      VALUES ('Snack empacado prueba', $1, 'pieza', 10, 4, 30, 9.5, $2) RETURNING id`, [cat.id, s]);

    // 1) Validación del cuerpo.
    assert.equal(normalizarReventa(undefined), undefined);
    assert.equal(normalizarReventa(null), null);
    assert.deepEqual(normalizarReventa({ insumoId: m.id }), { insumoId: m.id, cantidad: 1 });
    assert.deepEqual(normalizarReventa({ insumoId: m.id, cantidad: '2' }), { insumoId: m.id, cantidad: 2 });
    for (const v of ['x', { insumoId: 'no-uuid' }, { insumoId: m.id, cantidad: 0 }, { insumoId: m.id, cantidad: -1 }]) assert.throws(() => normalizarReventa(v), e => e.status === 400);

    // 2) Ligar, sustituir y quitar; bebidas no admiten reventa.
    await guardarReventa(c, { productoId: snack.id, sucursalId: s, tipo: 'snack', reventa: { insumoId: m.id, cantidad: 1 } });
    let { rows: fijos } = await q('SELECT materia_prima_id, cantidad, unidad FROM receta_insumos_fijos WHERE producto_id = $1', [snack.id]);
    assert.deepEqual(fijos, [{ materia_prima_id: m.id, cantidad: '1.000', unidad: 'pieza' }]);
    await guardarReventa(c, { productoId: snack.id, sucursalId: s, tipo: 'snack', reventa: { insumoId: m.id, cantidad: 2 } });
    ({ rows: fijos } = await q('SELECT cantidad FROM receta_insumos_fijos WHERE producto_id = $1', [snack.id]));
    assert.equal(fijos.length, 1); assert.equal(Number(fijos[0].cantidad), 2);
    await assert.rejects(() => guardarReventa(c, { productoId: bebida.id, sucursalId: s, tipo: 'bebida', reventa: { insumoId: m.id, cantidad: 1 } }), e => e.status === 400);
    await assert.rejects(() => guardarReventa(c, { productoId: snack.id, sucursalId: s, tipo: 'snack', reventa: { insumoId: '00000000-0000-4000-8000-000000000000', cantidad: 1 } }), e => e.status === 400);
    await guardarReventa(c, { productoId: snack.id, sucursalId: s, tipo: 'snack', reventa: { insumoId: m.id, cantidad: 1 } });

    // 3) Costo = costo de compra; sin insumo vuelve al 40 %.
    assert.equal(Number((await q('SELECT fn_costo_teorico_producto($1) AS c', [snack.id])).rows[0].c), 9.5);
    assert.equal((await q("SELECT 1 FROM vw_precios_por_revisar WHERE id = $1", [snack.id])).rows.length, 1);

    // 4) La venta descuenta piezas al terminar el ítem (trigger) y nunca deja negativo.
    const { rows: [p] } = await q(`INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago, destino) VALUES ('mostrador', $1, 72, 72, true, 'efectivo', 'llevar') RETURNING id`, [s]);
    const { rows: [it] } = await q('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, 3, 24) RETURNING id', [p.id, snack.id]);
    await q("UPDATE pedido_items SET estado = 'terminado', terminado_en = now() WHERE id = $1", [it.id]);
    assert.equal(Number((await q('SELECT stock_actual FROM materias_primas WHERE id = $1', [m.id])).rows[0].stock_actual), 7);
    assert.equal(Number((await q("SELECT SUM(cantidad) AS n FROM movimientos_inventario WHERE pedido_item_id = $1 AND tipo = 'consumo'", [it.id])).rows[0].n), -3);
    const { rows: [it2] } = await q('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, 20, 24) RETURNING id', [p.id, snack.id]);
    await q("UPDATE pedido_items SET estado = 'terminado', terminado_en = now() WHERE id = $1", [it2.id]);
    assert.equal(Number((await q('SELECT stock_actual FROM materias_primas WHERE id = $1', [m.id])).rows[0].stock_actual), 0);

    // 5) Stock bajo dice cuánto pedir (reabastecer hasta el máximo; sin máximo, hasta el mínimo).
    let { rows: [bajo] } = await q('SELECT a_pedir FROM vw_stock_bajo WHERE id = $1', [m.id]);
    assert.equal(Number(bajo.a_pedir), 30);
    await q('UPDATE materias_primas SET stock_maximo = NULL, stock_actual = 1 WHERE id = $1', [m.id]);
    ({ rows: [bajo] } = await q('SELECT a_pedir FROM vw_stock_bajo WHERE id = $1', [m.id]));
    assert.equal(Number(bajo.a_pedir), 3);

    // 6) Quitar el control: sin insumo, sin consumo, fuera de revisión de precios.
    await guardarReventa(c, { productoId: snack.id, sucursalId: s, tipo: 'snack', reventa: null });
    assert.equal((await q('SELECT 1 FROM receta_insumos_fijos WHERE producto_id = $1', [snack.id])).rows.length, 0);
    assert.equal(Number((await q('SELECT fn_costo_teorico_producto($1) AS c', [snack.id])).rows[0].c), Math.round(Number(snack.precio_base) * 0.4 * 1000) / 1000);
    assert.equal((await q("SELECT 1 FROM vw_precios_por_revisar WHERE id = $1", [snack.id])).rows.length, 0);
    console.log('PASS: reventa ligada/sustituida/quitada, costo por compra, consumo por venta sin negativos, stock bajo con cantidad a pedir.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
