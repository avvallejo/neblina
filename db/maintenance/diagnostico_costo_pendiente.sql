-- Diagnóstico de SOLO LECTURA: ventas cobradas del mes cuyo costo no ha entrado
-- al costo de ventas. No modifica nada.
--
-- El inventario (y su costo) se descuenta cuando la línea del pedido pasa a
-- 'terminado'. Por eso:
--   * sin_terminar: se cobró pero sigue pendiente / en preparación → el costo
--     llegará cuando barra o parrilla pulse "Terminar".
--   * sin_costo:    se terminó pero no consumió insumos con valor (sin receta,
--     insumos a $0 o concepto libre sin insumo) → su costo nunca llegará.
--
-- Uso en el servidor (mes en curso; cambia la fecha para otro mes):
--   docker exec -i cafeteria-db psql -U postgres -d cafeteria -v mes="'2026-09-01'" < db/maintenance/diagnostico_costo_pendiente.sql
\if :{?mes}
\else
  \set mes 'date_trunc(''month'', now() AT TIME ZONE ''America/Mexico_City'')::date'
\endif

SELECT s.nombre AS sede,
       CASE WHEN pi.estado IN ('pendiente','en_preparacion') THEN 'sin_terminar' ELSE 'sin_costo' END AS motivo,
       (p.creado_en AT TIME ZONE 'America/Mexico_City')::date AS dia,
       p.folio, pi.estado,
       COALESCE(pr.nombre, pi.concepto_libre) AS producto,
       pi.cantidad, pi.precio_unitario * pi.cantidad AS venta
FROM pedidos p
JOIN sucursales s ON s.id = p.sucursal_id
JOIN pedido_items pi ON pi.pedido_id = p.id
LEFT JOIN productos pr ON pr.id = pi.producto_id
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM((-mi.cantidad) * COALESCE(mi.costo_unitario, l.costo_total / NULLIF(fn_convertir_unidad(l.cantidad_comprada, l.unidad, mp.unidad), 0), mp.costo_unitario, 0)),0) AS costo
  FROM movimientos_inventario mi JOIN materias_primas mp ON mp.id = mi.materia_prima_id LEFT JOIN lotes l ON l.id = mi.lote_id
  WHERE mi.pedido_item_id = pi.id AND mi.tipo = 'consumo') cst ON true
WHERE p.cobrado AND NOT p.cancelado AND NOT p.no_show
  AND (p.creado_en AT TIME ZONE 'America/Mexico_City')::date >= (:mes)::date
  AND (p.creado_en AT TIME ZONE 'America/Mexico_City')::date < ((:mes)::date + interval '1 month')::date
  AND (pi.estado IN ('pendiente','en_preparacion') OR (pi.estado = 'terminado' AND cst.costo <= 0))
ORDER BY sede, motivo, dia DESC, p.folio;
