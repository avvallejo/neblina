-- ============================================================================
-- MIGRACIÓN 34 — EL PRECIO SE FIJA POR MARGEN DE CONTRIBUCIÓN, NO SUMANDO RENTA
-- ============================================================================
-- Hasta aquí el precio sugerido era:
--     (costo de insumos + gastos fijos ÷ unidades estimadas) × (1 + margen)
-- Eso repartía el MISMO importe de gastos fijos a todos los productos: con
-- $27,650 de fijos y 1,200 unidades, cada producto cargaba $23.04. Para una
-- jamaica embotellada (insumo $14) eso era +164 % y el sugerido salía en $60
-- para algo que se vende en $25; para una hamburguesa (insumo $38) apenas era
-- +57 %. Encima, el margen se aplicaba TAMBIÉN sobre esos $23.04: se estaba
-- pidiendo utilidad sobre la renta.
--
-- Ahora son tres decisiones separadas y explícitas:
--
--   1. QUÉ gastos fijos son costo del producto — `cuentas_contables.entra_al_costo`.
--      El pago del préstamo y el sueldo del dueño quedan fuera (son
--      financiamiento y retiro, no costo de hacer un café): se siguen pagando
--      y siguen bajando la utilidad y el diezmo, pero no inflan el precio.
--   2. CÓMO se reparten, cuando hace falta saberlo — por estación, con pesos
--      (`pesos_estacion`: barra 1, parrilla 1.5, refrigerador 0.25) y con la
--      mezcla REAL de los últimos 30 días. Una bebida embotellada no usa
--      barista ni parrilla: no puede cargar lo mismo que una hamburguesa.
--   3. CÓMO se vuelve precio — margen de contribución:
--          precio = costo de insumos ÷ (1 − margen)
--      El margen vive en el producto, si no en su categoría, si no en la sede.
--      Los gastos fijos ya no se suman al costo: sirven de PISO (nunca sugerir
--      por debajo de costo + su parte de fijos) y se cubren con la contribución
--      de todo el mes, que es lo que mide Contabilidad.
--
-- Al aplicarla NINGÚN precio se mueve: el margen de cada producto se siembra
-- con la contribución que hoy tiene su precio de lista, y el de cada categoría
-- con la mediana de sus productos (es el que heredan los productos nuevos).
-- Requiere 00-33. Re-ejecutable.
-- ============================================================================
BEGIN;

-- 1. Qué gastos fijos entran al costo del producto -------------------------
-- Se agrega como NULL y solo se rellena lo que nunca se decidió: así volver a
-- correr la migración no pisa lo que el administrador haya cambiado.
ALTER TABLE cuentas_contables ADD COLUMN IF NOT EXISTS entra_al_costo BOOLEAN;
UPDATE cuentas_contables
   SET entra_al_costo = (grupo = 'gasto_operacion' AND clave IS DISTINCT FROM 'sueldo_dueno')
 WHERE entra_al_costo IS NULL;
ALTER TABLE cuentas_contables ALTER COLUMN entra_al_costo DROP DEFAULT;
ALTER TABLE cuentas_contables ALTER COLUMN entra_al_costo SET NOT NULL;

-- Una cuenta nueva (la siembra de una sede o una que cree el administrador)
-- nace con la respuesta sensata si nadie la indica: los gastos de operación
-- son costo del producto; el sueldo del dueño, el financiamiento, los
-- impuestos, la inversión, los retiros y el diezmo, no.
CREATE OR REPLACE FUNCTION fn_cuenta_entra_al_costo_default() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entra_al_costo IS NULL THEN
    NEW.entra_al_costo := (NEW.grupo = 'gasto_operacion' AND NEW.clave IS DISTINCT FROM 'sueldo_dueno');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_cuenta_entra_al_costo ON cuentas_contables;
CREATE TRIGGER trg_cuenta_entra_al_costo BEFORE INSERT ON cuentas_contables
  FOR EACH ROW EXECUTE FUNCTION fn_cuenta_entra_al_costo_default();

