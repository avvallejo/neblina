const {createHash}=require('node:crypto');
const { ApiError } = require('../utils/asyncHandler');
const { calcularPrecioItem } = require('../utils/pricing');
const { normalizeItems } = require('./orderValidation');
const { validateDate } = require('./dailySales');
const {cashPart}=require('./cashDrawer');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function texto(v, nombre) {
  if(typeof v!=='string'||v.trim().length<3||v.trim().length>300) throw new ApiError(400,`${nombre}: escribe entre 3 y 300 caracteres.`);
  return v.trim();
}
function importe(v) {
  if(!['number','string'].includes(typeof v)||v===null||v===undefined||v===''||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>100000) throw new ApiError(400,'Indica un precio entre $0 y $100,000.');
  return Math.round(Number(v)*100)/100;
}
async function registrarVenta(client, body, auth, sucursalId) {
  if(auth.tipo!=='staff'||!['cajero','mostrador','admin'].includes(auth.rol)) throw new ApiError(403,'Solo Caja puede registrar ventas directas.');
  if(!UUID.test(body.claveRegistro||'')) throw new ApiError(400,'Falta el identificador de la captura.');
  // Serializa reintentos: una respuesta perdida nunca crea una segunda venta.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${sucursalId}:${body.claveRegistro}`]);
  const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const prev=await client.query('SELECT * FROM pedidos WHERE sucursal_id=$1 AND clave_registro=$2',[sucursalId,body.claveRegistro]);
  if(prev.rows.length) {
    if(prev.rows[0].captura_hash!==hash) throw new ApiError(409,`La captura ya fue guardada con el folio ${prev.rows[0].folio}. Revísala en Ventas antes de iniciar otra.`);
    return {pedido:prev.rows[0],repetido:true};
  }
  const fecha=validateDate(body.fecha);
  if(!fecha||!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.hora||'')) throw new ApiError(400,'Indica fecha y hora de la venta.');
  const {rows:[tiempo]}=await client.query("SELECT $1::timestamp AT TIME ZONE 'America/Mexico_City' AS venta, ($1::timestamp AT TIME ZONE 'America/Mexico_City') > now()+interval '1 minute' AS futuro",[`${fecha} ${body.hora}`]);
  if(tiempo.futuro) throw new ApiError(400,'La venta no puede tener fecha futura.');
  const motivo=texto(body.motivo,'Motivo del registro');
  if(!['efectivo','tarjeta','transferencia','mixto'].includes(body.metodoPago)) throw new ApiError(400,'Método de pago inválido.');
  const lines=[];
  for(const item of normalizeItems(body.items)) {
    if(item.esRegalo) throw new ApiError(400,'Esta captura no admite recompensas de fidelidad.');
    const price=importe(item.precioUnitario);
    let regular=null, concepto=null, insumo=null;
    if(item.productoId) {
      regular=await calcularPrecioItem({...item,sucursalId},client.query.bind(client));
      if(item.insumoId) throw new ApiError(400,'El producto del catálogo ya descuenta su receta.');
    } else {
      concepto=texto(item.concepto,'Concepto de la venta');
      if(item.cafeId||item.lecheId||item.tamanoId||item.extraIds.length) throw new ApiError(400,'Personaliza solo productos del catálogo.');
      if(item.insumoId) {
        const {rows}=await client.query('SELECT id,unidad FROM materias_primas WHERE id=$1 AND sucursal_id=$2 AND activo FOR UPDATE',[item.insumoId,sucursalId]);
        if(!rows.length) throw new ApiError(400,'Insumo no disponible en esta sucursal.');
        const q=Number(item.cantidadInsumo);
        if(!Number.isFinite(q)||q<=0||q>100000) throw new ApiError(400,'Indica cuánto insumo se consume por unidad vendida.');
        if(!['g','kg','ml','l','pieza'].includes(item.unidadInsumo)) throw new ApiError(400,'Unidad de insumo inválida.');
        const compatible=item.unidadInsumo===rows[0].unidad||[['g','kg'],['ml','l']].some(pair=>pair.includes(item.unidadInsumo)&&pair.includes(rows[0].unidad));
        if(!compatible) throw new ApiError(400,'La unidad no corresponde al insumo.');
        insumo={id:item.insumoId,cantidad:q,unidad:item.unidadInsumo};
      }
    }
    const motivoPrecio=regular===null||price!==regular ? texto(item.motivoPrecio,'Motivo del precio') : null;
    lines.push({...item,price,regular,concepto,insumo,motivoPrecio});
  }
  const total=Math.round(lines.reduce((sum,l)=>sum+l.price*l.cantidad,0)*100)/100;
  if(total>99999999.99) throw new ApiError(400,'El total excede el límite de una venta.');
  const recibido=body.metodoPago==='efectivo'?importe(body.montoRecibido):total;
  if(recibido<total) throw new ApiError(400,'El efectivo recibido no cubre el total.');
  const {rows:[pedido]}=await client.query(`INSERT INTO pedidos(origen,cajero_id,subtotal,total,metodo_pago,monto_recibido,cambio,cobrado,sucursal_id,creado_en,registro_manual,motivo_registro,clave_registro,captura_hash,importe_efectivo)
    VALUES ('mostrador',$1,$2,$2,$3,$4,$5,true,$6,$7,true,$8,$9,$10,$11) RETURNING *`,[auth.id,total,body.metodoPago,recibido,Math.round((recibido-total)*100)/100,sucursalId,tiempo.venta,motivo,body.claveRegistro,hash,cashPart(body.metodoPago,total,body.importeEfectivo)]);
  for(const l of lines) {
    const {rows:[item]}=await client.query(`INSERT INTO pedido_items(pedido_id,producto_id,tamano_id,leche_id,cafe_id,cantidad,precio_unitario,notas,concepto_libre,precio_catalogo,motivo_precio,insumo_directo_id,cantidad_insumo,unidad_insumo,barista_id,creado_en,estado,terminado_en)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [pedido.id,l.productoId||null,l.tamanoId||null,l.lecheId||null,l.cafeId||null,l.cantidad,l.price,l.notas||null,l.concepto,l.regular,l.motivoPrecio,l.insumo?.id||null,l.insumo?.cantidad||null,l.insumo?.unidad||null,auth.id,tiempo.venta,l.productoId?'pendiente':'terminado',l.productoId?null:tiempo.venta]);
    for(const extra of l.extraIds) await client.query('INSERT INTO pedido_item_extras(pedido_item_id,extra_id) VALUES($1,$2)',[item.id,extra]);
    if(l.productoId) await client.query("UPDATE pedido_items SET estado='terminado',terminado_en=$2 WHERE id=$1",[item.id,tiempo.venta]);
    else if(l.insumo) await client.query('SELECT fn_consumir_insumo($1,$2,$3,$4,$5)',[l.insumo.id,l.insumo.cantidad*l.cantidad,l.insumo.unidad,auth.id,item.id]);
  }
  await client.query(`INSERT INTO auditoria(entidad,entidad_id,accion,valor_nuevo,motivo,usuario_id,sucursal_id)
    VALUES('pedidos',$1,'venta_directa',$2,$3,$4,$5)`,[pedido.id,{fechaVenta:tiempo.venta,total,items:lines},motivo,auth.id,sucursalId]);
  return {pedido};
}
module.exports={registrarVenta,importe};
