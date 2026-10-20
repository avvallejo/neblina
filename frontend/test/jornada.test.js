import test from 'node:test';
import assert from 'node:assert/strict';
import { minutosEntre, formatDuracion, semanaDomingo, sumarDias, rangoSemana, aInputLocal, vivoDe, diaCorto } from '../src/lib/jornada.js';

test('minutos completos: se descartan los segundos en cada extremo', () => {
  assert.equal(minutosEntre('2026-10-20T14:02:45Z', '2026-10-20T20:22:10Z'), 380);
  assert.equal(minutosEntre('2026-10-20T14:02:59Z', '2026-10-20T14:03:00Z'), 1);
  assert.equal(minutosEntre('2026-10-20T15:00:00Z', '2026-10-20T14:00:00Z'), 0);
});

test('duración legible', () => {
  assert.equal(formatDuracion(0), '0 min');
  assert.equal(formatDuracion(45), '45 min');
  assert.equal(formatDuracion(60), '1 h 00 min');
  assert.equal(formatDuracion(455), '7 h 35 min');
});

test('la semana de pago va de domingo a sábado', () => {
  assert.deepEqual(semanaDomingo('2026-10-20'), { desde: '2026-10-18', hasta: '2026-10-24' });
  assert.deepEqual(semanaDomingo('2026-10-18'), { desde: '2026-10-18', hasta: '2026-10-24' });
  assert.deepEqual(semanaDomingo('2026-10-24'), { desde: '2026-10-18', hasta: '2026-10-24' });
  assert.deepEqual(semanaDomingo('2026-12-31'), { desde: '2026-12-27', hasta: '2027-01-02' });
  assert.equal(sumarDias('2026-10-31', 1), '2026-11-01');
});

test('rango de la semana en español, con y sin cruce de mes', () => {
  assert.match(rangoSemana({ desde: '2026-10-18', hasta: '2026-10-24' }), /^18 – 24 oct 2026$/);
  assert.match(rangoSemana({ desde: '2026-09-27', hasta: '2026-10-03' }), /^27 sep – 3 oct 2026$/);
  assert.match(diaCorto('2026-10-20'), /mar.*20.*oct/);
});

test('datetime-local en hora de la Ciudad de México', () => {
  assert.equal(aInputLocal('2026-10-20T14:30:00Z'), '2026-10-20T08:30');
  assert.equal(aInputLocal('2026-10-21T03:05:00Z'), '2026-10-20T21:05');
  assert.equal(aInputLocal(null), '');
});

test('avance en vivo: suma minutos mientras corre y se detiene en pausa', () => {
  const t0 = Date.parse('2026-10-20T14:00:00Z');
  const estado = { ahora: '2026-10-20T14:00:00Z', tarifaHora: 60, enPausa: false, jornada: { minutosPagables: 120, tarifaHora: 60, pausaDesde: null } };
  assert.deepEqual(vivoDe(estado, t0, t0), { minutos: 120, minutosPausa: 0, monto: 120 });
  assert.equal(vivoDe(estado, t0 + 5 * 60000, t0).minutos, 125);
  assert.equal(vivoDe(estado, t0 + 5 * 60000, t0).monto, 125);
  const pausa = { ...estado, enPausa: true, jornada: { ...estado.jornada, pausaDesde: '2026-10-20T13:50:00Z' } };
  const v = vivoDe(pausa, t0 + 5 * 60000, t0);
  assert.equal(v.minutos, 120); assert.equal(v.minutosPausa, 15);
  assert.deepEqual(vivoDe({ ahora: '2026-10-20T14:00:00Z', jornada: null }, t0, t0), { minutos: 0, monto: 0, minutosPausa: 0 });
});
