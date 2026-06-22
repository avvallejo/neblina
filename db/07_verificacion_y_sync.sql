-- ============================================================================
-- CAFETERÍA MÓVIL — MIGRACIÓN 07: verificación de teléfono y sincronización offline
-- ============================================================================
-- Requiere 00 y 01-06 ya aplicados.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Verificación de teléfono por código (OTP). El código se guarda en texto
--    plano a propósito: es de un solo uso, vence en minutos y tiene tope de
--    intentos — el modelo de seguridad es la expiración + el límite de
--    intentos, no el secreto del valor guardado (igual lo manda el SMS).
-- ----------------------------------------------------------------------------
CREATE TABLE verificaciones_telefono (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono    VARCHAR(10) NOT NULL,
  codigo      VARCHAR(6) NOT NULL,
  expira_en   TIMESTAMPTZ NOT NULL,
  intentos    INTEGER NOT NULL DEFAULT 0,
  verificado  BOOLEAN NOT NULL DEFAULT false,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_verificaciones_telefono ON verificaciones_telefono(telefono, creado_en DESC);
COMMENT ON TABLE verificaciones_telefono IS 'Códigos de un solo uso para confirmar que el cliente sí controla ese número antes de dejarlo pedir / acumular fidelidad con él.';

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefono_verificado BOOLEAN NOT NULL DEFAULT false;
-- Los clientes que ya existían antes de esta migración ya demostraron ser
-- reales con su historial de pedidos — se les da por verificados una vez,
-- no se les pide repetir el proceso retroactivamente.
UPDATE clientes SET telefono_verificado = true WHERE telefono_verificado = false;

-- ----------------------------------------------------------------------------
-- 2. Bitácora de sincronización offline — no es necesaria para que la
--    sincronización funcione, pero sin ella, si un dispositivo dice "ya
--    sincronicé" y algo se perdió, no hay forma de investigar qué pasó.
-- ----------------------------------------------------------------------------
CREATE TABLE lotes_sincronizacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id          UUID REFERENCES usuarios(id),
  cliente_id          UUID REFERENCES clientes(id),
  dispositivo         TEXT,
  operaciones_total   INTEGER NOT NULL,
  operaciones_ok      INTEGER NOT NULL DEFAULT 0,
  operaciones_error   INTEGER NOT NULL DEFAULT 0,
  detalle             JSONB,
  recibido_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE lotes_sincronizacion IS 'Un registro por cada lote de operaciones offline que llega a /api/sync/batch — para poder investigar "¿por qué este dispositivo no sincronizó bien ayer?" en vez de adivinar.';
