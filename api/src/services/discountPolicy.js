const { ApiError } = require('../utils/asyncHandler');
const { verifyDiscountAdminPin, consumeDiscountApproval } = require('./discountApprovals');
const { UUID_RE } = require('../middleware/auth');
const KEY = 'descuentos_caja';
function normalizePolicy(value = {}) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.porcentajes || [])) throw new ApiError(400, 'Configuración de descuentos inválida.');
  const porcentajes = [...new Set((value.porcentajes || []).map(Number))];
  if (porcentajes.length > 20 || porcentajes.some(p => !Number.isFinite(p) || p <= 0 || p >= 100 || Math.abs(Math.round(p * 100) - p * 100) > 0.000001)) throw new ApiError(400, 'Indica hasta 20 porcentajes mayores que 0 y menores que 100.');
  return { empleado: value.empleado === true, porcentajes: porcentajes.sort((a,b) => a-b) };
}
async function getPolicy(query, sucursalId) {
  const { rows } = await query('SELECT valor FROM configuracion WHERE sucursal_id=$1 AND clave=$2', [sucursalId, KEY]);
  return normalizePolicy(rows[0]?.valor);
}
async function requestDiscount(client, auth, sucursalId, body) {
  const pct = Number(body.descuentoPorcentaje);
  const tipo = body.tipo || 'promocion';
  if (!['empleado','promocion'].includes(tipo) || !Number.isFinite(pct) || pct <= 0 || pct >= 100 || Math.abs(Math.round(pct*100)-pct*100)>0.000001 || (tipo === 'empleado' && pct !== 50)) throw new ApiError(400, 'Empleado lleva 50%; los demás descuentos deben ser mayores que 0 y menores que 100. Para regalar usa Cortesía.');
  if (!UUID_RE.test(body.clientUuid || '')) throw new ApiError(400, 'Falta el identificador de la solicitud.');
  if (typeof body.motivo !== 'string' || body.motivo.trim().length < 3 || body.motivo.trim().length > 300) throw new ApiError(400, 'Escribe a quién o por qué se aplica el descuento (3 a 300 caracteres).');
  const method = body.medioAutorizacion;
  if (method !== undefined && !['pin','modulo','directo'].includes(method)) throw new ApiError(400,'Elige una forma de autorización válida.');
  const withPin = method === 'pin' || Object.prototype.hasOwnProperty.call(body, 'pin');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`discount:${auth.id}:${body.clientUuid}`]);
  const previous = await client.query('SELECT * FROM solicitudes_descuento WHERE solicitante_id=$1 AND client_uuid=$2', [auth.id,body.clientUuid]);
  const prev = previous.rows[0];
  if (prev && (prev.sucursal_id !== sucursalId || prev.tipo !== tipo || Number(prev.porcentaje) !== pct || prev.motivo !== body.motivo.trim() || (prev.pedido_id || null) !== (body.pedidoId || null))) {
    throw new ApiError(409,'La solicitud cambió. Inicia una nueva autorización.');
  }
  // Una petición que incluye PIN siempre lo comprueba, también en reintentos.
  // Ni el rol del solicitante ni un permiso de Caja sustituyen esa comprobación.
  let verification = null;
  if (withPin) {
    verification = await verifyDiscountAdminPin({requesterId:auth.id,pin:body.pin,sucursalId}, client.query.bind(client));
    if (verification.denied) return {denied:true};
    if (prev && prev.via !== 'pin') throw new ApiError(409,'Esta solicitud usa otra forma de autorización. Inicia una nueva con PIN.');
  }
  if (prev) return prev;
  if (body.pedidoId) {
    const { rows } = await client.query('SELECT id FROM pedidos WHERE id=$1 AND sucursal_id=$2 AND NOT cobrado AND NOT cancelado AND NOT no_show', [body.pedidoId,sucursalId]);
    if (!rows[0]) throw new ApiError(409, 'El ticket ya no admite descuentos.');
  }
  const policy = await getPolicy(client.query.bind(client), sucursalId);
  let via = 'modulo', estado = 'pendiente', authorizer = null;
  if (withPin) {
    authorizer = verification.authorizerId; via = 'pin'; estado = 'autorizada';
  } else if (method === 'modulo') {
    // Elegir el módulo crea una solicitud; no aplica por otro permiso.
    via = 'modulo';
  } else if (auth.rol === 'admin') {
    via = 'administrador'; estado = 'autorizada'; authorizer = auth.id;
  } else if (tipo === 'empleado' ? policy.empleado : policy.porcentajes.includes(pct)) {
    via = 'configuracion'; estado = 'autorizada';
  } else if (method === 'directo') {
    throw new ApiError(403,'Este descuento requiere PIN de administrador o aprobación en Autorizaciones.');
  }
  const { rows } = await client.query(`INSERT INTO solicitudes_descuento
    (sucursal_id,solicitante_id,client_uuid,pedido_id,tipo,porcentaje,motivo,estado,via,autorizador_id,resuelta_en)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $8='autorizada' THEN now() END) RETURNING *`,
    [sucursalId,auth.id,body.clientUuid,body.pedidoId || null,tipo,pct,body.motivo.trim(),estado,via,authorizer]);
  return rows[0];
}
async function consumeDiscount(client, {auth,sucursalId,token,discount,pedidoId=null}) {
  if (UUID_RE.test(token || '')) {
    const {rows:[approval]}=await client.query('SELECT via,tipo FROM solicitudes_descuento WHERE id=$1 AND solicitante_id=$2 AND sucursal_id=$3 FOR UPDATE',[token,auth.id,sucursalId]);
    if(approval?.via==='configuracion') {
      const policy=await getPolicy(client.query.bind(client),sucursalId);
      if(!(approval.tipo==='empleado'?policy.empleado:policy.porcentajes.includes(discount))) throw new ApiError(409,'Administración cambió los permisos. Solicita autorización para este descuento.');
    }
    const { rows } = await client.query(`UPDATE solicitudes_descuento SET usada_en=now()
      WHERE id=$1 AND solicitante_id=$2 AND sucursal_id=$3 AND porcentaje=$4 AND estado='autorizada'
      AND usada_en IS NULL AND expira_en>now() AND pedido_id IS NOT DISTINCT FROM $5::uuid RETURNING id,autorizador_id`,
      [token,auth.id,sucursalId,discount,pedidoId]);
    if (!rows[0]) throw new ApiError(409, 'El descuento sigue pendiente, expiró o ya se utilizó. Revisa Autorizaciones.');
    return {id:rows[0].id,authorizerId:rows[0].autorizador_id};
  }
  // Compatibilidad con cajas abiertas antes de actualizar: conservar PIN de un solo uso.
  const authorizer = auth.rol === 'admin' ? auth.id : await consumeDiscountApproval(client, {requesterId:auth.id,token,discount});
  if (discount >= 100) throw new ApiError(400, 'Para regalar un producto usa Cortesía; un descuento conserva un importe por cobrar.');
  const {rows:[record]}=await client.query(`INSERT INTO solicitudes_descuento (sucursal_id,solicitante_id,client_uuid,pedido_id,tipo,porcentaje,motivo,estado,via,autorizador_id,resuelta_en,usada_en)
    VALUES ($1,$2,gen_random_uuid(),$3,'promocion',$4,'Autorización de caja','autorizada',$5,$6,now(),now()) RETURNING id`, [sucursalId,auth.id,pedidoId,discount,auth.rol==='admin'?'administrador':'pin',authorizer]);
  return {id:record.id,authorizerId:authorizer};
}
async function linkDiscount(client, token, pedidoId) {
  if (UUID_RE.test(token || '')) {
    await client.query('UPDATE solicitudes_descuento SET pedido_id=$2 WHERE id=$1 AND usada_en IS NOT NULL', [token,pedidoId]);
    await client.query('UPDATE pedidos SET descuento_solicitud_id=$2 WHERE id=$1', [pedidoId,token]);
  }
}
module.exports = { KEY, normalizePolicy, getPolicy, requestDiscount, consumeDiscount, linkDiscount };
