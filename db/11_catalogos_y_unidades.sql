-- ============================================================================
-- 11. CATÁLOGOS Y UNIDADES
-- ============================================================================
-- Corrige el manejo de catálogos eliminables/editables y, sobre todo, hace que
-- el inventario respete la unidad real de cada lote al convertir g/kg y ml/l.
-- Regla de captura:
--   - Si el insumo está en g o ml, captura enteros como 100 g o 250 ml.
--   - Si el insumo está en kg o l, captura decimales como 0.100 kg o 0.250 l.
-- La receta puede seguir expresándose en g/ml: PostgreSQL convierte al descontar.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_convertir_unidad(p_cantidad NUMERIC, p_unidad_origen unidad_medida, p_unidad_destino unidad_medida)
RETURNS NUMERIC AS $$
BEGIN
  IF p_cantidad IS NULL THEN RETURN NULL; END IF;
  IF p_unidad_origen = p_unidad_destino THEN RETURN p_cantidad; END IF;
  IF p_unidad_origen = 'g'  AND p_unidad_destino = 'kg' THEN RETURN p_cantidad / 1000; END IF;
  IF p_unidad_origen = 'kg' AND p_unidad_destino = 'g'  THEN RETURN p_cantidad * 1000; END IF;
  IF p_unidad_origen = 'ml' AND p_unidad_destino = 'l'  THEN RETURN p_cantidad / 1000; END IF;
  IF p_unidad_origen = 'l'  AND p_unidad_destino = 'ml' THEN RETURN p_cantidad * 1000; END IF;
  RAISE EXCEPTION 'No se puede convertir de % a %', p_unidad_origen, p_unidad_destino
    USING ERRCODE = '22023';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_consumir_insumo(
  p_materia_prima_id UUID,
  p_cantidad         NUMERIC,
  p_unidad_origen    unidad_medida,
  p_usuario_id       UUID,
  p_pedido_item_id   UUID DEFAULT NULL,
  p_tipo             tipo_movimiento DEFAULT 'consumo',
  p_merma_id         UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_requiere_lote BOOLEAN;
  v_unidad_stock  unidad_medida;
  v_cantidad      NUMERIC;
  v_restante      NUMERIC;
  v_lote          RECORD;
  v_disponible_stock NUMERIC;
  v_tomar_stock   NUMERIC;
  v_tomar_lote    NUMERIC;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RETURN;
  END IF;

  SELECT requiere_lote, unidad INTO v_requiere_lote, v_unidad_stock FROM materias_primas WHERE id = p_materia_prima_id;
  v_cantidad := fn_convertir_unidad(p_cantidad, p_unidad_origen, v_unidad_stock);
  v_restante := v_cantidad;

  IF v_requiere_lote THEN
    FOR v_lote IN
      SELECT id, cantidad_disponible, unidad FROM lotes
      WHERE materia_prima_id = p_materia_prima_id AND cantidad_disponible > 0
      ORDER BY fecha_compra ASC, creado_en ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_restante <= 0;
      v_disponible_stock := fn_convertir_unidad(v_lote.cantidad_disponible, v_lote.unidad, v_unidad_stock);
      v_tomar_stock := LEAST(v_disponible_stock, v_restante);
      v_tomar_lote := fn_convertir_unidad(v_tomar_stock, v_unidad_stock, v_lote.unidad);
      UPDATE lotes SET cantidad_disponible = GREATEST(0, cantidad_disponible - v_tomar_lote) WHERE id = v_lote.id;
      INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, pedido_item_id, merma_id, usuario_id)
        VALUES (p_materia_prima_id, p_tipo, -v_tomar_stock, v_lote.id, p_pedido_item_id, p_merma_id, p_usuario_id);
      v_restante := v_restante - v_tomar_stock;
    END LOOP;
    UPDATE materias_primas m SET stock_actual = (
      SELECT COALESCE(SUM(fn_convertir_unidad(l.cantidad_disponible, l.unidad, m.unidad)), 0)
      FROM lotes l
      WHERE l.materia_prima_id = m.id
    ) WHERE m.id = p_materia_prima_id;
    IF v_restante > 0 THEN
      INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, pedido_item_id, merma_id, usuario_id, motivo)
        VALUES (p_materia_prima_id, p_tipo, -v_restante, p_pedido_item_id, p_merma_id, p_usuario_id, 'Sin lote suficiente disponible');
    END IF;
  ELSE
    UPDATE materias_primas SET stock_actual = GREATEST(0, stock_actual - v_cantidad) WHERE id = p_materia_prima_id;
    INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, pedido_item_id, merma_id, usuario_id)
      VALUES (p_materia_prima_id, p_tipo, -v_cantidad, p_pedido_item_id, p_merma_id, p_usuario_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW vw_costo_teorico_receta_12oz AS
SELECT pr.id AS producto_id, pr.nombre,
  CASE WHEN mc.id IS NULL THEN 0 ELSE fn_convertir_unidad(COALESCE(re.gramaje_por_shot, 0), 'g', mc.unidad) * COALESCE(mc.costo_unitario, 0) END
    + CASE WHEN ml.id IS NULL THEN 0 ELSE fn_convertir_unidad(COALESCE(tl.cantidad_ml, 0), 'ml', ml.unidad) * COALESCE(ml.costo_unitario, 0) END
    + COALESCE((SELECT SUM(fn_convertir_unidad(rif.cantidad, rif.unidad, mp2.unidad) * mp2.costo_unitario)
                FROM receta_insumos_fijos rif JOIN materias_primas mp2 ON mp2.id = rif.materia_prima_id
                WHERE rif.producto_id = pr.id), 0) AS costo_estimado
FROM productos pr
LEFT JOIN recetas re ON re.producto_id = pr.id
LEFT JOIN opciones_cafe oc ON oc.codigo = 'tradicional'
LEFT JOIN materias_primas mc ON mc.id = oc.materia_prima_id
LEFT JOIN opciones_leche ol ON ol.codigo = 'entera'
LEFT JOIN materias_primas ml ON ml.id = ol.materia_prima_id
LEFT JOIN tamano_leche_cantidad tl ON tl.tamano_id = (SELECT id FROM opciones_tamano WHERE codigo='12')
WHERE pr.tipo <> 'snack';

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
BEGIN
  SELECT * INTO v_producto FROM productos WHERE id = p_producto_id;
  SELECT * INTO v_receta FROM recetas WHERE producto_id = p_producto_id;
  IF v_producto.tipo = 'snack' THEN
    RETURN v_producto.precio_base * 0.4;
  END IF;

  SELECT m.costo_unitario, m.unidad INTO v_cafe
  FROM opciones_cafe oc JOIN materias_primas m ON m.id = oc.materia_prima_id
  WHERE oc.codigo = 'tradicional';
  IF FOUND THEN
    v_costo := v_costo + fn_convertir_unidad(COALESCE(v_receta.gramaje_por_shot, 18), 'g', v_cafe.unidad) * COALESCE(v_cafe.costo_unitario, 0);
  END IF;

  IF v_producto.permite_leche THEN
    SELECT m.costo_unitario, m.unidad INTO v_leche
    FROM opciones_leche ol JOIN materias_primas m ON m.id = ol.materia_prima_id
    WHERE ol.codigo = 'entera';
    SELECT cantidad_ml INTO v_leche_ml FROM tamano_leche_cantidad WHERE tamano_id = (SELECT id FROM opciones_tamano WHERE codigo = '12');
    IF v_leche.unidad IS NOT NULL THEN
      v_costo := v_costo + fn_convertir_unidad(COALESCE(v_leche_ml, 0), 'ml', v_leche.unidad) * COALESCE(v_leche.costo_unitario, 0);
    END IF;
  END IF;

  v_variante := CASE WHEN v_producto.tipo = 'frappe' THEN 'frappe' WHEN v_producto.es_frio THEN 'fria' ELSE 'caliente' END;
  SELECT mv.costo_unitario AS vaso, mt.costo_unitario AS tapa INTO v_empaque
  FROM tamano_empaque te
  JOIN materias_primas mv ON mv.id = te.materia_prima_vaso_id
  JOIN materias_primas mt ON mt.id = te.materia_prima_tapa_id
  WHERE te.tamano_id = (SELECT id FROM opciones_tamano WHERE codigo = '12') AND te.variante = v_variante;
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

-- Recalcula el stock visible de insumos por lote respetando la unidad de cada lote.
UPDATE materias_primas m
SET stock_actual = (
  SELECT COALESCE(SUM(fn_convertir_unidad(l.cantidad_disponible, l.unidad, m.unidad)), 0)
  FROM lotes l
  WHERE l.materia_prima_id = m.id
)
WHERE m.requiere_lote;

COMMIT;
