const express = require('express');
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { calcularPrecioItem } = require('../utils/pricing');

const router = express.Router();
router.use(requireAuth); // tanto personal como cliente pueden crear/ver pedidos

// POST /api/pedidos
// body: { items: [{ productoId, tamanoId?, lecheId?, cafeId?, extraIds?, cantidad?, notas?, esRegalo? }],
//         horaRecogida?, descuentoPorcentaje?, pinAutorizacion?, pago?: { metodoPago, montoRecibido } }
router.post('/', asyncHandler(async (req, res) => {
  const { items, horaRecogida, descuentoPorcentaje, pinAutorizacion, pago, clienteTelefono } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'El pedido necesita al menos un producto.');

  const esStaff = req.auth.tipo === 'staff';
  const origen = esStaff ? 'mostrador' : 'app';
  let clienteId = req.auth.tipo === 'cliente' ? req.auth.id : null;

  // Caja también puede registrar la venta a nombre de un cliente con cuenta
  // (para que el pedido cuente hacia su fidelidad aunque lo levante el cajero).
  if (esStaff && clienteTelefono) {
    const c = await query('SELECT id FROM clientes WHERE telefono = $1', [String(clienteTelefono).replace(/\D/g, '')]);
    if (c.rows.length > 0) clienteId = c.rows[0].id;
  }

  const esRegaloGlobal = items.every(i => i.esRegalo);
  if (esRegaloGlobal && !clienteId) throw new ApiError(400, 'Un regalo de fidelidad necesita un cliente.');

  // Descuento: solo cajero/admin, y un cajero necesita el PIN de un admin
  // activo (equivalente al "código de autorización" del prototipo).
  let descuentoFinal = 0;
  let autorizadoPor = null;
  if (descuentoPorcentaje) {
    if (!esStaff) throw new ApiError(403, 'Solo el personal puede aplicar descuentos.');
    if (req.auth.rol === 'admin') {
      autorizadoPor = req.auth.id;
    } else {
      if (!pinAutorizacion) throw new ApiError(400, 'El descuento requiere el PIN de un administrador.');
      const admins = await query("SELECT id, pin_hash FROM usuarios WHERE rol = 'admin' AND activo");
      for (const a of admins.rows) {
        // eslint-disable-next-line no-await-in-loop
        if (await bcrypt.compare(pinAutorizacion, a.pin_hash)) { autorizadoPor = a.id; break; }
      }
      if (!autorizadoPor) throw new ApiError(401, 'PIN de autorización incorrecto.');
    }
    descuentoFinal = Number(descuentoPorcentaje);
  }

  // Cada línea se recalcula en el servidor — nunca se usa el precio que vino
  // en el body del cliente.
  const lineas = [];
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    const precioUnitario = await calcularPrecioItem({
      productoId: item.productoId, tamanoId: item.tamanoId, lecheId: item.lecheId,
      cafeId: item.cafeId, extraIds: item.extraIds || [], esRegalo: !!item.esRegalo,
    });
    lineas.push({ ...item, precioUnitario, cantidad: item.cantidad || 1 });
  }

  const subtotal = lineas.reduce((s, l) => s + l.precioUnitario * l.cantidad, 0);
  const total = Math.round((subtotal * (1 - descuentoFinal / 100)) * 100) / 100;

  const cobradoInicial = esStaff && !!pago; // venta de mostrador con pago en el momento
  const esRegaloPedido = esRegaloGlobal;

  const resultado = await withTransaction(async client => {
    const pedidoRes = await client.query(
      `INSERT INTO pedidos (turno_id, origen, cliente_id, cajero_id, hora_recogida, subtotal,
          descuento_porcentaje, descuento_autorizado_por, total, metodo_pago, monto_recibido, cambio,
          cobrado, es_regalo_fidelidad)
       VALUES (NULL, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [origen, clienteId, esStaff ? req.auth.id : null, horaRecogida || null, subtotal,
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
        [pedido.id, l.productoId, l.tamanoId || null, l.lecheId || null, l.cafeId || null, l.cantidad, l.precioUnitario, l.notas || null, !!l.esRegalo]
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

router.patch('/:id/cancelar', requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  await withTransaction(async client => {
    const r = await client.query('UPDATE pedidos SET cancelado = true WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) throw new ApiError(404, 'Pedido no encontrado.');
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
