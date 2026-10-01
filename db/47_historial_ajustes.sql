-- Fecha contable independiente de la captura y del movimiento físico.
-- Recupera los ajustes existentes sin cambiar cantidades, costos ni fechas.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE ajustes_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id UUID NOT NULL REFERENCES sucursales(id),
  materia_prima_id UUID NOT NULL REFERENCES materias_primas(id),
  usuario_id UUID REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_contable DATE NOT NULL,
  motivo TEXT NOT NULL,
  cantidad_anterior NUMERIC(12,3),
  cantidad_contada NUMERIC(12,3),
  version INTEGER NOT NULL DEFAULT 1,
  firma TEXT,
  respuesta JSONB
);
CREATE INDEX idx_ajustes_stock_sucursal_fecha ON ajustes_stock(sucursal_id,fecha_contable);
CREATE INDEX idx_ajustes_stock_sucursal_captura ON ajustes_stock(sucursal_id,creado_en);
ALTER TABLE movimientos_inventario ADD COLUMN ajuste_stock_id UUID REFERENCES ajustes_stock(id);
CREATE INDEX idx_movimientos_ajuste_stock ON movimientos_inventario(ajuste_stock_id);
GRANT SELECT,INSERT,UPDATE ON ajustes_stock TO cafeteria_app;

-- Un conteo sobre varios lotes produjo varias filas en una misma transacción.
-- Conservamos ese conjunto como un ajuste. No inventamos el saldo anterior,
-- que la versión antigua no guardaba.
CREATE TEMP TABLE ajustes_previos ON COMMIT DROP AS
SELECT gen_random_uuid() AS id, mp.sucursal_id, mi.materia_prima_id, mi.usuario_id,
  mi.creado_en, COALESCE(mi.motivo,'Ajuste por conteo físico') AS motivo,
  array_agg(mi.id) AS movimientos
FROM movimientos_inventario mi JOIN materias_primas mp ON mp.id=mi.materia_prima_id
WHERE mi.tipo='ajuste' AND mi.pedido_item_id IS NULL AND mi.merma_id IS NULL
  AND mi.revierte_movimiento_id IS NULL
GROUP BY mp.sucursal_id,mi.materia_prima_id,mi.usuario_id,mi.creado_en,COALESCE(mi.motivo,'Ajuste por conteo físico');
INSERT INTO ajustes_stock(id,sucursal_id,materia_prima_id,usuario_id,creado_en,fecha_contable,motivo)
SELECT id,sucursal_id,materia_prima_id,usuario_id,creado_en,(creado_en AT TIME ZONE 'America/Mexico_City')::date,motivo
FROM ajustes_previos;
UPDATE movimientos_inventario mi SET ajuste_stock_id=a.id FROM ajustes_previos a WHERE mi.id=ANY(a.movimientos);
COMMIT;
