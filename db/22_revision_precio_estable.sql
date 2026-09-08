BEGIN;
-- Conservar las decisiones vigentes antes del cambio de formato.
CREATE TEMP TABLE revisiones_a_conservar ON COMMIT DROP AS
SELECT id FROM productos WHERE revision_precio_aceptada=fn_revision_precio(id);
-- Recuperación conservadora de decisiones invalidadas solo por nuevas opciones.
INSERT INTO revisiones_a_conservar
SELECT p.id FROM productos p JOIN (VALUES
('Capuchino','4b07c201e9e83d81000296ebd54addfd','32646f0dc065fb2024d69110cc2bba1e'),
('Americano','cbc0f905ca12519ce3c0a3a2e6af3c6e','177b5fcab2d11e6bc37a035e0f007283'),
('Espresso','a39adc4b620e8abe99402dd94489da10','8621f255b7c8b397c4609e033bf554e5'),
('Cortado','02c77e68cb40d48eeb19a37a8d1a3633','34d0286395aa3ef5e797640e0749b128'),
('Frappé Oreo','d1bec3f0e38baaa3610053925483b05c','5ba19163f5aa9aa210a5c6d5d81ee03c'),
('Frappe Moka','9a493efd2308d3367f7385689fd12d4f','0418ce88ddec635ae0efad56d69cdea0'),
('Frappé Café','912147ef514111f4469378cb4ecbeb17','0392cc9ba6e99cfcc5a2bc1061b75247'),
('Latte Helado','9a566202af2f2d2f1509085e0697f9c7','ceb01388cb77f37809a2b9917a45fe0d')) comprobadas(nombre,aceptada,actual) ON comprobadas.nombre=p.nombre
WHERE p.sucursal_id='37bdb87a-b8f2-449c-8cca-9a4a2bd7b4a6'
AND p.revision_precio_aceptada=comprobadas.aceptada AND fn_revision_precio(p.id)=comprobadas.actual;
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
  ))
)::text) FROM productos p WHERE p.id=p_producto_id;
$$ LANGUAGE sql STABLE;
UPDATE productos SET revision_precio_aceptada=fn_revision_precio(id) WHERE id IN (SELECT id FROM revisiones_a_conservar);
COMMIT;
