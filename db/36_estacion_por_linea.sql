BEGIN;
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS estacion_preparacion TEXT;
UPDATE pedido_items pi SET estacion_preparacion=COALESCE((SELECT estacion FROM productos WHERE id=pi.producto_id),'caja') WHERE estacion_preparacion IS NULL;
ALTER TABLE pedido_items ALTER COLUMN estacion_preparacion SET NOT NULL;
ALTER TABLE pedido_items DROP CONSTRAINT IF EXISTS estacion_linea_valida;
ALTER TABLE pedido_items ADD CONSTRAINT estacion_linea_valida CHECK (estacion_preparacion IN ('barra','parrilla','caja'));
CREATE OR REPLACE FUNCTION fn_fijar_estacion_linea() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT estacion INTO NEW.estacion_preparacion FROM productos WHERE id=NEW.producto_id;
    NEW.estacion_preparacion := COALESCE(NEW.estacion_preparacion,'caja');
  ELSIF NEW.estacion_preparacion IS DISTINCT FROM OLD.estacion_preparacion THEN
    RAISE EXCEPTION 'La estación de una línea ya capturada no se modifica';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_fijar_estacion_linea ON pedido_items;
CREATE TRIGGER trg_fijar_estacion_linea BEFORE INSERT OR UPDATE ON pedido_items FOR EACH ROW EXECUTE FUNCTION fn_fijar_estacion_linea();
CREATE OR REPLACE VIEW vw_pedidos_con_estado AS
SELECT p.*,
  CASE
    WHEN p.no_show THEN 'no_show'
    WHEN p.cancelado THEN 'cancelado'
    WHEN COUNT(pi.id) = 0 THEN 'pendiente'
    WHEN COUNT(pi.id) = COUNT(*) FILTER (WHERE pi.estado = 'terminado') THEN (CASE WHEN p.cobrado THEN 'terminado' ELSE 'listo' END)
    WHEN COUNT(*) FILTER (WHERE pi.estado <> 'pendiente' AND pi.estacion_preparacion <> 'caja') > 0 THEN 'en_preparacion'
    ELSE 'pendiente'
  END AS estado
FROM pedidos p
LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
GROUP BY p.id;
COMMIT;
