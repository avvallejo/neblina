-- ============================================================================
-- CAFETERÍA MÓVIL — FUNCIONES Y TRIGGERS DE NEGOCIO
-- ============================================================================
-- Requiere haber ejecutado schema.sql primero.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. actualizado_en automático
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tocar_actualizado_en() RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_touch_usuarios  BEFORE UPDATE ON usuarios        FOR EACH ROW EXECUTE FUNCTION fn_tocar_actualizado_en();
CREATE TRIGGER trg_touch_materias  BEFORE UPDATE ON materias_primas FOR EACH ROW EXECUTE FUNCTION fn_tocar_actualizado_en();
CREATE TRIGGER trg_touch_productos BEFORE UPDATE ON productos       FOR EACH ROW EXECUTE FUNCTION fn_tocar_actualizado_en();

-- Si la aplicación olvida mandar turno_id al crear un pedido, se asigna solo el
-- turno que esté abierto en ese momento (evita pedidos "huérfanos" que luego no
-- aparecen en los reportes por turno).
CREATE OR REPLACE FUNCTION fn_asignar_turno_abierto() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.turno_id IS NULL THEN
    SELECT id INTO NEW.turno_id FROM turnos WHERE cerrado_en IS NULL LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asignar_turno BEFORE INSERT ON pedidos FOR EACH ROW EXECUTE FUNCTION fn_asignar_turno_abierto();

-- ----------------------------------------------------------------------------
-- 2. Conversión de unidades y consumo de insumo con PEPS
-- ----------------------------------------------------------------------------
-- Las recetas siempre expresan cantidades en la unidad "pequeña" (g, ml, pieza),
-- pero el inventario puede llevarse en la unidad "grande" (kg, L). Sin esta
-- conversión, descontar "18 g" de un insumo guardado en kg borraría 18 kg de un
-- golpe — por eso toda llamada a fn_consumir_insumo declara en qué unidad viene
-- la cantidad, y aquí se convierte a la unidad real de materias_primas.unidad.
CREATE OR REPLACE FUNCTION fn_convertir_unidad(p_cantidad NUMERIC, p_unidad_origen unidad_medida, p_unidad_destino unidad_medida)
RETURNS NUMERIC AS $$
BEGIN
  IF p_cantidad IS NULL THEN RETURN NULL; END IF;
  IF p_unidad_origen = p_unidad_destino THEN RETURN p_cantidad; END IF;
  IF p_unidad_origen = 'g'  AND p_unidad_destino = 'kg' THEN RETURN p_cantidad / 1000; END IF;
  IF p_unidad_origen = 'kg' AND p_unidad_destino = 'g'  THEN RETURN p_cantidad * 1000; END IF;
  IF p_unidad_origen = 'ml' AND p_unidad_destino = 'l'  THEN RETURN p_cantidad / 1000; END IF;
  IF p_unidad_origen = 'l'  AND p_unidad_destino = 'ml' THEN RETURN p_cantidad * 1000; END IF;
  RETURN p_cantidad; -- unidades no convertibles entre sí (ej. 'pieza'); se asume que ya coinciden
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Si la materia prima requiere_lote=true, recorre los lotes del más antiguo al
-- más nuevo hasta cubrir la cantidad pedida (PEPS real, no solo de nombre) y
-- recalcula stock_actual como la suma de los lotes vigentes. Si no requiere
-- lote, descuenta directo. En ambos casos deja rastro en movimientos_inventario.
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
  v_tomar         NUMERIC;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RETURN;
  END IF;

  SELECT requiere_lote, unidad INTO v_requiere_lote, v_unidad_stock FROM materias_primas WHERE id = p_materia_prima_id;
  v_cantidad := fn_convertir_unidad(p_cantidad, p_unidad_origen, v_unidad_stock);
  v_restante := v_cantidad;

  IF v_requiere_lote THEN
    FOR v_lote IN
      SELECT id, cantidad_disponible FROM lotes
      WHERE materia_prima_id = p_materia_prima_id AND cantidad_disponible > 0
      ORDER BY fecha_compra ASC, creado_en ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_restante <= 0;
      v_tomar := LEAST(v_lote.cantidad_disponible, v_restante);
      UPDATE lotes SET cantidad_disponible = cantidad_disponible - v_tomar WHERE id = v_lote.id;
      INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, pedido_item_id, merma_id, usuario_id)
        VALUES (p_materia_prima_id, p_tipo, -v_tomar, v_lote.id, p_pedido_item_id, p_merma_id, p_usuario_id);
      v_restante := v_restante - v_tomar;
    END LOOP;
    UPDATE materias_primas m SET stock_actual = COALESCE(
      (SELECT SUM(cantidad_disponible) FROM lotes WHERE materia_prima_id = m.id), 0
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

-- ----------------------------------------------------------------------------
-- 3. Descuento automático de inventario al terminar una bebida (sección 11 del
--    requerimiento: "todo producto preparado debe descontar inventario").
-- ----------------------------------------------------------------------------
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
    SELECT cantidad_ml INTO v_leche_ml FROM tamano_leche_cantidad WHERE tamano_id = NEW.tamano_id;
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

CREATE TRIGGER trg_descontar_inventario
  AFTER UPDATE ON pedido_items
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'terminado')
  EXECUTE FUNCTION fn_descontar_inventario();

