-- ============================================================================
-- CAFETERÍA MÓVIL — MIGRACIÓN 06: costos indirectos y punto de equilibrio
-- ============================================================================
-- Hasta la migración 05, fn_costo_teorico_producto / fn_precio_sugerido solo
-- contaban el costo VARIABLE (insumos: café, leche, vaso, tapa, etc.). Eso es
-- el "costo de receta" de la sección 14.1, pero NO es suficiente para fijar un
-- precio real: falta la parte de renta, sueldos, gasolina, servicios, etc.
-- (gastos fijos/indirectos) — sin ellos, el negocio puede vender por arriba
-- del costo de cada bebida y SEGUIR perdiendo dinero si esos gastos fijos no
-- están cubiertos. Esta migración agrega justo esa pieza.
-- Requiere 01-05 ya aplicados.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Gastos fijos / indirectos del negocio (renta, sueldos, gasolina,
--    servicios, seguros, etc.) — todo lo que se paga exista o no una venta.
-- ----------------------------------------------------------------------------
CREATE TABLE gastos_fijos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto        TEXT NOT NULL,
  categoria       TEXT NOT NULL DEFAULT 'Otro' CHECK (categoria IN ('Renta', 'Personal', 'Servicios', 'Transporte', 'Seguros', 'Mantenimiento', 'Otro')),
  monto_mensual   NUMERIC(12,2) NOT NULL CHECK (monto_mensual >= 0),
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE gastos_fijos IS 'Gastos que existen aunque no se venda nada (renta, sueldos, gasolina, servicios...). Sin esto, el precio sugerido solo cubre insumos y el negocio puede vender "con utilidad" en cada bebida y seguir perdiendo dinero en el mes.';

CREATE TRIGGER trg_touch_gastos_fijos BEFORE UPDATE ON gastos_fijos FOR EACH ROW EXECUTE FUNCTION fn_tocar_actualizado_en();

-- ----------------------------------------------------------------------------
-- 2. ¿Entre cuántas bebidas se reparte ese gasto fijo? Es una estimación de
--    volumen mensual que el administrador define (al abrir el negocio, una
--    meta; ya operando, puede calibrarla con vw_ventas_reales_promedio_mes).
-- ----------------------------------------------------------------------------
ALTER TABLE configuracion_margen
  ADD COLUMN IF NOT EXISTS unidades_estimadas_mes INTEGER CHECK (unidades_estimadas_mes IS NULL OR unidades_estimadas_mes > 0);
COMMENT ON COLUMN configuracion_margen.unidades_estimadas_mes IS 'Cuántas bebidas/productos esperas vender al mes. Sin este número no se puede prorratear el gasto fijo por unidad — es la pieza que convierte "gasto del negocio" en "costo por bebida".';

-- Para calibrar la estimación contra la realidad, sin que la función de precio
-- dependa de datos que todavía no existen en un negocio nuevo.
CREATE OR REPLACE VIEW vw_ventas_reales_promedio_mes AS
SELECT
  COUNT(*) AS unidades_periodo,
  MIN(p.creado_en)::date AS desde,
  MAX(p.creado_en)::date AS hasta,
  GREATEST(1, CEIL(EXTRACT(EPOCH FROM (MAX(p.creado_en) - MIN(p.creado_en))) / 86400.0 / 30.0)) AS meses_de_historia,
  ROUND(COUNT(*) / GREATEST(1, EXTRACT(EPOCH FROM (MAX(p.creado_en) - MIN(p.creado_en))) / 86400.0 / 30.0)) AS unidades_promedio_mes
FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id
WHERE NOT p.cancelado AND NOT pi.es_regalo;
COMMENT ON VIEW vw_ventas_reales_promedio_mes IS 'Promedio real de unidades vendidas al mes, para comparar contra configuracion_margen.unidades_estimadas_mes y calibrar la estimación con datos reales en vez de solo una meta.';

-- ----------------------------------------------------------------------------
-- 3. Costo fijo (indirecto) prorrateado por unidad — el corazón de este
--    cambio. Reparte TODOS los gastos fijos activos entre las unidades
--    estimadas, por igual entre todos los productos (modelo simple, el
--    estándar para un negocio chico; una mejora de Fase 2 sería prorratear
--    distinto por producto según su peso en ventas).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_gastos_fijos_totales_mes() RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(monto_mensual), 0) FROM gastos_fijos WHERE activo;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_costo_fijo_unitario() RETURNS NUMERIC AS $$
DECLARE
  v_unidades INTEGER;
BEGIN
  SELECT unidades_estimadas_mes INTO v_unidades FROM configuracion_margen ORDER BY actualizado_en DESC LIMIT 1;
  IF v_unidades IS NULL OR v_unidades = 0 THEN
    RETURN NULL; -- sin estimación de volumen no se puede prorratear con sentido
  END IF;
  RETURN ROUND(fn_gastos_fijos_totales_mes() / v_unidades, 4);
END;
$$ LANGUAGE plpgsql STABLE;
COMMENT ON FUNCTION fn_costo_fijo_unitario IS 'Cuánto de renta+sueldos+gasolina+servicios le toca cargar a CADA bebida, según el volumen mensual estimado. NULL si no se ha configurado unidades_estimadas_mes.';

