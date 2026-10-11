// Ejecutar exclusivamente en una base desechable codex_mermas_* con esquema vigente.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { query, pool } = require('../src/db');
const accounting = require('../src/services/accounting');
const { dailySalesSql } = require('../src/services/dailySales');
let server;
(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  assert.match(process.env.PGDATABASE, /^codex_mermas_/);
  const one = async (sql, params = []) => (await query(sql, params)).rows[0];
  const sede = await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA mermas','QMR') RETURNING id");
  const otra = await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA otra','QMO') RETURNING id");
  const user = (rol, suc = sede.id) => one("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES($1,$2,'qa-sin-login',$3) RETURNING *", [rol, rol, suc]);
  const admin = await user('admin'), barista = await user('barista'), cajero = await user('cajero'), foreign = await user('admin', otra.id);
  const category = await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA leche',$1) RETURNING id", [sede.id]);
  const material = await one("INSERT INTO materias_primas(nombre,categoria_id,unidad,stock_actual,costo_unitario,requiere_lote,sucursal_id) VALUES('Leche QA',$1,'l',10,20,true,$2) RETURNING id", [category.id, sede.id]);
  const lot = await one("INSERT INTO lotes(materia_prima_id,cantidad_comprada,cantidad_disponible,unidad,costo_total,usuario_id) VALUES($1,10,10,'l',200,$2) RETURNING id", [material.id, admin.id]);
  server = require('../src/app').listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const req = async (method, path, body, u = admin) => {
    const token = jwt.sign({ tipo: 'staff', id: u.id, ver: u.token_version, suc: u.sucursal_id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const stock = async () => Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1', [material.id])).stock_actual);
  const body = { materiaPrimaId: material.id, cantidad: 0.125, unidad: 'l', motivo: 'Leche derramada', fechaContable: '2020-08-31' };
  const saved = await req('POST', '/mermas', body);
  assert.equal(saved.status, 201, JSON.stringify(saved));
  assert.equal(saved.data.pedido_item_id, null);
  assert.equal(await stock(), 9.875);
  assert.equal(Number((await one('SELECT cantidad_disponible FROM lotes WHERE id=$1', [lot.id])).cantidad_disponible), 9.875);
  assert.equal(Number((await one("SELECT -sum(cantidad*costo_unitario) AS costo FROM movimientos_inventario WHERE merma_id=$1", [saved.data.id])).costo), 2.5);
  assert.equal((await accounting.estadoResultados(query, sede.id, '2020-08')).costoVentas.mermas, 2.5);
  assert.equal((await accounting.estadoResultados(query, sede.id, accounting.hoyMx().slice(0, 7))).costoVentas.mermas, 0);
  assert.equal(Number((await one(dailySalesSql, [sede.id, '2020-08-31'])).mermas), 1);
  assert.equal(Number((await one(dailySalesSql, [sede.id, accounting.hoyMx()])).mermas), 0);
  let list = await req('GET', '/mermas?desde=2020-08-01&hasta=2020-08-31');
  assert.equal(list.data.length, 1); assert.equal(list.data[0].fecha_contable, '2020-08-31');
  assert.equal(list.data[0].creado_en.slice(0, 4), new Date().getUTCFullYear().toString());
  assert.equal((await req('GET', '/mermas?desde=2020-09-01&hasta=2020-09-30')).data.length, 0);
  assert.equal((await req('GET', '/mermas', undefined, foreign)).data.length, 0);
  assert.equal((await req('POST', '/mermas', body, foreign)).status, 400);
  assert.equal((await req('POST', '/mermas', body, barista)).status, 403);
  assert.equal((await req('POST', '/mermas', body, cajero)).status, 403);
  for (const patch of [{ cantidad: 0 }, { cantidad: 0.0001 }, { fechaContable: '2099-01-01' }, { fechaContable: '2020-09-31' }]) {
    assert.equal((await req('POST', '/mermas', { ...body, ...patch })).status, 400);
  }
  await query("INSERT INTO cierres_mes(sucursal_id,periodo,cerrado_por,resumen) VALUES($1,'2020-09',$2,'{}')", [sede.id, admin.id]);
  assert.equal((await req('POST', '/mermas', { ...body, fechaContable: '2020-09-30' })).status, 409);
  assert.equal(await stock(), 9.875, 'Los intentos rechazados no descuentan stock');
  assert.equal(Number((await one('SELECT count(*) AS n FROM mermas')).n), 1);
  const current = await req('POST', '/mermas', { ...body, fechaContable: undefined }, barista);
  assert.equal(current.status, 201, JSON.stringify(current));
  assert.equal(await stock(), 9.75);
  console.log('PASS: merma independiente, fechas históricas, descuento real, lotes, costo mensual, resumen diario, filtros, permisos y meses cerrados.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (server) await new Promise(r => server.close(r)); await pool.end(); });
