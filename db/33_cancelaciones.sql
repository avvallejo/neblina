-- ============================================================================
-- MIGRACIÓN 33 — CANCELACIÓN DE TICKETS CON MOTIVO Y AUTORIZACIÓN
-- ============================================================================
-- Hasta aquí solo se podía cancelar un pedido NO cobrado y ANTES de que la
-- preparación iniciara: un ticket duplicado que ya se cobró (o cuyos snacks se
-- entregaron en caja, que nacen "terminados") no había forma de quitarlo, y las
-- ventas del día quedaban infladas.
-- Ahora la Caja SIEMPRE puede pedir la cancelación, con motivo:
--   * ticket sin cobrar y sin preparación iniciada → se cancela al momento
--     (no movía dinero), dejando el motivo registrado;
--   * cualquier otro caso → queda "pendiente" y sigue contando en las ventas
--     hasta que un administrador la AUTORICE en Admin → Autorizaciones.
--     El administrador que cancela su propio ticket lo autoriza de una vez.
-- Al autorizar: el pedido queda cancelado (sale de ventas del día, de la caja
-- del turno y del estado de resultados), sus ítems quedan cancelados, el punto
-- de fidelidad se devuelve y los insumos que se hubieran consumido regresan al
-- inventario (movimiento 'ajuste' que apunta al consumo que revierte, así el
-- costo de ventas del mes también se corrige).
-- Requiere 00-32. Re-ejecutable.
-- ============================================================================
BEGIN;

-- 1. Estado de la cancelación en el pedido ----------------------------------
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelacion_estado TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelacion_motivo TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelacion_solicitada_por UUID REFERENCES usuarios(id);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelacion_solicitada_en TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelacion_resuelta_por UUID REFERENCES usuarios(id);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelacion_resuelta_en TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelacion_nota TEXT;

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_cancelacion_coherente;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_cancelacion_coherente CHECK (
  cancelacion_estado IS NULL
  OR (cancelacion_estado IN ('pendiente', 'autorizada', 'rechazada')
      AND cancelacion_solicitada_en IS NOT NULL
      -- una solicitud pendiente todavía no está resuelta
      AND (cancelacion_estado <> 'pendiente' OR cancelacion_resuelta_en IS NULL)
      -- resuelta = sabemos quién y cuándo
      AND (cancelacion_estado = 'pendiente' OR cancelacion_resuelta_en IS NOT NULL)
      -- autorizada = el pedido quedó cancelado; rechazada = sigue vivo
      AND (cancelacion_estado <> 'autorizada' OR cancelado)
      AND (cancelacion_estado <> 'rechazada' OR NOT cancelado))
);
COMMENT ON COLUMN pedidos.cancelacion_estado IS 'NULL = sin solicitud. pendiente = pedida por la Caja, el ticket todavía cuenta. autorizada = el admin la aprobó y el pedido está cancelado. rechazada = el admin la negó y el ticket sigue contando.';

-- Cola de Autorizaciones: solo las pendientes, por sucursal.
CREATE INDEX IF NOT EXISTS idx_pedidos_cancelacion_pendiente
  ON pedidos (sucursal_id, cancelacion_solicitada_en)
  WHERE cancelacion_estado = 'pendiente';

