const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');

const router = express.Router();
const { validateDate, dailySalesSql } = require('../services/dailySales');
router.use(requireAuth, requireRole('admin'));

// Dos modos:
//   * Normal: el reporte de UNA sede (la del admin de sede, o la que el
//     admin general elija con X-Sucursal-Id).
//   * ?consolidado=true: SOLO el administrador general — todas las sedes en
//     una sola respuesta, cada fila con su sucursal, para comparativos.
router.use((req, res, next) => {
  if (req.query.consolidado === 'true') {
    if (req.auth.sucursalId) {
      return next(new ApiError(403, 'El reporte consolidado es solo para el administrador general.'));
    }
    req.consolidado = true;
    return next();
  }
  return resolveSucursal(req, res, next);
});

// Helper: consulta la vista filtrada por sede, o consolidada con el nombre de
// cada sucursal (las vistas ya traen sucursal_id desde la migración 12).
async function reporte(req, vista, { orden = '', limite = '' } = {}) {
  if (req.consolidado) {
    const { rows } = await query(
      `SELECT s.nombre AS sucursal, v.* FROM ${vista} v JOIN sucursales s ON s.id = v.sucursal_id ${orden} ${limite}`
    );
    return rows;
  }
  const { rows } = await query(`SELECT v.* FROM ${vista} v WHERE v.sucursal_id = $1 ${orden} ${limite}`, [req.sucursalId]);
  return rows;
}

router.get('/resumen-dia', asyncHandler(async (req, res) => {
  if (req.consolidado) throw new ApiError(400, 'Selecciona una sucursal para consultar el día.');
  const { rows } = await query(dailySalesSql, [req.sucursalId, validateDate(req.query.fecha)]);
  res.json(rows[0]);
}));

router.get('/ventas-por-metodo-pago', asyncHandler(async (req, res) => {
  res.json(await reporte(req, 'vw_ventas_por_metodo_pago'));
}));
router.get('/productos-mas-vendidos', asyncHandler(async (req, res) => {
  res.json(await reporte(req, 'vw_productos_mas_vendidos', { limite: req.consolidado ? '' : 'LIMIT 10' }));
}));
router.get('/cancelaciones-no-show', asyncHandler(async (req, res) => {
  const rows = await reporte(req, 'vw_cancelaciones_no_show');
  // El modo normal conserva el contrato original: un solo objeto.
  res.json(req.consolidado ? rows : (rows[0] || { cancelados: 0, no_recogidos: 0, valor_perdido_no_show: null }));
}));
router.get('/mermas-por-motivo', asyncHandler(async (req, res) => {
  res.json(await reporte(req, 'vw_mermas_por_motivo'));
}));
router.get('/costo-real-por-venta', asyncHandler(async (req, res) => {
  res.json(await reporte(req, 'vw_costo_real_por_venta', { orden: 'ORDER BY v.pedido_item_id DESC', limite: 'LIMIT 200' }));
}));

module.exports = router;
