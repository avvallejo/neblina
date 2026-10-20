// Base de desarrollo local únicamente. Todo lo que escribe se revierte (ROLLBACK).
//
// Jornadas (migración 50): entrada/salida/pausas, cálculo a minuto completo,
// jornadas vencidas, correcciones del admin, jornada manual, y el pago semanal
// como egreso en "Sueldos y salarios" (sin turno de caja, saliendo de Caja).
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const J = require('../src/services/jornadas');
const A = require('../src/services/accounting');
const { drawerSql } = require('../src/services/cashDrawer');

const rechaza = (promesa, status, codigo) => assert.rejects(promesa, e => e.status === status && (!codigo || e.details?.codigo === codigo));

(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = c.query.bind(c);
    const { rows: [base] } = await q('SELECT id, sucursal_id FROM usuarios WHERE sucursal_id IS NOT NULL LIMIT 1');
    const s = base.sucursal_id; const admin = base.id;
    await q('DELETE FROM cierres_mes WHERE sucursal_id = $1', [s]);
    const { rows: [u] } = await q("INSERT INTO usuarios (nombre, rol, pin_hash, sucursal_id) VALUES ('Cajera prueba', 'cajero', 'x', $1) RETURNING id", [s]);
    const { rows: [{ minuto }] } = await q("SELECT date_trunc('minute', now()) AS minuto");

    // 1. Quien no se paga por hora no registra jornadas; sin tarifa tampoco puede empezar.
    assert.equal(await J.iniciarJornada(c, { usuarioId: u.id }), null);
    assert.deepEqual(await J.estadoActual(q, u.id), { aplica: false });
    await q('UPDATE usuarios SET paga_por_hora = true WHERE id = $1', [u.id]);
    await rechaza(J.iniciarJornada(c, { usuarioId: u.id }), 409);
    await rechaza(J.fijarTarifa(q, { usuarioId: u.id, tarifa: 0, adminId: admin }), 400);
    assert.equal(await J.fijarTarifa(q, { usuarioId: u.id, tarifa: 50, adminId: admin }), 50);
    await q("UPDATE tarifas_hora SET vigente_desde = now() - interval '30 days' WHERE usuario_id = $1", [u.id]);

    // 2. Entrada: idempotente; una sola abierta por persona.
    const ini = await J.iniciarJornada(c, { usuarioId: u.id });
    assert.equal(ini.creada, true); assert.equal(ini.jornada.estado, 'abierta'); assert.equal(ini.jornada.tarifaHora, 50);
    const otra = await J.iniciarJornada(c, { usuarioId: u.id });
    assert.equal(otra.creada, false); assert.equal(otra.jornada.id, ini.jornada.id);
    await q('SAVEPOINT unica');
    await assert.rejects(() => q("INSERT INTO jornadas (sucursal_id, usuario_id, tarifa_hora) VALUES ($1, $2, 50)", [s, u.id]), e => e.code === '23505');
    await q('ROLLBACK TO SAVEPOINT unica');
    let est = await J.estadoActual(q, u.id);
    assert.equal(est.aplica, true); assert.equal(est.enPausa, false); assert.equal(est.jornada.enCurso, true); assert.equal(est.tarifaHora, 50);

    // 3. Salir / Regresar (pausa), también idempotentes.
    const p1 = await J.iniciarPausa(c, { usuarioId: u.id });
    assert.ok(p1.pausaDesde);
    await J.iniciarPausa(c, { usuarioId: u.id });
    assert.equal(Number((await q('SELECT count(*) n FROM jornada_pausas WHERE jornada_id = $1', [ini.jornada.id])).rows[0].n), 1);
    assert.equal((await J.estadoActual(q, u.id)).enPausa, true);
    const p2 = await J.terminarPausa(c, { usuarioId: u.id });
    assert.equal(p2.pausaDesde, null);

    // 4. Cálculo a minuto completo. Entrada 8 h 5 min antes (con 40 s de sobra que se descartan),
    //    una pausa de 30 min → 485 − 30 = 455 min × $50 ÷ 60 = $379.17.
    await q("UPDATE jornadas SET entrada = $2::timestamptz - interval '8 hours 5 minutes' + interval '40 seconds' WHERE id = $1", [ini.jornada.id, minuto]);
    await q("UPDATE jornada_pausas SET inicio = $2::timestamptz - interval '4 hours 30 minutes' + interval '15 seconds', fin = $2::timestamptz - interval '4 hours' + interval '50 seconds' WHERE jornada_id = $1", [ini.jornada.id, minuto]);
    est = await J.estadoActual(q, u.id);
    assert.equal(est.jornada.minutosPagables, 455); assert.equal(est.jornada.monto, 379.17);
    const fin = await J.terminarJornada(c, { usuarioId: u.id });
    assert.equal(fin.estado, 'cerrada'); assert.equal(fin.minutosPausa, 30); assert.equal(fin.minutosPagables, 455); assert.equal(fin.monto, 379.17);
    assert.ok(fin.salida);
    await rechaza(J.terminarJornada(c, { usuarioId: u.id }), 409, 'sin_jornada');
    assert.equal((await J.estadoActual(q, u.id)).jornada, null);
    // La jornada A se recorre 12 horas hacia atrás para que las siguientes (que se crean "hoy") no se empalmen con ella.
    await q("UPDATE jornadas SET entrada = entrada - interval '12 hours', salida = salida - interval '12 hours' WHERE id = $1", [fin.id]);
    await q("UPDATE jornada_pausas SET inicio = inicio - interval '12 hours', fin = fin - interval '12 hours' WHERE jornada_id = $1", [fin.id]);
    const fechaA = (await q("SELECT to_char(entrada AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') f FROM jornadas WHERE id = $1", [fin.id])).rows[0].f;

    // 5. Resumen de la semana de esa jornada: domingo a sábado, con el monto del día y el acumulado.
    const r = await J.resumenPersona(q, u.id, fechaA);
    assert.equal(r.dias.length, 7); assert.equal(new Date(`${r.semana.desde}T12:00:00Z`).getUTCDay(), 0); assert.equal(new Date(`${r.semana.hasta}T12:00:00Z`).getUTCDay(), 6);
    const dia = r.dias.find(d => d.fecha === fechaA);
    assert.equal(dia.monto, 379.17); assert.equal(dia.minutos, 455);
    assert.equal(r.totales.monto, 379.17); assert.equal(r.totales.porPagar, 379.17); assert.equal(r.totales.pagado, 0);

    // 6. Una jornada que rebasa el tope queda por revisar y NO se cierra sola: la administración decide.
    const b = (await J.iniciarJornada(c, { usuarioId: u.id })).jornada;
    await q("UPDATE jornadas SET entrada = $2::timestamptz - interval '30 hours' WHERE id = $1", [b.id, minuto]);
    est = await J.estadoActual(q, u.id);
    assert.equal(est.jornada, null); assert.equal(est.pendientesRevision, 1);
    const { rows: [bv] } = await q('SELECT estado, salida, motivo_revision FROM jornadas WHERE id = $1', [b.id]);
    assert.equal(bv.estado, 'por_revisar'); assert.equal(bv.salida, null); assert.match(bv.motivo_revision, /12 horas/);
    const c2 = (await J.iniciarJornada(c, { usuarioId: u.id }));
    assert.equal(c2.creada, true); assert.notEqual(c2.jornada.id, b.id);
    const cierre0 = await J.terminarJornada(c, { usuarioId: u.id });
    assert.equal(cierre0.minutosPagables, 0); assert.equal(cierre0.monto, 0); assert.equal(cierre0.estado, 'cerrada');

    // Una pausa de más de 2 horas (se le olvidó "Regresar") también pide revisión.
    const d = (await J.iniciarJornada(c, { usuarioId: u.id })).jornada;
    await q("UPDATE jornadas SET entrada = $2::timestamptz - interval '6 hours' WHERE id = $1", [d.id, minuto]);
    await J.iniciarPausa(c, { usuarioId: u.id });
    await q("UPDATE jornada_pausas SET inicio = $2::timestamptz - interval '4 hours' WHERE jornada_id = $1", [d.id, minuto]);
    const finD = await J.terminarJornada(c, { usuarioId: u.id });
    assert.equal(finD.estado, 'por_revisar'); assert.match(finD.motivoRevision, /pausa/i); assert.equal(finD.minutosPausa, 240);

    // 7. Correcciones de la administración: motivo obligatorio, rastro en auditoría.
    await rechaza(J.corregirJornada(c, { sucursalId: s, adminId: admin, id: b.id, body: { salida: new Date(minuto).toISOString() } }), 400);
    const entradaB = new Date(new Date(minuto).getTime() - 30 * 3600000);
    const salidaB = new Date(entradaB.getTime() + 8 * 3600000);
    const corr = await J.corregirJornada(c, { sucursalId: s, adminId: admin, id: b.id, body: { salida: salidaB.toISOString(), minutosPausa: 30, motivo: 'Se le olvidó cerrar; salió a las 3 pm' } });
    assert.equal(corr.estado, 'cerrada'); assert.equal(corr.minutosPagables, 450); assert.equal(corr.monto, 375);
    const aud = (await q("SELECT valor_anterior, valor_nuevo, motivo FROM auditoria WHERE entidad = 'jornadas' AND entidad_id = $1 AND accion = 'corregir'", [b.id])).rows[0];
    assert.equal(aud.valor_anterior.estado, 'por_revisar'); assert.equal(aud.valor_nuevo.estado, 'cerrada'); assert.match(aud.motivo, /olvidó/);
    // La salida no puede estar en el futuro ni antes de la entrada; tampoco empalmarse con otra jornada.
    await rechaza(J.corregirJornada(c, { sucursalId: s, adminId: admin, id: b.id, body: { salida: new Date(Date.now() + 3 * 3600000).toISOString(), motivo: 'x' } }), 400);
    await rechaza(J.corregirJornada(c, { sucursalId: s, adminId: admin, id: b.id, body: { salida: new Date(entradaB.getTime() - 60000).toISOString(), motivo: 'x' } }), 400);
    await rechaza(J.corregirJornada(c, { sucursalId: s, adminId: admin, id: b.id, body: { salida: new Date(entradaB.getTime() + 23 * 3600000).toISOString(), motivo: 'x' } }), 409); // choca con la primera jornada (A)
    // La pausa larga (d): la administración la revisa y la aprueba o la ajusta.
    const apr = await J.corregirJornada(c, { sucursalId: s, adminId: admin, id: d.id, body: { minutosPausa: 30, motivo: 'Revisada: sí volvió, no presionó Regresar' } });
    assert.equal(apr.estado, 'cerrada'); assert.equal(apr.minutosPausa, 30); assert.equal(apr.minutosPagables, 330); assert.equal(apr.monto, 275);

    // 8. Jornada manual (un día que no se registró) en una semana anterior, con la tarifa de ese día.
    const hoy = A.hoyMx(); const dia10 = J.sumarDias(hoy, -10);
    await rechaza(J.crearJornadaManual(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, entrada: `${dia10}T09:00`, salida: `${dia10}T13:30`, minutosPausa: 30 } }), 400); // sin motivo
    const man = await J.crearJornadaManual(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, entrada: `${dia10}T09:00`, salida: `${dia10}T13:30`, minutosPausa: 30, motivo: 'Olvidó entrar' } });
    assert.equal(man.manual, true); assert.equal(man.estado, 'cerrada'); assert.equal(man.minutosPagables, 240); assert.equal(man.monto, 200); assert.equal(man.fecha, dia10);
    await rechaza(J.crearJornadaManual(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, entrada: `${dia10}T12:00`, salida: `${dia10}T15:00`, motivo: 'x' } }), 409); // empalme
    await rechaza(J.crearJornadaManual(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, entrada: `${dia10}T20:00`, salida: `${dia10}T19:00`, motivo: 'x' } }), 400);

    // 9. Cambiar la tarifa NO toca lo ya trabajado; la nueva rige hacia adelante.
    assert.equal(await J.fijarTarifa(q, { usuarioId: u.id, tarifa: 60, adminId: admin }), 60);
    assert.equal(await J.tarifaVigente(q, u.id), 60);
    assert.equal(await J.tarifaVigente(q, u.id, new Date(Date.now() - 86400000)), 50);
    assert.equal((await q('SELECT tarifa_hora::float8 t FROM jornadas WHERE id = $1', [fin.id])).rows[0].t, 50);
    assert.equal(await J.fijarTarifa(q, { usuarioId: u.id, tarifa: 60, adminId: admin }), 60); // misma tarifa: sin fila nueva
    assert.equal(Number((await q('SELECT count(*) n FROM tarifas_hora WHERE usuario_id = $1', [u.id])).rows[0].n), 2);

    // 10. Semana de la administración: por persona, con pendientes y totales.
    const sem = await J.semanaAdmin(q, s, dia10);
    const persona = sem.personas.find(p => p.id === u.id);
    assert.equal(persona.totales.porPagar, 200); assert.equal(persona.pendientes, 0); assert.equal(persona.tarifaHora, 60);
    assert.equal(sem.porRevisar.length, 0);

    // 11. PAGO: egreso en "Sueldos y salarios", desde Caja, SIN turno de caja (no entra al corte).
    await q("UPDATE cuentas_dinero SET fecha_saldo_inicial = current_date - 60 WHERE sucursal_id = $1 AND clave = 'caja'", [s]);
    await q('UPDATE turnos SET cerrado_en = now() WHERE sucursal_id = $1 AND cerrado_en IS NULL', [s]);
    await q('INSERT INTO turnos (sucursal_id, abierto_por, fondo_inicial) VALUES ($1, $2, 1000)', [s, admin]);
    const periodo = hoy.slice(0, 7);
    const cajaAntes = (await A.saldosActuales(q, s)).find(x => x.clave === 'caja').saldo;
    const utilidadAntes = (await A.estadoResultados(q, s, periodo)).utilidadNeta;
    const salidasAntes = Number((await q(drawerSql, [s])).rows[0].salidas_turno);
    await rechaza(J.pagarHoras(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, semana: J.sumarDias(hoy, -40) } }), 409, 'sin_horas_por_pagar');
    const pago = await J.pagarHoras(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, semana: dia10, nota: 'Pagado en efectivo' } });
    assert.equal(pago.monto, 200); assert.equal(pago.jornadas, 1); assert.equal(pago.minutos, 240); assert.equal(pago.cuentaDinero, 'Caja (efectivo)');
    assert.equal(new Date(`${pago.semana.desde}T12:00:00Z`).getUTCDay(), 0);
    const eg = await A.obtenerEgreso(q, s, pago.egresoId);
    assert.equal(eg.cuenta_clave, 'sueldos'); assert.equal(eg.cuenta_dinero_clave, 'caja'); assert.equal(eg.pagado, true); assert.equal(eg.turno_id, null);
    assert.equal(Number(eg.monto), 200); assert.match(eg.concepto, /Cajera prueba/); assert.equal(eg.fecha, hoy);
    const jm = (await q('SELECT estado, pago_id FROM jornadas WHERE id = $1', [man.id])).rows[0];
    assert.equal(jm.estado, 'pagada'); assert.equal(jm.pago_id, pago.pagoId);
    // Cuadra con el dinero y la utilidad; el corte de caja NO se entera.
    assert.equal(A.round2(cajaAntes - (await A.saldosActuales(q, s)).find(x => x.clave === 'caja').saldo), 200);
    assert.equal(A.round2(utilidadAntes - (await A.estadoResultados(q, s, periodo)).utilidadNeta), 200);
    assert.equal(Number((await q(drawerSql, [s])).rows[0].salidas_turno), salidasAntes);
    // No se paga dos veces, y una pagada no se corrige ni se anula sin anular antes el egreso.
    await rechaza(J.pagarHoras(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, semana: dia10 } }), 409, 'sin_horas_por_pagar');
    await rechaza(J.corregirJornada(c, { sucursalId: s, adminId: admin, id: man.id, body: { minutosPausa: 0, motivo: 'x' } }), 409);
    await rechaza(J.anularJornada(c, { sucursalId: s, adminId: admin, id: man.id, motivo: 'x' }), 409);
    const bitacora = await J.listarPagos(q, s, { usuarioId: u.id });
    assert.equal(bitacora.length, 1); assert.equal(bitacora[0].monto, 200); assert.equal(bitacora[0].anulado, false); assert.equal(bitacora[0].egresoId, pago.egresoId);
    assert.equal((await J.semanaAdmin(q, s, dia10)).personas.find(p => p.id === u.id).totales.pagado, 200);

    // 12. Anular el egreso libera las horas y anula el pago; se pueden volver a pagar.
    await q('UPDATE egresos SET anulado = true WHERE id = $1', [pago.egresoId]);
    assert.equal((await q('SELECT estado, pago_id FROM jornadas WHERE id = $1', [man.id])).rows[0].estado, 'cerrada');
    assert.equal((await q('SELECT anulado FROM pagos_horas WHERE id = $1', [pago.pagoId])).rows[0].anulado, true);
    assert.equal(A.round2(cajaAntes - (await A.saldosActuales(q, s)).find(x => x.clave === 'caja').saldo), 0);
    const pago2 = await J.pagarHoras(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, semana: dia10 } });
    assert.equal(pago2.monto, 200); assert.notEqual(pago2.egresoId, pago.egresoId);

    // 13. No se paga con jornadas por resolver en la semana, ni en un mes cerrado.
    const sem12 = J.semanaDe(J.sumarDias(hoy, -17)); // otra semana distinta a la del primer pago (7 días antes)
    const dia12 = J.sumarDias(sem12.desde, 1);
    const pendiente = await J.crearJornadaManual(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, entrada: `${dia12}T09:00`, salida: `${dia12}T10:00`, motivo: 'Prueba' } });
    const otra2 = J.sumarDias(sem12.desde, 2);
    const pend2 = await J.crearJornadaManual(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, entrada: `${otra2}T09:00`, salida: `${otra2}T10:00`, motivo: 'Prueba' } });
    await q("UPDATE jornadas SET estado = 'por_revisar', motivo_revision = 'prueba' WHERE id = $1", [pend2.id]);
    await rechaza(J.pagarHoras(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, semana: dia12 } }), 409, 'jornadas_sin_resolver');
    assert.equal((await q('SELECT estado FROM jornadas WHERE id = $1', [pendiente.id])).rows[0].estado, 'cerrada');
    await J.anularJornada(c, { sucursalId: s, adminId: admin, id: pend2.id, motivo: 'Entrada por error' });
    await rechaza(J.anularJornada(c, { sucursalId: s, adminId: admin, id: pend2.id, motivo: 'otra vez' }), 409);
    await q('INSERT INTO cierres_mes (sucursal_id, periodo, resumen) VALUES ($1, $2, $3::jsonb)', [s, periodo, '{}']);
    await rechaza(J.pagarHoras(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, semana: dia12 } }), 409); // el mes de la fecha de pago está cerrado
    await q('DELETE FROM cierres_mes WHERE sucursal_id = $1', [s]);
    const pago3 = await J.pagarHoras(c, { sucursalId: s, adminId: admin, body: { usuarioId: u.id, semana: dia12, fecha: hoy, cuentaDineroId: (await A.cuentaDineroPorClave(q, s, 'banco')).id } });
    assert.equal(pago3.monto, 50); /* una hora, con la tarifa que regía ese día ($50), no la nueva ($60) */ assert.equal(pago3.cuentaDinero, 'Banco (tarjeta y transferencia)');

    // 14. Otra sucursal no ve ni paga a esta persona.
    const { rows: [otraSuc] } = await q("INSERT INTO sucursales (nombre, prefijo_folio) VALUES ('Sucursal ajena prueba', 'ZZ') RETURNING id");
    await rechaza(J.pagarHoras(c, { sucursalId: otraSuc.id, adminId: admin, body: { usuarioId: u.id, semana: dia10 } }), 404);
    await rechaza(J.corregirJornada(c, { sucursalId: otraSuc.id, adminId: admin, id: man.id, body: { motivo: 'x' } }), 404);
    assert.equal((await J.semanaAdmin(q, otraSuc.id, dia10)).personas.length, 0);

    console.log('PASS: jornadas — entrada idempotente y única, pausas Salir/Regresar, minuto completo ($379.17), vencidas y pausa larga por revisar, correcciones con motivo y auditoría, manual sin empalmes, tarifa con historial, semana domingo-sábado, pago como egreso en Sueldos y salarios desde Caja sin turno (caja −200, utilidad −200, corte intacto), sin doble pago, anular egreso libera horas, mes cerrado y otra sucursal rechazados.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
