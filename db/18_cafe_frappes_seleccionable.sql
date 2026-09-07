-- Frappés existentes con café fijo: una sola base de 18 g y selección al vender.
-- Conserva los demás ingredientes, el precio de menú y los recargos de opciones.
BEGIN;
CREATE TEMP TABLE cafe_frappes_a_corregir ON COMMIT DROP AS
SELECT p.id, p.sucursal_id,
       jsonb_build_object('producto',to_jsonb(p),'receta',to_jsonb(r),
         'insumos_fijos',(SELECT jsonb_agg(to_jsonb(f)) FROM receta_insumos_fijos f WHERE f.producto_id=p.id)) AS anterior
FROM productos p JOIN recetas r ON r.producto_id=p.id
WHERE p.tipo='frappe' AND EXISTS (
  SELECT 1 FROM receta_insumos_fijos f JOIN opciones_cafe oc ON oc.materia_prima_id=f.materia_prima_id
  WHERE f.producto_id=p.id AND oc.sucursal_id=p.sucursal_id
);

UPDATE productos SET permite_tipo_cafe=true WHERE id IN (SELECT id FROM cafe_frappes_a_corregir);
UPDATE recetas SET gramaje_por_shot=18, actualizado_en=now()
WHERE producto_id IN (SELECT id FROM cafe_frappes_a_corregir);
DELETE FROM receta_insumos_fijos f USING cafe_frappes_a_corregir t
WHERE f.producto_id=t.id AND EXISTS (
  SELECT 1 FROM opciones_cafe oc WHERE oc.materia_prima_id=f.materia_prima_id AND oc.sucursal_id=t.sucursal_id
);
INSERT INTO auditoria (entidad,entidad_id,accion,valor_anterior,valor_nuevo,motivo,sucursal_id)
SELECT 'recetas',t.id::text,'editar',t.anterior,
       jsonb_build_object('gramaje_por_shot',18,'permite_tipo_cafe',true,
         'insumos_fijos',(SELECT jsonb_agg(to_jsonb(f)) FROM receta_insumos_fijos f WHERE f.producto_id=t.id)),
       'Corrección: café seleccionable al vender frappés, 18 g por shot, sin café fijo duplicado',t.sucursal_id
FROM cafe_frappes_a_corregir t;
COMMIT;
