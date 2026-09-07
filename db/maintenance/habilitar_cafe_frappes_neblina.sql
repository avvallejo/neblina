-- Corrección solicitada para los tres frappés con base de café de 18 g.
-- Ejecutar explícitamente; no es una migración para otras cafeterías.
BEGIN;
CREATE TEMP TABLE objetivos ON COMMIT DROP AS
SELECT p.id,p.sucursal_id,to_jsonb(p) anterior FROM productos p
JOIN recetas r ON r.producto_id=p.id
WHERE p.sucursal_id='37bdb87a-b8f2-449c-8cca-9a4a2bd7b4a6'
  AND p.nombre IN ('Frappé Café','Frappé Oreo','Frappe Moka')
  AND p.tipo='frappe' AND p.activo AND r.gramaje_por_shot=18;
DO $$ BEGIN
  IF (SELECT count(*) FROM objetivos) <> 3 THEN RAISE EXCEPTION 'Revisar los tres frappés y su gramaje'; END IF;
  IF EXISTS (SELECT 1 FROM receta_insumos_fijos f JOIN objetivos o ON o.id=f.producto_id
      JOIN opciones_cafe c ON c.materia_prima_id=f.materia_prima_id AND c.sucursal_id=o.sucursal_id)
  THEN RAISE EXCEPTION 'Hay café fijo: revisar antes de habilitar para evitar doble descuento'; END IF;
END $$;
UPDATE productos SET permite_tipo_cafe=true WHERE id IN (SELECT id FROM objetivos);
INSERT INTO auditoria(entidad,entidad_id,accion,valor_anterior,valor_nuevo,motivo,sucursal_id)
SELECT 'productos',o.id::text,'editar',o.anterior,to_jsonb(p),
  'Solicitud: elegir café al vender frappés con base de 18 g',o.sucursal_id
FROM objetivos o JOIN productos p ON p.id=o.id WHERE (o.anterior->>'permite_tipo_cafe')::boolean=false;
COMMIT;
