const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { query, pool } = require('../src/db');
const app = require('../src/app');
let server;
(async () => {
  assert.match(process.env.PGDATABASE, /^codex_open_/, 'Solo base desechable');
  const one = async (sql, values=[]) => (await query(sql,values)).rows[0];
  const s = await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA abiertos','QAOP') RETURNING id");
  const other = await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA otra','QAOT') RETURNING id");
  const staff = async (sede,rol='cajero') => one('INSERT INTO usuarios(nombre,rol,pin_hash,sucursal_id) VALUES($1,$2,$3,$4) RETURNING *',['QA',rol,'unused-test-hash',sede]);
  const cashier=await staff(s.id), cashier2=await staff(other.id), barista=await staff(s.id,'barista'), mostrador=await staff(s.id,'mostrador');
  await query('INSERT INTO turnos(abierto_por,sucursal_id,fondo_inicial) VALUES($1,$2,0)',[cashier.id,s.id]);
  const cp=await one("INSERT INTO categorias_producto(nombre,sucursal_id) VALUES('QA comida',$1) RETURNING id",[s.id]);
  const cm=await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA insumos',$1) RETURNING id",[s.id]);
  const ingredient=await one("INSERT INTO materias_primas(nombre,categoria_id,unidad,stock_actual,costo_unitario,sucursal_id) VALUES('QA carne',$1,'pieza',100,10,$2) RETURNING id",[cm.id,s.id]);
  const product=await one(`INSERT INTO productos(nombre,categoria_id,tipo,precio_base,permite_tamanos,permite_leche,permite_tipo_cafe,permite_extras,sucursal_id,estacion)
    VALUES('QA Hamburguesa',$1,'alimento',50,false,false,false,true,$2,'parrilla') RETURNING id`,[cp.id,s.id]);
  await query("INSERT INTO receta_insumos_fijos(producto_id,materia_prima_id,cantidad,unidad) VALUES($1,$2,1,'pieza')",[product.id,ingredient.id]);
  const extra=await one("INSERT INTO opciones_extra(codigo,etiqueta,delta_precio,aplica_a,sucursal_id) VALUES('qa','Queso QA',5,'alimentos',$1) RETURNING id",[s.id]);
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api`;
  const req=async (method,path,body,user=cashier) => {
    const token=jwt.sign({tipo:'staff',id:user.id,rol:user.rol,ver:user.token_version,suc:user.sucursal_id},process.env.JWT_SECRET);
    const r=await fetch(url+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
  };
  const line={productoId:product.id,cantidad:1};
  const create=async () => {
    const r=await req('POST','/pedidos',{destino:'mesa',mesa:1,items:[line]});
    assert.equal(r.status,201,JSON.stringify(r.data)); assert.equal(r.data.pedido.cobrado,false);
    return r.data.pedido;
  };
  const detail=async id => (await req('GET',`/pedidos/${id}`)).data;
  const order=await create();
  const first=(await detail(order.id)).items[0];
  let r=await req('GET','/pedido-items/cola',undefined,mostrador);
  assert.equal(r.status,200,JSON.stringify(r.data)); assert(r.data.some(i=>i.id===first.id),'Unpaid order appears immediately in kitchen');
  assert.equal(Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1',[ingredient.id])).stock_actual),100);
  r=await req('POST',`/pedidos/${order.id}/items`,{items:[{...line,extraIds:[extra.id],notas:'Sin tomate'}]});
  assert.equal(r.status,201,JSON.stringify(r.data)); assert.equal(Number(r.data.total),105); assert.equal(r.data.folio,order.folio);
  let d=await detail(order.id), second=d.items.find(i=>i.id!==first.id);
  assert.deepEqual(second.extras,['Queso QA']); assert.equal(second.notas,'Sin tomate');
  r=await req('PATCH',`/pedidos/${order.id}/items/${first.id}`,{cantidad:3,cantidadEsperada:1});
  assert.equal(r.status,200,JSON.stringify(r.data)); assert.equal(Number(r.data.total),205);
  r=await req('PATCH',`/pedidos/${order.id}/items/${first.id}`,{cantidad:2,cantidadEsperada:1}); assert.equal(r.status,409);
  r=await req('PATCH',`/pedidos/${order.id}/items/${first.id}`,{cantidad:-1,cantidadEsperada:3}); assert.equal(r.status,400);
  r=await req('POST',`/pedidos/${order.id}/items`,{items:[line]},cashier2); assert.equal(r.status,404);
  r=await req('POST',`/pedidos/${order.id}/items`,{items:[line]},barista); assert.equal(r.status,403);
  r=await req('POST',`/pedidos/${order.id}/items`,{items:[{...line,esRegalo:true}]}); assert.equal(r.status,400);
  r=await req('PATCH',`/pedido-items/${first.id}/iniciar`,{},mostrador); assert.equal(r.status,200);
  r=await req('PATCH',`/pedidos/${order.id}/items/${first.id}`,{cantidad:0,cantidadEsperada:3}); assert.equal(r.status,409);
  r=await req('PATCH',`/pedidos/${order.id}/items/${second.id}`,{cantidad:0,cantidadEsperada:1}); assert.equal(r.status,200); assert.equal(Number(r.data.total),150);
  assert.equal((await one('SELECT count(*) FROM pedido_item_extras WHERE pedido_item_id=$1',[second.id])).count,'0');
  r=await req('PATCH',`/pedido-items/${first.id}/terminar`,{},mostrador); assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1',[ingredient.id])).stock_actual),97);
  assert.equal((await detail(order.id)).estado,'listo');
  r=await req('POST',`/pedidos/${order.id}/items`,{items:[line]}); assert.equal(r.status,201); assert.equal(Number(r.data.total),200);
  assert.notEqual((await detail(order.id)).estado,'listo');
  assert.equal(Number((await one('SELECT COALESCE(SUM(total) FILTER (WHERE cobrado),0) AS ventas FROM pedidos WHERE sucursal_id=$1',[s.id])).ventas),0, 'Unpaid tickets are not sales');
  r=await req('PATCH',`/pedidos/${order.id}/cobrar`,{metodoPago:'efectivo',montoRecibido:150,totalEsperado:150}); assert.equal(r.status,409);
  assert.equal((await detail(order.id)).cobrado,false);
  r=await req('PATCH',`/pedidos/${order.id}/cobrar`,{metodoPago:'efectivo',montoRecibido:200,totalEsperado:200}); assert.equal(r.status,200,JSON.stringify(r.data));
  r=await req('POST',`/pedidos/${order.id}/items`,{items:[line]}); assert.equal(r.status,409);
  assert.equal(Number((await detail(order.id)).total),200);

  const discounted=await create();
  await query('UPDATE pedidos SET descuento_porcentaje=10,total=45 WHERE id=$1',[discounted.id]);
  r=await req('POST',`/pedidos/${discounted.id}/items`,{items:[line]}); assert.equal(r.status,201); assert.equal(Number(r.data.total),90);
  const last=await create(), item=(await detail(last.id)).items[0];
  r=await req('PATCH',`/pedidos/${last.id}/items/${item.id}`,{cantidad:0,cantidadEsperada:1}); assert.equal(r.status,409);
  r=await req('PATCH',`/pedidos/${last.id}/cancelar`,{motivo:'Pedido de prueba duplicado'}); assert.equal(r.status,200,JSON.stringify(r.data));
  r=await req('POST',`/pedidos/${last.id}/items`,{items:[line]}); assert.equal(r.status,409);
  r=await req('PATCH',`/pedidos/${last.id}/cobrar`,{metodoPago:'efectivo'}); assert.equal(r.status,409);

  const racing=await create();
  const [add,pay]=await Promise.all([
    req('POST',`/pedidos/${racing.id}/items`,{items:[line]}),
    req('PATCH',`/pedidos/${racing.id}/cobrar`,{metodoPago:'efectivo',montoRecibido:50,totalEsperado:50})]);
  assert((add.status===201 && pay.status===409)||(add.status===409 && pay.status===200), JSON.stringify({add,pay}));
  assert(Number((await one("SELECT count(*) FROM auditoria WHERE sucursal_id=$1 AND accion IN ('agregar_productos','quitar_producto','cambiar_cantidad')",[s.id])).count)>=5);
  console.log('PASS: unpaid creation reaches kitchen; append same folio; extras/notes; quantities/removal; preparation and stock; discounts; stale payment; paid/cancelled/role/branch protection; concurrent add vs pay; audit');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();});
