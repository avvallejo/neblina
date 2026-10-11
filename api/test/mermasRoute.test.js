const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const handlers = {};
const calls = [];
let closed = false;
const query = async (sql, params) => {
  calls.push({ sql, params });
  return { rows: sql.includes('INSERT') ? [{ id: 'saved', fecha_contable: params[8] }] : [] };
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/routes/mermas.js')) {
    if (request === 'express') return { Router: () => ({ use() {}, post(path, fn) { handlers.post = fn; }, get(path, fn) { handlers.get = fn; } }) };
    if (request === '../db') return { query, withTransaction: fn => fn({ query }) };
    if (request === '../services/stockAdjustmentHistory') return { mesesAbiertos: async () => { if (closed) throw new Error('Mes cerrado'); } };
    if (request === '../middleware/auth') return { requireAuth() {}, requireRole() {}, resolveSucursal() {} };
    if (request === '../utils/asyncHandler') return { ...originalLoad.apply(this, arguments), asyncHandler: fn => fn };
  }
  return originalLoad.apply(this, arguments);
};
require('../src/routes/mermas');
Module._load = originalLoad;
const req = () => ({ auth: { rol: 'admin', id: 'admin' }, sucursalId: 'sede', body: { materiaPrimaId: 'leche', cantidad: 0.125, unidad: 'l', motivo: 'Derrame', fechaContable: '2020-08-31' } });
const res = { status() { return this; }, json(value) { return value; } };
test('merma independiente guarda fecha histórica, usuario y sede sin comanda', async () => {
  calls.length = 0;
  await handlers.post(req(), res);
  assert.deepEqual(calls[0].params, ['leche', 0.125, 'l', 'Derrame', null, 'admin', null, 'sede', '2020-08-31']);
});
test('mes cerrado impide insertar la merma y descontar inventario', async () => {
  calls.length = 0; closed = true;
  try { await assert.rejects(handlers.post(req(), res), /Mes cerrado/); assert.equal(calls.length, 0); }
  finally { closed = false; }
});
test('cantidad inválida se rechaza antes de tocar inventario', async () => {
  for (const cantidad of [0, -1, 'abc', 0.0001]) {
    calls.length = 0;
    await assert.rejects(handlers.post({ ...req(), body: { ...req().body, cantidad } }, res), e => e.status === 400);
    assert.equal(calls.length, 0);
  }
});
test('historial filtra por sucursal y rango, y rechaza un rango invertido', async () => {
  calls.length = 0;
  await handlers.get({ sucursalId: 'sede', query: { desde: '2020-08-01', hasta: '2020-09-30' } }, res);
  assert.deepEqual(calls[0].params, ['sede', '2020-08-01', '2020-09-30']);
  await assert.rejects(handlers.get({ sucursalId: 'sede', query: { desde: '2020-09-30', hasta: '2020-08-01' } }, res), e => e.status === 400);
});
