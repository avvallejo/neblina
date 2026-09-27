import test from 'node:test';
import assert from 'node:assert/strict';
import { startPolling } from '../src/lib/polling.js';

function environment(hidden = false) {
  const listeners = new Set(), timers = new Map();
  let id = 0;
  const page = {
    hidden,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  };
  return {
    page, timers, listeners,
    schedule: (fn, delay) => { timers.set(++id, { fn, delay }); return id; },
    cancel: id => timers.delete(id),
    visibility: hidden => { page.hidden = hidden; listeners.forEach(fn => fn()); },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('no solapa consultas lentas y espera desde que termina la anterior', async () => {
  const env = environment();
  let finish, calls = 0;
  const stop = startPolling(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, 30000, env);
  env.visibility(false);
  assert.equal(calls, 1);
  assert.equal(env.timers.size, 0);
  finish(); await flush();
  assert.equal(env.timers.size, 1);
  assert.equal([...env.timers.values()][0].delay, 30000);
  stop();
  assert.equal(env.timers.size, 0);
  assert.equal(env.listeners.size, 0);
});
test('una pestaña oculta no consulta; al volver se actualiza una sola vez', async () => {
  const env = environment(true);
  let calls = 0;
  const stop = startPolling(async () => { calls++; }, 5000, env);
  assert.equal(calls, 0);
  env.visibility(false); await flush();
  assert.equal(calls, 1);
  env.visibility(true);
  assert.equal(env.timers.size, 0);
  env.visibility(false); await flush();
  assert.equal(calls, 2);
  stop();
});
test('desmontar durante una consulta no vuelve a programar actualizaciones', async () => {
  const env = environment();
  let finish;
  const stop = startPolling(() => new Promise(resolve => { finish = resolve; }), 5000, env);
  stop(); finish(); await flush();
  assert.equal(env.timers.size, 0);
});
test('un error no detiene para siempre las siguientes actualizaciones', async () => {
  const env = environment();
  const stop = startPolling(async () => { throw new Error('429'); }, 5000, env);
  await flush();
  assert.equal(env.timers.size, 1);
  stop();
});
