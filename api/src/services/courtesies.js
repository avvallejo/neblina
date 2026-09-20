// CORTESÍAS — productos de un ticket que se entregan sin cobrar ($0).
//
// Regla de negocio (definida por el negocio):
//   * La Caja marca QUÉ productos del ticket son de cortesía; el resto se
//     cobra normal. Un ticket donde todo fue cortesía sale con forma de pago
//     'cortesia' y total 0.
//   * Cada sucursal tiene un CUPO MENSUAL COMPARTIDO para el rol cajero
//     (configuración `cortesias_mes_cajero`; sin fila = 0). El cupo se cuenta
//     POR UNIDAD regalada: 2 cafés de cortesía consumen 2 lugares.
//   * Si las unidades del ticket caben en lo que queda, el ticket queda
//     `dentro_plan`; si no caben completas, la venta SE PROCESA IGUAL pero el
//     ticket queda `pendiente` (no consume cupo): la Caja ve la leyenda y un
//     administrador lo autoriza o rechaza después (Admin → Autorizaciones).
//     Rechazar no revierte la venta; solo la marca.
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

// Estado del plan del mes en curso: cuántas UNIDADES de cortesía DENTRO DEL
// PLAN se han dado en la sucursal (las canceladas liberan su lugar; las que
// excedieron el cupo no cuentan porque están fuera del plan).
async function planDelMes(queryFn, sucursalId, fechaReferencia = null) {
  const limite = await leerCupo(queryFn, sucursalId);
  const { rows: [r] } = await queryFn(
    `SELECT COALESCE(SUM(cortesia_unidades) FILTER (WHERE cortesia_estado = 'dentro_plan'), 0)::int AS usadas,
            COUNT(*) FILTER (WHERE cortesia_estado = 'dentro_plan')::int AS tickets,
            COUNT(*) FILTER (WHERE cortesia_estado = 'pendiente')::int AS pendientes,
            COALESCE(SUM(cortesia_unidades) FILTER (WHERE cortesia_estado = 'pendiente'), 0)::int AS unidades_pendientes,
            to_char(COALESCE($3::date,(now() AT TIME ZONE $2)::date), 'YYYY-MM') AS mes
     FROM pedidos
     WHERE sucursal_id = $1 AND cortesia_estado IS NOT NULL AND NOT cancelado
       AND date_trunc('month', creado_en AT TIME ZONE $2) = date_trunc('month', COALESCE($3::date,(now() AT TIME ZONE $2)::date)::timestamp)`,
    [sucursalId, TZ, fechaReferencia]
  );
  const [anio, mesNum] = r.mes.split('-');
  return {
    limite,
    usadas: r.usadas,                 // unidades dentro del plan
    tickets: r.tickets,               // tickets dentro del plan
    restantes: Math.max(0, limite - r.usadas),
    pendientes: r.pendientes,         // tickets esperando autorización
    unidadesPendientes: r.unidades_pendientes,
    mes: r.mes,
    mesNombre: `${MESES[Number(mesNum) - 1]} ${anio}`,
  };
}

function normalizarUnidades(unidades) {
  const n = Number(unidades);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'Marca al menos un producto como cortesía.');
  return n;
}

