// Solo una base desechable. Ejecutar con PREPARAR_LEGACY=1 antes de migrar 47,
// aplicar 47 como postgres y volver a ejecutar para comprobar la actualización.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { pool, query } = require('../src/db');
const A = require('../src/services/accounting');
let server;
(async () => {
  assert.equal(process.env.NODE_ENV,'development');
  assert.match(process.env.PGDATABASE,/^codex_ajustes_/);
  const one = async (sql,args=[]) => (await query(sql,args)).rows[0];
  if (process.env.PREPARAR_LEGACY === '1') {
    const branch = async prefijo => one('INSERT INTO sucursales(nombre,prefijo_folio) VALUES($1,$2) RETURNING id',[`QA ${prefijo}`,prefijo]);
    const s = await branch('AJQA'), f = await branch('AJQF');
    for (const [rol,sede] of [['admin',s.id],['cajero',s.id],['admin',f.id]]) await query("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES($1,$2,'qa-sin-login',$3)",[`QA ${rol}`,rol,sede]);
    const admin = await one("SELECT id FROM usuarios WHERE sucursal_id=$1 AND rol='admin'",[s.id]);
    const cat = await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA leches',$1) RETURNING id",[s.id]);
    for (const [name,cost,stock,diff,time,lots] of [['Leche KS',23.5,15,-5,'09:00',true],['Leche MM',24.92,0,-7,'10:00',false],['Leche entera',24.86,0,-6,'11:00',false]]) {
      const m = await one(`INSERT INTO materias_primas(nombre,categoria_id,unidad,stock_actual,costo_unitario,requiere_lote,sucursal_id)
        VALUES($1,$2,'l',$3,$4,$5,$6) RETURNING id`,[name,cat.id,stock,cost,lots,s.id]);
      if (lots) {
        for (const taken of [2,3]) {
          const l = await one("INSERT INTO lotes(materia_prima_id,cantidad_comprada,cantidad_disponible,unidad,costo_total,usuario_id) VALUES($1,10,$2,'l',235,$3) RETURNING id",[m.id,10-taken,admin.id]);
          await query("INSERT INTO movimientos_inventario(materia_prima_id,tipo,cantidad,lote_id,usuario_id,motivo,creado_en) VALUES($1,'ajuste',$2,$3,$4,'Conteo cierre septiembre',$5)",[m.id,-taken,l.id,admin.id,`2026-10-01T${time}:00-06:00`]);
        }
      } else await query("INSERT INTO movimientos_inventario(materia_prima_id,tipo,cantidad,usuario_id,motivo,creado_en) VALUES($1,'ajuste',$2,$3,'Conteo cierre septiembre',$4)",[m.id,diff,admin.id,`2026-10-01T${time}:00-06:00`]);
    }
    console.log('PASS: tres ajustes anteriores preparados, uno repartido en dos lotes.');
    return;
  }
  const s = await one("SELECT id FROM sucursales WHERE prefijo_folio='AJQA'");
  const admin = await one("SELECT * FROM usuarios WHERE sucursal_id=$1 AND rol='admin'",[s.id]);
  const cashier = await one("SELECT * FROM usuarios WHERE sucursal_id=$1 AND rol='cajero'",[s.id]);
  const foreign = await one("SELECT * FROM usuarios WHERE sucursal_id<>$1 AND rol='admin'",[s.id]);
  server = require('../src/app').listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const req = async (method,path,body,u=admin) => {
    const token = jwt.sign({tipo:'staff',id:u.id,ver:u.token_version,suc:u.sucursal_id},process.env.JWT_SECRET,{expiresIn:'1h'});
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,
      headers:{Authorization:`Bearer ${token}`,'X-Sucursal-Id':s.id,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
  };
  const history = '/ajustes-inventario?periodo=2026-10';
  const list = await req('GET',history); assert.equal(list.status,200,JSON.stringify(list));
  assert.equal(list.data.total,3,'Los dos lotes se agrupan en un solo conteo');
  const a = list.data.ajustes.find(a=>a.insumo==='Leche KS');
  assert.equal(a.movimientos,'2'); assert.equal(a.diferencia,-5); assert.equal(a.costo,117.5);
  assert.equal(a.cantidad_anterior,null); assert.equal(a.cantidad_contada,null);
  assert.equal(a.fecha_contable,'2026-10-01');
  assert.equal((await req('GET',history,undefined,cashier)).status,403);
  assert.equal((await req('GET',history,undefined,foreign)).data.total,0);
  assert.equal((await req('GET',`/ajustes-inventario/${a.id}`,undefined,foreign)).status,404);
  const snapshot = async () => ({
    stock:(await query('SELECT * FROM materias_primas ORDER BY id')).rows,
    lots:(await query('SELECT * FROM lotes ORDER BY id')).rows,
    movements:(await query('SELECT * FROM movimientos_inventario ORDER BY id')).rows,
    flowSep:await A.flujoDinero(query,s.id,'2026-09'),flowOct:await A.flujoDinero(query,s.id,'2026-10'),
  });
  const before = await snapshot();
  assert.equal((await A.estadoResultados(query,s.id,'2026-10')).costoVentas.ajustesConteo,441.1);
  const patch = {fechaContable:'2026-09-30',motivo:'Conteo físico al cierre de septiembre',razonCambio:'Capturado el 1 de octubre; corresponde al cierre anterior.',version:a.version};
  const path = `/ajustes-inventario/${a.id}`;
  assert.equal((await req('PATCH',path,patch,cashier)).status,403);
  assert.equal((await req('PATCH',path,patch,foreign)).status,404);
  for (const fechaContable of ['2026-09-31','2099-01-01','no-fecha']) assert.equal((await req('PATCH',path,{...patch,fechaContable})).status,400);
  assert.equal((await req('PATCH',path,{...patch,nuevaCantidad:99})).status,400);
  assert.equal((await req('PATCH',path,{...patch,razonCambio:''})).status,400);
  const close = period => req('POST','/contabilidad/cierres',{periodo:period});
  const reopen = period => req('DELETE',`/contabilidad/cierres/${period}`,{motivo:'QA reapertura'});
  assert.equal((await close('2026-10')).status,201);
  assert.equal((await req('PATCH',path,patch)).status,409,'No se mueve el costo fuera de un mes cerrado');
  await reopen('2026-10');
  assert.equal((await close('2026-09')).status,201);
  assert.equal((await req('PATCH',path,patch)).status,409,'No entra costo a un mes cerrado');
  await reopen('2026-09');
  const saves = await Promise.all([req('PATCH',path,patch),req('PATCH',path,patch)]);
  assert.deepEqual(saves.map(r=>r.status).sort(),[200,409],JSON.stringify(saves));
  assert.deepEqual(await snapshot(),before,'Editar fecha no toca stock, lotes, movimientos ni flujo de dinero');
  let detail = (await req('GET',path)).data;
  assert.equal(detail.fecha_contable,'2026-09-30'); assert.equal(detail.creado_en,a.creado_en);
  assert.equal(detail.cambios.length,1); assert.equal(detail.cambios[0].valor_anterior.fechaContable,'2026-10-01');
  assert.equal(detail.cambios[0].valor_nuevo.fechaContable,'2026-09-30');
  assert.equal((await A.estadoResultados(query,s.id,'2026-09')).costoVentas.ajustesConteo,117.5);
  assert.equal((await A.estadoResultados(query,s.id,'2026-10')).costoVentas.ajustesConteo,323.6);
  assert.equal((await req('GET',history)).data.total,3,'Sigue visible por fecha de captura');
  assert.equal((await req('GET','/ajustes-inventario?periodo=2026-09&por=contable')).data.total,1);
  assert.equal((await req('GET',`${history}&insumo=${a.materia_prima_id}`)).data.total,1);
  assert.equal((await req('GET',`${history}&offset=50`)).data.ajustes.length,0);
  // Nuevo conteo de cierre: fecha explícita, dos lotes, guardado idempotente.
  const create = {nuevaCantidad:12,stockEsperado:15,motivo:'Otro conteo de cierre QA',fechaContable:'2026-09-30',clientUuid:randomUUID()};
  const createPath = `/materias-primas/${a.materia_prima_id}/ajustar-stock`;
  const created = await Promise.all([req('POST',createPath,create),req('POST',createPath,create)]);
  assert.deepEqual(created.map(r=>r.status),[200,200],JSON.stringify(created));
  assert.equal(created[0].data.ajusteId,created[1].data.ajusteId);
  assert.equal(Number(created[0].data.stock_actual),12);
  const newDetail = (await req('GET',`/ajustes-inventario/${created[0].data.ajusteId}`)).data;
  assert.equal(newDetail.cantidad_anterior,15); assert.equal(newDetail.cantidad_contada,12);
  assert.equal(newDetail.fecha_contable,'2026-09-30'); assert.equal(newDetail.costo,70.5);
  assert.equal((await A.estadoResultados(query,s.id,'2026-09')).costoVentas.ajustesConteo,188);
  assert.equal((await A.estadoResultados(query,s.id,'2026-10')).costoVentas.ajustesConteo,323.6);
  const afterCreate = await snapshot();
  assert.equal((await req('POST',createPath,{...create,nuevaCantidad:11})).status,409);
  await close('2026-09');
  assert.equal((await req('POST',createPath,create)).status,200,'Reintento confirmado incluso si el mes ya se cerró');
  assert.equal((await req('POST',createPath,{...create,clientUuid:randomUUID(),stockEsperado:12,nuevaCantidad:11})).status,409);
  assert.deepEqual(await snapshot(),afterCreate);
  await reopen('2026-09');
  // Corregir solo la nota mantiene fecha, costo y stock, pero deja auditoría.
  assert.equal((await req('PATCH',path,{...patch,version:detail.version,motivo:'Conteo revisado',razonCambio:'Aclaración del responsable del conteo'})).status,200);
  detail = (await req('GET',path)).data;
  assert.equal(detail.cambios.length,2); assert.equal(detail.fecha_contable,'2026-09-30');
  assert.deepEqual(await snapshot(),afterCreate);
  // La transacción revierte tanto el cambio de fecha como su auditoría.
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await require('../src/services/stockAdjustmentHistory').corregir(c,{sucursalId:s.id,usuarioId:admin.id,id:a.id,
      body:{...patch,fechaContable:'2026-10-01',version:detail.version}});
  } finally { await c.query('ROLLBACK'); c.release(); }
  assert.equal((await req('GET',path)).data.cambios.length,2);
  assert.equal((await req('GET',path)).data.fecha_contable,'2026-09-30');
  console.log('PASS: ajustes anteriores visibles; lotes agrupados; septiembre/octubre conciliados sin mover stock ni caja; fechas originales; permisos; meses cerrados; auditoría; doble envío; filtros y reversión de transacción.');
})().catch(e=>{ console.error(e);process.exitCode=1; }).finally(async()=>{if(server) await new Promise(r=>server.close(r));await pool.end();});
