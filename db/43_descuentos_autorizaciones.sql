BEGIN;
CREATE TABLE IF NOT EXISTS solicitudes_descuento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id UUID NOT NULL REFERENCES sucursales(id),
  solicitante_id UUID NOT NULL REFERENCES usuarios(id),
  client_uuid UUID NOT NULL,
  pedido_id UUID REFERENCES pedidos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('empleado','promocion')),
  porcentaje NUMERIC(5,2) NOT NULL CHECK (porcentaje > 0 AND porcentaje < 100),
  motivo TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','autorizada','rechazada')),
  via TEXT NOT NULL CHECK (via IN ('configuracion','pin','modulo','administrador')),
  autorizador_id UUID REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelta_en TIMESTAMPTZ,
  expira_en TIMESTAMPTZ NOT NULL DEFAULT now() + interval '12 hours',
  usada_en TIMESTAMPTZ,
  UNIQUE (solicitante_id, client_uuid),
  CHECK (tipo <> 'empleado' OR porcentaje = 50)
);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS descuento_solicitud_id UUID REFERENCES solicitudes_descuento(id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_descuento_sede ON solicitudes_descuento(sucursal_id, creado_en DESC);
GRANT SELECT, INSERT, UPDATE ON solicitudes_descuento TO cafeteria_app;
COMMIT;
