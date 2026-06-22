/* Integration smoke test for a disposable/local database. It creates tagged
 * principals, verifies the fixed HTTP boundaries, and removes its data. */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, pool } = require('../src/db');

const base = 'http://127.0.0.1:3000/api';
const marker = `codex-security-${Date.now()}`;
const createdOrders = [];
let customerId = null;
let customerWasCreated = false;
let originalReward = false;
let tempAdminId;
let tempCashierId;
let tempBaristaId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(route, { token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: response.status, data, headers: response.headers };
}

function staffToken(user) {
  return jwt.sign(
    { tipo: 'staff', id: user.id, nombre: user.nombre, rol: user.rol, ver: user.token_version },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
}

async function createTempStaff(name, role, pin) {
  const result = await query(
    'INSERT INTO usuarios (nombre, rol, pin_hash) VALUES ($1,$2,$3) RETURNING id, nombre, rol, token_version',
    [`${marker}-${name}`, role, await bcrypt.hash(pin, 4)]
  );
  return result.rows[0];
}

async function cleanup() {
  await query("UPDATE configuracion SET valor = 'true'::jsonb, actualizado_en = now() WHERE clave = 'sms_verificacion'");
  if (customerId) await query('UPDATE clientes SET recompensa_pendiente = $1 WHERE id = $2', [originalReward, customerId]);
  if (createdOrders.length) await query('DELETE FROM pedidos WHERE id = ANY($1::uuid[])', [createdOrders]);
  await query('DELETE FROM lotes_sincronizacion WHERE dispositivo = $1', [marker]);
  if (tempCashierId) {
    await query('DELETE FROM aprobaciones_descuento WHERE solicitante_id = $1 OR autorizador_id = $1', [tempCashierId]);
    await query('DELETE FROM intentos_autorizacion_descuento WHERE solicitante_id = $1', [tempCashierId]);
  }
  if (tempAdminId) await query('DELETE FROM aprobaciones_descuento WHERE autorizador_id = $1', [tempAdminId]);
  const staffIds = [tempAdminId, tempCashierId, tempBaristaId].filter(Boolean);
  if (staffIds.length) await query('DELETE FROM usuarios WHERE id = ANY($1::uuid[])', [staffIds]);
  if (customerWasCreated && customerId) await query('DELETE FROM clientes WHERE id = $1', [customerId]);
}

async function main() {
  const health = await request('/../health');
  assert(health.status === 200, `health esperado 200, recibido ${health.status}`);

  const admin = await createTempStaff('admin', 'admin', '5831');
  tempAdminId = admin.id;
  const cashier = await createTempStaff('cashier', 'cajero', '6842');
  tempCashierId = cashier.id;
  const barista = await createTempStaff('barista', 'barista', '7953');
  tempBaristaId = barista.id;
  const adminToken = staffToken(admin);
  const cashierToken = staffToken(cashier);
  const baristaToken = staffToken(barista);

  const productResult = await query("SELECT id FROM productos WHERE nombre = 'Galletas' AND activo = true LIMIT 1");
  const sizeResult = await query('SELECT id FROM opciones_tamano ORDER BY id LIMIT 1');
  const milkResult = await query("SELECT id FROM opciones_leche WHERE activo = true ORDER BY id LIMIT 1");
  const coffeeResult = await query("SELECT id FROM opciones_cafe WHERE activo = true ORDER BY id LIMIT 1");
  const rewardProductResult = await query(
    `SELECT p.id, p.permite_tamanos, p.permite_leche, p.permite_tipo_cafe
     FROM promocion_fidelidad pf JOIN productos p ON p.id = pf.producto_premio_id
     WHERE pf.activo = true AND p.activo = true ORDER BY pf.actualizado_en DESC LIMIT 1`
  );
  assert(productResult.rows[0] && sizeResult.rows[0], 'Faltan producto/opción de la semilla de desarrollo.');
  const productoId = productResult.rows[0].id;
  const sizeId = sizeResult.rows[0].id;
  const rewardProduct = rewardProductResult.rows[0];
  assert(rewardProduct, 'Falta una recompensa activa para la prueba positiva.');
  const rewardItem = {
    productoId: rewardProduct.id,
    cantidad: 1,
    esRegalo: true,
    ...(rewardProduct.permite_tamanos ? { tamanoId: sizeId } : {}),
    ...(rewardProduct.permite_leche ? { lecheId: milkResult.rows[0]?.id } : {}),
    ...(rewardProduct.permite_tipo_cafe ? { cafeId: coffeeResult.rows[0]?.id } : {}),
  };

  let customer = (await query('SELECT id, telefono, recompensa_pendiente FROM clientes ORDER BY creado_en LIMIT 1')).rows[0];
  if (!customer) {
    customer = (await query(
      "INSERT INTO clientes (nombre, apellido, telefono, telefono_verificado) VALUES ('Security','Smoke','9999999999',true) RETURNING id, telefono, recompensa_pendiente"
    )).rows[0];
    customerWasCreated = true;
  }
  customerId = customer.id;
  originalReward = customer.recompensa_pendiente;
  await query('UPDATE clientes SET recompensa_pendiente = false WHERE id = $1', [customerId]);
  const customerToken = jwt.sign({ tipo: 'cliente', id: customerId, telefono: customer.telefono }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const syncIds = {
    invalidGift: crypto.randomUUID(),
    invalidOption: crypto.randomUUID(),
    validGift: crypto.randomUUID(),
    validGiftItem: crypto.randomUUID(),
  };

  const paidByBarista = await request('/pedidos', {
    token: baristaToken,
    body: { items: [{ productoId, cantidad: 1 }], pago: { metodoPago: 'efectivo', montoRecibido: 30 } },
  });
  assert(paidByBarista.status === 403, `pago de barista esperado 403, recibido ${paidByBarista.status}`);

  await query("UPDATE configuracion SET valor = 'false'::jsonb WHERE clave = 'sms_verificacion'");
  const existingPhone = await request('/auth/cliente/registro', {
    body: { telefono: customer.telefono, nombre: 'Attacker', apellido: 'Attempt' },
  });
  assert(existingPhone.status === 409 && !existingPhone.data?.token, `registro existente esperado 409 sin token, recibido ${existingPhone.status}`);
  await query("UPDATE configuracion SET valor = 'true'::jsonb WHERE clave = 'sms_verificacion'");

  const arbitraryGift = await request('/pedidos', {
    token: customerToken,
    body: { items: [{ productoId, cantidad: 1, esRegalo: true }] },
  });
  assert(arbitraryGift.status === 409, `regalo sin derecho esperado 409, recibido ${arbitraryGift.status}`);

  const invalidOption = await request('/pedidos', {
    token: customerToken,
    body: { items: [{ productoId, tamanoId: sizeId, cantidad: 1 }] },
  });
  assert(invalidOption.status === 400, `opción incompatible esperada 400, recibido ${invalidOption.status}`);

  const syncGift = await request('/sync/batch', {
    token: customerToken,
    body: { dispositivo: marker, operaciones: [{ tipo: 'crear_pedido', clientUuid: syncIds.invalidGift, payload: { items: [{ productoId, cantidad: 1, esRegalo: true }] } }] },
  });
  assert(syncGift.status === 200 && syncGift.data.resultados[0].estado === 'error', 'sync debía rechazar el regalo sin derecho.');

  const syncOption = await request('/sync/batch', {
    token: customerToken,
    body: { dispositivo: marker, operaciones: [{ tipo: 'crear_pedido', clientUuid: syncIds.invalidOption, payload: { items: [{ productoId, tamanoId: sizeId, cantidad: 1 }] } }] },
  });
  assert(syncOption.status === 200 && syncOption.data.resultados[0].estado === 'error', 'sync debía rechazar la opción incompatible.');

  await query('UPDATE clientes SET recompensa_pendiente = true WHERE id = $1', [customerId]);
  const validGift = await request('/pedidos', { token: customerToken, body: { items: [rewardItem] } });
  assert(validGift.status === 201 && Number(validGift.data.pedido.total) === 0, `recompensa válida esperada 201/0, recibido ${validGift.status}`);
  createdOrders.push(validGift.data.pedido.id);
  let rewardState = await query('SELECT recompensa_pendiente FROM clientes WHERE id = $1', [customerId]);
  assert(rewardState.rows[0].recompensa_pendiente === false, 'La recompensa normal debía consumirse.');

  await query('UPDATE clientes SET recompensa_pendiente = true WHERE id = $1', [customerId]);
  const validSyncGift = await request('/sync/batch', {
    token: customerToken,
    body: { dispositivo: marker, operaciones: [{ tipo: 'crear_pedido', clientUuid: syncIds.validGift, payload: { items: [{ ...rewardItem, clientUuid: syncIds.validGiftItem }] } }] },
  });
  assert(
    validSyncGift.status === 200 && validSyncGift.data.resultados[0].estado === 'creado',
    `La recompensa offline legítima debía crearse: ${JSON.stringify(validSyncGift.data)}`
  );
  createdOrders.push(validSyncGift.data.resultados[0].servidorId);
  rewardState = await query('SELECT recompensa_pendiente FROM clientes WHERE id = $1', [customerId]);
  assert(rewardState.rows[0].recompensa_pendiente === false, 'La recompensa offline debía consumirse.');

  const approval = await request('/pedidos/aprobaciones-descuento', {
    token: cashierToken,
    body: { pin: '5831', descuentoPorcentaje: 10 },
  });
  assert(approval.status === 201 && approval.data.token, `autorización esperada 201, recibido ${approval.status}`);

  const discounted = await request('/pedidos', {
    token: cashierToken,
    body: { items: [{ productoId, cantidad: 1 }], descuentoPorcentaje: 10, autorizacionDescuento: approval.data.token },
  });
  assert(discounted.status === 201, `pedido autorizado esperado 201, recibido ${discounted.status}`);
  createdOrders.push(discounted.data.pedido.id);

  const replay = await request('/pedidos', {
    token: cashierToken,
    body: { items: [{ productoId, cantidad: 1 }], descuentoPorcentaje: 10, autorizacionDescuento: approval.data.token },
  });
  assert(replay.status === 401, `reutilización esperada 401, recibido ${replay.status}`);

  const legacyPin = await request('/pedidos', {
    token: cashierToken,
    body: { items: [{ productoId, cantidad: 1 }], descuentoPorcentaje: 10, pinAutorizacion: '5831' },
  });
  assert(legacyPin.status === 400, `PIN dentro del pedido esperado 400, recibido ${legacyPin.status}`);

  await query('UPDATE usuarios SET token_version = token_version + 1 WHERE id = $1', [admin.id]);
  const stale = await request('/usuarios', { token: adminToken });
  assert(stale.status === 401, `JWT revocado esperado 401, recibido ${stale.status}`);

  const firstIp = await request('/../health', { headers: { 'x-forwarded-for': '198.51.100.10' } });
  const secondIp = await request('/../health', { headers: { 'x-forwarded-for': '198.51.100.11' } });
  assert(firstIp.headers.get('ratelimit-remaining') === secondIp.headers.get('ratelimit-remaining'), 'Clientes distintos deben tener contadores independientes.');

  console.log('LIVE_SECURITY_SMOKE_OK: 13 límites HTTP/DB y flujos legítimos verificados; datos temporales limpiados.');
}

main()
  .then(cleanup)
  .catch(async err => {
    console.error(err.message);
    try { await cleanup(); } catch (cleanupErr) { console.error(`Cleanup falló: ${cleanupErr.message}`); }
    process.exitCode = 1;
  })
  .finally(() => pool.end());
