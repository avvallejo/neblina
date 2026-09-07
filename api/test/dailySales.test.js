const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDate } = require('../src/services/dailySales');

test('daily reports accept calendar dates and default to today', () => {
  assert.equal(validateDate(undefined), null);
  assert.equal(validateDate(''), null);
  assert.equal(validateDate('2024-02-29'), '2024-02-29');
});
test('daily reports reject invalid dates and query arrays', () => {
  for (const value of ['2026-02-29', '2026-09-31', 'ayer', ['2026-09-06'], '2026-13-01']) {
    assert.throws(() => validateDate(value), error => error.status === 400);
  }
});