COMMENT ON COLUMN cuentas_contables.entra_al_costo IS
  'Los gastos de esta cuenta forman parte del costo de los productos (piso de precio y punto de equilibrio por unidad). Financiamiento, impuestos, inversión, retiros y diezmo quedan fuera: se pagan con la utilidad.';

-- 2. Peso de cada estación en el uso del negocio ---------------------------
CREATE TABLE IF NOT EXISTS pesos_estacion (
  sucursal_id    UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  estacion       TEXT NOT NULL,
  peso           NUMERIC(6,2) NOT NULL CHECK (peso >= 0 AND peso <= 20),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sucursal_id, estacion)
);
COMMENT ON TABLE pesos_estacion IS
  'Cuánto del local y del tiempo consume un producto según dónde se prepara. Solo sirve para repartir los gastos fijos costeables (piso de precio), nunca para cobrar.';
GRANT SELECT, INSERT, UPDATE, DELETE ON pesos_estacion TO cafeteria_app;

CREATE OR REPLACE FUNCTION fn_costeo_semilla(p_sucursal_id UUID) RETURNS VOID AS $$
BEGIN
  INSERT INTO pesos_estacion (sucursal_id, estacion, peso) VALUES
    (p_sucursal_id, 'barra',    1.00),   -- la prepara el barista
    (p_sucursal_id, 'parrilla', 1.50),   -- ocupa parrilla, gas y más tiempo
    (p_sucursal_id, 'caja',     0.25)    -- se toma del refrigerador y se cobra
  ON CONFLICT (sucursal_id, estacion) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE s RECORD;
