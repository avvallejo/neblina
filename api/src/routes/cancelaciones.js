const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const { listarCancelaciones, resolverCancelacion } = require('../services/cancellations');

const router = express.Router();
router.use(requireAuth, resolveSucursal);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validarId(id) {
  if (!UUID.test(String(id || ''))) throw new ApiError(400, 'Identificador de ticket inválido.');
  return id;
}

// Historial y cola de cancelaciones de la sede (?estado=pendiente para la cola).
router.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await listarCancelaciones(query, req.sucursalId, req.query.estado));
}));

// El administrador autoriza (el ticket sale de las ventas y los insumos
// regresan al inventario) o rechaza (el ticket sigue contando).
router.patch('/:id/autorizar', requireRole('admin'), asyncHandler(async (req, res) => {
  validarId(req.params.id);
  res.json(await withTransaction(client => resolverCancelacion(client, {
    pedidoId: req.params.id, sucursalId: req.sucursalId, adminId: req.auth.id,
    decision: 'autorizada', nota: req.body.nota,
    devolverInsumos: req.body.devolverInsumos === undefined ? true : !!req.body.devolverInsumos,
  })));
}));

router.patch('/:id/rechazar', requireRole('admin'), asyncHandler(async (req, res) => {
  validarId(req.params.id);
  res.json(await withTransaction(client => resolverCancelacion(client, {
    pedidoId: req.params.id, sucursalId: req.sucursalId, adminId: req.auth.id,
    decision: 'rechazada', nota: req.body.nota,
  })));
}));

module.exports = router;
