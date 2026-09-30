BEGIN;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cuenta_origen_id UUID REFERENCES pedidos(id);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ajuste_redondeo NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS separado_de_id UUID REFERENCES pedido_items(id);
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS separado_de_id UUID REFERENCES movimientos_inventario(id);
CREATE TABLE IF NOT EXISTS separaciones_cuenta (
  client_uuid UUID PRIMARY KEY,
  sucursal_id UUID NOT NULL REFERENCES sucursales(id),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  pedido_id UUID NOT NULL REFERENCES pedidos(id),
  cuenta_id UUID NOT NULL REFERENCES pedidos(id),
  detalle JSONB NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON separaciones_cuenta TO cafeteria_app;
CREATE OR REPLACE FUNCTION fn_fijar_estacion_linea() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.separado_de_id IS NOT NULL THEN
      SELECT estacion_preparacion INTO NEW.estacion_preparacion FROM pedido_items
        WHERE id=NEW.separado_de_id AND producto_id IS NOT DISTINCT FROM NEW.producto_id;
      IF NEW.estacion_preparacion IS NULL THEN RAISE EXCEPTION 'Línea de origen inválida'; END IF;
    ELSE
      SELECT estacion INTO NEW.estacion_preparacion FROM productos WHERE id=NEW.producto_id;
      NEW.estacion_preparacion := COALESCE(NEW.estacion_preparacion,'caja');
    END IF;
  ELSIF NEW.estacion_preparacion IS DISTINCT FROM OLD.estacion_preparacion THEN
    RAISE EXCEPTION 'La estación de una línea ya capturada no se modifica';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMIT;
