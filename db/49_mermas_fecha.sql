-- Conserva la fecha real de captura y separa el día al que corresponde la pérdida.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE mermas ADD COLUMN fecha_contable DATE;
UPDATE mermas SET fecha_contable = (creado_en AT TIME ZONE 'America/Mexico_City')::date;
ALTER TABLE mermas ALTER COLUMN fecha_contable SET DEFAULT ((now() AT TIME ZONE 'America/Mexico_City')::date);
ALTER TABLE mermas ALTER COLUMN fecha_contable SET NOT NULL;
CREATE INDEX idx_mermas_sucursal_fecha ON mermas(sucursal_id, fecha_contable);
COMMIT;
