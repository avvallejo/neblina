const { ApiError } = require('../utils/asyncHandler');

// El historial usa la fecha de preparación, independientemente de cuándo se cobró.
const trackingSelectSql = `
SELECT p.id AS pedido_id, p.folio, p.nombre_ticket, p.destino, p.mesa_numero, p.origen, p.cobrado,
  p.cancelado, p.no_show, p.cancelacion_estado, p.creado_en AS pedido_creado_en,
  CONCAT_WS(' ',c.nombre,c.apellido) AS cliente_nombre, cajero.nombre AS levantado_por_nombre,
  pi.id, pi.cantidad, pi.estado, pi.estacion_preparacion AS estacion, pi.notas,
  pi.iniciado_en, pi.terminado_en, pi.terminado_por, pi.barista_id,
  pi.cantidad_entregada, pi.entregado_en, pi.entregado_por,
  pr.nombre AS producto_nombre, fin.nombre AS terminado_por_nombre, ini.nombre AS iniciado_por_nombre,
  entrega.nombre AS entregado_por_nombre,
  ot.etiqueta AS tamano, ol.etiqueta AS leche, oc.etiqueta AS cafe,
  COALESCE((SELECT json_agg(oe.etiqueta) FROM pedido_item_extras pie JOIN opciones_extra oe ON oe.id=pie.extra_id WHERE pie.pedido_item_id=pi.id),'[]') AS extras
FROM pedido_items pi JOIN pedidos p ON p.id=pi.pedido_id
LEFT JOIN productos pr ON pr.id=pi.producto_id
LEFT JOIN clientes c ON c.id=p.cliente_id
LEFT JOIN usuarios cajero ON cajero.id=p.cajero_id
LEFT JOIN usuarios ini ON ini.id=pi.barista_id
LEFT JOIN usuarios fin ON fin.id=pi.terminado_por
LEFT JOIN usuarios entrega ON entrega.id=pi.entregado_por
LEFT JOIN opciones_tamano ot ON ot.id=pi.tamano_id
LEFT JOIN opciones_leche ol ON ol.id=pi.leche_id
LEFT JOIN opciones_cafe oc ON oc.id=pi.cafe_id
`;
const preparationTrackingSql = `${trackingSelectSql}
WHERE p.sucursal_id=$1 AND pi.estacion_preparacion IN ('barra','parrilla','caja')
  AND (
    ($2::boolean AND pi.estacion_preparacion <> 'caja' AND pi.terminado_en >= $3::date::timestamp AT TIME ZONE 'America/Mexico_City'
      AND pi.terminado_en < ($3::date+1)::timestamp AT TIME ZONE 'America/Mexico_City')
    OR (NOT $2::boolean AND NOT p.cancelado AND NOT p.no_show AND pi.estado <> 'cancelado'
      AND EXISTS (SELECT 1 FROM pedido_items pendiente WHERE pendiente.pedido_id=p.id
        AND pendiente.estacion_preparacion IN ('barra','parrilla','caja') AND pendiente.estado <> 'cancelado'
        AND (pendiente.estado <> 'terminado' OR pendiente.cantidad_entregada < pendiente.cantidad)))
  )
ORDER BY p.creado_en, p.id, pi.creado_en, pi.id`;

// Cada entrega parcial conserva su empleado y hora aunque otro entregue el resto.
const deliveryHistorySql = `
SELECT q.*, a.id AS entrega_id, a.usuario_id AS entregado_por,
  responsable.nombre AS entregado_por_nombre, a.creado_en AS entregado_en,
  ((a.valor_nuevo->>'cantidadEntregada')::int - (a.valor_anterior->>'cantidadEntregada')::int) AS unidades_entregadas_evento
FROM (${trackingSelectSql}
  WHERE p.sucursal_id=$1) q
JOIN auditoria a ON a.entidad='pedido_items' AND a.entidad_id=q.id::text AND a.accion='entregar_producto' AND a.sucursal_id=$1
LEFT JOIN usuarios responsable ON responsable.id=a.usuario_id
WHERE a.creado_en >= $2::date::timestamp AT TIME ZONE 'America/Mexico_City'
  AND a.creado_en < ($2::date+1)::timestamp AT TIME ZONE 'America/Mexico_City'
ORDER BY a.creado_en DESC, a.id`;

async function deliverItem(client, { orderId, itemId, sucursalId, auth, cantidad, cantidadEsperada }) {
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50 || !Number.isInteger(cantidadEsperada) || cantidadEsperada < 0) {
    throw new ApiError(400, 'Indica una cantidad válida para entregar.');
  }
  const { rows: [order] } = await client.query('SELECT id, cancelado, no_show, cancelacion_estado FROM pedidos WHERE id=$1 AND sucursal_id=$2 FOR UPDATE', [orderId, sucursalId]);
  if (!order) throw new ApiError(404, 'Pedido no encontrado.');
  if (order.cancelado || order.no_show || order.cancelacion_estado === 'pendiente') throw new ApiError(409, 'El pedido está cancelado o tiene una cancelación pendiente.');
  const { rows: [item] } = await client.query('SELECT * FROM pedido_items WHERE id=$1 AND pedido_id=$2 FOR UPDATE', [itemId, orderId]);
  if (!item || item.estado !== 'terminado' || !['barra','parrilla','caja'].includes(item.estacion_preparacion)) throw new ApiError(409, 'Solo puedes entregar productos listos para surtir o preparados.');
  if (Number(item.cantidad_entregada) !== cantidadEsperada) throw new ApiError(409, 'Otra persona ya actualizó la entrega. Revisa la comanda.');
  if (cantidadEsperada + cantidad > Number(item.cantidad)) throw new ApiError(409, 'La cantidad supera lo que falta entregar.');
  const { rows: [updated] } = await client.query('UPDATE pedido_items SET cantidad_entregada=cantidad_entregada+$1, entregado_en=now(), entregado_por=$2 WHERE id=$3 RETURNING *', [cantidad, auth.id, itemId]);
  await client.query(`INSERT INTO auditoria (usuario_id,sucursal_id,entidad,entidad_id,accion,valor_anterior,valor_nuevo,motivo)
    VALUES ($1,$2,'pedido_items',$3,'entregar_producto',$4::jsonb,$5::jsonb,'Entrega al cliente desde caja')`,
    [auth.id,sucursalId,itemId,JSON.stringify({cantidadEntregada:cantidadEsperada}),JSON.stringify({cantidadEntregada:updated.cantidad_entregada,pedidoId:orderId})]);
  return updated;
}
module.exports = { preparationTrackingSql, deliveryHistorySql, deliverItem };