BEGIN
  FOR s IN SELECT id FROM sucursales LOOP
    PERFORM fn_costeo_semilla(s.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION fn_costeo_semilla_trigger() RETURNS TRIGGER AS $$
BEGIN
  PERFORM fn_costeo_semilla(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_costeo_semilla ON sucursales;
CREATE TRIGGER trg_costeo_semilla AFTER INSERT ON sucursales FOR EACH ROW EXECUTE FUNCTION fn_costeo_semilla_trigger();

-- 3. Margen de contribución por categoría ----------------------------------
ALTER TABLE categorias_producto ADD COLUMN IF NOT EXISTS margen_contribucion NUMERIC(5,2);
ALTER TABLE categorias_producto DROP CONSTRAINT IF EXISTS chk_categorias_margen;
ALTER TABLE categorias_producto ADD CONSTRAINT chk_categorias_margen
  CHECK (margen_contribucion IS NULL OR (margen_contribucion > 0 AND margen_contribucion < 100));
COMMENT ON COLUMN categorias_producto.margen_contribucion IS
  'Margen de contribución objetivo de la categoría (%): de cada peso vendido, cuánto queda después de los insumos. precio = insumo / (1 - margen/100). NULL = usa el de la sede.';

-- El margen del producto cambia de significado: era "% de ganancia sobre el
-- costo" (podía ser 200); ahora es margen de contribución (< 100).
ALTER TABLE productos DROP CONSTRAINT IF EXISTS chk_productos_margen;
ALTER TABLE productos ADD CONSTRAINT chk_productos_margen
  CHECK (margen_porcentaje IS NULL OR (margen_porcentaje > 0 AND margen_porcentaje < 100));
COMMENT ON COLUMN productos.margen_porcentaje IS
  'Margen de contribución propio de este producto (%). NULL = usa el de su categoría y, si tampoco tiene, el de la sede.';
COMMENT ON COLUMN configuracion_margen.porcentaje_ganancia_normal IS
  'Margen de contribución general de la sede (%), para productos y categorías sin margen propio.';

-- 4. Siembra desde los precios de HOY, para que nada se mueva --------------
-- Contribución real de un producto con su precio de lista: (precio - insumo) / precio.
CREATE OR REPLACE FUNCTION fn_contribucion_actual(p_producto_id UUID) RETURNS NUMERIC AS $$
  SELECT CASE
           WHEN p.precio_base IS NULL OR p.precio_base <= 0 THEN NULL
           WHEN fn_costo_teorico_producto(p.id) IS NULL THEN NULL
           WHEN fn_costo_teorico_producto(p.id) >= p.precio_base THEN NULL  -- se vende bajo costo: que lo revise
           -- se trunca (no se redondea) para que el precio calculado con este
           -- margen nunca quede por ENCIMA del precio actual y el redondeo
           -- hacia arriba no lo empuje un peso
           ELSE FLOOR(10000 * (p.precio_base - fn_costo_teorico_producto(p.id)) / p.precio_base) / 100
         END
  FROM productos p WHERE p.id = p_producto_id;
$$ LANGUAGE sql STABLE;
COMMENT ON FUNCTION fn_contribucion_actual(UUID) IS 'Margen de contribución que hoy deja el precio de lista del producto (%). NULL si no tiene precio o si se vende por debajo del costo.';

DO $$
DECLARE v_semilla BOOLEAN;
BEGIN
  -- Solo la primera vez: si alguna categoría ya tiene margen, la decisión ya
  -- la tomó el administrador y no se vuelve a tocar.
  SELECT NOT EXISTS (SELECT 1 FROM categorias_producto WHERE margen_contribucion IS NOT NULL) INTO v_semilla;
  IF NOT v_semilla THEN RETURN; END IF;

  -- a) cada producto conserva EXACTAMENTE el margen que hoy deja su precio
  --    (con dos decimales: redondear al entero movería el sugerido un peso)
  UPDATE productos p
     SET margen_porcentaje = LEAST(GREATEST(fn_contribucion_actual(p.id), 1), 95)
   WHERE p.activo AND fn_contribucion_actual(p.id) IS NOT NULL;
  -- lo que quedó con el significado viejo (markup, puede pasar de 100) se limpia
  UPDATE productos SET margen_porcentaje = NULL WHERE margen_porcentaje IS NOT NULL AND margen_porcentaje >= 100;

  -- b) cada categoría toma la mediana de sus productos: es lo que heredarán
  --    los productos nuevos y la referencia contra la que comparar
  UPDATE categorias_producto c
     SET margen_contribucion = sub.mediana
    FROM (
      SELECT p.categoria_id,
             LEAST(GREATEST(ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY fn_contribucion_actual(p.id))), 1), 95) AS mediana
      FROM productos p
      WHERE p.activo AND fn_contribucion_actual(p.id) IS NOT NULL
      GROUP BY p.categoria_id
    ) sub
   WHERE sub.categoria_id = c.id AND sub.mediana IS NOT NULL;

  -- c) la sede toma la mediana de todo su catálogo
  UPDATE configuracion_margen cm
     SET porcentaje_ganancia_normal = sub.mediana
    FROM (
      SELECT p.sucursal_id,
             LEAST(GREATEST(ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY fn_contribucion_actual(p.id))), 1), 95) AS mediana
      FROM productos p
      WHERE p.activo AND fn_contribucion_actual(p.id) IS NOT NULL
      GROUP BY p.sucursal_id
    ) sub
   WHERE sub.sucursal_id = cm.sucursal_id AND sub.mediana IS NOT NULL;
END $$;

-- Cualquier sede sin catálogo que sembrar queda con un margen válido.
UPDATE configuracion_margen SET porcentaje_ganancia_normal = 60
 WHERE porcentaje_ganancia_normal IS NULL OR porcentaje_ganancia_normal >= 100 OR porcentaje_ganancia_normal <= 0;

-- 5. Gastos fijos que SÍ son costo del producto ----------------------------
CREATE OR REPLACE FUNCTION fn_gastos_fijos_costeables_mes(p_sucursal_id UUID) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(g.monto_mensual), 0)
  FROM gastos_fijos g
  LEFT JOIN cuentas_contables c ON c.id = g.cuenta_contable_id
  WHERE g.activo AND g.sucursal_id = p_sucursal_id
    AND COALESCE(c.entra_al_costo, true);   -- sin cuenta asignada: se asume operación
$$ LANGUAGE sql STABLE;
COMMENT ON FUNCTION fn_gastos_fijos_costeables_mes(UUID) IS 'Gastos fijos del mes que son costo de operar (sin préstamo, sueldo del dueño ni lo que se haya marcado fuera del costo).';

