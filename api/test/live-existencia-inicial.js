// Prueba viva (base desechable codex_*): las existencias capturadas a mano dejan movimiento con usuario y motivo,
// las cantidades grandes exigen confirmación y no inflan el costo de ventas.
// NODE_ENV=development node test/live-existencia-inicial.js
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { pool, query } = require('../src/db');
const A = require('../src/services/accounting');
let server;
(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  assert.match(process.env.PGDATABASE, /^codex_/);
  const one = async (sql, args = []) => (await query(sql, args)).rows[0];
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const suc = await one('INSERT INTO sucursales(nombre,prefijo_folio) VALUES($1,$2) RETURNING id', [`QA EXI ${tag}`, `EX${tag}`.slice(0, 6)]);
  const admin = await one("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES('QA admin','admin','qa-sin-login',$1) RETURNING *", [suc.id]);
  const cat = await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA',$1) RETURNING id", [suc.id]);
  server = require('../src/app').listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const req = async (method, path, body) => {
    const token = jwt.sign({ tipo: 'staff', id: admin.id, ver: admin.token_version, suc: admin.sucursal_id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (...a) => { const r = await req(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const movs = async id => (await query('SELECT tipo, cantidad::float AS cantidad, motivo, usuario_id FROM movimientos_inventario WHERE materia_prima_id=$1 ORDER BY creado_en, id', [id])).rows;
  const periodo = A.hoyMx().slice(0, 7);
  const costo0 = (await A.estadoResultados(query, suc.id, periodo)).costoVentas;

  // Alta con existencias a mano: sin motivo → 400; grande sin confirmar → 409; confirmada → movimiento.
  const base = { categoriaId: cat.id, unidad: 'kg', costoUnitario: 142.7 };
  assert.equal((await req('POST', '/materias-primas', { ...base, nombre: `A ${tag}`, stockActual: 5 })).status, 400);
  const sinConf = await req('POST', '/materias-primas', { ...base, nombre: `B ${tag}`, stockActual: 400, motivo: 'Conteo' });
  assert.equal(sinConf.status, 409); assert.equal(sinConf.body.details.codigo, 'confirmar_cantidad');
  assert.equal((await req('POST', '/materias-primas', { ...base, nombre: `B ${tag}`, stockActual: 400, motivo: 'Conteo', confirmarCantidad: 40 })).status, 409);
  assert.equal((await one('SELECT count(*)::int n FROM materias_primas WHERE sucursal_id=$1', [suc.id])).n, 0, 'nada se crea si falla');
  const choco = await ok('POST', '/materias-primas', { ...base, nombre: `Choco ${tag}`, stockActual: 400, motivo: 'Conteo físico inicial', confirmarCantidad: 400 });
  let mv = await movs(choco.id);
  assert.equal(mv.length, 1); assert.equal(mv[0].tipo, 'existencia_inicial'); assert.equal(mv[0].cantidad, 400);
  assert.equal(mv[0].motivo, 'Conteo físico inicial'); assert.equal(mv[0].usuario_id, admin.id);
  // Sin existencias → sin movimiento y sin pedir motivo.
  const vacio = await ok('POST', '/materias-primas', { ...base, nombre: `Vacio ${tag}`, stockActual: 0 });
  assert.equal((await movs(vacio.id)).length, 0);

  // Edición manual del stock: motivo obligatorio, confirmación si el cambio es grande, sin cambio no pide nada.
  const ch = await ok('POST', '/materias-primas', { ...base, nombre: `Chico ${tag}`, stockActual: 10, motivo: 'Conteo' });
  assert.equal((await req('PATCH', `/materias-primas/${ch.id}`, { stockActual: 12 })).status, 400);
  await ok('PATCH', `/materias-primas/${ch.id}`, { nombre: `Chico2 ${tag}`, stockActual: 10 });
  assert.equal((await movs(ch.id)).length, 1, 'sin cambio de stock no hay movimiento');
  await ok('PATCH', `/materias-primas/${ch.id}`, { stockActual: 12.5, motivo: 'Corrijo captura' });
  assert.equal((await req('PATCH', `/materias-primas/${ch.id}`, { stockActual: 300, motivo: 'Corrijo' })).status, 409);
  await ok('PATCH', `/materias-primas/${ch.id}`, { stockActual: 300, motivo: 'Corrijo', confirmarCantidad: 287.5 });
  mv = await movs(ch.id);
  assert.deepEqual(mv.map(x => [x.tipo, x.cantidad]), [['existencia_inicial', 10], ['correccion_captura', 2.5], ['correccion_captura', 287.5]]);
  const st = await one('SELECT stock_actual::float s FROM materias_primas WHERE id=$1', [ch.id]);
  assert.equal(st.s, 300);
  assert.equal(mv.reduce((s, x) => s + x.cantidad, 0), st.s, 'los movimientos explican el stock');

  // Nada de esto es costo de ventas.
  assert.deepEqual((await A.estadoResultados(query, suc.id, periodo)).costoVentas, costo0);

  // La bitácora los muestra con su tipo.
  const lista = await ok('GET', '/bitacora/movimientos?tipo=existencia_inicial&limite=50');
  assert.ok(lista.filas.some(f => f.materia_prima_id === choco.id || f.insumo === `Choco ${tag}`));
  console.log('OK live-existencia-inicial');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (server) server.close(); await pool.end(); });
