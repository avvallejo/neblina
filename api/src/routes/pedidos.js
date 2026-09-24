const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const { assertPaymentAllowed, normalizeDiscount, assertDiscountRole } = require('../security/policies');
const { createDiscountApproval, consumeDiscountApproval } = require('../services/discountApprovals');
const { validateDate } = require('../services/dailySales');
const { prepareOrderLines } = require('../services/orderValidation');
const { resolverCortesia, respuestaCortesia } = require('../services/courtesies');
const { recalcularImportes, marcarLineasCortesia } = require('../services/orderAmounts');
const { resolverDestino, entregarItemsDeCaja } = require('../services/stations');
const { solicitarCancelacion } = require('../services/cancellations');

const {cashPart}=require('../services/cashDrawer');
const { preparationTrackingSql, deliveryHistorySql, deliverItem } = require('../services/preparationTracking');
const { addOrderItems, changeOrderItem } = require('../services/openOrders');
const { validarClientUuid, pedidoPorClientUuid, buscarPosibleDuplicado, errorPosibleDuplicado } = require('../services/orderIdempotency');
const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'mixto', 'cortesia'];
const router = express.Router();
router.use(requireAuth, resolveSucursal); // personal y cliente operan pedidos, siempre dentro de SU sede

const discountApprovalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: req => `staff:${req.auth.id}`,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/aprobaciones-descuento', requireRole('cajero', 'admin'), discountApprovalLimiter, asyncHandler(async (req, res) => {
  const discount = normalizeDiscount(req.body.descuentoPorcentaje);
  const approval = await withTransaction(client => createDiscountApproval(
    { requesterId: req.auth.id, pin: req.body.pin, discount, sucursalId: req.sucursalId },
    client.query.bind(client)
  ));
  if (approval.denied) throw new ApiError(401, 'No se pudo autorizar el descuento.');
  res.status(201).json({ token: approval.token, expiresInSeconds: approval.expiresInSeconds });
}));

