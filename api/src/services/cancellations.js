// CANCELACIÓN DE TICKETS — con motivo y, cuando mueve dinero, con autorización.
//
// Regla de negocio (definida por el negocio):
//   * La Caja SIEMPRE puede pedir la cancelación de un ticket, de cualquier
//     fecha, escribiendo el motivo (un ticket duplicado, un cobro equivocado…).
//   * Si el ticket NO se cobró y su preparación no había iniciado, se cancela
//     al momento: no movía dinero ni inventario, solo queda el motivo.
//   * En cualquier otro caso queda `pendiente`: el ticket SIGUE contando en las
//     ventas del día hasta que un administrador la AUTORICE en
//     Admin → Autorizaciones. Nadie baja ventas sin el visto bueno del admin.
//   * Un administrador que pide la cancelación la autoriza de una vez.
// Al autorizar: el pedido queda cancelado (sale de ventas, de la caja del turno
// y del estado de resultados), sus ítems quedan cancelados, el punto de
// fidelidad se devuelve (trigger) y los insumos consumidos regresan al
// inventario (fn_revertir_consumo_pedido). Rechazar deja el ticket como estaba.
const { ApiError } = require('../utils/asyncHandler');
const A = require('./accounting');

const ESTADOS = ['pendiente', 'autorizada', 'rechazada'];
const MOTIVO_MAX = 300;

function motivoObligatorio(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'Escribe el motivo de la cancelación (por ejemplo: "ticket duplicado").');
  const t = value.trim();
  if (t.length < 3) throw new ApiError(400, 'El motivo es muy corto; explica brevemente qué pasó.');
  if (t.length > MOTIVO_MAX) throw new ApiError(400, `El motivo no puede tener más de ${MOTIVO_MAX} caracteres.`);
  return t;
}
function textoOpcional(value, max, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ApiError(400, `${label}: escribe un texto.`);
  const t = value.trim();
  if (!t) return null;
  if (t.length > max) throw new ApiError(400, `${label}: máximo ${max} caracteres.`);
  return t;
}

// El mes contable del ticket (hora de Ciudad de México).
async function periodoDelPedido(queryFn, pedidoId) {
  const { rows: [r] } = await queryFn(
    `SELECT to_char((creado_en AT TIME ZONE '${A.TZ}')::date, 'YYYY-MM') AS periodo FROM pedidos WHERE id = $1`, [pedidoId]);
  return r ? r.periodo : null;
}

// Marca el pedido como cancelado de verdad: ítems, inventario y auditoría.
async function aplicarCancelacion(client, { pedido, sucursalId, usuarioId, motivo, devolverInsumos = true }) {
  const q = client.query.bind(client);
  // Un mes contable ya cerrado no se toca: cambiaría una utilidad (y un diezmo) ya fijados.
  const periodo = await periodoDelPedido(q, pedido.id);
  if (periodo && await A.mesCerrado(q, sucursalId, periodo)) {
    throw new ApiError(409, `El ticket es de ${A.rangoPeriodo(periodo).nombre} y ese mes ya está cerrado en Contabilidad. Reábrelo si de verdad hay que cancelarlo.`);
  }
  await q('UPDATE pedidos SET cancelado = true WHERE id = $1', [pedido.id]);
  await q("UPDATE pedido_items SET estado = 'cancelado' WHERE pedido_id = $1 AND estado <> 'cancelado'", [pedido.id]);
  let devueltos = 0;
  if (devolverInsumos) {
    const { rows: [r] } = await q('SELECT fn_revertir_consumo_pedido($1, $2, $3) AS n', [pedido.id, usuarioId, `Cancelación de ${pedido.folio}: ${motivo || 'sin motivo'}`]);
    devueltos = Number(r.n);
  }
  return devueltos;
}

