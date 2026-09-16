-- ============================================================================
-- MIGRACIÓN 32 — CONTABILIDAD DEL NEGOCIO Y MAYORDOMÍA
-- ============================================================================
-- Hasta aquí el sistema medía lo que ENTRA (ventas) y lo que CUESTA producir
-- (consumo PEPS, mermas, gastos fijos presupuestados para costear). Faltaba lo
-- que SALE de verdad: gastos reales con fecha, salidas de caja, cuentas de
-- dinero, cuentas por pagar y un cierre de mes. Esta migración agrega:
--   * cuentas_contables  — catálogo por sede (grupos: costo_ventas,
--     gasto_operacion, gasto_financiero, impuesto, inventario, inversion,
--     retiro, diezmo_ofrenda). Solo los cuatro primeros bajan la utilidad.
--   * cuentas_dinero     — Caja (efectivo) y Banco (tarjeta/transferencia),
--     con saldo inicial a una fecha.
--   * egresos            — TODO lo que sale de dinero: gastos, compras de
--     insumos (ligadas al lote), préstamo, sueldo, equipo, retiros, diezmo
--     entregado, salidas de caja del turno. Con cuenta contable, cuenta de
--     dinero, pagado/por pagar y periodo (YYYY-MM) al que pertenecen.
--   * traspasos_dinero   — depósitos de caja a banco y viceversa.
--   * cierres_mes        — el mes se congela con su estado de resultados.
--   * gastos_fijos       — ahora ligados a una cuenta contable y a una cuenta
--     de dinero: cada mes se proponen y se confirman como egreso real
--     (presupuesto para costear ↔ realidad para contabilidad).
-- El costo de ventas sigue saliendo del consumo real (PEPS) + mermas: la
-- compra de insumos NO es gasto (sale del dinero, entra al inventario).
-- Requiere 00-31. Re-ejecutable.
-- ============================================================================
BEGIN;

-- 1. Catálogo de cuentas ----------------------------------------------------
CREATE TABLE IF NOT EXISTS cuentas_contables (
  id           SERIAL PRIMARY KEY,
  sucursal_id  UUID NOT NULL REFERENCES sucursales(id),
  nombre       TEXT NOT NULL,
  grupo        TEXT NOT NULL CHECK (grupo IN ('costo_ventas','gasto_operacion','gasto_financiero','impuesto','inventario','inversion','retiro','diezmo_ofrenda')),
  clave        TEXT,                              -- cuentas del sistema (no se borran)
  orden        INTEGER NOT NULL DEFAULT 0,
  activo       BOOLEAN NOT NULL DEFAULT true,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, nombre),
  UNIQUE (sucursal_id, clave)
);
COMMENT ON TABLE cuentas_contables IS 'Catálogo de cuentas de egreso por sede. grupo decide si baja la utilidad (costo_ventas, gasto_operacion, gasto_financiero, impuesto) o no (inventario, inversion, retiro, diezmo_ofrenda).';

CREATE OR REPLACE FUNCTION fn_grupo_afecta_utilidad(p_grupo TEXT) RETURNS BOOLEAN AS $$
  SELECT p_grupo IN ('costo_ventas','gasto_operacion','gasto_financiero','impuesto');
$$ LANGUAGE sql IMMUTABLE;

-- 2. Cuentas de dinero --------------------------------------------------------
CREATE TABLE IF NOT EXISTS cuentas_dinero (
  id                  SERIAL PRIMARY KEY,
  sucursal_id         UUID NOT NULL REFERENCES sucursales(id),
  nombre              TEXT NOT NULL,
  tipo                TEXT NOT NULL CHECK (tipo IN ('efectivo','banco')),
  clave               TEXT,                       -- 'caja' | 'banco' (del sistema)
  saldo_inicial       NUMERIC(12,2) NOT NULL DEFAULT 0,
  fecha_saldo_inicial DATE,
  activo              BOOLEAN NOT NULL DEFAULT true,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, nombre),
  UNIQUE (sucursal_id, clave)
);
COMMENT ON TABLE cuentas_dinero IS 'Dónde está el dinero: Caja (efectivo de ventas) y Banco (tarjeta y transferencia). Las ventas entran solas; los egresos y traspasos salen/entran según se registren.';