-- Costo TOTAL por unidad = directo (insumos) + indirecto (prorrateo de gastos fijos).
-- Este es el costo real de "no perder dinero" — el verdadero punto de equilibrio.
CREATE OR REPLACE FUNCTION fn_costo_total_unitario(p_producto_id UUID) RETURNS NUMERIC AS $$
  SELECT fn_costo_teorico_producto(p_producto_id) + COALESCE(fn_costo_fijo_unitario(), 0);
$$ LANGUAGE sql STABLE;

-- Precio de equilibrio: el mínimo al que se puede vender SIN perder dinero
-- (utilidad = $0). Vender por debajo de esto significa que esa bebida en
-- particular no alcanza ni a pagar su parte de renta/sueldos/insumos.
CREATE OR REPLACE FUNCTION fn_precio_punto_equilibrio(p_producto_id UUID) RETURNS NUMERIC AS $$
  SELECT ROUND(fn_costo_total_unitario(p_producto_id), 2);
$$ LANGUAGE sql STABLE;

-- fn_precio_sugerido ahora parte del costo TOTAL (directo + indirecto), no
-- solo del insumo — así el margen configurado se aplica sobre el punto de
-- equilibrio real, no sobre una fracción del costo verdadero.
CREATE OR REPLACE FUNCTION fn_precio_sugerido(p_producto_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_costo    NUMERIC;
  v_margen   NUMERIC;
  v_redondeo NUMERIC;
  v_precio   NUMERIC;
BEGIN
  v_costo := fn_costo_total_unitario(p_producto_id);
  SELECT porcentaje_ganancia_normal, redondeo INTO v_margen, v_redondeo FROM configuracion_margen ORDER BY actualizado_en DESC LIMIT 1;
  v_margen := COALESCE(v_margen, 60);
  v_redondeo := COALESCE(v_redondeo, 1);
  v_precio := v_costo * (1 + v_margen / 100.0);
  RETURN CEIL(v_precio / v_redondeo) * v_redondeo;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- 4. Punto de equilibrio del NEGOCIO completo (no solo por producto): cuántas
--    bebidas hay que vender al mes (y al día) para cubrir los gastos fijos,
--    usando el margen de contribución promedio del catálogo activo.
--    Fórmula clásica: Punto de equilibrio = Costos fijos / Margen de contribución
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_punto_equilibrio_negocio AS
WITH contribucion AS (
  SELECT AVG(fn_precio_efectivo(p.id) - fn_costo_teorico_producto(p.id)) AS margen_contribucion_promedio
  FROM productos p WHERE p.activo
)
SELECT
  fn_gastos_fijos_totales_mes() AS gastos_fijos_mes,
  c.margen_contribucion_promedio,
  CASE WHEN c.margen_contribucion_promedio > 0
       THEN CEIL(fn_gastos_fijos_totales_mes() / c.margen_contribucion_promedio)
       ELSE NULL END AS unidades_punto_equilibrio_mes,
  CASE WHEN c.margen_contribucion_promedio > 0
       THEN CEIL(fn_gastos_fijos_totales_mes() / c.margen_contribucion_promedio / 30.0)
       ELSE NULL END AS unidades_punto_equilibrio_dia
FROM contribucion c;
COMMENT ON VIEW vw_punto_equilibrio_negocio IS 'Cuántas bebidas se necesitan vender al mes/día para cubrir los gastos fijos (renta, sueldos, etc.) con el margen de contribución promedio del catálogo activo. Si esto sale más alto de lo que realmente puedes vender en tu ubicación y horario, el negocio no es viable así como está configurado — es justo la pregunta que el punto de equilibrio responde antes de que te cueste dinero real.';

-- ----------------------------------------------------------------------------
-- 5. Desglose de costo por producto (directo, indirecto, precio de
--    equilibrio, precio sugerido) en una sola vista — para que Admin lo vea
--    de un vistazo en vez de llamar 3 funciones por producto.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_desglose_costo_producto AS
SELECT
  p.id, p.nombre, p.precio_base, fn_precio_efectivo(p.id) AS precio_actual,
  fn_costo_teorico_producto(p.id) AS costo_directo,
  fn_costo_fijo_unitario() AS costo_indirecto_unitario,
  fn_costo_total_unitario(p.id) AS costo_total,
  fn_precio_punto_equilibrio(p.id) AS precio_punto_equilibrio,
  fn_precio_sugerido(p.id) AS precio_sugerido,
  fn_precio_efectivo(p.id) - fn_costo_total_unitario(p.id) AS utilidad_real_estimada
FROM productos p
WHERE p.activo
ORDER BY p.nombre;

-- ----------------------------------------------------------------------------
-- 6. Datos de EJEMPLO — reemplázalos por los gastos reales de tu operación
--    antes de usar esto para fijar precios de verdad. Los montos y el volumen
--    estimado son solo para que el cálculo no arranque en $0 / sin datos.
-- ----------------------------------------------------------------------------
INSERT INTO gastos_fijos (concepto, categoria, monto_mensual) VALUES
  ('Renta del local / permiso de vía pública', 'Renta', 3500),
  ('Sueldo barista/cajero', 'Personal', 9000),
  ('Gasolina y mantenimiento del carrito', 'Transporte', 1800),
  ('Gas, agua y luz del carrito', 'Servicios', 900),
  ('Seguro del negocio', 'Seguros', 450);

UPDATE configuracion_margen SET unidades_estimadas_mes = 1200
WHERE id = (SELECT id FROM configuracion_margen ORDER BY actualizado_en DESC LIMIT 1);
