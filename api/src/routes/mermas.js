const express = require('express');
const { mermaDate } = require('../services/mermaDate');
const { validateDate } = require('../services/dailySales');
const { query, withTransaction } = require('../db');
const { mesesAbiertos } = require('../services/stockAdjustmentHistory');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('barista', 'admin'), resolveSucursal);

// Registrar una merma SIEMPRE descuenta el insumo real (trigger en la base de
// datos). El sucursal_id explícito hace que el trigger de la base rechace un
// insumo que no sea de esta sede.
router.post('/', asyncHandler(async (req, res) => {
  const { materiaPrimaId, cantidad, unidad, motivo, pedidoItemId, observacion, fechaContable } = req.body;
  const fecha = mermaDate(fechaContable, req.auth.rol);
  if (!materiaPrimaId) throw new ApiError(400, 'Selecciona el insumo afectado.');
  if (!Number.isFinite(Number(cantidad)) || Number(cantidad) <= 0 || Math.abs(Number(cantidad) * 1000 - Math.round(Number(cantidad) * 1000)) > 0.0001) throw new ApiError(400, 'Indica una cantidad mayor a 0.');
  if (typeof motivo !== 'string' || !motivo.trim()) throw new ApiError(400, 'Indica el motivo de la merma.');

  const result = await withTransaction(async client => {
    await mesesAbiertos(client, req.sucursalId, [fecha]);
    const { rows } = await client.query(
      `INSERT INTO mermas (materia_prima_id, cantidad, unidad, motivo, pedido_item_id, usuario_id, observacion, sucursal_id, fecha_contable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [materiaPrimaId, cantidad, unidad, motivo.trim(), pedidoItemId || null, req.auth.id, observacion || null, req.sucursalId, fecha]
    );
    return rows[0];
  });
  res.status(201).json(result);
}));

router.get('/', asyncHandler(async (req, res) => {
  const desde = validateDate(req.query.desde);
  const hasta = validateDate(req.query.hasta);
  if (desde && hasta && desde > hasta) throw new ApiError(400, 'Revisa el rango de fechas.');
  const { rows } = await query(
    `SELECT mr.*, mr.fecha_contable::text AS fecha_contable, m.nombre AS materia_prima, u.nombre AS usuario
     FROM mermas mr JOIN materias_primas m ON m.id = mr.materia_prima_id JOIN usuarios u ON u.id = mr.usuario_id
     WHERE mr.sucursal_id = $1
       AND ($2::date IS NULL OR mr.fecha_contable >= $2)
       AND ($3::date IS NULL OR mr.fecha_contable <= $3)
     ORDER BY mr.fecha_contable DESC, mr.creado_en DESC LIMIT 200`,
    [req.sucursalId, desde, hasta]
  );
  res.json(rows);
}));

module.exports = router;
