const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, resolveSucursalPublico } = require('../middleware/auth');

const {moneyAmount,setOpeningFund,drawerSql}=require('../services/cashDrawer');
const A = require('../services/accounting');
const {cashExpense}=require('../services/cashExpenses');

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

// Salidas de caja del turno: dinero que sale del efectivo (pagar al proveedor,
// un mandado, hielo…). Bajan el efectivo esperado y quedan como egreso real
// en Contabilidad (cuenta elegida o "Otros gastos de operación").
router.get('/salidas/cuentas', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, nombre, grupo, clave FROM cuentas_contables WHERE sucursal_id = $1 AND activo AND grupo IN ('gasto_operacion','costo_ventas') ORDER BY orden, nombre`, [req.sucursalId]);
  res.json(rows);
}));
router.get('/salidas/insumos', asyncHandler(async(req,res)=>{
 const {rows}=await query(`SELECT m.id,m.nombre,m.unidad,m.stock_actual,m.requiere_lote,
 m.presentacion_cantidad,m.presentacion_unidad,m.presentacion_nombre,
 COALESCE((SELECT string_agg(DISTINCT p.nombre, ', ' ORDER BY p.nombre)
 FROM receta_insumos_fijos r JOIN productos p ON p.id=r.producto_id
 WHERE r.materia_prima_id=m.id AND p.sucursal_id=m.sucursal_id AND p.tipo='snack' AND p.activo),'') AS productos_comprados
 FROM materias_primas m WHERE m.sucursal_id=$1 AND m.activo ORDER BY m.nombre`,[req.sucursalId]);
 res.json(rows);
}));
router.post('/actual/compras', asyncHandler(async(req,res)=>{
 if(!req.body.materiaId)throw new ApiError(400,'Selecciona qué compraste.');
 res.status(201).json(await withTransaction(c=>cashExpense(c,{sucursalId:req.sucursalId,usuarioId:req.auth.id,body:req.body,materiaId:req.body.materiaId})));
}));
router.get('/salidas/proveedores', asyncHandler(async(req,res)=>{
  const {rows}=await query('SELECT id,nombre FROM proveedores WHERE sucursal_id=$1 ORDER BY nombre',[req.sucursalId]);
  res.json(rows);
}));
router.get('/salidas/compras-pendientes', asyncHandler(async(req,res)=>{
  const {rows}=await query(`SELECT e.id,e.fecha,e.concepto,e.monto,e.referencia,p.nombre AS proveedor_nombre
    FROM egresos e LEFT JOIN proveedores p ON p.id=e.proveedor_id
    WHERE e.sucursal_id=$1 AND e.lote_id IS NOT NULL AND NOT e.pagado AND NOT e.anulado
    ORDER BY e.fecha,e.creado_en`,[req.sucursalId]);
  res.json(rows.map(r=>A.normalizarFechas(r)));
}));
router.get('/actual/salidas', asyncHandler(async (req, res) => {
  const { rows: [t] } = await query('SELECT id FROM turnos WHERE sucursal_id = $1 AND cerrado_en IS NULL', [req.sucursalId]);
  if (!t) return res.json([]);
  const { rows } = await query(
    `SELECT e.id,e.fecha,e.concepto,e.monto,e.creado_en,e.lote_id,c.nombre AS cuenta_nombre,
      COALESCE(pagador.nombre,u.nombre) AS usuario_nombre,p.nombre AS proveedor_nombre,
      COALESCE(a.valor_nuevo->'comprobantePago'->>'referencia',e.referencia) AS referencia,
      COALESCE(a.valor_nuevo->'comprobantePago'->>'nota',e.nota) AS nota
     FROM egresos e JOIN cuentas_contables c ON c.id=e.cuenta_contable_id
     LEFT JOIN usuarios u ON u.id=e.usuario_id LEFT JOIN proveedores p ON p.id=e.proveedor_id
     LEFT JOIN LATERAL (SELECT usuario_id,valor_nuevo FROM auditoria WHERE entidad='egresos' AND entidad_id=e.id::text AND accion IN ('pago_caja','gasto_caja') ORDER BY creado_en DESC LIMIT 1) a ON true
     LEFT JOIN usuarios pagador ON pagador.id=a.usuario_id
     WHERE e.turno_id=$1 AND e.pagado AND NOT e.anulado ORDER BY e.actualizado_en DESC`,[t.id]);
  res.json(rows.map(r=>A.normalizarFechas(r)));
}));
router.post('/actual/salidas', asyncHandler(async(req,res)=>{
  res.status(201).json(await withTransaction(c=>cashExpense(c,{sucursalId:req.sucursalId,usuarioId:req.auth.id,body:req.body})));
}));
router.post('/actual/salidas/compras/:id/pagar', asyncHandler(async(req,res)=>{
  res.json(await withTransaction(c=>cashExpense(c,{sucursalId:req.sucursalId,usuarioId:req.auth.id,body:req.body,purchaseId:req.params.id})));
}));

router.get('/actual/kpis', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vw_kpis_turno_actual WHERE sucursal_id = $1', [req.sucursalId]);
  res.json(rows[0] || { pedidos: 0, ventas: 0, ticket_promedio: 0, mermas: 0 });
}));

module.exports = router;
