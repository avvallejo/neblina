const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, resolveSucursalPublico } = require('../middleware/auth');

const {moneyAmount,setOpeningFund,drawerSql}=require('../services/cashDrawer');
const A = require('../services/accounting');

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
    `SELECT id, nombre, grupo, clave FROM cuentas_contables WHERE sucursal_id = $1 AND activo AND grupo IN ('gasto_operacion','inventario','costo_ventas') ORDER BY orden, nombre`, [req.sucursalId]);
  res.json(rows);
}));
router.get('/actual/salidas', asyncHandler(async (req, res) => {
  const { rows: [t] } = await query('SELECT id FROM turnos WHERE sucursal_id = $1 AND cerrado_en IS NULL', [req.sucursalId]);
  if (!t) return res.json([]);
  const { rows } = await query(
    `SELECT e.id, e.fecha, e.concepto, e.monto, e.creado_en, e.anulado, c.nombre AS cuenta_nombre, u.nombre AS usuario_nombre
     FROM egresos e JOIN cuentas_contables c ON c.id = e.cuenta_contable_id LEFT JOIN usuarios u ON u.id = e.usuario_id
     WHERE e.turno_id = $1 AND NOT e.anulado ORDER BY e.creado_en DESC`, [t.id]);
  res.json(rows.map(r => A.normalizarFechas(r)));
}));
router.post('/actual/salidas', asyncHandler(async (req, res) => {
  const out = await withTransaction(async c => {
    const q = c.query.bind(c);
    const { rows: [t] } = await q('SELECT id FROM turnos WHERE sucursal_id = $1 AND cerrado_en IS NULL FOR UPDATE', [req.sucursalId]);
    if (!t) throw new ApiError(409, 'No hay un turno abierto en esta sucursal.');
    const caja = await A.cuentaDineroPorClave(q, req.sucursalId, 'caja');
    const cuenta = req.body.cuentaContableId ? await A.validarCuentaContable(q, req.sucursalId, req.body.cuentaContableId) : await A.cuentaPorClave(q, req.sucursalId, 'otros_gastos');
    if (cuenta.grupo === 'diezmo_ofrenda' || cuenta.grupo === 'retiro') throw new ApiError(400, 'Diezmos, ofrendas y retiros del dueño se registran desde Contabilidad, no como salida de caja.');
    const egreso = await A.crearEgreso(c, {
      sucursalId: req.sucursalId, usuarioId: req.auth.id, fecha: A.hoyMx(), cuentaContable: cuenta,
      concepto: req.body.concepto, monto: req.body.monto, cuentaDineroId: caja.id, pagado: true,
      proveedorId: req.body.proveedorId || null, turnoId: t.id, referencia: req.body.referencia, nota: req.body.nota,
    });
    return A.normalizarFechas({ ...egreso, cuenta_nombre: cuenta.nombre });
  });
  res.status(201).json(out);
}));

router.get('/actual/kpis', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vw_kpis_turno_actual WHERE sucursal_id = $1', [req.sucursalId]);
  res.json(rows[0] || { pedidos: 0, ventas: 0, ticket_promedio: 0, mermas: 0 });
}));

module.exports = router;
