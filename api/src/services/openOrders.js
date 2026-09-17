const { ApiError } = require('../utils/asyncHandler');
const { prepareOrderLines } = require('./orderValidation');
const { correctCashItem } = require('./cashItemReturns');
const { entregarItemsDeCaja } = require('./stations');

async function lockOpenOrder(client, id, sucursalId) {
  const { rows: [order] } = await client.query('SELECT * FROM pedidos WHERE id=$1 AND sucursal_id=$2 FOR UPDATE', [id, sucursalId]);
  if (!order) throw new ApiError(404, 'Pedido no encontrado.');
  if (order.cobrado || order.cancelado || order.no_show || order.cancelacion_estado === 'pendiente') {
    throw new ApiError(409, 'El ticket ya se cobró, se canceló o tiene una cancelación pendiente. Actualiza la lista.');
  }
  if (order.es_regalo_fidelidad || order.registro_manual) throw new ApiError(409, 'Este tipo de ticket no admite cambios.');
  return order;
}

async function recalculate(client, id) {
  const { rows: [order] } = await client.query(`UPDATE pedidos SET
    subtotal=(SELECT COALESCE(SUM(cantidad*precio_unitario),0) FROM pedido_items WHERE pedido_id=$1 AND estado<>'cancelado'),
    total=ROUND((SELECT COALESCE(SUM(cantidad*precio_unitario),0) FROM pedido_items WHERE pedido_id=$1 AND estado<>'cancelado') * (1-descuento_porcentaje/100),2)
    WHERE id=$1 RETURNING *`, [id]);
  return order;
}
async function audit(client, auth, order, action, before, after) {
  await client.query(`INSERT INTO auditoria (usuario_id,sucursal_id,entidad,entidad_id,accion,valor_anterior,valor_nuevo,motivo)
    VALUES ($1,$2,'pedidos',$3,$4,$5::jsonb,$6::jsonb,'Edición de ticket abierto antes del cobro')`,
    [auth.id,order.sucursal_id,order.id,action,JSON.stringify(before),JSON.stringify(after)]);
}

async function addOrderItems(client, { id, sucursalId, auth, items }) {
  const order = await lockOpenOrder(client, id, sucursalId);
  if (Array.isArray(items) && items.some(i => i.esRegalo === true)) throw new ApiError(400, 'Las recompensas se registran en un pedido separado.');
  const count = await client.query("SELECT COUNT(*)::int AS n FROM pedido_items WHERE pedido_id=$1 AND estado<>'cancelado'", [id]);
  if (count.rows[0].n + (Array.isArray(items) ? items.length : 0) > 50) throw new ApiError(400, 'El ticket admite hasta 50 líneas; abre otro ticket.');
  const { lines } = await prepareOrderLines(client, items, null, sucursalId);
  const added = [];
  for (const line of lines) {
    const { rows: [item] } = await client.query(`INSERT INTO pedido_items
      (pedido_id,producto_id,tamano_id,leche_id,cafe_id,cantidad,precio_unitario,notas,es_regalo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false) RETURNING *`,
      [id,line.productoId,line.tamanoId||null,line.lecheId||null,line.cafeId||null,line.cantidad,line.precioUnitario,line.notas||null]);
    for (const extraId of line.extraIds) await client.query('INSERT INTO pedido_item_extras (pedido_item_id,extra_id) VALUES ($1,$2)',[item.id,extraId]);
    added.push(item);
  }
  await entregarItemsDeCaja(client,id);
  const updated = await recalculate(client,id);
  await audit(client,auth,order,'agregar_productos',{total:order.total},{total:updated.total,items:added});
  return updated;
}

async function changeOrderItem(client, { id, itemId, sucursalId, auth, cantidad, cantidadEsperada, motivo, devuelto }) {
  if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > 50) throw new ApiError(400,'La cantidad debe ser un entero entre 0 y 50.');
  const order = await lockOpenOrder(client,id,sucursalId);
  const { rows: [item] } = await client.query('SELECT * FROM pedido_items WHERE id=$1 AND pedido_id=$2 FOR UPDATE',[itemId,id]);
  if (!item) throw new ApiError(404,'El producto ya no está en este ticket. Actualiza el detalle.');
  const esCaja = item.estacion_preparacion === 'caja' && item.estado === 'terminado';
  if (!esCaja && item.estado !== 'pendiente') throw new ApiError(409,'Este producto ya comenzó a prepararse, fue entregado o retirado. Actualiza el ticket.');
  if (cantidadEsperada !== Number(item.cantidad)) throw new ApiError(409,'La cantidad cambió desde que abriste el ticket. Revisa el detalle actualizado.');
  if (cantidad === Number(item.cantidad)) return order;
  if (esCaja) {
    await correctCashItem(client,{item,cantidad,auth,motivo,devuelto});
    const updated = await recalculate(client,id);
    await audit(client,auth,order,'corregir_entrega_caja',item,{itemId,cantidad,total:updated.total,motivo:motivo.trim(),devuelto:devuelto===true});
    return updated;
  }
  if (cantidad === 0) {
    const { rows: [count] } = await client.query("SELECT COUNT(*)::int AS n FROM pedido_items WHERE pedido_id=$1 AND estado<>'cancelado'",[id]);
    if (count.n <= 1) throw new ApiError(409,'Para quitar el último producto, usa Cancelar ticket.');
    const { rows: extras } = await client.query('SELECT extra_id FROM pedido_item_extras WHERE pedido_item_id=$1',[itemId]);
    item.extras = extras;
    await client.query('DELETE FROM pedido_items WHERE id=$1',[itemId]);
  } else {
    await client.query('UPDATE pedido_items SET cantidad=$1 WHERE id=$2',[cantidad,itemId]);
  }
  const updated = await recalculate(client,id);
  await audit(client,auth,order,cantidad===0?'quitar_producto':'cambiar_cantidad',item,{itemId,cantidad,total:updated.total});
  return updated;
}
module.exports = { addOrderItems, changeOrderItem };
