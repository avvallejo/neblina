// Prueba viva: surtir consumibles de mesa (salida sin venta) y desglose del
// costo de ventas (vendido, mesas, mermas, ajustes por conteo, devoluciones).
//   node test/live-salida-interna.js  (NODE_ENV=development; transacción con rollback)
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const A = require('../src/services/accounting');
const { registrarSalidaInterna } = require('../src/services/internalUse');
const { ajustarStock } = require('../src/services/adjustStock');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const periodo = A.hoyMx().slice(0, 7);
    const { rows: [sede] } = await q("INSERT INTO sucursales (nombre, prefijo_folio) VALUES ('QA Surtido', 'QSU') RETURNING id");
    const s = sede.id;
    const { rows: [adm] } = await q("SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1");
    await q('INSERT INTO configuracion_margen (sucursal_id) VALUES ($1)', [s]);
    const { rows: [catM] } = await q("INSERT INTO categorias_materia_prima (nombre, sucursal_id) VALUES ('Mesa', $1) RETURNING id", [s]);
    // Azúcar en sobres: pieza a $0.50, sin lotes. Cátsup: g a $0.04, con lote.
    const { rows: [azucar] } = await q(`INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, sucursal_id) VALUES ('Sobres de azúcar QA', $1, 'pieza', 500, 50, 0.5, $2) RETURNING id`, [catM.id, s]);
    const { rows: [catsup] } = await q(`INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, sucursal_id, requiere_lote) VALUES ('Cátsup QA', $1, 'g', 0, 500, 0.04, $2, true) RETURNING id`, [catM.id, s]);
    await q(`INSERT INTO lotes (materia_prima_id, numero_lote, cantidad_comprada, cantidad_disponible, unidad, costo_total, usuario_id) VALUES ($1, 'L1', 4000, 4000, 'g', 160, $2)`, [catsup.id, adm.id]);
    await q(`UPDATE materias_primas SET stock_actual = 4000 WHERE id = $1`, [catsup.id]);

    const base = await A.estadoResultados(q, s, periodo);
    assert.equal(base.costoVentas.total, 0);

    // Surtir: 100 sobres a mesas ($50) y 900 g de cátsup en los botes ($36).
    let m = await registrarSalidaInterna(c, { id: azucar.id, sucursalId: s, usuarioId: adm.id, cantidad: 100, motivo: 'mesas', nota: 'azucareros' });
    assert.equal(Number(m.stock_actual), 400);
    m = await registrarSalidaInterna(c, { id: catsup.id, sucursalId: s, usuarioId: adm.id, cantidad: 900, motivo: 'mesas' });
    assert.equal(Number(m.stock_actual), 3100);
    const { rows: movs } = await q("SELECT motivo FROM movimientos_inventario WHERE materia_prima_id = ANY($1) AND tipo = 'consumo'", [[azucar.id, catsup.id]]);
    assert.ok(movs.length >= 2 && movs.every(x => x.motivo.startsWith('Consumibles de mesa')));
    await assert.rejects(() => registrarSalidaInterna(c, { id: azucar.id, sucursalId: s, usuarioId: adm.id, cantidad: 401, motivo: 'mesas' }), /Solo hay|solo hay/);
    await assert.rejects(() => registrarSalidaInterna(c, { id: azucar.id, sucursalId: s, usuarioId: adm.id, cantidad: 5, motivo: 'otro' }), /Motivo/);

    // Conteo físico: el sistema dice 400 sobres, se contaron 380 → faltaron 20 ($10).
    await ajustarStock(c, { id: azucar.id, sucursalId: s, usuarioId: adm.id, nuevaCantidad: 380, stockEsperado: 400 });

    const er = await A.estadoResultados(q, s, periodo);
    const cv = er.costoVentas;
    assert.equal(cv.consumoInterno, 86);
    assert.equal(cv.consumoVentas, 0);
    assert.equal(cv.ajustesConteo, 10);
    assert.equal(cv.total, 96);
    // Inventario hoy: 380 sobres × $0.50 + 3,100 g × $0.04 (lote) = $314.
    assert.equal(er.inventarioHoy.valor, 314);
    assert.equal(A.round2(cv.consumoVentas + cv.consumoInterno + cv.mermas + cv.ajustesConteo + cv.manual), cv.total);
    console.log('PASS: surtido de mesas descuenta inventario (PEPS), entra al costo como línea propia y el desglose del costo de ventas suma el total.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
