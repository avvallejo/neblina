-- ============================================================================
-- MIGRACIÓN 13 — FLUJO INVENTARIO → RECETA → COSTO → PRECIO → MENÚ
-- ============================================================================
-- Automatiza la cadena completa: al dar de alta materias primas y armar la
-- receta de un producto, el sistema calcula solo su costo prorrateado
-- (directo + indirecto); el administrador únicamente decide el MARGEN y
-- acepta el precio sugerido. Cuando el costo de un insumo cambia, el precio
-- del menú NO cambia solo: la vista de "precios por revisar" marca los
-- productos cuyo precio ya no cuadra con su costo, para repreciarlos con un
-- clic (decisión de diseño: avisar, no sorprender al cliente).
--
-- Requiere 00-12. Re-ejecutable.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. MARGEN POR PRODUCTO (opcional). NULL = usa el margen de su sucursal.
-- ----------------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS margen_porcentaje NUMERIC(6,2);
ALTER TABLE productos DROP CONSTRAINT IF EXISTS chk_productos_margen;
ALTER TABLE productos ADD CONSTRAINT chk_productos_margen
  CHECK (margen_porcentaje IS NULL OR (margen_porcentaje > 0 AND margen_porcentaje <= 1000));
COMMENT ON COLUMN productos.margen_porcentaje IS 'Margen de ganancia propio de este producto (%). NULL = usa el margen general de su sucursal (configuracion_margen).';

-- ----------------------------------------------------------------------------
-- 2. fn_precio_sugerido ahora respeta el margen del producto (si lo tiene)
--    y cae al margen general de SU sucursal si no.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_precio_sugerido(p_producto_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_costo    NUMERIC;
  v_margen   NUMERIC;
  v_redondeo NUMERIC;
  v_precio   NUMERIC;
  v_margen_producto NUMERIC;
  v_sucursal UUID;
BEGIN
  SELECT margen_porcentaje, sucursal_id INTO v_margen_producto, v_sucursal
  FROM productos WHERE id = p_producto_id;

  v_costo := fn_costo_total_unitario(p_producto_id);
  SELECT porcentaje_ganancia_normal, redondeo INTO v_margen, v_redondeo
  FROM configuracion_margen
  WHERE sucursal_id = v_sucursal
  ORDER BY actualizado_en DESC LIMIT 1;
  v_margen := COALESCE(v_margen_producto, v_margen, 60);
  v_redondeo := COALESCE(v_redondeo, 1);
  v_precio := v_costo * (1 + v_margen / 100.0);
  RETURN CEIL(v_precio / v_redondeo) * v_redondeo;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- 3. PRECIOS POR REVISAR: productos activos cuyo precio de menú ya no
--    corresponde al costo actual + su margen. (Los snacks se excluyen: su
--    costo se estima como % de su propio precio, sería circular.)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_precios_por_revisar;
CREATE VIEW vw_precios_por_revisar AS
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
WHERE p.activo AND p.tipo <> 'snack';
COMMENT ON VIEW vw_precios_por_revisar IS 'Costo actual, margen aplicado y precio sugerido por producto. La API/el panel filtran diferencia <> 0 para avisar qué precios del menú conviene repreciar (el precio nunca cambia solo).';

COMMIT;
