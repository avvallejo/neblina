const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('barista', 'admin'), resolveSucursal);

// Cola del barista, ordenada por urgencia real: lo inmediato primero, lo
// programado después según su hora de recogida (misma lógica que el prototipo).
router.get('/cola', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT pi.*, pr.nombre AS producto_nombre, pr.icono, pr.tipo AS producto_tipo, pr.es_frio,
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
     LEFT JOIN clientes c ON c.id = p.cliente_id
     LEFT JOIN pedido_item_extras pie ON pie.pedido_item_id = pi.id
     LEFT JOIN opciones_extra oe ON oe.id = pie.extra_id
     WHERE pi.estado IN ('pendiente', 'en_preparacion') AND p.sucursal_id = $1
     GROUP BY pi.id, pr.nombre, pr.icono, pr.tipo, pr.es_frio, ot.codigo, ot.etiqueta,
              ol.codigo, ol.etiqueta, oc.codigo, oc.etiqueta, p.origen, p.hora_recogida, p.creado_en, p.folio,
              c.nombre, c.apellido
     ORDER BY COALESCE(p.hora_recogida, pi.creado_en)`,
    [req.sucursalId]
  );
  res.json(rows);
}));

router.patch('/:id/iniciar', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE pedido_items SET estado = 'en_preparacion', iniciado_en = now(), barista_id = $1
     WHERE id = $2 AND estado = 'pendiente'
       AND EXISTS (SELECT 1 FROM pedidos p WHERE p.id = pedido_items.pedido_id AND p.sucursal_id = $3)
     RETURNING *`,
    [req.auth.id, req.params.id, req.sucursalId]
  );
  if (rows.length === 0) throw new ApiError(409, 'El ticket no está pendiente (¿ya se inició o no existe?).');
  res.json(rows[0]);
}));

// Al marcar 'terminado', el trigger fn_descontar_inventario hace TODO el
// descuento de insumos (café, leche, vaso, tapa, fijos, extras) con PEPS si
// aplica. Este endpoint no calcula nada de inventario — esa es justo la idea
// de tenerlo en la base de datos: no se puede "olvidar" descontar.
router.patch('/:id/terminar', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE pedido_items SET estado = 'terminado', terminado_en = now(), barista_id = COALESCE(barista_id, $1)
     WHERE id = $2 AND estado IN ('pendiente', 'en_preparacion')
       AND EXISTS (SELECT 1 FROM pedidos p WHERE p.id = pedido_items.pedido_id AND p.sucursal_id = $3)
     RETURNING *`,
    [req.auth.id, req.params.id, req.sucursalId]
  );
  if (rows.length === 0) throw new ApiError(409, 'El ticket no se puede terminar desde su estado actual.');
  res.json(rows[0]);
}));

module.exports = router;