// La Caja (o el admin) pide cancelar. Devuelve el estado resultante.
async function solicitarCancelacion(client, { pedidoId, sucursalId, auth, motivo }) {
  const q = client.query.bind(client);
  const motivoLimpio = motivoObligatorio(motivo);
  const { rows: [pedido] } = await q(
    'SELECT id, folio, cobrado, cancelado, no_show, total, cancelacion_estado, cliente_id FROM pedidos WHERE id = $1 AND sucursal_id = $2 FOR UPDATE',
    [pedidoId, sucursalId]);
  if (!pedido) throw new ApiError(404, 'Pedido no encontrado en esta sucursal.');
  if (pedido.cancelado) throw new ApiError(409, 'Este ticket ya está cancelado.');
  if (pedido.cancelacion_estado === 'pendiente') throw new ApiError(409, 'Ya hay una cancelación pendiente de autorizar para este ticket.');
  // El cliente de la app solo puede cancelar SU pedido, y solo sin cobrar.
  if (auth.tipo === 'cliente') {
    const { rows: [propio] } = await q('SELECT 1 FROM pedidos WHERE id = $1 AND cliente_id = $2', [pedidoId, auth.id]);
    if (!propio) throw new ApiError(403, 'No puedes cancelar un pedido que no es tuyo.');
    if (pedido.cobrado) throw new ApiError(409, 'Tu pedido ya se cobró; pídelo en el mostrador.');
  }
  const iniciado = await q("SELECT 1 FROM pedido_items WHERE pedido_id = $1 AND estado NOT IN ('pendiente','cancelado') LIMIT 1", [pedidoId]);
  const esAdmin = auth.tipo === 'staff' && auth.rol === 'admin';
  // Sin cobrar y sin preparar: no movió dinero ni insumos → se cancela al momento.
  const inmediata = !pedido.cobrado && iniciado.rows.length === 0;
  const estado = inmediata || esAdmin ? 'autorizada' : 'pendiente';

  let devueltos = 0;
  if (estado === 'autorizada') {
    devueltos = await aplicarCancelacion(client, { pedido, sucursalId, usuarioId: auth.tipo === 'staff' ? auth.id : null, motivo: motivoLimpio });
  }
  const { rows: [actualizado] } = await q(
    `UPDATE pedidos SET cancelacion_estado = $3, cancelacion_motivo = $4,
        cancelacion_solicitada_por = $5::uuid, cancelacion_solicitada_en = now(),
        cancelacion_resuelta_por = CASE WHEN $3 = 'autorizada' THEN $5::uuid END,
        cancelacion_resuelta_en = CASE WHEN $3 = 'autorizada' THEN now() END
     WHERE id = $1 AND sucursal_id = $2
     RETURNING id, folio, total, cancelado, cancelacion_estado, cancelacion_motivo, cancelacion_solicitada_en`,
    [pedidoId, sucursalId, estado, motivoLimpio, auth.tipo === 'staff' ? auth.id : null]);
  await q(
    `INSERT INTO auditoria (entidad, entidad_id, accion, valor_anterior, valor_nuevo, motivo, usuario_id, sucursal_id)
     VALUES ('pedidos', $1, $2, $3, $4, $5, $6, $7)`,
    [pedidoId, estado === 'autorizada' ? 'cancelacion_inmediata' : 'cancelacion_solicitada',
      { cobrado: pedido.cobrado, total: pedido.total, cancelado: false },
      { cancelacionEstado: estado, insumosDevueltos: devueltos },
      motivoLimpio, auth.tipo === 'staff' ? auth.id : null, sucursalId]);
  return { ...actualizado, insumosDevueltos: devueltos, leyenda: leyendaCancelacion(actualizado, inmediata) };
}

function leyendaCancelacion(pedido, inmediata) {
  if (pedido.cancelacion_estado === 'autorizada') {
    return inmediata
      ? `Ticket ${pedido.folio} cancelado. No se había cobrado, así que no cambia el corte.`
      : `Ticket ${pedido.folio} cancelado y descontado de las ventas.`;
  }
  return `Se registró la solicitud. El ticket ${pedido.folio} sigue contando en las ventas hasta que un administrador autorice la cancelación en Autorizaciones.`;
}

