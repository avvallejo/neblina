// Prueba viva del módulo de cortesías contra la base local (NODE_ENV=development).
// Todo corre dentro de una transacción que se revierte al final.
//   node test/live-courtesies.js
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const { planDelMes, resolverCortesia, resolverPendiente, listarCortesias, leyendaCortesia, normalizarCupo, CLAVE_CUPO } = require('../src/services/courtesies');
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
    const cajero = { tipo: 'staff', rol: 'cajero', id: caja.id, sucursalId: s };
    const jefe = { tipo: 'staff', rol: 'admin', id: admin.id, sucursalId: null };
    await q("DELETE FROM pedidos WHERE sucursal_id = $1 AND metodo_pago = 'cortesia'", [s]); // partir de cero (se revierte)
    await q('DELETE FROM configuracion WHERE sucursal_id = $1 AND clave = $2', [s, CLAVE_CUPO]);
    await q('UPDATE turnos SET cerrado_en = now() WHERE sucursal_id = $1 AND cerrado_en IS NULL', [s]);
    await q('INSERT INTO turnos (abierto_por, sucursal_id, fondo_inicial) VALUES ($1, $2, 300)', [caja.id, s]);

    const cortesia = async (auth, motivo, valor = 60) => {
      const r = await resolverCortesia(c, { auth, sucursalId: s, motivo });
      const { rows: [p] } = await q(
        `INSERT INTO pedidos (origen, sucursal_id, cajero_id, subtotal, total, cobrado, metodo_pago, cortesia_estado, cortesia_motivo, cortesia_resuelta_por, cortesia_resuelta_en)
         VALUES ('mostrador', $1, $2, $3, 0, true, 'cortesia', $4, $5, $6, $7) RETURNING *`,
        [s, auth.id, valor, r.estado, r.motivo, r.resueltaPor, r.resueltaEn]
      );
      return { ...r, pedido: p };
    };

    // 1) Sin cupo configurado: todo va a autorización.
    let plan = await planDelMes(q, s);
    assert.deepEqual([plan.limite, plan.usadas, plan.restantes, plan.pendientes], [0, 0, 0, 0]);
    const c0 = await cortesia(cajero, '  invitación  ');
    assert.equal(c0.estado, 'pendiente'); assert.equal(c0.excedida, true); assert.equal(c0.motivo, 'invitación');
    assert.match(leyendaCortesia(c0), /administrador debe autorizarla/);

    // 2) Cupo 2: dos dentro del plan, la tercera pendiente.
    await q(`INSERT INTO configuracion (sucursal_id, clave, valor) VALUES ($1, $2, '2'::jsonb)`, [s, CLAVE_CUPO]);
    const c1 = await cortesia(cajero, null);
    assert.equal(c1.estado, 'dentro_plan'); assert.equal(c1.plan.restantes, 1); assert.equal(c1.motivo, null);
    const c2 = await cortesia(cajero, 'cliente frecuente');
    assert.equal(c2.estado, 'dentro_plan'); assert.equal(c2.plan.restantes, 0);
    assert.match(leyendaCortesia(c2), /Era la última/);
    const c3 = await cortesia(cajero, 'bebida mal preparada', 85);
    assert.equal(c3.estado, 'pendiente');
    plan = await planDelMes(q, s);
    assert.deepEqual([plan.limite, plan.usadas, plan.restantes, plan.pendientes], [2, 2, 0, 2]);

    // 3) El admin no consume el cupo: queda autorizada por él mismo.
    const c4 = await cortesia(jefe, 'invitación del dueño');
    assert.equal(c4.estado, 'autorizada'); assert.equal(c4.resueltaPor, admin.id);
    assert.equal((await planDelMes(q, s)).usadas, 2);

    // 4) Cancelar una del plan libera su lugar.
    await q('UPDATE pedidos SET cancelado = true WHERE id = $1', [c1.pedido.id]);
    assert.equal((await planDelMes(q, s)).restantes, 1);
    const c5 = await cortesia(cajero, null);
    assert.equal(c5.estado, 'dentro_plan');

    // 5) Autorizar / rechazar pendientes; no se resuelve dos veces.
    const lista = await listarCortesias(q, s, 'pendiente');
    assert.equal(lista.length, 2);
    const auditAntes = (await q("SELECT COUNT(*)::int AS n FROM auditoria WHERE entidad = 'pedidos' AND accion LIKE 'cortesia_%' AND sucursal_id = $1", [s])).rows[0].n;
    assert.ok(lista.every(r => r.cortesia_estado === 'pendiente' && r.cajero_nombre));
    const ok = await resolverPendiente(c, { pedidoId: c0.pedido.id, sucursalId: s, adminId: admin.id, decision: 'autorizada', nota: 'ok' });
    assert.equal(ok.cortesia_estado, 'autorizada'); assert.equal(ok.cortesia_nota, 'ok');
    const no = await resolverPendiente(c, { pedidoId: c3.pedido.id, sucursalId: s, adminId: admin.id, decision: 'rechazada', nota: 'se descuenta' });
    assert.equal(no.cortesia_estado, 'rechazada');
    await assert.rejects(() => resolverPendiente(c, { pedidoId: c3.pedido.id, sucursalId: s, adminId: admin.id, decision: 'autorizada' }), e => e.status === 409);
    await assert.rejects(() => resolverPendiente(c, { pedidoId: c5.pedido.id, sucursalId: '00000000-0000-4000-8000-000000000000', adminId: admin.id, decision: 'autorizada' }), e => e.status === 404);
    await assert.rejects(() => resolverPendiente(c, { pedidoId: c5.pedido.id, sucursalId: s, adminId: admin.id, decision: 'otra' }), e => e.status === 400);
    assert.equal((await listarCortesias(q, s, 'pendiente')).length, 0);
    assert.equal((await q("SELECT COUNT(*)::int AS n FROM auditoria WHERE entidad = 'pedidos' AND accion LIKE 'cortesia_%' AND sucursal_id = $1", [s])).rows[0].n, auditAntes + 2);
    await assert.rejects(() => listarCortesias(q, s, 'x'), e => e.status === 400);

    // 6) La base rechaza cortesías incoherentes.
    for (const sql of [
      "INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago, cortesia_estado) VALUES ('mostrador', $1, 50, 50, true, 'cortesia', 'dentro_plan')",
      "INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago) VALUES ('mostrador', $1, 50, 0, true, 'cortesia')",
      "INSERT INTO pedidos (origen, sucursal_id, subtotal, total, cobrado, metodo_pago, cortesia_estado) VALUES ('mostrador', $1, 50, 50, true, 'efectivo', 'pendiente')",
    ]) {
      await q('SAVEPOINT sp');
      await assert.rejects(() => q(sql, [s]), e => e.code === '23514');
      await q('ROLLBACK TO SAVEPOINT sp');
    }

    // 7) Caja del turno, resumen del día y reporte por forma de pago.
    const { rows: [caja1] } = await q(drawerSql, [s]);
    assert.equal(Number(caja1.cortesias_turno), 5); // c0, c2, c3, c4, c5 (c1 cancelada no cuenta)
    assert.equal(Number(caja1.cortesias_valor_turno), 60 * 4 + 85);
    assert.equal(Number(caja1.cortesias_pendientes_turno), 0);
    assert.equal(Number(caja1.ventas_turno), 0); // las cortesías no suman ventas
    const { rows: [dia] } = await q(dailySalesSql, [s, null]);
    assert.equal(Number(dia.cortesias), 5); assert.equal(Number(dia.valor_cortesias), 325);
    const { rows: rep } = await q("SELECT * FROM vw_ventas_por_metodo_pago WHERE sucursal_id = $1 AND metodo_pago = 'cortesia'", [s]);
    assert.equal(Number(rep[0].num_pedidos), 5); assert.equal(Number(rep[0].total), 0); assert.equal(Number(rep[0].valor_cortesias), 325);

    // 8) Validación del cupo.
    assert.equal(normalizarCupo(''), 0); assert.equal(normalizarCupo('7'), 7);
    for (const v of [-1, 1.5, 'abc', 1000]) assert.throws(() => normalizarCupo(v), e => e.status === 400);
    await assert.rejects(() => resolverCortesia(c, { auth: { tipo: 'staff', rol: 'barista', id: caja.id }, sucursalId: s }), e => e.status === 403);
    await assert.rejects(() => resolverCortesia(c, { auth: cajero, sucursalId: s, motivo: 'x'.repeat(201) }), e => e.status === 400);

    console.log('PASS: cupo mensual por sucursal, exceso pendiente, admin autorizado, cancelación libera cupo, autorizar/rechazar una sola vez, coherencia en BD, caja del turno, resumen y reporte.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
