// Prueba viva de la cancelación de tickets con autorización (NODE_ENV=development).
// Transacción con rollback sobre una sede creada al vuelo.
//   node test/live-cancelaciones.js   (desde la raíz de la API)
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const C = require('../src/services/cancellations');
const A = require('../src/services/accounting');
const { dailySalesSql } = require('../src/services/dailySales');
const { drawerSql } = require('../src/services/cashDrawer');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const { rows: [sede] } = await q("INSERT INTO sucursales (nombre, prefijo_folio) VALUES ('QA Cancelaciones', 'QAX') RETURNING id");
    const s = sede.id;
    const { rows: [adm] } = await q("SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1");
    await q('INSERT INTO configuracion_margen (sucursal_id) VALUES ($1)', [s]);
    const { rows: [caj] } = await q("INSERT INTO usuarios (nombre, rol, pin_hash, sucursal_id) SELECT 'QA Cajero', 'cajero', pin_hash, $1 FROM usuarios WHERE id = $2 RETURNING id", [s, adm.id]);
    const authCaja = { tipo: 'staff', id: caj.id, rol: 'cajero', sucursalId: s };
    const authAdmin = { tipo: 'staff', id: adm.id, rol: 'admin', sucursalId: null };

    // Catálogo mínimo: un snack que se entrega en caja y descuenta inventario.
    const { rows: [catP] } = await q("INSERT INTO categorias_producto (nombre, orden, sucursal_id) VALUES ('Snacks', 1, $1) RETURNING id", [s]);
    const { rows: [catM] } = await q("INSERT INTO categorias_materia_prima (nombre, sucursal_id) VALUES ('Otros', $1) RETURNING id", [s]);
    const { rows: [m] } = await q(`INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, sucursal_id)
      VALUES ('Galleta QA', $1, 'pieza', 50, 5, 9.5, $2) RETURNING id`, [catM.id, s]);
    const { rows: [lote] } = await q(`INSERT INTO lotes (materia_prima_id, cantidad_comprada, cantidad_disponible, unidad, costo_total, usuario_id)
      VALUES ($1, 50, 50, 'pieza', 475, $2) RETURNING id`, [m.id, adm.id]);
    await q('UPDATE materias_primas SET requiere_lote = true WHERE id = $1', [m.id]);
    const { rows: [p] } = await q(`INSERT INTO productos (nombre, categoria_id, tipo, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, sucursal_id, estacion)
      VALUES ('Galleta', $1, 'snack', 24, false, false, false, false, $2, 'caja') RETURNING id`, [catP.id, s]);
    await q("INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES ($1, $2, 1, 'pieza')", [p.id, m.id]);
    const { rows: [turno] } = await q('INSERT INTO turnos (abierto_por, sucursal_id, fondo_inicial) VALUES ($1, $2, 500) RETURNING id', [caj.id, s]);
    const stock = async () => Number((await q('SELECT stock_actual FROM materias_primas WHERE id = $1', [m.id])).rows[0].stock_actual);
    const disponible = async () => Number((await q('SELECT cantidad_disponible FROM lotes WHERE id = $1', [lote.id])).rows[0].cantidad_disponible);
    const ventasDia = async () => Number((await q(dailySalesSql, [s, null])).rows[0].ventas);
    const efectivoTurno = async () => Number((await q(drawerSql, [s])).rows[0].ventas_efectivo);
    const nuevoTicket = async (cobrado, cantidad = 2) => {
      const total = 24 * cantidad;
      const { rows: [ped] } = await q(
        `INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago, importe_efectivo, destino, cajero_id, turno_id)
         VALUES ('mostrador', $1, $2::numeric, $2::numeric, $3::boolean, $4::metodo_pago, $5::numeric, 'llevar', $6, $7) RETURNING *`,
        [s, total, cobrado, cobrado ? 'efectivo' : null, cobrado ? total : null, caj.id, turno.id]);
      const { rows: [it] } = await q('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,24) RETURNING id', [ped.id, p.id, cantidad]);
      return { ped, it };
    };

    // 1) Motivo obligatorio.
    const t0 = await nuevoTicket(false, 1);
    for (const malo of [undefined, '', '  ', 'x']) {
      await q('SAVEPOINT sp');
      await assert.rejects(() => C.solicitarCancelacion(c, { pedidoId: t0.ped.id, sucursalId: s, auth: authCaja, motivo: malo }), e => e.status === 400);
      await q('ROLLBACK TO SAVEPOINT sp');
    }

    // 2) Ticket sin cobrar y sin preparar: se cancela al momento.
    const r1 = await C.solicitarCancelacion(c, { pedidoId: t0.ped.id, sucursalId: s, auth: authCaja, motivo: 'se equivocó de producto' });
    assert.equal(r1.cancelacion_estado, 'autorizada'); assert.equal(r1.cancelado, true);
    assert.match(r1.leyenda, /no se había cobrado/i);
    assert.equal((await q("SELECT estado FROM pedido_items WHERE pedido_id = $1", [t0.ped.id])).rows[0].estado, 'cancelado');
    await q('SAVEPOINT sp1');
    await assert.rejects(() => C.solicitarCancelacion(c, { pedidoId: t0.ped.id, sucursalId: s, auth: authCaja, motivo: 'otra vez' }), e => e.status === 409);
    await q('ROLLBACK TO SAVEPOINT sp1');

    // 3) Ticket COBRADO cuyo snack ya descontó inventario (se entrega en caja).
    const t1 = await nuevoTicket(true, 2);
    await q("UPDATE pedido_items SET estado = 'terminado', terminado_en = now() WHERE id = $1", [t1.it.id]);
    assert.equal(await stock(), 48); assert.equal(await disponible(), 48);
    const ventasAntes = await ventasDia(); const efectivoAntes = await efectivoTurno();
    assert.equal(ventasAntes, 48); assert.equal(efectivoAntes, 48);

    const r2 = await C.solicitarCancelacion(c, { pedidoId: t1.ped.id, sucursalId: s, auth: authCaja, motivo: 'ticket duplicado' });
    assert.equal(r2.cancelacion_estado, 'pendiente'); assert.equal(r2.cancelado, false);
    assert.match(r2.leyenda, /sigue contando/i);
    // Sigue contando hasta que el admin autorice, y el inventario no se movió.
    assert.equal(await ventasDia(), ventasAntes); assert.equal(await efectivoTurno(), efectivoAntes);
    assert.equal(await stock(), 48);
    const pend = await C.listarCancelaciones(q, s, 'pendiente');
    assert.equal(pend.length, 1);
    assert.equal(pend[0].id, t1.ped.id); assert.equal(pend[0].cancelacion_motivo, 'ticket duplicado');
    assert.equal(pend[0].solicitada_por_nombre, 'QA Cajero'); assert.equal(Number(pend[0].insumos_por_devolver), 1);
    assert.equal(pend[0].detalle, '2 × Galleta');
    // El cajero no puede autorizar su propia solicitud: eso lo hace el admin (ruta con requireRole).
    await q('SAVEPOINT sp2');
    await assert.rejects(() => C.solicitarCancelacion(c, { pedidoId: t1.ped.id, sucursalId: s, auth: authCaja, motivo: 'de nuevo' }), e => e.status === 409);
    await q('ROLLBACK TO SAVEPOINT sp2');

    // 4) El admin autoriza: sale de ventas, de la caja del turno y el inventario regresa.
    const r3 = await C.resolverCancelacion(c, { pedidoId: t1.ped.id, sucursalId: s, adminId: adm.id, decision: 'autorizada', nota: 'era duplicado, confirmado' });
    assert.equal(r3.cancelacion_estado, 'autorizada'); assert.equal(r3.cancelado, true); assert.equal(r3.insumosDevueltos, 1);
    assert.equal(await ventasDia(), 0); assert.equal(await efectivoTurno(), 0);
    assert.equal(await stock(), 50); assert.equal(await disponible(), 50);
    // Solo la reversa DE ESTE pedido: la base puede traer cancelaciones previas.
    const { rows: [rev] } = await q(
      `SELECT mi.tipo, mi.cantidad, mi.revierte_movimiento_id, mi.motivo
         FROM movimientos_inventario mi
         JOIN movimientos_inventario orig ON orig.id = mi.revierte_movimiento_id
         JOIN pedido_items pi ON pi.id = orig.pedido_item_id
        WHERE mi.tipo = 'ajuste' AND pi.pedido_id = $1`, [t1.ped.id]);
    assert.equal(Number(rev.cantidad), 2); assert.match(rev.motivo, /duplicado/);
    assert.equal((await q("SELECT COUNT(*) AS n FROM pedido_items WHERE pedido_id = $1 AND estado = 'cancelado'", [t1.ped.id])).rows[0].n, '1');
    // Resolver dos veces no repite nada.
    await q('SAVEPOINT sp3');
    await assert.rejects(() => C.resolverCancelacion(c, { pedidoId: t1.ped.id, sucursalId: s, adminId: adm.id, decision: 'autorizada' }), e => e.status === 409);
    await q('ROLLBACK TO SAVEPOINT sp3');
    // La reversa es idempotente aunque se llame directo.
    assert.equal(Number((await q('SELECT fn_revertir_consumo_pedido($1, $2, $3) AS n', [t1.ped.id, adm.id, 'otra vez'])).rows[0].n), 0);
    assert.equal(await stock(), 50);

    // 5) Rechazar: el ticket sigue contando.
    const t2 = await nuevoTicket(true, 1);
    await C.solicitarCancelacion(c, { pedidoId: t2.ped.id, sucursalId: s, auth: authCaja, motivo: 'creo que fue error' });
    assert.equal(await ventasDia(), 24);
    const r4 = await C.resolverCancelacion(c, { pedidoId: t2.ped.id, sucursalId: s, adminId: adm.id, decision: 'rechazada', nota: 'la venta sí se hizo' });
    assert.equal(r4.cancelacion_estado, 'rechazada'); assert.equal(r4.cancelado, false);
    assert.equal(await ventasDia(), 24);
    // Rechazada: se puede volver a pedir si de verdad hacía falta.
    const r5 = await C.solicitarCancelacion(c, { pedidoId: t2.ped.id, sucursalId: s, auth: authCaja, motivo: 'confirmado: sí estaba duplicado' });
    assert.equal(r5.cancelacion_estado, 'pendiente');

    // 6) Un administrador que pide la cancelación la autoriza de una vez.
    const t3 = await nuevoTicket(true, 1);
    const r6 = await C.solicitarCancelacion(c, { pedidoId: t3.ped.id, sucursalId: s, auth: authAdmin, motivo: 'cobro equivocado' });
    assert.equal(r6.cancelacion_estado, 'autorizada'); assert.equal(r6.cancelado, true);
    assert.match(r6.leyenda, /descontado de las ventas/i);

    // 7) Mes contable cerrado: no se puede autorizar (cambiaría una utilidad ya fijada).
    const periodo = A.hoyMx().slice(0, 7);
    const t4 = await nuevoTicket(true, 1);
    await C.solicitarCancelacion(c, { pedidoId: t4.ped.id, sucursalId: s, auth: authCaja, motivo: 'duplicado del mes' });
    await q('INSERT INTO cierres_mes (sucursal_id, periodo, cerrado_por, resumen) VALUES ($1,$2,$3,$4::jsonb)', [s, periodo, adm.id, '{}']);
    await q('SAVEPOINT sp4');
    await assert.rejects(() => C.resolverCancelacion(c, { pedidoId: t4.ped.id, sucursalId: s, adminId: adm.id, decision: 'autorizada' }), e => e.status === 409 && /cerrado/.test(e.message));
    await q('ROLLBACK TO SAVEPOINT sp4');
    await q('DELETE FROM cierres_mes WHERE sucursal_id = $1 AND periodo = $2', [s, periodo]);
    assert.equal((await C.resolverCancelacion(c, { pedidoId: t4.ped.id, sucursalId: s, adminId: adm.id, decision: 'autorizada' })).cancelado, true);

    // 8) Fidelidad: cancelar un ticket cobrado de un cliente devuelve su punto.
    const { rows: [cli] } = await q("INSERT INTO clientes (nombre, apellido, telefono, sucursal_id, pedidos_app_contador) VALUES ('QA','Cliente','5599000011',$1,0) RETURNING id", [s]);
    const { rows: [pc] } = await q(
      `INSERT INTO pedidos (origen, sucursal_id, cliente_id, subtotal, total, cobrado, metodo_pago, importe_efectivo, destino, cajero_id, turno_id)
       VALUES ('app', $1, $2, 24, 24, true, 'efectivo', 24, 'llevar', $3, $4) RETURNING id`, [s, cli.id, caj.id, turno.id]);
    await q('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1,$2,1,24)', [pc.id, p.id]);
    const puntos = async () => Number((await q('SELECT pedidos_app_contador FROM clientes WHERE id = $1', [cli.id])).rows[0].pedidos_app_contador);
    assert.equal(await puntos(), 1); // el INSERT ya cobrado acreditó el punto
    await C.solicitarCancelacion(c, { pedidoId: pc.id, sucursalId: s, auth: authAdmin, motivo: 'duplicado en línea' });
    assert.equal(await puntos(), 0);

    // 9) Historial y filtros.
    const todas = await C.listarCancelaciones(q, s);
    assert.equal(todas.length, 6);
    assert.equal((await C.listarCancelaciones(q, s, 'autorizada')).length, 5);
    assert.equal((await C.listarCancelaciones(q, s, 'pendiente')).length, 1); // t2, re-solicitada
    await assert.rejects(() => C.listarCancelaciones(q, s, 'inventado'), e => e.status === 400);
    const { rows: auditRows } = await q("SELECT accion FROM auditoria WHERE sucursal_id = $1 AND entidad = 'pedidos' AND accion LIKE 'cancelacion%' ORDER BY creado_en", [s]);
    const audit = auditRows.map(r => r.accion);
    assert.ok(audit.length >= 8, `auditoría: ${audit.length} registros`);
    for (const accion of ['cancelacion_solicitada', 'cancelacion_inmediata', 'cancelacion_autorizada', 'cancelacion_rechazada']) {
      assert.ok(audit.includes(accion), `falta en auditoría: ${accion}`);
    }
    console.log('PASS: motivo obligatorio, cancelación inmediata sin cobro, solicitud que sigue contando hasta autorizar, autorización que baja ventas y devuelve inventario (idempotente), rechazo, admin que autoriza de una vez, mes cerrado bloqueado, punto de fidelidad devuelto y auditoría.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
