-- ============================================================================
-- CAFETERÍA MÓVIL — VISTAS DE REPORTES
-- ============================================================================
-- Corresponden 1:1 a las pantallas ya construidas en el prototipo (Admin →
-- Reportes, y el dashboard de Stock bajo). Requiere schema.sql + functions_triggers.sql.
-- ============================================================================

-- Dashboard → "Stock bajo": insumos por debajo de su mínimo, con su proveedor.
CREATE OR REPLACE VIEW vw_stock_bajo AS
SELECT m.id, m.nombre, m.categoria_id, cm.nombre AS categoria, m.stock_actual, m.stock_minimo, m.unidad,
       p.nombre AS proveedor, p.telefono AS proveedor_telefono,
       ROUND(100.0 * m.stock_actual / GREATEST(m.stock_minimo, 0.001), 1) AS porcentaje_del_minimo
FROM materias_primas m
JOIN categorias_materia_prima cm ON cm.id = m.categoria_id
LEFT JOIN proveedores p ON p.id = m.proveedor_id
WHERE m.activo AND m.stock_actual < m.stock_minimo
ORDER BY porcentaje_del_minimo ASC;

-- Reportes → "Ventas por forma de pago" (solo lo realmente cobrado).
CREATE OR REPLACE VIEW vw_ventas_por_metodo_pago AS
SELECT metodo_pago, COUNT(*) AS num_pedidos, SUM(total) AS total
FROM pedidos
WHERE cobrado AND NOT no_show
GROUP BY metodo_pago
ORDER BY total DESC;

-- Reportes → "Productos más vendidos" (incluye mostrador y app; excluye cancelados).
CREATE OR REPLACE VIEW vw_productos_mas_vendidos AS
SELECT pr.id AS producto_id, pr.nombre, SUM(pi.cantidad) AS unidades_vendidas,
       SUM(pi.cantidad * pi.precio_unitario) AS ingresos
FROM pedido_items pi
JOIN pedidos p ON p.id = pi.pedido_id
JOIN productos pr ON pr.id = pi.producto_id
WHERE NOT p.cancelado AND NOT pi.es_regalo
GROUP BY pr.id, pr.nombre
ORDER BY unidades_vendidas DESC;

-- Reportes → "Cancelaciones y no recogidos".
CREATE OR REPLACE VIEW vw_cancelaciones_no_show AS
SELECT
  COUNT(*) FILTER (WHERE cancelado AND NOT no_show) AS cancelados,
  COUNT(*) FILTER (WHERE no_show)                   AS no_recogidos,
  SUM(total) FILTER (WHERE no_show)                 AS valor_perdido_no_show
FROM pedidos;

-- Reportes → "Mermas por motivo" (cantidad y costo estimado usando el costo de
-- referencia de cada materia prima).
CREATE OR REPLACE VIEW vw_mermas_por_motivo AS
SELECT mr.motivo, COUNT(*) AS num_mermas, SUM(mr.cantidad) AS cantidad_total,
       SUM(fn_convertir_unidad(mr.cantidad, mr.unidad, mp.unidad) * mp.costo_unitario) AS costo_estimado
FROM mermas mr
JOIN materias_primas mp ON mp.id = mr.materia_prima_id
GROUP BY mr.motivo
ORDER BY costo_estimado DESC;

-- Dashboard → KPIs del día (ventas, pedidos, ticket promedio, mermas), basado
-- en el turno abierto actual; si no hay turno abierto, usa el más reciente.
CREATE OR REPLACE VIEW vw_kpis_turno_actual AS
WITH turno_objetivo AS (
  SELECT id, abierto_en FROM turnos ORDER BY (cerrado_en IS NULL) DESC, abierto_en DESC LIMIT 1
)
SELECT
  t.id AS turno_id,
  COUNT(p.id) FILTER (WHERE NOT p.cancelado)                       AS pedidos,
  COALESCE(SUM(p.total) FILTER (WHERE p.cobrado AND NOT p.no_show), 0) AS ventas,
  COALESCE(AVG(p.total) FILTER (WHERE p.cobrado AND NOT p.no_show), 0) AS ticket_promedio,
  (SELECT COUNT(*) FROM mermas m WHERE m.creado_en >= t.abierto_en) AS mermas
FROM turno_objetivo t
LEFT JOIN pedidos p ON p.turno_id = t.id
GROUP BY t.id, t.abierto_en;

-- Costo teórico por receta (útil para "costo por bebida" y margen real),
-- combinando insumos fijos + el costo de café/leche de referencia a tamaño 12oz.
-- Esta vista es orientativa: el costo exacto de cada venta vive en
-- movimientos_inventario (que sí usa el costo real por lote consumido).
CREATE OR REPLACE VIEW vw_costo_teorico_receta_12oz AS
SELECT pr.id AS producto_id, pr.nombre,
  COALESCE(re.gramaje_por_shot, 0) / 1000.0 * COALESCE(mc.costo_unitario, 0)
    + COALESCE(tl.cantidad_ml, 0) / 1000.0 * COALESCE(ml.costo_unitario, 0)
    + COALESCE((SELECT SUM(rif.cantidad * CASE rif.unidad WHEN 'g' THEN 0.001 WHEN 'ml' THEN 0.001 ELSE 1 END * mp2.costo_unitario)
                FROM receta_insumos_fijos rif JOIN materias_primas mp2 ON mp2.id = rif.materia_prima_id
                WHERE rif.producto_id = pr.id), 0) AS costo_estimado
FROM productos pr
LEFT JOIN recetas re ON re.producto_id = pr.id
LEFT JOIN opciones_cafe oc ON oc.codigo = 'tradicional'
LEFT JOIN materias_primas mc ON mc.id = oc.materia_prima_id
LEFT JOIN opciones_leche ol ON ol.codigo = 'entera'
LEFT JOIN materias_primas ml ON ml.id = ol.materia_prima_id
LEFT JOIN tamano_leche_cantidad tl ON tl.tamano_id = (SELECT id FROM opciones_tamano WHERE codigo='12')
WHERE pr.tipo <> 'snack';
