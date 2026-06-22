-- ============================================================================
-- CAFETERÍA MÓVIL — MIGRACIÓN 05: cierre de brechas para desarrollo real
-- ============================================================================
-- Se escribe como migración nueva (no se edita 01-04) porque así es como se
-- trabaja en un proyecto real: el historial de cambios queda en archivos,
-- no se reescribe el pasado. Requiere 01-04 ya aplicados.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Costo real por lote (antes solo existía costo_total; para reportes de
--    costo real por venta se necesita el costo unitario de ESE lote específico,
--    no el costo de referencia general de la materia prima).
-- ----------------------------------------------------------------------------
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(12,4) GENERATED ALWAYS AS (costo_total / cantidad_comprada) STORED;

-- ----------------------------------------------------------------------------
-- 2. Soporte para sincronización offline (sección 20.3 del requerimiento).
--    Cada dispositivo genera su propio UUID al crear un registro sin conexión;
--    al sincronizar, el backend usa client_uuid para detectar reintentos y no
--    duplicar el pedido si la respuesta del primer intento se perdió.
-- ----------------------------------------------------------------------------
ALTER TABLE pedidos      ADD COLUMN IF NOT EXISTS client_uuid UUID;
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS client_uuid UUID;
ALTER TABLE mermas       ADD COLUMN IF NOT EXISTS client_uuid UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_client_uuid      ON pedidos(client_uuid)      WHERE client_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_items_client_uuid ON pedido_items(client_uuid) WHERE client_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mermas_client_uuid       ON mermas(client_uuid)      WHERE client_uuid IS NOT NULL;
COMMENT ON COLUMN pedidos.client_uuid IS 'UUID generado por el dispositivo que crea el registro offline; permite reintentar el envío sin crear un duplicado.';

