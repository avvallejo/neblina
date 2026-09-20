const { ApiError } = require('../utils/asyncHandler');
const { estacionesDe, ESTACIONES_USUARIO } = require('./stations');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un lote es una acción atómica sobre las líneas que la persona vio en pantalla.
// Las líneas nuevas y las de otra estación nunca se incluyen por accidente.
async function prepareBatch(client, { auth, sucursalId, orderId, estacion, itemIds, action }) {
  if (!UUID.test(orderId) || !ESTACIONES_USUARIO.includes(estacion) || !['iniciar', 'terminar'].includes(action)
    || !Array.isArray(itemIds) || !itemIds.length || itemIds.length > 50 || itemIds.some(id => typeof id !== 'string' || !UUID.test(id))) {
    throw new ApiError(400, 'Selecciona los productos de una estación y un ticket válidos.');
  }
  const estaciones = await estacionesDe(client.query.bind(client), auth);
  if (!estaciones.includes(estacion)) throw new ApiError(403, 'Esta estación no te corresponde.');
  const { rows: [order] } = await client.query('SELECT id, cancelado, no_show FROM pedidos WHERE id=$1 AND sucursal_id=$2 FOR UPDATE', [orderId, sucursalId]);
  if (!order) throw new ApiError(404, 'Pedido no encontrado.');
  if (order.cancelado || order.no_show) throw new ApiError(409, 'El pedido ya no está disponible para preparación.');
  const ids = [...new Set(itemIds)];
  const { rows: lines } = await client.query('SELECT id, estado, estacion_preparacion FROM pedido_items WHERE pedido_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [orderId, ids]);
  if (lines.length !== ids.length || lines.some(line => line.estacion_preparacion !== estacion || line.estado === 'cancelado')) {
    throw new ApiError(409, 'Los productos del ticket cambiaron. Actualiza la comanda.');
  }
  const update = action === 'iniciar'
    ? "estado='en_preparacion', iniciado_en=now(), barista_id=$1"
    : "estado='terminado', terminado_en=now(), terminado_por=$1, barista_id=COALESCE(barista_id,$1)";
  const states = action === 'iniciar' ? ['pendiente'] : ['pendiente', 'en_preparacion'];
  const { rows } = await client.query(`UPDATE pedido_items SET ${update}
    WHERE pedido_id=$2 AND id=ANY($3::uuid[]) AND estado::text=ANY($4::text[]) RETURNING *`, [auth.id, orderId, ids, states]);
  return rows;
}
module.exports = { prepareBatch };
