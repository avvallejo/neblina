BEGIN;
CREATE OR REPLACE FUNCTION fn_revertir_consumo_item(p_item_id UUID, p_usuario_id UUID, p_motivo TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_mov       RECORD;
  v_devuelto  NUMERIC;
  v_n         INTEGER := 0;
BEGIN
  FOR v_mov IN
    SELECT mi.id, mi.materia_prima_id, mi.cantidad, mi.lote_id, mi.pedido_item_id, mi.costo_unitario,
           mp.unidad AS unidad_stock, l.unidad AS unidad_lote
    FROM movimientos_inventario mi
    JOIN pedido_items pi ON pi.id = mi.pedido_item_id
    JOIN materias_primas mp ON mp.id = mi.materia_prima_id
    LEFT JOIN lotes l ON l.id = mi.lote_id
    WHERE pi.id = p_item_id AND mi.tipo = 'consumo' AND mi.cantidad < 0
      AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id = mi.id)
    ORDER BY mi.creado_en
  LOOP
    v_devuelto := -v_mov.cantidad;                     -- positivo, en unidad de control
    IF v_mov.lote_id IS NOT NULL THEN
      UPDATE lotes SET cantidad_disponible = LEAST(cantidad_comprada,
        cantidad_disponible + fn_convertir_unidad(v_devuelto, v_mov.unidad_stock, v_mov.unidad_lote))
      WHERE id = v_mov.lote_id;
    END IF;
    UPDATE materias_primas SET stock_actual = stock_actual + v_devuelto WHERE id = v_mov.materia_prima_id;
    INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, pedido_item_id, usuario_id, motivo, costo_unitario, revierte_movimiento_id)
      VALUES (v_mov.materia_prima_id, 'ajuste', v_devuelto, v_mov.lote_id, v_mov.pedido_item_id, p_usuario_id,
              COALESCE(p_motivo, 'Cancelación de ticket autorizada'), v_mov.costo_unitario, v_mov.id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW vw_pedidos_con_estado AS
SELECT p.*,
  CASE
    WHEN p.no_show THEN 'no_show'
    WHEN p.cancelado THEN 'cancelado'
    WHEN COUNT(pi.id) = 0 THEN 'pendiente'
    WHEN COUNT(pi.id) = COUNT(*) FILTER (WHERE pi.estado = 'terminado') THEN (CASE WHEN p.cobrado THEN 'terminado' ELSE 'listo' END)
    WHEN COUNT(*) FILTER (WHERE pi.estado <> 'pendiente' AND pi.estacion_preparacion <> 'caja') > 0 THEN 'en_preparacion'
    ELSE 'pendiente'
  END AS estado
FROM pedidos p
LEFT JOIN pedido_items pi ON pi.pedido_id = p.id AND pi.estado <> 'cancelado'
GROUP BY p.id;
CREATE OR REPLACE VIEW vw_productos_mas_vendidos AS
SELECT p.sucursal_id, pr.id AS producto_id, COALESCE(pi.concepto_libre,pr.nombre) AS nombre, SUM(pi.cantidad) AS unidades_vendidas,
       SUM(pi.cantidad * pi.precio_unitario) AS ingresos
FROM pedido_items pi
JOIN pedidos p ON p.id = pi.pedido_id
LEFT JOIN productos pr ON pr.id = pi.producto_id
WHERE p.cobrado AND NOT p.cancelado AND NOT p.no_show AND pi.estado <> 'cancelado' AND NOT pi.es_regalo
GROUP BY p.sucursal_id, pr.id, COALESCE(pi.concepto_libre,pr.nombre)
ORDER BY unidades_vendidas DESC;

CREATE OR REPLACE VIEW vw_costo_real_por_venta AS
SELECT
  p.sucursal_id,
  pi.id AS pedido_item_id,
  pi.pedido_id,
  COALESCE(pi.concepto_libre,pr.nombre) AS producto,
  pi.precio_unitario * pi.cantidad AS precio_cobrado,
  SUM(mi.cantidad * -1 * COALESCE(l.costo_unitario, mp.costo_unitario)) AS costo_real,
  (pi.precio_unitario * pi.cantidad) - SUM(mi.cantidad * -1 * COALESCE(l.costo_unitario, mp.costo_unitario)) AS utilidad_real
FROM pedido_items pi
JOIN pedidos p ON p.id=pi.pedido_id
LEFT JOIN productos pr ON pr.id = pi.producto_id
LEFT JOIN movimientos_inventario mi ON mi.pedido_item_id = pi.id AND mi.tipo = 'consumo' AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id=mi.id)
LEFT JOIN materias_primas mp ON mp.id = mi.materia_prima_id
LEFT JOIN lotes l ON l.id = mi.lote_id
WHERE pi.estado = 'terminado'
GROUP BY p.sucursal_id, pi.id, pi.pedido_id, COALESCE(pi.concepto_libre,pr.nombre), pi.precio_unitario, pi.cantidad;

COMMIT;