-- 6. Reparto por estación, con la mezcla real de ventas --------------------
CREATE OR REPLACE FUNCTION fn_costo_indirecto_producto(p_producto_id UUID) RETURNS NUMERIC AS $$
DECLARE
  v_sede UUID; v_estacion TEXT; v_peso NUMERIC; v_fijos NUMERIC;
  v_unidades_peso NUMERIC; v_estimadas INTEGER; v_peso_promedio NUMERIC;
BEGIN
  SELECT p.sucursal_id, COALESCE(p.estacion, 'barra') INTO v_sede, v_estacion
    FROM productos p WHERE p.id = p_producto_id;
  IF v_sede IS NULL THEN RETURN NULL; END IF;

  v_fijos := fn_gastos_fijos_costeables_mes(v_sede);
  IF v_fijos IS NULL OR v_fijos = 0 THEN RETURN 0; END IF;
  v_peso := COALESCE((SELECT peso FROM pesos_estacion WHERE sucursal_id = v_sede AND estacion = v_estacion), 1);

  -- Unidades "ponderadas" realmente vendidas en los últimos 30 días.
  SELECT COALESCE(SUM(pi.cantidad * COALESCE(pz.peso, 1)), 0) INTO v_unidades_peso
    FROM pedido_items pi
    JOIN pedidos ped ON ped.id = pi.pedido_id
    LEFT JOIN productos pr ON pr.id = pi.producto_id
    LEFT JOIN pesos_estacion pz ON pz.sucursal_id = v_sede AND pz.estacion = COALESCE(pr.estacion, 'barra')
   WHERE ped.sucursal_id = v_sede
     AND NOT ped.cancelado AND NOT ped.no_show
     AND pi.estado <> 'cancelado'
     AND ped.creado_en >= now() - INTERVAL '30 days';

  -- Sin historia suficiente (sede nueva) se supone que se venderá de cada
  -- producto por igual: el volumen estimado en Costos repartido con el peso
  -- promedio del catálogo. En cuanto haya 30 días de ventas, manda la mezcla
  -- real. En ambos casos lo repartido suma los gastos costeables del mes.
  IF v_unidades_peso < 30 THEN
    SELECT unidades_estimadas_mes INTO v_estimadas FROM configuracion_margen
     WHERE sucursal_id = v_sede ORDER BY actualizado_en DESC LIMIT 1;
    IF v_estimadas IS NULL OR v_estimadas = 0 THEN RETURN NULL; END IF;
    SELECT COALESCE(AVG(COALESCE(pz.peso, 1)), 1) INTO v_peso_promedio
      FROM productos pr
      LEFT JOIN pesos_estacion pz ON pz.sucursal_id = v_sede AND pz.estacion = COALESCE(pr.estacion, 'barra')
     WHERE pr.sucursal_id = v_sede AND pr.activo;
    IF v_peso_promedio IS NULL OR v_peso_promedio = 0 THEN RETURN ROUND(v_fijos / v_estimadas, 4); END IF;
    RETURN ROUND(v_fijos * v_peso / (v_estimadas * v_peso_promedio), 4);
  END IF;

  RETURN ROUND(v_fijos * v_peso / v_unidades_peso, 4);
END;
$$ LANGUAGE plpgsql STABLE;
COMMENT ON FUNCTION fn_costo_indirecto_producto(UUID) IS 'Parte de los gastos fijos costeables que le toca a UNA unidad de este producto, repartida por el peso de su estación sobre la mezcla real de los últimos 30 días. Es el piso del precio, no un recargo que se cobre con margen.';

-- 7. Margen que aplica a un producto: propio → categoría → sede ------------
CREATE OR REPLACE FUNCTION fn_margen_contribucion_producto(p_producto_id UUID) RETURNS NUMERIC AS $$
  SELECT LEAST(GREATEST(COALESCE(p.margen_porcentaje, c.margen_contribucion, cm.porcentaje_ganancia_normal, 60), 1), 95)
  FROM productos p
  LEFT JOIN categorias_producto c ON c.id = p.categoria_id
  LEFT JOIN LATERAL (
    SELECT porcentaje_ganancia_normal FROM configuracion_margen m
     WHERE m.sucursal_id = p.sucursal_id ORDER BY m.actualizado_en DESC LIMIT 1
  ) cm ON true
  WHERE p.id = p_producto_id;
