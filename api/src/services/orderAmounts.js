// IMPORTES DE UN TICKET a partir de sus líneas (fuente única de verdad):
//   subtotal          = todo a precio de menú (líneas no canceladas)
//   cortesia_valor    = lo regalado a precio de menú (líneas es_cortesia)
//   cortesia_unidades = unidades regaladas (el cupo mensual se consume por unidad)
//   total             = (subtotal − cortesia_valor) × (1 − descuento)
// Se llama dentro de la transacción cada vez que cambian las líneas o las
// marcas de cortesía; devuelve el pedido ya actualizado.
async function recalcularImportes(client, pedidoId) {
  const { rows: [pedido] } = await client.query(
    `UPDATE pedidos p SET
       subtotal = s.subtotal, cortesia_valor = s.cortesia_valor, cortesia_unidades = s.cortesia_unidades,
       total = ROUND((s.subtotal - s.cortesia_valor) * (1 - p.descuento_porcentaje / 100), 2)
     FROM (SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS subtotal,
                  COALESCE(SUM(cantidad * precio_unitario) FILTER (WHERE es_cortesia), 0) AS cortesia_valor,
                  COALESCE(SUM(cantidad) FILTER (WHERE es_cortesia), 0)::int AS cortesia_unidades
           FROM pedido_items WHERE pedido_id = $1 AND estado <> 'cancelado') s
     WHERE p.id = $1 RETURNING p.*`,
    [pedidoId]
  );
  return pedido;
}

// Marca qué líneas del ticket son de cortesía (la lista sustituye a la
// anterior: lo que no venga deja de ser cortesía). Solo líneas vivas del ticket.
async function marcarLineasCortesia(client, pedidoId, itemIds, ApiError) {
  const ids = [...new Set((itemIds || []).map(String))];
  if (ids.length) {
    const { rows } = await client.query(
      `SELECT id::text, es_regalo FROM pedido_items WHERE pedido_id = $1 AND estado <> 'cancelado' AND id::text = ANY($2::text[])`,
      [pedidoId, ids]
    );
    if (rows.length !== ids.length) throw new ApiError(409, 'Alguno de los productos marcados ya no está en el ticket. Actualiza el detalle.');
    if (rows.some(r => r.es_regalo)) throw new ApiError(400, 'Una recompensa de fidelidad ya es gratis; no se marca como cortesía.');
  }
  await client.query(
    `UPDATE pedido_items SET es_cortesia = (id::text = ANY($2::text[])) WHERE pedido_id = $1 AND es_cortesia IS DISTINCT FROM (id::text = ANY($2::text[]))`,
    [pedidoId, ids]
  );
}

module.exports = { recalcularImportes, marcarLineasCortesia };
