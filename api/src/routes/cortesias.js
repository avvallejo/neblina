// CORTESÍAS: cupo del mes para la Caja y autorizaciones para el administrador.
// La cortesía en sí se registra al cobrar (POST /pedidos con
// pago.metodoPago = 'cortesia' o PATCH /pedidos/:id/cobrar).
const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const { planDelMes, listarCortesias, resolverPendiente } = require('../services/courtesies');

const router = express.Router();
router.use(requireAuth, resolveSucursal);

// Caja: cuántas cortesías quedan en el plan del mes de SU sucursal.
router.get('/plan', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  res.json(await planDelMes(query, req.sucursalId));
}));

// Admin: lista (pendientes primero). ?estado=pendiente|dentro_plan|autorizada|rechazada
router.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await listarCortesias(query, req.sucursalId, req.query.estado));
}));

router.patch('/:id/autorizar', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await withTransaction(c => resolverPendiente(c, { pedidoId: req.params.id, sucursalId: req.sucursalId, adminId: req.auth.id, decision: 'autorizada', nota: req.body.nota })));
}));

router.patch('/:id/rechazar', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await withTransaction(c => resolverPendiente(c, { pedidoId: req.params.id, sucursalId: req.sucursalId, adminId: req.auth.id, decision: 'rechazada', nota: req.body.nota })));
}));

module.exports = router;
