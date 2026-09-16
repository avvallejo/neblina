// Prueba viva de contabilidad y mayordomía (NODE_ENV=development). Transacción
// con rollback sobre una sede creada al vuelo (así los números son exactos).
//   node test/live-contabilidad.js   (desde la raíz de la API, como los demás live-*)
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const A = require('../src/services/accounting');
const { registrarCompra } = require('../src/services/purchases');
const { drawerSql } = require('../src/services/cashDrawer');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const hoy = A.hoyMx(); const periodo = hoy.slice(0, 7); const inicio = `${periodo}-01`;
    const { rows: [sede] } = await q("INSERT INTO sucursales (nombre, prefijo_folio) VALUES ('QA Contabilidad', 'QAC') RETURNING id");
    const s = sede.id;
    const { rows: [adm] } = await q("SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1");
    await q('INSERT INTO configuracion_margen (sucursal_id) VALUES ($1)', [s]);
    for (const [k, v] of [[A.CLAVE_DIEZMO, 10], [A.CLAVE_OFRENDA, 5], [A.CLAVE_INICIO, inicio]]) {
      await q('INSERT INTO configuracion (sucursal_id, clave, valor) VALUES ($1,$2,$3::jsonb)', [s, k, JSON.stringify(v)]);
    }
    // 1) La sede nace con su catálogo y sus cuentas de dinero (trigger de la migración 32).
    const { rows: cuentas } = await q('SELECT clave, grupo FROM cuentas_contables WHERE sucursal_id = $1', [s]);
    assert.ok(cuentas.length >= 20 && cuentas.some(x => x.clave === 'diezmo') && cuentas.some(x => x.clave === 'compra_insumos'));
    const caja = await A.cuentaDineroPorClave(q, s, 'caja'); const banco = await A.cuentaDineroPorClave(q, s, 'banco');
    const cfg = await A.leerConfigContabilidad(q, s);
    assert.deepEqual(cfg, { diezmoPorcentaje: 10, ofrendaPorcentaje: 5, contabilidadInicio: inicio });

    // 2) Una venta de $10,000 (6,000 efectivo + 4,000 tarjeta) con consumo de inventario de $28.50.
    const { rows: [catP] } = await q("INSERT INTO categorias_producto (nombre, orden, sucursal_id) VALUES ('Snacks', 1, $1) RETURNING id", [s]);
    const { rows: [catM] } = await q("INSERT INTO categorias_materia_prima (nombre, sucursal_id) VALUES ('Otros', $1) RETURNING id", [s]);
    const { rows: [m] } = await q(`INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, sucursal_id) VALUES ('Galleta QA', $1, 'pieza', 50, 5, 9.5, $2) RETURNING id`, [catM.id, s]);
    const { rows: [p] } = await q(`INSERT INTO productos (nombre, categoria_id, tipo, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, sucursal_id, estacion) VALUES ('Galleta', $1, 'snack', 24, false, false, false, false, $2, 'caja') RETURNING id`, [catP.id, s]);
    await q("INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES ($1, $2, 1, 'pieza')", [p.id, m.id]);
    const { rows: [ped] } = await q(`INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago, importe_efectivo, destino) VALUES ('mostrador', $1, 10000, 10000, true, 'mixto', 6000, 'llevar') RETURNING id`, [s]);
    const { rows: [it] } = await q('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, 3, 24) RETURNING id', [ped.id, p.id]);
    await q("UPDATE pedido_items SET estado = 'terminado', terminado_en = now() WHERE id = $1", [it.id]);

    // 3) Egresos del mes: renta (operación, caja), préstamo (financiero, banco), equipo (inversión), compra de insumos, diezmo entregado.
    const renta = await A.cuentaPorClave(q, s, 'renta');
    const e1 = await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContableId: renta.id, concepto: 'Renta QA', monto: 3000, cuentaDineroId: caja.id, pagado: true });
    assert.equal(e1.pagado, true); assert.equal(A.fechaISO(e1.pagado_en), hoy);
    const prestamo = await A.cuentaPorClave(q, s, 'prestamo');
    await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: prestamo, concepto: 'Préstamo QA', monto: 6000, cuentaDineroId: banco.id });
    const equipo = await A.cuentaPorClave(q, s, 'equipo');
    await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: equipo, concepto: 'Refrigerador QA', monto: 2000, cuentaDineroId: banco.id });
    await registrarCompra(c, { materiaId: m.id, sucursalId: s, usuarioId: adm.id, body: { cantidadComprada: 20, unidad: 'pieza', costoTotal: 200, cuentaDineroId: banco.id } });
    const { rows: [compra] } = await q("SELECT e.*, cc.clave FROM egresos e JOIN cuentas_contables cc ON cc.id = e.cuenta_contable_id WHERE e.sucursal_id = $1 AND e.lote_id IS NOT NULL", [s]);
    assert.equal(compra.clave, 'compra_insumos'); assert.equal(Number(compra.monto), 200); assert.equal(compra.cuenta_dinero_id, banco.id);
    const diezmo = await A.cuentaPorClave(q, s, 'diezmo');
    await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: diezmo, concepto: 'Diezmo QA', monto: 50, cuentaDineroId: banco.id, periodo });
    // Por pagar (no sale del dinero todavía) y validaciones.
    const luz = await A.cuentaPorClave(q, s, 'servicios');
    const porPagar = await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: luz, concepto: 'Luz QA', monto: 700, pagado: false });
    assert.equal(porPagar.pagado, false); assert.equal(porPagar.cuenta_dinero_id, null);
    for (const bad of [{ monto: 0 }, { monto: -5 }, { concepto: '' }, { fecha: '2026-13-01' }]) {
      await q('SAVEPOINT sp');
      await assert.rejects(() => A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: renta, concepto: 'X', monto: 10, cuentaDineroId: caja.id, ...bad }), e => e.status === 400);
      await q('ROLLBACK TO SAVEPOINT sp');
    }

    // 4) Estado de resultados: 10000 − 28.5 − (3000 + 700 luz por pagar) − 6000 = 271.5 → diezmo 27.15, ofrenda 13.58.
    const er = await A.estadoResultados(q, s, periodo);
    assert.equal(er.ventas.total, 10000); assert.equal(er.ventas.efectivo, 6000); assert.equal(er.ventas.banco, 4000);
    assert.equal(er.costoVentas.consumo, 28.5); assert.equal(er.utilidadBruta, 9971.5);
    assert.equal(er.gastosOperacion, 3700); assert.equal(er.gastosFinancieros, 6000); assert.equal(er.impuestos, 0);
    assert.equal(er.utilidadNeta, 271.5);
    assert.equal(er.mayordomia.diezmo, 27.15); assert.equal(er.mayordomia.ofrenda, 13.58);
    assert.equal(er.mayordomia.diezmoEntregado, 50); assert.equal(er.mayordomia.diezmoPendiente, -22.85);
    assert.deepEqual(er.otrasSalidas, { inventario: 200, inversion: 2000, retiros: 0, diezmoOfrenda: 50 });
    assert.equal(er.cerrado, false);
    console.log('estado de resultados:', { ventas: er.ventas.total, costo: er.costoVentas.total, operacion: er.gastosOperacion, financiero: er.gastosFinancieros, neta: er.utilidadNeta, diezmo: er.mayordomia.diezmo, ofrenda: er.mayordomia.ofrenda });

    // 5) Flujo de dinero: caja 6000 − 3000; banco 4000 − (6000 + 2000 + 200 + 50); traspaso caja → banco 1000.
    await q('INSERT INTO traspasos_dinero (sucursal_id, fecha, de_cuenta_id, a_cuenta_id, monto, usuario_id) VALUES ($1,$2,$3,$4,1000,$5)', [s, hoy, caja.id, banco.id, adm.id]);
    const fl = await A.flujoDinero(q, s, periodo);
    const fc = fl.cuentas.find(x => x.clave === 'caja'); const fb = fl.cuentas.find(x => x.clave === 'banco');
    assert.equal(fc.ventas, 6000); assert.equal(fc.egresos, 3000); assert.equal(fc.traspasosSalida, 1000); assert.equal(fc.saldoFinMes, 2000);
    assert.equal(fb.ventas, 4000); assert.equal(fb.egresos, 8250); assert.equal(fb.traspasosEntrada, 1000); assert.equal(fb.saldoFinMes, -3250);
    assert.equal(fl.porPagar.monto, 700);
    // Saldo inicial en banco: +5000 desde el inicio del mes.
    await q('UPDATE cuentas_dinero SET saldo_inicial = 5000, fecha_saldo_inicial = $2 WHERE id = $1', [banco.id, inicio]);
    const saldos = await A.saldosActuales(q, s);
    assert.equal(saldos.find(x => x.clave === 'banco').saldo, 1750);
    assert.equal(saldos.find(x => x.clave === 'caja').saldo, 2000);

    // 6) Mayordomía anual: el mes aparece con su diezmo; totales.
    const my = await A.mayordomiaAnual(q, s, periodo.slice(0, 4));
    const fila = my.meses.find(x => x.periodo === periodo);
    assert.ok(fila && fila.diezmo === 27.15 && fila.utilidadNeta === 271.5);
    assert.equal(my.totales.diezmo, 27.15); assert.equal(my.totales.diezmoEntregado, 50);

    // 7) Salida de caja del turno baja el efectivo esperado.
    const { rows: [t] } = await q('INSERT INTO turnos (abierto_por, sucursal_id, fondo_inicial) VALUES ($1, $2, 500) RETURNING id', [adm.id, s]);
    const otros = await A.cuentaPorClave(q, s, 'otros_gastos');
    await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: otros, concepto: 'Hielo', monto: 80, cuentaDineroId: caja.id, turnoId: t.id });
    const { rows: [dw] } = await q(drawerSql, [s]);
    assert.equal(Number(dw.salidas_turno), 80); assert.equal(Number(dw.num_salidas_turno), 1);

    // 8) Un gasto fijo solo se registra una vez por mes.
    const { rows: [gf] } = await q("INSERT INTO gastos_fijos (concepto, categoria, monto_mensual, sucursal_id, cuenta_contable_id) VALUES ('Renta fija QA', 'Renta', 3000, $1, $2) RETURNING id", [s, renta.id]);
    await A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: renta, concepto: 'Renta fija', monto: 3000, cuentaDineroId: caja.id, periodo, gastoFijoId: gf.id });
    await q('SAVEPOINT sp2');
    await assert.rejects(() => A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: renta, concepto: 'Renta fija otra vez', monto: 3000, cuentaDineroId: caja.id, periodo, gastoFijoId: gf.id }), e => e.code === '23505');
    await q('ROLLBACK TO SAVEPOINT sp2');

    // 9) Cierre de mes: ya no se registran movimientos en ese mes.
    await q('INSERT INTO cierres_mes (sucursal_id, periodo, cerrado_por, resumen) VALUES ($1, $2, $3, $4::jsonb)', [s, periodo, adm.id, JSON.stringify({ estado: er })]);
    assert.equal(await A.mesCerrado(q, s, periodo), true);
    await q('SAVEPOINT sp3');
    await assert.rejects(() => A.crearEgreso(c, { sucursalId: s, usuarioId: adm.id, fecha: hoy, cuentaContable: renta, concepto: 'Tarde', monto: 1, cuentaDineroId: caja.id }), e => e.status === 409);
    await q('ROLLBACK TO SAVEPOINT sp3');
    assert.equal((await A.estadoResultados(q, s, periodo)).cerrado, true);
    console.log('PASS: catálogo y cuentas por sede, egresos (pagados, por pagar, compras, diezmo), estado de resultados y mayordomía exactos, flujo y saldos por cuenta, salidas de caja, recurrente único por mes y cierre que bloquea.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
