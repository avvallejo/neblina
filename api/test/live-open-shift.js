// Prueba HTTP/SQL de ventas y cierre concurrente. Solo base desechable.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const jwt=require('jsonwebtoken');
const {pool,query}=require('../src/db');
const app=require('../src/app');
let server;
(async()=>{
  assert.equal(process.env.NODE_ENV,'development');
  assert.match(process.env.PGDATABASE,/^codex_turno_guard_/,'Solo base desechable');
  const one=async(sql,values=[]) => (await query(sql,values)).rows[0];
  const s=await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA turno obligatorio','QATO') RETURNING id");
  const other=await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA otra caja','QAOT') RETURNING id");
  const u=await one("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES('QA cajero','cajero','unused',$1) RETURNING *",[s.id]);
  const u2=await one("INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES('QA otra','cajero','unused',$1) RETURNING *",[other.id]);
  await query('INSERT INTO turnos(sucursal_id,abierto_por,fondo_inicial) VALUES($1,$2,0)',[other.id,u2.id]);
  const cat=await one("INSERT INTO categorias_producto(nombre,sucursal_id) VALUES('QA bebidas',$1) RETURNING id",[s.id]);
  const matCat=await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA insumos',$1) RETURNING id",[s.id]);
  const mat=await one("INSERT INTO materias_primas(nombre,categoria_id,unidad,stock_actual,costo_unitario,sucursal_id) VALUES('QA insumo',$1,'pieza',100,5,$2) RETURNING id",[matCat.id,s.id]);
  const p=await one(`INSERT INTO productos(nombre,categoria_id,tipo,precio_base,permite_tamanos,permite_leche,permite_tipo_cafe,permite_extras,sucursal_id)
    VALUES('QA café',$1,'bebida',25,false,false,false,false,$2) RETURNING id`,[cat.id,s.id]);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const token=jwt.sign({tipo:'staff',id:u.id,ver:u.token_version,suc:s.id},process.env.JWT_SECRET,{expiresIn:'5m'});
  const req=async(method,path,body)=>{
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
  };
  const order=(paid=false)=>({clientUuid:randomUUID(),nombreTicket:`QA ${randomUUID().slice(0,8)}`,destino:'llevar',items:[{productoId:p.id,cantidad:1}],...(paid?{pago:{metodoPago:'efectivo',montoRecibido:25}}:{})});
  const now=await one("SELECT to_char(now() AT TIME ZONE 'America/Mexico_City','YYYY-MM-DD') fecha,to_char(now() AT TIME ZONE 'America/Mexico_City','HH24:MI') hora");
  const direct={...now,claveRegistro:randomUUID(),motivo:'Prueba de turno obligatorio',metodoPago:'efectivo',montoRecibido:10,
    items:[{concepto:'QA venta libre',precioUnitario:10,motivoPrecio:'Precio de prueba',cantidad:1,insumoId:mat.id,cantidadInsumo:1,unidadInsumo:'pieza'}]};
  const count=async()=>Number((await one('SELECT count(*) n FROM pedidos WHERE sucursal_id=$1',[s.id])).n);
  const stock=async()=>Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1',[mat.id])).stock_actual);
  const blocked=async(method,path,body)=>{const r=await req(method,path,body);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.data.details.codigo,'turno_cerrado');};
  await blocked('POST','/pedidos',order());await blocked('POST','/pedidos',order(true));await blocked('POST','/ventas-directas',direct);
  let sync=await req('POST','/sync/batch',{operaciones:[{tipo:'crear_pedido',clientUuid:randomUUID(),payload:{items:[{productoId:p.id,cantidad:1}]}}]});
  assert.equal(sync.data.resultados[0].estado,'error');assert.match(sync.data.resultados[0].error,/Abre un turno/);
  assert.equal(await count(),0);assert.equal(await stock(),100);
  await assert.rejects(()=>query("INSERT INTO pedidos(origen,sucursal_id,total) VALUES('mostrador',$1,25)",[s.id]),e=>e.code==='22023');
  await assert.rejects(()=>query("INSERT INTO pedidos(origen,sucursal_id,total,cobrado,registro_manual,metodo_pago) VALUES('mostrador',$1,25,true,true,'efectivo')",[s.id]),e=>e.code==='22023');
  const opened=await req('POST','/turnos/abrir',{fondoInicial:200});assert.equal(opened.status,201,JSON.stringify(opened));
  const t=opened.data;
  const body=order(true),sale=await req('POST','/pedidos',body);assert.equal(sale.status,201,JSON.stringify(sale));
  assert.equal(sale.data.pedido.turno_cobro_id,t.id);
  const pending=await req('POST','/pedidos',order());assert.equal(pending.status,201,JSON.stringify(pending));
  const manual=await req('POST','/ventas-directas',direct);assert.equal(manual.status,201,JSON.stringify(manual));
  assert.equal(manual.data.pedido.turno_id,t.id);assert.equal(manual.data.pedido.turno_cobro_id,t.id);assert.equal(await stock(),99);
  const caja=await req('GET','/turnos/actual/caja');assert.equal(Number(caja.data.ventas_efectivo),35);
  assert.equal((await req('POST','/turnos/cerrar')).status,200);
  await blocked('POST','/pedidos',order());await blocked('POST','/pedidos',order(true));
  await blocked('POST','/ventas-directas',{...direct,claveRegistro:randomUUID()});
  await blocked('PATCH',`/pedidos/${pending.data.pedido.id}/cobrar`,{metodoPago:'efectivo',montoRecibido:25});
  await blocked('POST',`/pedidos/${pending.data.pedido.id}/items`,{items:[{productoId:p.id,cantidad:1}]});
  const item=await one('SELECT id FROM pedido_items WHERE pedido_id=$1',[pending.data.pedido.id]);
  await blocked('PATCH',`/pedidos/${pending.data.pedido.id}/items/${item.id}`,{cantidad:2,cantidadEsperada:1});
  await assert.rejects(()=>query("UPDATE pedidos SET cobrado=true,metodo_pago='efectivo' WHERE id=$1",[pending.data.pedido.id]),e=>e.code==='22023');
  await assert.rejects(()=>query('UPDATE pedido_items SET cantidad=2 WHERE id=$1',[item.id]),e=>e.code==='22023');
  assert.equal((await req('POST','/pedidos',body)).data.yaExistia,true);
  assert.equal((await req('POST','/ventas-directas',direct)).data.repetido,true);
  assert.equal(await count(),3);assert.equal(await stock(),99);
  assert.equal((await req('GET','/turnos/cortes')).status,200);
  const opened2=await req('POST','/turnos/abrir',{fondoInicial:100});assert.equal(opened2.status,201);
  const collected=await req('PATCH',`/pedidos/${pending.data.pedido.id}/cobrar`,{metodoPago:'efectivo',montoRecibido:25});
  assert.equal(collected.status,200,JSON.stringify(collected));assert.equal(collected.data.turno_cobro_id,opened2.data.id);
  const historical=await one(`INSERT INTO turnos(sucursal_id,abierto_por,abierto_en,cerrado_en,fondo_inicial,corte)
    VALUES($1,$2,now()-interval '3 days',now()-interval '1 day',0,'{}') RETURNING (abierto_en AT TIME ZONE 'America/Mexico_City')::date::text fecha`,[s.id,u.id]);
  const historyFail=await req('POST','/ventas-directas',{...direct,claveRegistro:randomUUID(),fecha:historical.fecha,hora:'23:59'});
  assert.equal(historyFail.status,400,JSON.stringify(historyFail));assert.match(historyFail.data.error,/corte guardado/);
  const noShift=await req('POST','/ventas-directas',{...direct,claveRegistro:randomUUID(),fecha:'2020-01-01'});
  assert.equal(noShift.status,400);assert.match(noShift.data.error,/No había un turno/);assert.equal(await stock(),99);
  // La sesión que intenta vender espera al cierre, luego ve cerrado y falla.
  const c=await pool.connect();
  try {
    await c.query('BEGIN');await c.query('SELECT id FROM turnos WHERE id=$1 FOR UPDATE',[opened2.data.id]);
    const racing=req('POST','/pedidos',order(true));
    let waiting=false;
    for(let i=0;i<40&&!waiting;i++){
      const row=await one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM turnos%FOR SHARE%') AS waiting");
      waiting=row.waiting;if(!waiting)await new Promise(r=>setTimeout(r,25));
    }
    await c.query('UPDATE turnos SET cerrado_en=now() WHERE id=$1',[opened2.data.id]);await c.query('COMMIT');
    assert.equal((await racing).status,409);assert.equal(waiting,true,'La venta debe esperar el bloqueo de cierre');
  } finally {await c.query('ROLLBACK');c.release();}
  assert.equal(await count(),3);assert.equal(await stock(),99);
  console.log('PASS: bloqueo HTTP/SQL de pedidos, pagos, directas, sincronización y adicionales; aislamiento por sede; apertura y arqueo; cobro pendiente en nuevo turno; historial y reintentos; fechas sin turno/corte final; cierre concurrente sin ventas ni inventario huérfanos.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();});
