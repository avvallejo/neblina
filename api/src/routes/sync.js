const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { prepareOrderLines } = require('../services/orderValidation');

const router = express.Router();
router.use(requireAuth);

// El dispositivo (Caja, Barista o la app del Cliente) guarda sus acciones en
// una cola local mientras está sin internet, cada una con un client_uuid que
// el propio dispositivo genera. Al recuperar conexión, manda TODA la cola en
// una sola petición, EN EL MISMO ORDEN en que pasaron — así, si un pedido y el
// "terminar" de su ticket se hicieron ambos sin conexión, el pedido llega
// primero en el arreglo y su id ya está disponible para el resto del lote.
//
// Cada operación es idempotente por client_uuid: si la red falla justo
// después de que el servidor procesó algo pero antes de que la respuesta
// llegara al dispositivo, reenviar el mismo lote no duplica nada — se
// reconoce el client_uuid y se regresa el registro que ya existía.
router.post('/batch', asyncHandler(async (req, res) => {
  const { operaciones, dispositivo } = req.body;
  if (!Array.isArray(operaciones) || operaciones.length === 0) {
    throw new ApiError(400, 'Manda al menos una operación en "operaciones".');
  }

  const idMap = {}; // client_uuid -> id real en el servidor, para resolver dependencias DENTRO del mismo lote
  const resultados = [];
  let ok = 0;
  let conError = 0;

  for (const op of operaciones) {
    try {
      let resultado;
      switch (op.tipo) {
        case 'crear_pedido':
          resultado = await procesarCrearPedido(op, req.auth, idMap);
          break;
        case 'actualizar_item':
          resultado = await procesarActualizarItem(op, req.auth, idMap);
          break;
        case 'crear_merma':
          resultado = await procesarCrearMerma(op, req.auth, idMap);
          break;
        default:
          throw new ApiError(400, `Tipo de operación desconocido: "${op.tipo}".`);
      }
      if (resultado.id) idMap[op.clientUuid] = resultado.id;
      resultados.push({ clientUuid: op.clientUuid, estado: resultado.yaExistia ? 'ya_existia' : 'creado', servidorId: resultado.id });
      ok += 1;
    } catch (err) {
      // Un error en UNA operación del lote no debe tirar las demás — cada
      // una se reporta por separado para que el dispositivo sepa cuáles
      // puede quitar de su cola local y cuáles debe reintentar o revisar.
      resultados.push({ clientUuid: op.clientUuid, estado: 'error', error: err.message || 'Error al procesar la operación.' });
      conError += 1;
    }
  }

  await query(
    `INSERT INTO lotes_sincronizacion (usuario_id, cliente_id, dispositivo, operaciones_total, operaciones_ok, operaciones_error, detalle)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      req.auth.tipo === 'staff' ? req.auth.id : null,
      req.auth.tipo === 'cliente' ? req.auth.id : null,
      dispositivo || null,
      operaciones.length, ok, conError,
      JSON.stringify(resultados),
    ]
  );

  res.json({ resultados });
}));

async function procesarCrearPedido(op, auth, idMap) {
  const { items, horaRecogida, timestampOriginal, clienteTelefono } = op.payload || {};
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'El pedido necesita al menos un producto.');

  // El pedido pasó EN REALIDAD mientras el dispositivo estaba sin conexión —
  // el turno al que pertenece es el que estaba abierto EN ESE MOMENTO, no el
  // que esté abierto ahora que por fin sincroniza (pueden ser turnos
  // distintos si ya cerraron caja entre que se vendió y se sincronizó).
  const fechaReal = timestampOriginal ? new Date(timestampOriginal) : new Date();
  if (Number.isNaN(fechaReal.getTime())) throw new ApiError(400, 'timestampOriginal inválido.');

  return withTransaction(async client => {
    const existente = await client.query('SELECT id FROM pedidos WHERE client_uuid = $1 FOR UPDATE', [op.clientUuid]);
    if (existente.rows.length > 0) return { id: existente.rows[0].id, yaExistia: true };

    const esStaff = auth.tipo === 'staff';
    const origen = esStaff ? 'mostrador' : 'app';
    let clienteId = auth.tipo === 'cliente' ? auth.id : null;
    if (esStaff && clienteTelefono) {
      const c = await client.query('SELECT id FROM clientes WHERE telefono = $1', [String(clienteTelefono).replace(/\D/g, '')]);
      if (c.rows.length > 0) clienteId = c.rows[0].id;
    }

    const { lines: lineas, isRewardOrder } = await prepareOrderLines(client, items, clienteId);
    const total = lineas.reduce((sum, line) => sum + line.precioUnitario * line.cantidad, 0);
    const turnoHistorico = await client.query(
      'SELECT id FROM turnos WHERE abierto_en <= $1 AND (cerrado_en IS NULL OR cerrado_en >= $1) ORDER BY abierto_en DESC LIMIT 1',
      [fechaReal]
    );
    const pedidoRes = await client.query(
      `INSERT INTO pedidos
         (turno_id, origen, cliente_id, cajero_id, hora_recogida, subtotal, total, cobrado,
          es_regalo_fidelidad, client_uuid, creado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$6,false,$7,$8,$9) RETURNING id`,
      [turnoHistorico.rows[0]?.id || null, origen, clienteId,
        esStaff && ['cajero', 'admin'].includes(auth.rol) ? auth.id : null,
        horaRecogida || null, total, isRewardOrder, op.clientUuid, fechaReal]
    );
    const pedidoId = pedidoRes.rows[0].id;

    for (const l of lineas) {
      // eslint-disable-next-line no-await-in-loop
      const itemRes = await client.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, tamano_id, leche_id, cafe_id, cantidad, precio_unitario, notas, es_regalo, client_uuid, creado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [pedidoId, l.productoId, l.tamanoId || null, l.lecheId || null, l.cafeId || null, l.cantidad, l.precioUnitario, l.notas || null, l.esRegalo, l.clientUuid || null, fechaReal]
      );
      const itemId = itemRes.rows[0].id;
      for (const extraId of l.extraIds || []) {
        // eslint-disable-next-line no-await-in-loop
        await client.query('INSERT INTO pedido_item_extras (pedido_item_id, extra_id) VALUES ($1,$2)', [itemId, extraId]);
      }
      if (l.clientUuid) idMap[l.clientUuid] = itemId; // para que "actualizar_item" del mismo lote lo encuentre
    }
    return { id: pedidoId, yaExistia: false };
  });
}

const ORDEN_ESTADO = { pendiente: 0, en_preparacion: 1, terminado: 2 };

async function procesarActualizarItem(op, auth, idMap) {
  if (auth.tipo !== 'staff') throw new ApiError(403, 'Solo el personal puede actualizar el estado de un ticket.');
  const { itemClientUuid, nuevoEstado } = op.payload || {};
  if (!Object.prototype.hasOwnProperty.call(ORDEN_ESTADO, nuevoEstado) || nuevoEstado === 'pendiente') {
    throw new ApiError(400, 'nuevoEstado inválido.');
  }

  let itemId = idMap[itemClientUuid];
  if (!itemId) {
    const buscado = await query('SELECT id, estado FROM pedido_items WHERE client_uuid = $1', [itemClientUuid]);
    if (buscado.rows.length === 0) throw new ApiError(404, `No se encontró el ticket con clientUuid ${itemClientUuid} (¿llegó antes su "crear_pedido" en el lote?).`);
    itemId = buscado.rows[0].id;
  }

  const actual = await query('SELECT estado FROM pedido_items WHERE id = $1', [itemId]);
  const estadoActual = actual.rows[0].estado;

  // Idempotente Y resistente a reproducir el lote fuera de orden: si el
  // ticket ya está EN o MÁS ALLÁ del estado pedido (ej. llega un "iniciar"
  // viejo después de que ya se sincronizó el "terminar"), se reconoce como ya
  // satisfecho y NUNCA se retrocede — retroceder es lo que volvía a disparar
  // el descuento de inventario una segunda vez al re-avanzar a "terminado".
  if (estadoActual === 'cancelado' || ORDEN_ESTADO[estadoActual] >= ORDEN_ESTADO[nuevoEstado]) {
    return { id: itemId, yaExistia: true };
  }

  const columnaFecha = nuevoEstado === 'en_preparacion' ? 'iniciado_en' : 'terminado_en';
  const { rows } = await query(
    `UPDATE pedido_items SET estado = $1, ${columnaFecha} = now(), barista_id = COALESCE(barista_id, $2) WHERE id = $3 RETURNING id`,
    [nuevoEstado, auth.tipo === 'staff' ? auth.id : null, itemId]
  );
  return { id: rows[0].id, yaExistia: false };
}

async function procesarCrearMerma(op, auth, idMap) {
  if (auth.tipo !== 'staff') throw new ApiError(403, 'Solo el personal puede registrar mermas.');
  const existente = await query('SELECT id FROM mermas WHERE client_uuid = $1', [op.clientUuid]);
  if (existente.rows.length > 0) return { id: existente.rows[0].id, yaExistia: true };

  const { materiaPrimaId, cantidad, unidad, motivo, pedidoItemClientUuid, observacion } = op.payload || {};
  if (!materiaPrimaId || !cantidad || !motivo) throw new ApiError(400, 'Falta materiaPrimaId, cantidad o motivo.');

  let pedidoItemId = pedidoItemClientUuid ? idMap[pedidoItemClientUuid] : null;
  if (pedidoItemClientUuid && !pedidoItemId) {
    const buscado = await query('SELECT id FROM pedido_items WHERE client_uuid = $1', [pedidoItemClientUuid]);
    pedidoItemId = buscado.rows[0]?.id || null;
  }

  const { rows } = await query(
    `INSERT INTO mermas (materia_prima_id, cantidad, unidad, motivo, pedido_item_id, usuario_id, observacion, client_uuid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [materiaPrimaId, cantidad, unidad, motivo, pedidoItemId, auth.tipo === 'staff' ? auth.id : null, observacion || null, op.clientUuid]
  );
  return { id: rows[0].id, yaExistia: false };
}

module.exports = router;
