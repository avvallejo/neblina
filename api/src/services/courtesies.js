// CORTESÍAS — pedidos completos que se entregan sin cobrar ($0).
//
// Regla de negocio (definida por el negocio):
//   * Cada sucursal tiene un CUPO MENSUAL COMPARTIDO para el rol cajero
//     (configuración `cortesias_mes_cajero`; sin fila = 0).
//   * Mientras quede cupo, la cortesía queda `dentro_plan`.
//   * Agotado el cupo, la venta SE PROCESA IGUAL pero queda `pendiente`: la
//     Caja ve la leyenda y un administrador la autoriza o rechaza después
//     (Admin → Autorizaciones). Rechazar no revierte la venta; solo la marca.
//   * Un administrador que da una cortesía en Caja no consume el cupo: queda
//     `autorizada` por él mismo.
// El mes se cuenta en hora de Ciudad de México, igual que el resto de reportes.
const { ApiError } = require('../utils/asyncHandler');

const TZ = 'America/Mexico_City';
const CLAVE_CUPO = 'cortesias_mes_cajero';
const ESTADOS = ['dentro_plan', 'pendiente', 'autorizada', 'rechazada'];
const MAX_CUPO = 999;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function normalizarCupo(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_CUPO) {
    throw new ApiError(400, `El cupo de cortesías debe ser un entero entre 0 y ${MAX_CUPO}.`);
  }
  return n;
}

function textoOpcional(value, max, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ApiError(400, `${label}: escribe un texto.`);
  const t = value.trim();
  if (!t) return null;
  if (t.length > max) throw new ApiError(400, `${label}: máximo ${max} caracteres.`);
  return t;
}

// Cupo configurado para la sucursal (0 si nunca se configuró).
async function leerCupo(queryFn, sucursalId) {
  const { rows } = await queryFn('SELECT valor FROM configuracion WHERE sucursal_id = $1 AND clave = $2', [sucursalId, CLAVE_CUPO]);
  const v = rows[0] ? rows[0].valor : null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_CUPO) : 0;
}

// Estado del plan del mes en curso: cuántas cortesías DENTRO DEL PLAN se han
// dado en la sucursal (las canceladas liberan su lugar; las que excedieron el
// cupo no cuentan porque están fuera del plan).
async function planDelMes(queryFn, sucursalId) {
  const limite = await leerCupo(queryFn, sucursalId);
  const { rows: [r] } = await queryFn(
    `SELECT COUNT(*) FILTER (WHERE cortesia_estado = 'dentro_plan')::int AS usadas,
            COUNT(*) FILTER (WHERE cortesia_estado = 'pendiente')::int AS pendientes,
            to_char(now() AT TIME ZONE $2, 'YYYY-MM') AS mes
     FROM pedidos
     WHERE sucursal_id = $1 AND metodo_pago = 'cortesia' AND NOT cancelado
       AND date_trunc('month', creado_en AT TIME ZONE $2) = date_trunc('month', now() AT TIME ZONE $2)`,
    [sucursalId, TZ]
  );
  const [anio, mesNum] = r.mes.split('-');
  return {
    limite,
    usadas: r.usadas,
    restantes: Math.max(0, limite - r.usadas),
    pendientes: r.pendientes,
    mes: r.mes,
    mesNombre: `${MESES[Number(mesNum) - 1]} ${anio}`,
  };
}

