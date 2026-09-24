const { ApiError } = require('../utils/asyncHandler');

// Protección contra cobros duplicados en Caja.
//
// 1) Idempotencia: la Caja manda un `clientUuid` por intento de cobro. Si la
//    respuesta se pierde (señal débil) y se vuelve a tocar "Cobrar", el
//    servidor reconoce la clave y devuelve el MISMO pedido en vez de crear otro.
// 2) Aviso de pedido idéntico: si en los últimos minutos la misma persona ya
//    registró un pedido con el mismo nombre, productos y total, se pide
//    confirmación antes de crear otro (puede ser legítimo: dos amigos piden igual).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VENTANA_DUPLICADO_MIN = 3;

function validarClientUuid(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new ApiError(400, 'Clave del cobro inválida.');
  return value.toLowerCase();
}

// Debe llamarse dentro de la transacción, ANTES de consumir autorizaciones de
// descuento o cupo de cortesías: un reintento no debe gastarlos dos veces.
async function pedidoPorClientUuid(client, clientUuid, sucursalId) {
  if (!clientUuid) return null;
  // Serializa dos reintentos simultáneos con la misma clave.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pedido:${clientUuid}`]);
  const { rows: [p] } = await client.query('SELECT * FROM pedidos WHERE client_uuid = $1', [clientUuid]);
  if (!p) return null;
  if (p.sucursal_id !== sucursalId) throw new ApiError(409, 'Esa clave de cobro pertenece a otra sucursal.');
  const { rows: items } = await client.query('SELECT * FROM pedido_items WHERE pedido_id = $1 ORDER BY creado_en, id', [p.id]);
  return { pedido: p, items };
}

const firma = lineas => lineas
  .map(l => [l.productoId || l.producto_id, l.tamanoId || l.tamano_id || '', l.lecheId || l.leche_id || '', l.cafeId || l.cafe_id || '', Number(l.cantidad), Number(l.precioUnitario ?? l.precio_unitario).toFixed(2)].join(':'))
  .sort()
  .join('|');

async function buscarPosibleDuplicado(client, { sucursalId, cajeroId, nombreTicket, total, lineas }) {
  const { rows: candidatos } = await client.query(
    `SELECT p.id, p.folio, p.total, p.cobrado, EXTRACT(EPOCH FROM (now() - p.creado_en))::int AS segundos
     FROM pedidos p
     WHERE p.sucursal_id = $1 AND p.origen = 'mostrador' AND NOT p.cancelado AND NOT p.no_show
       AND p.creado_en > now() - make_interval(mins => $5)
       AND p.cajero_id IS NOT DISTINCT FROM $2
       AND COALESCE(lower(btrim(p.nombre_ticket)), '') = COALESCE(lower(btrim($3)), '')
       AND p.total = $4
     ORDER BY p.creado_en DESC LIMIT 5`,
    [sucursalId, cajeroId, nombreTicket || null, total, VENTANA_DUPLICADO_MIN]);
  if (!candidatos.length) return null;
  const buscada = firma(lineas);
  for (const c of candidatos) {
    // eslint-disable-next-line no-await-in-loop
    const { rows: items } = await client.query("SELECT producto_id, tamano_id, leche_id, cafe_id, cantidad, precio_unitario FROM pedido_items WHERE pedido_id = $1 AND estado <> 'cancelado'", [c.id]);
    if (firma(items) === buscada) return { folio: c.folio, total: Number(c.total), segundos: c.segundos, cobrado: c.cobrado };
  }
  return null;
}

function errorPosibleDuplicado(dup, nombreTicket) {
  const hace = dup.segundos < 60 ? `hace ${dup.segundos} s` : `hace ${Math.round(dup.segundos / 60)} min`;
  return new ApiError(409,
    `Ya registraste ${hace} el pedido ${dup.folio}${nombreTicket ? ` para ${nombreTicket}` : ''} con los mismos productos por $${dup.total.toFixed(2)}. ¿Es OTRO pedido distinto?`,
    { codigo: 'posible_duplicado', folio: dup.folio, segundos: dup.segundos, total: dup.total });
}

module.exports = { validarClientUuid, pedidoPorClientUuid, buscarPosibleDuplicado, errorPosibleDuplicado, VENTANA_DUPLICADO_MIN };
