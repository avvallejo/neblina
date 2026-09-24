/* Prueba HTTP (API corriendo en 127.0.0.1:3000 con la misma base y JWT_SECRET):
 * el cobro de Caja no se duplica por reintentos y avisa de pedidos idénticos.
 *   JWT_SECRET=... node test/live-cobro-duplicado.js */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { query, pool } = require('../src/db');

const base = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const creados = [];
let cajero = null;

async function post(token, sede, body) {
  const r = await fetch(`${base}/pedidos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-sucursal-id': sede },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (data && data.pedido && !creados.includes(data.pedido.id)) creados.push(data.pedido.id);
  return { status: r.status, data };
}

(async () => {
  try {
    const { rows: [sede] } = await query('SELECT id FROM sucursales WHERE activo ORDER BY creado_en LIMIT 1');
    const { rows: [prod] } = await query(
      `SELECT id, precio_base FROM productos WHERE sucursal_id = $1 AND activo AND NOT permite_tamanos AND COALESCE(estacion,'barra') <> 'caja' ORDER BY nombre LIMIT 1`, [sede.id]);
    assert.ok(prod, 'Se necesita un producto sin tamaños en la sede de pruebas.');
    ({ rows: [cajero] } = await query(
      `INSERT INTO usuarios (nombre, rol, pin_hash, sucursal_id) VALUES ('QA Duplicados', 'cajero', crypt('9753', gen_salt('bf')), $1) RETURNING id, nombre, rol, token_version`, [sede.id]));
    const token = jwt.sign({ tipo: 'staff', id: cajero.id, nombre: cajero.nombre, rol: cajero.rol, ver: cajero.token_version, suc: sede.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const nombre = `fredi-${Date.now()}`;
    const precio = Number(prod.precio_base);
    const cuerpo = extra => ({
      items: [{ productoId: prod.id, cantidad: 2 }], destino: 'llevar', nombreTicket: nombre,
      pago: { metodoPago: 'efectivo', montoRecibido: precio * 2 + 100 }, ...extra,
    });

    // 1) Primer cobro.
    const u1 = crypto.randomUUID();
    const a = await post(token, sede.id, cuerpo({ clientUuid: u1 }));
    assert.equal(a.status, 201, JSON.stringify(a.data));
    // 2) Se perdió la respuesta y se vuelve a tocar Cobrar: mismo pedido.
    const b = await post(token, sede.id, cuerpo({ clientUuid: u1 }));
    assert.equal(b.status, 200); assert.equal(b.data.yaExistia, true); assert.equal(b.data.pedido.folio, a.data.pedido.folio);
    const { rows: [n1] } = await query('SELECT COUNT(*)::int AS n FROM pedidos WHERE client_uuid = $1', [u1]);
    assert.equal(n1.n, 1);
    // 3) Otro intento (clave nueva) idéntico: aviso de posible duplicado, no se crea.
    const u2 = crypto.randomUUID();
    const c = await post(token, sede.id, cuerpo({ clientUuid: u2 }));
    assert.equal(c.status, 409); assert.equal(c.data.details.codigo, 'posible_duplicado'); assert.equal(c.data.details.folio, a.data.pedido.folio);
    const { rows: [n2] } = await query('SELECT COUNT(*)::int AS n FROM pedidos WHERE client_uuid = $1', [u2]);
    assert.equal(n2.n, 0);
    // 4) "Sí, es otro pedido": se registra.
    const d = await post(token, sede.id, cuerpo({ clientUuid: u2, confirmarDuplicado: true }));
    assert.equal(d.status, 201); assert.notEqual(d.data.pedido.folio, a.data.pedido.folio);
    // 5) Mismo pedido para OTRA persona: sin aviso.
    const e = await post(token, sede.id, { ...cuerpo({ clientUuid: crypto.randomUUID() }), nombreTicket: `${nombre}-otro` });
    assert.equal(e.status, 201);
    // 6) Dos reintentos simultáneos con la misma clave: un solo pedido.
    const u4 = crypto.randomUUID();
    const cuerpo4 = { ...cuerpo({ clientUuid: u4 }), nombreTicket: `${nombre}-simultaneo` };
    const [f, g] = await Promise.all([post(token, sede.id, cuerpo4), post(token, sede.id, cuerpo4)]);
    assert.deepEqual([f.status, g.status].sort(), [200, 201]);
    assert.equal(f.data.pedido.folio, g.data.pedido.folio);
    // 7) Sin clave (versiones anteriores de la app) sigue funcionando.
    const h = await post(token, sede.id, { ...cuerpo({}), nombreTicket: `${nombre}-sin-clave` });
    assert.equal(h.status, 201);
    console.log('PASS: reintento con la misma clave devuelve el mismo pedido (también simultáneo), pedido idéntico reciente pide confirmación, confirmado se registra, otro nombre o sin clave no se bloquean.');
  } finally {
    if (creados.length) await query('DELETE FROM pedidos WHERE id = ANY($1::uuid[])', [creados]).catch(e => console.warn('limpieza:', e.message));
    if (cajero) await query('DELETE FROM usuarios WHERE id = $1', [cajero.id]).catch(e => console.warn('limpieza:', e.message));
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
