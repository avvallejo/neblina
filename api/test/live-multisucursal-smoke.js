/* Prueba de integración MULTI-SUCURSAL contra una base local/desechable.
 *
 * Verifica, con peticiones HTTP reales, las garantías que definen el diseño
 * multi-sucursal (PLAN_MULTISUCURSAL.md, fase 5):
 *   1.  Dos turnos abiertos a la vez — uno por sede.
 *   2.  Folios con el prefijo de su sede, sin chocar entre sedes.
 *   3.  El personal de una sede NO ve ni cobra pedidos de otra (404, sin
 *       filtrar existencia), aunque mande X-Sucursal-Id de la otra sede.
 *   4.  El PIN solo funciona en la sede del empleado (login por sede).
 *   5.  El mismo teléfono puede ser cliente en dos sedes; duplicado en la
 *       misma sede se rechaza.
 *   6.  Un producto de otra sede "no existe" al armar un pedido.
 *   7.  La cola del barista solo trae tickets de su sede.
 *   8.  La sincronización offline escribe SIEMPRE en la sede del token.
 *   9.  El reporte consolidado es EXCLUSIVO del administrador general; el
 *       admin de sede recibe 403 y su listado de usuarios no incluye ni a
 *       otras sedes ni a los administradores generales.
 *  10.  El admin de sede no puede editar usuarios de otra sede (404).
 *
 * Uso: con la API corriendo (npm run dev) y las migraciones 00-12 aplicadas:
 *   npm run test:multisucursal:live
 * Crea datos etiquetados y los elimina al terminar.
 *
 * Nota: la prueba hace 3 intentos de login reales, que cuentan contra el
 * rate-limit del endpoint (10 por 15 min por IP). Si la corres varias veces
 * seguidas y ves un 429, reinicia la API (el limitador vive en memoria) o
 * espera unos minutos. */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, pool } = require('../src/db');

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:3000/api';
const marker = `codex-multisuc-${Date.now()}`;
const state = {
  sedeA: null,          // Principal (existente)
  sedeB: null,          // sede temporal creada por la prueba
  staff: [],            // usuarios temporales [{id}]
  pedidos: [],          // ids de pedidos creados
  clientes: [],         // ids de clientes creados
  productoB: null,
  categoriaB: null,
  turnosAbiertos: [],   // ids de turnos abiertos por la prueba
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(route, { method, token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
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
  return { status: response.status, data };
}

function staffToken(user) {
  return jwt.sign(
    { tipo: 'staff', id: user.id, nombre: user.nombre, rol: user.rol, ver: user.token_version, suc: user.sucursal_id || null },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

async function createTempStaff(name, role, pin, sucursalId) {
  const result = await query(
    'INSERT INTO usuarios (nombre, rol, pin_hash, sucursal_id) VALUES ($1,$2,$3,$4) RETURNING id, nombre, rol, token_version, sucursal_id',
    [`${marker}-${name}`, role, await bcrypt.hash(pin, 4), sucursalId]
  );
  state.staff.push(result.rows[0]);
  return result.rows[0];
}

async function cleanup() {
  const staffIds = state.staff.map(u => u.id);
  if (state.pedidos.length) await query('DELETE FROM pedidos WHERE id = ANY($1::uuid[])', [state.pedidos]);
  await query('DELETE FROM lotes_sincronizacion WHERE dispositivo = $1', [marker]);
  // Cierra y borra los turnos que la prueba abrió.
  if (staffIds.length) await query('DELETE FROM turnos WHERE abierto_por = ANY($1::uuid[])', [staffIds]);
  if (state.clientes.length) await query('DELETE FROM clientes WHERE id = ANY($1::uuid[])', [state.clientes]);
  if (state.productoB) await query('DELETE FROM productos WHERE id = $1', [state.productoB]);
  if (state.categoriaB) await query('DELETE FROM categorias_producto WHERE id = $1', [state.categoriaB]);
  if (staffIds.length) await query('DELETE FROM usuarios WHERE id = ANY($1::uuid[])', [staffIds]);
  if (state.sedeB) {
    await query('DELETE FROM configuracion WHERE sucursal_id = $1', [state.sedeB.id]);
    await query('DELETE FROM configuracion_margen WHERE sucursal_id = $1', [state.sedeB.id]);
    await query('DELETE FROM sucursales WHERE id = $1', [state.sedeB.id]);
  }
}

async function main() {
  const health = await request('/../health');
  assert(health.status === 200, `health esperado 200, recibido ${health.status}`);

  // ---------- Preparación: sedes, personal y catálogo mínimo de B ----------
  const sedeARes = await query("SELECT id, nombre, prefijo_folio FROM sucursales WHERE activo ORDER BY creado_en LIMIT 1");
  assert(sedeARes.rows.length === 1, 'Se necesita al menos una sucursal activa (corre las migraciones 00-12).');
  state.sedeA = sedeARes.rows[0];

  const prefijoB = `T${String(Date.now()).slice(-4)}`;
  state.sedeB = (await query(
    'INSERT INTO sucursales (nombre, prefijo_folio) VALUES ($1,$2) RETURNING id, nombre, prefijo_folio',
    [`${marker}-sedeB`, prefijoB]
  )).rows[0];
  await query('INSERT INTO configuracion_margen (sucursal_id) VALUES ($1)', [state.sedeB.id]);

  const A = state.sedeA.id;
  const B = state.sedeB.id;

  const adminGeneral = await createTempStaff('general', 'admin', '9317', null);
  const adminA = await createTempStaff('adminA', 'admin', '8426', A);
  const cajeroA = await createTempStaff('cajeroA', 'cajero', '7535', A);
  const baristaA = await createTempStaff('baristaA', 'barista', '6644', A);
  const cajeroB = await createTempStaff('cajeroB', 'cajero', '5753', B);

  const tGeneral = staffToken(adminGeneral);
  const tAdminA = staffToken(adminA);
  const tCajeroA = staffToken(cajeroA);
  const tBaristaA = staffToken(baristaA);
  const tCajeroB = staffToken(cajeroB);

  // Producto propio de la sede B (snack: sin opciones ni receta).
  state.categoriaB = (await query(
    'INSERT INTO categorias_producto (nombre, orden, sucursal_id) VALUES ($1, 99, $2) RETURNING id',
    [`${marker}-cat`, B]
  )).rows[0].id;
  state.productoB = (await query(
    `INSERT INTO productos (nombre, categoria_id, tipo, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, sucursal_id)
     VALUES ($1, $2, 'snack', 30, false, false, false, false, $3) RETURNING id`,
    [`${marker}-galleta`, state.categoriaB, B]
  )).rows[0].id;
  // Un producto snack existente de la sede A para los pedidos de A.
  const productoA = (await query(
    "SELECT id FROM productos WHERE sucursal_id = $1 AND tipo = 'snack' AND activo LIMIT 1", [A]
  )).rows[0];
  assert(productoA, 'Se necesita al menos un snack activo en la primera sucursal (seed de desarrollo).');

  // ---------- 4. Login por sede: el PIN solo vale en la sede del empleado ----------
  const loginOk = await request('/auth/login', { body: { pin: '7535', sucursalId: A } });
  assert(loginOk.status === 200, `login de cajeroA en su sede esperado 200, recibido ${loginOk.status}`);
  assert(loginOk.data.usuario.sucursalId === A, 'el login debe regresar la sede del cajero');
  const loginCruzado = await request('/auth/login', { body: { pin: '7535', sucursalId: B } });
  assert(loginCruzado.status === 401, `login de cajeroA en sede B esperado 401, recibido ${loginCruzado.status}`);
  const loginGeneralEnB = await request('/auth/login', { body: { pin: '9317', sucursalId: B } });
  assert(loginGeneralEnB.status === 200, 'el admin general puede iniciar sesión desde cualquier sede');
  assert(loginGeneralEnB.data.usuario.sucursalId === null, 'el admin general regresa sucursalId null');

  // ---------- 1. Un turno abierto POR SEDE ----------
  // La sede A puede venir con un turno abierto por la operación real: se
  // respeta (y no se cierra al final); si está cerrada, la prueba lo abre.
  const estadoPrevioA = await request(`/turnos/estado?sucursal=${A}`);
  let abriTurnoA = false;
  if (!estadoPrevioA.data.abierto) {
    const turnoA = await request('/turnos/abrir', { method: 'POST', token: tCajeroA, body: {} });
    assert(turnoA.status === 201, `abrir turno en A esperado 201, recibido ${turnoA.status}: ${JSON.stringify(turnoA.data)}`);
    abriTurnoA = true;
  }
  const turnoB = await request('/turnos/abrir', { method: 'POST', token: tCajeroB, body: {} });
  assert(turnoB.status === 201, `abrir turno en B (con A ya abierto) esperado 201, recibido ${turnoB.status}`);
  const turnoADoble = await request('/turnos/abrir', { method: 'POST', token: tCajeroA, body: {} });
  assert(turnoADoble.status === 409, 'segundo turno en la MISMA sede debe rechazarse con 409');
  const estadoB = await request(`/turnos/estado?sucursal=${B}`);
  assert(estadoB.status === 200 && estadoB.data.abierto === true, 'el estado público por sede debe reflejar el turno de B');

  // ---------- 2 y 6. Pedidos: folio por sede y catálogo ajeno inexistente ----------
  const pedidoA = await request('/pedidos', {
    token: tCajeroA,
    body: { items: [{ productoId: productoA.id, cantidad: 1 }], pago: { metodoPago: 'efectivo', montoRecibido: 100 } },
  });
  assert(pedidoA.status === 201, `pedido en A esperado 201, recibido ${pedidoA.status}: ${JSON.stringify(pedidoA.data)}`);
  state.pedidos.push(pedidoA.data.pedido.id);
  assert(pedidoA.data.pedido.folio.startsWith(`${state.sedeA.prefijo_folio}-`), `folio de A debe llevar su prefijo (${pedidoA.data.pedido.folio})`);

  const pedidoB = await request('/pedidos', {
    token: tCajeroB,
    body: { items: [{ productoId: state.productoB, cantidad: 1 }], pago: { metodoPago: 'efectivo', montoRecibido: 100 } },
  });
  assert(pedidoB.status === 201, `pedido en B esperado 201, recibido ${pedidoB.status}: ${JSON.stringify(pedidoB.data)}`);
  state.pedidos.push(pedidoB.data.pedido.id);
  assert(pedidoB.data.pedido.folio.startsWith(`${prefijoB}-`), `folio de B debe llevar su prefijo (${pedidoB.data.pedido.folio})`);

  const pedidoCruzado = await request('/pedidos', {
    token: tCajeroA,
    body: { items: [{ productoId: state.productoB, cantidad: 1 }] },
  });
  assert(pedidoCruzado.status === 404, `producto de B en pedido de A esperado 404, recibido ${pedidoCruzado.status}`);

  // ---------- 3. Aislamiento de lectura/cobro entre sedes ----------
  const verAjeno = await request(`/pedidos/${pedidoB.data.pedido.id}`, { token: tCajeroA });
  assert(verAjeno.status === 404, `cajeroA viendo pedido de B esperado 404, recibido ${verAjeno.status}`);
  const cobrarAjeno = await request(`/pedidos/${pedidoB.data.pedido.id}/cobrar`, { method: 'PATCH', token: tCajeroA, body: {} });
  assert(cobrarAjeno.status === 404, `cajeroA cobrando pedido de B esperado 404, recibido ${cobrarAjeno.status}`);
  const listaConHeaderAjeno = await request('/pedidos', { token: tCajeroA, headers: { 'X-Sucursal-Id': B } });
  assert(listaConHeaderAjeno.status === 200, 'el listado de A debe responder aunque mande header ajeno');
  assert(!listaConHeaderAjeno.data.some(p => p.id === pedidoB.data.pedido.id),
    'X-Sucursal-Id de un cajero con sede fija debe IGNORARSE: jamás ve pedidos de otra sede');

  // ---------- 7. La cola del barista es de su sede ----------
  const cola = await request('/pedido-items/cola', { token: tBaristaA });
  assert(cola.status === 200, `cola de barista esperado 200, recibido ${cola.status}`);
  assert(cola.data.some(t => t.pedido_id === pedidoA.data.pedido.id), 'la cola de A debe traer el ticket de A');
  assert(!cola.data.some(t => t.pedido_id === pedidoB.data.pedido.id), 'la cola de A no debe traer tickets de B');

  // ---------- 5. Clientes por sede: mismo teléfono en dos sedes ----------
  const telefono = `55${String(Date.now()).slice(-8)}`;
  const cliA = await request('/clientes', { token: tCajeroA, body: { nombre: 'Ana', apellido: 'Prueba', telefono } });
  assert(cliA.status === 201, `cliente en A esperado 201, recibido ${cliA.status}`);
  state.clientes.push(cliA.data.id);
  const cliB = await request('/clientes', { token: tCajeroB, body: { nombre: 'Ana', apellido: 'Prueba', telefono } });
  assert(cliB.status === 201, `mismo teléfono en B esperado 201, recibido ${cliB.status}`);
  state.clientes.push(cliB.data.id);
  const cliDup = await request('/clientes', { token: tCajeroA, body: { nombre: 'Otra', apellido: 'Ana', telefono } });
  assert(cliDup.status === 409, `teléfono duplicado en la MISMA sede esperado 409, recibido ${cliDup.status}`);

  // ---------- 8. Sync offline: el lote escribe en la sede del token ----------
  const clientUuid = crypto.randomUUID();
  const sync = await request('/sync/batch', {
    token: tCajeroA,
    body: {
      dispositivo: marker,
      operaciones: [{
        tipo: 'crear_pedido', clientUuid,
        payload: { items: [{ productoId: productoA.id, cantidad: 1 }], timestampOriginal: new Date().toISOString() },
      }],
    },
  });
  assert(sync.status === 200, `sync batch esperado 200, recibido ${sync.status}`);
  assert(sync.data.resultados[0].estado === 'creado', `operación de sync esperada 'creado': ${JSON.stringify(sync.data.resultados[0])}`);
  state.pedidos.push(sync.data.resultados[0].servidorId);
  const sedeDelSync = await query('SELECT sucursal_id FROM pedidos WHERE id = $1', [sync.data.resultados[0].servidorId]);
  assert(sedeDelSync.rows[0].sucursal_id === A, 'el pedido sincronizado debe quedar en la sede del token');

  // ---------- 9. Jerarquía: consolidado y visibilidad de usuarios ----------
  const consolidadoNegado = await request('/reportes/ventas-por-metodo-pago?consolidado=true', { token: tAdminA });
  assert(consolidadoNegado.status === 403, `consolidado para admin de sede esperado 403, recibido ${consolidadoNegado.status}`);
  const consolidadoOk = await request('/reportes/ventas-por-metodo-pago?consolidado=true', { token: tGeneral });
  assert(consolidadoOk.status === 200, `consolidado para admin general esperado 200, recibido ${consolidadoOk.status}`);

  const usuariosDeA = await request('/usuarios', { token: tAdminA });
  assert(usuariosDeA.status === 200, 'listado de usuarios del admin de sede debe responder 200');
  assert(usuariosDeA.data.every(u => u.sucursal_id === A), 'el admin de sede solo ve usuarios de SU sede (ni otras sedes ni generales)');
  const usuariosDeB = await request('/usuarios', { token: tGeneral, headers: { 'X-Sucursal-Id': B } });
  assert(usuariosDeB.status === 200 && usuariosDeB.data.some(u => u.id === cajeroB.id), 'el general con X-Sucursal-Id ve la sede B');
  assert(usuariosDeB.data.some(u => u.sucursal_id === null), 'el general también ve a los administradores generales');

  // ---------- 10. Admin de sede no toca usuarios ajenos ni crea generales ----------
  const editarAjeno = await request(`/usuarios/${cajeroB.id}`, { method: 'PATCH', token: tAdminA, body: { nombre: 'Hackeado' } });
  assert(editarAjeno.status === 404, `admin de A editando usuario de B esperado 404, recibido ${editarAjeno.status}`);
  const crearGeneralNegado = await request('/usuarios', {
    token: tAdminA,
    body: { nombre: `${marker}-intruso`, rol: 'admin', pin: '4917', esAdminGeneral: true },
  });
  assert(crearGeneralNegado.status === 403, `admin de sede creando admin general esperado 403, recibido ${crearGeneralNegado.status}`);

  // Cierre de turnos por la vía normal (verifica cerrar por sede). El turno
  // de A solo se cierra si lo abrió esta prueba.
  if (abriTurnoA) {
    const cierreA = await request('/turnos/cerrar', { method: 'POST', token: tCajeroA, body: {} });
    assert(cierreA.status === 200, 'cerrar turno de A');
  }
  const cierreB = await request('/turnos/cerrar', { method: 'POST', token: tCajeroB, body: {} });
  assert(cierreB.status === 200, 'cerrar turno de B');

  console.log('OK: las 10 garantías multi-sucursal se cumplen contra la API viva.');
}

main()
  .then(async () => { await cleanup(); await pool.end(); })
  .catch(async err => {
    console.error(`FALLO: ${err.message}`);
    try { await cleanup(); } catch (e) { console.error(`(limpieza incompleta: ${e.message})`); }
    await pool.end();
    process.exitCode = 1;
  });
