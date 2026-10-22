// Consulta de la bitácora (solo administradores, solo lectura).
const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const B = require('../services/bitacora');

const router = express.Router();
router.use(requireAuth, requireRole('admin'), resolveSucursal);

// El administrador general (sin sede fija) también ve lo que no pertenece a una sede.
const global = req => ({ incluirGlobal: !req.auth.sucursalId });

router.get('/acciones', asyncHandler(async (req, res) => res.json(await B.listarAcciones(query, req.sucursalId, req.query, global(req)))));
router.get('/cambios', asyncHandler(async (req, res) => res.json(await B.listarCambios(query, req.sucursalId, req.query, global(req)))));
router.get('/ajustes', asyncHandler(async (req, res) => res.json(await B.listarAjustes(query, req.sucursalId, req.query))));
router.get('/movimientos', asyncHandler(async (req, res) => res.json(await B.listarMovimientos(query, req.sucursalId, req.query))));

module.exports = router;
