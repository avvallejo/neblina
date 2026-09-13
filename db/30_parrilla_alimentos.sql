-- ============================================================================
-- MIGRACIÓN 30 — ALIMENTOS DE PARRILLA / COCINA Y EXTRAS POR ÁMBITO
-- ============================================================================
-- Nuevo tipo de producto 'alimento' (hamburguesas, tortas, quesoburger…):
--   * se prepara con una RECETA de varios ingredientes del inventario
--     (receta_insumos_fijos) — sin café, leche ni vaso/tapa;
--   * cada venta descuenta esos ingredientes (y los de los extras elegidos);
--   * su costo directo es la suma de sus ingredientes, así entra a
--     "Costo y precio", margen y revisión de precios;
--   * sale por la comanda de su estación (parrilla por defecto).
-- Los extras ahora dicen a qué aplican (bebidas | alimentos): una hamburguesa
-- ofrece tocino o queso extra, no vainilla; un latte no ofrece tocino.
-- Lo "comprado hecho" (refrescos, aguas embotelladas, snacks) sigue siendo
-- tipo 'snack' con su insumo de reventa (migración 28), en la categoría que
-- se quiera (p. ej. Fríos).
-- Requiere 00-29. Re-ejecutable.
-- ============================================================================

-- El ALTER TYPE va fuera de transacción (igual que las migraciones 16 y 26):
-- un valor nuevo de enum no puede usarse dentro de la misma transacción.
ALTER TYPE tipo_producto ADD VALUE IF NOT EXISTS 'alimento';

BEGIN;

-- 1. Extras por ámbito ------------------------------------------------------
ALTER TABLE opciones_extra ADD COLUMN IF NOT EXISTS aplica_a TEXT NOT NULL DEFAULT 'bebidas';
ALTER TABLE opciones_extra DROP CONSTRAINT IF EXISTS opciones_extra_aplica_a_valida;
ALTER TABLE opciones_extra ADD CONSTRAINT opciones_extra_aplica_a_valida CHECK (aplica_a IN ('bebidas', 'alimentos'));
ALTER TABLE opciones_extra DROP CONSTRAINT IF EXISTS opciones_extra_shot_solo_bebidas;
ALTER TABLE opciones_extra ADD CONSTRAINT opciones_extra_shot_solo_bebidas CHECK (NOT es_shot_adicional OR aplica_a = 'bebidas');
COMMENT ON COLUMN opciones_extra.aplica_a IS 'bebidas | alimentos: en qué productos se ofrece este extra.';

-- 2. Un alimento no lleva las opciones de bebida -----------------------------
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_alimento_sin_opciones_bebida;
ALTER TABLE productos ADD CONSTRAINT productos_alimento_sin_opciones_bebida
  CHECK (tipo <> 'alimento' OR (NOT permite_tamanos AND NOT permite_leche AND NOT permite_tipo_cafe));

-- 3. Descuento de inventario ------------------------------------------------
-- Snacks de reventa y alimentos: solo sus ingredientes fijos + los insumos de
-- los extras elegidos. Bebidas y frappés: igual que la migración 28.
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

  IF v_producto.tipo IN ('snack', 'alimento') THEN
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

-- 4. Costo directo ------------------------------------------------------------
-- Alimento: suma de sus ingredientes (0 mientras no tenga receta capturada).
-- Snack: costo del insumo de reventa, o 40 % del precio si no está ligado.
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

  IF v_producto.tipo IN ('snack', 'alimento') THEN
    FOR v_fijo IN SELECT rif.cantidad, rif.unidad, m.costo_unitario, m.unidad AS unidad_stock
                  FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
                  WHERE rif.producto_id = p_producto_id
    LOOP
      v_costo := v_costo + fn_convertir_unidad(v_fijo.cantidad, v_fijo.unidad, v_fijo.unidad_stock) * COALESCE(v_fijo.costo_unitario, 0);
    END LOOP;
    IF FOUND THEN RETURN ROUND(v_costo, 2); END IF;
    RETURN CASE WHEN v_producto.tipo = 'snack' THEN v_producto.precio_base * 0.4 ELSE 0 END;
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

-- 5. Receta predeterminada por tipo ------------------------------------------
CREATE OR REPLACE FUNCTION fn_resetear_receta(p_producto_id UUID) RETURNS recetas AS $$
DECLARE
  v_producto productos%ROWTYPE;
  v_resultado recetas%ROWTYPE;
BEGIN
  SELECT * INTO v_producto FROM productos WHERE id = p_producto_id;

  IF v_producto.tipo = 'alimento' THEN
    UPDATE recetas SET
      pasos = '["Reunir los ingredientes de la receta", "Cocinar en la parrilla o plancha", "Armar el platillo y revisar la presentación", "Entregar en la barra de pedidos"]'::jsonb,
      gramaje_por_shot = NULL, molienda = NULL, molienda_especial = NULL,
      ajuste_molino = NULL, ajuste_molino_especial = NULL,
      tiempo_extraccion = NULL, tiempo_extraccion_especial = NULL,
      temperatura_servicio = NULL, textura_leche = NULL, leche_ml_por_tamano = NULL,
      es_personalizada = false, actualizado_en = now()
    WHERE producto_id = p_producto_id
    RETURNING * INTO v_resultado;
    RETURN v_resultado;
  END IF;

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

-- 6. Revisión de precios: alimentos solo cuando ya tienen ingredientes -------
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
WHERE p.activo AND (p.tipo NOT IN ('snack', 'alimento') OR EXISTS (SELECT 1 FROM receta_insumos_fijos f WHERE f.producto_id = p.id));

COMMIT;
