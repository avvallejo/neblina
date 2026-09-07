const { ApiError } = require('../utils/asyncHandler');

async function preciosPorRevisar(client, sucursalId) {
  const { rows } = await client.query(
    `SELECT v.*, fn_revision_precio(v.id) AS revision FROM vw_precios_por_revisar v
     JOIN productos p ON p.id=v.id
     WHERE v.sucursal_id=$1 AND ABS(v.diferencia)>=0.01
       AND p.revision_precio_aceptada IS DISTINCT FROM fn_revision_precio(v.id)
     ORDER BY ABS(v.diferencia) DESC`, [sucursalId]);
  return rows;
}

async function mantenerPrecio(client, { id, sucursalId, revision }) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{32}$/.test(revision)) {
    throw new ApiError(400, 'Actualiza la lista de precios antes de confirmar.');
  }
  const { rows } = await client.query(
    `UPDATE productos SET revision_precio_aceptada=$3
     WHERE id=$1 AND sucursal_id=$2 AND activo AND tipo<>'snack'
       AND fn_revision_precio(id)=$3
     RETURNING id, precio_base`, [id,sucursalId,revision]);
  if (!rows.length) throw new ApiError(409, 'La receta o sus insumos cambiaron, o el producto ya no está disponible. Actualiza la lista y vuelve a revisar.');
  return rows[0];
}

module.exports = { preciosPorRevisar, mantenerPrecio };
