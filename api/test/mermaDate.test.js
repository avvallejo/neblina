const test = require('node:test');
const assert = require('node:assert/strict');
const { mermaDate } = require('../src/services/mermaDate');
const now = new Date('2026-10-11T03:00:00Z'); // Todavía es 10 de octubre en México.
test('mermas usan fecha local y permiten capturar dos meses anteriores como admin', () => {
  assert.equal(mermaDate(undefined, 'barista', now), '2026-10-10');
  assert.equal(mermaDate('2026-08-01', 'admin', now), '2026-08-01');
  assert.equal(mermaDate('2026-09-30', 'admin', now), '2026-09-30');
});
test('mermas rechazan fechas futuras e inválidas', () => {
  for (const date of ['2026-10-11', '2026-02-30', ['2026-09-30'], null]) {
    assert.throws(() => mermaDate(date, 'admin', now), e => e.status === 400);
  }
});
test('solo admin puede retrofechar; barista y mostrador conservan captura del día', () => {
  for (const role of ['barista', 'mostrador']) {
    assert.throws(() => mermaDate('2026-09-30', role, now), e => e.status === 403);
    assert.equal(mermaDate('2026-10-10', role, now), '2026-10-10');
  }
});
