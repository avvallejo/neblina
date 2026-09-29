BEGIN;

CREATE OR REPLACE FUNCTION fn_turno_abierto_requerido(p_sucursal UUID) RETURNS UUID AS $$
DECLARE v_turno UUID;
BEGIN
  SELECT id INTO v_turno FROM turnos
    WHERE sucursal_id=p_sucursal AND cerrado_en IS NULL FOR SHARE;
  IF v_turno IS NULL THEN
    RAISE EXCEPTION 'Abre un turno y registra el fondo inicial antes de vender o cobrar.' USING ERRCODE='22023';
  END IF;
  RETURN v_turno;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_asignar_turno_abierto() RETURNS TRIGGER AS $$
DECLARE v_actual UUID; v_sucursal UUID; v_corte JSONB;
BEGIN
  v_actual := fn_turno_abierto_requerido(NEW.sucursal_id);
  IF NEW.registro_manual THEN
    -- La captura pide hora con precisión de minutos. Una venta del minuto
    -- en que se abrió la caja pertenece a ese turno, aunque abrió a :45 s.
    SELECT id,corte INTO NEW.turno_id,v_corte FROM turnos
      WHERE sucursal_id=NEW.sucursal_id AND date_trunc('minute',abierto_en)<=NEW.creado_en
        AND (cerrado_en IS NULL OR cerrado_en>=NEW.creado_en)
      ORDER BY abierto_en DESC LIMIT 1 FOR SHARE;
    IF NEW.turno_id IS NULL THEN
      RAISE EXCEPTION 'No había un turno registrado para la fecha y hora de esta venta. Revisa la fecha; la venta no se guardó.' USING ERRCODE='22023';
    END IF;
    IF v_corte IS NOT NULL THEN
      RAISE EXCEPTION 'El turno de esa venta ya tiene un corte guardado. No se puede agregar una venta a ese corte.' USING ERRCODE='22023';
    END IF;
  ELSIF NEW.turno_id IS NULL THEN
    NEW.turno_id := v_actual;
  ELSE
    SELECT sucursal_id INTO v_sucursal FROM turnos WHERE id=NEW.turno_id;
    IF v_sucursal IS DISTINCT FROM NEW.sucursal_id THEN
      RAISE EXCEPTION 'El turno pertenece a otra sucursal.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_turno_cobro() RETURNS TRIGGER AS $$
DECLARE v_actual UUID;
BEGIN
  IF NEW.cobrado AND (TG_OP='INSERT' OR NOT OLD.cobrado) THEN
    v_actual := fn_turno_abierto_requerido(NEW.sucursal_id);
    IF NEW.registro_manual THEN
      PERFORM id FROM turnos WHERE id=NEW.turno_id AND sucursal_id=NEW.sucursal_id AND corte IS NULL FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La venta requiere un turno válido sin corte guardado para su fecha.' USING ERRCODE='22023';
      END IF;
      NEW.turno_cobro_id := NEW.turno_id;
    ELSE
      NEW.turno_cobro_id := v_actual;
    END IF;
    IF NEW.metodo_pago='efectivo' THEN NEW.importe_efectivo:=NEW.total;
    ELSIF NEW.metodo_pago<>'mixto' THEN NEW.importe_efectivo:=0; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_turno_para_agregar_productos() RETURNS TRIGGER AS $$
DECLARE v_sucursal UUID;
BEGIN
  IF TG_OP='INSERT' OR NEW.cantidad>OLD.cantidad THEN
    SELECT sucursal_id INTO v_sucursal FROM pedidos WHERE id=NEW.pedido_id;
    IF v_sucursal IS NOT NULL THEN PERFORM fn_turno_abierto_requerido(v_sucursal); END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_turno_para_agregar_productos ON pedido_items;
CREATE TRIGGER trg_turno_para_agregar_productos BEFORE INSERT OR UPDATE OF cantidad ON pedido_items
  FOR EACH ROW EXECUTE FUNCTION fn_turno_para_agregar_productos();

COMMIT;
