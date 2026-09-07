const router=require('express').Router();
const {query,withTransaction}=require('../db');
const {requireAuth,requireRole,resolveSucursal}=require('../middleware/auth');
const {asyncHandler}=require('../utils/asyncHandler');
const {registrarVenta}=require('../services/directSales');
router.use(requireAuth,requireRole('cajero','admin'),resolveSucursal);
router.get('/insumos',asyncHandler(async(req,res)=>res.json((await query('SELECT id,nombre,unidad,stock_actual FROM materias_primas WHERE sucursal_id=$1 AND activo ORDER BY nombre',[req.sucursalId])).rows)));
router.post('/',asyncHandler(async(req,res)=>res.status(201).json(await withTransaction(c=>registrarVenta(c,req.body,req.auth,req.sucursalId)))));
module.exports=router;
