// Ejecutar en Docker local: docker exec -i cafeteria-api node < api/test/live-direct-sales.js
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {pool}=require('./src/db');
const {registrarVenta}=require('./src/services/directSales');
const {dailySalesSql}=require('./src/services/dailySales');
(async()=>{
 assert.equal(process.env.NODE_ENV,'development');const c=await pool.connect();
 try{
 await c.query('BEGIN');
 const {rows:[u]}=await c.query("SELECT id,sucursal_id FROM usuarios WHERE sucursal_id IS NOT NULL LIMIT 1");
 const s=u.sucursal_id,auth={tipo:'staff',rol:'cajero',id:u.id};
 const {rows:[m]}=await c.query("SELECT * FROM materias_primas WHERE sucursal_id=$1 AND activo AND unidad='kg' LIMIT 1",[s]);
 const {rows:[d]}=await c.query("SELECT ((now() AT TIME ZONE 'America/Mexico_City')::date-1)::text dia");
 const base={claveRegistro:crypto.randomUUID(),fecha:d.dia,hora:'12:00',motivo:'Venta de ayer sin registrar',metodoPago:'efectivo',montoRecibido:100,items:[{concepto:'Café molido prueba 250 g',precioUnitario:50,motivoPrecio:'Precio acordado',cantidad:2,insumoId:m.id,cantidadInsumo:250,unidadInsumo:'g'}]};
 const before=Number((await c.query(dailySalesSql,[s,d.dia])).rows[0].ventas);
 const result=await registrarVenta(c,base,auth,s);
 assert.equal(Number(result.pedido.total),100);assert.equal(result.pedido.registro_manual,true);
 const {rows:[line]}=await c.query('SELECT * FROM pedido_items WHERE pedido_id=$1',[result.pedido.id]);
 assert.equal(line.estado,'terminado');assert.equal(line.producto_id,null);assert.equal(line.concepto_libre,'Café molido prueba 250 g');
 const {rows:[mv]}=await c.query('SELECT sum(cantidad) n FROM movimientos_inventario WHERE pedido_item_id=$1',[line.id]);
 assert.equal(Number(mv.n),-.5);
 assert.equal(Number((await c.query(dailySalesSql,[s,d.dia])).rows[0].ventas),before+100);
 assert.equal((await c.query('SELECT count(*) n FROM vw_productos_mas_vendidos WHERE nombre=$1',[line.concepto_libre])).rows[0].n,'1');
 const retry=await registrarVenta(c,base,auth,s);assert.equal(retry.pedido.id,result.pedido.id);assert.equal(retry.repetido,true);
 await assert.rejects(()=>registrarVenta(c,{...base,motivo:'Cambio posterior'},auth,s),e=>e.status===409);
 const {rows:[p]}=await c.query("SELECT id FROM productos WHERE sucursal_id=$1 AND activo AND NOT permite_tamanos AND NOT permite_leche AND NOT permite_tipo_cafe LIMIT 1",[s]);
 const special={...base,claveRegistro:crypto.randomUUID(),items:[{productoId:p.id,precioUnitario:1,motivoPrecio:'Precio de apertura',cantidad:1}]};
 const priced=await registrarVenta(c,special,auth,s);assert.equal(Number(priced.pedido.total),1);
 assert.equal((await c.query('SELECT estado FROM pedido_items WHERE pedido_id=$1',[priced.pedido.id])).rows[0].estado,'terminado');
 const {rows:[coffee]}=await c.query("SELECT id,materia_prima_id FROM opciones_cafe WHERE sucursal_id=$1 AND codigo='tradicional'",[s]);
 const {rows:[espresso]}=await c.query("SELECT id FROM productos WHERE sucursal_id=$1 AND permite_tipo_cafe AND NOT permite_leche AND NOT permite_tamanos AND activo LIMIT 1",[s]);
 if(espresso){
  const drink=await registrarVenta(c,{...base,claveRegistro:crypto.randomUUID(),items:[{productoId:espresso.id,cafeId:coffee.id,precioUnitario:20,motivoPrecio:'Precio anterior',cantidad:2}]},auth,s);
  const {rows:[consumo]}=await c.query('SELECT sum(mi.cantidad) n FROM movimientos_inventario mi JOIN pedido_items pi ON pi.id=mi.pedido_item_id WHERE pi.pedido_id=$1 AND mi.materia_prima_id=$2',[drink.pedido.id,coffee.materia_prima_id]);
  const {rows:[expected]}=await c.query("SELECT fn_convertir_unidad(r.gramaje_por_shot*2,'g',m.unidad) n FROM recetas r JOIN materias_primas m ON m.id=$2 WHERE r.producto_id=$1",[espresso.id,coffee.materia_prima_id]);
  assert.equal(Number(consumo.n),-Number(expected.n));
 }
 async function reject(changes,role=auth){await c.query('SAVEPOINT invalid');try{await assert.rejects(()=>registrarVenta(c,{...base,claveRegistro:crypto.randomUUID(),...changes},role,s));}finally{await c.query('ROLLBACK TO SAVEPOINT invalid');}}
 await reject({}, {tipo:'cliente',id:u.id});await reject({fecha:'2099-01-01'});await reject({items:[{concepto:'Prueba',precioUnitario:-1,cantidad:1}]});await reject({items:[{productoId:p.id,precioUnitario:1,cantidad:1}]});await reject({items:[{...base.items[0],unidadInsumo:'ml'}]});
 const {rows:[other]}=await c.query('SELECT id FROM sucursales WHERE id<>$1 LIMIT 1',[s]);
 if(other){await c.query('SAVEPOINT foreign');await assert.rejects(()=>registrarVenta(c,{...base,claveRegistro:crypto.randomUUID()},auth,other.id));await c.query('ROLLBACK TO SAVEPOINT foreign');}
 console.log('PASS: fecha histórica, reporte diario, concepto libre, conversión 250g, descuento de inventario, precio especial, rechazo de precio inválido/sucursal ajena/cliente/fecha futura y reintento sin duplicados.');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
