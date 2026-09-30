const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, withTransaction } = require('../db');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { KEY, normalizePolicy, getPolicy, requestDiscount } = require('../services/discountPolicy');
const router = express.Router();
router.use(requireAuth, requireRole('cajero','admin'), resolveSucursal);
router.get('/config', asyncHandler(async(req,res) => res.json(await getPolicy(query,req.sucursalId))));
router.put('/config', requireRole('admin'), asyncHandler(async(req,res) => {
  const policy = normalizePolicy(req.body);
  await withTransaction(async c => {
    await c.query(`INSERT INTO configuracion(sucursal_id,clave,valor) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(sucursal_id,clave) DO UPDATE SET valor=EXCLUDED.valor,actualizado_en=now()`, [req.sucursalId,KEY,JSON.stringify(policy)]);
    await c.query(`INSERT INTO auditoria(usuario_id,sucursal_id,accion,entidad,entidad_id,valor_nuevo) VALUES($1,$3,'configurar_descuentos','configuracion','descuentos_caja',$2::jsonb)`, [req.auth.id,JSON.stringify(policy),req.sucursalId]);
  });
  res.json(policy);
}));
router.get('/', asyncHandler(async(req,res) => {
  const { rows } = await query(`SELECT d.*,u.nombre AS solicitante_nombre,a.nombre AS autorizador_nombre,p.folio,
      d.expira_en<=now() AS expirada
    FROM solicitudes_descuento d JOIN usuarios u ON u.id=d.solicitante_id
    LEFT JOIN usuarios a ON a.id=d.autorizador_id LEFT JOIN pedidos p ON p.id=d.pedido_id
    WHERE d.sucursal_id=$1 AND ($2::boolean OR d.solicitante_id=$3)
    ORDER BY (d.estado='pendiente' AND d.expira_en>now()) DESC,d.creado_en DESC LIMIT 200`, [req.sucursalId,req.auth.rol==='admin',req.auth.id]);
  res.json(rows);
}));
router.post('/', rateLimit({windowMs:3600000,max:100,keyGenerator:r=>`discount:${r.auth.id}`,standardHeaders:true,legacyHeaders:false}), asyncHandler(async(req,res) => {
  const result = await withTransaction(c=>requestDiscount(c,req.auth,req.sucursalId,req.body));
  if (result.denied) throw new ApiError(403,'PIN no autorizado. Debe pertenecer a un administrador activo de esta sucursal o a un administrador general.',{codigo:'pin_administrador_invalido'});
  res.status(201).json(result);
}));
router.patch('/:id/:decision', requireRole('admin'), asyncHandler(async(req,res) => {
  const estado = {autorizar:'autorizada',rechazar:'rechazada'}[req.params.decision];
  if (!estado) throw new ApiError(400,'Decisión inválida.');
  const { rows } = await query(`UPDATE solicitudes_descuento SET estado=$3,autorizador_id=$4,resuelta_en=now(),expira_en=now()+interval '12 hours'
    WHERE id=$1 AND sucursal_id=$2 AND estado='pendiente' AND expira_en>now() RETURNING *`,[req.params.id,req.sucursalId,estado,req.auth.id]);
  if (!rows[0]) throw new ApiError(409,'La solicitud ya fue resuelta o expiró.');
  res.json(rows[0]);
}));
module.exports = router;
