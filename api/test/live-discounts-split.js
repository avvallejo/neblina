// Prueba integral HTTP/SQL; se ejecuta únicamente en una base desechable.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {pool,query}=require('../src/db');
const app=require('../src/app');
let server;
(async()=>{
  assert.equal(process.env.NODE_ENV,'development');
  assert.match(process.env.PGDATABASE,/^codex_cuentas_/);
  const one=async(sql,p=[]) => (await query(sql,p)).rows[0];
  const s=await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA cuentas '||gen_random_uuid()::text,'QA'||upper(substr(md5(random()::text),1,3))) RETURNING id");
  const other=await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA otra '||gen_random_uuid()::text,'QB'||upper(substr(md5(random()::text),1,3))) RETURNING id");
  const user=async(role,branch,pin)=>one('INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES($1,$2,$3,$4) RETURNING *',[`QA ${role}`,role,await bcrypt.hash(pin,4),branch]);
  const cashier=await user('cajero',s.id,'7391'),admin=await user('admin',s.id,'8264'),another=await user('cajero',s.id,'5917'),foreign=await user('admin',other.id,'4197');
  await query('INSERT INTO turnos(sucursal_id,abierto_por,fondo_inicial) VALUES($1,$2,0)',[s.id,cashier.id]);
  const cat=await one("INSERT INTO categorias_producto(nombre,sucursal_id) VALUES('QA alimentos',$1) RETURNING id",[s.id]);
  const mc=await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA insumos',$1) RETURNING id",[s.id]);
  const mat=await one("INSERT INTO materias_primas(nombre,categoria_id,unidad,stock_actual,costo_unitario,sucursal_id) VALUES('QA pieza',$1,'pieza',100,5,$2) RETURNING id",[mc.id,s.id]);
  await query('UPDATE materias_primas SET requiere_lote=true WHERE id=$1',[mat.id]);
  const lot=await one("INSERT INTO lotes(materia_prima_id,cantidad_comprada,cantidad_disponible,unidad,costo_total,usuario_id) VALUES($1,100,100,'pieza',500,$2) RETURNING id",[mat.id,admin.id]);
  const product=await one(`INSERT INTO productos(nombre,categoria_id,tipo,precio_base,permite_tamanos,permite_leche,permite_tipo_cafe,permite_extras,sucursal_id,estacion)
    VALUES('QA snack',$1,'snack',100,false,false,false,false,$2,'barra') RETURNING id`,[cat.id,s.id]);
  await query("INSERT INTO receta_insumos_fijos(producto_id,materia_prima_id,cantidad,unidad) VALUES($1,$2,1,'pieza')",[product.id,mat.id]);
  const token=(u,expiresIn='12h')=>jwt.sign({tipo:'staff',id:u.id,ver:u.token_version,suc:u.sucursal_id},process.env.JWT_SECRET,{expiresIn});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  async function req(method,path,body,u=cashier,rawToken) {
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:`Bearer ${rawToken||token(u)}`,'X-Sucursal-Id':s.id,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json(),renewed:r.headers.get('X-Session-Token')};
  }
  const ok=async(method,path,body,u=cashier,status=200)=>{const r=await req(method,path,body,u);assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
  const draft=(qty=1)=>({clientUuid:randomUUID(),nombreTicket:randomUUID().slice(0,8),destino:'llevar',items:[{productoId:product.id,cantidad:qty}]});
  const discount=(overrides={})=>({clientUuid:randomUUID(),tipo:'empleado',descuentoPorcentaje:50,motivo:'Consumo de empleado QA',...overrides});
  const stock=async()=>Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1',[mat.id])).stock_actual);
  assert.deepEqual(await ok('GET','/descuentos/config'),{empleado:false,porcentajes:[]});
  assert.equal((await req('PUT','/descuentos/config',{empleado:true})).status,403);
  const pendingBody=discount();
  const pending=await ok('POST','/descuentos',pendingBody,cashier,201);
  assert.equal(pending.estado,'pendiente');
  assert.equal((await ok('POST','/descuentos',pendingBody,cashier,201)).id,pending.id);
  const saleBody={...draft(),descuentoPorcentaje:50,autorizacionDescuento:pending.id};
  assert.equal((await req('POST','/pedidos',saleBody)).status,409);
  assert.equal((await req('PATCH',`/descuentos/${pending.id}/autorizar`,{},foreign)).status,409);
  assert.equal((await req('PATCH',`/descuentos/${pending.id}/autorizar`,{})).status,403);
  await ok('PATCH',`/descuentos/${pending.id}/autorizar`,{},admin);
  assert.equal((await req('POST','/pedidos',saleBody,another)).status,409);
  assert.equal((await req('POST','/pedidos',{...saleBody,descuentoPorcentaje:20})).status,409);
  assert.equal((await req('POST','/pedidos',{...saleBody,items:[{productoId:product.id,cantidad:1,esCortesia:true}]})).status,400);
  const discounted=await ok('POST','/pedidos',saleBody,cashier,201);
  assert.equal(Number(discounted.pedido.total),50);assert.equal(Number(discounted.pedido.cortesia_valor),0);assert.equal(discounted.items[0].es_cortesia,false);
  assert.equal((await ok('POST','/pedidos',saleBody)).pedido.id,discounted.pedido.id);
  assert.equal((await req('POST','/pedidos',{...saleBody,clientUuid:randomUUID()})).status,409);
  await ok('PATCH',`/pedidos/${discounted.pedido.id}/cobrar`,{metodoPago:'efectivo',montoRecibido:50,totalEsperado:50});
  assert.equal((await one('SELECT metodo_pago FROM pedidos WHERE id=$1',[discounted.pedido.id])).metodo_pago,'efectivo');
  assert.equal((await req('POST','/descuentos',discount({pin:'9999'}))).status,403);
  assert.equal(Number((await one('SELECT count(*) n FROM intentos_autorizacion_descuento WHERE solicitante_id=$1 AND NOT exitoso',[cashier.id])).n),1);
  assert.equal((await req('POST','/descuentos',discount({pin:'4197'}))).status,403);
  const pin=await ok('POST','/descuentos',discount({pin:'8264'}),cashier,201);assert.equal(pin.via,'pin');assert.equal(pin.autorizador_id,admin.id);
  const byPin=await ok('POST','/pedidos',{...draft(),descuentoPorcentaje:50,autorizacionDescuento:pin.id},cashier,201);assert.equal(Number(byPin.pedido.total),50);
  const invalid=await req('POST','/descuentos',discount({descuentoPorcentaje:30}));assert.equal(invalid.status,400);
  assert.equal((await req('POST','/descuentos',discount({tipo:'promocion',descuentoPorcentaje:100}))).status,400);
  await ok('PUT','/descuentos/config',{empleado:true,porcentajes:[10,20]},admin);
  const auto=await ok('POST','/descuentos',discount(),cashier,201);assert.equal(auto.via,'configuracion');assert.equal(auto.estado,'autorizada');
  const promo=await ok('POST','/descuentos',discount({tipo:'promocion',descuentoPorcentaje:15}),cashier,201);assert.equal(promo.estado,'pendiente');
  await ok('PATCH',`/descuentos/${promo.id}/rechazar`,{},admin);
  assert.equal((await req('POST','/pedidos',{...draft(),descuentoPorcentaje:15,autorizacionDescuento:promo.id})).status,409);
  await query("UPDATE solicitudes_descuento SET expira_en=now()-interval '1 second' WHERE id=$1",[auto.id]);
  assert.equal((await req('POST','/pedidos',{...draft(),descuentoPorcentaje:50,autorizacionDescuento:auto.id})).status,409);
  // Ticket existente: aplicar y recuperar el mismo resultado si se perdió la respuesta.
  const open=await ok('POST','/pedidos',draft(4),cashier,201);
  const permission=await ok('POST','/descuentos',discount({pedidoId:open.pedido.id}),cashier,201);
  const apply={descuentoPorcentaje:50,autorizacionDescuento:permission.id,totalEsperado:400};
  assert.equal(Number((await ok('PATCH',`/pedidos/${open.pedido.id}/descuento`,apply)).total),200);
  assert.equal(Number((await ok('PATCH',`/pedidos/${open.pedido.id}/descuento`,apply)).total),200);
  // Preparar 4 consume 4; dividir 2 terminados no altera existencias ni vuelve a preparar.
  const item=open.items[0];
  await ok('PATCH',`/pedido-items/${item.id}/iniciar`,{},admin);
  await ok('PATCH',`/pedido-items/${item.id}/terminar`,{},admin);assert.equal(await stock(),96);
  await ok('PATCH',`/pedidos/${open.pedido.id}/items/${item.id}/entregar`,{cantidad:3,cantidadEsperada:0});
  const separate={clientUuid:randomUUID(),nombre:'QA segunda cuenta',totalEsperado:200,items:[{id:item.id,cantidad:2,cantidadEsperada:4}]};
  const responses=await Promise.all([req('POST',`/pedidos/${open.pedido.id}/separar`,separate),req('POST',`/pedidos/${open.pedido.id}/separar`,separate)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);assert.equal(responses[0].data.cuenta.id,responses[1].data.cuenta.id);
  const child=responses[0].data.cuenta;
  assert.equal(await stock(),96);assert.equal(Number(child.total),100);
  const originDetail=await ok('GET',`/pedidos/${open.pedido.id}`),childDetail=await ok('GET',`/pedidos/${child.id}`);
  assert.equal(Number(originDetail.total)+Number(childDetail.total),200);
  assert.equal(childDetail.cuenta_origen_folio,originDetail.folio);assert.equal(childDetail.items[0].estado,'terminado');assert.equal(childDetail.items[0].cantidad,2);assert.equal(childDetail.items[0].cantidad_entregada,2);assert.equal(originDetail.items[0].cantidad_entregada,1);
  assert.equal(childDetail.items[0].terminado_por,admin.id);assert.equal(childDetail.items[0].terminado_en,originDetail.items[0].terminado_en);
  assert.equal(Number((await one("SELECT SUM(cantidad) n FROM movimientos_inventario WHERE materia_prima_id=$1 AND tipo='consumo'",[mat.id])).n),-4);
  await ok('PATCH',`/pedidos/${child.id}/cobrar`,{metodoPago:'transferencia',totalEsperado:100});
  assert.equal((await req('POST',`/pedidos/${child.id}/separar`,{...separate,clientUuid:randomUUID(),totalEsperado:100})).status,409);
  const drawerBefore=await ok('GET','/turnos/actual/caja');assert.equal(Number(drawerBefore.ventas_turno),150);assert.equal(Number(drawerBefore.ventas_efectivo),50);assert.equal(Number(drawerBefore.ventas_transferencia),100);assert.equal(Number(drawerBefore.cortesias_valor_turno),0);
  // Cancelar una cuenta devuelve solo SUS 2 unidades; repetir no duplica devolución.
  await ok('PATCH',`/pedidos/${child.id}/cancelar`,{motivo:'Prueba devolución de una cuenta'},admin);assert.equal(await stock(),98);
  assert.equal((await req('PATCH',`/pedidos/${child.id}/cancelar`,{motivo:'Prueba repetida'},admin)).status,409);assert.equal(await stock(),98);
  const drawerAfter=await ok('GET','/turnos/actual/caja');assert.equal(Number(drawerAfter.ventas_turno),50);assert.equal(Number(drawerAfter.ventas_transferencia),0);
  const audit=await ok('GET','/descuentos',undefined,admin);
  assert.ok(audit.some(r=>r.via==='pin'));assert.ok(audit.some(r=>r.via==='modulo'&&r.usada_en));assert.ok(audit.some(r=>r.via==='configuracion'&&r.usada_en));
  assert.equal((await ok('GET','/descuentos',undefined,foreign)).length,0);
  assert.equal(Number((await one('SELECT cantidad_disponible FROM lotes WHERE id=$1',[lot.id])).cantidad_disponible),98);
  // Preparación iniciada conserva responsable, estado y extras al separar cantidades.
  const partial=await ok('POST','/pedidos',draft(3),cashier,201);
  await ok('PATCH',`/pedido-items/${partial.items[0].id}/iniciar`,{},admin);
  const inProgress=await ok('POST',`/pedidos/${partial.pedido.id}/separar`,{clientUuid:randomUUID(),nombre:'En preparación',totalEsperado:300,items:[{id:partial.items[0].id,cantidad:1,cantidadEsperada:3}]},cashier,201);
  const progressDetail=await ok('GET',`/pedidos/${inProgress.cuenta.id}`);assert.equal(progressDetail.items[0].estado,'en_preparacion');assert.equal(progressDetail.items[0].barista_id,admin.id);assert.equal(await stock(),98);
  await ok('PATCH',`/pedido-items/${progressDetail.items[0].id}/terminar`,{},admin);assert.equal(await stock(),97);
  await ok('PATCH',`/pedido-items/${partial.items[0].id}/terminar`,{},admin);assert.equal(await stock(),95);
  // Redondeos: muchas cuentas de un centavo conservan el total y nunca quedan negativas.
  await query('UPDATE productos SET precio_base=0.01 WHERE id=$1',[product.id]);
  const tinyAuth=await ok('POST','/descuentos',discount(),cashier,201);
  const tiny=await ok('POST','/pedidos',{...draft(6),descuentoPorcentaje:50,autorizacionDescuento:tinyAuth.id},cashier,201);
  let sum=0;
  for(let n=6;n>1;n--){
    const before=await ok('GET',`/pedidos/${tiny.pedido.id}`);
    const part=await ok('POST',`/pedidos/${tiny.pedido.id}/separar`,{clientUuid:randomUUID(),nombre:'Centavos',totalEsperado:Number(before.total),items:[{id:tiny.items[0].id,cantidad:1,cantidadEsperada:n}]},cashier,201);
    assert.ok(Number(part.cuenta.total)>=0);sum+=Math.round(Number(part.cuenta.total)*100);
    const after=await ok('GET',`/pedidos/${tiny.pedido.id}`);assert.ok(Number(after.total)>=0);
  }
  sum+=Math.round(Number((await ok('GET',`/pedidos/${tiny.pedido.id}`)).total)*100);assert.equal(sum,3);
  const rounded=await ok('GET',`/pedidos/${tiny.pedido.id}`);
  const roundedTotal=Number(rounded.total);
  await ok('PATCH',`/pedidos/${tiny.pedido.id}/cobrar`,{metodoPago:'efectivo',montoRecibido:roundedTotal,totalEsperado:roundedTotal,itemsCortesia:[]});
  assert.equal(Number((await ok('GET',`/pedidos/${tiny.pedido.id}`)).total),roundedTotal);
  // Elegir PIN siempre valida: no puede caer en permisos de caja o rol admin.
  const inactive=await user('admin',s.id,'6842');
  await query('UPDATE usuarios SET activo=false WHERE id=$1',[inactive.id]);
  const barista=await user('barista',s.id,'1753');
  const general=await user('admin',null,'7943');
  const pinTester=await user('cajero',s.id,'1739');
  const pinRequest=(pin,extra={})=>discount({medioAutorizacion:'pin',pin,...extra});
  for(const invalidPin of ['9999','5917','6842','4197']) {
    const denial=await req('POST','/descuentos',pinRequest(invalidPin),another);
    assert.equal(denial.status,403,JSON.stringify(denial.data));
    assert.equal(denial.data.details.codigo,'pin_administrador_invalido');
  }
  assert.equal((await req('POST','/descuentos',pinRequest('9999'),admin)).status,403,'El rol admin no debe ignorar un PIN incorrecto');
  assert.equal((await req('POST','/descuentos',pinRequest('1753'),pinTester)).status,403,'El PIN de barista no autoriza');
  for(const missing of [undefined,null,'',1234,'123','12345']) {
    assert.equal((await req('POST','/descuentos',pinRequest(missing),pinTester)).status,400,'PIN requerido con formato exacto');
  }
  const validPinBody=pinRequest('8264');
  const validPin=await ok('POST','/descuentos',validPinBody,another,201);
  assert.equal(validPin.via,'pin');assert.equal(validPin.autorizador_id,admin.id);
  assert.equal((await ok('POST','/descuentos',validPinBody,another,201)).id,validPin.id,'Reintento válido conserva la solicitud');
  const replayWrong=await req('POST','/descuentos',{...validPinBody,pin:'9999'},another);
  assert.equal(replayWrong.status,403,'Un reintento no valida un PIN falso');
  assert.equal((await req('POST','/descuentos',pinRequest('8264'),another)).status,429,'Cinco fallos persisten y bloquean PIN');
  const globalPin=await ok('POST','/descuentos',pinRequest('7943'),pinTester,201);
  const globalAuthorizer=await one('SELECT rol,activo,sucursal_id FROM usuarios WHERE id=$1',[globalPin.autorizador_id]);
  assert.deepEqual(globalAuthorizer,{rol:'admin',activo:true,sucursal_id:null});assert.equal(globalPin.via,'pin');
  const explicitRequest=await ok('POST','/descuentos',discount({medioAutorizacion:'modulo'}),pinTester,201);
  assert.equal(explicitRequest.estado,'pendiente','Elegir el módulo no autoriza automáticamente');
  const forbiddenDirect=await req('POST','/descuentos',discount({tipo:'promocion',descuentoPorcentaje:25,medioAutorizacion:'directo'}),pinTester);
  assert.equal(forbiddenDirect.status,403);
  assert.equal(Number((await one('SELECT count(*) n FROM intentos_autorizacion_descuento WHERE solicitante_id=$1 AND NOT exitoso',[another.id])).n),5);
  // El historial conserva quién validó el PIN y no crea descuentos por intentos fallidos.
  assert.equal(Number((await one('SELECT count(*) n FROM solicitudes_descuento WHERE solicitante_id=$1',[another.id])).n),1);
  console.log('PASS: PIN incorrecto, de caja, de barra, admin inactivo y otra sede rechazados; PIN local/general válido; sin bypass por configuración, rol o reintento; bloqueo persistente y vía de autorización explícita.');
  // Sesión próxima a vencer: renueva firmada; expirada/revocada nunca se acepta.
  const near=await req('GET','/auth/yo',undefined,cashier,token(cashier,'5m'));assert.equal(near.status,200);assert.ok(near.renewed);
  assert.ok(jwt.verify(near.renewed,process.env.JWT_SECRET).exp>Date.now()/1000+11*3600);
  const expired=await req('POST','/pedidos',draft(),cashier,token(cashier,'-1s'));assert.equal(expired.status,401);assert.equal(expired.data.details.codigo,'sesion_requerida');assert.equal(expired.renewed,null);
  await query('UPDATE usuarios SET token_version=token_version+1 WHERE id=$1',[cashier.id]);
  const revoked=await req('GET','/auth/yo',undefined,cashier,near.renewed);assert.equal(revoked.status,401);assert.equal(revoked.renewed,null);
  assert.equal((await req('POST','/auth/login',{pin:'5917',usuarioId:cashier.id,sucursalId:s.id})).status,401);
  const restored=await ok('POST','/auth/login',{pin:'7391',usuarioId:cashier.id,sucursalId:s.id});assert.equal(restored.usuario.id,cashier.id);
  console.log('PASS: política por sede, empleado 50%, PIN y módulo, consumo único y auditoría; cobro de diferencia sin cortesía; separación concurrente sin doble inventario, entrega conservada y devolución proporcional; sesión renovada, expirada, revocada y confirmación del mismo usuario.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();});
