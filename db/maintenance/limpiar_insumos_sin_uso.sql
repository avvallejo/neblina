-- Operación manual; NO es una migración. Vista previa por defecto.
\set ON_ERROR_STOP on
\if :{?sucursal_id}
\else
  \echo 'Falta -v sucursal_id=UUID. No se modificó nada.'
  \quit 1
\endif
\if :{?aplicar}
\else
  \set aplicar false
\endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Bloquea los insumos de esta sede para impedir nuevas referencias concurrentes.
SELECT id FROM materias_primas WHERE sucursal_id = :'sucursal_id'::uuid FOR UPDATE;
CREATE TEMP TABLE revision_insumos ON COMMIT DROP AS
SELECT m.id, m.nombre, m.stock_actual, m.unidad, m.activo,
         (SELECT COUNT(*) FROM lotes WHERE materia_prima_id = m.id)
         + (SELECT COUNT(*) FROM movimientos_inventario WHERE materia_prima_id = m.id)
         + (SELECT COUNT(*) FROM mermas WHERE materia_prima_id = m.id)
         + (SELECT COUNT(*) FROM opciones_leche WHERE materia_prima_id = m.id)
         + (SELECT COUNT(*) FROM opciones_cafe WHERE materia_prima_id = m.id)
         + (SELECT COUNT(*) FROM opciones_extra WHERE materia_prima_id = m.id)
         + (SELECT COUNT(*) FROM tamano_empaque WHERE materia_prima_vaso_id = m.id OR materia_prima_tapa_id = m.id)
         + (SELECT COUNT(*) FROM receta_insumos_fijos WHERE materia_prima_id = m.id) AS referencias
FROM materias_primas m WHERE m.sucursal_id = :'sucursal_id'::uuid;
SELECT *, CASE WHEN referencias = 0 THEN 'ELIMINABLE' ELSE 'CONSERVAR: historial o configuración' END AS resultado
FROM revision_insumos ORDER BY referencias, nombre;
\if :aplicar
  DELETE FROM materias_primas m USING revision_insumos r
  WHERE m.id = r.id AND m.sucursal_id = :'sucursal_id'::uuid AND r.referencias = 0
  RETURNING m.id, m.nombre, m.stock_actual, m.unidad;
  COMMIT;
\else
  ROLLBACK;
  \echo 'Vista previa: no se borró nada. Revise la lista antes de usar -v aplicar=true.'
\endif
