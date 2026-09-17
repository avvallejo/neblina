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
const { resolverDestino, entregarItemsDeCaja } = require('../services/stations');
const { solicitarCancelacion } = require('../services/cancellations');

const {cashPart}=require('../services/cashDrawer');
const { addOrderItems, changeOrderItem } = require('../services/openOrders');
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
// body: { items: [{ productoId, tamanoId?, lecheId?, cafeId?, extraIds?, cantidad?, notas?, esRegalo? }],
//         horaRecogida?, descuentoPorcentaje?, autorizacionDescuento?, pago?: { metodoPago, montoRecibido } }
router.post('/', asyncHandler(async (req, res) => {
  const { items, horaRecogida, descuentoPorcentaje, autorizacionDescuento, pinAutorizacion, pago, clienteTelefono, destino, mesa } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'El pedido necesita al menos un producto.');
  if (pinAutorizacion !== undefined) throw new ApiError(400, 'Usa una autorización de descuento de un solo uso.');

  const esStaff = req.auth.tipo === 'staff';
  const origen = esStaff ? 'mostrador' : 'app';
  assertPaymentAllowed(req.auth, pago);
  if (pago && !METODOS_PAGO.includes(pago.metodoPago)) throw new ApiError(400, 'Método de pago inválido.');
  // Cortesía: el pedido completo sale en $0. No combina con descuento (ya no
  // hay nada que descontar) ni con una recompensa de fidelidad (ya es gratis).
  const esCortesia = !!pago && pago.metodoPago === 'cortesia';
  const descuentoFinal = normalizeDiscount(descuentoPorcentaje);
  if (descuentoFinal) assertDiscountRole(req.auth);
  if (esCortesia && descuentoFinal) throw new ApiError(400, 'Una cortesía deja el pedido en $0: no lleva descuento.');

  const resultado = await withTransaction(async client => {
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
    if (esRegaloPedido && esCortesia) throw new ApiError(400, 'Una recompensa de fidelidad ya es gratis; no se registra como cortesía.');

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
    const cortesia = esCortesia ? await resolverCortesia(client, { auth: req.auth, sucursalId: req.sucursalId, motivo: pago.motivoCortesia }) : null;
    const total = esCortesia ? 0 : Math.round((subtotal * (1 - descuentoFinal / 100)) * 100) / 100;
    const cobradoInicial = !!pago;
    const pedidoRes = await client.query(
      `INSERT INTO pedidos (turno_id, origen, cliente_id, cajero_id, hora_recogida, subtotal,
          descuento_porcentaje, descuento_autorizado_por, total, metodo_pago, monto_recibido, cambio,
          cobrado, es_regalo_fidelidad, sucursal_id, importe_efectivo,
          cortesia_estado, cortesia_motivo, cortesia_resuelta_por, cortesia_resuelta_en, destino, mesa_numero)
       VALUES (NULL, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [origen, clienteId, esStaff && ['cajero', 'mostrador', 'admin'].includes(req.auth.rol) ? req.auth.id : null, horaRecogida || null, subtotal,
        descuentoFinal, autorizadoPor, total,
        cobradoInicial ? pago.metodoPago : null, cobradoInicial && !esCortesia ? pago.montoRecibido : null,
        cobradoInicial && !esCortesia && pago.montoRecibido ? Math.round((pago.montoRecibido - total) * 100) / 100 : null,
        cobradoInicial, esRegaloPedido, req.sucursalId, cobradoInicial?cashPart(pago.metodoPago,total,pago.importeEfectivo):null,
        cortesia ? cortesia.estado : null, cortesia ? cortesia.motivo : null, cortesia ? cortesia.resueltaPor : null, cortesia ? cortesia.resueltaEn : null,
        dest.destino, dest.mesaNumero]
    );
    const pedido = pedidoRes.rows[0];

    const itemsCreados = [];
    for (const l of lineas) {
      // eslint-disable-next-line no-await-in-loop
      const itemRes = await client.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, tamano_id, leche_id, cafe_id, cantidad, precio_unitario, notas, es_regalo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [pedido.id, l.productoId, l.tamanoId || null, l.lecheId || null, l.cafeId || null, l.cantidad, l.precioUnitario, l.notas || null, l.esRegalo]
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

  res.status(201).json(resultado);
}));

router.get('/', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const fecha = validateDate(req.query.fecha);
  // Se agregan nombre del cliente y conteo de items para que la pantalla de
  // Caja muestre "N producto(s) — Nombre" sin pedir cada pedido por separado.
  const { rows } = await query(
    `SELECT v.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
            (SELECT COUNT(*) FROM pedido_items pi WHERE pi.pedido_id = v.id) AS num_items
     FROM vw_pedidos_con_estado v
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
    cantidad: req.body.cantidad, cantidadEsperada: req.body.cantidadEsperada,
  }));
  res.json(pedido);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const pedido = await query('SELECT v.*,p.registrado_en,p.motivo_registro,p.registro_manual FROM vw_pedidos_con_estado v JOIN pedidos p ON p.id=v.id WHERE v.id = $1 AND v.sucursal_id = $2', [req.params.id, req.sucursalId]);
  if (pedido.rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
  if (req.auth.tipo === 'cliente' && pedido.rows[0].cliente_id !== req.auth.id) {
    throw new ApiError(403, 'No puedes ver un pedido que no es tuyo.');
  }
  const items = await query(
    `SELECT pi.*, COALESCE(pi.concepto_libre,pr.nombre) AS producto_nombre, pr.icono, pi.estacion_preparacion AS estacion,
       ot.etiqueta AS tamano_etiqueta, ol.etiqueta AS leche_etiqueta, oc.etiqueta AS cafe_etiqueta,
       COALESCE((SELECT json_agg(oe.etiqueta) FROM pedido_item_extras pie JOIN opciones_extra oe ON oe.id=pie.extra_id WHERE pie.pedido_item_id=pi.id), '[]') AS extras
     FROM pedido_items pi LEFT JOIN productos pr ON pr.id = pi.producto_id
     LEFT JOIN opciones_tamano ot ON ot.id=pi.tamano_id
     LEFT JOIN opciones_leche ol ON ol.id=pi.leche_id
     LEFT JOIN opciones_cafe oc ON oc.id=pi.cafe_id
     WHERE pi.pedido_id = $1 ORDER BY pi.creado_en`,
    [req.params.id]
  );
  res.json({ ...pedido.rows[0], items: items.rows });
}));

