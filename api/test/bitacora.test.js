const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'prueba';
const { sanitizar } = require('../src/services/bitacora');
const { describirRuta, bitacoraAcciones, filaDeBitacora } = require('../src/middleware/bitacora');

test('sanitizar oculta PIN, contraseñas y tokens, y acota textos largos', () => {
  const salida = sanitizar({ nombre: 'Ana', pin: '1234', PIN_nuevo: '9999', contrasena: 'x', token: 'abc', nested: { authorization: 'Bearer z', ok: 1 },
    logo: 'a'.repeat(5000), lista: Array.from({ length: 30 }, (_, i) => i) });
  assert.equal(salida.nombre, 'Ana');
  assert.equal(salida.pin, '[oculto]'); assert.equal(salida.PIN_nuevo, '[oculto]');
  assert.equal(salida.contrasena, '[oculto]'); assert.equal(salida.token, '[oculto]');
  assert.deepEqual(salida.nested, { authorization: '[oculto]', ok: 1 });
  assert.equal(salida.logo, '[texto de 5000 caracteres]');
  assert.equal(salida.lista.length, 21); assert.equal(salida.lista[20], '[+10 más]');
  assert.equal(JSON.stringify(salida).includes('1234'), false);
});

test('sanitizar limita la profundidad y tolera null', () => {
  assert.equal(sanitizar(null), null);
  assert.equal(sanitizar(undefined), null);
  assert.deepEqual(sanitizar({ a: { b: { c: { d: 1 } } } }), { a: { b: { c: '[…]' } } });
});

test('describirRuta separa la entidad y la acción', () => {
  assert.deepEqual(describirRuta('/api/materias-primas/:id/ajustar-stock', 'POST'), { entidad: 'materias-primas', accion: 'ajustar-stock' });
  assert.deepEqual(describirRuta('/api/materias-primas', 'POST'), { entidad: 'materias-primas', accion: 'crear' });
  assert.deepEqual(describirRuta('/api/materias-primas/:id', 'PATCH'), { entidad: 'materias-primas', accion: 'editar' });
  assert.deepEqual(describirRuta('/api/contabilidad/egresos/:id/anular', 'POST'), { entidad: 'contabilidad', accion: 'egresos/anular' });
  assert.deepEqual(describirRuta('/api/usuarios/:id', 'DELETE'), { entidad: 'usuarios', accion: 'eliminar' });
});

function simular({ metodo = 'POST', auth, body = {}, status = 200, route = { path: '/:id/ajustar-stock' }, baseUrl = '/api/materias-primas', locals = {} }) {
  const llamadas = [];
  const middleware = bitacoraAcciones({ queryFn: async (sql, valores) => { llamadas.push(valores); }, onError: e => { throw e; } });
  const req = { method: metodo, auth, body, query: {}, params: { id: 'abc' }, route, baseUrl, originalUrl: `${baseUrl}/abc`, ip: '10.0.0.5', sucursalId: 'suc-1', get: () => 'jest' };
  const res = Object.assign(new EventEmitter(), { statusCode: status, locals });
  let siguiente = false;
  middleware(req, res, () => { siguiente = true; });
  res.emit('finish');
  return { llamadas, siguiente };
}

test('registra las escrituras del personal con usuario, sede, ruta y resultado', () => {
  const { llamadas, siguiente } = simular({ auth: { tipo: 'staff', id: 'u1', nombre: 'Ana', rol: 'admin', sucursalId: null }, body: { pin: '1234', cantidad: 5 } });
  assert.equal(siguiente, true);
  assert.equal(llamadas.length, 1);
  const f = llamadas[0];
  assert.equal(f[0], 'u1'); assert.equal(f[1], 'Ana'); assert.equal(f[2], 'admin'); assert.equal(f[3], 'suc-1');
  assert.equal(f[4], 'POST'); assert.equal(f[5], '/api/materias-primas/:id/ajustar-stock');
  assert.equal(f[6], 'materias-primas'); assert.equal(f[7], 'abc'); assert.equal(f[8], 'ajustar-stock'); assert.equal(f[9], 200);
  assert.equal(f[10], '10.0.0.5');
  assert.ok(!f[12].includes('1234')); assert.ok(f[12].includes('[oculto]'));
});

test('no registra lecturas, ni acciones de clientes sin sesión de personal', () => {
  assert.equal(simular({ metodo: 'GET', auth: { tipo: 'staff', id: 'u1' } }).llamadas.length, 0);
  assert.equal(simular({ auth: { tipo: 'cliente', id: 'c1' } }).llamadas.length, 0);
  assert.equal(simular({ auth: undefined }).llamadas.length, 0);
});

test('la entrada guarda quién entró (o el usuario elegido si falla) sin el PIN', () => {
  const login = { route: { path: '/login' }, baseUrl: '/api/auth' };
  const bien = simular({ ...login, body: { pin: '1234', usuarioId: '11111111-1111-4111-8111-111111111111' }, locals: { actorBitacora: { id: 'u9', nombre: 'Luis', rol: 'cajero', sucursalId: 's9' } } }).llamadas[0];
  assert.equal(bien[0], 'u9'); assert.equal(bien[1], 'Luis');
  const mal = simular({ ...login, status: 401, body: { pin: '0000', usuarioId: '11111111-1111-4111-8111-111111111111' } }).llamadas[0];
  assert.equal(mal[0], '11111111-1111-4111-8111-111111111111'); assert.equal(mal[9], 401);
  assert.ok(!mal[12].includes('0000'));
  const sinUsuario = simular({ ...login, status: 401, body: { pin: '0000', usuarioId: "x'; DROP TABLE usuarios;--" } }).llamadas[0];
  assert.equal(sinUsuario[0], null);
  assert.equal(simular({ route: { path: '/cliente/registro' }, baseUrl: '/api/auth', auth: undefined }).llamadas.length, 0);
});

test('rutas desconocidas se normalizan sin exponer ids', () => {
  const req = { method: 'POST', auth: { tipo: 'staff', id: 'u1' }, originalUrl: '/api/lo-que-sea/3fa85f64-5717-4562-b3fc-2c963f66afa6/x?y=1', params: {}, body: {}, query: {}, get: () => '' };
  const fila = filaDeBitacora(req, { statusCode: 404, locals: {} }, Date.now());
  assert.equal(fila[5], '/api/lo-que-sea/:id/x');
});

test('un fallo de la bitácora no rompe la petición', async () => {
  const errores = [];
  const middleware = bitacoraAcciones({ queryFn: async () => { throw new Error('base caída'); }, onError: e => errores.push(e.message) });
  const req = { method: 'POST', auth: { tipo: 'staff', id: 'u1' }, body: {}, query: {}, params: {}, route: { path: '/' }, baseUrl: '/api/mermas', originalUrl: '/api/mermas', get: () => '' };
  const res = Object.assign(new EventEmitter(), { statusCode: 201, locals: {} });
  middleware(req, res, () => {});
  res.emit('finish');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(errores, ['base caída']);
});
