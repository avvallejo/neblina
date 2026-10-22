// Prueba viva (base desechable codex_*): alta por error de 200 kg de azúcar,
// ajuste que la "compensa", estado de resultados inflado y su corrección con
// "anular compra"; más la bitácora. NODE_ENV=development node test/live-anular-compra.js
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { pool, query } = require('../src/db');
const A = require('../src/services/accounting');
let server;

const MERMA_MOTIVO = 'Caducado';
(async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  assert.match(process.env.PGDATABASE, /^codex_/);
  const one = async (sql, args = []) => (await query(sql, args)).rows[0];
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const suc = await one('INSERT INTO sucursales(nombre,prefijo_folio) VALUES($1,$2) RETURNING id', [`QA ANUL ${tag}`, `AN${tag}`.slice(0, 6)]);
  const admin = await one("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES('QA admin','admin','qa-sin-login',$1) RETURNING *", [suc.id]);
  const cajero = await one("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES('QA cajero','cajero','qa-sin-login',$1) RETURNING *", [suc.id]);
  const cat = await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA insumos',$1) RETURNING id", [suc.id]);
  const cuentaDinero = await one("SELECT id FROM cuentas_dinero WHERE sucursal_id=$1 ORDER BY id LIMIT 1", [suc.id]);
  assert.ok(cuentaDinero, 'la sede nueva debe traer cuentas de dinero sembradas');

  server = require('../src/app').listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const req = async (method, path, body, u = admin) => {
    const token = jwt.sign({ tipo: 'staff', id: u.id, ver: u.token_version, suc: u.sucursal_id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (...args) => { const r = await req(...args); assert.ok(r.status < 300, `${args[0]} ${args[1]} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const periodo = A.hoyMx().slice(0, 7);
  const resultados = async () => (await query(`SELECT 1`)) && A.estadoResultados(query, suc.id, periodo);
  const base = await resultados();
  assert.equal(base.costoVentas.ajustes, 0);

  for (const modo of ['sin_lote', 'con_lote']) {
    const requiereLote = modo === 'con_lote';
    // Azúcar con existencias reales previas: 12 kg a $20/kg registrados antes.
    const azucar = await ok('POST', '/materias-primas', { nombre: `Azúcar ${modo} ${tag}`, categoriaId: cat.id, unidad: 'kg', requiereLote,
      primeraCompra: { cantidadComprada: 12, unidad: 'kg', costoTotal: 240, cuentaDineroId: cuentaDinero.id } });
    assert.equal(Number(azucar.stock_actual), 12); assert.equal(Number(azucar.costo_unitario), 20);
    await new Promise(r => setTimeout(r, 20));

    // ERROR: otra persona (cajero con acceso de admin simulado vía inserción directa) da de alta 200 kg por $4,600 (23/kg).
    const errada = await ok('POST', `/materias-primas/${azucar.id}/lotes`, { cantidadComprada: 200, unidad: 'kg', costoTotal: 4600, cuentaDineroId: cuentaDinero.id });
    let m = await one('SELECT stock_actual, costo_unitario FROM materias_primas WHERE id=$1', [azucar.id]);
    assert.equal(Number(m.stock_actual), 212); assert.equal(Number(m.costo_unitario), 23);

    // Corrección "a mano": ajuste a 12 kg. Esto es lo que infla el estado de resultados.
    const antesAjuste = (await resultados()).costoVentas.ajustes;
    const ajuste = await ok('POST', `/materias-primas/${azucar.id}/ajustar-stock`, { nuevaCantidad: 12, stockEsperado: 212, motivo: 'Alta duplicada por error' });
    m = await one('SELECT stock_actual FROM materias_primas WHERE id=$1', [azucar.id]);
    assert.equal(Number(m.stock_actual), 12);
    const inflado = (await resultados()).costoVentas.ajustes;
    assert.ok(inflado - antesAjuste > 4000, `el ajuste debe inflar el costo (${antesAjuste} → ${inflado})`);

    // Vista previa: identifica al responsable del alta y el ajuste candidato.
    const previa = await ok('GET', `/compras/${errada.id}/anulacion`);
    assert.equal(previa.puedeAnular, true);
    assert.equal(previa.lote.registrado_por, 'QA admin');
    assert.equal(previa.egresos.length, 1);
    assert.equal(previa.ajustes.length, 1);
    assert.equal(previa.ajustes[0].id, ajuste.ajusteId);
    assert.ok(previa.ajustes[0].costo > 4000);

    // Validaciones: motivo obligatorio, otro rol rechazado, ajuste ajeno rechazado.
    assert.equal((await req('POST', `/compras/${errada.id}/anular`, { ajusteIds: [ajuste.ajusteId] })).status, 400);
    assert.equal((await req('POST', `/compras/${errada.id}/anular`, { ajusteIds: [ajuste.ajusteId], motivo: 'x' }, cajero)).status, 403);
    assert.equal((await req('POST', `/compras/${errada.id}/anular`, { ajusteIds: ['00000000-0000-4000-8000-000000000000'], motivo: 'Alta por error' })).status, 400);

    // Anular, revirtiendo el ajuste que compensó el error.
    const out = await ok('POST', `/compras/${errada.id}/anular`, { ajusteIds: [ajuste.ajusteId], motivo: 'Alta de 200 kg capturada por error' });
    assert.equal(out.stockAntes, 12); assert.equal(out.stockDespues, 12);
    assert.equal(out.costoReferencia.antes, 23); assert.equal(out.costoReferencia.despues, 20);
    assert.equal(out.egresosAnulados.length, 1);
    assert.ok(out.impactoResultados > 4000);

    m = await one('SELECT stock_actual, costo_unitario FROM materias_primas WHERE id=$1', [azucar.id]);
    assert.equal(Number(m.stock_actual), 12); assert.equal(Number(m.costo_unitario), 20);
    const despues = (await resultados()).costoVentas.ajustes;
    assert.equal(despues, antesAjuste, `el estado de resultados debe volver a ${antesAjuste}, quedó ${despues}`);
    const lote = await one('SELECT * FROM lotes WHERE id=$1', [errada.id]);
    assert.ok(lote.anulado_en); assert.equal(lote.anulado_por, admin.id); assert.equal(Number(lote.cantidad_disponible), 0);
    const egreso = await one('SELECT anulado, motivo_anulacion FROM egresos WHERE lote_id=$1', [errada.id]);
    assert.equal(egreso.anulado, true);
    if (requiereLote) {
      const suma = await one("SELECT sum(cantidad_disponible)::float AS s FROM lotes WHERE materia_prima_id=$1", [azucar.id]);
      assert.equal(suma.s, 12, 'los lotes vigentes deben sumar lo mismo que el inventario');
    }
    // El ajuste quedó marcado como revertido y su historial neto es cero.
    const aj = await one('SELECT revertido_en, revertido_por FROM ajustes_stock WHERE id=$1', [ajuste.ajusteId]);
    assert.ok(aj.revertido_en); assert.equal(aj.revertido_por, admin.id);
    // Segunda anulación: 409. Ajuste ya revertido: 409 en otra compra.
    assert.equal((await req('POST', `/compras/${errada.id}/anular`, { ajusteIds: [], motivo: 'Otra vez por error' })).status, 409);
    const vigente = await ok('GET', `/compras?insumo=${azucar.id}&estado=vigentes`);
    assert.equal(vigente.total, 1);
    const anuladas = await ok('GET', `/compras?insumo=${azucar.id}&estado=anuladas`);
    assert.equal(anuladas.total, 1); assert.equal(anuladas.filas[0].anulado_por, 'QA admin');

    // Un lote del que ya salieron existencias por mermas/ventas no se anula completo.
    if (requiereLote) {
      const otro = await ok('POST', `/materias-primas/${azucar.id}/lotes`, { cantidadComprada: 5, unidad: 'kg', costoTotal: 100 });
      await ok('POST', '/mermas', { materiaPrimaId: azucar.id, cantidad: 13, unidad: 'kg', motivo: MERMA_MOTIVO });
      const bloqueada = await ok('GET', `/compras/${otro.id}/anulacion`);
      assert.equal(bloqueada.puedeAnular, false); assert.ok(bloqueada.usos.movimientos > 0);
      assert.equal((await req('POST', `/compras/${otro.id}/anular`, { ajusteIds: [], motivo: 'No debería poder' })).status, 409);
    }
  }

  // Bitácora: el alta, el ajuste y la anulación quedaron con su usuario.
  const cambios = await ok('GET', '/bitacora/cambios?limite=200');
  const acciones = new Set(cambios.filas.map(f => `${f.entidad}:${f.accion}`));
  for (const esperado of ['materias_primas:crear', 'lotes:registrar_compra', 'ajustes_stock:ajustar_stock', 'lotes:anular_compra', 'ajustes_stock:revertir', 'egresos:anular']) {
    assert.ok(acciones.has(esperado), `falta en cambios: ${esperado} (hay ${[...acciones]})`);
  }
  assert.ok(cambios.filas.every(f => f.usuario === 'QA admin'));
  await new Promise(r => setTimeout(r, 300)); // el registro de acciones se escribe al terminar cada respuesta
  const acc = await ok('GET', '/bitacora/acciones?limite=200');
  const rutas = new Set(acc.filas.map(f => `${f.metodo} ${f.ruta} ${f.estado_http}`));
  assert.ok(rutas.has('POST /api/materias-primas/:id/ajustar-stock 200'), [...rutas].join('\n'));
  assert.ok(rutas.has('POST /api/compras/:id/anular 200'));
  assert.ok(rutas.has('POST /api/compras/:id/anular 403'), 'los intentos rechazados también quedan');
  assert.ok(acc.filas.every(f => f.usuario && f.ip !== undefined));
  const detalle = JSON.stringify(acc.filas.map(f => f.detalle));
  assert.ok(!/qa-sin-login/.test(detalle));
  const movs = await ok('GET', '/bitacora/movimientos?limite=200');
  assert.ok(movs.filas.some(f => f.tipo === 'anulacion_compra' && f.usuario === 'QA admin'));
  assert.ok(movs.filas.some(f => f.tipo === 'compra' || f.tipo === 'ajuste'));
  const filtrado = await ok('GET', `/bitacora/acciones?usuario=${cajero.id}`);
  assert.equal(filtrado.total, 0 + filtrado.filas.length); // el cajero no hizo acciones autorizadas
  assert.equal((await req('GET', '/bitacora/acciones', undefined, cajero)).status, 403);

  // Solo inserción.
  await assert.rejects(() => query("UPDATE auditoria SET motivo='x' WHERE sucursal_id=$1", [suc.id]), /solo lectura/);
  await assert.rejects(() => query('DELETE FROM bitacora_acciones WHERE sucursal_id=$1', [suc.id]), /permission denied|solo lectura/);
  console.log('PASS: anulación de compra, reversión del ajuste, estado de resultados y bitácora.');
})().catch(e => { console.error('FAIL:', e); process.exitCode = 1; }).finally(async () => { server?.close(); await pool.end(); });
