-- ============================================================================
-- MIGRACIÓN 28 — SNACKS DE REVENTA CON CONTROL DE EXISTENCIAS
-- ============================================================================
-- Un snack "comprado hecho" se liga a un insumo del inventario (en piezas) vía
-- receta_insumos_fijos (una fila: cantidad por venta, normalmente 1). Con eso:
--   * cada venta descuenta el insumo (fn_descontar_inventario ya no ignora
--     snacks: consume SUS insumos fijos y nada más);
--   * su costo es el costo de compra por pieza (fn_costo_teorico_producto), así
--     entra a "Costo y precio", margen y revisión de precios;
--   * la vista de stock bajo dice cuánto PEDIR: reabastecer hasta stock_maximo
--     (si no hay máximo, al menos volver al mínimo).
-- fn_consumir_insumo nunca deja el stock negativo ni bloquea la venta.
-- Requiere 00-27. Re-ejecutable.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION fn_descontar_inventario() RETURNS TRIGGER AS $$
DECLARE
  v_producto      productos%ROWTYPE;
  v_receta        recetas%ROWTYPE;
  v_tiene_shot    BOOLEAN;
  v_shots         INTEGER;
  v_gramaje       NUMERIC;
  v_cafe_materia  UUID;
  v_leche_materia UUID;
  v_leche_ml      NUMERIC;
  v_variante      TEXT;
  v_empaque       RECORD;
  v_fijo          RECORD;
  v_extra         RECORD;
