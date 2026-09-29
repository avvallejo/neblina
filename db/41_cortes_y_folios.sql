BEGIN;

CREATE SEQUENCE IF NOT EXISTS egresos_folio_seq;
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS folio TEXT;
ALTER TABLE egresos ADD COLUMN IF NOT EXISTS tiene_comprobante BOOLEAN;
ALTER TABLE egresos ALTER COLUMN folio SET DEFAULT ('N-' || lpad(nextval('egresos_folio_seq')::text, 8, '0'));
UPDATE egresos SET folio = DEFAULT WHERE folio IS NULL;
ALTER TABLE egresos ALTER COLUMN folio SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_egresos_folio ON egresos(folio);
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS corte JSONB;
CREATE SEQUENCE IF NOT EXISTS turnos_corte_folio_seq;
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS folio_corte TEXT;
ALTER TABLE turnos ALTER COLUMN folio_corte SET DEFAULT ('C-' || nextval('turnos_corte_folio_seq')::text);
UPDATE turnos SET folio_corte = DEFAULT WHERE folio_corte IS NULL;
ALTER TABLE turnos ALTER COLUMN folio_corte SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_turnos_folio_corte ON turnos(folio_corte);

-- El folio interno nunca cambia ni se reutiliza. El folio del proveedor
-- se comprueba también en Contabilidad, no solo en el formulario de Caja.
CREATE OR REPLACE FUNCTION fn_comprobante_unico() RETURNS TRIGGER AS $$
DECLARE v_ref TEXT; v_folio TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.folio IS DISTINCT FROM OLD.folio THEN
      RAISE EXCEPTION 'El folio de la nota no se puede cambiar.' USING ERRCODE = '22023';
    END IF;
    IF (NEW.referencia, NEW.proveedor_id, NEW.anulado) IS NOT DISTINCT FROM
       (OLD.referencia, OLD.proveedor_id, OLD.anulado) THEN RETURN NEW; END IF;
  END IF;
  v_ref := upper(regexp_replace(btrim(COALESCE(NEW.referencia,'')), '\s+', ' ', 'g'));
  IF v_ref = '' OR NEW.anulado THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.sucursal_id::text || ':nota:' || v_ref, 0));
  SELECT e.folio INTO v_folio FROM egresos e
    WHERE e.sucursal_id = NEW.sucursal_id AND e.id <> NEW.id AND NOT e.anulado
      AND (upper(e.folio) = v_ref OR
        (e.proveedor_id IS NOT DISTINCT FROM NEW.proveedor_id AND
         upper(regexp_replace(btrim(COALESCE(e.referencia,'')), '\s+', ' ', 'g')) = v_ref))
    LIMIT 1;
  IF v_folio IS NOT NULL THEN
    RAISE EXCEPTION 'Este comprobante ya está registrado con el folio %. Búscalo antes de capturarlo de nuevo.', v_folio USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_comprobante_unico ON egresos;
CREATE TRIGGER trg_comprobante_unico BEFORE INSERT OR UPDATE ON egresos
  FOR EACH ROW EXECUTE FUNCTION fn_comprobante_unico();

-- Un cobro normal espera al corte en curso y no puede caer en un turno
-- que acaba de cerrarse. Los registros históricos conservan su tratamiento.
CREATE OR REPLACE FUNCTION fn_turno_cobro() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cobrado AND (TG_OP='INSERT' OR NOT OLD.cobrado) THEN
    IF NEW.registro_manual THEN NEW.turno_cobro_id:=NEW.turno_id;
    ELSE
      SELECT id INTO NEW.turno_cobro_id FROM turnos
        WHERE sucursal_id=NEW.sucursal_id AND cerrado_en IS NULL FOR SHARE;
      IF NEW.turno_cobro_id IS NULL THEN
        RAISE EXCEPTION 'El turno está cerrado. Abre un turno antes de cobrar.' USING ERRCODE='22023';
      END IF;
    END IF;
    IF NEW.metodo_pago='efectivo' THEN NEW.importe_efectivo:=NEW.total;
    ELSIF NEW.metodo_pago<>'mixto' THEN NEW.importe_efectivo:=0; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

GRANT USAGE, SELECT ON SEQUENCE egresos_folio_seq TO cafeteria_app;
GRANT USAGE, SELECT ON SEQUENCE turnos_corte_folio_seq TO cafeteria_app;
COMMIT;
