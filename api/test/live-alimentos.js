// Prueba viva de alimentos de parrilla/cocina y extras por ámbito
// (NODE_ENV=development). Transacción con rollback.
//   node test/live-alimentos.js   (desde la raíz de la API, como los demás live-*)
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const { calcularPrecioItem } = require('../src/utils/pricing');
const { normalizarEstacionProducto } = require('../src/services/stations');
const { guardarReventa } = require('../src/services/resale');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const { rows: [bebida] } = await q("SELECT id, sucursal_id FROM productos WHERE tipo = 'bebida' AND activo AND permite_extras LIMIT 1");
    const s = bebida.sucursal_id;
    const { rows: [catProd] } = await q('SELECT id FROM categorias_producto WHERE sucursal_id = $1 ORDER BY id LIMIT 1', [s]);
    const { rows: [catMat] } = await q('SELECT id FROM categorias_materia_prima WHERE sucursal_id = $1 ORDER BY id LIMIT 1', [s]);
    const insumo = async (nombre, unidad, stock, costo) => (await q(
      `INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, sucursal_id)
       VALUES ($1, $2, $3, $4, 1, $5, $6) RETURNING id`, [nombre, catMat.id, unidad, stock, costo, s])).rows[0];
    const pan = await insumo('Pan hamburguesa prueba', 'pieza', 10, 6);
    const carne = await insumo('Carne res prueba', 'kg', 2, 180);      // $180/kg
    const tocino = await insumo('Tocino prueba', 'kg', 1, 220);        // $220/kg

    // 1) Estación predeterminada y alta del alimento con su receta.
    assert.equal(normalizarEstacionProducto(undefined, { tipo: 'alimento' }), 'parrilla');
    assert.equal(normalizarEstacionProducto(undefined, { tipo: 'bebida' }), 'barra');
    const { rows: [h] } = await q(
      `INSERT INTO productos (nombre, categoria_id, tipo, icono, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, es_frio, sucursal_id, estacion)
       VALUES ('Hamburguesa prueba', $1, 'alimento', '🍔', 90, false, false, false, true, false, $2, 'parrilla') RETURNING *`, [catProd.id, s]);
    await q('SAVEPOINT sp');
    await assert.rejects(() => q("UPDATE productos SET permite_leche = true WHERE id = $1", [h.id]), e => e.code === '23514');
    await q('ROLLBACK TO SAVEPOINT sp');
    await q('INSERT INTO recetas (producto_id) VALUES ($1)', [h.id]);
    const { rows: [rec] } = await q('SELECT * FROM fn_resetear_receta($1)', [h.id]);
    assert.equal(rec.gramaje_por_shot, null); assert.equal(rec.molienda, null); assert.ok(Array.isArray(rec.pasos) && rec.pasos.length >= 3);
    await q(`INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES ($1, $2, 1, 'pieza'), ($1, $3, 150, 'g')`, [h.id, pan.id, carne.id]);

    // 2) Costo = suma de ingredientes (pan 6 + 150 g carne a $180/kg = 27) → 33.
    assert.equal(Number((await q('SELECT fn_costo_teorico_producto($1) AS c', [h.id])).rows[0].c), 33);
    assert.equal((await q('SELECT 1 FROM vw_precios_por_revisar WHERE id = $1', [h.id])).rows.length, 1);
    await assert.rejects(() => guardarReventa(c, { productoId: h.id, sucursalId: s, tipo: 'alimento', reventa: { insumoId: pan.id, cantidad: 1 } }), e => e.status === 400);

    // 3) Extras por ámbito: tocino solo para alimentos; el shot solo para bebidas.
    const { rows: [exTocino] } = await q(
      `INSERT INTO opciones_extra (codigo, etiqueta, delta_precio, materia_prima_id, cantidad, unidad, es_shot_adicional, sucursal_id, aplica_a)
       VALUES ('tocino_prueba', 'Tocino prueba', 15, $1, 30, 'g', false, $2, 'alimentos') RETURNING id`, [tocino.id, s]);
    const { rows: [exBebida] } = await q(
      `SELECT id FROM opciones_extra WHERE sucursal_id = $1 AND activo AND NOT retirado AND aplica_a = 'bebidas' LIMIT 1`, [s]);
    await q('SAVEPOINT sp2');
    await assert.rejects(() => q("UPDATE opciones_extra SET aplica_a = 'alimentos' WHERE sucursal_id = $1 AND es_shot_adicional", [s]), e => e.code === '23514');
    await q('ROLLBACK TO SAVEPOINT sp2');
    assert.equal(await calcularPrecioItem({ productoId: h.id, extraIds: [exTocino.id], sucursalId: s }, q), 105);
    await assert.rejects(() => calcularPrecioItem({ productoId: h.id, extraIds: [exBebida.id], sucursalId: s }, q), e => e.status === 400 && /no aplica/.test(e.message));
    await assert.rejects(() => calcularPrecioItem({ productoId: h.id, tamanoId: 1, extraIds: [], sucursalId: s }, q), e => e.status === 400);
    const { rows: [tam] } = await q("SELECT id FROM opciones_tamano WHERE sucursal_id = $1 AND codigo = '12'", [s]);
    const { rows: [beb] } = await q('SELECT * FROM productos WHERE id = $1', [bebida.id]);
    if (beb.permite_tamanos && !beb.permite_leche && !beb.permite_tipo_cafe) {
      await assert.rejects(() => calcularPrecioItem({ productoId: bebida.id, tamanoId: tam.id, extraIds: [exTocino.id], sucursalId: s }, q), e => e.status === 400 && /no aplica/.test(e.message));
    }

    // 4) Al terminar el ítem se descuentan los ingredientes y el extra; sin café/leche/vaso.
    const { rows: [p] } = await q(`INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago, destino, mesa_numero) VALUES ('mostrador', $1, 210, 210, true, 'efectivo', 'mesa', 1) RETURNING id`, [s]);
    const { rows: [it] } = await q('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, 2, 105) RETURNING id', [p.id, h.id]);
    await q('INSERT INTO pedido_item_extras (pedido_item_id, extra_id) VALUES ($1, $2)', [it.id, exTocino.id]);
    const { rows: [est] } = await q('SELECT estado FROM vw_pedidos_con_estado WHERE id = $1', [p.id]);
    assert.equal(est.estado, 'pendiente');
    await q("UPDATE pedido_items SET estado = 'terminado', terminado_en = now() WHERE id = $1", [it.id]);
    const stock = async id => Number((await q('SELECT stock_actual FROM materias_primas WHERE id = $1', [id])).rows[0].stock_actual);
    assert.equal(await stock(pan.id), 8);
    assert.equal(Math.round((await stock(carne.id)) * 1000) / 1000, 1.7);   // 2 kg − 2×150 g
    assert.equal(Math.round((await stock(tocino.id)) * 1000) / 1000, 0.94); // 1 kg − 2×30 g
    const { rows: movs } = await q("SELECT materia_prima_id FROM movimientos_inventario WHERE pedido_item_id = $1 AND tipo = 'consumo'", [it.id]);
    assert.equal(movs.length, 3);
    assert.equal((await q('SELECT estado FROM vw_pedidos_con_estado WHERE id = $1', [p.id])).rows[0].estado, 'terminado');

    // 5) Alimento sin ingredientes: costo 0 y fuera de la revisión de precios (hasta capturar la receta).
    await q('DELETE FROM receta_insumos_fijos WHERE producto_id = $1', [h.id]);
    assert.equal(Number((await q('SELECT fn_costo_teorico_producto($1) AS c', [h.id])).rows[0].c), 0);
    assert.equal((await q('SELECT 1 FROM vw_precios_por_revisar WHERE id = $1', [h.id])).rows.length, 0);
    console.log('PASS: alimento con receta multi-ingrediente, costo por ingredientes, extras por ámbito, descuento de inventario al terminar.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