BEGIN
  SELECT * INTO v_producto FROM productos WHERE id = NEW.producto_id;
  SELECT * INTO v_receta FROM recetas WHERE producto_id = NEW.producto_id;

  -- Snack de reventa (comprado hecho): descuenta sus insumos fijos (normalmente
  -- 1 pieza del insumo ligado) y nada más. Sin insumo ligado, no toca inventario.
  IF v_producto.tipo = 'snack' THEN
    FOR v_fijo IN SELECT * FROM receta_insumos_fijos WHERE producto_id = NEW.producto_id LOOP
      PERFORM fn_consumir_insumo(v_fijo.materia_prima_id, v_fijo.cantidad * NEW.cantidad, v_fijo.unidad, NEW.barista_id, NEW.id);
    END LOOP;
    RETURN NEW;
  END IF;

  v_variante := CASE
    WHEN v_producto.tipo = 'frappe' THEN 'frappe'
    WHEN v_producto.es_frio THEN 'fria'
    ELSE 'caliente'
  END;

  SELECT EXISTS (
    SELECT 1 FROM pedido_item_extras pie JOIN opciones_extra oe ON oe.id = pie.extra_id
    WHERE pie.pedido_item_id = NEW.id AND oe.es_shot_adicional
  ) INTO v_tiene_shot;
  v_shots := CASE WHEN v_tiene_shot THEN 2 ELSE 1 END;
  v_gramaje := COALESCE(v_receta.gramaje_por_shot, 18) * v_shots * NEW.cantidad;

  IF NEW.cafe_id IS NOT NULL THEN
    SELECT materia_prima_id INTO v_cafe_materia FROM opciones_cafe WHERE id = NEW.cafe_id;
    IF v_cafe_materia IS NOT NULL THEN
      PERFORM fn_consumir_insumo(v_cafe_materia, v_gramaje, 'g', NEW.barista_id, NEW.id);
    END IF;
  END IF;

  IF NEW.leche_id IS NOT NULL AND v_producto.permite_leche THEN
    SELECT materia_prima_id INTO v_leche_materia FROM opciones_leche WHERE id = NEW.leche_id;
    v_leche_ml := fn_leche_ml_receta(NEW.producto_id, NEW.tamano_id);
    IF v_leche_materia IS NOT NULL AND v_leche_ml IS NOT NULL THEN
      PERFORM fn_consumir_insumo(v_leche_materia, v_leche_ml * NEW.cantidad, 'ml', NEW.barista_id, NEW.id);
    END IF;
  END IF;

  IF NEW.tamano_id IS NOT NULL THEN
    SELECT * INTO v_empaque FROM tamano_empaque WHERE tamano_id = NEW.tamano_id AND variante = v_variante;
    IF FOUND THEN
      PERFORM fn_consumir_insumo(v_empaque.materia_prima_vaso_id, NEW.cantidad, 'pieza', NEW.barista_id, NEW.id);
      PERFORM fn_consumir_insumo(v_empaque.materia_prima_tapa_id, NEW.cantidad, 'pieza', NEW.barista_id, NEW.id);
    END IF;
  END IF;

  FOR v_fijo IN SELECT * FROM receta_insumos_fijos WHERE producto_id = NEW.producto_id LOOP
    PERFORM fn_consumir_insumo(v_fijo.materia_prima_id, v_fijo.cantidad * NEW.cantidad, v_fijo.unidad, NEW.barista_id, NEW.id);
  END LOOP;

  FOR v_extra IN
    SELECT oe.* FROM pedido_item_extras pie JOIN opciones_extra oe ON oe.id = pie.extra_id
    WHERE pie.pedido_item_id = NEW.id AND NOT oe.es_shot_adicional
  LOOP
    IF v_extra.materia_prima_id IS NOT NULL THEN
      PERFORM fn_consumir_insumo(v_extra.materia_prima_id, COALESCE(v_extra.cantidad, 1) * NEW.cantidad, COALESCE(v_extra.unidad, 'pieza'), NEW.barista_id, NEW.id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_costo_teorico_producto(p_producto_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_producto  productos%ROWTYPE;
  v_receta    recetas%ROWTYPE;
  v_costo     NUMERIC := 0;
  v_cafe      RECORD;
  v_leche     RECORD;
  v_leche_ml  NUMERIC;
  v_variante  TEXT;
  v_empaque   RECORD;
  v_fijo      RECORD;
  v_tamano12  INTEGER;
BEGIN
  SELECT * INTO v_producto FROM productos WHERE id = p_producto_id;
  SELECT * INTO v_receta FROM recetas WHERE producto_id = p_producto_id;
  -- Snack: si tiene insumo de reventa ligado, su costo es lo que se pagó por
  -- pieza (costo de referencia del insumo); si no, se sigue estimando 40 %.
  IF v_producto.tipo = 'snack' THEN
    FOR v_fijo IN SELECT rif.cantidad, rif.unidad, m.costo_unitario, m.unidad AS unidad_stock
                  FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
                  WHERE rif.producto_id = p_producto_id
    LOOP
      v_costo := v_costo + fn_convertir_unidad(v_fijo.cantidad, v_fijo.unidad, v_fijo.unidad_stock) * v_fijo.costo_unitario;
    END LOOP;
    IF FOUND THEN RETURN ROUND(v_costo, 2); END IF;
    RETURN v_producto.precio_base * 0.4;
  END IF;

  SELECT id INTO v_tamano12 FROM opciones_tamano
  WHERE codigo = '12' AND sucursal_id = v_producto.sucursal_id;

  SELECT m.costo_unitario, m.unidad INTO v_cafe
  FROM opciones_cafe oc JOIN materias_primas m ON m.id = oc.materia_prima_id
  WHERE oc.codigo = 'tradicional' AND oc.sucursal_id = v_producto.sucursal_id;
  IF FOUND THEN
    v_costo := v_costo + fn_convertir_unidad(COALESCE(v_receta.gramaje_por_shot, 18), 'g', v_cafe.unidad) * COALESCE(v_cafe.costo_unitario, 0);
  END IF;

  IF v_producto.permite_leche THEN
    SELECT m.costo_unitario, m.unidad INTO v_leche
    FROM opciones_leche ol JOIN materias_primas m ON m.id = ol.materia_prima_id
    WHERE ol.codigo = 'entera' AND ol.sucursal_id = v_producto.sucursal_id;
    v_leche_ml := fn_leche_ml_receta(p_producto_id, v_tamano12);
    IF v_leche.unidad IS NOT NULL THEN
      v_costo := v_costo + fn_convertir_unidad(COALESCE(v_leche_ml, 0), 'ml', v_leche.unidad) * COALESCE(v_leche.costo_unitario, 0);
    END IF;
  END IF;

  v_variante := CASE WHEN v_producto.tipo = 'frappe' THEN 'frappe' WHEN v_producto.es_frio THEN 'fria' ELSE 'caliente' END;
  SELECT mv.costo_unitario AS vaso, mt.costo_unitario AS tapa INTO v_empaque
  FROM tamano_empaque te
  JOIN materias_primas mv ON mv.id = te.materia_prima_vaso_id
  JOIN materias_primas mt ON mt.id = te.materia_prima_tapa_id
  WHERE te.tamano_id = v_tamano12 AND te.variante = v_variante;
  IF FOUND THEN
    v_costo := v_costo + COALESCE(v_empaque.vaso, 0) + COALESCE(v_empaque.tapa, 0);
  END IF;

  FOR v_fijo IN SELECT rif.cantidad, rif.unidad, m.costo_unitario, m.unidad AS unidad_stock
                FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
                WHERE rif.producto_id = p_producto_id
  LOOP
    v_costo := v_costo + fn_convertir_unidad(v_fijo.cantidad, v_fijo.unidad, v_fijo.unidad_stock) * v_fijo.costo_unitario;
  END LOOP;

  RETURN ROUND(v_costo, 2);
END;
$$ LANGUAGE plpgsql STABLE;


-- Stock bajo con cantidad sugerida a pedir.
DROP VIEW IF EXISTS vw_stock_bajo;
CREATE VIEW vw_stock_bajo AS
SELECT m.sucursal_id, m.id, m.nombre, m.categoria_id, cm.nombre AS categoria,
       m.stock_actual, m.stock_minimo, m.stock_maximo, m.unidad,
       p.nombre AS proveedor, p.telefono AS proveedor_telefono,
       ROUND(100.0 * m.stock_actual / GREATEST(m.stock_minimo, 0.001), 1) AS porcentaje_del_minimo,
       GREATEST(COALESCE(m.stock_maximo, m.stock_minimo) - m.stock_actual, 0) AS a_pedir
FROM materias_primas m
JOIN categorias_materia_prima cm ON cm.id = m.categoria_id
LEFT JOIN proveedores p ON p.id = m.proveedor_id
WHERE m.activo AND m.stock_actual < m.stock_minimo
ORDER BY porcentaje_del_minimo ASC;
GRANT SELECT ON vw_stock_bajo TO cafeteria_app;

-- Revisión de precios: los snacks con insumo de reventa ya tienen costo real.
CREATE OR REPLACE VIEW vw_precios_por_revisar AS
SELECT
  p.sucursal_id,
  p.id,
  p.nombre,
  p.icono,
  p.precio_base,
  fn_costo_teorico_producto(p.id)                                   AS costo_directo,
  fn_costo_fijo_unitario(p.sucursal_id)                             AS costo_indirecto_unitario,
  fn_costo_total_unitario(p.id)                                     AS costo_total,
  COALESCE(p.margen_porcentaje, cm.porcentaje_ganancia_normal, 60)  AS margen_aplicado,
  (p.margen_porcentaje IS NOT NULL)                                 AS margen_propio,
  fn_precio_sugerido(p.id)                                          AS precio_sugerido,
  ROUND(fn_precio_sugerido(p.id) - p.precio_base, 2)                AS diferencia
FROM productos p
LEFT JOIN LATERAL (
  SELECT porcentaje_ganancia_normal FROM configuracion_margen cm
  WHERE cm.sucursal_id = p.sucursal_id
  ORDER BY actualizado_en DESC LIMIT 1
) cm ON true
WHERE p.activo AND (p.tipo <> 'snack' OR EXISTS (SELECT 1 FROM receta_insumos_fijos f WHERE f.producto_id = p.id));

COMMIT;
