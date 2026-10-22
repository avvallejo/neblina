// Compras/altas de insumos (lotes) y su anulación cuando se capturaron por error.
const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const B = require('../services/bitacora');
const V = require('../services/purchaseVoid');

const router = express.Router();
router.use(requireAuth, requireRole('admin'), resolveSucursal);

router.get('/', asyncHandler(async (req, res) => res.json(await B.listarCompras(query, req.sucursalId, req.query))));
// Qué pasaría al anularla: ajustes candidatos a revertirse, egreso, estado.
router.get('/:id/anulacion', asyncHandler(async (req, res) => res.json(await V.vistaPrevia(query, req.sucursalId, req.params.id))));
router.post('/:id/anular', asyncHandler(async (req, res) => {
  const out = await withTransaction(client => V.anularCompra(client, {
    sucursalId: req.sucursalId, usuarioId: req.auth.id, loteId: req.params.id,
    ajusteIds: req.body.ajusteIds || [], motivo: req.body.motivo,
  }));
  res.json(out);
}));

module.exports = router;