$$ LANGUAGE sql STABLE;
COMMENT ON FUNCTION fn_margen_contribucion_producto(UUID) IS 'Margen de contribución que aplica a este producto: el suyo, si no el de su categoría, si no el de la sede.';

-- 8. El precio sugerido ----------------------------------------------------
CREATE OR REPLACE FUNCTION fn_precio_sugerido(p_producto_id UUID) RETURNS NUMERIC AS $$
DECLARE
  v_costo NUMERIC; v_margen NUMERIC; v_redondeo NUMERIC; v_precio NUMERIC; v_piso NUMERIC;
BEGIN
  v_costo := COALESCE(fn_costo_teorico_producto(p_producto_id), 0);
  v_margen := fn_margen_contribucion_producto(p_producto_id);
  SELECT redondeo INTO v_redondeo FROM configuracion_margen
   WHERE sucursal_id = (SELECT sucursal_id FROM productos WHERE id = p_producto_id)
   ORDER BY actualizado_en DESC LIMIT 1;
  v_redondeo := COALESCE(v_redondeo, 1);

  -- De cada peso vendido, `margen`% queda después de pagar los insumos.
  v_precio := v_costo / (1 - v_margen / 100.0);
  -- Nunca por debajo de lo que cuesta producirlo con su parte de gastos fijos.
  v_piso := v_costo + COALESCE(fn_costo_indirecto_producto(p_producto_id), 0);
  v_precio := GREATEST(v_precio, v_piso);

  RETURN CEIL(v_precio / v_redondeo) * v_redondeo;
END;
$$ LANGUAGE plpgsql STABLE;
COMMENT ON FUNCTION fn_precio_sugerido(UUID) IS 'Precio por margen de contribución: insumo / (1 - margen). Nunca por debajo del piso (insumo + su parte de gastos fijos costeables). Los gastos fijos ya NO se cobran con margen encima.';

-- El "costo total" de un producto sigue existiendo (es el piso), pero ahora
-- cada producto carga lo suyo, no un promedio plano.
CREATE OR REPLACE FUNCTION fn_costo_total_unitario(p_producto_id UUID) RETURNS NUMERIC AS $$
  SELECT COALESCE(fn_costo_teorico_producto(p_producto_id), 0)
       + COALESCE(fn_costo_indirecto_producto(p_producto_id), 0);
$$ LANGUAGE sql STABLE;

