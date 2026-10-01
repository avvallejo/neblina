-- Insumos reales elegidos por preparación; no modifica consumos históricos.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE insumo_alternativas (
  materia_prima_id UUID NOT NULL REFERENCES materias_primas(id) ON DELETE CASCADE,
  alternativa_id UUID NOT NULL REFERENCES materias_primas(id) ON DELETE CASCADE,
  PRIMARY KEY(materia_prima_id,alternativa_id),
  CHECK(materia_prima_id<>alternativa_id)
);
CREATE TABLE pedido_item_sustituciones (
  pedido_item_id UUID NOT NULL REFERENCES pedido_items(id),
  materia_prima_id UUID NOT NULL REFERENCES materias_primas(id),
  alternativa_id UUID NOT NULL REFERENCES materias_primas(id),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(pedido_item_id,materia_prima_id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON insumo_alternativas,pedido_item_sustituciones TO cafeteria_app;

-- Una bebida sin selector de tamaño sigue teniendo una porción base de leche.
CREATE OR REPLACE FUNCTION fn_leche_ml_receta(p_producto_id UUID,p_tamano_id INTEGER) RETURNS NUMERIC AS $$
  WITH talla AS (
    SELECT COALESCE(p_tamano_id,(SELECT t.id FROM opciones_tamano t JOIN productos p ON p.sucursal_id=t.sucursal_id
      WHERE p.id=p_producto_id AND NOT t.retirado ORDER BY (t.codigo='12') DESC,(t.delta_precio=0) DESC,t.id LIMIT 1)) AS id
  )
  SELECT COALESCE((r.leche_ml_por_tamano ->> t.codigo)::numeric,tl.cantidad_ml)
  FROM productos p LEFT JOIN recetas r ON r.producto_id=p.id
  LEFT JOIN talla ON true LEFT JOIN opciones_tamano t ON t.id=talla.id AND t.sucursal_id=p.sucursal_id
  LEFT JOIN tamano_leche_cantidad tl ON tl.tamano_id=t.id WHERE p.id=p_producto_id;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION fn_insumos_receta_base(p_item UUID)
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


CREATE OR REPLACE FUNCTION fn_alertas_insumos_item(p_item UUID) RETURNS TEXT[] AS $$
DECLARE
  i RECORD;
  problemas TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT pi.*,p.permite_leche,p.permite_tipo_cafe,p.nombre,p.sucursal_id,p.tipo INTO i
  FROM pedido_items pi JOIN productos p ON p.id=pi.producto_id WHERE pi.id=p_item;
  IF NOT FOUND OR i.tipo IN ('snack','alimento') THEN RETURN problemas; END IF;
  IF i.permite_tipo_cafe AND NOT EXISTS(SELECT 1 FROM opciones_cafe o JOIN materias_primas m ON m.id=o.materia_prima_id
    WHERE o.id=i.cafe_id AND m.sucursal_id=i.sucursal_id AND m.unidad IN ('g','kg')) THEN
    problemas:=array_append(problemas,'Falta vincular el café de esta bebida a un insumo en g o kg. Revisa Admin → Opciones → Cafés.');
  END IF;
  IF i.cafe_id IS NULL AND EXISTS(SELECT 1 FROM pedido_item_extras pe JOIN opciones_extra e ON e.id=pe.extra_id WHERE pe.pedido_item_id=i.id AND e.es_shot_adicional) THEN
    problemas:=array_append(problemas,'El shot adicional necesita café base configurado en esta bebida.');
  END IF;
  IF i.permite_leche THEN
    IF NOT EXISTS(SELECT 1 FROM opciones_leche o JOIN materias_primas m ON m.id=o.materia_prima_id
      WHERE o.id=i.leche_id AND m.sucursal_id=i.sucursal_id AND m.unidad IN ('ml','l')) THEN
      problemas:=array_append(problemas,'Falta vincular la leche de esta bebida a un insumo en ml o l. Revisa Admin → Opciones → Leches.');
    END IF;
    IF COALESCE(fn_leche_ml_receta(i.producto_id,i.tamano_id),0)<=0 THEN
      problemas:=array_append(problemas,'Falta una cantidad de leche mayor a cero para esta bebida. Revisa Admin → Recetas.');
    END IF;
  END IF;
  RETURN problemas;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_insumos_preparacion(p_item UUID)
RETURNS TABLE(origen_id UUID,materia_prima_id UUID,cantidad NUMERIC,unidad unidad_medida) AS $$
  SELECT b.materia_prima_id,COALESCE(s.alternativa_id,b.materia_prima_id),
    ROUND(fn_convertir_unidad(b.cantidad,original.unidad,destino.unidad),3),destino.unidad
  FROM fn_insumos_receta_base(p_item) b JOIN materias_primas original ON original.id=b.materia_prima_id
  LEFT JOIN pedido_item_sustituciones s ON s.pedido_item_id=p_item AND s.materia_prima_id=b.materia_prima_id
  JOIN materias_primas destino ON destino.id=COALESCE(s.alternativa_id,b.materia_prima_id);
$$ LANGUAGE SQL STABLE;

-- También el cálculo de recuperación debe respetar el insumo elegido.
CREATE OR REPLACE FUNCTION fn_insumos_regularizacion(p_item UUID)
RETURNS TABLE(materia_prima_id UUID,cantidad NUMERIC) AS $$
  SELECT COALESCE(s.alternativa_id,b.materia_prima_id),
    SUM(CASE WHEN s.alternativa_id IS NULL THEN b.cantidad ELSE ROUND(fn_convertir_unidad(b.cantidad,m.unidad,a.unidad),3) END)
  FROM fn_insumos_receta_base(p_item) b LEFT JOIN materias_primas m ON m.id=b.materia_prima_id
  LEFT JOIN pedido_item_sustituciones s ON s.pedido_item_id=p_item AND s.materia_prima_id=b.materia_prima_id
  LEFT JOIN materias_primas a ON a.id=s.alternativa_id GROUP BY COALESCE(s.alternativa_id,b.materia_prima_id);
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION fn_descontar_inventario() RETURNS TRIGGER AS $$
DECLARE ins RECORD; problemas TEXT[];
BEGIN
  IF NEW.producto_id IS NULL THEN RETURN NEW; END IF;
  problemas:=fn_alertas_insumos_item(NEW.id);
  IF cardinality(problemas)>0 THEN RAISE EXCEPTION '%',array_to_string(problemas,' ') USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM pedido_item_sustituciones s
    WHERE s.pedido_item_id=NEW.id AND (
      NOT EXISTS(SELECT 1 FROM fn_insumos_receta_base(NEW.id) b WHERE b.materia_prima_id=s.materia_prima_id)
      OR NOT EXISTS(SELECT 1 FROM insumo_alternativas a JOIN materias_primas m ON m.id=a.alternativa_id
        JOIN pedidos p ON p.id=NEW.pedido_id WHERE a.materia_prima_id=s.materia_prima_id AND a.alternativa_id=s.alternativa_id
        AND m.activo AND m.sucursal_id=p.sucursal_id))) THEN
    RAISE EXCEPTION 'Cambió la receta o una alternativa autorizada. Revisa Insumos en la comanda.' USING ERRCODE='22023';
  END IF;
  FOR ins IN SELECT materia_prima_id,SUM(cantidad) AS cantidad,unidad FROM fn_insumos_preparacion(NEW.id)
    GROUP BY materia_prima_id,unidad ORDER BY materia_prima_id LOOP
    PERFORM fn_consumir_insumo(ins.materia_prima_id,ins.cantidad,ins.unidad,NEW.barista_id,NEW.id);
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- No sumar café teórico a bebidas que no lo usan como ingrediente base.
CREATE OR REPLACE FUNCTION fn_costo_teorico_producto(p_producto_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_producto  productos%ROWTYPE;
  v_receta    recetas%ROWTYPE;
  v_costo     NUMERIC := 0;
  v_cafe      RECORD;
  v_leche     RECORD;
  v_leche_ml  NUMERIC;
  v_variante  TEXT;
  v_empaque   RECORD;
  v_fijo      RECORD;
  v_tamano12  INTEGER;
BEGIN
  SELECT * INTO v_producto FROM productos WHERE id = p_producto_id;
  SELECT * INTO v_receta FROM recetas WHERE producto_id = p_producto_id;

  IF v_producto.tipo IN ('snack', 'alimento') THEN
    FOR v_fijo IN SELECT rif.cantidad, rif.unidad, m.costo_unitario, m.unidad AS unidad_stock
                  FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
                  WHERE rif.producto_id = p_producto_id
    LOOP
      v_costo := v_costo + fn_convertir_unidad(v_fijo.cantidad, v_fijo.unidad, v_fijo.unidad_stock) * COALESCE(v_fijo.costo_unitario, 0);
    END LOOP;
    IF FOUND THEN RETURN ROUND(v_costo, 2); END IF;
    RETURN CASE WHEN v_producto.tipo = 'snack' THEN v_producto.precio_base * 0.4 ELSE 0 END;
  END IF;

  SELECT id INTO v_tamano12 FROM opciones_tamano
  WHERE codigo = '12' AND sucursal_id = v_producto.sucursal_id;

  SELECT m.costo_unitario, m.unidad INTO v_cafe
  FROM opciones_cafe oc JOIN materias_primas m ON m.id = oc.materia_prima_id
  WHERE oc.codigo = 'tradicional' AND oc.sucursal_id = v_producto.sucursal_id;
  IF FOUND AND v_producto.permite_tipo_cafe THEN
    v_costo := v_costo + fn_convertir_unidad(COALESCE(v_receta.gramaje_por_shot, 18), 'g', v_cafe.unidad) * COALESCE(v_cafe.costo_unitario, 0);
  END IF;

  IF v_producto.permite_leche THEN
    SELECT m.costo_unitario, m.unidad INTO v_leche
    FROM opciones_leche ol JOIN materias_primas m ON m.id = ol.materia_prima_id
    WHERE ol.codigo = 'entera' AND ol.sucursal_id = v_producto.sucursal_id;
    v_leche_ml := fn_leche_ml_receta(p_producto_id, v_tamano12);
    IF v_leche.unidad IS NOT NULL THEN
      v_costo := v_costo + fn_convertir_unidad(COALESCE(v_leche_ml, 0), 'ml', v_leche.unidad) * COALESCE(v_leche.costo_unitario, 0);
    END IF;
  END IF;

  v_variante := CASE WHEN v_producto.tipo = 'frappe' THEN 'frappe' WHEN v_producto.es_frio THEN 'fria' ELSE 'caliente' END;
  SELECT mv.costo_unitario AS vaso, mt.costo_unitario AS tapa INTO v_empaque
  FROM tamano_empaque te
  JOIN materias_primas mv ON mv.id = te.materia_prima_vaso_id
  JOIN materias_primas mt ON mt.id = te.materia_prima_tapa_id
  WHERE te.tamano_id = v_tamano12 AND te.variante = v_variante;
  IF FOUND THEN
    v_costo := v_costo + COALESCE(v_empaque.vaso, 0) + COALESCE(v_empaque.tapa, 0);
  END IF;

  FOR v_fijo IN SELECT rif.cantidad, rif.unidad, m.costo_unitario, m.unidad AS unidad_stock
                FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
                WHERE rif.producto_id = p_producto_id
  LOOP
    v_costo := v_costo + fn_convertir_unidad(v_fijo.cantidad, v_fijo.unidad, v_fijo.unidad_stock) * v_fijo.costo_unitario;
  END LOOP;

  RETURN ROUND(v_costo, 2);
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;