// Confirma el cobro de un pedido en línea (o el registro de un regalo entregado).
// Aquí — y solo aquí — el trigger de la base de datos acredita el punto de
// fidelidad, nunca al crear el pedido.
router.patch('/:id/cobrar', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const { metodoPago, montoRecibido, importeEfectivo, motivoCortesia, totalEsperado } = req.body;
  const metodo = metodoPago || 'efectivo';
  if (!METODOS_PAGO.includes(metodo)) throw new ApiError(400, 'Método de pago inválido.');
  const resultado = await withTransaction(async client => {
    const actual = await client.query('SELECT total, cobrado, es_regalo_fidelidad, cancelado, no_show, cancelacion_estado FROM pedidos WHERE id = $1 AND sucursal_id = $2 FOR UPDATE', [req.params.id, req.sucursalId]);
    if (actual.rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
    if (actual.rows[0].cobrado) throw new ApiError(409, 'Este pedido ya estaba cobrado.');
    if (actual.rows[0].cancelado || actual.rows[0].no_show || actual.rows[0].cancelacion_estado === 'pendiente') throw new ApiError(409, 'El ticket está cancelado, no recogido o pendiente de cancelación.');
    if (totalEsperado !== undefined && (!Number.isFinite(Number(totalEsperado)) || Number(totalEsperado) !== Number(actual.rows[0].total))) {
      throw new ApiError(409, 'El total cambió. Regresa al ticket y revisa el importe antes de cobrar.');
    }


    // Cortesía sobre un pedido en línea: el total pasa a $0 (el subtotal
    // conserva el valor de lo entregado) y aplica el mismo cupo mensual.
    const esCortesia = metodo === 'cortesia';
    if (esCortesia && actual.rows[0].es_regalo_fidelidad) throw new ApiError(400, 'Una recompensa de fidelidad ya es gratis; no se registra como cortesía.');
    const cortesia = esCortesia ? await resolverCortesia(client, { auth: req.auth, sucursalId: req.sucursalId, motivo: motivoCortesia }) : null;
    const total = esCortesia ? 0 : Number(actual.rows[0].total);
    const cambio = total > 0 && montoRecibido !== undefined ? Math.round((montoRecibido - total) * 100) / 100 : null;
    const { rows } = await client.query(
      `UPDATE pedidos SET cobrado = true, metodo_pago = $1, monto_recibido = $2, cambio = $3, importe_efectivo = $6,
          total = $7, cortesia_estado = $8, cortesia_motivo = $9, cortesia_resuelta_por = $10, cortesia_resuelta_en = $11
       WHERE id = $4 AND sucursal_id = $5 AND NOT cobrado RETURNING *`,
      [metodo, esCortesia ? null : (montoRecibido || null), cambio, req.params.id, req.sucursalId, cashPart(metodo, total, importeEfectivo),
        total, cortesia ? cortesia.estado : null, cortesia ? cortesia.motivo : null, cortesia ? cortesia.resueltaPor : null, cortesia ? cortesia.resueltaEn : null]
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
