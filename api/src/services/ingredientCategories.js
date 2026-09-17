const { ApiError } = require('../utils/asyncHandler');

async function guardarCategoriasUso(client, materiaId, sucursalId, categorias) {
  if (categorias === undefined) return;
  if (!Array.isArray(categorias) || categorias.length > 100 || categorias.some(id => !Number.isInteger(id) || id < 1)) {
    throw new ApiError(400, 'Se utiliza en debe ser una lista de categorías del menú.');
  }
  const ids = [...new Set(categorias)];
  const { rows } = await client.query('SELECT id FROM categorias_producto WHERE sucursal_id=$1 AND id=ANY($2::integer[])', [sucursalId, ids]);
  if (rows.length !== ids.length) throw new ApiError(400, 'Una categoría de uso no pertenece a esta sucursal.');
  await client.query('DELETE FROM materia_categorias_uso WHERE materia_prima_id=$1', [materiaId]);
  await client.query('INSERT INTO materia_categorias_uso (materia_prima_id,categoria_id) SELECT $1,unnest($2::integer[])', [materiaId, ids]);
}
module.exports = { guardarCategoriasUso };
