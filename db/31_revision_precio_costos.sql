-- ============================================================================
-- MIGRACIÓN 31 — LA REVISIÓN DE PRECIOS TAMBIÉN DESPIERTA POR COSTOS INDIRECTOS
-- ============================================================================
-- "Mantener precio" guarda una huella (fn_revision_precio) de lo que sostenía
-- el precio sugerido; el producto vuelve a "precios por revisar" solo cuando esa
-- huella cambia. Desde la 19 la huella cubría receta e ingredientes, pero NO el
-- reparto de gastos fijos ni el margen del negocio: al cambiar en Costos las
-- unidades estimadas al mes, un gasto fijo, el margen general o el redondeo,
-- el precio sugerido de TODO el catálogo se movía sin avisar.
-- Ahora la huella incluye el costo indirecto por unidad de la sede
-- (gastos fijos ÷ unidades estimadas) y el margen/redondeo del negocio.
-- Siguen sin contar: existencias, el margen propio del producto (se ajusta
-- viendo el sugerido en "Costo y precio") e insumos ajenos a la receta.
-- Las decisiones guardadas quedan invalidadas a propósito: el sugerido que
-- sostenían pudo cambiar, así que cada producto con diferencia reaparece una
-- vez para volver a decidir. Requiere 00-30. Re-ejecutable.
-- ============================================================================
BEGIN;

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
  -- Costos del negocio (Admin → Costos): gastos fijos ÷ unidades estimadas,
  -- margen general y redondeo. Cualquier cambio ahí mueve el sugerido.
  'indirecto', fn_costo_fijo_unitario(p.sucursal_id),
  'negocio', (SELECT jsonb_build_array(cm.porcentaje_ganancia_normal, cm.redondeo)
              FROM configuracion_margen cm WHERE cm.sucursal_id=p.sucursal_id
              ORDER BY cm.actualizado_en DESC LIMIT 1)
)::text) FROM productos p WHERE p.id=p_producto_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_revision_precio(UUID) IS
  'Huella de lo que sostiene el precio sugerido: receta, ingredientes y sus costos, costo indirecto por unidad y margen/redondeo del negocio. Cambia → el producto vuelve a "precios por revisar".';

COMMIT;
