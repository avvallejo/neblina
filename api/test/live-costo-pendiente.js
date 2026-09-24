// Prueba viva: ventas cobradas sin costo (pendientes de terminar / sin receta)
// y egresos pagados por cuenta de dinero que cuadran con el flujo.
//   node test/live-costo-pendiente.js  (NODE_ENV=development; transacción con rollback)
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const A = require('../src/services/accounting');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const hoy = A.hoyMx(); const periodo = hoy.slice(0, 7); const inicio = `${periodo}-01`;
    const { rows: [sede] } = await q("INSERT INTO sucursales (nombre, prefijo_folio) VALUES ('QA Costo pendiente', 'QCP') RETURNING id");
    const s = sede.id;
    const { rows: [adm] } = await q("SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1");
    await q('INSERT INTO configuracion_margen (sucursal_id) VALUES ($1)', [s]);
    await q('INSERT INTO configuracion (sucursal_id, clave, valor) VALUES ($1,$2,$3::jsonb)', [s, A.CLAVE_INICIO, JSON.stringify(inicio)]);
    const { rows: [catP] } = await q("INSERT INTO categorias_producto (nombre, orden, sucursal_id) VALUES ('Snacks', 1, $1) RETURNING id", [s]);
    const { rows: [catM] } = await q("INSERT INTO categorias_materia_prima (nombre, sucursal_id) VALUES ('Otros', $1) RETURNING id", [s]);
    const { rows: [m] } = await q(`INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, sucursal_id) VALUES ('Pan QA', $1, 'pieza', 50, 5, 10, $2) RETURNING id`, [catM.id, s]);
    const prod = async nombre => (await q(`INSERT INTO productos (nombre, categoria_id, tipo, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, sucursal_id, estacion) VALUES ($1, $2, 'snack', 50, false, false, false, false, $3, 'parrilla') RETURNING id`, [nombre, catP.id, s])).rows[0];
    const conReceta = await prod('Torta QA'); const sinReceta = await prod('Postre sin receta QA');
    await q("INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES ($1, $2, 1, 'pieza')", [conReceta.id, m.id]);
    const pedido = async (total) => (await q(`INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago, destino) VALUES ('mostrador', $1, $2, $2, true, 'efectivo', 'llevar') RETURNING id`, [s, total])).rows[0];
    const item = async (ped, p, cant) => (await q('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, 50) RETURNING id', [ped.id, p.id, cant])).rows[0];

    // Pedido 1: 2 tortas terminadas (costo $20). Pedido 2: 3 tortas cobradas aún en parrilla.
    // Pedido 3: 1 postre sin receta terminado.
    const p1 = await pedido(100); const i1 = await item(p1, conReceta, 2);
    await q("UPDATE pedido_items SET estado='terminado', terminado_en=now() WHERE id=$1", [i1.id]);
    const p2 = await pedido(150); await item(p2, conReceta, 3);
    const p3 = await pedido(50); const i3 = await item(p3, sinReceta, 1);
    await q("UPDATE pedido_items SET estado='terminado', terminado_en=now() WHERE id=$1", [i3.id]);

    let er = await A.estadoResultados(q, s, periodo);
    assert.equal(er.ventas.total, 300);
    assert.equal(er.costoVentas.total, 20);
    assert.equal(er.costoVentas.sinTerminar.venta, 150);
    assert.equal(er.costoVentas.sinTerminar.unidades, 3);
    assert.equal(er.costoVentas.sinTerminar.productos[0].producto, 'Torta QA');
    assert.equal(er.costoVentas.sinReceta.venta, 50);
    assert.equal(er.costoVentas.sinReceta.productos[0].producto, 'Postre sin receta QA');

    // Al terminar el pedido 2 el costo entra y el aviso desaparece.
    await q("UPDATE pedido_items SET estado='terminado', terminado_en=now() WHERE pedido_id=$1", [p2.id]);
    er = await A.estadoResultados(q, s, periodo);
    assert.equal(er.costoVentas.total, 50);
    assert.equal(er.costoVentas.sinTerminar.lineas, 0);
    assert.equal(er.costoVentas.sinReceta.lineas, 1);

    // Egresos por cuenta de dinero: pagados en el mes por fecha de pago, igual que el flujo.
    const caja = await A.cuentaDineroPorClave(q, s, 'caja'); const banco = await A.cuentaDineroPorClave(q, s, 'banco');
    const renta = await A.cuentaPorClave(q, s, 'renta'); const luz = await A.cuentaPorClave(q, s, 'servicios');
    await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: renta, concepto: 'Renta QA', monto: 3000, cuentaDineroId: caja.id, pagado: true });
    await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: luz, concepto: 'Luz QA', monto: 400, cuentaDineroId: banco.id, pagado: true });
    await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: luz, concepto: 'Agua QA', monto: 250, pagado: false });
    const pagados = await A.listarEgresos(q, s, { pagadoPeriodo: periodo });
    assert.equal(pagados.length, 2);
    const flujo = await A.flujoDinero(q, s, periodo);
    const sumaCuenta = id => pagados.filter(e => e.cuenta_dinero_id === id).reduce((t, e) => t + Number(e.monto), 0);
    assert.equal(sumaCuenta(caja.id), flujo.cuentas.find(x => x.id === caja.id).egresos);
    assert.equal(sumaCuenta(banco.id), flujo.cuentas.find(x => x.id === banco.id).egresos);
    const pendientes = await A.listarEgresos(q, s, { pendientes: true });
    assert.equal(pendientes.reduce((t, e) => t + Number(e.monto), 0), flujo.porPagar.monto);
    console.log('PASS: ventas sin costo (sin terminar / sin receta) detectadas y egresos por Caja/Banco/Por pagar cuadran con el flujo de dinero.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
