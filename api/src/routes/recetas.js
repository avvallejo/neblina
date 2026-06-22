const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth); // cualquier personal autenticado puede VER recetas

router.get('/:productoId', asyncHandler(async (req, res) => {
  const receta = await query('SELECT * FROM recetas WHERE producto_id = $1', [req.params.productoId]);
  if (receta.rows.length === 0) throw new ApiError(404, 'Este producto no tiene receta (¿es un snack?).');
  const fijos = await query(
    `SELECT rif.cantidad, rif.unidad, m.nombre AS materia_prima
     FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
     WHERE rif.producto_id = $1`,
    [req.params.productoId]
  );
  res.json({ ...receta.rows[0], insumos_fijos: fijos.rows });
}));

router.put('/:productoId', requireRole('admin'), asyncHandler(async (req, res) => {
  const { pasos, gramajePorShot, molienda, moliendaEspecial, ajusteMolino, ajusteMolinoEspecial, tiempoExtraccion, temperaturaServicio, texturaLeche } = req.body;
  if (!Array.isArray(pasos) || pasos.length === 0) throw new ApiError(400, 'Agrega al menos un paso de preparación.');

  const { rows } = await query(
    `UPDATE recetas SET
       pasos = $1::jsonb, gramaje_por_shot = $2, molienda = $3, molienda_especial = $4,
       ajuste_molino = $5, ajuste_molino_especial = $6, tiempo_extraccion = $7,
       temperatura_servicio = $8, textura_leche = $9, es_personalizada = true,
       actualizado_por = $10, actualizado_en = now()
     WHERE producto_id = $11 RETURNING *`,
    [JSON.stringify(pasos), gramajePorShot || null, molienda || null, moliendaEspecial || null,
      ajusteMolino || null, ajusteMolinoEspecial || null, tiempoExtraccion || null,
      temperaturaServicio || null, texturaLeche || null, req.auth.id, req.params.productoId]
  );
  if (rows.length === 0) throw new ApiError(404, 'Receta no encontrada para ese producto.');
  res.json(rows[0]);
}));

router.post('/:productoId/restaurar', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM fn_resetear_receta($1)', [req.params.productoId]);
  res.json(rows[0]);
}));

module.exports = router;
