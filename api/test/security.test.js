process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-for-production';

// Estas pruebas inyectan DB/JWT/bcrypt; no necesitan abrir sockets ni instalar
// dependencias para comprobar las políticas puras y sus límites de confianza.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function loadForSecurityTests(request, parent, isMain) {
  if (request === 'pg') {
    return { Pool: class Pool { on() {} query() { throw new Error('DB real no permitida en prueba unitaria'); } } };
  }
  if (request === 'bcryptjs') return { compare: async () => false };
  if (request === 'jsonwebtoken') return { verify: () => { throw new Error('Usa verifyToken inyectado'); } };
  return originalLoad.call(this, request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { calcularPrecioItem } = require('../src/utils/pricing');
const { prepareOrderLines } = require('../src/services/orderValidation');
const { createUnverifiedCustomer } = require('../src/services/customerRegistration');
const { consumeDiscountApproval, createDiscountApproval } = require('../src/services/discountApprovals');
const { assertStaffPin, assertPaymentAllowed, normalizeDiscount, parseTrustProxyHops } = require('../src/security/policies');
const { createRequireAuth } = require('../src/middleware/auth');
Module._load = originalLoad;

const apiRoot = path.resolve(__dirname, '..');
const repoRoot = process.env.TEST_REPO_ROOT || path.resolve(apiRoot, '..');

function product(overrides = {}) {
  return {
    id: 'product-1', nombre: 'Galletas', precio_base: 24,
    permite_tamanos: false, permite_leche: false,
    permite_tipo_cafe: false, permite_extras: false,
    ...overrides,
  };
}

test('pricing rejects a size for a product that does not allow sizes', async () => {
  const calls = [];
  const queryFn = async sql => {
    calls.push(sql);
    if (sql.includes('FROM productos')) return { rows: [product()] };
    throw new Error(`unexpected query: ${sql}`);
  };
  await assert.rejects(
    calcularPrecioItem({ productoId: 'product-1', tamanoId: 1 }, queryFn),
    err => err.status === 400 && /no permite elegir tamaño/.test(err.message)
  );
  assert.equal(calls.some(sql => sql.includes('opciones_tamano')), false);
});

test('pricing preserves a legitimate allowed size calculation', async () => {
  const queryFn = async sql => {
    if (sql.includes('FROM productos')) return { rows: [product({ permite_tamanos: true })] };
    if (sql.includes('fn_precio_efectivo')) return { rows: [{ precio: 24 }] };
    if (sql.includes('opciones_tamano')) return { rows: [{ delta_precio: -6 }] };
    throw new Error(`unexpected query: ${sql}`);
  };
  assert.equal(await calcularPrecioItem({ productoId: 'product-1', tamanoId: 1 }, queryFn), 18);
});

test('pricing rejects duplicate extras and inactive products', async () => {
  await assert.rejects(
    calcularPrecioItem({ productoId: 'product-1', extraIds: [1, 1] }, async () => ({ rows: [] })),
    err => err.status === 400 && /repetir/.test(err.message)
  );
  await assert.rejects(
    calcularPrecioItem({ productoId: 'missing' }, async () => ({ rows: [] })),
    err => err.status === 404
  );
});

function rewardClient({ pending = true, configuredProduct = 'product-1' } = {}) {
  let consumed = false;
  return {
    get consumed() { return consumed; },
    async query(sql) {
      if (sql.includes('FROM productos')) return { rows: [product()] };
      if (sql.includes('fn_precio_efectivo')) return { rows: [{ precio: 24 }] };
      if (sql.includes('SELECT recompensa_pendiente')) return { rows: [{ recompensa_pendiente: pending }] };
      if (sql.includes('FROM promocion_fidelidad')) return { rows: [{ activo: true, producto_premio_id: configuredProduct }] };
      if (sql.includes('UPDATE clientes SET recompensa_pendiente')) {
        consumed = true;
        return { rows: [{ id: 'customer-1' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('reward redemption is server-authorized and consumed atomically', async () => {
  const client = rewardClient();
  const result = await prepareOrderLines(client, [{ productoId: 'product-1', cantidad: 1, esRegalo: true }], 'customer-1');
  assert.equal(result.isRewardOrder, true);
  assert.equal(result.lines[0].precioUnitario, 0);
  assert.equal(client.consumed, true);
});

test('arbitrary or unavailable rewards are rejected before consumption', async () => {
  const wrongProduct = rewardClient({ configuredProduct: 'another-product' });
  await assert.rejects(
    prepareOrderLines(wrongProduct, [{ productoId: 'product-1', cantidad: 1, esRegalo: true }], 'customer-1'),
    err => err.status === 400 && /no es la recompensa/.test(err.message)
  );
  assert.equal(wrongProduct.consumed, false);

  const unavailable = rewardClient({ pending: false });
  await assert.rejects(
    prepareOrderLines(unavailable, [{ productoId: 'product-1', cantidad: 1, esRegalo: true }], 'customer-1'),
    err => err.status === 409
  );
  assert.equal(unavailable.consumed, false);
});

test('normal and offline order entrypoints use the same order validator', () => {
  const normal = fs.readFileSync(path.join(apiRoot, 'src/routes/pedidos.js'), 'utf8');
  const sync = fs.readFileSync(path.join(apiRoot, 'src/routes/sync.js'), 'utf8');
  assert.match(normal, /prepareOrderLines\(client, items, clienteId\)/);
  assert.match(sync, /prepareOrderLines\(client, items, clienteId\)/);
});

test('barista and customer principals cannot mark an order paid', () => {
  assert.throws(() => assertPaymentAllowed({ tipo: 'staff', rol: 'barista' }, { metodoPago: 'efectivo' }), err => err.status === 403);
  assert.throws(() => assertPaymentAllowed({ tipo: 'cliente' }, { metodoPago: 'efectivo' }), err => err.status === 403);
  assert.doesNotThrow(() => assertPaymentAllowed({ tipo: 'staff', rol: 'cajero' }, { metodoPago: 'efectivo' }));
  assert.doesNotThrow(() => assertPaymentAllowed({ tipo: 'staff', rol: 'barista' }, undefined));
  const normal = fs.readFileSync(path.join(apiRoot, 'src/routes/pedidos.js'), 'utf8');
  assert.match(normal, /assertPaymentAllowed\(req\.auth, pago\)/);
});

test('direct registration never authenticates an existing phone', async () => {
  await assert.rejects(
    createUnverifiedCustomer(
      { telefono: '9610000000', nombre: 'Victim', apellido: 'User' },
      async sql => sql.startsWith('SELECT') ? { rows: [{ id: 'victim' }] } : { rows: [] }
    ),
    err => err.status === 409 && /Verifícalo por SMS/.test(err.message)
  );
  const authRoute = fs.readFileSync(path.join(apiRoot, 'src/routes/auth.js'), 'utf8');
  assert.match(authRoute, /createUnverifiedCustomer\(\{ telefono, nombre, apellido \}\)/);
});

test('direct registration still creates a genuinely new unverified customer', async () => {
  const queryFn = async sql => sql.startsWith('SELECT')
    ? { rows: [] }
    : { rows: [{ id: 'new', telefono: '9610000001', nombre: 'New', apellido: 'User' }] };
  const customer = await createUnverifiedCustomer({ telefono: '9610000001', nombre: ' New ', apellido: ' User ' }, queryFn);
  assert.equal(customer.id, 'new');
});

function runMiddleware(middleware, req) {
  return new Promise(resolve => middleware(req, {}, err => resolve(err)));
}

test('stale staff JWT role and version are rejected', async () => {
  const middleware = createRequireAuth({
    verifyToken: () => ({ tipo: 'staff', id: 'u1', rol: 'admin', ver: 0 }),
    queryFn: async () => ({ rows: [{ id: 'u1', nombre: 'User', rol: 'cajero', activo: true, token_version: 1 }] }),
  });
  const err = await runMiddleware(middleware, { headers: { authorization: 'Bearer stale' } });
  assert.equal(err.status, 401);
  assert.match(err.message, /revocada/);
});

test('login issues a versioned token and security changes increment that version', () => {
  const authRoute = fs.readFileSync(path.join(apiRoot, 'src/routes/auth.js'), 'utf8');
  const usersRoute = fs.readFileSync(path.join(apiRoot, 'src/routes/usuarios.js'), 'utf8');
  assert.match(authRoute, /ver: encontrado\.token_version/);
  assert.match(usersRoute, /token_version = token_version \+ 1/);
});

test('current staff JWT uses the database role', async () => {
  const req = { headers: { authorization: 'Bearer current' } };
  const middleware = createRequireAuth({
    verifyToken: () => ({ tipo: 'staff', id: 'u1', rol: 'admin', ver: 2 }),
    queryFn: async () => ({ rows: [{ id: 'u1', nombre: 'User', rol: 'cajero', activo: true, token_version: 2 }] }),
  });
  assert.equal(await runMiddleware(middleware, req), undefined);
  assert.equal(req.auth.rol, 'cajero');
});

test('unknown JWT principal types are rejected', async () => {
  const middleware = createRequireAuth({ verifyToken: () => ({ tipo: 'service', id: 'x' }), queryFn: async () => ({ rows: [] }) });
  const err = await runMiddleware(middleware, { headers: { authorization: 'Bearer unknown' } });
  assert.equal(err.status, 401);
});

test('discount approval is single-use and bound to requester and percentage', async () => {
  let used = false;
  const client = {
    async query(sql, params) {
      assert.match(sql, /solicitante_id = \$2/);
      assert.deepEqual(params.slice(1), ['cashier-1', 10]);
      if (used) return { rows: [] };
      used = true;
      return { rows: [{ autorizador_id: 'admin-1' }] };
    },
  };
  assert.equal(await consumeDiscountApproval(client, { requesterId: 'cashier-1', token: 'one-time-token', discount: 10 }), 'admin-1');
  await assert.rejects(
    consumeDiscountApproval(client, { requesterId: 'cashier-1', token: 'one-time-token', discount: 10 }),
    err => err.status === 401
  );
  const route = fs.readFileSync(path.join(apiRoot, 'src/routes/pedidos.js'), 'utf8');
  assert.doesNotMatch(route, /bcrypt\.compare/);
  assert.match(route, /consumeDiscountApproval/);
});

test('discount PIN verification locks after five failed attempts', async () => {
  const queryFn = async sql => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
    if (sql.includes('COUNT(*)')) return { rows: [{ count: '5' }] };
    throw new Error('PIN comparison must not run after lockout');
  };
  await assert.rejects(
    createDiscountApproval({ requesterId: 'cashier-1', pin: '9999', discount: normalizeDiscount(10) }, queryFn),
    err => err.status === 429
  );
});

test('a failed discount PIN returns a committable denial after recording the attempt', async () => {
  let recorded = false;
  const queryFn = async sql => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
    if (sql.includes('COUNT(*)')) return { rows: [{ count: '0' }] };
    if (sql.includes("FROM usuarios WHERE rol = 'admin'")) return { rows: [{ id: 'admin', pin_hash: 'hash' }] };
    if (sql.includes('INSERT INTO intentos_autorizacion_descuento')) { recorded = true; return { rows: [] }; }
    throw new Error(`unexpected query: ${sql}`);
  };
  const result = await createDiscountApproval({ requesterId: 'cashier-1', pin: '9999', discount: 10 }, queryFn);
  assert.equal(recorded, true);
  assert.equal(result.denied, true);
});

test('proxy hop configuration fails closed and validates the topology', () => {
  assert.equal(parseTrustProxyHops('1', { required: true }), 1);
  assert.equal(parseTrustProxyHops('2', { required: true }), 2);
  assert.throws(() => parseTrustProxyHops(undefined, { required: true }), /TRUST_PROXY_HOPS/);
  assert.throws(() => parseTrustProxyHops('20'), /entre 1 y 3/);
});

test('production excludes demo credentials and defaults SMS verification on', () => {
  const production = fs.readFileSync(path.join(repoRoot, 'docker-compose.prod.yml'), 'utf8');
  const development = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const configMigration = fs.readFileSync(path.join(repoRoot, 'db/08_configuracion.sql'), 'utf8');
  assert.doesNotMatch(production, /\.\/db\/03_seed_data\.sql:/);
  assert.match(development, /\.\/db\/03_seed_data\.sql:/);
  assert.match(production, /\.\/db\/10_security_hardening\.sql:/);
  assert.match(development, /\.\/db\/10_security_hardening\.sql:/);
  assert.match(production, /TRUST_PROXY_HOPS: \$\{TRUST_PROXY_HOPS:-2\}/);
  assert.match(development, /TRUST_PROXY_HOPS: \$\{TRUST_PROXY_HOPS:-1\}/);
  assert.match(configMigration, /sms_verificacion', 'true'/);
});

test('staff management cannot reintroduce known demo PINs', () => {
  assert.throws(() => assertStaffPin('1234'), err => err.status === 400);
  assert.throws(() => assertStaffPin('7777'), err => err.status === 400);
  assert.equal(assertStaffPin('5831'), '5831');
});
