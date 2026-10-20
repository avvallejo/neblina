-- ============================================================================
-- MIGRACIÓN 50 — JORNADAS: HORAS TRABAJADAS Y PAGO SEMANAL POR HORA
-- ============================================================================
-- Para el personal que se paga por hora (hoy, la cajera). OJO con el nombre:
-- "turno" ya es el turno de CAJA (abrir/cerrar caja, fondo y corte). Esto es
-- otra cosa y se llama JORNADA: lo que una persona trabajó, de su entrada a su
-- salida, menos el tiempo que estuvo fuera (pausas, sin goce de sueldo).
--
--   * usuarios.paga_por_hora  — marca a quien registra jornadas.
--   * tarifas_hora            — tarifa por hora CON HISTORIAL (vigente desde).
--     Cada jornada guarda la tarifa que tenía al iniciar: un aumento posterior
--     no cambia lo ya trabajado.
--   * jornadas                — entrada, salida, pausas, minutos pagables y
--     monto. Una sola abierta por persona (índice único parcial). Estados:
--     abierta | por_revisar | cerrada | pagada | anulada.
--       por_revisar = se pasó del tope de horas o tiene una pausa demasiado
--       larga: no se paga hasta que la administración la corrija o apruebe.
--   * jornada_pausas          — cada "Salir" / "Regresar" de la jornada.
--   * pagos_horas             — bitácora del pago semanal (domingo a sábado).
--     Cada pago nace de un EGRESO real (cuenta "Sueldos y salarios"), y cada
--     jornada pagada queda ligada a su pago para no pagarse dos veces.
--   * Trigger: si el egreso del pago se anula, las jornadas vuelven a quedar
--     "cerrada" (por pagar) y el pago se marca anulado.
--
-- Cálculo: se cuentan MINUTOS COMPLETOS (cada hora se toma al minuto). Pagable
-- = minutos de entrada a salida − minutos de pausa; monto = pagable × tarifa
-- ÷ 60, a centavos. El cálculo vive en la API (services/jornadas.js).
-- Requiere 00-49. Re-ejecutable.
-- ============================================================================
BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS paga_por_hora BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN usuarios.paga_por_hora IS 'true = esta persona registra jornadas (entra con su PIN, sale, y se le paga por horas). Exige sede fija y una tarifa en tarifas_hora.';

