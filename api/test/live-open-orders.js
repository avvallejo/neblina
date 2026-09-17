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
  // Perfiles de preparación: creación/edición, permisos y llegada por línea.
  const admin = await staff(s.id,'admin');
  const profiles = [];
  for (const estaciones of [['barra'], ['parrilla'], ['barra','parrilla']]) {
    const result = await req('POST','/usuarios',{nombre:'QA estación',rol:'barista',pin:'5839',estaciones},admin);
    assert.equal(result.status,201,JSON.stringify(result.data));
    profiles.push(await one('SELECT * FROM usuarios WHERE id=$1',[result.data.id]));
  }
  const [barra, parrilla, ambos] = profiles;
  const grillOrder = await create();
  const grillItem = (await detail(grillOrder.id)).items[0];
  const drink = await one(`INSERT INTO productos(nombre,categoria_id,tipo,precio_base,permite_tamanos,permite_leche,permite_tipo_cafe,permite_extras,sucursal_id,estacion)
    VALUES('QA bebida',$1,'bebida',50,false,false,false,false,$2,'barra') RETURNING id`,[cp.id,s.id]);
  r = await req('POST',`/pedidos/${grillOrder.id}/items`,{items:[{productoId:drink.id,cantidad:1}]});
  assert.equal(r.status,201);
  const drinkItem = (await detail(grillOrder.id)).items.find(i=>i.producto_id===drink.id);
  await query("UPDATE pedido_items SET creado_en='2000-01-01' WHERE id=$1",[grillItem.id]);
  await query("UPDATE pedidos SET hora_recogida=now()+interval '1 day' WHERE id=$1",[grillOrder.id]);
  const queue = async user => {
    const result = await req('GET','/pedido-items/cola',undefined,user);
    assert.equal(result.status,200); return result.data;
  };
  assert((await queue(barra)).every(i=>i.estacion==='barra'));
  assert((await queue(parrilla)).every(i=>i.estacion==='parrilla'));
  const all = await queue(ambos);
  assert(all.some(i=>i.id===drinkItem.id)); assert(all.some(i=>i.id===grillItem.id));
  assert.equal(all[0].id,grillItem.id,'FIFO por llegada aunque tenga recogida futura');
  for (let i=1;i<all.length;i++) assert(Date.parse(all[i-1].creado_en)<=Date.parse(all[i].creado_en));
  r=await req('GET','/pedido-items/cola?estacion=parrilla',undefined,barra); assert.deepEqual(r.data,[]);
  for (const action of ['iniciar','terminar']) {
    r=await req('PATCH',`/pedido-items/${grillItem.id}/${action}`,{},barra); assert.equal(r.status,403); assert.match(r.data.error || r.data.message,/otra estación/);
    r=await req('PATCH',`/pedido-items/${drinkItem.id}/${action}`,{},parrilla); assert.equal(r.status,403);
    r=await req('PATCH',`/pedido-items/${grillItem.id}/${action}`,{},cashier2); assert.equal(r.status,403);
  }
  assert.equal((await one('SELECT estado FROM pedido_items WHERE id=$1',[grillItem.id])).estado,'pendiente');
  r=await req('PATCH',`/pedido-items/${grillItem.id}/iniciar`,{},parrilla); assert.equal(r.status,200);
  r=await req('PATCH',`/pedido-items/${drinkItem.id}/iniciar`,{},barra); assert.equal(r.status,200);
  r=await req('PATCH',`/pedido-items/${grillItem.id}/terminar`,{},ambos); assert.equal(r.status,200);
  r=await req('PATCH',`/pedido-items/${drinkItem.id}/terminar`,{},barra); assert.equal(r.status,200);
  r=await req('PATCH',`/usuarios/${barra.id}`,{estaciones:['parrilla']},admin); assert.equal(r.status,200);
  assert((await queue(barra)).every(i=>i.estacion==='parrilla'),'Cambio de estación aplicado en servidor');
  // La estación pertenece a la línea, no al catálogo mutable.
  const stationOrder = await create();
  const originalLine = (await detail(stationOrder.id)).items[0];
  r=await req('PATCH',`/productos/${product.id}`,{estacion:'caja'},admin); assert.equal(r.status,200,JSON.stringify(r.data));
  assert((await queue(parrilla)).some(i=>i.id===originalLine.id),'Cambiar catálogo no oculta pendientes');
  r=await req('POST',`/pedidos/${stationOrder.id}/items`,{items:[line]}); assert.equal(r.status,201);
  let stationLines=(await detail(stationOrder.id)).items;
  const cajaLine=stationLines.find(i=>i.id!==originalLine.id);
  assert.equal(cajaLine.estado,'terminado'); assert.equal(cajaLine.estacion,'caja');
  assert.equal(stationLines.find(i=>i.id===originalLine.id).estado,'pendiente','Agregar caja no auto-entrega la línea original');
  const stockBefore=Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1',[ingredient.id])).stock_actual);
  r=await req('PATCH',`/pedidos/${stationOrder.id}/items/${cajaLine.id}`,{cantidad:2,cantidadEsperada:1});
  assert.equal(r.status,400);assert.match(r.data.error || r.data.message,/motivo/);
  assert.equal(Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1',[ingredient.id])).stock_actual),stockBefore);
  r=await req('PATCH',`/pedido-items/${originalLine.id}/iniciar`,{},parrilla);assert.equal(r.status,200);
  r=await req('PATCH',`/pedido-items/${originalLine.id}/terminar`,{},parrilla);assert.equal(r.status,200);
  r=await req('PATCH',`/productos/${product.id}`,{estacion:'barra'},admin);assert.equal(r.status,200);
  r=await req('POST',`/pedidos/${stationOrder.id}/items`,{items:[line]});assert.equal(r.status,201);
  const barraLine=(await detail(stationOrder.id)).items.find(i=>i.estacion==='barra');
  assert(barraLine); assert((await queue(ambos)).some(i=>i.id===barraLine.id && i.estacion==='barra'));
  await assert.rejects(()=>query("UPDATE pedido_items SET estacion_preparacion='caja' WHERE id=$1",[barraLine.id]),/no se modifica/);
  await query("UPDATE productos SET estacion='parrilla' WHERE id=$1",[product.id]);
  console.log('PASS: estación por línea; cambio a caja sin ocultar comandas; nuevas líneas usan nueva estación; caja bloqueada sin alterar stock');
  // Corrección de caja: regreso a lotes, cantidades y reemplazo sin cancelar ticket.
  const bottles=await one("INSERT INTO materias_primas(nombre,categoria_id,unidad,stock_actual,costo_unitario,sucursal_id,requiere_lote) VALUES('QA botellas',$1,'pieza',20,5,$2,true) RETURNING id",[cm.id,s.id]);
  for(const date of ['2026-01-01','2026-01-02']) await query(`INSERT INTO lotes(materia_prima_id,fecha_compra,cantidad_comprada,cantidad_disponible,unidad,costo_total,usuario_id)
    VALUES($1,$2,10,10,'pieza',50,$3)`,[bottles.id,date,cashier.id]);
  const bottled=await one(`INSERT INTO productos(nombre,categoria_id,tipo,precio_base,permite_tamanos,permite_leche,permite_tipo_cafe,permite_extras,sucursal_id,estacion)
    VALUES('QA Refresco',$1,'snack',25,false,false,false,false,$2,'caja') RETURNING id`,[cp.id,s.id]);
  await query("INSERT INTO receta_insumos_fijos(producto_id,materia_prima_id,cantidad,unidad) VALUES($1,$2,1,'pieza')",[bottled.id,bottles.id]);
  r=await req('POST','/pedidos',{destino:'barra',items:[{productoId:bottled.id,cantidad:12}]});assert.equal(r.status,201,JSON.stringify(r.data));
  const returnOrder=r.data.pedido,returnLine=(await detail(returnOrder.id)).items[0];
  const stockBottles=async()=>Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1',[bottles.id])).stock_actual);
  const correct=async(qty,expected,extra={})=>req('PATCH',`/pedidos/${returnOrder.id}/items/${returnLine.id}`,{cantidad:qty,cantidadEsperada:expected,motivo:'Cambió por jamaica',...extra});
  assert.equal(await stockBottles(),8);
  r=await correct(1,12);assert.equal(r.status,400,'Requiere confirmación física de devolución');assert.equal(await stockBottles(),8);
  r=await correct(1,12,{devuelto:true});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(Number(r.data.total),25);assert.equal(await stockBottles(),19);
  const lots=await query('SELECT cantidad_disponible FROM lotes WHERE materia_prima_id=$1 ORDER BY fecha_compra',[bottles.id]);
  assert.deepEqual(lots.rows.map(l=>Number(l.cantidad_disponible)),[9,10]);
  r=await correct(1,12,{devuelto:true});assert.equal(r.status,409);assert.equal(await stockBottles(),19);
  const realCost=await one('SELECT costo_real FROM vw_costo_real_por_venta WHERE pedido_item_id=$1',[returnLine.id]);assert.equal(Number(realCost.costo_real),5,'No cuenta consumos revertidos');
  r=await correct(2,1);assert.equal(r.status,200);assert.equal(await stockBottles(),18);
  const beforeRace=await stockBottles();
  const edits=await Promise.all([correct(1,2,{devuelto:true}),correct(1,2,{devuelto:true})]);
  assert.deepEqual(edits.map(e=>e.status).sort(),[200,409]);assert.equal(await stockBottles(),beforeRace+1);
  r=await correct(0,1,{devuelto:true});assert.equal(r.status,200);assert.equal(Number(r.data.total),0);assert.equal(await stockBottles(),20);
  r=await correct(0,1,{devuelto:true});assert.equal(r.status,409);assert.equal(await stockBottles(),20,'Reintento no devuelve dos veces');
  r=await req('PATCH',`/pedidos/${returnOrder.id}/cobrar`,{metodoPago:'efectivo',totalEsperado:0});assert.equal(r.status,409,'No cobra ticket vacío');
  const emptyOrder=await detail(returnOrder.id);assert.equal(emptyOrder.cancelado,false);
  r=await req('POST',`/pedidos/${returnOrder.id}/items`,{items:[{productoId:drink.id,cantidad:1}]});assert.equal(r.status,201);assert.equal(r.data.folio,returnOrder.folio);
  const replacement=(await detail(returnOrder.id)).items.find(i=>i.id!==returnLine.id);
  r=await req('PATCH',`/pedido-items/${replacement.id}/terminar`,{},ambos);assert.equal(r.status,200);
  assert.equal((await detail(returnOrder.id)).estado,'listo','Línea retirada no bloquea ticket listo');
  r=await req('PATCH',`/pedidos/${returnOrder.id}/cobrar`,{metodoPago:'efectivo',montoRecibido:50,totalEsperado:50});assert.equal(r.status,200);
  assert.equal((await query('SELECT 1 FROM vw_productos_mas_vendidos WHERE producto_id=$1',[bottled.id])).rows.length,0,'Retirado no aparece vendido');
  r=await correct(1,12,{devuelto:true});assert.equal(r.status,409,'Ticket cobrado permanece protegido');
  r=await req('PATCH',`/pedidos/${returnOrder.id}/cancelar`,{motivo:'Prueba reversión posterior'},admin);assert.equal(r.status,200);
  assert.equal(await stockBottles(),20,'Cancelar después no duplica devolución');
  console.log('PASS: devoluciones por línea de caja, lotes PEPS, cantidad parcial, reintentos/concurrencia, sustitución mismo folio, cobro y reportes');
  // Clasificaciones de uso: múltiples categorías, una sola existencia.
  const catFrio = await one("INSERT INTO categorias_producto(nombre,sucursal_id) VALUES('QA Fríos',$1) RETURNING id",[s.id]);
  const catAjena = await one("INSERT INTO categorias_producto(nombre,sucursal_id) VALUES('QA ajena',$1) RETURNING id",[other.id]);
  r=await req('POST','/materias-primas',{nombre:'QA compartido',categoriaId:cm.id,unidad:'pieza',stockActual:20,costoUnitario:2,categoriasUso:[cp.id,catFrio.id]},admin);
  assert.equal(r.status,201,JSON.stringify(r.data)); const shared=r.data;
  const materias = async()=> (await req('GET','/materias-primas',undefined,admin)).data;
  assert.deepEqual(new Set((await materias()).find(m=>m.id===shared.id).categorias_uso),new Set([cp.id,catFrio.id]));
  r=await req('PATCH',`/materias-primas/${shared.id}`,{categoriasUso:[catAjena.id]},admin); assert.equal(r.status,400);
  r=await req('PATCH',`/materias-primas/${shared.id}`,{categoriasUso:'Fríos'},admin); assert.equal(r.status,400);
  r=await req('PATCH',`/materias-primas/${shared.id}`,{nombre:'QA compartido actualizado'},admin); assert.equal(r.status,200);
  assert.equal((await materias()).find(m=>m.id===shared.id).categorias_uso.length,2,'Editar nombre conserva categorías');
  await query("INSERT INTO recetas(producto_id,pasos) VALUES($1,'[\"Preparar\"]') ON CONFLICT DO NOTHING",[product.id]);
  const saveRecipe=async items=>req('PUT',`/recetas/${product.id}`,{pasos:['Preparar'],insumosFijos:items},admin);
  const sharedLine={materiaPrimaId:shared.id,cantidad:1,unidad:'pieza'};
  r=await saveRecipe([sharedLine]); assert.equal(r.status,200,JSON.stringify(r.data));
  // Reclasificar no borra recetas ni existencias; permite conservar sus líneas.
  r=await req('PATCH',`/materias-primas/${shared.id}`,{categoriasUso:[]},admin); assert.equal(r.status,200);
  r=await saveRecipe([sharedLine]); assert.equal(r.status,200,JSON.stringify(r.data));
  r=await saveRecipe([]); assert.equal(r.status,200);
  r=await saveRecipe([sharedLine]); assert.equal(r.status,400,'Un insumo sin clasificación no se agrega como nuevo');
  r=await req('PATCH',`/materias-primas/${shared.id}`,{categoriasUso:[catFrio.id]},admin); assert.equal(r.status,200);
  r=await saveRecipe([sharedLine]); assert.equal(r.status,400,'Categoría distinta rechazada');
  r=await req('PATCH',`/materias-primas/${shared.id}`,{categoriasUso:[catFrio.id,cp.id]},admin); assert.equal(r.status,200);
  r=await saveRecipe([sharedLine]); assert.equal(r.status,200);
  const currentShared=await one('SELECT stock_actual FROM materias_primas WHERE id=$1',[shared.id]);
  assert.equal(Number(currentShared.stock_actual),20,'Clasificar y editar receta no duplica ni mueve stock');
  r=await req('PATCH',`/materias-primas/${shared.id}`,{activo:false},admin); assert.equal(r.status,200);
  r=await saveRecipe([sharedLine]); assert.equal(r.status,200,'Conserva ingrediente anterior desactivado');
  r=await saveRecipe([]); assert.equal(r.status,200);
  r=await saveRecipe([sharedLine]); assert.equal(r.status,400,'Desactivado no se puede agregar de nuevo');
  console.log('PASS: categorías múltiples; aislamiento entre sucursales; filtro de nuevas recetas; conservación de existentes; stock único');
  console.log('PASS: perfiles barra/parrilla/ambos; creación y edición; cola filtrada; acciones restringidas; FIFO por línea');
  console.log('PASS: unpaid creation reaches kitchen; append same folio; extras/notes; quantities/removal; preparation and stock; discounts; stale payment; paid/cancelled/role/branch protection; concurrent add vs pay; audit');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();});
