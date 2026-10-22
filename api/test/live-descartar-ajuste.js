// Prueba viva (base desechable codex_*): existencias iniciales capturadas por error (400 kg a mano),
// ajuste que las quita, costo inflado en el estado de resultados y su descarte sin mover existencias.
// NODE_ENV=development node test/live-descartar-ajuste.js
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
  const suc = await one('INSERT INTO sucursales(nombre,prefijo_folio) VALUES($1,$2) RETURNING id', [`QA DESC ${tag}`, `DC${tag}`.slice(0, 6)]);
  const admin = await one("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES('QA admin','admin','qa-sin-login',$1) RETURNING *", [suc.id]);
  const cajero = await one("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES('QA cajero','cajero','qa-sin-login',$1) RETURNING *", [suc.id]);
  const cat = await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA',$1) RETURNING id", [suc.id]);
  server = require('../src/app').listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const req = async (method, path, body, u = admin) => {
    const token = jwt.sign({ tipo: 'staff', id: u.id, ver: u.token_version, suc: u.sucursal_id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (...a) => { const r = await req(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const periodo = A.hoyMx().slice(0, 7);
  const ajustesCosto = async () => (await A.estadoResultados(query, suc.id, periodo)).costoVentas.ajustes;
  const antes0 = await ajustesCosto();

  // Caso real: insumo creado con 400 kg "de existencias iniciales" a mano (sin movimiento) y luego una compra de 2.2 kg.
  const choco = await ok('POST', '/materias-primas', { nombre: `Chocomilk ${tag}`, categoriaId: cat.id, unidad: 'kg', stockActual: 400, costoUnitario: 142.7273 });
  await ok('POST', `/materias-primas/${choco.id}/lotes`, { cantidadComprada: 2.2, unidad: 'kg', costoTotal: 314 });
  let m = await one('SELECT stock_actual, costo_unitario FROM materias_primas WHERE id=$1', [choco.id]);
  assert.equal(Number(m.stock_actual), 402.2);
  const aj = await ok('POST', `/materias-primas/${choco.id}/ajustar-stock`, { nuevaCantidad: 2.2, stockEsperado: 402.2, motivo: 'error de captura' });
  const inflado = await ajustesCosto();
  assert.ok(inflado - antes0 > 56000, `debe inflar ~$57,000 (${antes0} → ${inflado})`);

  // Validaciones.
  assert.equal((await req('POST', `/ajustes-inventario/${aj.ajusteId}/descartar-costo`, {})).status, 400);
  assert.equal((await req('POST', `/ajustes-inventario/${aj.ajusteId}/descartar-costo`, { motivo: 'x' })).status, 400);
  assert.equal((await req('POST', `/ajustes-inventario/${aj.ajusteId}/descartar-costo`, { motivo: 'Existencias mal capturadas' }, cajero)).status, 403);
  assert.equal((await req('POST', '/ajustes-inventario/00000000-0000-4000-8000-000000000000/descartar-costo', { motivo: 'No existe este' })).status, 404);

  const out = await ok('POST', `/ajustes-inventario/${aj.ajusteId}/descartar-costo`, { motivo: 'Se capturaron 400 kg por error al crear el insumo' });
  assert.ok(out.impactoResultados > 56000);
  m = await one('SELECT stock_actual FROM materias_primas WHERE id=$1', [choco.id]);
  assert.equal(Number(m.stock_actual), 2.2, 'las existencias no cambian');
  assert.equal(await ajustesCosto(), antes0, 'el estado de resultados vuelve a su valor');
  const detalle = await ok('GET', `/ajustes-inventario/${aj.ajusteId}`);
  assert.equal(detalle.costo, 0); assert.ok(detalle.revertido_en); assert.match(detalle.motivo_reversion, /Error de captura/);
  assert.equal((await req('POST', `/ajustes-inventario/${aj.ajusteId}/descartar-costo`, { motivo: 'Otra vez por error' })).status, 409);
  const tipos = (await query('SELECT tipo, count(*)::int AS n FROM movimientos_inventario WHERE ajuste_stock_id=$1 GROUP BY tipo', [aj.ajusteId])).rows;
  assert.deepEqual(Object.fromEntries(tipos.map(t => [t.tipo, t.n])), { ajuste: 2, correccion_captura: 1 });

  // Bitácora: queda el rastro y el listado de ajustes lo refleja.
  const cambios = await ok('GET', '/bitacora/cambios?limite=50');
  assert.ok(cambios.filas.some(f => f.entidad === 'ajustes_stock' && f.accion === 'descartar_costo' && f.usuario === 'QA admin'));
  const lista = await ok('GET', '/bitacora/ajustes');
  const fila = lista.filas.find(f => f.id === aj.ajusteId);
  assert.ok(fila && fila.costo === 0 && fila.revertido_en);
  const movs = await ok('GET', '/bitacora/movimientos?tipo=correccion_captura');
  assert.ok(movs.filas.some(f => f.tipo === 'correccion_captura'));

  // Insumo por lote: el descarte tampoco mueve lotes ni existencias.
  const az = await ok('POST', '/materias-primas', { nombre: `Azúcar lote ${tag}`, categoriaId: cat.id, unidad: 'kg', requiereLote: true, primeraCompra: { cantidadComprada: 10, unidad: 'kg', costoTotal: 200 } });
  const lotesAntes = (await query('SELECT id, cantidad_disponible::float AS d FROM lotes WHERE materia_prima_id=$1 ORDER BY id', [az.id])).rows;
  const base1 = await ajustesCosto();
  const aj2 = await ok('POST', `/materias-primas/${az.id}/ajustar-stock`, { nuevaCantidad: 4, stockEsperado: 10, motivo: 'conteo mal' });
  assert.ok(await ajustesCosto() > base1);
  await ok('POST', `/ajustes-inventario/${aj2.ajusteId}/descartar-costo`, { motivo: 'El conteo estaba mal capturado' });
  assert.equal(await ajustesCosto(), base1);
  assert.deepEqual((await query('SELECT id, cantidad_disponible::float AS d FROM lotes WHERE materia_prima_id=$1 ORDER BY id', [az.id])).rows.map(l => l.d),
    lotesAntes.map(() => 4), 'los lotes quedan como después del ajuste');
  assert.equal(Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1', [az.id])).stock_actual), 4);
  console.log('PASS: descarte del costo de un ajuste por error de captura (con y sin lote).');
})().catch(e => { console.error('FAIL:', e); process.exitCode = 1; }).finally(async () => { server?.close(); await pool.end(); });
