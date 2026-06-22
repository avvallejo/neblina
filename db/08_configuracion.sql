-- ============================================================================
-- CAFETERÍA MÓVIL — CONFIGURACIÓN GENERAL DE LA APP (clave/valor)
-- ============================================================================
-- Tabla flexible para banderas/ajustes del negocio que el admin puede cambiar
-- sin tocar código. Primer uso: si el alta de clientes exige verificación por
-- SMS o no (en arranque queda DESACTIVADA, a petición — el cliente se registra
-- solo con nombre y teléfono).
-- ============================================================================

CREATE TABLE IF NOT EXISTS configuracion (
  clave           TEXT PRIMARY KEY,
  valor           JSONB NOT NULL,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO configuracion (clave, valor) VALUES ('sms_verificacion', 'false'::jsonb)
ON CONFLICT (clave) DO NOTHING;

-- La API se conecta como cafeteria_app (sin privilegios de superusuario).
GRANT SELECT, INSERT, UPDATE ON configuracion TO cafeteria_app;
