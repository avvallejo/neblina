// Prueba viva del módulo de cortesías (por producto) contra la base local
// (NODE_ENV=development). Todo corre dentro de una transacción que se
// revierte al final.
//   node test/live-courtesies.js
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const { ApiError } = require('../src/utils/asyncHandler');
const { planDelMes, resolverCortesia, resolverPendiente, listarCortesias, leyendaCortesia, normalizarCupo, CLAVE_CUPO } = require('../src/services/courtesies');
const { recalcularImportes, marcarLineasCortesia } = require('../src/services/orderAmounts');
const { drawerSql } = require('../src/services/cashDrawer');
const { dailySalesSql } = require('../src/services/dailySales');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const { rows: [caja] } = await q("SELECT id, sucursal_id FROM usuarios WHERE rol = 'cajero' AND sucursal_id IS NOT NULL LIMIT 1");
    const { rows: [admin] } = await q("SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1");
    const s = caja.sucursal_id;
    const { rows: [prod] } = await q('SELECT id FROM productos WHERE sucursal_id = $1 LIMIT 1', [s]);
    const cajero = { tipo: 'staff', rol: 'cajero', id: caja.id, sucursalId: s };
    const jefe = { tipo: 'staff', rol: 'admin', id: admin.id, sucursalId: null };
    // Aislar los reportes sin borrar tickets referenciados por el inventario.
    // Todo, incluidas estas marcas, se revierte al terminar la prueba.
    await q('UPDATE pedidos SET cancelado = true WHERE sucursal_id = $1', [s]);
    await q('DELETE FROM configuracion WHERE sucursal_id = $1 AND clave = $2', [s, CLAVE_CUPO]);
    await q('UPDATE turnos SET cerrado_en = now() WHERE sucursal_id = $1 AND cerrado_en IS NULL', [s]);
    const { rows: [turno] } = await q('INSERT INTO turnos (abierto_por, sucursal_id, fondo_inicial) VALUES ($1, $2, 300) RETURNING id', [caja.id, s]);

    // Ticket abierto con líneas [{ precio, cantidad, cortesia }]; devuelve el
    // pedido ya recalculado (subtotal, cortesia_valor/unidades, total).
    const abrir = async (auth, lineas, descuento = 0) => {
      const { rows: [p] } = await q(
        `INSERT INTO pedidos (origen, sucursal_id, cajero_id, subtotal, total, descuento_porcentaje, destino) VALUES ('mostrador', $1, $2, 0, 0, $3, 'barra') RETURNING id`,
        [s, auth.id, descuento]
      );
      for (const l of lineas) {
        await q(`INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, es_cortesia) VALUES ($1, $2, $3, $4, $5)`, [p.id, prod.id, l.cantidad, l.precio, !!l.cortesia]);
      }
      return recalcularImportes(c, p.id);
    };
    // Cobro como lo hace PATCH /pedidos/:id/cobrar: resuelve el cupo si regaló algo.
    const cobrar = async (auth, pedido, { metodo = 'efectivo', motivo } = {}) => {
      const unidades = Number(pedido.cortesia_unidades);
      const total = Number(pedido.total);
      const metodoFinal = total === 0 && unidades > 0 ? 'cortesia' : metodo;
      const r = unidades > 0 ? await resolverCortesia(c, { auth, sucursalId: s, motivo, unidades }) : null;
      const { rows: [p] } = await q(
        `UPDATE pedidos SET cobrado = true, metodo_pago = $2::metodo_pago, turno_cobro_id = $3, importe_efectivo = CASE WHEN $2::text = 'efectivo' THEN total ELSE 0 END,
           cortesia_estado = $4, cortesia_motivo = $5, cortesia_resuelta_por = $6, cortesia_resuelta_en = $7 WHERE id = $1 RETURNING *`,
        [pedido.id, metodoFinal, turno.id, r ? r.estado : null, r ? r.motivo : null, r ? r.resueltaPor : null, r ? r.resueltaEn : null]
      );
      return { ...(r || {}), pedido: p };
    };
    const num = v => Number(v);

    // 1) Importes: la cortesía sale del subtotal; el descuento aplica solo a lo cobrable.
    const t1 = await abrir(cajero, [{ precio: 40, cantidad: 2, cortesia: true }, { precio: 50, cantidad: 1 }, { precio: 30, cantidad: 1 }], 10);
    assert.deepEqual([num(t1.subtotal), num(t1.cortesia_valor), num(t1.cortesia_unidades), num(t1.total)], [160, 80, 2, 72]);

    // 2) Sin cupo configurado: todo va a autorización (aunque la venta cobre el resto).
    let plan = await planDelMes(q, s);
    assert.deepEqual([plan.limite, plan.usadas, plan.restantes, plan.pendientes], [0, 0, 0, 0]);
    const c1 = await cobrar(cajero, t1, { motivo: '  invitación  ' });
    assert.equal(c1.estado, 'pendiente'); assert.equal(c1.excedida, true); assert.equal(c1.motivo, 'invitación'); assert.equal(c1.unidades, 2);
    assert.equal(c1.pedido.metodo_pago, 'efectivo'); assert.equal(num(c1.pedido.total), 72);
    assert.match(leyendaCortesia(c1), /administrador debe autorizarlo/);

    // 3) Cupo 5 por unidad: 3 + 2 entran; el siguiente de 1 ya no cabe → pendiente sin consumir.
    await q(`INSERT INTO configuracion (sucursal_id, clave, valor) VALUES ($1, $2, '5'::jsonb)`, [s, CLAVE_CUPO]);
    const c2 = await cobrar(cajero, await abrir(cajero, [{ precio: 60, cantidad: 3, cortesia: true }]));
    assert.equal(c2.estado, 'dentro_plan'); assert.equal(c2.plan.usadas, 3); assert.equal(c2.plan.restantes, 2);
    assert.equal(c2.pedido.metodo_pago, 'cortesia'); assert.equal(num(c2.pedido.total), 0); assert.equal(num(c2.pedido.subtotal), 180);
    // 3 unidades pedidas con 2 restantes: el ticket completo queda pendiente y no consume el cupo.
    const c3 = await cobrar(cajero, await abrir(cajero, [{ precio: 20, cantidad: 3, cortesia: true }, { precio: 45, cantidad: 1 }]));
    assert.equal(c3.estado, 'pendiente'); assert.equal(c3.plan.restantes, 2); assert.equal(num(c3.pedido.total), 45);
    assert.match(leyendaCortesia(c3), /solo quedan 2/);
    const c4 = await cobrar(cajero, await abrir(cajero, [{ precio: 35, cantidad: 2, cortesia: true }]), { metodo: 'tarjeta' });
    assert.equal(c4.estado, 'dentro_plan'); assert.equal(c4.plan.restantes, 0); assert.equal(c4.pedido.metodo_pago, 'cortesia');
    assert.match(leyendaCortesia(c4), /Se agotó el plan/);
    const c5 = await cobrar(cajero, await abrir(cajero, [{ precio: 25, cantidad: 1, cortesia: true }, { precio: 25, cantidad: 1 }]));
    assert.equal(c5.estado, 'pendiente');
    plan = await planDelMes(q, s);
    assert.deepEqual([plan.limite, plan.usadas, plan.restantes, plan.pendientes, plan.unidadesPendientes], [5, 5, 0, 3, 6]);
    // Un ticket sin cortesías no toca nada.
    const c6 = await cobrar(cajero, await abrir(cajero, [{ precio: 50, cantidad: 1 }]));
    assert.equal(c6.estado, undefined); assert.equal(c6.pedido.cortesia_estado, null); assert.equal(num(c6.pedido.total), 50);

    // 4) El admin no consume el cupo: queda autorizada por él mismo.
    const c7 = await cobrar(jefe, await abrir(jefe, [{ precio: 90, cantidad: 4, cortesia: true }]), { motivo: 'invitación del dueño' });
    assert.equal(c7.estado, 'autorizada'); assert.equal(c7.resueltaPor, admin.id);
    assert.equal((await planDelMes(q, s)).usadas, 5);

    // 5) Cancelar un ticket del plan libera sus unidades.
    await q('UPDATE pedidos SET cancelado = true WHERE id = $1', [c2.pedido.id]);
    assert.equal((await planDelMes(q, s)).restantes, 3);
    const c8 = await cobrar(cajero, await abrir(cajero, [{ precio: 10, cantidad: 3, cortesia: true }]));
    assert.equal(c8.estado, 'dentro_plan'); assert.equal(c8.plan.restantes, 0);

    // 6) Re-marcar líneas al cobrar (itemsCortesia): sustituye las marcas y recalcula.
    const t9 = await abrir(cajero, [{ precio: 40, cantidad: 1, cortesia: true }, { precio: 55, cantidad: 2 }]);
    const { rows: items9 } = await q('SELECT id, es_cortesia FROM pedido_items WHERE pedido_id = $1 ORDER BY precio_unitario', [t9.id]);
    await marcarLineasCortesia(c, t9.id, [items9[1].id], ApiError); // ahora la cortesía es la de 55×2
    const t9b = await recalcularImportes(c, t9.id);
    assert.deepEqual([num(t9b.cortesia_valor), num(t9b.cortesia_unidades), num(t9b.total)], [110, 2, 40]);
    await marcarLineasCortesia(c, t9.id, [], ApiError);
    const t9c = await recalcularImportes(c, t9.id);
    assert.deepEqual([num(t9c.cortesia_valor), num(t9c.cortesia_unidades), num(t9c.total)], [0, 0, 150]);
    await assert.rejects(() => marcarLineasCortesia(c, t9.id, ['00000000-0000-4000-8000-000000000000'], ApiError), e => e.status === 409);
    await q('SAVEPOINT sp_regalo');
    await q('UPDATE pedido_items SET es_regalo = true, precio_unitario = 0 WHERE id = $1', [items9[0].id]);
    await assert.rejects(() => marcarLineasCortesia(c, t9.id, [items9[0].id], ApiError), e => e.status === 400);
    await q('ROLLBACK TO SAVEPOINT sp_regalo');

    // 7) Autorizar / rechazar pendientes; no se resuelve dos veces.
    const lista = await listarCortesias(q, s, 'pendiente');
    assert.equal(lista.length, 3);
    assert.ok(lista.every(r => r.cortesia_estado === 'pendiente' && r.cajero_nombre && num(r.cortesia_unidades) > 0 && /cortesía/.test(r.detalle)));
    const auditAntes = (await q("SELECT COUNT(*)::int AS n FROM auditoria WHERE entidad = 'pedidos' AND accion LIKE 'cortesia_%' AND sucursal_id = $1", [s])).rows[0].n;
    const ok = await resolverPendiente(c, { pedidoId: c1.pedido.id, sucursalId: s, adminId: admin.id, decision: 'autorizada', nota: 'ok' });
    assert.equal(ok.cortesia_estado, 'autorizada'); assert.equal(ok.cortesia_nota, 'ok');
    const no = await resolverPendiente(c, { pedidoId: c3.pedido.id, sucursalId: s, adminId: admin.id, decision: 'rechazada', nota: 'se descuenta' });
    assert.equal(no.cortesia_estado, 'rechazada');
    await assert.rejects(() => resolverPendiente(c, { pedidoId: c3.pedido.id, sucursalId: s, adminId: admin.id, decision: 'autorizada' }), e => e.status === 409);
    await assert.rejects(() => resolverPendiente(c, { pedidoId: c6.pedido.id, sucursalId: s, adminId: admin.id, decision: 'autorizada' }), e => e.status === 404); // sin cortesía
    await assert.rejects(() => resolverPendiente(c, { pedidoId: c5.pedido.id, sucursalId: '00000000-0000-4000-8000-000000000000', adminId: admin.id, decision: 'autorizada' }), e => e.status === 404);
    await assert.rejects(() => resolverPendiente(c, { pedidoId: c5.pedido.id, sucursalId: s, adminId: admin.id, decision: 'otra' }), e => e.status === 400);
    assert.equal((await listarCortesias(q, s, 'pendiente')).length, 1);
    assert.equal((await q("SELECT COUNT(*)::int AS n FROM auditoria WHERE entidad = 'pedidos' AND accion LIKE 'cortesia_%' AND sucursal_id = $1", [s])).rows[0].n, auditAntes + 2);
    await assert.rejects(() => listarCortesias(q, s, 'x'), e => e.status === 400);

    // 8) La base rechaza cortesías incoherentes.
    for (const sql of [
      "INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago, cortesia_estado, cortesia_unidades) VALUES ('mostrador', $1, 50, 50, true, 'cortesia', 'dentro_plan', 1)",
      "INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago) VALUES ('mostrador', $1, 50, 0, true, 'cortesia')",
      "INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago, cortesia_estado) VALUES ('mostrador', $1, 50, 50, true, 'efectivo', 'pendiente')",
    ]) {
      await q('SAVEPOINT sp');
      await assert.rejects(() => q(sql, [s]), e => e.code === '23514');
      await q('ROLLBACK TO SAVEPOINT sp');
    }

    // 9) Caja del turno, resumen del día y reporte por forma de pago.
    // Cobrados con cortesía y no cancelados: c1(2u,$80) c3(3u,$60) c4(2u,$70) c5(1u,$25) c7(4u,$360) c8(3u,$30); c2 cancelado.
    const { rows: [caja1] } = await q(drawerSql, [s]);
    assert.equal(num(caja1.cortesias_turno), 6);
    assert.equal(num(caja1.cortesias_unidades_turno), 15);
    assert.equal(num(caja1.cortesias_valor_turno), 625);
    assert.equal(num(caja1.cortesias_pendientes_turno), 1); // c5
    assert.equal(num(caja1.ventas_turno), 72 + 45 + 25 + 50); // solo lo cobrado
    const { rows: [dia] } = await q(dailySalesSql, [s, null]);
    assert.equal(num(dia.cortesias), 6); assert.equal(num(dia.unidades_cortesia), 15); assert.equal(num(dia.valor_cortesias), 625);
    const { rows: rep } = await q('SELECT * FROM vw_ventas_por_metodo_pago WHERE sucursal_id = $1', [s]);
    const fila = m => rep.find(r => r.metodo_pago === m);
    assert.equal(num(fila('cortesia').num_pedidos), 6); assert.equal(num(fila('cortesia').total), 0);
    assert.equal(num(fila('cortesia').valor_cortesias), 625); assert.equal(num(fila('cortesia').unidades_cortesia), 15);
    assert.equal(num(fila('efectivo').total), 72 + 45 + 25 + 50); // los mixtos cuentan en su forma de pago con lo pagado
    assert.equal(fila('tarjeta'), undefined); // c4 fue 100 % cortesía: no es venta con tarjeta

    // 10) Validaciones.
    assert.equal(normalizarCupo(''), 0); assert.equal(normalizarCupo('7'), 7);
    for (const v of [-1, 1.5, 'abc', 1000]) assert.throws(() => normalizarCupo(v), e => e.status === 400);
    await assert.rejects(() => resolverCortesia(c, { auth: { tipo: 'staff', rol: 'barista', id: caja.id }, sucursalId: s }), e => e.status === 403);
    await assert.rejects(() => resolverCortesia(c, { auth: cajero, sucursalId: s, motivo: 'x'.repeat(201) }), e => e.status === 400);
    await assert.rejects(() => resolverCortesia(c, { auth: cajero, sucursalId: s, unidades: 0 }), e => e.status === 400);

    console.log('PASS: cortesía por producto — importes y descuento sobre lo cobrable, cupo por unidad, ticket que no cabe queda pendiente, admin autorizado, cancelación libera unidades, re-marcar líneas al cobrar, autorizar/rechazar una sola vez, coherencia en BD, caja del turno, resumen y reporte.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
