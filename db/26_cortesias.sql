-- ============================================================================
-- MIGRACIÓN 26 — CORTESÍAS EN CAJA
-- ============================================================================
-- Una cortesía es un pedido completo que se entrega sin cobrar ($0). Cada
-- sucursal tiene un CUPO MENSUAL COMPARTIDO para el rol cajero (clave de
-- configuración `cortesias_mes_cajero`, la fija el admin en Configuración).
-- Cuando el cupo se agota la venta se procesa igual, pero queda PENDIENTE de
-- que un administrador la autorice o la rechace (Admin → Autorizaciones).
--
--   cortesia_estado: dentro_plan  → contó en el cupo del mes
--                    pendiente    → excedió el cupo; espera al administrador
--                    autorizada   → aprobada por un administrador
--                    rechazada    → no aprobada (la venta ya se procesó; se
--                                   resuelve fuera del sistema)
--
-- El primer ALTER TYPE va fuera de transacción (igual que la migración 16):
-- un valor nuevo de enum no puede usarse dentro de la transacción que lo crea.
-- Requiere 00-25. Re-ejecutable.
-- ============================================================================

ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'cortesia';

BEGIN;

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cortesia_estado TEXT
  CHECK (cortesia_estado IN ('dentro_plan', 'pendiente', 'autorizada', 'rechazada'));
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cortesia_motivo TEXT CHECK (length(cortesia_motivo) <= 200);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cortesia_resuelta_por UUID REFERENCES usuarios(id);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cortesia_resuelta_en TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cortesia_nota TEXT CHECK (length(cortesia_nota) <= 300);

-- Coherencia: solo una cortesía lleva estado, toda cortesía lleva estado y
-- una cortesía nunca cobra dinero.
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_cortesia_coherente;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_cortesia_coherente CHECK (
  (cortesia_estado IS NULL OR metodo_pago = 'cortesia')
  AND (metodo_pago IS DISTINCT FROM 'cortesia' OR (cortesia_estado IS NOT NULL AND total = 0))
);

-- El cupo se cuenta por sucursal y mes; el índice parcial mantiene esa
-- consulta barata aunque la tabla de pedidos crezca.
CREATE INDEX IF NOT EXISTS idx_pedidos_cortesias ON pedidos (sucursal_id, creado_en)
  WHERE metodo_pago = 'cortesia';

COMMENT ON COLUMN pedidos.cortesia_estado IS 'Solo para metodo_pago = cortesia: dentro_plan | pendiente | autorizada | rechazada.';
COMMENT ON COLUMN pedidos.cortesia_motivo IS 'Motivo opcional que escribe el cajero al dar la cortesía.';
COMMENT ON COLUMN pedidos.cortesia_nota IS 'Nota del administrador al autorizar o rechazar.';

-- vw_pedidos_con_estado usa p.*: se recrea para que exponga las columnas nuevas
-- (la pantalla de Caja muestra el estado de cada cortesía).
DROP VIEW IF EXISTS vw_pedidos_con_estado;
CREATE VIEW vw_pedidos_con_estado AS
SELECT p.*,
  CASE
    WHEN p.no_show THEN 'no_show'
    WHEN p.cancelado THEN 'cancelado'
    WHEN COUNT(pi.id) = 0 THEN 'pendiente'
    WHEN COUNT(pi.id) = COUNT(*) FILTER (WHERE pi.estado = 'terminado') THEN (CASE WHEN p.cobrado THEN 'terminado' ELSE 'listo' END)
    WHEN COUNT(*) FILTER (WHERE pi.estado <> 'pendiente') > 0 THEN 'en_preparacion'
    ELSE 'pendiente'
  END AS estado
FROM pedidos p
LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
GROUP BY p.id;

-- Ventas por forma de pago: la fila "cortesia" suma $0 en `total` (no entró
-- dinero) y expone en `valor_cortesias` lo que se regaló a precio de menú.
-- Se excluyen los pedidos cancelados, igual que en el resumen del día.
DROP VIEW IF EXISTS vw_ventas_por_metodo_pago;
CREATE VIEW vw_ventas_por_metodo_pago AS
SELECT sucursal_id, metodo_pago, COUNT(*) AS num_pedidos, SUM(total) AS total,
       COALESCE(SUM(subtotal) FILTER (WHERE metodo_pago = 'cortesia'), 0) AS valor_cortesias
FROM pedidos
WHERE cobrado AND NOT no_show AND NOT cancelado
GROUP BY sucursal_id, metodo_pago
ORDER BY total DESC;

GRANT SELECT ON vw_pedidos_con_estado, vw_ventas_por_metodo_pago TO cafeteria_app;

COMMIT;
