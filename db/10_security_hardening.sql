-- ============================================================================
-- MIGRACIÓN 10 — endurecimiento de autenticación, sesiones y descuentos
-- ============================================================================
BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- La actualización arranca en modo seguro. Un administrador todavía puede
-- apagar SMS explícitamente después, pero el despliegue no hereda el valor
-- inseguro de versiones anteriores.
UPDATE configuracion SET valor = 'true'::jsonb, actualizado_en = now()
WHERE clave = 'sms_verificacion' AND valor <> 'true'::jsonb;

CREATE TABLE IF NOT EXISTS intentos_autorizacion_descuento (
  id             BIGSERIAL PRIMARY KEY,
  solicitante_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  exitoso        BOOLEAN NOT NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intentos_descuento_solicitante
  ON intentos_autorizacion_descuento (solicitante_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS aprobaciones_descuento (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash            CHAR(64) NOT NULL UNIQUE,
  solicitante_id        UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  autorizador_id        UUID NOT NULL REFERENCES usuarios(id),
  descuento_porcentaje  NUMERIC(5,2) NOT NULL CHECK (descuento_porcentaje > 0 AND descuento_porcentaje <= 100),
  expira_en             TIMESTAMPTZ NOT NULL,
  usada_en              TIMESTAMPTZ,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aprobaciones_descuento_vigentes
  ON aprobaciones_descuento (solicitante_id, expira_en)
  WHERE usada_en IS NULL;

-- El trigger anterior consumía cualquier regalo después de insertarlo, sin
-- validar elegibilidad. Ahora esa operación es atómica en OrderValidation.
DROP TRIGGER IF EXISTS trg_reclamo_regalo ON pedidos;
DROP FUNCTION IF EXISTS fn_registrar_reclamo_regalo();

GRANT SELECT, INSERT ON intentos_autorizacion_descuento TO cafeteria_app;
GRANT SELECT, INSERT, UPDATE ON aprobaciones_descuento TO cafeteria_app;
GRANT USAGE, SELECT ON SEQUENCE intentos_autorizacion_descuento_id_seq TO cafeteria_app;

COMMIT;