-- 3. Egresos ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS egresos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id        UUID NOT NULL REFERENCES sucursales(id),
  fecha              DATE NOT NULL,               -- fecha del gasto (a qué mes pertenece)
  cuenta_contable_id INTEGER NOT NULL REFERENCES cuentas_contables(id),
  concepto           TEXT NOT NULL,
  monto              NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  cuenta_dinero_id   INTEGER REFERENCES cuentas_dinero(id),  -- NULL = por pagar o sin cuenta asignada
  pagado             BOOLEAN NOT NULL DEFAULT true,
  pagado_en          DATE,
  proveedor_id       UUID REFERENCES proveedores(id),
  periodo            CHAR(7),                     -- 'YYYY-MM': mes del gasto recurrente o mes al que se aplica el diezmo
  gasto_fijo_id      UUID REFERENCES gastos_fijos(id),
  lote_id            UUID REFERENCES lotes(id),
  turno_id           UUID REFERENCES turnos(id),  -- salida de caja registrada en el turno
  referencia         TEXT,                        -- folio, factura, recibo
  nota               TEXT,
  usuario_id         UUID REFERENCES usuarios(id),
  anulado            BOOLEAN NOT NULL DEFAULT false,
  anulado_en         TIMESTAMPTZ,
  anulado_por        UUID REFERENCES usuarios(id),
  motivo_anulacion   TEXT,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (periodo IS NULL OR periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CHECK (NOT pagado OR pagado_en IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_egresos_sucursal_fecha ON egresos(sucursal_id, fecha) WHERE NOT anulado;
CREATE INDEX IF NOT EXISTS idx_egresos_sucursal_periodo ON egresos(sucursal_id, periodo) WHERE NOT anulado;
CREATE INDEX IF NOT EXISTS idx_egresos_turno ON egresos(turno_id) WHERE turno_id IS NOT NULL AND NOT anulado;
CREATE UNIQUE INDEX IF NOT EXISTS uq_egresos_gasto_fijo_periodo ON egresos(gasto_fijo_id, periodo) WHERE gasto_fijo_id IS NOT NULL AND NOT anulado;
CREATE UNIQUE INDEX IF NOT EXISTS uq_egresos_lote ON egresos(lote_id) WHERE lote_id IS NOT NULL AND NOT anulado;
DROP TRIGGER IF EXISTS trg_touch_egresos ON egresos;
CREATE TRIGGER trg_touch_egresos BEFORE UPDATE ON egresos FOR EACH ROW EXECUTE FUNCTION fn_tocar_actualizado_en();
COMMENT ON TABLE egresos IS 'Todo lo que sale de dinero del negocio. Baja la utilidad solo si su cuenta contable es de un grupo que afecta utilidad.';

-- 4. Traspasos entre cuentas de dinero ---------------------------------------
CREATE TABLE IF NOT EXISTS traspasos_dinero (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id   UUID NOT NULL REFERENCES sucursales(id),
  fecha         DATE NOT NULL,
  de_cuenta_id  INTEGER NOT NULL REFERENCES cuentas_dinero(id),
  a_cuenta_id   INTEGER NOT NULL REFERENCES cuentas_dinero(id),
  monto         NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  nota          TEXT,
  usuario_id    UUID REFERENCES usuarios(id),
  anulado       BOOLEAN NOT NULL DEFAULT false,
  anulado_en    TIMESTAMPTZ,
  anulado_por   UUID REFERENCES usuarios(id),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (de_cuenta_id <> a_cuenta_id)
);
CREATE INDEX IF NOT EXISTS idx_traspasos_sucursal_fecha ON traspasos_dinero(sucursal_id, fecha) WHERE NOT anulado;

-- 5. Cierres de mes -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS cierres_mes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id UUID NOT NULL REFERENCES sucursales(id),
  periodo     CHAR(7) NOT NULL CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  cerrado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_por UUID REFERENCES usuarios(id),
  resumen     JSONB NOT NULL,                     -- estado de resultados y mayordomía al momento del cierre
  UNIQUE (sucursal_id, periodo)
);

-- 6. Gastos fijos ↔ contabilidad ---------------------------------------------
ALTER TABLE gastos_fijos DROP CONSTRAINT IF EXISTS gastos_fijos_categoria_check;
ALTER TABLE gastos_fijos ADD CONSTRAINT gastos_fijos_categoria_check
  CHECK (categoria IN ('Renta', 'Personal', 'Servicios', 'Transporte', 'Seguros', 'Mantenimiento', 'Financiero', 'Impuestos', 'Otro'));
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS cuenta_contable_id INTEGER REFERENCES cuentas_contables(id);
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS cuenta_dinero_id INTEGER REFERENCES cuentas_dinero(id);
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS dia_pago SMALLINT NOT NULL DEFAULT 1 CHECK (dia_pago BETWEEN 1 AND 28);

-- 7. Semilla por sede (cuentas del sistema y Caja/Banco) ----------------------
CREATE OR REPLACE FUNCTION fn_contabilidad_semilla(p_sucursal_id UUID) RETURNS VOID AS $$
BEGIN
  INSERT INTO cuentas_contables (sucursal_id, nombre, grupo, clave, orden) VALUES
    (p_sucursal_id, 'Renta del local',                      'gasto_operacion',  'renta',           10),
    (p_sucursal_id, 'Sueldos y salarios',                   'gasto_operacion',  'sueldos',         20),
    (p_sucursal_id, 'Sueldo del dueño',                     'gasto_operacion',  'sueldo_dueno',    21),
    (p_sucursal_id, 'Servicios (luz, agua, gas, internet)', 'gasto_operacion',  'servicios',       30),
    (p_sucursal_id, 'Mantenimiento y reparaciones',         'gasto_operacion',  'mantenimiento',   40),
    (p_sucursal_id, 'Limpieza e higiene',                   'gasto_operacion',  'limpieza',        41),
    (p_sucursal_id, 'Publicidad y promoción',               'gasto_operacion',  'publicidad',      50),
    (p_sucursal_id, 'Transporte y gasolina',                'gasto_operacion',  'transporte',      60),
    (p_sucursal_id, 'Papelería y oficina',                  'gasto_operacion',  'papeleria',       70),
    (p_sucursal_id, 'Comisiones bancarias y terminal',      'gasto_operacion',  'comisiones',      80),
    (p_sucursal_id, 'Honorarios contables y legales',       'gasto_operacion',  'honorarios',      81),
    (p_sucursal_id, 'Seguros',                              'gasto_operacion',  'seguros',         82),
    (p_sucursal_id, 'Otros gastos de operación',            'gasto_operacion',  'otros_gastos',    99),
    (p_sucursal_id, 'Pago de préstamo',                     'gasto_financiero', 'prestamo',       110),
    (p_sucursal_id, 'Intereses y cargos financieros',       'gasto_financiero', 'intereses',      111),
    (p_sucursal_id, 'Impuestos y derechos',                 'impuesto',         'impuestos',      120),
    (p_sucursal_id, 'Compra de insumos (inventario)',       'inventario',       'compra_insumos', 200),
    (p_sucursal_id, 'Equipo y mobiliario',                  'inversion',        'equipo',         300),
    (p_sucursal_id, 'Retiro de utilidades del dueño',       'retiro',           'retiro_dueno',   400),
    (p_sucursal_id, 'Diezmo',                               'diezmo_ofrenda',   'diezmo',         500),
    (p_sucursal_id, 'Ofrenda',                              'diezmo_ofrenda',   'ofrenda',        501)
  ON CONFLICT (sucursal_id, clave) DO NOTHING;

  INSERT INTO cuentas_dinero (sucursal_id, nombre, tipo, clave) VALUES
    (p_sucursal_id, 'Caja (efectivo)', 'efectivo', 'caja'),
    (p_sucursal_id, 'Banco (tarjeta y transferencia)', 'banco', 'banco')
  ON CONFLICT (sucursal_id, clave) DO NOTHING;

  -- Los gastos fijos existentes se ligan a la cuenta que corresponde a su categoría.
  UPDATE gastos_fijos g SET cuenta_contable_id = c.id
  FROM cuentas_contables c
  WHERE g.sucursal_id = p_sucursal_id AND g.cuenta_contable_id IS NULL AND c.sucursal_id = p_sucursal_id
    AND c.clave = CASE g.categoria
      WHEN 'Renta' THEN 'renta' WHEN 'Personal' THEN 'sueldos' WHEN 'Servicios' THEN 'servicios'
      WHEN 'Transporte' THEN 'transporte' WHEN 'Seguros' THEN 'seguros' WHEN 'Mantenimiento' THEN 'mantenimiento'
      WHEN 'Financiero' THEN 'prestamo' WHEN 'Impuestos' THEN 'impuestos' ELSE 'otros_gastos' END;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE s RECORD;
BEGIN
  FOR s IN SELECT id FROM sucursales LOOP
    PERFORM fn_contabilidad_semilla(s.id);
  END LOOP;
END $$;

-- Una sede nueva nace con su catálogo y sus cuentas de dinero.
CREATE OR REPLACE FUNCTION fn_contabilidad_semilla_trigger() RETURNS TRIGGER AS $$
BEGIN
  PERFORM fn_contabilidad_semilla(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contabilidad_semilla ON sucursales;
CREATE TRIGGER trg_contabilidad_semilla AFTER INSERT ON sucursales FOR EACH ROW EXECUTE FUNCTION fn_contabilidad_semilla_trigger();

-- 8. Costo de cada movimiento de inventario, congelado al momento ------------
-- El costo de ventas del mes se valúa con el costo que tenía el insumo cuando
-- se consumió (lote PEPS o costo de referencia), no con el de hoy: así una
-- compra más cara en octubre no cambia la utilidad de septiembre.
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(12,4);
CREATE OR REPLACE FUNCTION fn_movimiento_costo() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.costo_unitario IS NULL THEN
    IF NEW.lote_id IS NOT NULL THEN
      SELECT l.costo_total / NULLIF(fn_convertir_unidad(l.cantidad_comprada, l.unidad, mp.unidad), 0)
        INTO NEW.costo_unitario
      FROM lotes l JOIN materias_primas mp ON mp.id = NEW.materia_prima_id
      WHERE l.id = NEW.lote_id;
    END IF;
    IF NEW.costo_unitario IS NULL THEN
      SELECT costo_unitario INTO NEW.costo_unitario FROM materias_primas WHERE id = NEW.materia_prima_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_movimiento_costo ON movimientos_inventario;
CREATE TRIGGER trg_movimiento_costo BEFORE INSERT ON movimientos_inventario FOR EACH ROW EXECUTE FUNCTION fn_movimiento_costo();
-- Historial previo: se valúa con el mejor dato disponible (lote o costo actual).
UPDATE movimientos_inventario mi
SET costo_unitario = COALESCE(
  (SELECT l.costo_total / NULLIF(fn_convertir_unidad(l.cantidad_comprada, l.unidad, mp.unidad), 0) FROM lotes l WHERE l.id = mi.lote_id),
  mp.costo_unitario)
FROM materias_primas mp
WHERE mp.id = mi.materia_prima_id AND mi.costo_unitario IS NULL;

-- 9. Permisos -------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON cuentas_contables, cuentas_dinero, egresos, traspasos_dinero, cierres_mes TO cafeteria_app;
GRANT USAGE, SELECT ON SEQUENCE cuentas_contables_id_seq, cuentas_dinero_id_seq TO cafeteria_app;

COMMIT;
