const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const H = require('../services/stockAdjustmentHistory');
const router = express.Router();
router.use(requireAuth, requireRole('admin'), resolveSucursal);
router.get('/', asyncHandler(async (req,res) => res.json(await H.listar(query,req.sucursalId,req.query))));
router.get('/opciones', (req,res) => res.json({fechaContable:true}));
router.get('/:id', asyncHandler(async (req,res) => res.json(await H.obtener(query,req.sucursalId,req.params.id))));
router.patch('/:id', asyncHandler(async (req,res) => res.json(await withTransaction(c => H.corregir(c, {
  sucursalId:req.sucursalId, usuarioId:req.auth.id, id:req.params.id, body:req.body,
})))));
module.exports = router;
