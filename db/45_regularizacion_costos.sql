-- Recuperación explícita y auditable de ventas terminadas sin costo.
-- La migración no modifica ventas, costos ni existencias anteriores.
BEGIN;
CREATE TABLE IF NOT EXISTS regularizaciones_costo (
  id UUID PRIMARY KEY,
  sucursal_id UUID NOT NULL REFERENCES sucursales(id),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  periodo TEXT NOT NULL CHECK (periodo ~ '^\d{4}-\d{2}$'),
  huella TEXT NOT NULL,
  resumen JSONB NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS regularizacion_costo_items (
  pedido_item_id UUID PRIMARY KEY REFERENCES pedido_items(id),
  regularizacion_id UUID NOT NULL REFERENCES regularizaciones_costo(id),
  costo_agregado NUMERIC(20,7) NOT NULL CHECK (costo_agregado > 0),
  detalle JSONB NOT NULL
);
ALTER TABLE regularizacion_costo_items ALTER COLUMN costo_agregado TYPE NUMERIC(20,7);
CREATE INDEX IF NOT EXISTS idx_regularizaciones_costo_periodo ON regularizaciones_costo(sucursal_id, periodo);
GRANT SELECT, INSERT ON regularizaciones_costo, regularizacion_costo_items TO cafeteria_app;

-- La misma composición que fn_descontar_inventario, sin mover existencias.
-- Las cantidades se expresan en la unidad del inventario y su precisión.
CREATE OR REPLACE FUNCTION fn_insumos_regularizacion(p_item UUID)
RETURNS TABLE(materia_prima_id UUID, cantidad NUMERIC) AS $$
  WITH item AS (
    SELECT pi.*, pr.tipo, pr.es_frio, pr.permite_leche,
           COALESCE(re.gramaje_por_shot,18) AS gramaje,
           CASE WHEN EXISTS (SELECT 1 FROM pedido_item_extras pe JOIN opciones_extra oe ON oe.id=pe.extra_id
                             WHERE pe.pedido_item_id=pi.id AND oe.es_shot_adicional) THEN 2 ELSE 1 END AS shots
    FROM pedido_items pi LEFT JOIN productos pr ON pr.id=pi.producto_id
    LEFT JOIN recetas re ON re.producto_id=pi.producto_id WHERE pi.id=p_item
  ), partes AS (
    SELECT f.materia_prima_id AS id, f.cantidad*i.cantidad AS q, f.unidad AS u
    FROM item i JOIN receta_insumos_fijos f ON f.producto_id=i.producto_id
    UNION ALL
    SELECT oe.materia_prima_id, COALESCE(oe.cantidad,1)*i.cantidad, COALESCE(oe.unidad,'pieza')
    FROM item i JOIN pedido_item_extras pe ON pe.pedido_item_id=i.id JOIN opciones_extra oe ON oe.id=pe.extra_id
    WHERE NOT oe.es_shot_adicional AND oe.materia_prima_id IS NOT NULL
    UNION ALL
    SELECT oc.materia_prima_id, i.gramaje*i.shots*i.cantidad, 'g'::unidad_medida
    FROM item i JOIN opciones_cafe oc ON oc.id=i.cafe_id WHERE i.tipo NOT IN ('snack','alimento')
    UNION ALL
    SELECT ol.materia_prima_id, fn_leche_ml_receta(i.producto_id,i.tamano_id)*i.cantidad, 'ml'::unidad_medida
    FROM item i JOIN opciones_leche ol ON ol.id=i.leche_id WHERE i.tipo NOT IN ('snack','alimento') AND i.permite_leche
    UNION ALL
    SELECT te.materia_prima_vaso_id, i.cantidad, 'pieza'::unidad_medida FROM item i JOIN tamano_empaque te ON te.tamano_id=i.tamano_id
    AND te.variante=CASE WHEN i.tipo='frappe' THEN 'frappe' WHEN i.es_frio THEN 'fria' ELSE 'caliente' END WHERE i.tipo NOT IN ('snack','alimento')
    UNION ALL
    SELECT te.materia_prima_tapa_id, i.cantidad, 'pieza'::unidad_medida FROM item i JOIN tamano_empaque te ON te.tamano_id=i.tamano_id
    AND te.variante=CASE WHEN i.tipo='frappe' THEN 'frappe' WHEN i.es_frio THEN 'fria' ELSE 'caliente' END WHERE i.tipo NOT IN ('snack','alimento')
    UNION ALL
    SELECT i.insumo_directo_id, i.cantidad_insumo*i.cantidad, i.unidad_insumo FROM item i WHERE i.producto_id IS NULL AND i.insumo_directo_id IS NOT NULL
  )
  SELECT p.id, SUM(CASE WHEN m.id IS NOT NULL THEN ROUND(fn_convertir_unidad(p.q,p.u,m.unidad),3) END)
  FROM partes p LEFT JOIN materias_primas m ON m.id=p.id GROUP BY p.id;
$$ LANGUAGE SQL STABLE;

-- Respeta el costo congelado (también el regularizado) y convierte unidades.
CREATE OR REPLACE VIEW vw_costo_real_por_venta AS
SELECT p.sucursal_id, pi.id AS pedido_item_id, pi.pedido_id,
  COALESCE(pi.concepto_libre,pr.nombre) AS producto,
  pi.precio_unitario*pi.cantidad AS precio_cobrado,
  SUM(-mi.cantidad*COALESCE(mi.costo_unitario,l.costo_total/NULLIF(fn_convertir_unidad(l.cantidad_comprada,l.unidad,mp.unidad),0),mp.costo_unitario)) AS costo_real,
  pi.precio_unitario*pi.cantidad-SUM(-mi.cantidad*COALESCE(mi.costo_unitario,l.costo_total/NULLIF(fn_convertir_unidad(l.cantidad_comprada,l.unidad,mp.unidad),0),mp.costo_unitario)) AS utilidad_real
FROM pedido_items pi JOIN pedidos p ON p.id=pi.pedido_id LEFT JOIN productos pr ON pr.id=pi.producto_id
LEFT JOIN movimientos_inventario mi ON mi.pedido_item_id=pi.id AND mi.tipo='consumo'
  AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id=mi.id)
LEFT JOIN materias_primas mp ON mp.id=mi.materia_prima_id LEFT JOIN lotes l ON l.id=mi.lote_id
WHERE pi.estado='terminado'
GROUP BY p.sucursal_id,pi.id,pi.pedido_id,COALESCE(pi.concepto_libre,pr.nombre),pi.precio_unitario,pi.cantidad;
COMMIT;
