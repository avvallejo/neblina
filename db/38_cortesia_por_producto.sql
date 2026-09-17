-- ============================================================================
-- MIGRACIÓN 38 — CORTESÍA POR PRODUCTO (dentro del mismo ticket)
-- ============================================================================
-- Antes una cortesía era el ticket completo en $0, lo que obligaba a abrir un
-- ticket aparte para regalar un producto de un consumo. Ahora la Caja marca
-- QUÉ productos del ticket son de cortesía; el resto se cobra normal.
--
--   pedido_items.es_cortesia   → la línea sale en $0 (precio_unitario conserva
--                                el precio de menú para reportes).
--   pedidos.cortesia_valor     → suma a precio de menú de las líneas de cortesía.
--   pedidos.cortesia_unidades  → unidades regaladas; el cupo mensual de la
--                                sucursal se consume POR UNIDAD (2 cafés = 2).
--   total = (subtotal − cortesia_valor) × (1 − descuento)
--
-- pedidos.cortesia_estado sigue siendo por ticket (dentro_plan | pendiente |
-- autorizada | rechazada): si las unidades del ticket no caben completas en
-- lo que queda del cupo, TODO el ticket queda pendiente de autorización (la
-- venta se procesa igual). metodo_pago = 'cortesia' queda reservado a los
-- tickets donde todo fue cortesía (total 0); un ticket mixto lleva la forma
-- de pago real de lo que sí se cobró.
-- Requiere 00-37. Re-ejecutable.
-- ============================================================================
BEGIN;

ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS es_cortesia BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cortesia_valor NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cortesia_valor >= 0);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cortesia_unidades INTEGER NOT NULL DEFAULT 0 CHECK (cortesia_unidades >= 0);

COMMENT ON COLUMN pedido_items.es_cortesia IS 'La línea se regaló (sale en $0); precio_unitario conserva el precio de menú.';
COMMENT ON COLUMN pedidos.cortesia_valor IS 'Valor a precio de menú de las líneas de cortesía del ticket.';
COMMENT ON COLUMN pedidos.cortesia_unidades IS 'Unidades regaladas en el ticket; el cupo mensual se consume por unidad.';

-- Las cortesías anteriores (ticket completo) se traducen al modelo nuevo:
-- todas sus líneas fueron de cortesía.
UPDATE pedido_items pi SET es_cortesia = true
FROM pedidos p WHERE p.id = pi.pedido_id AND p.metodo_pago = 'cortesia' AND NOT pi.es_cortesia;

UPDATE pedidos p SET cortesia_valor = s.valor, cortesia_unidades = s.unidades
FROM (SELECT pedido_id, COALESCE(SUM(cantidad * precio_unitario), 0) AS valor, COALESCE(SUM(cantidad), 0)::int AS unidades
        FROM pedido_items WHERE es_cortesia AND estado <> 'cancelado' GROUP BY pedido_id) s
WHERE s.pedido_id = p.id AND p.cortesia_estado IS NOT NULL AND p.cortesia_unidades = 0;

-- Coherencia: un ticket con forma de pago 'cortesia' es 100 % cortesía (total 0
-- y con estado); un ticket con estado de cortesía siempre regaló algo.
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_cortesia_coherente;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_cortesia_coherente CHECK (
  (metodo_pago IS DISTINCT FROM 'cortesia' OR (cortesia_estado IS NOT NULL AND total = 0))
  AND (cortesia_estado IS NULL OR cortesia_unidades > 0)
);

-- El cupo se cuenta por sucursal y mes sobre los tickets con cortesía (ya no
-- solo los de forma de pago 'cortesia').
DROP INDEX IF EXISTS idx_pedidos_cortesias;
CREATE INDEX IF NOT EXISTS idx_pedidos_cortesias ON pedidos (sucursal_id, creado_en)
  WHERE cortesia_estado IS NOT NULL;

-- vw_pedidos_con_estado usa p.*: se recrea (misma definición que la 37) para
-- que exponga cortesia_valor y cortesia_unidades a la pantalla de Caja.
DROP VIEW IF EXISTS vw_pedidos_con_estado;
CREATE VIEW vw_pedidos_con_estado AS
SELECT p.*,
  CASE
    WHEN p.no_show THEN 'no_show'
    WHEN p.cancelado THEN 'cancelado'
    WHEN COUNT(pi.id) = 0 THEN 'pendiente'
    WHEN COUNT(pi.id) = COUNT(*) FILTER (WHERE pi.estado = 'terminado') THEN (CASE WHEN p.cobrado THEN 'terminado' ELSE 'listo' END)
    WHEN COUNT(*) FILTER (WHERE pi.estado <> 'pendiente' AND pi.estacion_preparacion <> 'caja') > 0 THEN 'en_preparacion'
    ELSE 'pendiente'
  END AS estado
FROM pedidos p
LEFT JOIN pedido_items pi ON pi.pedido_id = p.id AND pi.estado <> 'cancelado'
GROUP BY p.id;

-- Ventas por forma de pago: las formas reales suman lo que sí se cobró (un
-- ticket mixto cuenta en su forma de pago con su total pagado); la fila
-- 'cortesia' agrupa TODO lo regalado (tickets completos y parciales) con
-- total 0, valor a precio de menú y unidades.
DROP VIEW IF EXISTS vw_ventas_por_metodo_pago;
CREATE VIEW vw_ventas_por_metodo_pago AS
SELECT * FROM (
  SELECT sucursal_id, metodo_pago, COUNT(*) AS num_pedidos, SUM(total) AS total,
         0::numeric AS valor_cortesias, 0::bigint AS unidades_cortesia
  FROM pedidos
  WHERE cobrado AND NOT no_show AND NOT cancelado AND metodo_pago <> 'cortesia'
  GROUP BY sucursal_id, metodo_pago
  UNION ALL
  SELECT sucursal_id, 'cortesia'::metodo_pago, COUNT(*), 0::numeric,
         COALESCE(SUM(cortesia_valor), 0), COALESCE(SUM(cortesia_unidades), 0)
  FROM pedidos
  WHERE cobrado AND NOT no_show AND NOT cancelado AND cortesia_estado IS NOT NULL
  GROUP BY sucursal_id
) v
ORDER BY total DESC, metodo_pago;

-- Productos más vendidos: las unidades regaladas siguen contando como
-- unidades (se prepararon), pero ya no suman ingresos.
CREATE OR REPLACE VIEW vw_productos_mas_vendidos AS
SELECT p.sucursal_id, pr.id AS producto_id, COALESCE(pi.concepto_libre,pr.nombre) AS nombre, SUM(pi.cantidad) AS unidades_vendidas,
       SUM(pi.cantidad * pi.precio_unitario) FILTER (WHERE NOT pi.es_cortesia) AS ingresos
FROM pedido_items pi
JOIN pedidos p ON p.id = pi.pedido_id
LEFT JOIN productos pr ON pr.id = pi.producto_id
WHERE p.cobrado AND NOT p.cancelado AND NOT p.no_show AND pi.estado <> 'cancelado' AND NOT pi.es_regalo
GROUP BY p.sucursal_id, pr.id, COALESCE(pi.concepto_libre,pr.nombre)
ORDER BY unidades_vendidas DESC;

GRANT SELECT ON vw_pedidos_con_estado, vw_ventas_por_metodo_pago, vw_productos_mas_vendidos TO cafeteria_app;

COMMIT;