-- 9. Huella de revisión de precios ----------------------------------------
-- Ya no incluye el costo indirecto por unidad (ahora depende de la mezcla real
-- de ventas y cambiaría todos los días, reviviendo el catálogo sin motivo).
-- Incluye lo que SÍ son decisiones: la receta, los costos de los insumos, el
-- margen que aplica y el redondeo, más los gastos fijos costeables y el peso
-- de la estación, que mueven el piso.
CREATE OR REPLACE FUNCTION fn_revision_precio(p_producto_id UUID) RETURNS TEXT AS $$
SELECT md5(jsonb_build_object(
  'receta', (SELECT to_jsonb(r) - ARRAY['actualizado_por','actualizado_en','creado_en','id','producto_id'] FROM recetas r WHERE r.producto_id=p.id),
  'leche_base_ml', CASE WHEN p.permite_leche THEN fn_leche_ml_receta(p.id,(SELECT id FROM opciones_tamano WHERE sucursal_id=p.sucursal_id AND codigo='12')) END,
  'fijos', (SELECT jsonb_agg(jsonb_build_array(f.materia_prima_id,f.cantidad,f.unidad) ORDER BY f.materia_prima_id)
            FROM receta_insumos_fijos f WHERE f.producto_id=p.id),
  'insumos', (SELECT jsonb_agg(jsonb_build_array(m.id,m.costo_unitario,m.unidad) ORDER BY m.id)
              FROM materias_primas m WHERE m.sucursal_id=p.sucursal_id AND m.id IN (
    SELECT f.materia_prima_id FROM receta_insumos_fijos f WHERE f.producto_id=p.id
    UNION SELECT oc.materia_prima_id FROM opciones_cafe oc
      WHERE oc.sucursal_id=p.sucursal_id AND oc.codigo='tradicional'
    UNION SELECT ol.materia_prima_id FROM opciones_leche ol
      WHERE ol.sucursal_id=p.sucursal_id AND p.permite_leche AND ol.codigo='entera'
    UNION SELECT e.materia_prima_vaso_id FROM tamano_empaque e JOIN opciones_tamano t ON t.id=e.tamano_id
      WHERE t.sucursal_id=p.sucursal_id AND t.codigo='12'
        AND e.variante=CASE WHEN p.tipo='frappe' THEN 'frappe' WHEN p.es_frio THEN 'fria' ELSE 'caliente' END
    UNION SELECT e.materia_prima_tapa_id FROM tamano_empaque e JOIN opciones_tamano t ON t.id=e.tamano_id
      WHERE t.sucursal_id=p.sucursal_id AND t.codigo='12'
        AND e.variante=CASE WHEN p.tipo='frappe' THEN 'frappe' WHEN p.es_frio THEN 'fria' ELSE 'caliente' END
  )),
  -- Decisiones de Admin → Costos que mueven el sugerido o su piso.
  'margen', fn_margen_contribucion_producto(p.id),
  'piso', jsonb_build_array(
            fn_gastos_fijos_costeables_mes(p.sucursal_id),
            COALESCE((SELECT peso FROM pesos_estacion WHERE sucursal_id=p.sucursal_id AND estacion=COALESCE(p.estacion,'barra')), 1)),
  'redondeo', (SELECT cm.redondeo FROM configuracion_margen cm WHERE cm.sucursal_id=p.sucursal_id
               ORDER BY cm.actualizado_en DESC LIMIT 1)
)::text) FROM productos p WHERE p.id=p_producto_id;
$$ LANGUAGE sql STABLE;
COMMENT ON FUNCTION fn_revision_precio(UUID) IS
  'Huella de lo que sostiene el precio sugerido: receta, ingredientes y sus costos, margen de contribución aplicado, redondeo y lo que mueve el piso (gastos fijos costeables y peso de la estación). Cambia → el producto vuelve a "precios por revisar".';

-- 10. Vistas ---------------------------------------------------------------
-- "Precios por revisar" ahora explica de dónde sale el sugerido: qué margen se
-- aplicó, de dónde viene (producto / categoría / sede) y si mandó el piso.
DROP VIEW IF EXISTS vw_precios_por_revisar;
CREATE VIEW vw_precios_por_revisar AS
SELECT
  p.sucursal_id,
  p.id,
  p.nombre,
  p.icono,
  p.precio_base,
  fn_costo_teorico_producto(p.id)                                   AS costo_directo,
  fn_costo_indirecto_producto(p.id)                                 AS costo_indirecto_unitario,
  fn_costo_total_unitario(p.id)                                     AS costo_total,
  fn_margen_contribucion_producto(p.id)                             AS margen_aplicado,
  (p.margen_porcentaje IS NOT NULL)                                 AS margen_propio,
  cat.margen_contribucion                                           AS margen_categoria,
  cat.nombre                                                        AS categoria_nombre,
  CASE WHEN p.margen_porcentaje IS NOT NULL THEN 'producto'
       WHEN cat.margen_contribucion IS NOT NULL THEN 'categoria'
       ELSE 'sede' END                                              AS margen_origen,
  fn_contribucion_actual(p.id)                                      AS margen_actual,
  -- el piso mandó cuando el margen solo no alcanzaba a pagar los fijos
  (fn_costo_total_unitario(p.id) > fn_costo_teorico_producto(p.id) / (1 - fn_margen_contribucion_producto(p.id)/100.0)) AS piso_manda,
  fn_precio_sugerido(p.id)                                          AS precio_sugerido,
  ROUND(fn_precio_sugerido(p.id) - p.precio_base, 2)                AS diferencia
