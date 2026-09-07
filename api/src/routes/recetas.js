const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, resolveSucursal); // cualquier sesión autenticada puede VER las recetas de SU sede

// Todas las recetas de una vez (para precargar lo que ve el barista).
router.get('/', asyncHandler(async (req, res) => {
  // Incluye los ingredientes fijos de cada receta para que la vista de la
  // receta (barista/admin) muestre lo que realmente se descuenta.
  const { rows } = await query(
    `SELECT r.*,
            COALESCE((SELECT json_agg(json_build_object(
                        'materia_prima_id', rif.materia_prima_id, 'cantidad', rif.cantidad,
                        'unidad', rif.unidad, 'materia_prima', m.nombre) ORDER BY m.nombre)
                      FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
                      WHERE rif.producto_id = r.producto_id), '[]'::json) AS insumos_fijos
     FROM recetas r JOIN productos p ON p.id = r.producto_id WHERE p.sucursal_id = $1`,
    [req.sucursalId]
  );
  res.json(rows);
}));

router.get('/:productoId', asyncHandler(async (req, res) => {
  const receta = await query(
    'SELECT r.* FROM recetas r JOIN productos p ON p.id = r.producto_id WHERE r.producto_id = $1 AND p.sucursal_id = $2',
    [req.params.productoId, req.sucursalId]
  );
  if (receta.rows.length === 0) throw new ApiError(404, 'Este producto no tiene receta (¿es un snack?).');
  const fijos = await query(
    `SELECT rif.materia_prima_id, rif.cantidad, rif.unidad, m.nombre AS materia_prima
     FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
     WHERE rif.producto_id = $1`,
    [req.params.productoId]
  );
  res.json({ ...receta.rows[0], insumos_fijos: fijos.rows });
}));

