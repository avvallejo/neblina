-- ============================================================================
-- 51: BITÁCORA DE ACCIONES + ANULACIÓN DE COMPRAS/ALTAS CAPTURADAS POR ERROR
-- ============================================================================
-- 1. bitacora_acciones: quién hizo qué y cuándo. La API registra cada acción
--    de escritura (alta, edición, ajuste, anulación, pago…) del personal, con
--    usuario, sede, ruta, resultado, IP y un resumen del cuerpo SIN PIN ni
--    contraseñas. El detalle antes/después sigue en `auditoria`.
-- 2. `auditoria` y `bitacora_acciones` pasan a ser de solo-inserción: ni la
--    aplicación ni un UPDATE/DELETE accidental pueden alterar el rastro.
-- 3. Anulación de una compra/alta por error: el lote queda marcado como
--    anulado (no se borra), con quién, cuándo y por qué; los ajustes que se
--    hicieron para "compensarlo" se revierten con un movimiento contrario, de
--    modo que el estado de resultados no cargue una pérdida que nunca existió.
--
-- El ALTER TYPE va fuera de transacción (igual que 16 y 26): un valor nuevo de
-- enum no puede usarse dentro de la transacción que lo crea. Re-ejecutable.
-- ============================================================================

ALTER TYPE tipo_movimiento ADD VALUE IF NOT EXISTS 'anulacion_compra';

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Bitácora de acciones -----------------------------------------------------
CREATE TABLE IF NOT EXISTS bitacora_acciones (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id     UUID REFERENCES usuarios(id),
  usuario_nombre TEXT,                     -- copia: si renombran a la persona, el rastro no cambia
  rol            TEXT,
  sucursal_id    UUID REFERENCES sucursales(id),
  metodo         TEXT NOT NULL,            -- POST, PATCH, PUT, DELETE
  ruta           TEXT NOT NULL,            -- plantilla: /api/materias-primas/:id/ajustar-stock
  entidad        TEXT,                     -- materias-primas, contabilidad, usuarios…
  entidad_id     TEXT,
  accion         TEXT,                     -- ajustar-stock, crear, editar, eliminar…
  estado_http    INTEGER NOT NULL,         -- 2xx = se hizo; 4xx/5xx = se intentó y no procedió
  ip             TEXT,
  agente         TEXT,
  detalle        JSONB
);
CREATE INDEX IF NOT EXISTS idx_bitacora_sucursal_fecha ON bitacora_acciones (sucursal_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_bitacora_usuario_fecha  ON bitacora_acciones (usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_bitacora_entidad        ON bitacora_acciones (entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_sucursal_fecha ON auditoria (sucursal_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_fecha  ON auditoria (usuario_id, creado_en DESC);

-- 2. Solo inserción -----------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bitacora_solo_insercion() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora (%) es de solo lectura: no se modifica ni se borra.', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_auditoria_solo_insercion ON auditoria;
CREATE TRIGGER trg_auditoria_solo_insercion BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION fn_bitacora_solo_insercion();
DROP TRIGGER IF EXISTS trg_bitacora_acciones_solo_insercion ON bitacora_acciones;
CREATE TRIGGER trg_bitacora_acciones_solo_insercion BEFORE UPDATE OR DELETE ON bitacora_acciones
  FOR EACH ROW EXECUTE FUNCTION fn_bitacora_solo_insercion();

-- 3. Anulación de compras/altas por error --------------------------------------
ALTER TABLE lotes
  ADD COLUMN IF NOT EXISTS anulado_en       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anulado_por      UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;
ALTER TABLE lotes DROP CONSTRAINT IF EXISTS lotes_anulado_sin_saldo;
ALTER TABLE lotes ADD CONSTRAINT lotes_anulado_sin_saldo
  CHECK (anulado_en IS NULL OR (cantidad_disponible = 0 AND anulado_por IS NOT NULL AND motivo_anulacion IS NOT NULL));

ALTER TABLE ajustes_stock
  ADD COLUMN IF NOT EXISTS revertido_en     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revertido_por    UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS motivo_reversion TEXT;

-- La aplicación solo agrega a la bitácora de acciones (los privilegios por
-- defecto de 00 le darían UPDATE/DELETE; el trigger ya lo impide, aquí también
-- se quitan).
REVOKE UPDATE, DELETE ON bitacora_acciones FROM cafeteria_app;

COMMIT;
