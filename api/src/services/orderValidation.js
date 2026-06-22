const { ApiError } = require('../utils/asyncHandler');
const { calcularPrecioItem } = require('../utils/pricing');

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'El pedido necesita al menos un producto.');
  if (items.length > 50) throw new ApiError(400, 'Un pedido no puede contener más de 50 productos distintos.');
  return items.map(item => {
    const cantidad = Number(item.cantidad ?? 1);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) {
      throw new ApiError(400, 'La cantidad de cada producto debe ser un entero entre 1 y 50.');
    }
    const extraIds = item.extraIds === undefined ? [] : item.extraIds;
    if (!Array.isArray(extraIds)) throw new ApiError(400, 'extraIds debe ser una lista.');
    return { ...item, cantidad, extraIds, esRegalo: item.esRegalo === true };
  });
}

async function prepareOrderLines(client, items, customerId) {
  const normalized = normalizeItems(items);
  const lines = [];
  for (const item of normalized) {
    // eslint-disable-next-line no-await-in-loop
    const regularPrice = await calcularPrecioItem({
      productoId: item.productoId,
      tamanoId: item.tamanoId,
      lecheId: item.lecheId,
      cafeId: item.cafeId,
      extraIds: item.extraIds,
    }, client.query.bind(client));
    lines.push({ ...item, precioUnitario: regularPrice });
  }

  const giftLines = lines.filter(line => line.esRegalo);
  if (giftLines.length === 0) return { lines, isRewardOrder: false };
  if (!customerId) throw new ApiError(400, 'Un regalo de fidelidad necesita un cliente.');
  if (giftLines.length !== lines.length || lines.length !== 1 || lines[0].cantidad !== 1) {
    throw new ApiError(400, 'Una recompensa debe ser un pedido separado de un solo producto y cantidad 1.');
  }
  if (lines[0].extraIds.length > 0) throw new ApiError(400, 'La recompensa no admite extras.');

  const customer = await client.query(
    'SELECT recompensa_pendiente FROM clientes WHERE id = $1 FOR UPDATE',
    [customerId]
  );
  if (customer.rows.length === 0) throw new ApiError(404, 'Cliente no encontrado.');
  if (!customer.rows[0].recompensa_pendiente) throw new ApiError(409, 'El cliente no tiene una recompensa pendiente.');

  const promotion = await client.query(
    'SELECT activo, producto_premio_id FROM promocion_fidelidad ORDER BY actualizado_en DESC LIMIT 1'
  );
  const activePromotion = promotion.rows[0];
  if (!activePromotion?.activo || !activePromotion.producto_premio_id) {
    throw new ApiError(409, 'No hay una recompensa activa.');
  }
  if (String(activePromotion.producto_premio_id) !== String(lines[0].productoId)) {
    throw new ApiError(400, 'El producto seleccionado no es la recompensa configurada.');
  }

  const consumed = await client.query(
    'UPDATE clientes SET recompensa_pendiente = false WHERE id = $1 AND recompensa_pendiente = true RETURNING id',
    [customerId]
  );
  if (consumed.rows.length === 0) throw new ApiError(409, 'La recompensa ya fue utilizada.');
  lines[0].precioUnitario = 0;
  return { lines, isRewardOrder: true };
}

module.exports = { normalizeItems, prepareOrderLines };
