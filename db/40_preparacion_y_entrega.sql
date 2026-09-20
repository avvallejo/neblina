-- Separa a quien inicia, quien termina y la entrega al cliente.
BEGIN;
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS terminado_por UUID REFERENCES usuarios(id);
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS cantidad_entregada INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_entregada >= 0);
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS entregado_en TIMESTAMPTZ;
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS entregado_por UUID REFERENCES usuarios(id);
CREATE INDEX IF NOT EXISTS idx_items_terminado_en ON pedido_items (terminado_en) WHERE estado='terminado';
COMMENT ON COLUMN pedido_items.terminado_por IS 'Empleado que pulsó Terminar. NULL en registros anteriores; barista_id conserva quien inició.';
COMMENT ON COLUMN pedido_items.cantidad_entregada IS 'Unidades entregadas al cliente por caja; independiente del cobro y de la preparación.';
COMMIT;
