BEGIN;
ALTER TABLE opciones_cafe ADD COLUMN IF NOT EXISTS precio_automatico BOOLEAN NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION fn_recargo_cafe(p_opcion INTEGER, p_gramos NUMERIC DEFAULT 18) RETURNS NUMERIC AS $$
DECLARE
  op opciones_cafe%ROWTYPE;
  diferencia NUMERIC;
  margen NUMERIC;
  redondeo NUMERIC;
BEGIN
  SELECT * INTO op FROM opciones_cafe WHERE id=p_opcion;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT op.precio_automatico THEN RETURN op.delta_precio; END IF;
  SELECT fn_convertir_unidad(p_gramos,'g',m.unidad)*m.costo_unitario
       - fn_convertir_unidad(p_gramos,'g',b.unidad)*b.costo_unitario INTO diferencia
  FROM materias_primas m
  JOIN opciones_cafe base ON base.sucursal_id=op.sucursal_id AND base.codigo='tradicional'
  JOIN materias_primas b ON b.id=base.materia_prima_id
  WHERE m.id=op.materia_prima_id;
  IF diferencia IS NULL THEN RETURN op.delta_precio; END IF;
  SELECT porcentaje_ganancia_normal, cm.redondeo INTO margen,redondeo
  FROM configuracion_margen cm WHERE sucursal_id=op.sucursal_id ORDER BY actualizado_en DESC LIMIT 1;
  redondeo := GREATEST(COALESCE(redondeo,1),0.01);
  RETURN SIGN(diferencia)*CEIL(ABS(diferencia)*(1+COALESCE(margen,60)/100)/redondeo)*redondeo;
END;
$$ LANGUAGE plpgsql STABLE;
COMMIT;
