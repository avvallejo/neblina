const express = require('express');
const { query, withTransaction } = require('../db');
const { prepareBatch } = require('../services/preparationBatch');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const { estacionesDe, ESTACIONES_USUARIO } = require('../services/stations');

const router = express.Router();
router.use(requireAuth, requireRole('barista', 'admin'), resolveSucursal);

// Cola por llegada de cada línea, incluidas las agregadas después a un ticket.
// Cada quien ve SOLO su estación (barista → barra, parrillero → parrilla; con
// ambas ve todo). ?estacion=barra|parrilla acota aún más (p. ej. un admin).
router.get('/cola', asyncHandler(async (req, res) => {
  let estaciones = await estacionesDe(query, req.auth);
  if (req.query.estacion) {
    if (!ESTACIONES_USUARIO.includes(req.query.estacion)) throw new ApiError(400, 'Estación inválida.');
    estaciones = estaciones.filter(e => e === req.query.estacion);
  }
  const { rows } = await query(
    `SELECT pi.*, pr.nombre AS producto_nombre, pr.icono, pr.tipo AS producto_tipo, pr.es_frio, pi.estacion_preparacion AS estacion,
            p.destino, p.mesa_numero, p.nombre_ticket, u.nombre AS levantado_por_nombre, fin.nombre AS terminado_por_nombre,
            ot.codigo AS tamano_codigo, ot.etiqueta AS tamano_etiqueta,
            ol.codigo AS leche_codigo, ol.etiqueta AS leche_etiqueta,
            oc.codigo AS cafe_codigo, oc.etiqueta AS cafe_etiqueta,
            p.origen, p.hora_recogida, p.creado_en AS pedido_creado_en, p.folio,
            c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
            COALESCE(json_agg(json_build_object('codigo', oe.codigo, 'etiqueta', oe.etiqueta)) FILTER (WHERE oe.id IS NOT NULL), '[]') AS extras
     FROM pedido_items pi
     JOIN productos pr ON pr.id = pi.producto_id
     JOIN pedidos p ON p.id = pi.pedido_id
     LEFT JOIN opciones_tamano ot ON ot.id = pi.tamano_id
     LEFT JOIN opciones_leche ol ON ol.id = pi.leche_id
     LEFT JOIN opciones_cafe oc ON oc.id = pi.cafe_id
     LEFT JOIN usuarios fin ON fin.id = pi.terminado_por
     LEFT JOIN usuarios u ON u.id = p.cajero_id
     LEFT JOIN clientes c ON c.id = p.cliente_id
     LEFT JOIN pedido_item_extras pie ON pie.pedido_item_id = pi.id
     LEFT JOIN opciones_extra oe ON oe.id = pie.extra_id
     WHERE pi.estado IN ('pendiente', 'en_preparacion', 'terminado')
       AND NOT p.cancelado AND NOT p.no_show
       AND p.sucursal_id = $1 AND pi.estacion_preparacion = ANY($2)
       AND EXISTS (
         SELECT 1 FROM pedido_items visible
         WHERE visible.pedido_id=p.id AND visible.estacion_preparacion=ANY($2)
           AND (visible.estado IN ('pendiente','en_preparacion') OR
             (visible.estado='terminado' AND visible.terminado_en >= date_trunc('day', now() AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'America/Mexico_City'))
       )
     GROUP BY pi.id, pr.nombre, pr.icono, pr.tipo, pr.es_frio, p.destino, p.mesa_numero, p.nombre_ticket, u.nombre, fin.nombre, ot.codigo, ot.etiqueta,
              ol.codigo, ol.etiqueta, oc.codigo, oc.etiqueta, p.origen, p.hora_recogida, p.creado_en, p.folio,
              c.nombre, c.apellido
     ORDER BY pi.creado_en, pi.id`,
    [req.sucursalId, estaciones]
  );
  res.json(rows);
}));

router.patch('/pedido/:orderId/:action', asyncHandler(async (req, res) => {
  const rows = await withTransaction(client => prepareBatch(client, {
    auth: req.auth, sucursalId: req.sucursalId, orderId: req.params.orderId,
    action: req.params.action, estacion: req.body.estacion, itemIds: req.body.itemIds,
  }));
  res.json(rows);
}));

async function explicarRechazo(req, estaciones, fallback) {
  const { rows: [item] } = await query(`SELECT pi.estacion_preparacion FROM pedido_items pi
    JOIN pedidos p ON p.id=pi.pedido_id WHERE pi.id=$1 AND p.sucursal_id=$2`,[req.params.id,req.sucursalId]);
  if (!item) throw new ApiError(404,'Producto de comanda no encontrado.');
  if (!estaciones.includes(item.estacion_preparacion)) throw new ApiError(403,'Este producto pertenece a otra estación. Actualiza tu comanda.');
  throw new ApiError(409,fallback);
}

router.patch('/:id/iniciar', asyncHandler(async (req, res) => {
  const estaciones = await estacionesDe(query, req.auth);
  const { rows } = await query(
    `UPDATE pedido_items SET estado = 'en_preparacion', iniciado_en = now(), barista_id = $1
     WHERE id = $2 AND estado = 'pendiente'
       AND EXISTS (SELECT 1 FROM pedidos p WHERE p.id = pedido_items.pedido_id AND p.sucursal_id = $3)
       AND estacion_preparacion = ANY($4::text[])
     RETURNING *`,
    [req.auth.id, req.params.id, req.sucursalId, estaciones]
  );
  if (rows.length === 0) await explicarRechazo(req, estaciones, 'Este producto ya no está pendiente. Actualiza la comanda.');
  res.json(rows[0]);
}));

// Al marcar 'terminado', el trigger fn_descontar_inventario hace TODO el
// descuento de insumos (café, leche, vaso, tapa, fijos, extras) con PEPS si
// aplica. Este endpoint no calcula nada de inventario — esa es justo la idea
// de tenerlo en la base de datos: no se puede "olvidar" descontar.
router.patch('/:id/terminar', asyncHandler(async (req, res) => {
  const estaciones = await estacionesDe(query, req.auth);
  const { rows } = await query(
    `UPDATE pedido_items SET estado = 'terminado', terminado_en = now(), terminado_por = $1, barista_id = COALESCE(barista_id, $1)
     WHERE id = $2 AND estado IN ('pendiente', 'en_preparacion')
       AND EXISTS (SELECT 1 FROM pedidos p WHERE p.id = pedido_items.pedido_id AND p.sucursal_id = $3)
       AND estacion_preparacion = ANY($4::text[])
     RETURNING *`,
    [req.auth.id, req.params.id, req.sucursalId, estaciones]
  );
  if (rows.length === 0) await explicarRechazo(req, estaciones, 'Este producto ya no puede terminarse desde su estado actual. Actualiza la comanda.');
  res.json(rows[0]);
}));

module.exports = router;