// POST /api/pedidos
// body: { items: [{ productoId, tamanoId?, lecheId?, cafeId?, extraIds?, cantidad?, notas?, esRegalo?, esCortesia? }],
//         horaRecogida?, descuentoPorcentaje?, autorizacionDescuento?,
//         pago?: { metodoPago, montoRecibido?, importeEfectivo?, motivoCortesia? } }
// esCortesia (solo personal de caja): esa línea sale en $0 y el ticket consume
// el cupo mensual por unidad regalada. pago.metodoPago = 'cortesia' equivale a
// marcar TODAS las líneas (compatibilidad) y solo es válido si el total queda en 0.
router.post('/', asyncHandler(async (req, res) => {
  const { items, horaRecogida, descuentoPorcentaje, autorizacionDescuento, pinAutorizacion, pago, clienteTelefono, destino, mesa } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'El pedido necesita al menos un producto.');
  if (pinAutorizacion !== undefined) throw new ApiError(400, 'Usa una autorización de descuento de un solo uso.');

  const nombreTicket = req.body.nombreTicket;
  if (nombreTicket !== undefined && (typeof nombreTicket !== 'string' || !nombreTicket.trim() || nombreTicket.trim().length > 80)) {
    throw new ApiError(400, 'El nombre del ticket debe tener entre 1 y 80 caracteres.');
  }
  const esStaff = req.auth.tipo === 'staff';
  const origen = esStaff ? 'mostrador' : 'app';
  assertPaymentAllowed(req.auth, pago);
  if (pago && !METODOS_PAGO.includes(pago.metodoPago)) throw new ApiError(400, 'Método de pago inválido.');
  // Cortesía por producto: la Caja marca qué líneas se regalan; el descuento
  // (si lo hay) aplica solo sobre lo que sí se cobra.
  const todoCortesia = !!pago && pago.metodoPago === 'cortesia';
  const puedeDarCortesia = esStaff && ['cajero', 'mostrador', 'admin'].includes(req.auth.rol);
  if (items.some(i => i && i.esCortesia === true) && !puedeDarCortesia) throw new ApiError(403, 'Solo caja o administración pueden dar cortesías.');
  if (todoCortesia && !puedeDarCortesia) throw new ApiError(403, 'Solo caja o administración pueden dar cortesías.');
  const descuentoFinal = normalizeDiscount(descuentoPorcentaje);
  if (descuentoFinal) assertDiscountRole(req.auth);
  const clientUuid = validarClientUuid(req.body.clientUuid);
  const confirmarDuplicado = req.body.confirmarDuplicado === true;

  const resultado = await withTransaction(async client => {
    // Reintento del mismo cobro (se perdió la respuesta): el mismo pedido, no otro.
    const previo = await pedidoPorClientUuid(client, clientUuid, req.sucursalId);
    if (previo) return { ...previo, yaExistia: true };
    let clienteId = req.auth.tipo === 'cliente' ? req.auth.id : null;
    if (esStaff && clienteTelefono) {
      const c = await client.query('SELECT id FROM clientes WHERE telefono = $1 AND sucursal_id = $2', [String(clienteTelefono).replace(/\D/g, ''), req.sucursalId]);
      if (c.rows.length > 0) clienteId = c.rows[0].id;
    }

    // Destino (mesa / barra / para llevar): obligatorio en ventas de mostrador;
    // el pedido en línea no lo lleva (el cliente pasa a recoger).
    const dest = await resolverDestino(client.query.bind(client), req.sucursalId, { destino, mesa }, { obligatorio: esStaff });
    const { lines: lineas, isRewardOrder: esRegaloPedido } = await prepareOrderLines(client, items, clienteId, req.sucursalId);
    if (esRegaloPedido && descuentoFinal) throw new ApiError(400, 'No se puede aplicar descuento a una recompensa.');
    for (const l of lineas) l.esCortesia = todoCortesia || l.esCortesia === true;
    const lineasCortesia = lineas.filter(l => l.esCortesia);
    if (esRegaloPedido && lineasCortesia.length) throw new ApiError(400, 'Una recompensa de fidelidad ya es gratis; no se registra como cortesía.');
    const cortesiaValor = Math.round(lineasCortesia.reduce((sum, l) => sum + l.precioUnitario * l.cantidad, 0) * 100) / 100;
    const cortesiaUnidades = lineasCortesia.reduce((sum, l) => sum + l.cantidad, 0);

    let autorizadoPor = null;
    if (descuentoFinal) {
      autorizadoPor = req.auth.rol === 'admin'
        ? req.auth.id
        : await consumeDiscountApproval(client, {
          requesterId: req.auth.id,
          token: autorizacionDescuento,
          discount: descuentoFinal,
        });
    }

    const subtotal = lineas.reduce((sum, line) => sum + line.precioUnitario * line.cantidad, 0);
    const total = Math.round(((subtotal - cortesiaValor) * (1 - descuentoFinal / 100)) * 100) / 100;
    // ¿La misma persona acaba de registrar un pedido idéntico? Se confirma antes de duplicar.
    if (esStaff && !confirmarDuplicado) {
      const dup = await buscarPosibleDuplicado(client, {
        sucursalId: req.sucursalId, cajeroId: ['cajero', 'mostrador', 'admin'].includes(req.auth.rol) ? req.auth.id : null,
        nombreTicket: nombreTicket?.trim() || null, total, lineas,
      });
      if (dup) throw errorPosibleDuplicado(dup, nombreTicket?.trim());
    }
    const cobradoInicial = !!pago;
    // Un ticket 100 % cortesía se registra con forma de pago 'cortesia' (total
    // 0); si algo se cobra, lleva la forma de pago real. El cupo se resuelve
    // al cobrar; un ticket abierto conserva las marcas y se resuelve en /cobrar.
    if (todoCortesia && total > 0) throw new ApiError(400, 'La forma de pago "cortesía" solo aplica cuando todo el ticket es de cortesía; marca los productos que se regalan y cobra el resto.');
    const metodoPago = cobradoInicial ? (total === 0 && cortesiaUnidades > 0 ? 'cortesia' : pago.metodoPago) : null;
    const esCortesia = metodoPago === 'cortesia';
    const cortesia = cobradoInicial && cortesiaUnidades > 0
      ? await resolverCortesia(client, { auth: req.auth, sucursalId: req.sucursalId, motivo: pago.motivoCortesia, unidades: cortesiaUnidades })
      : null;
    const pedidoRes = await client.query(
      `INSERT INTO pedidos (turno_id, origen, cliente_id, cajero_id, hora_recogida, subtotal,
          descuento_porcentaje, descuento_autorizado_por, total, metodo_pago, monto_recibido, cambio,
          cobrado, es_regalo_fidelidad, sucursal_id, importe_efectivo,
          cortesia_estado, cortesia_motivo, cortesia_resuelta_por, cortesia_resuelta_en, destino, mesa_numero,
          cortesia_valor, cortesia_unidades, nombre_ticket, client_uuid)
       VALUES (NULL, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [origen, clienteId, esStaff && ['cajero', 'mostrador', 'admin'].includes(req.auth.rol) ? req.auth.id : null, horaRecogida || null, subtotal,
        descuentoFinal, autorizadoPor, total,
        metodoPago, cobradoInicial && !esCortesia ? pago.montoRecibido : null,
        cobradoInicial && !esCortesia && pago.montoRecibido ? Math.round((pago.montoRecibido - total) * 100) / 100 : null,
        cobradoInicial, esRegaloPedido, req.sucursalId, cobradoInicial ? cashPart(metodoPago, total, pago.importeEfectivo) : null,
        cortesia ? cortesia.estado : null, cortesia ? cortesia.motivo : null, cortesia ? cortesia.resueltaPor : null, cortesia ? cortesia.resueltaEn : null,
        dest.destino, dest.mesaNumero, cortesiaValor, cortesiaUnidades, nombreTicket?.trim() || null, clientUuid]
    );
    const pedido = pedidoRes.rows[0];

    const itemsCreados = [];
    for (const l of lineas) {
      // eslint-disable-next-line no-await-in-loop
      const itemRes = await client.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, tamano_id, leche_id, cafe_id, cantidad, precio_unitario, notas, es_regalo, es_cortesia)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [pedido.id, l.productoId, l.tamanoId || null, l.lecheId || null, l.cafeId || null, l.cantidad, l.precioUnitario, l.notas || null, l.esRegalo, l.esCortesia]
      );
      const itemCreado = itemRes.rows[0];
      for (const extraId of l.extraIds || []) {
        // eslint-disable-next-line no-await-in-loop
        await client.query('INSERT INTO pedido_item_extras (pedido_item_id, extra_id) VALUES ($1,$2)', [itemCreado.id, extraId]);
      }
      itemsCreados.push(itemCreado);
    }
    // Lo que se entrega en caja (snacks empacados) no pasa por la comanda.
    await entregarItemsDeCaja(client, pedido.id);
    return { pedido, items: itemsCreados, cortesia: cortesia ? respuestaCortesia(cortesia) : undefined };
  });

  res.status(resultado.yaExistia ? 200 : 201).json(resultado);
}));

router.get('/', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const fecha = validateDate(req.query.fecha);
  // Se agregan nombre del cliente y conteo de items para que la pantalla de
  // Caja muestre "N producto(s) — Nombre" sin pedir cada pedido por separado.
  const { rows } = await query(
    `SELECT v.*, p.nombre_ticket, u.nombre AS levantado_por_nombre, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
            (SELECT COUNT(*) FROM pedido_items pi WHERE pi.pedido_id = v.id AND pi.estado <> 'cancelado') AS num_items
     FROM vw_pedidos_con_estado v
     JOIN pedidos p ON p.id = v.id
     LEFT JOIN usuarios u ON u.id = p.cajero_id
     LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.sucursal_id = $1 AND ($2::date IS NULL OR (v.creado_en >= $2::date::timestamp AT TIME ZONE 'America/Mexico_City' AND v.creado_en < ($2::date+1)::timestamp AT TIME ZONE 'America/Mexico_City'))
     ORDER BY v.creado_en DESC LIMIT 2000`,
    [req.sucursalId, fecha]
  );
  res.json(rows);
}));

router.post('/:id/items', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const pedido = await withTransaction(client => addOrderItems(client, {
    id: req.params.id, sucursalId: req.sucursalId, auth: req.auth, items: req.body.items,
  }));
  res.status(201).json(pedido);
}));

router.patch('/:id/items/:itemId', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const pedido = await withTransaction(client => changeOrderItem(client, {
    id: req.params.id, itemId: req.params.itemId, sucursalId: req.sucursalId, auth: req.auth,
    cantidad: req.body.cantidad, cantidadEsperada: req.body.cantidadEsperada, motivo: req.body.motivo, devuelto: req.body.devuelto,
  }));
  res.json(pedido);
}));

router.get('/comandas', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const deliveries = req.query.historial === 'entregas';
  const history = req.query.historial === 'true';
  const fecha = validateDate(req.query.fecha);
  if ((history || deliveries) && !fecha) throw new ApiError(400, 'Selecciona la fecha del historial.');
  const { rows } = deliveries
    ? await query(deliveryHistorySql, [req.sucursalId, fecha])
    : await query(preparationTrackingSql, [req.sucursalId, history, fecha]);
  res.json(rows);
}));

router.patch('/:id/items/:itemId/entregar', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const item = await withTransaction(client => deliverItem(client, {
    orderId: req.params.id, itemId: req.params.itemId, sucursalId: req.sucursalId, auth: req.auth,
    cantidad: req.body.cantidad, cantidadEsperada: req.body.cantidadEsperada,
  }));
  res.json(item);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const pedido = await query('SELECT v.*,p.nombre_ticket,u.nombre AS levantado_por_nombre,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido,p.registrado_en,p.motivo_registro,p.registro_manual FROM vw_pedidos_con_estado v JOIN pedidos p ON p.id=v.id LEFT JOIN usuarios u ON u.id=p.cajero_id LEFT JOIN clientes c ON c.id=p.cliente_id WHERE v.id = $1 AND v.sucursal_id = $2', [req.params.id, req.sucursalId]);
  if (pedido.rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
  if (req.auth.tipo === 'cliente' && pedido.rows[0].cliente_id !== req.auth.id) {
    throw new ApiError(403, 'No puedes ver un pedido que no es tuyo.');
  }
  const items = await query(
    `SELECT pi.*, COALESCE(pi.concepto_libre,pr.nombre) AS producto_nombre, pr.icono, pi.estacion_preparacion AS estacion, fin.nombre AS terminado_por_nombre,
       ot.etiqueta AS tamano_etiqueta, ol.etiqueta AS leche_etiqueta, oc.etiqueta AS cafe_etiqueta,
       COALESCE((SELECT json_agg(oe.etiqueta) FROM pedido_item_extras pie JOIN opciones_extra oe ON oe.id=pie.extra_id WHERE pie.pedido_item_id=pi.id), '[]') AS extras
     FROM pedido_items pi LEFT JOIN productos pr ON pr.id = pi.producto_id
     LEFT JOIN usuarios fin ON fin.id=pi.terminado_por
     LEFT JOIN opciones_tamano ot ON ot.id=pi.tamano_id
     LEFT JOIN opciones_leche ol ON ol.id=pi.leche_id
     LEFT JOIN opciones_cafe oc ON oc.id=pi.cafe_id
     WHERE pi.pedido_id = $1 ORDER BY pi.creado_en`,
    [req.params.id]
  );
  res.json({ ...pedido.rows[0], items: items.rows });
}));

// Confirma el cobro de un pedido en línea o de un ticket abierto (o el
// registro de un regalo entregado). Aquí — y solo aquí — el trigger de la base
// de datos acredita el punto de fidelidad, nunca al crear el pedido.
// body: { metodoPago?, montoRecibido?, importeEfectivo?, totalEsperado?,
//         itemsCortesia?: [pedidoItemId], motivoCortesia? }
// itemsCortesia sustituye las marcas de cortesía del ticket (lo que no venga
// deja de serlo); sin el campo se respetan las marcas con que se abrió.
// totalEsperado es el total que la Caja vio ANTES de marcar cortesías.
router.patch('/:id/cobrar', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const { metodoPago, montoRecibido, importeEfectivo, motivoCortesia, totalEsperado, itemsCortesia } = req.body;
  const metodoPedido = metodoPago || 'efectivo';
  if (!METODOS_PAGO.includes(metodoPedido)) throw new ApiError(400, 'Método de pago inválido.');
  if (itemsCortesia !== undefined && (!Array.isArray(itemsCortesia) || itemsCortesia.some(i => typeof i !== 'string'))) throw new ApiError(400, 'itemsCortesia debe ser una lista de ids de productos del ticket.');
  const resultado = await withTransaction(async client => {
    const actual = await client.query('SELECT total, cobrado, es_regalo_fidelidad, cancelado, no_show, cancelacion_estado, cortesia_unidades, registro_manual FROM pedidos WHERE id = $1 AND sucursal_id = $2 FOR UPDATE', [req.params.id, req.sucursalId]);
    if (actual.rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
    if (actual.rows[0].cobrado) throw new ApiError(409, 'Este pedido ya estaba cobrado.');
    if (actual.rows[0].cancelado || actual.rows[0].no_show || actual.rows[0].cancelacion_estado === 'pendiente') throw new ApiError(409, 'El ticket está cancelado, no recogido o pendiente de cancelación.');
    if (totalEsperado !== undefined && (!Number.isFinite(Number(totalEsperado)) || Number(totalEsperado) !== Number(actual.rows[0].total))) {
      throw new ApiError(409, 'El total cambió. Regresa al ticket y revisa el importe antes de cobrar.');
    }


    const contenido = await client.query("SELECT 1 FROM pedido_items WHERE pedido_id=$1 AND estado<>'cancelado' LIMIT 1", [req.params.id]);
    if (!contenido.rows.length) throw new ApiError(409, 'El ticket está vacío. Agrega el producto de reemplazo antes de cobrar.');

    // Cortesías del ticket: se marcan (o re-marcan) las líneas, se recalculan
    // los importes y, si se regaló algo, se resuelve el cupo mensual.
    const todoCortesia = metodoPedido === 'cortesia';
    let pedido = actual.rows[0];
    if (todoCortesia || itemsCortesia !== undefined) {
      if (pedido.registro_manual) throw new ApiError(409, 'Una captura directa no admite cortesías.');
      if (pedido.es_regalo_fidelidad) throw new ApiError(400, 'Una recompensa de fidelidad ya es gratis; no se registra como cortesía.');
      if (todoCortesia) {
        await client.query(`UPDATE pedido_items SET es_cortesia = true WHERE pedido_id = $1 AND estado <> 'cancelado' AND NOT es_cortesia`, [req.params.id]);
      } else {
        await marcarLineasCortesia(client, req.params.id, itemsCortesia, ApiError);
      }
      pedido = await recalcularImportes(client, req.params.id);
    }
    const unidades = Number(pedido.cortesia_unidades || 0);
    const total = Number(pedido.total);
    if (todoCortesia && total > 0) throw new ApiError(400, 'La forma de pago "cortesía" solo aplica cuando todo el ticket es de cortesía; marca los productos que se regalan y cobra el resto.');
    const metodo = total === 0 && unidades > 0 ? 'cortesia' : metodoPedido;
    const esCortesia = metodo === 'cortesia';
    const cortesia = unidades > 0
      ? await resolverCortesia(client, { auth: req.auth, sucursalId: req.sucursalId, motivo: motivoCortesia, unidades })
      : null;
    const cambio = total > 0 && montoRecibido !== undefined && montoRecibido !== null ? Math.round((montoRecibido - total) * 100) / 100 : null;
    const { rows } = await client.query(
      `UPDATE pedidos SET cobrado = true, metodo_pago = $1, monto_recibido = $2, cambio = $3, importe_efectivo = $6,
          cortesia_estado = $7, cortesia_motivo = $8, cortesia_resuelta_por = $9, cortesia_resuelta_en = $10
       WHERE id = $4 AND sucursal_id = $5 AND NOT cobrado RETURNING *`,
      [metodo, esCortesia ? null : (montoRecibido || null), cambio, req.params.id, req.sucursalId, cashPart(metodo, total, importeEfectivo),
        cortesia ? cortesia.estado : null, cortesia ? cortesia.motivo : null, cortesia ? cortesia.resueltaPor : null, cortesia ? cortesia.resueltaEn : null]
    );
    if (!rows.length) throw new ApiError(409, 'Este pedido ya estaba cobrado.');
    return { ...rows[0], cortesia: cortesia ? respuestaCortesia(cortesia) : undefined };
  });
  res.json(resultado);
}));

// Pedir la cancelación de un pedido, SIEMPRE con motivo. Lo permite el CLIENTE
// (solo el suyo y sin cobrar), el BARISTA, la CAJA y el ADMIN.
// Si el ticket no se cobró y la preparación no había iniciado, se cancela al
// momento; en cualquier otro caso queda pendiente de que un administrador la
// autorice (Admin → Autorizaciones) y hasta entonces sigue contando en ventas.
router.patch('/:id/cancelar', asyncHandler(async (req, res) => {
  if (req.auth.tipo === 'staff' && !['barista', 'cajero', 'mostrador', 'admin'].includes(req.auth.rol)) {
    throw new ApiError(403, 'No autorizado para cancelar pedidos.');
  }
  const resultado = await withTransaction(client => solicitarCancelacion(client, {
    pedidoId: req.params.id, sucursalId: req.sucursalId, auth: req.auth, motivo: req.body.motivo,
  }));
  res.json({ ok: true, ...resultado });
}));

// El cliente nunca pasó por un pedido ya listo: el trigger de la base de
// datos resta el punto de fidelidad. La merma de lo ya preparado se reporta
// vía pedidos.no_show en los reportes (los insumos ya se descontaron al
// terminar la bebida, así que no se vuelve a descontar aquí).
router.patch('/:id/no-show', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('UPDATE pedidos SET no_show = true WHERE id = $1 AND sucursal_id = $2 RETURNING *', [req.params.id, req.sucursalId]);
  if (rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
  res.json(rows[0]);
}));

module.exports = router;
