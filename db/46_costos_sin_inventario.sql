-- Costos de insumos ya consumidos: registro monetario, sin entradas ni salidas
-- de almacén. Las regularizaciones anteriores conservan su tratamiento.
BEGIN;
ALTER TABLE regularizacion_costo_items
  ADD COLUMN modo TEXT NOT NULL DEFAULT 'inventario' CHECK (modo IN ('inventario','solo_costo')),
  ADD COLUMN revertido_en TIMESTAMPTZ,
  ADD COLUMN revertido_por UUID REFERENCES usuarios(id),
  ADD COLUMN motivo_reversion TEXT;
GRANT UPDATE (revertido_en, revertido_por, motivo_reversion) ON regularizacion_costo_items TO cafeteria_app;

-- Una cancelación con devolución revierte el costo una sola vez. Solo los
-- movimientos físicos existentes devuelven stock; nunca se inventa mercancía.
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
  UPDATE regularizacion_costo_items rc
  SET revertido_en=now(), revertido_por=p_usuario_id,
      motivo_reversion=COALESCE(p_motivo,'Cancelación con devolución')
  FROM pedido_items pi
  WHERE pi.id=rc.pedido_item_id AND pi.id = p_item_id
    AND rc.modo='solo_costo' AND rc.revertido_en IS NULL;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_revertir_consumo_pedido(p_pedido_id UUID, p_usuario_id UUID, p_motivo TEXT)
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
    WHERE pi.pedido_id = p_pedido_id AND mi.tipo = 'consumo' AND mi.cantidad < 0
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
  UPDATE regularizacion_costo_items rc
  SET revertido_en=now(), revertido_por=p_usuario_id,
      motivo_reversion=COALESCE(p_motivo,'Cancelación con devolución')
  FROM pedido_items pi
  WHERE pi.id=rc.pedido_item_id AND pi.pedido_id = p_pedido_id
    AND rc.modo='solo_costo' AND rc.revertido_en IS NULL;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql;

-- El costo monetario congelado sustituye los consumos que estaban en cero.
-- No se revaloriza ni duplica si después cambia el costo de referencia/lote.
CREATE OR REPLACE VIEW vw_costo_real_por_venta AS
SELECT p.sucursal_id, pi.id AS pedido_item_id, pi.pedido_id,
  COALESCE(pi.concepto_libre,pr.nombre) AS producto,
  pi.precio_unitario*pi.cantidad AS precio_cobrado,
  CASE WHEN rc.modo='solo_costo' THEN CASE WHEN rc.revertido_en IS NULL THEN rc.costo_agregado ELSE 0 END
    ELSE SUM(-mi.cantidad*COALESCE(mi.costo_unitario,l.costo_total/NULLIF(fn_convertir_unidad(l.cantidad_comprada,l.unidad,mp.unidad),0),mp.costo_unitario)) END AS costo_real,
  pi.precio_unitario*pi.cantidad -
    CASE WHEN rc.modo='solo_costo' THEN CASE WHEN rc.revertido_en IS NULL THEN rc.costo_agregado ELSE 0 END
    ELSE SUM(-mi.cantidad*COALESCE(mi.costo_unitario,l.costo_total/NULLIF(fn_convertir_unidad(l.cantidad_comprada,l.unidad,mp.unidad),0),mp.costo_unitario)) END AS utilidad_real
FROM pedido_items pi JOIN pedidos p ON p.id=pi.pedido_id LEFT JOIN productos pr ON pr.id=pi.producto_id
LEFT JOIN movimientos_inventario mi ON mi.pedido_item_id=pi.id AND mi.tipo='consumo'
  AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id=mi.id)
LEFT JOIN materias_primas mp ON mp.id=mi.materia_prima_id LEFT JOIN lotes l ON l.id=mi.lote_id
LEFT JOIN regularizacion_costo_items rc ON rc.pedido_item_id=pi.id
WHERE pi.estado='terminado'
GROUP BY p.sucursal_id,pi.id,pi.pedido_id,COALESCE(pi.concepto_libre,pr.nombre),pi.precio_unitario,pi.cantidad,rc.pedido_item_id;
COMMIT;