-- 2. Reversa del consumo de inventario ---------------------------------------
-- Cada movimiento de reversa apunta al consumo que revierte: así autorizar dos
-- veces (o reintentar) nunca devuelve el doble.
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS revierte_movimiento_id UUID REFERENCES movimientos_inventario(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_movimientos_reversa ON movimientos_inventario(revierte_movimiento_id) WHERE revierte_movimiento_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_revertir_consumo_pedido(p_pedido_id UUID, p_usuario_id UUID, p_motivo TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_mov       RECORD;
  v_devuelto  NUMERIC;
  v_n         INTEGER := 0;
BEGIN
  FOR v_mov IN
    SELECT mi.id, mi.materia_prima_id, mi.cantidad, mi.lote_id, mi.pedido_item_id, mi.costo_unitario,
           mp.unidad AS unidad_stock, l.unidad AS unidad_lote
    FROM movimientos_inventario mi
    JOIN pedido_items pi ON pi.id = mi.pedido_item_id
    JOIN materias_primas mp ON mp.id = mi.materia_prima_id
    LEFT JOIN lotes l ON l.id = mi.lote_id
    WHERE pi.pedido_id = p_pedido_id AND mi.tipo = 'consumo' AND mi.cantidad < 0
      AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id = mi.id)
    ORDER BY mi.creado_en
  LOOP
    v_devuelto := -v_mov.cantidad;                     -- positivo, en unidad de control
    IF v_mov.lote_id IS NOT NULL THEN
      UPDATE lotes SET cantidad_disponible = LEAST(cantidad_comprada,
        cantidad_disponible + fn_convertir_unidad(v_devuelto, v_mov.unidad_stock, v_mov.unidad_lote))
      WHERE id = v_mov.lote_id;
    END IF;
    UPDATE materias_primas SET stock_actual = stock_actual + v_devuelto WHERE id = v_mov.materia_prima_id;
    INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, pedido_item_id, usuario_id, motivo, costo_unitario, revierte_movimiento_id)
      VALUES (v_mov.materia_prima_id, 'ajuste', v_devuelto, v_mov.lote_id, v_mov.pedido_item_id, p_usuario_id,
              COALESCE(p_motivo, 'Cancelación de ticket autorizada'), v_mov.costo_unitario, v_mov.id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_revertir_consumo_pedido(UUID, UUID, TEXT) IS 'Devuelve al inventario lo que consumió un pedido (lote incluido) al autorizar su cancelación. Idempotente: no revierte dos veces el mismo consumo.';

-- 3. Fidelidad: cancelar un ticket cobrado devuelve su punto -----------------
CREATE OR REPLACE FUNCTION fn_confirmar_cobro_pedido() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.cobrado = false AND NEW.cobrado = true AND NEW.cliente_id IS NOT NULL AND NOT NEW.es_regalo_fidelidad THEN
    PERFORM fn_acreditar_fidelidad(NEW.cliente_id);
  END IF;

  IF OLD.no_show = false AND NEW.no_show = true AND NEW.cliente_id IS NOT NULL THEN
    UPDATE clientes SET pedidos_app_contador = GREATEST(0, pedidos_app_contador - 1) WHERE id = NEW.cliente_id;
  END IF;

  -- Cancelar un ticket YA COBRADO deshace el punto que ese cobro acreditó.
  IF OLD.cancelado = false AND NEW.cancelado = true AND NEW.cobrado AND NEW.cliente_id IS NOT NULL
     AND NOT NEW.es_regalo_fidelidad AND NOT NEW.no_show THEN
    UPDATE clientes SET pedidos_app_contador = GREATEST(0, pedidos_app_contador - 1) WHERE id = NEW.cliente_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Vista de pedidos (pedidos cambió de columnas: hay que recrearla) --------
DROP VIEW IF EXISTS vw_pedidos_con_estado;
CREATE VIEW vw_pedidos_con_estado AS
SELECT p.*,
  CASE
    WHEN p.no_show THEN 'no_show'
    WHEN p.cancelado THEN 'cancelado'
    WHEN COUNT(pi.id) = 0 THEN 'pendiente'
    WHEN COUNT(pi.id) = COUNT(*) FILTER (WHERE pi.estado = 'terminado') THEN (CASE WHEN p.cobrado THEN 'terminado' ELSE 'listo' END)
    WHEN COUNT(*) FILTER (WHERE pi.estado <> 'pendiente' AND COALESCE(pr.estacion, 'barra') <> 'caja') > 0 THEN 'en_preparacion'
    ELSE 'pendiente'
  END AS estado
FROM pedidos p
LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
LEFT JOIN productos pr ON pr.id = pi.producto_id
GROUP BY p.id;
GRANT SELECT ON vw_pedidos_con_estado TO cafeteria_app;

-- 5. Fecha de negocio de las compras ----------------------------------------
-- El servidor corre en UTC: después de las 18:00 de México, CURRENT_DATE ya es
-- "mañana". Una compra registrada por la tarde se fechaba al día siguiente y su
-- egreso caía fuera del mes/del corte. Todas las fechas del negocio son de
-- México (igual que ventas y turnos).
ALTER TABLE lotes ALTER COLUMN fecha_compra SET DEFAULT (now() AT TIME ZONE 'America/Mexico_City')::date;

COMMIT;
