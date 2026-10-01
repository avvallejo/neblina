// Base desechable exclusivamente: no ejecuta pruebas contra cafeteria.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const jwt=require('jsonwebtoken');
const {query,pool}=require('../src/db');
let server;
(async()=>{
  assert.equal(process.env.NODE_ENV,'development');
  assert.match(process.env.PGDATABASE,/^codex_insumos_/);
  const one=async(sql,args=[]) => (await query(sql,args)).rows[0];
  const s=await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA insumos','QIP') RETURNING id");
  const foreign=await one("INSERT INTO sucursales(nombre,prefijo_folio) VALUES('QA otra','QIO') RETURNING id");
  const user=async(rol,estaciones,suc=s.id)=>one("INSERT INTO usuarios(nombre,rol,pin_hash,estaciones,sucursal_id) VALUES($1,$2,'qa-no-login',$3,$4) RETURNING *",[rol,rol,estaciones,suc]);
  const admin=await user('admin',['barra','parrilla']);
  const bar=await user('barista',['barra']),grill=await user('barista',['parrilla']),cash=await user('cajero',['barra']),other=await user('admin',['barra','parrilla'],foreign.id);
  const cat=await one("INSERT INTO categorias_producto(nombre,sucursal_id) VALUES('QA bebidas',$1) RETURNING id",[s.id]);
  const mc=await one("INSERT INTO categorias_materia_prima(nombre,sucursal_id) VALUES('QA insumos',$1) RETURNING id",[s.id]);
  const mat=async(nombre,unidad,stock=10,lote=false)=>{
    const m=await one('INSERT INTO materias_primas(nombre,categoria_id,unidad,stock_actual,costo_unitario,requiere_lote,sucursal_id) VALUES($1,$2,$3,$4,30,$5,$6) RETURNING id',[nombre,mc.id,unidad,stock,lote,s.id]);
    if(lote)await query("INSERT INTO lotes(materia_prima_id,cantidad_comprada,cantidad_disponible,unidad,costo_total,usuario_id) VALUES($1,$2,$2,$3,300,$4)",[m.id,stock,unidad,admin.id]);
    return m.id;
  };
  const coffee=await mat('Café kg','kg'),milk=await mat('Leche entera A','l',10,true),alt=await mat('Leche entera B','ml',10000,true),syrup=await mat('Jarabe','l'),bread=await mat('Pan A','pieza'),breadAlt=await mat('Pan B','pieza');
  const size=await one("INSERT INTO opciones_tamano(codigo,etiqueta,onzas,sucursal_id) VALUES('12','12 oz',12,$1) RETURNING id",[s.id]);
  const large=await one("INSERT INTO opciones_tamano(codigo,etiqueta,onzas,sucursal_id) VALUES('16','16 oz',16,$1) RETURNING id",[s.id]);
  await query('INSERT INTO tamano_leche_cantidad(tamano_id,cantidad_ml) VALUES($1,280),($2,360)',[size.id,large.id]);
  const co=await one("INSERT INTO opciones_cafe(codigo,etiqueta,materia_prima_id,sucursal_id) VALUES('tradicional','Tradicional',$1,$2) RETURNING id",[coffee,s.id]);
  const mo=await one("INSERT INTO opciones_leche(codigo,etiqueta,materia_prima_id,sucursal_id) VALUES('entera','Entera',$1,$2) RETURNING id",[milk,s.id]);
  const shot=await one("INSERT INTO opciones_extra(codigo,etiqueta,es_shot_adicional,sucursal_id) VALUES('doble','Shot',true,$1) RETURNING id",[s.id]);
  const product=async(nombre,{tipo='bebida',tamanos=true,leche=true,cafe=true}={})=>{
    const p=await one('INSERT INTO productos(nombre,categoria_id,tipo,precio_base,permite_tamanos,permite_leche,permite_tipo_cafe,permite_extras,sucursal_id,estacion) VALUES($1,$2,$3,50,$4,$5,$6,true,$7,$8) RETURNING id',[nombre,cat.id,tipo,tamanos,leche,cafe,s.id,tipo==='alimento'?'parrilla':'barra']);
    await query('INSERT INTO recetas(producto_id,gramaje_por_shot) VALUES($1,18) ON CONFLICT(producto_id) DO UPDATE SET gramaje_por_shot=18',[p.id]);return p.id;
  };
  const latte=await product('Latte'),small=await product('Bebida sin selector',{tamanos:false}),frappe=await product('Frappé',{tipo:'frappe'}),food=await product('Hamburguesa',{tipo:'alimento',tamanos:false,leche:false,cafe:false});
  await query("INSERT INTO receta_insumos_fijos(producto_id,materia_prima_id,cantidad,unidad) VALUES($1,$2,15,'ml'),($3,$4,1,'pieza')",[latte,syrup,food,bread]);
  await query("INSERT INTO turnos(sucursal_id,abierto_por,fondo_inicial) VALUES($1,$2,0)",[s.id,admin.id]);
  server=require('../src/app').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const req=async(method,path,body,u=admin)=>{
    const token=jwt.sign({tipo:'staff',id:u.id,ver:u.token_version,suc:u.sucursal_id},process.env.JWT_SECRET,{expiresIn:'1h'});
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:`Bearer ${token}`,'X-Sucursal-Id':s.id,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
  };
  const sale=async(p,qty=1,{tamano=size.id,leche=mo.id,cafe=co.id}={})=>{
    const o=await one("INSERT INTO pedidos(sucursal_id,origen,cajero_id,nombre_ticket) VALUES($1,'mostrador',$2,'QA') RETURNING id",[s.id,admin.id]);
    return one('INSERT INTO pedido_items(pedido_id,producto_id,tamano_id,leche_id,cafe_id,cantidad,precio_unitario) VALUES($1,$2,$3,$4,$5,$6,50) RETURNING *',[o.id,p,tamano,leche,cafe,qty]);
  };
  const stock=async(id)=>Number((await one('SELECT stock_actual FROM materias_primas WHERE id=$1',[id])).stock_actual);
  const used=async(id)=>Object.fromEntries((await query("SELECT materia_prima_id,SUM(-cantidad) AS n FROM movimientos_inventario WHERE pedido_item_id=$1 AND tipo='consumo' GROUP BY materia_prima_id",[id])).rows.map(m=>[m.materia_prima_id,Number(m.n)]));
  const finish=(l,u=bar)=>req('PATCH',`/pedido-items/${l.id}/terminar`,{},u);
  const fetchPlan=(l,u=bar)=>req('GET',`/pedido-items/${l.id}/insumos`,undefined,u);
  const choose=async(l,source,target,u=bar)=>{
    const p=await fetchPlan(l,u);assert.equal(p.status,200,JSON.stringify(p));
    return req('PUT',`/pedido-items/${l.id}/insumos`,{huella:p.data.huella,insumos:p.data.insumos.map(m=>({origenId:m.origen_id,elegidoId:m.origen_id===source?target:m.elegido_id}))},u);
  };
  // Leche/café base sin duplicarlos en fijos, multiplicados por unidades.
  let l=await sale(latte,2);assert.deepEqual(await used(l.id),{});
  assert.equal((await fetchPlan(l)).data.insumos.find(m=>m.origen_id===milk).cantidad,'0.560');
  assert.equal((await finish(l)).status,200);assert.deepEqual(await used(l.id),{[coffee]:0.036,[milk]:0.56,[syrup]:0.03});
  assert.equal(await stock(milk),9.44);assert.equal(await stock(coffee),9.964);
  const immutable=await used(l.id);assert.equal((await finish(l)).status,409);assert.deepEqual(await used(l.id),immutable);
  assert.equal((await fetchPlan(l)).data.registrado,true);
  assert.equal((await req('PUT',`/pedido-items/${l.id}/insumos`,{huella:'anterior',insumos:[]},bar)).status,409);
  // Caso que antes omitía leche: producto sin selector de tamaño.
  l=await sale(small,1,{tamano:null});assert.equal((await finish(l)).status,200);assert.equal((await used(l.id))[milk],0.28);
  await query(`UPDATE recetas SET leche_ml_por_tamano='{"12":150,"16":240}' WHERE producto_id=$1`,[frappe]);
  l=await sale(frappe,2,{tamano:large.id});await query('INSERT INTO pedido_item_extras(pedido_item_id,extra_id) VALUES($1,$2)',[l.id,shot.id]);
  assert.equal((await finish(l)).status,200);assert.equal((await used(l.id))[coffee],0.072);assert.equal((await used(l.id))[milk],0.48);
  // Configuración incompleta bloquea terminar con mensaje claro y sin consumo parcial.
  l=await sale(latte,1,{leche:null});const bad=await finish(l);assert.equal(bad.status,400,JSON.stringify(bad));assert.match(bad.data.error,/leche/);assert.deepEqual(await used(l.id),{});
  l=await sale(latte,1,{cafe:null});assert.equal((await finish(l)).status,400);assert.deepEqual(await used(l.id),{});
  await query("UPDATE recetas SET leche_ml_por_tamano=$2::jsonb WHERE producto_id=$1",[small,JSON.stringify({12:0})]);
  l=await sale(small,1,{tamano:null});assert.equal((await finish(l)).status,400);assert.deepEqual(await used(l.id),{});
  // Configurar opciones no permite quitar el insumo ni usar unidades erróneas.
  assert.equal((await req('PATCH',`/opciones/leches/${mo.id}`,{materiaPrimaId:null})).status,400);
  assert.equal((await req('PATCH',`/opciones/cafes/${co.id}`,{materiaPrimaId:milk})).status,400);
  // Alternativas solo por administrador, mismas dimensiones y sede.
  const configPath=`/materias-primas/${milk}/alternativas`;
  assert.equal((await req('PUT',configPath,{ids:[alt]},bar)).status,403);
  assert.equal((await req('PUT',configPath,{ids:[coffee]})).status,400);
  assert.equal((await req('PUT',configPath,{ids:[alt]},other)).status,404);
  assert.equal((await req('PUT',configPath,{ids:[alt]})).status,200);
  l=await sale(latte,2);const beforeMilk=await stock(milk),beforeAlt=await stock(alt);
  assert.equal((await fetchPlan(l,grill)).status,403);assert.equal((await fetchPlan(l,cash)).status,403);
  assert.equal((await choose(l,milk,coffee)).status,400);
  assert.equal((await choose(l,milk,alt)).status,200);assert.equal(await stock(milk),beforeMilk);assert.equal(await stock(alt),beforeAlt);
  const totalBefore=await one('SELECT total FROM pedidos WHERE id=$1',[l.pedido_id]);
  assert.equal((await finish(l)).status,200);assert.equal(await stock(milk),beforeMilk);assert.equal(await stock(alt),beforeAlt-560);
  assert.equal((await used(l.id))[milk],undefined);assert.equal((await used(l.id))[alt],560);
  assert.deepEqual(await one('SELECT total FROM pedidos WHERE id=$1',[l.pedido_id]),totalBefore);
  assert.equal(Number((await one('SELECT costo_real FROM vw_costo_real_por_venta WHERE pedido_item_id=$1',[l.id])).costo_real),18.78);
  // Recuperación, costo real y devolución usan la marca efectiva.
  const expected=(await query('SELECT * FROM fn_insumos_regularizacion($1)',[l.id])).rows;
  assert.equal(Number(expected.find(m=>m.materia_prima_id===alt).cantidad),560);
  await query('SELECT fn_revertir_consumo_item($1,$2,$3)',[l.id,admin.id,'QA devolución']);assert.equal(await stock(alt),beforeAlt);assert.equal(await stock(milk),beforeMilk);
  await query('SELECT fn_revertir_consumo_item($1,$2,$3)',[l.id,admin.id,'QA reintento']);assert.equal(await stock(alt),beforeAlt);
  // Parrilla comparte el mismo mecanismo para los ingredientes fijos.
  assert.equal((await req('PUT',`/materias-primas/${bread}/alternativas`,{ids:[breadAlt]})).status,200);
  const f=await sale(food,2,{tamano:null,leche:null,cafe:null});assert.equal((await choose(f,bread,breadAlt,grill)).status,200);
  assert.equal((await finish(f,grill)).status,200);assert.deepEqual(await used(f.id),{[breadAlt]:2});assert.equal(await stock(bread),10);
  // Una elección desautorizada después debe revisarse, sin descuento parcial.
  l=await sale(latte);assert.equal((await choose(l,milk,alt)).status,200);
  await req('PUT',configPath,{ids:[]});assert.equal((await finish(l)).status,400);assert.deepEqual(await used(l.id),{});
  assert.equal((await choose(l,milk,milk)).status,200);assert.equal((await finish(l)).status,200);
  // Protección de configuración de recetas: no duplicar leche base en fijos.
  const dup=await req('PUT',`/recetas/${latte}`,{pasos:['Preparar'],insumosFijos:[{materiaPrimaId:milk,cantidad:280,unidad:'ml'}]});
  assert.equal(dup.status,400);assert.match(dup.data.error,/ingredientes base/);
  // Terminar todo usa el mismo trigger y las mismas alternativas.
  await req('PUT',configPath,{ids:[alt]});l=await sale(latte);assert.equal((await choose(l,milk,alt)).status,200);
  const batch=await req('PATCH',`/pedido-items/pedido/${l.pedido_id}/terminar`,{estacion:'barra',itemIds:[l.id]},bar);
  assert.equal(batch.status,200,JSON.stringify(batch));assert.equal((await used(l.id))[alt],280);
  // Concurrencia: terminar y cambiar la selección se serializan en la línea.
  l=await sale(latte);const plan=(await fetchPlan(l)).data;
  const saveBody={huella:plan.huella,insumos:plan.insumos.map(m=>({origenId:m.origen_id,elegidoId:m.origen_id===milk?alt:m.elegido_id}))};
  const race=await Promise.all([req('PUT',`/pedido-items/${l.id}/insumos`,saveBody,bar),finish(l)]);
  assert.equal(race[1].status,200);assert.ok([200,409].includes(race[0].status));
  const raceUsed=await used(l.id);assert.equal(!!raceUsed[milk]!==!!raceUsed[alt],true);
  // Separar cantidades conserva el insumo elegido y no vuelve a consumir.
  l=await sale(latte,2);assert.equal((await choose(l,milk,alt)).status,200);
  assert.equal((await finish(l)).status,200);
  const splitStock=await stock(alt);
  const split=await req('POST',`/pedidos/${l.pedido_id}/separar`,{clientUuid:randomUUID(),nombre:'Otra cuenta',totalEsperado:Number((await one('SELECT total FROM pedidos WHERE id=$1',[l.pedido_id])).total),items:[{id:l.id,cantidad:1,cantidadEsperada:2}]});
  assert.equal(split.status,201,JSON.stringify(split));
  const child=await one('SELECT id FROM pedido_items WHERE pedido_id=$1',[split.data.cuenta.id]);
  assert.equal((await used(child.id))[alt],280);assert.equal((await used(l.id))[alt],280);
  assert.equal(await stock(alt),splitStock);
  assert.equal((await one('SELECT alternativa_id FROM pedido_item_sustituciones WHERE pedido_item_id=$1',[child.id])).alternativa_id,alt);
  assert.equal(Number((await query('SELECT * FROM fn_insumos_regularizacion($1)',[child.id])).rows.find(m=>m.materia_prima_id===alt).cantidad),280);
  // Bebidas sin café base no suman un café ficticio en su costo teórico.
  const chocolate=await product('Chocolate sin espresso',{cafe:false,leche:false,tamanos:false});
  assert.equal(Number((await one('SELECT fn_costo_teorico_producto($1) AS costo',[chocolate])).costo),0);
  const invalidShot=await req('POST','/pedidos',{clientUuid:randomUUID(),nombreTicket:'Sin espresso QA',destino:'llevar',items:[{productoId:chocolate,cantidad:1,extraIds:[shot.id]}]});
  assert.equal(invalidShot.status,400,JSON.stringify(invalidShot));assert.match(invalidShot.data.error,/shot adicional/);
  const wrongShot=await sale(chocolate,1,{tamano:null,leche:null,cafe:null});
  await query('INSERT INTO pedido_item_extras(pedido_item_id,extra_id) VALUES($1,$2)',[wrongShot.id,shot.id]);
  assert.equal((await finish(wrongShot)).status,400);assert.deepEqual(await used(wrongShot.id),{});
  console.log('PASS: leche/café base, bebida sin tamaño, cantidad de receta, frappé/doble shot, barra/parrilla, alternativas autorizadas, conversión l/ml, costos, devolución, permisos, sin duplicados, sin cambio de precio, carrera guardar/terminar y guardas de configuración.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();});