-- 1. Tarifas por hora, con historial ----------------------------------------
CREATE TABLE IF NOT EXISTS tarifas_hora (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID NOT NULL REFERENCES usuarios(id),
  tarifa         NUMERIC(10,2) NOT NULL CHECK (tarifa > 0),
  vigente_desde  TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por     UUID REFERENCES usuarios(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tarifas_hora_usuario ON tarifas_hora(usuario_id, vigente_desde DESC);
COMMENT ON TABLE tarifas_hora IS 'Pesos por hora de cada persona, con historial. La vigente al iniciar una jornada es la que se guarda en esa jornada.';

-- 2. Pagos de horas (bitácora de pago) --------------------------------------
CREATE TABLE IF NOT EXISTS pagos_horas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id    UUID NOT NULL REFERENCES sucursales(id),
  usuario_id     UUID NOT NULL REFERENCES usuarios(id),
  semana_desde   DATE NOT NULL,                  -- domingo
  semana_hasta   DATE NOT NULL,                  -- sábado
  fecha          DATE NOT NULL,                  -- cuándo se pagó
  jornadas       INTEGER NOT NULL CHECK (jornadas > 0),
  minutos        INTEGER NOT NULL CHECK (minutos >= 0),
  monto          NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  egreso_id      UUID NOT NULL REFERENCES egresos(id),
  nota           TEXT,
  creado_por     UUID REFERENCES usuarios(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado        BOOLEAN NOT NULL DEFAULT false,
  anulado_en     TIMESTAMPTZ,
  CHECK (semana_hasta >= semana_desde)
);
CREATE INDEX IF NOT EXISTS idx_pagos_horas_sucursal ON pagos_horas(sucursal_id, semana_desde DESC);
CREATE INDEX IF NOT EXISTS idx_pagos_horas_egreso ON pagos_horas(egreso_id);
COMMENT ON TABLE pagos_horas IS 'Bitácora del pago semanal de horas. Cada fila nace de un egreso real (Sueldos y salarios); si el egreso se anula, el pago se anula y las jornadas vuelven a quedar por pagar.';

-- 3. Jornadas ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jornadas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id       UUID NOT NULL REFERENCES sucursales(id),
  usuario_id        UUID NOT NULL REFERENCES usuarios(id),
  entrada           TIMESTAMPTZ NOT NULL DEFAULT now(),
  salida            TIMESTAMPTZ,
  tarifa_hora       NUMERIC(10,2) NOT NULL CHECK (tarifa_hora > 0),
  estado            TEXT NOT NULL DEFAULT 'abierta'
                    CHECK (estado IN ('abierta', 'por_revisar', 'cerrada', 'pagada', 'anulada')),
  minutos_pausa     INTEGER NOT NULL DEFAULT 0 CHECK (minutos_pausa >= 0),
  minutos_pagables  INTEGER CHECK (minutos_pagables >= 0),
  monto             NUMERIC(12,2) CHECK (monto >= 0),
  manual            BOOLEAN NOT NULL DEFAULT false,   -- capturada por la administración
  nota              TEXT,
  motivo_revision   TEXT,                             -- por qué quedó por_revisar
  pago_id           UUID REFERENCES pagos_horas(id),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (salida IS NULL OR salida >= entrada),
  CHECK (estado NOT IN ('cerrada', 'pagada') OR (salida IS NOT NULL AND monto IS NOT NULL)),
  CHECK ((estado = 'pagada') = (pago_id IS NOT NULL))
);
-- Una sola jornada ABIERTA por persona (aunque entre desde dos dispositivos).
CREATE UNIQUE INDEX IF NOT EXISTS uq_jornada_abierta_por_usuario ON jornadas(usuario_id) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS idx_jornadas_sucursal_entrada ON jornadas(sucursal_id, entrada);
CREATE INDEX IF NOT EXISTS idx_jornadas_usuario_entrada ON jornadas(usuario_id, entrada DESC);
CREATE INDEX IF NOT EXISTS idx_jornadas_pago ON jornadas(pago_id) WHERE pago_id IS NOT NULL;
DROP TRIGGER IF EXISTS trg_touch_jornadas ON jornadas;
CREATE TRIGGER trg_touch_jornadas BEFORE UPDATE ON jornadas FOR EACH ROW EXECUTE FUNCTION fn_tocar_actualizado_en();
COMMENT ON TABLE jornadas IS 'Horas trabajadas por el personal que se paga por hora: entrada, salida, pausas y monto. No confundir con turnos (turno de caja).';

-- 4. Pausas (Salir / Regresar) -----------------------------------------------
CREATE TABLE IF NOT EXISTS jornada_pausas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jornada_id  UUID NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
  inicio      TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin         TIMESTAMPTZ,
  CHECK (fin IS NULL OR fin >= inicio)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pausa_abierta_por_jornada ON jornada_pausas(jornada_id) WHERE fin IS NULL;
CREATE INDEX IF NOT EXISTS idx_pausas_jornada ON jornada_pausas(jornada_id);

-- 5. Anular el egreso del pago libera las jornadas ----------------------------
CREATE OR REPLACE FUNCTION fn_liberar_horas_pagadas() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.anulado AND NOT OLD.anulado THEN
    UPDATE jornadas SET estado = 'cerrada', pago_id = NULL
      WHERE pago_id IN (SELECT id FROM pagos_horas WHERE egreso_id = NEW.id AND NOT anulado);
    UPDATE pagos_horas SET anulado = true, anulado_en = now() WHERE egreso_id = NEW.id AND NOT anulado;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_liberar_horas_pagadas ON egresos;
CREATE TRIGGER trg_liberar_horas_pagadas AFTER UPDATE OF anulado ON egresos
  FOR EACH ROW EXECUTE FUNCTION fn_liberar_horas_pagadas();

GRANT SELECT, INSERT ON tarifas_hora TO cafeteria_app;
GRANT SELECT, INSERT, UPDATE ON pagos_horas, jornadas, jornada_pausas TO cafeteria_app;

COMMIT;
