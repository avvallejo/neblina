const test = require('node:test');
const assert = require('node:assert/strict');

// Las funciones de cálculo no tocan la base: se prueban sin conexión.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'prueba';
const J = require('../src/services/jornadas');

const t = (s) => new Date(`2026-10-20T${s}-06:00`);

test('minutos completos: se descartan los segundos en cada extremo', () => {
  assert.equal(J.minutosEntre(t('08:02:45'), t('14:22:10')), 380);
  assert.equal(J.minutosEntre(t('08:02:00'), t('08:02:59')), 0);
  assert.equal(J.minutosEntre(t('08:02:59'), t('08:03:00')), 1);
  assert.equal(J.minutosEntre(t('10:00:00'), t('09:00:00')), 0, 'nunca negativo');
});

test('la suma de tramos coincide con el total (sin minutos fantasma)', () => {
  const total = J.minutosEntre(t('08:00:30'), t('16:00:10'));
  const tramos = J.minutosEntre(t('08:00:30'), t('12:00:50')) + J.minutosEntre(t('12:00:50'), t('16:00:10'));
  assert.equal(total, tramos);
});

test('monto a centavos: 455 min × $50/h = $379.17', () => {
  assert.equal(J.montoPorMinutos(455, 50), 379.17);
  assert.equal(J.montoPorMinutos(60, 42.5), 42.5);
  assert.equal(J.montoPorMinutos(1, 60), 1);
  assert.equal(J.montoPorMinutos(0, 50), 0);
  assert.equal(J.montoPorMinutos(7, 35.33), 4.12); // 7 × 3533 ÷ 60 = 412.2 centavos
});

test('jornada: pagable = entrada a salida − pausa, y la pausa nunca excede la jornada', () => {
  const r = J.calcularJornada({ entrada: t('08:00:00'), salida: t('16:30:20'), minutosPausa: 45, tarifaHora: 48 });
  assert.deepEqual(r, { minutosTotales: 510, minutosPausa: 45, minutosPagables: 465, monto: 372 });
  const larga = J.calcularJornada({ entrada: t('08:00:00'), salida: t('09:00:00'), minutosPausa: 500, tarifaHora: 48 });
  assert.equal(larga.minutosPagables, 0); assert.equal(larga.monto, 0);
});

test('la semana de pago va de domingo a sábado', () => {
  // 2026-10-20 es martes.
  assert.deepEqual(J.semanaDe('2026-10-20'), { desde: '2026-10-18', hasta: '2026-10-24' });
  assert.deepEqual(J.semanaDe('2026-10-18'), { desde: '2026-10-18', hasta: '2026-10-24' }, 'el domingo abre la semana');
  assert.deepEqual(J.semanaDe('2026-10-24'), { desde: '2026-10-18', hasta: '2026-10-24' }, 'el sábado la cierra');
  assert.deepEqual(J.semanaDe('2026-11-01'), { desde: '2026-11-01', hasta: '2026-11-07' });
  assert.deepEqual(J.semanaDe('2026-12-31'), { desde: '2026-12-27', hasta: '2027-01-02' }, 'cruza de año');
  assert.throws(() => J.semanaDe('no-es-fecha'));
});

test('sumarDias cruza meses', () => {
  assert.equal(J.sumarDias('2026-10-31', 1), '2026-11-01');
  assert.equal(J.sumarDias('2026-03-01', -1), '2026-02-28');
});

test('revisión: tope de la jornada y pausa demasiado larga', () => {
  assert.equal(J.motivoRevision({ minutosTotales: 8 * 60, pausas: [30] }), null);
  assert.match(J.motivoRevision({ minutosTotales: 13 * 60, pausas: [] }), /12 horas/);
  assert.match(J.motivoRevision({ minutosTotales: 8 * 60, pausas: [30, 150] }), /pausa/i);
  assert.equal(J.motivoRevision({ minutosTotales: 12 * 60, pausas: [120] }), null, 'justo en el límite se acepta');
});

test('la fecha local usa la zona de la sede, no la del servidor', () => {
  assert.equal(J.fechaLocal('2026-10-21T03:30:00Z'), '2026-10-20'); // 21:30 del día 20 en la Ciudad de México
  assert.equal(J.fechaLocal('2026-10-21T06:00:00Z'), '2026-10-21');
});
