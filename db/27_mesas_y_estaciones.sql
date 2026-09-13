-- ============================================================================
-- MIGRACIÓN 27 — MESAS (DESTINO DEL PEDIDO) Y ESTACIONES DE PREPARACIÓN
-- ============================================================================
-- 1) Destino del pedido: a dónde va lo que se prepara. La Caja lo elige antes
--    de cobrar (obligatorio): mesa N, barra o para llevar. Los pedidos en
--    línea no lo llevan (NULL = el cliente pasa a recoger). La cantidad de
--    mesas de cada sede vive en `configuracion` (clave `mesas`, 4 si no hay).
-- 2) Estación de cada producto: quién lo prepara.
--      barra    → barista (bebidas y frappés)
--      parrilla → parrillero (alimentos a la plancha)
--      caja     → no pasa por ninguna comanda (snack empacado); sus ítems
--                 nacen terminados al crear el pedido.
-- 3) Estaciones que atiende cada usuario de preparación (barista/mostrador):
--    {barra} = barista, {parrilla} = parrillero, {barra,parrilla} = ve todo.
--    Los usuarios existentes quedan con AMBAS para que nadie deje de ver
--    pedidos hasta que el admin decida.
-- Requiere 00-26. Re-ejecutable.
-- ============================================================================
BEGIN;

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS destino TEXT CHECK (destino IN ('mesa', 'barra', 'llevar'));
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mesa_numero INTEGER CHECK (mesa_numero > 0 AND mesa_numero <= 200);
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_mesa_coherente;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_mesa_coherente CHECK (
  (destino = 'mesa' AND mesa_numero IS NOT NULL) OR (destino IS DISTINCT FROM 'mesa' AND mesa_numero IS NULL)
);
COMMENT ON COLUMN pedidos.destino IS 'mesa | barra | llevar; NULL = pedido en línea (el cliente recoge).';

ALTER TABLE productos ADD COLUMN IF NOT EXISTS estacion TEXT NOT NULL DEFAULT 'barra'
  CHECK (estacion IN ('barra', 'parrilla', 'caja'));
-- Backfill conservador: lo que hoy no es bebida va a la parrilla (sigue
-- visible en la comanda); el admin marca "se entrega en caja" lo empacado.
UPDATE productos SET estacion = 'parrilla' WHERE tipo = 'snack' AND estacion = 'barra';
COMMENT ON COLUMN productos.estacion IS 'barra (barista) | parrilla (parrillero) | caja (sin preparación: se entrega en caja).';

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estaciones TEXT[] NOT NULL DEFAULT ARRAY['barra', 'parrilla'];
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_estaciones_validas;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_estaciones_validas CHECK (
  cardinality(estaciones) BETWEEN 1 AND 2 AND estaciones <@ ARRAY['barra', 'parrilla']::text[]
);
COMMENT ON COLUMN usuarios.estaciones IS 'Estaciones que ve en su comanda (barista/mostrador): {barra}, {parrilla} o ambas.';

-- vw_pedidos_con_estado usa p.*: se recrea para exponer destino y mesa. Los
-- ítems que se entregan en caja nacen terminados y NO cuentan como "en
-- preparación" (un pedido con galletas + latte sigue pendiente hasta que la
-- barra inicie el latte); sí cuentan para "listo".
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

COMMIT;
