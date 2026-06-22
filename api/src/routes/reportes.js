const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/ventas-por-metodo-pago', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM vw_ventas_por_metodo_pago')).rows);
}));
router.get('/productos-mas-vendidos', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM vw_productos_mas_vendidos LIMIT 10')).rows);
}));
router.get('/cancelaciones-no-show', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM vw_cancelaciones_no_show')).rows[0]);
}));
router.get('/mermas-por-motivo', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM vw_mermas_por_motivo')).rows);
}));
router.get('/costo-real-por-venta', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM vw_costo_real_por_venta ORDER BY pedido_item_id DESC LIMIT 200')).rows);
}));

module.exports = router;
