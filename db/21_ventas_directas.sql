BEGIN;
ALTER TABLE pedidos ADD COLUMN registro_manual BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pedidos ADD COLUMN registrado_en TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE pedidos SET registrado_en=creado_en;
ALTER TABLE pedidos ADD COLUMN motivo_registro TEXT;
ALTER TABLE pedidos ADD COLUMN clave_registro UUID;
ALTER TABLE pedidos ADD COLUMN captura_hash TEXT;
CREATE UNIQUE INDEX uq_registro_caja ON pedidos(sucursal_id,clave_registro) WHERE clave_registro IS NOT NULL;
ALTER TABLE pedido_items ALTER COLUMN producto_id DROP NOT NULL;
ALTER TABLE pedido_items ADD COLUMN concepto_libre TEXT;
ALTER TABLE pedido_items ADD COLUMN precio_catalogo NUMERIC(10,2);
ALTER TABLE pedido_items ADD COLUMN motivo_precio TEXT;
ALTER TABLE pedido_items ADD COLUMN insumo_directo_id UUID REFERENCES materias_primas(id);
ALTER TABLE pedido_items ADD COLUMN cantidad_insumo NUMERIC(12,3);
ALTER TABLE pedido_items ADD COLUMN unidad_insumo unidad_medida;
ALTER TABLE pedido_items ADD CONSTRAINT item_concepto CHECK(producto_id IS NOT NULL OR (concepto_libre IS NOT NULL AND length(trim(concepto_libre))>0));
CREATE OR REPLACE FUNCTION fn_asignar_turno_abierto() RETURNS TRIGGER AS $$
DECLARE
  v_turno_sucursal UUID;
BEGIN
  IF NEW.registro_manual THEN
    SELECT id INTO NEW.turno_id FROM turnos WHERE sucursal_id=NEW.sucursal_id AND abierto_en<=NEW.creado_en AND (cerrado_en IS NULL OR cerrado_en>=NEW.creado_en) ORDER BY abierto_en DESC LIMIT 1;
  ELSIF NEW.turno_id IS NULL THEN
    SELECT id INTO NEW.turno_id FROM turnos
    WHERE cerrado_en IS NULL AND sucursal_id = NEW.sucursal_id
    LIMIT 1;
  ELSE
    SELECT sucursal_id INTO v_turno_sucursal FROM turnos WHERE id = NEW.turno_id;
    IF v_turno_sucursal IS DISTINCT FROM NEW.sucursal_id THEN
      RAISE EXCEPTION 'El turno % pertenece a otra sucursal.', NEW.turno_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION fn_validar_sucursal_pedido_item() RETURNS TRIGGER AS $$
DECLARE
  v_pedido_suc UUID;
  v_otra       UUID;
BEGIN
  SELECT sucursal_id INTO v_pedido_suc FROM pedidos WHERE id = NEW.pedido_id;

  IF NEW.producto_id IS NULL THEN
    IF NEW.concepto_libre IS NULL OR NEW.tamano_id IS NOT NULL OR NEW.leche_id IS NOT NULL OR NEW.cafe_id IS NOT NULL THEN RAISE EXCEPTION 'Venta libre inválida'; END IF;
    RETURN NEW;
  END IF;
  SELECT sucursal_id INTO v_otra FROM productos WHERE id = NEW.producto_id;
  IF v_otra IS DISTINCT FROM v_pedido_suc THEN
    RAISE EXCEPTION 'El producto pertenece a otra sucursal.' USING ERRCODE = '23514';
  END IF;

  IF NEW.tamano_id IS NOT NULL THEN
    SELECT sucursal_id INTO v_otra FROM opciones_tamano WHERE id = NEW.tamano_id;
    IF v_otra IS DISTINCT FROM v_pedido_suc THEN
      RAISE EXCEPTION 'El tamaño pertenece a otra sucursal.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.leche_id IS NOT NULL THEN
    SELECT sucursal_id INTO v_otra FROM opciones_leche WHERE id = NEW.leche_id;
    IF v_otra IS DISTINCT FROM v_pedido_suc THEN
      RAISE EXCEPTION 'La opción de leche pertenece a otra sucursal.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.cafe_id IS NOT NULL THEN
    SELECT sucursal_id INTO v_otra FROM opciones_cafe WHERE id = NEW.cafe_id;
    IF v_otra IS DISTINCT FROM v_pedido_suc THEN
      RAISE EXCEPTION 'La opción de café pertenece a otra sucursal.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW vw_productos_mas_vendidos AS
SELECT p.sucursal_id, pr.id AS producto_id, COALESCE(pi.concepto_libre,pr.nombre) AS nombre, SUM(pi.cantidad) AS unidades_vendidas,
       SUM(pi.cantidad * pi.precio_unitario) AS ingresos
FROM pedido_items pi
JOIN pedidos p ON p.id = pi.pedido_id
LEFT JOIN productos pr ON pr.id = pi.producto_id
WHERE NOT p.cancelado AND NOT pi.es_regalo
GROUP BY p.sucursal_id, pr.id, COALESCE(pi.concepto_libre,pr.nombre)
ORDER BY unidades_vendidas DESC;

CREATE OR REPLACE VIEW vw_costo_real_por_venta AS
SELECT
  p.sucursal_id,
  pi.id AS pedido_item_id,
  pi.pedido_id,
  COALESCE(pi.concepto_libre,pr.nombre) AS producto,
  pi.precio_unitario * pi.cantidad AS precio_cobrado,
  SUM(mi.cantidad * -1 * COALESCE(l.costo_unitario, mp.costo_unitario)) AS costo_real,
  (pi.precio_unitario * pi.cantidad) - SUM(mi.cantidad * -1 * COALESCE(l.costo_unitario, mp.costo_unitario)) AS utilidad_real
FROM pedido_items pi
JOIN pedidos p ON p.id=pi.pedido_id
LEFT JOIN productos pr ON pr.id = pi.producto_id
LEFT JOIN movimientos_inventario mi ON mi.pedido_item_id = pi.id AND mi.tipo = 'consumo'
LEFT JOIN materias_primas mp ON mp.id = mi.materia_prima_id
LEFT JOIN lotes l ON l.id = mi.lote_id
WHERE pi.estado = 'terminado'
GROUP BY p.sucursal_id, pi.id, pi.pedido_id, COALESCE(pi.concepto_libre,pr.nombre), pi.precio_unitario, pi.cantidad;

COMMIT;
