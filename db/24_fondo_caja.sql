BEGIN;
ALTER TABLE turnos ADD COLUMN fondo_inicial NUMERIC(10,2) CHECK(fondo_inicial>=0);
ALTER TABLE pedidos ADD COLUMN importe_efectivo NUMERIC(10,2) CHECK(importe_efectivo>=0 AND importe_efectivo<=total);
ALTER TABLE pedidos ADD COLUMN turno_cobro_id UUID REFERENCES turnos(id);
UPDATE pedidos SET importe_efectivo=CASE WHEN metodo_pago='efectivo' THEN total WHEN metodo_pago<>'mixto' THEN 0 END,turno_cobro_id=turno_id WHERE cobrado;
CREATE FUNCTION fn_turno_cobro() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cobrado AND (TG_OP='INSERT' OR NOT OLD.cobrado) THEN
    IF NEW.registro_manual THEN NEW.turno_cobro_id:=NEW.turno_id;
    ELSE SELECT id INTO NEW.turno_cobro_id FROM turnos WHERE sucursal_id=NEW.sucursal_id AND cerrado_en IS NULL; END IF;
    IF NEW.metodo_pago='efectivo' THEN NEW.importe_efectivo:=NEW.total;
    ELSIF NEW.metodo_pago<>'mixto' THEN NEW.importe_efectivo:=0; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
-- Orden alfabético: después de asignar turno de creación, antes del INSERT.
CREATE TRIGGER trg_z_turno_cobro BEFORE INSERT OR UPDATE ON pedidos FOR EACH ROW EXECUTE FUNCTION fn_turno_cobro();
COMMIT;