-- ----------------------------------------------------------------------------
-- 4. Mermas: registrar una merma SIEMPRE descuenta el insumo real (a diferencia
--    del prototipo de UI, que solo la registraba como bitácora).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_registrar_merma() RETURNS TRIGGER AS $$
BEGIN
  PERFORM fn_consumir_insumo(NEW.materia_prima_id, NEW.cantidad, NEW.unidad, NEW.usuario_id, NEW.pedido_item_id, 'merma', NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_registrar_merma AFTER INSERT ON mermas FOR EACH ROW EXECUTE FUNCTION fn_registrar_merma();

-- ----------------------------------------------------------------------------
-- 5. Fidelidad: el punto se acredita SOLO cuando el pedido queda cobrado, nunca
--    al levantar el pedido. El no-show resta un punto (política de merma).
-- ----------------------------------------------------------------------------
-- Acreditar un punto de fidelidad a un cliente (sube el contador y, si toca el
-- umbral de la promoción activa, deja lista su recompensa). Centralizado en una
-- sola función para que se acredite IGUAL sin importar por dónde quede cobrado
-- el pedido: vía PATCH /cobrar (AFTER UPDATE) o cobrado de entrada en una venta
-- de mostrador (AFTER INSERT) — antes este segundo caso no acreditaba nada.
CREATE OR REPLACE FUNCTION fn_acreditar_fidelidad(p_cliente_id UUID) RETURNS void AS $$
DECLARE
  v_cada   INTEGER;
  v_activo BOOLEAN;
BEGIN
  SELECT cada_n_pedidos, activo INTO v_cada, v_activo FROM promocion_fidelidad LIMIT 1;
  UPDATE clientes SET
    pedidos_app_contador = pedidos_app_contador + 1,
    recompensa_pendiente = recompensa_pendiente OR (COALESCE(v_activo, false) AND (pedidos_app_contador + 1) % COALESCE(v_cada, 10) = 0)
  WHERE id = p_cliente_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_confirmar_cobro_pedido() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.cobrado = false AND NEW.cobrado = true AND NEW.cliente_id IS NOT NULL AND NOT NEW.es_regalo_fidelidad THEN
    PERFORM fn_acreditar_fidelidad(NEW.cliente_id);
  END IF;

  IF OLD.no_show = false AND NEW.no_show = true AND NEW.cliente_id IS NOT NULL THEN
    UPDATE clientes SET pedidos_app_contador = GREATEST(0, pedidos_app_contador - 1) WHERE id = NEW.cliente_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_confirmar_cobro AFTER UPDATE ON pedidos FOR EACH ROW EXECUTE FUNCTION fn_confirmar_cobro_pedido();

-- Venta de mostrador que nace ya cobrada (cobrado=true en el propio INSERT): el
-- trigger AFTER UPDATE de arriba nunca se dispara para ella, así que su punto de
-- fidelidad se acredita aquí. INSERT y UPDATE son mutuamente excluyentes, así que
-- un pedido nunca acumula doble. El pedido-regalo no acumula, igual que en el cobro normal.
CREATE OR REPLACE FUNCTION fn_cobro_inmediato_al_crear() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cobrado = true AND NEW.cliente_id IS NOT NULL AND NOT NEW.es_regalo_fidelidad THEN
    PERFORM fn_acreditar_fidelidad(NEW.cliente_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cobro_inmediato AFTER INSERT ON pedidos FOR EACH ROW EXECUTE FUNCTION fn_cobro_inmediato_al_crear();

-- Al CREAR un pedido que es el reclamo del regalo, se apaga la bandera de "regalo listo"
-- en ese mismo momento (igual que en el prototipo: reclamar ya cuenta como usado).
CREATE OR REPLACE FUNCTION fn_registrar_reclamo_regalo() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.es_regalo_fidelidad AND NEW.cliente_id IS NOT NULL THEN
    UPDATE clientes SET recompensa_pendiente = false WHERE id = NEW.cliente_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reclamo_regalo AFTER INSERT ON pedidos FOR EACH ROW EXECUTE FUNCTION fn_registrar_reclamo_regalo();