FROM productos p
LEFT JOIN categorias_producto cat ON cat.id = p.categoria_id
WHERE p.activo AND (p.tipo NOT IN ('snack','alimento') OR EXISTS (SELECT 1 FROM receta_insumos_fijos f WHERE f.producto_id = p.id));
GRANT SELECT ON vw_precios_por_revisar TO cafeteria_app;

-- Desglose de costo de un producto: el indirecto ahora es el SUYO.
DROP VIEW IF EXISTS vw_desglose_costo_producto;
CREATE VIEW vw_desglose_costo_producto AS
SELECT
  p.sucursal_id,
  p.id,
  p.nombre,
  p.precio_base,
  fn_precio_efectivo(p.id)                                AS precio_actual,
  fn_costo_teorico_producto(p.id)                         AS costo_directo,
  fn_costo_indirecto_producto(p.id)                       AS costo_indirecto_unitario,
  fn_costo_total_unitario(p.id)                           AS costo_total,
  fn_precio_punto_equilibrio(p.id)                        AS precio_punto_equilibrio,
  fn_margen_contribucion_producto(p.id)                   AS margen_aplicado,
  fn_contribucion_actual(p.id)                            AS margen_actual,
  fn_precio_sugerido(p.id)                                AS precio_sugerido,
  fn_precio_efectivo(p.id) - fn_costo_teorico_producto(p.id) AS contribucion_unitaria,
  fn_precio_efectivo(p.id) - fn_costo_total_unitario(p.id)   AS utilidad_real_estimada
FROM productos p
WHERE p.activo
ORDER BY p.nombre;
GRANT SELECT ON vw_desglose_costo_producto TO cafeteria_app;

-- Punto de equilibrio del mes: con la mezcla real, ¿la contribución paga los
-- gastos fijos? Aquí entran TODOS los fijos (también el préstamo y el sueldo
-- del dueño): el negocio los tiene que pagar aunque no sean costo del producto.
DROP VIEW IF EXISTS vw_punto_equilibrio_negocio;
CREATE VIEW vw_punto_equilibrio_negocio AS
WITH ventas AS (
  SELECT ped.sucursal_id,
         SUM(pi.cantidad * pi.precio_unitario)                                AS venta,
         SUM(pi.cantidad * COALESCE(fn_costo_teorico_producto(pi.producto_id), 0)) AS costo_directo,
         SUM(pi.cantidad)                                                     AS unidades
  FROM pedido_items pi
  JOIN pedidos ped ON ped.id = pi.pedido_id
  WHERE NOT ped.cancelado AND NOT ped.no_show AND pi.estado <> 'cancelado'
    AND ped.creado_en >= now() - INTERVAL '30 days'
  GROUP BY ped.sucursal_id
)
SELECT
  s.id                                                      AS sucursal_id,
  s.nombre                                                  AS sucursal,
  COALESCE(v.unidades, 0)                                   AS unidades_30_dias,
  COALESCE(v.venta, 0)                                      AS venta_30_dias,
  COALESCE(v.venta - v.costo_directo, 0)                    AS contribucion_30_dias,
  CASE WHEN COALESCE(v.venta, 0) > 0
       THEN ROUND(100 * (v.venta - v.costo_directo) / v.venta, 2) END AS margen_contribucion_real,
  fn_gastos_fijos_totales_mes(s.id)                         AS gastos_fijos_mes,
  fn_gastos_fijos_costeables_mes(s.id)                      AS gastos_fijos_costeables_mes,
  COALESCE(v.venta - v.costo_directo, 0) - fn_gastos_fijos_totales_mes(s.id) AS utilidad_estimada_mes,
  -- venta necesaria = gastos fijos / margen de contribución real
  CASE WHEN COALESCE(v.venta, 0) > 0 AND v.venta > v.costo_directo
       THEN ROUND(fn_gastos_fijos_totales_mes(s.id) * v.venta / (v.venta - v.costo_directo), 2) END AS venta_equilibrio_mes
FROM sucursales s
LEFT JOIN ventas v ON v.sucursal_id = s.id
WHERE s.activo;
GRANT SELECT ON vw_punto_equilibrio_negocio TO cafeteria_app;

COMMIT;