// El administrador resuelve una solicitud pendiente.
async function resolverCancelacion(client, { pedidoId, sucursalId, adminId, decision, nota, devolverInsumos = true }) {
  if (!['autorizada', 'rechazada'].includes(decision)) throw new ApiError(400, 'Decisión inválida.');
  const q = client.query.bind(client);
  const notaLimpia = textoOpcional(nota, 300, 'Nota');
  const { rows: [pedido] } = await q(
    'SELECT id, folio, total, cobrado, cancelado, cancelacion_estado, cancelacion_motivo FROM pedidos WHERE id = $1 AND sucursal_id = $2 FOR UPDATE',
    [pedidoId, sucursalId]);
  if (!pedido) throw new ApiError(404, 'Cancelación no encontrada en esta sucursal.');
  if (pedido.cancelacion_estado !== 'pendiente') {
    throw new ApiError(409, pedido.cancelacion_estado ? `Esta cancelación ya fue resuelta (${pedido.cancelacion_estado}).` : 'Este ticket no tiene una cancelación pendiente.');
  }
  let devueltos = 0;
  if (decision === 'autorizada') {
    devueltos = await aplicarCancelacion(client, { pedido, sucursalId, usuarioId: adminId, motivo: pedido.cancelacion_motivo, devolverInsumos });
  }
  const { rows: [actualizado] } = await q(
    `UPDATE pedidos SET cancelacion_estado = $3, cancelacion_resuelta_por = $4, cancelacion_resuelta_en = now(), cancelacion_nota = $5
     WHERE id = $1 AND sucursal_id = $2
     RETURNING id, folio, total, cancelado, cancelacion_estado, cancelacion_nota, cancelacion_resuelta_en`,
    [pedidoId, sucursalId, decision, adminId, notaLimpia]);
  await q(
    `INSERT INTO auditoria (entidad, entidad_id, accion, valor_anterior, valor_nuevo, motivo, usuario_id, sucursal_id)
     VALUES ('pedidos', $1, 'cancelacion_' || $2, $3, $4, $5, $6, $7)`,
    [pedidoId, decision, { cancelacionEstado: 'pendiente', total: pedido.total },
      { cancelacionEstado: decision, cancelado: decision === 'autorizada', insumosDevueltos: devueltos },
      notaLimpia || pedido.cancelacion_motivo, adminId, sucursalId]);
  return { ...actualizado, insumosDevueltos: devueltos };
}

const listaSql = `
  SELECT p.id, p.folio, p.creado_en, p.total, p.subtotal, p.metodo_pago, p.cobrado, p.cancelado, p.origen,
         p.cancelacion_estado, p.cancelacion_motivo, p.cancelacion_nota,
         p.cancelacion_solicitada_en, p.cancelacion_resuelta_en,
         s.nombre AS solicitada_por_nombre, a.nombre AS resuelta_por_nombre,
         u.nombre AS cajero_nombre, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
         (SELECT COUNT(*) FROM movimientos_inventario mi JOIN pedido_items pi2 ON pi2.id = mi.pedido_item_id
           WHERE pi2.pedido_id = p.id AND mi.tipo = 'consumo'
             AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id = mi.id)) AS insumos_por_devolver,
         (SELECT string_agg(pi.cantidad || ' × ' || COALESCE(pi.concepto_libre, pr.nombre), ', ' ORDER BY pi.creado_en)
            FROM pedido_items pi LEFT JOIN productos pr ON pr.id = pi.producto_id WHERE pi.pedido_id = p.id) AS detalle
  FROM pedidos p
  LEFT JOIN usuarios s ON s.id = p.cancelacion_solicitada_por
  LEFT JOIN usuarios a ON a.id = p.cancelacion_resuelta_por
  LEFT JOIN usuarios u ON u.id = p.cajero_id
  LEFT JOIN clientes c ON c.id = p.cliente_id
  WHERE p.sucursal_id = $1 AND p.cancelacion_estado IS NOT NULL`;

async function listarCancelaciones(queryFn, sucursalId, estado) {
  if (estado !== undefined && estado !== '' && !ESTADOS.includes(estado)) throw new ApiError(400, 'Estado de cancelación inválido.');
  const filtro = estado ? ' AND p.cancelacion_estado = $2' : '';
  const params = estado ? [sucursalId, estado] : [sucursalId];
  const { rows } = await queryFn(
    `${listaSql}${filtro} ORDER BY (p.cancelacion_estado = 'pendiente') DESC, p.cancelacion_solicitada_en DESC LIMIT 300`, params);
  return rows;
}

module.exports = { ESTADOS, MOTIVO_MAX, motivoObligatorio, solicitarCancelacion, resolverCancelacion, listarCancelaciones, leyendaCancelacion };
