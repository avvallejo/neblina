import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../src/api/http.js';

const response = (status, data, retry = null) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: name => name === 'Retry-After' ? retry : null },
  text: async () => typeof data === 'string' ? data : JSON.stringify(data),
});
test('comparte lecturas simultáneas pero vuelve a consultar después de terminar', async () => {
  let finish, calls = 0;
  const request = createHttpClient({ fetchImpl: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = request('/api/materias', { headers: { Authorization: 'Bearer uno', 'X-Sucursal-Id': 'sede' } });
  const second = request('/api/materias', { headers: { Authorization: 'Bearer uno', 'X-Sucursal-Id': 'sede' } });
  assert.equal(calls, 1);
  finish(response(200, [{ stock: 1 }]));
  assert.deepEqual(await first, await second);
  const afterPurchase = request('/api/materias');
  assert.equal(calls, 2);
  finish(response(200, [{ stock: 5 }]));
  assert.deepEqual(await afterPurchase, [{ stock: 5 }]);
});
test('no mezcla lecturas de sucursales o sesiones diferentes', async () => {
  let calls = 0;
  const request = createHttpClient({ fetchImpl: async () => response(200, ++calls) });
  const results = await Promise.all([
    request('/api/materias', { headers: { Authorization: 'uno', 'X-Sucursal-Id': 'a' } }),
    request('/api/materias', { headers: { Authorization: 'uno', 'X-Sucursal-Id': 'b' } }),
    request('/api/materias', { headers: { Authorization: 'dos', 'X-Sucursal-Id': 'b' } }),
  ]);
  assert.deepEqual(results, [1, 2, 3]);
});
test('un 429 pausa las lecturas hasta Retry-After, sin bombardear el servidor', async () => {
  let clock = 0, calls = 0;
  const request = createHttpClient({ now: () => clock, fetchImpl: async () => ++calls === 1 ? response(429, 'Too many requests', '30') : response(200, []) });
  await assert.rejects(request('/api/reportes'), e => e.status === 429 && e.retryAfterSeconds === 30 && /30 segundos/.test(e.message));
  clock = 10000;
  await assert.rejects(request('/api/usuarios'), e => e.status === 429 && e.retryAfterSeconds === 20);
  assert.equal(calls, 1);
  clock = 30000;
  assert.deepEqual(await request('/api/usuarios'), []);
  assert.equal(calls, 2);
});
test('interpreta Retry-After en fecha y usa un minuto si no es válido', async () => {
  for (const [header, expected] of [[new Date(90000).toUTCString(), 90], [null, 60], ['incorrecto', 60]]) {
    const request = createHttpClient({ now: () => 0, fetchImpl: async () => response(429, {}, header) });
    await assert.rejects(request('/api/usuarios'), e => e.retryAfterSeconds === expected);
  }
});
test('un bloqueo de login no impide consultar la carta ni repite automáticamente el PIN', async () => {
  let calls = 0;
  const request = createHttpClient({ fetchImpl: async (_, options) => {
    calls++;
    return options.method === 'POST' ? response(429, { error: 'Demasiados intentos de acceso.' }, '900') : response(200, []);
  } });
  await assert.rejects(request('/api/auth/login', { method: 'POST' }), e => e.retryAfterSeconds === 900);
  await assert.rejects(request('/api/auth/login', { method: 'POST' }), e => e.status === 429);
  await request('/api/productos');
  assert.equal(calls, 2);
});
test('los cobros no se fusionan ni se repiten ante una respuesta incierta', async () => {
  let calls = 0;
  const request = createHttpClient({ fetchImpl: async () => { calls++; throw new Error('Sin conexión'); } });
  await Promise.all([
    assert.rejects(request('/api/pedidos', { method: 'POST', body: 'uno' }), /Sin conexión/),
    assert.rejects(request('/api/pedidos', { method: 'POST', body: 'dos' }), /Sin conexión/),
  ]);
  assert.equal(calls, 2);
});
test('conserva los detalles de validación y libera una lectura fallida para reintentar', async () => {
  let calls = 0;
  const request = createHttpClient({ fetchImpl: async () => ++calls === 1 ? response(409, { error: 'Cambió el pedido', details: { total: 20 } }) : response(200, []) });
  await assert.rejects(request('/api/pedidos'), e => e.status === 409 && e.details.total === 20 && e.message === 'Cambió el pedido');
  assert.deepEqual(await request('/api/pedidos'), []);
});