// Decide el estado de la cortesía de UN ticket (con `unidades` regaladas).
// Debe llamarse DENTRO de la transacción que inserta/actualiza el pedido: el
// bloqueo por sucursal evita que dos cajas consuman el último lugar del cupo
// al mismo tiempo. El ticket entra completo o no entra: si sus unidades no
// caben en lo que queda, todo el ticket queda pendiente y no consume cupo.
async function resolverCortesia(client, { auth, sucursalId, motivo, unidades = 1, fechaReferencia = null }) {
  if (!auth || auth.tipo !== 'staff' || !['cajero', 'mostrador', 'admin'].includes(auth.rol)) {
    throw new ApiError(403, 'Solo caja o administración pueden registrar una cortesía.');
  }
  const motivoLimpio = textoOpcional(motivo, 200, 'Motivo de la cortesía');
  const n = normalizarUnidades(unidades);
  const q = client.query.bind(client);
  if (auth.rol === 'admin') {
    const plan = await planDelMes(q, sucursalId, fechaReferencia);
    return { estado: 'autorizada', motivo: motivoLimpio, resueltaPor: auth.id, resueltaEn: new Date(), plan, unidades: n, excedida: false };
  }
  await q('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`cortesias:${sucursalId}`]);
  const antes = await planDelMes(q, sucursalId, fechaReferencia);
  const dentro = antes.restantes >= n;
  const plan = dentro
    ? { ...antes, usadas: antes.usadas + n, tickets: antes.tickets + 1, restantes: antes.restantes - n }
    : { ...antes, pendientes: antes.pendientes + 1, unidadesPendientes: antes.unidadesPendientes + n };
  return { estado: dentro ? 'dentro_plan' : 'pendiente', motivo: motivoLimpio, resueltaPor: null, resueltaEn: null, plan, unidades: n, excedida: !dentro };
}

const productos = n => (n === 1 ? '1 producto' : `${n} productos`);

// Leyenda para la Caja según cómo quedó la cortesía del ticket.
function leyendaCortesia({ estado, plan, unidades = 1 }) {
  if (estado === 'pendiente') {
    const quedan = plan.restantes > 0 ? `solo quedan ${plan.restantes}` : 'ya se agotaron';
    return `Cortesía de ${productos(unidades)}: ${quedan} de las ${plan.limite} cortesías permitidas de ${plan.mesNombre}, así que este ticket ya no entra en el plan mensual: un administrador debe autorizarlo (queda en Autorizaciones). La venta se procesó.`;
  }
  if (estado === 'dentro_plan') {
    return `Cortesía de ${productos(unidades)}: van ${plan.usadas} de ${plan.limite} de ${plan.mesNombre}. ${plan.restantes === 0 ? 'Se agotó el plan mensual.' : `Quedan ${plan.restantes}.`}`;
  }
  return `Cortesía de ${productos(unidades)} autorizada por administración.`;
}

function respuestaCortesia(r) {
  return { estado: r.estado, excedida: r.excedida, unidades: r.unidades, plan: r.plan, leyenda: leyendaCortesia(r) };
}

// Autorizar o rechazar una cortesía pendiente (solo administradores).
async function resolverPendiente(client, { pedidoId, sucursalId, adminId, decision, nota }) {
  if (!['autorizada', 'rechazada'].includes(decision)) throw new ApiError(400, 'Decisión inválida.');
  const notaLimpia = textoOpcional(nota, 300, 'Nota');
  const { rows: [pedido] } = await client.query(
    `SELECT id, folio, cortesia_estado FROM pedidos WHERE id = $1 AND sucursal_id = $2 AND cortesia_estado IS NOT NULL FOR UPDATE`,
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
  SELECT p.id, p.folio, p.creado_en, p.subtotal, p.total, p.metodo_pago, p.cortesia_valor, p.cortesia_unidades,
         p.cortesia_estado, p.cortesia_motivo, p.cortesia_nota,
         p.cortesia_resuelta_en, p.cancelado, p.origen,
         u.nombre AS cajero_nombre, a.nombre AS resuelta_por_nombre,
         c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
         (SELECT string_agg(pi.cantidad || ' × ' || COALESCE(pi.concepto_libre, pr.nombre) || CASE WHEN pi.es_cortesia THEN ' (cortesía)' ELSE '' END, ', ' ORDER BY pi.creado_en)
            FROM pedido_items pi LEFT JOIN productos pr ON pr.id = pi.producto_id WHERE pi.pedido_id = p.id AND pi.estado <> 'cancelado') AS detalle
  FROM pedidos p
  LEFT JOIN usuarios u ON u.id = p.cajero_id
  LEFT JOIN usuarios a ON a.id = p.cortesia_resuelta_por
  LEFT JOIN clientes c ON c.id = p.cliente_id
  WHERE p.sucursal_id = $1 AND p.cortesia_estado IS NOT NULL`;

async function listarCortesias(queryFn, sucursalId, estado) {
  if (estado !== undefined && estado !== '' && !ESTADOS.includes(estado)) throw new ApiError(400, 'Estado de cortesía inválido.');
  const filtro = estado ? ' AND p.cortesia_estado = $2' : '';
  const params = estado ? [sucursalId, estado] : [sucursalId];
  const { rows } = await queryFn(`${listaSql}${filtro} ORDER BY (p.cortesia_estado = 'pendiente') DESC, p.creado_en DESC LIMIT 300`, params);
  return rows;
}

module.exports = { CLAVE_CUPO, ESTADOS, MAX_CUPO, TZ, normalizarCupo, leerCupo, planDelMes, resolverCortesia, leyendaCortesia, respuestaCortesia, resolverPendiente, listarCortesias };
