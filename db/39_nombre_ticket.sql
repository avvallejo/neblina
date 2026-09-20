-- Nombre libre para identificar la comanda sin registrar un cliente.
BEGIN;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS nombre_ticket TEXT
  CHECK (nombre_ticket IS NULL OR (length(btrim(nombre_ticket)) BETWEEN 1 AND 80));
COMMENT ON COLUMN pedidos.nombre_ticket IS 'Nombre de la persona para quien se levanta el ticket.';
COMMIT;