-- ----------------------------------------------------------------------------
-- 3. Precio efectivo: respeta la promoción de apertura vigente (sección 15.2)
--    sin que la aplicación tenga que calcular fechas — la base de datos es la
--    única fuente de verdad sobre qué precio aplica hoy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_precio_efectivo(p_producto_id UUID, p_fecha DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC AS $$
DECLARE
  v_precio_apertura NUMERIC;
  v_producto productos%ROWTYPE;
BEGIN
  SELECT pap.precio_especial INTO v_precio_apertura
  FROM promocion_apertura_productos pap
  JOIN promociones_apertura pa ON pa.id = pap.promocion_id
  WHERE pap.producto_id = p_producto_id
    AND pa.activo
    AND p_fecha BETWEEN pa.fecha_inicio AND pa.fecha_fin
  ORDER BY pa.fecha_inicio DESC
  LIMIT 1;

  IF v_precio_apertura IS NOT NULL THEN
    RETURN v_precio_apertura;
  END IF;

  SELECT * INTO v_producto FROM productos WHERE id = p_producto_id;
  RETURN COALESCE(v_producto.precio_promocional, v_producto.precio_base);
END;
$$ LANGUAGE plpgsql STABLE;
COMMENT ON FUNCTION fn_precio_efectivo IS 'Precio que debe cobrarse HOY: promoción de apertura vigente > precio promocional > precio base. Al vencer la promoción, regresa solo automáticamente porque la fecha ya no cae en el rango.';

-- ----------------------------------------------------------------------------
-- 4. Precio sugerido por margen (sección 14.2-14.3): costo real del insumo +
--    margen configurado, redondeado. Es una SUGERENCIA — el admin sigue
--    decidiendo si la usa o pone un precio manual (regla de negocio explícita
--    del requerimiento: "el precio puede ser calculado o manual").
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_costo_teorico_producto(p_producto_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_producto  productos%ROWTYPE;
  v_receta    recetas%ROWTYPE;
  v_costo     NUMERIC := 0;
  v_cafe      NUMERIC;
  v_leche     NUMERIC;
  v_leche_ml  NUMERIC;
  v_variante  TEXT;
  v_empaque   RECORD;
  v_fijo      RECORD;
BEGIN
  SELECT * INTO v_producto FROM productos WHERE id = p_producto_id;
  SELECT * INTO v_receta FROM recetas WHERE producto_id = p_producto_id;
  IF v_producto.tipo = 'snack' THEN
    RETURN v_producto.precio_base * 0.4; -- sin receta medible; aproximación simple para snacks
  END IF;

  -- Café tradicional, a tamaño de referencia (12oz, un shot)
  SELECT m.costo_unitario INTO v_cafe FROM opciones_cafe oc JOIN materias_primas m ON m.id = oc.materia_prima_id WHERE oc.codigo = 'tradicional';
  v_costo := v_costo + COALESCE(v_receta.gramaje_por_shot, 18) / 1000.0 * COALESCE(v_cafe, 0);

  IF v_producto.permite_leche THEN
    SELECT m.costo_unitario INTO v_leche FROM opciones_leche ol JOIN materias_primas m ON m.id = ol.materia_prima_id WHERE ol.codigo = 'entera';
    SELECT cantidad_ml INTO v_leche_ml FROM tamano_leche_cantidad WHERE tamano_id = (SELECT id FROM opciones_tamano WHERE codigo = '12');
    v_costo := v_costo + COALESCE(v_leche_ml, 0) / 1000.0 * COALESCE(v_leche, 0);
  END IF;

  -- Vaso y tapa de 12oz, según variante (caliente/fría/frappé) — la sección 14.1
  -- del requerimiento pide explícitamente contar el empaque dentro del costo.
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

CREATE OR REPLACE FUNCTION fn_precio_sugerido(p_producto_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_costo    NUMERIC;
  v_margen   NUMERIC;
  v_redondeo NUMERIC;
  v_precio   NUMERIC;
BEGIN
  v_costo := fn_costo_teorico_producto(p_producto_id);
  SELECT porcentaje_ganancia_normal, redondeo INTO v_margen, v_redondeo FROM configuracion_margen ORDER BY actualizado_en DESC LIMIT 1;
  v_margen := COALESCE(v_margen, 60);
  v_redondeo := COALESCE(v_redondeo, 1);
  v_precio := v_costo * (1 + v_margen / 100.0);
  RETURN CEIL(v_precio / v_redondeo) * v_redondeo;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- 5. Costo REAL por venta (no teórico): suma lo que de verdad se descontó en
--    movimientos_inventario para cada pedido_item, usando el costo del lote
--    consumido cuando existe, o el costo de referencia si el insumo no maneja
--    lote.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_costo_real_por_venta AS
SELECT
  pi.id AS pedido_item_id,
  pi.pedido_id,
  pr.nombre AS producto,
  pi.precio_unitario * pi.cantidad AS precio_cobrado,
  SUM(mi.cantidad * -1 * COALESCE(l.costo_unitario, mp.costo_unitario)) AS costo_real,
  (pi.precio_unitario * pi.cantidad) - SUM(mi.cantidad * -1 * COALESCE(l.costo_unitario, mp.costo_unitario)) AS utilidad_real
FROM pedido_items pi
JOIN productos pr ON pr.id = pi.producto_id
LEFT JOIN movimientos_inventario mi ON mi.pedido_item_id = pi.id AND mi.tipo = 'consumo'
LEFT JOIN materias_primas mp ON mp.id = mi.materia_prima_id
LEFT JOIN lotes l ON l.id = mi.lote_id
WHERE pi.estado = 'terminado'
GROUP BY pi.id, pi.pedido_id, pr.nombre, pi.precio_unitario, pi.cantidad;
COMMENT ON VIEW vw_costo_real_por_venta IS 'Utilidad real por bebida vendida, usando el costo del lote efectivamente consumido (PEPS) en vez de un costo teórico fijo.';

-- ----------------------------------------------------------------------------
-- 6. Restaurar una receta a sus valores predeterminados (el botón "Restaurar
--    predeterminada" que ya existía en el editor de recetas del prototipo).
-- ----------------------------------------------------------------------------
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
    es_personalizada = false,
    actualizado_en = now()
  WHERE producto_id = p_producto_id
  RETURNING * INTO v_resultado;

  RETURN v_resultado;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 7. Estado calculado del pedido — la misma lógica getOrderStatus que ya
--    usaba el prototipo (pendiente / en_preparacion / listo / terminado /
--    cancelado / no_show), para no repetirla en cada consulta de la API.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_pedidos_con_estado AS
SELECT p.*,
  CASE
    WHEN p.no_show THEN 'no_show'
    WHEN p.cancelado THEN 'cancelado'
    WHEN COUNT(pi.id) = 0 THEN 'pendiente'
    WHEN COUNT(pi.id) = COUNT(*) FILTER (WHERE pi.estado = 'terminado') THEN (CASE WHEN p.cobrado THEN 'terminado' ELSE 'listo' END)
    WHEN COUNT(*) FILTER (WHERE pi.estado <> 'pendiente') > 0 THEN 'en_preparacion'
    ELSE 'pendiente'
  END AS estado
FROM pedidos p
LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
GROUP BY p.id;