// Decide el estado de UNA cortesía nueva. Debe llamarse DENTRO de la
// transacción que inserta/actualiza el pedido: el bloqueo por sucursal evita
// que dos cajas consuman el último lugar del cupo al mismo tiempo.
async function resolverCortesia(client, { auth, sucursalId, motivo }) {
  if (!auth || auth.tipo !== 'staff' || !['cajero', 'mostrador', 'admin'].includes(auth.rol)) {
    throw new ApiError(403, 'Solo caja o administración pueden registrar una cortesía.');
  }
  const motivoLimpio = textoOpcional(motivo, 200, 'Motivo de la cortesía');
  const q = client.query.bind(client);
  if (auth.rol === 'admin') {
    const plan = await planDelMes(q, sucursalId);
    return { estado: 'autorizada', motivo: motivoLimpio, resueltaPor: auth.id, resueltaEn: new Date(), plan, excedida: false };
  }
  await q('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`cortesias:${sucursalId}`]);
  const antes = await planDelMes(q, sucursalId);
  const dentro = antes.restantes > 0;
  const plan = dentro
    ? { ...antes, usadas: antes.usadas + 1, restantes: antes.restantes - 1 }
    : { ...antes, pendientes: antes.pendientes + 1 };
  return { estado: dentro ? 'dentro_plan' : 'pendiente', motivo: motivoLimpio, resueltaPor: null, resueltaEn: null, plan, excedida: !dentro };
}

// Leyenda para la Caja según cómo quedó la cortesía.
function leyendaCortesia({ estado, plan }) {
  if (estado === 'pendiente') {
    return `Ya se agotaron las ${plan.limite} cortesías permitidas de ${plan.mesNombre}. Esta cortesía ya no entra en el plan mensual: un administrador debe autorizarla (queda en Autorizaciones). La venta se procesó.`;
  }
  if (estado === 'dentro_plan') {
    return `Cortesía ${plan.usadas} de ${plan.limite} de ${plan.mesNombre}. ${plan.restantes === 0 ? 'Era la última del plan mensual.' : `Quedan ${plan.restantes}.`}`;
  }
  return 'Cortesía autorizada por administración.';
}

function respuestaCortesia(r) {
  return { estado: r.estado, excedida: r.excedida, plan: r.plan, leyenda: leyendaCortesia(r) };
}

// Autorizar o rechazar una cortesía pendiente (solo administradores).
async function resolverPendiente(client, { pedidoId, sucursalId, adminId, decision, nota }) {
  if (!['autorizada', 'rechazada'].includes(decision)) throw new ApiError(400, 'Decisión inválida.');
  const notaLimpia = textoOpcional(nota, 300, 'Nota');
  const { rows: [pedido] } = await client.query(
    `SELECT id, folio, cortesia_estado FROM pedidos WHERE id = $1 AND sucursal_id = $2 AND metodo_pago = 'cortesia' FOR UPDATE`,
    [pedidoId, sucursalId]
  );
  if (!pedido) throw new ApiError(404, 'Cortesía no encontrada en esta sucursal.');
  if (pedido.cortesia_estado !== 'pendiente') throw new ApiError(409, `Esta cortesía ya fue resuelta (${pedido.cortesia_estado}).`);
  const { rows: [actualizado] } = await client.query(
    `UPDATE pedidos SET cortesia_estado = $3, cortesia_resuelta_por = $4, cortesia_resuelta_en = now(), cortesia_nota = $5
     WHERE id = $1 AND sucursal_id = $2 RETURNING id, folio, cortesia_estado, cortesia_resuelta_en, cortesia_nota`,
    [pedidoId, sucursalId, decision, adminId, notaLimpia]
  );
  await client.query(
    `INSERT INTO auditoria (entidad, entidad_id, accion, valor_anterior, valor_nuevo, motivo, usuario_id, sucursal_id)
     VALUES ('pedidos', $1, 'cortesia_' || $2, $3, $4, $5, $6, $7)`,
    [pedidoId, decision, { cortesiaEstado: 'pendiente' }, { cortesiaEstado: decision }, notaLimpia, adminId, sucursalId]
  );
  return actualizado;
}

const listaSql = `
  SELECT p.id, p.folio, p.creado_en, p.subtotal, p.cortesia_estado, p.cortesia_motivo, p.cortesia_nota,
         p.cortesia_resuelta_en, p.cancelado, p.origen,
         u.nombre AS cajero_nombre, a.nombre AS resuelta_por_nombre,
         c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
         (SELECT string_agg(pi.cantidad || ' × ' || COALESCE(pi.concepto_libre, pr.nombre), ', ' ORDER BY pi.creado_en)
            FROM pedido_items pi LEFT JOIN productos pr ON pr.id = pi.producto_id WHERE pi.pedido_id = p.id) AS detalle
  FROM pedidos p
  LEFT JOIN usuarios u ON u.id = p.cajero_id
  LEFT JOIN usuarios a ON a.id = p.cortesia_resuelta_por
  LEFT JOIN clientes c ON c.id = p.cliente_id
  WHERE p.sucursal_id = $1 AND p.metodo_pago = 'cortesia'`;

async function listarCortesias(queryFn, sucursalId, estado) {
  if (estado !== undefined && estado !== '' && !ESTADOS.includes(estado)) throw new ApiError(400, 'Estado de cortesía inválido.');
  const filtro = estado ? ' AND p.cortesia_estado = $2' : '';
  const params = estado ? [sucursalId, estado] : [sucursalId];
  const { rows } = await queryFn(`${listaSql}${filtro} ORDER BY (p.cortesia_estado = 'pendiente') DESC, p.creado_en DESC LIMIT 300`, params);
  return rows;
}

module.exports = { CLAVE_CUPO, ESTADOS, MAX_CUPO, TZ, normalizarCupo, leerCupo, planDelMes, resolverCortesia, leyendaCortesia, respuestaCortesia, resolverPendiente, listarCortesias };
