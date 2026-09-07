BEGIN;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS revision_precio_aceptada TEXT;

-- Solo receta e insumos: ventas, existencias y reparto de gastos fijos no
-- invalidan la decisión de conservar el precio.
CREATE OR REPLACE FUNCTION fn_revision_precio(p_producto_id UUID) RETURNS TEXT AS $$
SELECT md5(jsonb_build_object(
  'receta', (SELECT to_jsonb(r) - 'actualizado_por' FROM recetas r WHERE r.producto_id=p.id),
  'fijos', (SELECT jsonb_agg(jsonb_build_array(f.materia_prima_id,f.cantidad,f.unidad) ORDER BY f.materia_prima_id)
            FROM receta_insumos_fijos f WHERE f.producto_id=p.id),
  'insumos', (SELECT jsonb_agg(jsonb_build_array(m.id,m.costo_unitario,m.unidad) ORDER BY m.id)
              FROM materias_primas m WHERE m.sucursal_id=p.sucursal_id AND m.id IN (
    SELECT f.materia_prima_id FROM receta_insumos_fijos f WHERE f.producto_id=p.id
    UNION SELECT oc.materia_prima_id FROM opciones_cafe oc
      WHERE oc.sucursal_id=p.sucursal_id AND (p.permite_tipo_cafe OR oc.codigo='tradicional')
    UNION SELECT ol.materia_prima_id FROM opciones_leche ol
      WHERE ol.sucursal_id=p.sucursal_id AND p.permite_leche
    UNION SELECT e.materia_prima_vaso_id FROM tamano_empaque e JOIN opciones_tamano t ON t.id=e.tamano_id
      WHERE t.sucursal_id=p.sucursal_id AND p.permite_tamanos
        AND e.variante=CASE WHEN p.tipo='frappe' THEN 'frappe' WHEN p.es_frio THEN 'fria' ELSE 'caliente' END
    UNION SELECT e.materia_prima_tapa_id FROM tamano_empaque e JOIN opciones_tamano t ON t.id=e.tamano_id
      WHERE t.sucursal_id=p.sucursal_id AND p.permite_tamanos
        AND e.variante=CASE WHEN p.tipo='frappe' THEN 'frappe' WHEN p.es_frio THEN 'fria' ELSE 'caliente' END
  ))
)::text) FROM productos p WHERE p.id=p_producto_id;
$$ LANGUAGE sql STABLE;
COMMIT;
