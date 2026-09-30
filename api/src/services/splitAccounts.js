const { ApiError } = require('../utils/asyncHandler');
const { lockOpenOrder } = require('./openOrders');
const { requireOpenShift } = require('./openShift');
const { recalcularImportes } = require('./orderAmounts');
const { UUID_RE } = require('../middleware/auth');

// Se mueven las líneas existentes; una cantidad parcial hereda su estado y
// reparte su consumo real. Nunca se vuelve a preparar ni a descontar stock.
async function splitAccount(client, {id,sucursalId,auth,body}) {
  if (!UUID_RE.test(body.clientUuid || '') || !Array.isArray(body.items) || !body.items.length || body.items.length>50) throw new ApiError(400,'Selecciona los productos de la nueva cuenta.');
  if (typeof body.nombre !== 'string' || !body.nombre.trim() || body.nombre.trim().length>80) throw new ApiError(400,'Escribe el nombre de la nueva cuenta.');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`split:${body.clientUuid}`]);
  const previous=await client.query('SELECT * FROM separaciones_cuenta WHERE client_uuid=$1',[body.clientUuid]);
  if(previous.rows[0]) {
    const prev=previous.rows[0];
    if(prev.sucursal_id!==sucursalId || prev.usuario_id!==auth.id || prev.pedido_id!==id) throw new ApiError(409,'Identificador de separación usado.');
    return {cuenta:(await client.query('SELECT * FROM pedidos WHERE id=$1',[prev.cuenta_id])).rows[0],yaExistia:true};
  }
  const order=await lockOpenOrder(client,id,sucursalId);
  await requireOpenShift(client,sucursalId);
  if (Number(body.totalEsperado)!==Number(order.total)) throw new ApiError(409,'Cambió el importe del ticket. Actualiza antes de separarlo.');
  const {rows:lines}=await client.query("SELECT * FROM pedido_items WHERE pedido_id=$1 AND estado<>'cancelado' ORDER BY id FOR UPDATE",[id]);
  const selected=new Map();
  for(const entry of body.items) {
    const line=lines.find(l=>l.id===entry.id);
    if(!line || selected.has(entry.id) || !Number.isInteger(entry.cantidad) || entry.cantidad<1 || entry.cantidad>line.cantidad || entry.cantidadEsperada!==line.cantidad) throw new ApiError(409,'Cambió la cantidad de productos. Actualiza el ticket.');
    if(line.es_regalo) throw new ApiError(400,'Las recompensas no se separan.');
    selected.set(entry.id,entry.cantidad);
  }
  const totalUnits=lines.reduce((s,l)=>s+l.cantidad,0),moving=[...selected.values()].reduce((s,n)=>s+n,0);
  if(moving>=totalUnits) throw new ApiError(400,'Deja al menos un producto en cada cuenta.');
  // La cuenta original conserva al cliente y el punto de fidelidad; las
  // nuevas se vinculan al origen y no generan puntos extra por separarlas.
  const {rows:[account]}=await client.query(`INSERT INTO pedidos(sucursal_id,turno_id,origen,cajero_id,hora_recogida,descuento_porcentaje,descuento_autorizado_por,destino,mesa_numero,nombre_ticket,cuenta_origen_id)
    VALUES($1,$2,'mostrador',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[sucursalId,order.turno_id,auth.id,order.hora_recogida,order.descuento_porcentaje,order.descuento_autorizado_por,order.destino,order.mesa_numero,body.nombre.trim(),order.cuenta_origen_id||order.id]);
  for(const line of lines) {
    const quantity=selected.get(line.id);if(!quantity)continue;
    if(quantity===line.cantidad) {
      await client.query('UPDATE pedido_items SET pedido_id=$2 WHERE id=$1',[line.id,account.id]);
      continue;
    }
    const delivered=Math.min(quantity,line.cantidad_entregada);
    const {rows:[copy]}=await client.query(`INSERT INTO pedido_items
      (pedido_id,producto_id,tamano_id,leche_id,cafe_id,cantidad,precio_unitario,notas,es_regalo,es_cortesia,estado,iniciado_en,terminado_en,barista_id,terminado_por,cantidad_entregada,entregado_en,entregado_por,creado_en,separado_de_id)
      SELECT $2,producto_id,tamano_id,leche_id,cafe_id,$3,precio_unitario,notas,es_regalo,es_cortesia,estado,iniciado_en,terminado_en,barista_id,terminado_por,$4,CASE WHEN $4>0 THEN entregado_en END,CASE WHEN $4>0 THEN entregado_por END,creado_en,id
      FROM pedido_items WHERE id=$1 RETURNING *`,[line.id,account.id,quantity,delivered]);
    await client.query('INSERT INTO pedido_item_extras(pedido_item_id,extra_id) SELECT $2,extra_id FROM pedido_item_extras WHERE pedido_item_id=$1',[line.id,copy.id]);
    // Mantener el lote, costo y fecha originales. Estos asientos únicamente
    // redistribuyen la propiedad del consumo, no modifican stock ni lotes.
    const {rows:movements}=await client.query(`SELECT * FROM movimientos_inventario m WHERE pedido_item_id=$1 AND tipo='consumo'
      AND NOT EXISTS(SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id=m.id) ORDER BY id FOR UPDATE`,[line.id]);
    for(const m of movements) {
      const {rows:[portion]}=await client.query('SELECT ROUND($1::numeric*$2::numeric/$3::numeric,3) AS cantidad',[m.cantidad,quantity,line.cantidad]);
      await client.query('UPDATE movimientos_inventario SET cantidad=cantidad-$2::numeric WHERE id=$1',[m.id,portion.cantidad]);
      await client.query(`INSERT INTO movimientos_inventario(sucursal_id,materia_prima_id,tipo,cantidad,lote_id,pedido_item_id,usuario_id,motivo,creado_en,costo_unitario,separado_de_id)
        VALUES($1,$2,'consumo',$3,$4,$5,$6,$7,$8,$9,$10)`,[sucursalId,m.materia_prima_id,portion.cantidad,m.lote_id,copy.id,m.usuario_id,`Separación de ${order.folio} a ${account.folio}`,m.creado_en,m.costo_unitario,m.id]);
    }
    await client.query(`UPDATE pedido_items SET cantidad=cantidad-$2,cantidad_entregada=cantidad_entregada-$3 WHERE id=$1`,[line.id,quantity,delivered]);
  }
  const child=await recalcularImportes(client,account.id);
  const remaining=await recalcularImportes(client,order.id);
  // Distribuir centavos según el importe pendiente impide que muchas cuentas
  // pequeñas acumulen redondeos y dejen un saldo negativo en la original.
  const {rows:[allocation]}=await client.query(`SELECT CASE WHEN $2::numeric>0 THEN ROUND($1::numeric*$3::numeric/$2::numeric,2) ELSE 0 END AS total`,
    [order.total,Number(order.subtotal)-Number(order.cortesia_valor),Number(child.subtotal)-Number(child.cortesia_valor)]);
  await client.query('UPDATE pedidos SET ajuste_redondeo=$2::numeric,total=$3::numeric WHERE id=$1',[child.id,(Number(allocation.total)-Number(child.total)).toFixed(2),allocation.total]);
  await client.query('UPDATE pedidos SET ajuste_redondeo=ajuste_redondeo+$2::numeric,total=total+$2::numeric WHERE id=$1',[id,(Number(order.total)-Number(allocation.total)-Number(remaining.total)).toFixed(2)]);
  child.ajuste_redondeo=(Number(allocation.total)-Number(child.total)).toFixed(2);
  child.total=allocation.total;
  await client.query(`INSERT INTO separaciones_cuenta(client_uuid,sucursal_id,usuario_id,pedido_id,cuenta_id,detalle) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[body.clientUuid,sucursalId,auth.id,id,account.id,JSON.stringify(body.items)]);
  await client.query(`INSERT INTO auditoria(usuario_id,sucursal_id,entidad,entidad_id,accion,valor_anterior,valor_nuevo,motivo)
    VALUES($1,$2,'pedidos',$3,'separar_cuenta',$4::jsonb,$5::jsonb,'Separación de productos sin nuevo consumo')`,[auth.id,sucursalId,id,JSON.stringify({total:order.total,items:lines}),JSON.stringify({cuentaId:account.id,folio:account.folio,items:body.items})]);
  return {cuenta:child};
}
module.exports={splitAccount};
