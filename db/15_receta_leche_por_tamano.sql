-- ============================================================================
-- MIGRACIÓN 15 — LECHE POR TAMAÑO EDITABLE EN CADA RECETA
-- ============================================================================
-- Los "ingredientes base" de una bebida (café por shot, leche por tamaño,
-- vaso/tapa por tamaño) se resolvían solo con valores de la sede. El gramaje
-- ya era editable por receta; ahora también la cantidad de leche por tamaño:
-- `recetas.leche_ml_por_tamano` = {"8":180,"12":280,"16":360} (clave = código
-- del tamaño). NULL = usar el predeterminado de la sede (tamano_leche_cantidad).
-- Lo usan tanto el descuento de inventario al preparar como el costo teórico.
-- Requiere 00-14. Re-ejecutable.
-- ============================================================================

BEGIN;

ALTER TABLE recetas ADD COLUMN IF NOT EXISTS leche_ml_por_tamano JSONB;
ALTER TABLE recetas DROP CONSTRAINT IF EXISTS chk_recetas_leche_ml_obj;
ALTER TABLE recetas ADD CONSTRAINT chk_recetas_leche_ml_obj
  CHECK (leche_ml_por_tamano IS NULL OR jsonb_typeof(leche_ml_por_tamano) = 'object');
COMMENT ON COLUMN recetas.leche_ml_por_tamano IS 'ml de leche por código de tamaño para ESTE producto ({"12":280,...}). NULL = cantidad predeterminada de la sede (tamano_leche_cantidad).';

-- ml de leche que lleva un producto en un tamaño: el de su receta si lo
-- personalizó, si no el predeterminado de la sede para ese tamaño.
CREATE OR REPLACE FUNCTION fn_leche_ml_receta(p_producto_id UUID, p_tamano_id INTEGER) RETURNS NUMERIC AS $$
  SELECT COALESCE(
    (SELECT (r.leche_ml_por_tamano ->> t.codigo)::numeric
       FROM recetas r JOIN opciones_tamano t ON t.id = p_tamano_id
      WHERE r.producto_id = p_producto_id
        AND r.leche_ml_por_tamano ? t.codigo),
    (SELECT cantidad_ml FROM tamano_leche_cantidad WHERE tamano_id = p_tamano_id)
  );
$$ LANGUAGE sql STABLE;

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

  IF v_producto.tipo = 'snack' THEN
    RETURN NEW; -- los snacks no tienen preparación con insumos medibles en este modelo
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
  IF v_producto.tipo = 'snack' THEN
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

CREATE OR REPLACE FUNCTION fn_resetear_receta(p_producto_id UUID) RETURNS recetas AS $$
DECLARE
  v_producto productos%ROWTYPE;
  v_resultado recetas%ROWTYPE;
BEGIN
  SELECT * INTO v_producto FROM productos WHERE id = p_producto_id;

  UPDATE recetas SET
    pasos = CASE WHEN v_producto.tipo = 'frappe' THEN
        '["Agregar café molido, leche, hielo y base al vaso licuador", "Licuar a velocidad alta 25-30 segundos", "Servir en vaso frío", "Colocar tapa domo y popote"]'::jsonb
      ELSE
        '["Moler el café justo antes de preparar", "Tarar y dosificar el café molido", "Extraer el espresso", "Vaporizar y texturizar la leche si aplica", "Servir y colocar tapa"]'::jsonb
      END,
    gramaje_por_shot = CASE WHEN v_producto.tipo = 'bebida' THEN 18 ELSE NULL END,
    molienda = CASE WHEN v_producto.tipo = 'frappe' THEN 'Gruesa' ELSE 'Media-fina' END,
    molienda_especial = 'Media (origen)',
    ajuste_molino = CASE WHEN v_producto.tipo = 'bebida' THEN '3.5' ELSE NULL END,
    ajuste_molino_especial = '4.2',
    tiempo_extraccion = CASE WHEN v_producto.tipo = 'frappe' THEN '25-30 s' ELSE '26-30 s' END,
    temperatura_servicio = CASE WHEN v_producto.es_frio THEN '92°C / servir frío' WHEN v_producto.tipo = 'frappe' THEN 'Frío / con hielo' ELSE '92°C' END,
    textura_leche = CASE WHEN v_producto.permite_leche THEN 'Microespuma suave y sedosa' ELSE NULL END,
    leche_ml_por_tamano = NULL,
    es_personalizada = false,
    actualizado_en = now()
  WHERE producto_id = p_producto_id
  RETURNING * INTO v_resultado;

  RETURN v_resultado;
END;
$$ LANGUAGE plpgsql;

COMMIT;
