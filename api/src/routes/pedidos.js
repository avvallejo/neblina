const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { assertPaymentAllowed, normalizeDiscount, assertDiscountRole } = require('../security/policies');
const { createDiscountApproval, consumeDiscountApproval } = require('../services/discountApprovals');
const { prepareOrderLines } = require('../services/orderValidation');

const router = express.Router();
router.use(requireAuth); // tanto personal como cliente pueden crear/ver pedidos

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
    { requesterId: req.auth.id, pin: req.body.pin, discount },
    client.query.bind(client)
  ));
  if (approval.denied) throw new ApiError(401, 'No se pudo autorizar el descuento.');
  res.status(201).json({ token: approval.token, expiresInSeconds: approval.expiresInSeconds });
}));

// POST /api/pedidos
// body: { items: [{ productoId, tamanoId?, lecheId?, cafeId?, extraIds?, cantidad?, notas?, esRegalo? }],
//         horaRecogida?, descuentoPorcentaje?, autorizacionDescuento?, pago?: { metodoPago, montoRecibido } }
router.post('/', asyncHandler(async (req, res) => {
  const { items, horaRecogida, descuentoPorcentaje, autorizacionDescuento, pinAutorizacion, pago, clienteTelefono } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'El pedido necesita al menos un producto.');
  if (pinAutorizacion !== undefined) throw new ApiError(400, 'Usa una autorización de descuento de un solo uso.');

  const esStaff = req.auth.tipo === 'staff';
  const origen = esStaff ? 'mostrador' : 'app';
  assertPaymentAllowed(req.auth, pago);
  const descuentoFinal = normalizeDiscount(descuentoPorcentaje);
  if (descuentoFinal) assertDiscountRole(req.auth);

  const resultado = await withTransaction(async client => {
    let clienteId = req.auth.tipo === 'cliente' ? req.auth.id : null;
    if (esStaff && clienteTelefono) {
      const c = await client.query('SELECT id FROM clientes WHERE telefono = $1', [String(clienteTelefono).replace(/\D/g, '')]);
      if (c.rows.length > 0) clienteId = c.rows[0].id;
    }

    const { lines: lineas, isRewardOrder: esRegaloPedido } = await prepareOrderLines(client, items, clienteId);
    if (esRegaloPedido && descuentoFinal) throw new ApiError(400, 'No se puede aplicar descuento a una recompensa.');

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
    const total = Math.round((subtotal * (1 - descuentoFinal / 100)) * 100) / 100;
    const cobradoInicial = !!pago;
    const pedidoRes = await client.query(
      `INSERT INTO pedidos (turno_id, origen, cliente_id, cajero_id, hora_recogida, subtotal,
          descuento_porcentaje, descuento_autorizado_por, total, metodo_pago, monto_recibido, cambio,
          cobrado, es_regalo_fidelidad)
       VALUES (NULL, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [origen, clienteId, esStaff && ['cajero', 'admin'].includes(req.auth.rol) ? req.auth.id : null, horaRecogida || null, subtotal,
        descuentoFinal, autorizadoPor, total,
        cobradoInicial ? pago.metodoPago : null, cobradoInicial ? pago.montoRecibido : null,
        cobradoInicial && pago.montoRecibido ? Math.round((pago.montoRecibido - total) * 100) / 100 : null,
        cobradoInicial, esRegaloPedido]
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
    return { pedido, items: itemsCreados };
  });

  res.status(201).json(resultado);
}));

router.get('/', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  // Se agregan nombre del cliente y conteo de items para que la pantalla de
  // Caja muestre "N producto(s) — Nombre" sin pedir cada pedido por separado.
  const { rows } = await query(
    `SELECT v.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
            (SELECT COUNT(*) FROM pedido_items pi WHERE pi.pedido_id = v.id) AS num_items
     FROM vw_pedidos_con_estado v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     ORDER BY v.creado_en DESC LIMIT 200`
  );
  res.json(rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const pedido = await query('SELECT * FROM vw_pedidos_con_estado WHERE id = $1', [req.params.id]);
  if (pedido.rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
  if (req.auth.tipo === 'cliente' && pedido.rows[0].cliente_id !== req.auth.id) {
    throw new ApiError(403, 'No puedes ver un pedido que no es tuyo.');
  }
  const items = await query(
    `SELECT pi.*, pr.nombre AS producto_nombre, pr.icono
     FROM pedido_items pi JOIN productos pr ON pr.id = pi.producto_id
     WHERE pi.pedido_id = $1 ORDER BY pi.creado_en`,
    [req.params.id]
  );
  res.json({ ...pedido.rows[0], items: items.rows });
}));

// Confirma el cobro de un pedido en línea (o el registro de un regalo entregado).
// Aquí — y solo aquí — el trigger de la base de datos acredita el punto de
// fidelidad, nunca al crear el pedido.
router.patch('/:id/cobrar', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const { metodoPago, montoRecibido } = req.body;
  const actual = await query('SELECT total, cobrado FROM pedidos WHERE id = $1', [req.params.id]);
  if (actual.rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
  if (actual.rows[0].cobrado) throw new ApiError(409, 'Este pedido ya estaba cobrado.');

  const total = Number(actual.rows[0].total);
  const cambio = total > 0 && montoRecibido !== undefined ? Math.round((montoRecibido - total) * 100) / 100 : null;
  const { rows } = await query(
    `UPDATE pedidos SET cobrado = true, metodo_pago = $1, monto_recibido = $2, cambio = $3 WHERE id = $4 RETURNING *`,
    [metodoPago || 'efectivo', montoRecibido || null, cambio, req.params.id]
  );
  res.json(rows[0]);
}));

// Cancelar un pedido. Lo permite el CLIENTE (solo el suyo), el BARISTA, la CAJA
// y el ADMIN, pero SOLO si la preparación no ha iniciado (ningún ítem dejó de
// estar 'pendiente'). Si ya inició, se rechaza: para lo ya preparado y no
// recogido está el flujo de no-show, no la cancelación.
router.patch('/:id/cancelar', asyncHandler(async (req, res) => {
  if (req.auth.tipo === 'staff' && !['barista', 'cajero', 'admin'].includes(req.auth.rol)) {
    throw new ApiError(403, 'No autorizado para cancelar pedidos.');
  }
  await withTransaction(async client => {
    const ped = await client.query('SELECT cliente_id, cancelado FROM pedidos WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (ped.rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
    // El cliente solo puede cancelar SU propio pedido.
    if (req.auth.tipo === 'cliente' && ped.rows[0].cliente_id !== req.auth.id) {
      throw new ApiError(403, 'No puedes cancelar un pedido que no es tuyo.');
    }
    if (ped.rows[0].cancelado) return; // idempotente: ya estaba cancelado

    // La preparación "inició" en cuanto algún ítem deja de estar 'pendiente'.
    const iniciado = await client.query(
      "SELECT 1 FROM pedido_items WHERE pedido_id = $1 AND estado <> 'pendiente' LIMIT 1",
      [req.params.id]
    );
    if (iniciado.rows.length > 0) throw new ApiError(409, 'No se puede cancelar: la preparación ya inició.');

    await client.query('UPDATE pedidos SET cancelado = true WHERE id = $1', [req.params.id]);
    await client.query("UPDATE pedido_items SET estado = 'cancelado' WHERE pedido_id = $1", [req.params.id]);
  });
  res.json({ ok: true });
}));

// El cliente nunca pasó por un pedido ya listo: el trigger de la base de
// datos resta el punto de fidelidad. La merma de lo ya preparado se reporta
// vía pedidos.no_show en los reportes (los insumos ya se descontaron al
// terminar la bebida, así que no se vuelve a descontar aquí).
router.patch('/:id/no-show', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('UPDATE pedidos SET no_show = true WHERE id = $1 RETURNING *', [req.params.id]);
  if (rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
  res.json(rows[0]);
}));

module.exports = router;