// Guarda la receta: pasos/parámetros Y — si viene insumosFijos — sus
// INGREDIENTES del inventario ([{ materiaPrimaId, cantidad, unidad }],
// reemplaza la lista completa). De estos ingredientes sale el costo directo
// del producto (fn_costo_teorico_producto), que alimenta el precio sugerido.
router.put('/:productoId', requireRole('admin'), asyncHandler(async (req, res) => {
  const { pasos, gramajePorShot, molienda, moliendaEspecial, ajusteMolino, ajusteMolinoEspecial, tiempoExtraccion, tiempoExtraccionEspecial, temperaturaServicio, texturaLeche, insumosFijos, lecheMlPorTamano } = req.body;
  if (!Array.isArray(pasos) || pasos.length === 0) throw new ApiError(400, 'Agrega al menos un paso de preparación.');
  if (insumosFijos !== undefined && !Array.isArray(insumosFijos)) throw new ApiError(400, 'insumosFijos debe ser una lista.');
  if (gramajePorShot !== undefined && (!Number.isFinite(Number(gramajePorShot)) || Number(gramajePorShot) <= 0 || Number(gramajePorShot) > 1000)) {
    throw new ApiError(400, 'Indica un gramaje de café mayor a 0 y hasta 1000 g por shot.');
  }

  // Leche por tamaño de ESTE producto: { "8": 180, "12": 280, ... } con los
  // códigos de tamaño de la sede; null/undefined = predeterminado de la sede.
  let lecheJson = null;
  if (lecheMlPorTamano !== undefined && lecheMlPorTamano !== null) {
    if (typeof lecheMlPorTamano !== 'object' || Array.isArray(lecheMlPorTamano)) throw new ApiError(400, 'lecheMlPorTamano debe ser un objeto { codigoTamano: ml }.');
    const tamanos = await query('SELECT codigo FROM opciones_tamano WHERE sucursal_id = $1', [req.sucursalId]);
    const validos = new Set(tamanos.rows.map(t => t.codigo));
    const limpio = {};
    for (const [codigo, ml] of Object.entries(lecheMlPorTamano)) {
      if (!validos.has(codigo)) throw new ApiError(400, `Tamaño desconocido en la leche por tamaño: ${codigo}.`);
      const n = Number(ml);
      if (!Number.isFinite(n) || n < 0 || n > 5000) throw new ApiError(400, `La leche del tamaño ${codigo} debe ser un número de ml entre 0 y 5000.`);
      limpio[codigo] = Math.round(n * 100) / 100;
    }
    if (Object.keys(limpio).length > 0) lecheJson = JSON.stringify(limpio);
  }

  const receta = await withTransaction(async client => {
    if (insumosFijos?.length) {
      const duplicado = await client.query(
        `SELECT 1 FROM productos p JOIN opciones_cafe oc ON oc.sucursal_id = p.sucursal_id
         WHERE p.id=$1 AND p.sucursal_id=$2 AND p.permite_tipo_cafe
           AND oc.materia_prima_id = ANY($3::uuid[]) LIMIT 1`,
        [req.params.productoId, req.sucursalId, insumosFijos.map(i => i.materiaPrimaId)]);
      if (duplicado.rows.length) throw new ApiError(400, 'El café se toma de los ingredientes base según la elección de la venta. Quítalo de los ingredientes fijos para no descontarlo dos veces.');
    }
    const { rows } = await client.query(
      `UPDATE recetas SET
         pasos = $1::jsonb, gramaje_por_shot = COALESCE($2, gramaje_por_shot), molienda = $3, molienda_especial = $4,
         ajuste_molino = $5, ajuste_molino_especial = $6, tiempo_extraccion = $7, tiempo_extraccion_especial = $8,
         temperatura_servicio = $9, textura_leche = $10, es_personalizada = true,
         leche_ml_por_tamano = CASE WHEN $14::boolean THEN $15::jsonb ELSE leche_ml_por_tamano END,
         actualizado_por = $11, actualizado_en = now()
       WHERE producto_id = $12 AND EXISTS (SELECT 1 FROM productos p WHERE p.id = $12 AND p.sucursal_id = $13) RETURNING *`,
      [JSON.stringify(pasos), gramajePorShot || null, molienda || null, moliendaEspecial || null,
        ajusteMolino || null, ajusteMolinoEspecial || null, tiempoExtraccion || null, tiempoExtraccionEspecial || null,
        temperaturaServicio || null, texturaLeche || null, req.auth.id, req.params.productoId, req.sucursalId,
        lecheMlPorTamano !== undefined, lecheJson]
    );
    if (rows.length === 0) throw new ApiError(404, 'Receta no encontrada para ese producto.');

    if (insumosFijos !== undefined) {
      if (insumosFijos.length > 30) throw new ApiError(400, 'Una receta no puede tener más de 30 ingredientes fijos.');
      await client.query('DELETE FROM receta_insumos_fijos WHERE producto_id = $1', [req.params.productoId]);
      for (const ins of insumosFijos) {
        const cantidad = Number(ins.cantidad);
        if (!ins.materiaPrimaId) throw new ApiError(400, 'Cada ingrediente necesita materiaPrimaId.');
        if (!Number.isFinite(cantidad) || cantidad <= 0) throw new ApiError(400, 'La cantidad de cada ingrediente debe ser mayor a 0.');
        const propia = await client.query('SELECT id FROM materias_primas WHERE id = $1 AND sucursal_id = $2', [ins.materiaPrimaId, req.sucursalId]);
        if (propia.rows.length === 0) throw new ApiError(400, 'Un ingrediente no pertenece a esta sucursal.');
        await client.query(
          'INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES ($1,$2,$3,$4::unidad_medida)',
          [req.params.productoId, ins.materiaPrimaId, cantidad, ins.unidad]
        );
      }
    }
    return rows[0];
  });

  const fijos = await query(
    `SELECT rif.materia_prima_id, rif.cantidad, rif.unidad, m.nombre AS materia_prima
     FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
     WHERE rif.producto_id = $1`,
    [req.params.productoId]
  );
  res.json({ ...receta, insumos_fijos: fijos.rows });
}));

router.post('/:productoId/restaurar', requireRole('admin'), asyncHandler(async (req, res) => {
  const propio = await query('SELECT id FROM productos WHERE id = $1 AND sucursal_id = $2', [req.params.productoId, req.sucursalId]);
  if (propio.rows.length === 0) throw new ApiError(404, 'Producto no encontrado.');
  const { rows } = await query('SELECT * FROM fn_resetear_receta($1)', [req.params.productoId]);
  res.json(rows[0]);
}));

module.exports = router;
