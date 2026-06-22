const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM gastos_fijos ORDER BY categoria, concepto');
  res.json(rows);
}));

router.get('/total-mensual', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT fn_gastos_fijos_totales_mes() AS total');
  res.json({ total: rows[0].total });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { concepto, categoria, montoMensual } = req.body;
  if (!concepto?.trim()) throw new ApiError(400, 'Describe el gasto (ej. "Renta del local").');
  if (montoMensual === undefined || montoMensual < 0) throw new ApiError(400, 'Indica el monto mensual.');
  const { rows } = await query(
    'INSERT INTO gastos_fijos (concepto, categoria, monto_mensual) VALUES ($1,$2,$3) RETURNING *',
    [concepto.trim(), categoria || 'Otro', montoMensual]
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
  values.push(req.params.id);
  const { rows } = await query(`UPDATE gastos_fijos SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (rows.length === 0) throw new ApiError(404, 'Gasto no encontrado.');
  res.json(rows[0]);
}));

module.exports = router;
