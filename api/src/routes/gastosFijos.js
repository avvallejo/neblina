const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'), resolveSucursal);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM gastos_fijos WHERE sucursal_id = $1 ORDER BY categoria, concepto', [req.sucursalId]);
  res.json(rows);
}));

router.get('/total-mensual', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT fn_gastos_fijos_totales_mes($1) AS total', [req.sucursalId]);
  res.json({ total: rows[0].total });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { concepto, categoria, montoMensual } = req.body;
  if (!concepto?.trim()) throw new ApiError(400, 'Describe el gasto (ej. "Renta del local").');
  if (montoMensual === undefined || montoMensual < 0) throw new ApiError(400, 'Indica el monto mensual.');
  const { rows } = await query(
    'INSERT INTO gastos_fijos (concepto, categoria, monto_mensual, sucursal_id) VALUES ($1,$2,$3,$4) RETURNING *',
    [concepto.trim(), categoria || 'Otro', montoMensual, req.sucursalId]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const mapeo = { concepto: 'concepto', categoria: 'categoria', montoMensual: 'monto_mensual', activo: 'activo' };
  const sets = [];
  const values = [];
  let i = 1;
  for (const [campoApi, columna] of Object.entries(mapeo)) {
    if (req.body[campoApi] !== undefined) { sets.push(`${columna} = $${i++}`); values.push(req.body[campoApi]); }
  }
  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');
  values.push(req.params.id, req.sucursalId);
  const { rows } = await query(
    `UPDATE gastos_fijos SET ${sets.join(', ')} WHERE id = $${i} AND sucursal_id = $${i + 1} RETURNING *`,
    values
  );
  if (rows.length === 0) throw new ApiError(404, 'Gasto no encontrado.');
  res.json(rows[0]);
}));

// Un gasto fijo no deja historial en otras tablas (no hay FKs hacia él), así
// que se puede borrar de verdad. "Desactivar" queda para pausas temporales
// (ej. un gasto de temporada) sin perder el dato.
router.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('DELETE FROM gastos_fijos WHERE id = $1 AND sucursal_id = $2 RETURNING id', [req.params.id, req.sucursalId]);
  if (rows.length === 0) throw new ApiError(404, 'Gasto no encontrado.');
  res.json({ id: rows[0].id, eliminado: true });
}));

module.exports = router;
