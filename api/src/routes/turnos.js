const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Público: el cliente necesita saber si la cafetería está abierta SIN tener
// que loguearse como personal.
router.get('/estado', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, abierto_en FROM turnos WHERE cerrado_en IS NULL LIMIT 1');
  res.json({ abierto: rows.length > 0, turno: rows[0] || null });
}));

router.use(requireAuth, requireRole('cajero', 'admin'));

router.post('/abrir', asyncHandler(async (req, res) => {
  const abierto = await query('SELECT id FROM turnos WHERE cerrado_en IS NULL');
  if (abierto.rows.length > 0) throw new ApiError(409, 'Ya hay un turno abierto.');
  const { rows } = await query('INSERT INTO turnos (abierto_por) VALUES ($1) RETURNING *', [req.auth.id]);
  res.status(201).json(rows[0]);
}));

router.post('/cerrar', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'UPDATE turnos SET cerrado_en = now(), cerrado_por = $1 WHERE cerrado_en IS NULL RETURNING *',
    [req.auth.id]
  );
  if (rows.length === 0) throw new ApiError(409, 'No hay un turno abierto.');
  res.json(rows[0]);
}));

router.get('/actual/kpis', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vw_kpis_turno_actual');
  res.json(rows[0] || { pedidos: 0, ventas: 0, ticket_promedio: 0, mermas: 0 });
}));

module.exports = router;
