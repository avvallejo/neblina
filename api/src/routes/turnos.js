const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, resolveSucursalPublico } = require('../middleware/auth');

const {moneyAmount,setOpeningFund,drawerSql}=require('../services/cashDrawer');

const router = express.Router();

// Público: el cliente necesita saber si SU cafetería está abierta SIN tener
// que loguearse como personal. GET /api/turnos/estado?sucursal=<id>
router.get('/estado', resolveSucursalPublico, asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT id, abierto_en FROM turnos WHERE cerrado_en IS NULL AND sucursal_id = $1 LIMIT 1',
    [req.sucursalId]
  );
  res.json({ abierto: rows.length > 0, turno: rows[0] || null });
}));

router.use(requireAuth, requireRole('cajero', 'admin'), resolveSucursal);

router.post('/abrir', asyncHandler(async (req, res) => {
  const fondo=moneyAmount(req.body.fondoInicial,'Fondo inicial');
  const abierto = await query('SELECT id FROM turnos WHERE cerrado_en IS NULL AND sucursal_id = $1', [req.sucursalId]);
  if (abierto.rows.length > 0) throw new ApiError(409, 'Ya hay un turno abierto en esta sucursal.');
  const { rows } = await query(
    'INSERT INTO turnos (abierto_por, sucursal_id, fondo_inicial) VALUES ($1, $2, $3) RETURNING *',
    [req.auth.id, req.sucursalId, fondo]
  );
  res.status(201).json(rows[0]);
}));

router.get('/actual/caja',asyncHandler(async(req,res)=>{const {rows:[t]}=await query(drawerSql,[req.sucursalId]);res.json(t||null);}));
router.patch('/:id/fondo',asyncHandler(async(req,res)=>res.json(await withTransaction(c=>setOpeningFund(c,{id:req.params.id,sucursalId:req.sucursalId,usuarioId:req.auth.id,monto:req.body.fondoInicial})))));

router.post('/cerrar', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'UPDATE turnos SET cerrado_en = now(), cerrado_por = $1 WHERE cerrado_en IS NULL AND sucursal_id = $2 RETURNING *',
    [req.auth.id, req.sucursalId]
  );
  if (rows.length === 0) throw new ApiError(409, 'No hay un turno abierto en esta sucursal.');
  res.json(rows[0]);
}));

router.get('/actual/kpis', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vw_kpis_turno_actual WHERE sucursal_id = $1', [req.sucursalId]);
  res.json(rows[0] || { pedidos: 0, ventas: 0, ticket_promedio: 0, mermas: 0 });
}));

module.exports = router;
