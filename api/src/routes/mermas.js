const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('barista', 'admin'));

// Registrar una merma SIEMPRE descuenta el insumo real (trigger en la base de
// datos) — a diferencia del prototipo de UI, que solo la anotaba.
router.post('/', asyncHandler(async (req, res) => {
  const { materiaPrimaId, cantidad, unidad, motivo, pedidoItemId, observacion } = req.body;
  if (!materiaPrimaId) throw new ApiError(400, 'Selecciona el insumo afectado.');
  if (!cantidad || cantidad <= 0) throw new ApiError(400, 'Indica una cantidad mayor a 0.');
  if (!motivo?.trim()) throw new ApiError(400, 'Indica el motivo de la merma.');

  const { rows } = await query(
    `INSERT INTO mermas (materia_prima_id, cantidad, unidad, motivo, pedido_item_id, usuario_id, observacion)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [materiaPrimaId, cantidad, unidad, motivo.trim(), pedidoItemId || null, req.auth.id, observacion || null]
  );
  res.status(201).json(rows[0]);
}));

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT mr.*, m.nombre AS materia_prima, u.nombre AS usuario
     FROM mermas mr JOIN materias_primas m ON m.id = mr.materia_prima_id JOIN usuarios u ON u.id = mr.usuario_id
     ORDER BY mr.creado_en DESC LIMIT 200`
  );
  res.json(rows);
}));

module.exports = router;
