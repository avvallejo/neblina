-- ============================================================================
-- MIGRACIÓN 12 — MULTI-SUCURSAL
-- ============================================================================
-- Convierte el sistema de "una sola cafetería" a 2-5 sucursales en la misma
-- base de datos, según lo decidido en PLAN_MULTISUCURSAL.md:
--   * Catálogo (productos, recetas, precios, opciones) POR SUCURSAL.
--   * Clientes y fidelidad POR SUCURSAL (el teléfono es único por sede).
--   * Un turno abierto POR SUCURSAL (ya no uno global).
--   * Folios de pedido con prefijo por sede (S1-P-105, S2-P-1, ...).
--
-- Es segura sobre una base con datos: todo lo existente se asigna a la
-- sucursal "Principal" (backfill) antes de endurecer las restricciones.
-- Requiere 00-11 ya aplicados. Es re-ejecutable (guardas IF EXISTS/IF NOT
-- EXISTS y DO-blocks idempotentes), igual que 08/10.
--
-- ⚠️ IMPORTANTE: esta migración cambia contratos que la API usa hoy
-- (PK de configuracion, vistas con columna sucursal_id, funciones de costos
-- con firma nueva). Debe desplegarse JUNTO con la Fase 2/3 de la API
-- (auth + rutas con sucursal). En desarrollo local no hay problema: el
-- contenedor corre todas las migraciones y el código de la API se actualiza
-- en el mismo commit.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. LA TABLA MADRE Y LA SUCURSAL SEMILLA
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sucursales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL UNIQUE,
  prefijo_folio  TEXT NOT NULL UNIQUE CHECK (prefijo_folio ~ '^[A-Z0-9]{1,6}$'),
  -- Contador de folios de ESTA sede. Se usa con UPDATE ... RETURNING, que
  -- serializa solo los pedidos de la misma sede (a escala de cafetería es
  -- más que suficiente y, a diferencia de una secuencia por sede, no
  -- requiere privilegios de CREATE para el rol de la API al abrir sedes).
  folio_contador BIGINT NOT NULL DEFAULT 0,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE sucursales IS 'Cada punto de venta del negocio. Todo el catálogo, inventario, clientes y operación cuelgan de una sucursal.';

INSERT INTO sucursales (nombre, prefijo_folio)
VALUES ('Principal', 'S1')
ON CONFLICT (nombre) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON sucursales TO cafeteria_app;

-- ----------------------------------------------------------------------------
-- 2. sucursal_id EN CADA TABLA (con backfill a "Principal")
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE
  v_suc UUID;
  t TEXT;
BEGIN
  SELECT id INTO v_suc FROM sucursales WHERE nombre = 'Principal';

  FOREACH t IN ARRAY ARRAY[
    -- operación
    'turnos', 'pedidos', 'clientes', 'mermas', 'lotes',
    'movimientos_inventario', 'gastos_fijos', 'verificaciones_telefono',
    -- catálogo por sucursal
    'productos', 'categorias_producto', 'materias_primas',
    'categorias_materia_prima', 'proveedores',
    'opciones_tamano', 'opciones_leche', 'opciones_cafe', 'opciones_extra',
    'promociones_apertura', 'promocion_fidelidad',
    'configuracion_margen', 'configuracion'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id)', t);
    EXECUTE format('UPDATE %I SET sucursal_id = $1 WHERE sucursal_id IS NULL', t) USING v_suc;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN sucursal_id SET NOT NULL', t);
  END LOOP;

  -- auditoria: nullable (un admin general puede hacer acciones sin sede).
  ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);

  -- usuarios: cajero/barista SIEMPRE tienen sede; admin con sucursal_id NULL
  -- es "admin general" (todas las sedes). Los admin existentes pasan a ser
  -- generales; el resto del personal queda en Principal.
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
  UPDATE usuarios SET sucursal_id = v_suc WHERE sucursal_id IS NULL AND rol <> 'admin';
END $mig$;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS chk_usuarios_sucursal;
ALTER TABLE usuarios ADD CONSTRAINT chk_usuarios_sucursal
  CHECK (rol = 'admin' OR sucursal_id IS NOT NULL);
COMMENT ON COLUMN usuarios.sucursal_id IS 'Sede del empleado. NULL solo para admin = administrador general con acceso a todas las sucursales.';

-- No necesitan columna (heredan sucursal vía su FK padre):
--   pedido_items (pedido), pedido_item_extras (item), recetas (producto),
--   receta_insumos_fijos (producto), tamano_empaque / tamano_leche_cantidad
--   (tamaño), promocion_apertura_productos (promoción), aprobaciones_descuento
--   e intentos_autorizacion_descuento (usuarios), lotes_sincronizacion (usuario/cliente).

-- ----------------------------------------------------------------------------
-- 3. UNICIDADES: DE GLOBALES A "POR SUCURSAL"
-- ----------------------------------------------------------------------------
-- Un turno abierto POR SEDE (antes: uno en todo el sistema).
DROP INDEX IF EXISTS uq_un_turno_abierto;
CREATE UNIQUE INDEX IF NOT EXISTS uq_un_turno_abierto_por_sucursal
  ON turnos (sucursal_id) WHERE cerrado_en IS NULL;

-- El mismo teléfono puede ser cliente de dos sedes (carteras separadas).
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_telefono_key;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS uq_clientes_sucursal_telefono;
ALTER TABLE clientes ADD CONSTRAINT uq_clientes_sucursal_telefono UNIQUE (sucursal_id, telefono);

-- Nombres y códigos de catálogo únicos por sede, no globales.
ALTER TABLE categorias_materia_prima DROP CONSTRAINT IF EXISTS categorias_materia_prima_nombre_key;
ALTER TABLE categorias_materia_prima DROP CONSTRAINT IF EXISTS uq_cat_mp_sucursal_nombre;
ALTER TABLE categorias_materia_prima ADD CONSTRAINT uq_cat_mp_sucursal_nombre UNIQUE (sucursal_id, nombre);

ALTER TABLE categorias_producto DROP CONSTRAINT IF EXISTS categorias_producto_nombre_key;
ALTER TABLE categorias_producto DROP CONSTRAINT IF EXISTS uq_cat_prod_sucursal_nombre;
ALTER TABLE categorias_producto ADD CONSTRAINT uq_cat_prod_sucursal_nombre UNIQUE (sucursal_id, nombre);

ALTER TABLE opciones_tamano DROP CONSTRAINT IF EXISTS opciones_tamano_codigo_key;
ALTER TABLE opciones_tamano DROP CONSTRAINT IF EXISTS uq_opciones_tamano_sucursal_codigo;
ALTER TABLE opciones_tamano ADD CONSTRAINT uq_opciones_tamano_sucursal_codigo UNIQUE (sucursal_id, codigo);

ALTER TABLE opciones_leche DROP CONSTRAINT IF EXISTS opciones_leche_codigo_key;
ALTER TABLE opciones_leche DROP CONSTRAINT IF EXISTS uq_opciones_leche_sucursal_codigo;
ALTER TABLE opciones_leche ADD CONSTRAINT uq_opciones_leche_sucursal_codigo UNIQUE (sucursal_id, codigo);

ALTER TABLE opciones_cafe DROP CONSTRAINT IF EXISTS opciones_cafe_codigo_key;
ALTER TABLE opciones_cafe DROP CONSTRAINT IF EXISTS uq_opciones_cafe_sucursal_codigo;
ALTER TABLE opciones_cafe ADD CONSTRAINT uq_opciones_cafe_sucursal_codigo UNIQUE (sucursal_id, codigo);

ALTER TABLE opciones_extra DROP CONSTRAINT IF EXISTS opciones_extra_codigo_key;
ALTER TABLE opciones_extra DROP CONSTRAINT IF EXISTS uq_opciones_extra_sucursal_codigo;
ALTER TABLE opciones_extra ADD CONSTRAINT uq_opciones_extra_sucursal_codigo UNIQUE (sucursal_id, codigo);

-- configuracion: de PK (clave) a PK (sucursal_id, clave) — cada sede tiene
-- su nombre, logo y bandera de SMS.
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    WHERE r.relname = 'configuracion' AND c.contype = 'p'
      AND array_length(c.conkey, 1) = 1
  ) THEN
    ALTER TABLE configuracion DROP CONSTRAINT configuracion_pkey;
    ALTER TABLE configuracion ADD PRIMARY KEY (sucursal_id, clave);
  END IF;
END $mig$;

-- Índices de consulta por sede.
CREATE INDEX IF NOT EXISTS idx_pedidos_sucursal_creado ON pedidos (sucursal_id, creado_en DESC);
DROP INDEX IF EXISTS idx_materias_stock_bajo;
CREATE INDEX IF NOT EXISTS idx_materias_stock_bajo
  ON materias_primas (sucursal_id) WHERE stock_actual < stock_minimo;
DROP INDEX IF EXISTS idx_verificaciones_telefono;
CREATE INDEX IF NOT EXISTS idx_verificaciones_telefono
  ON verificaciones_telefono (sucursal_id, telefono, creado_en DESC);

-- ----------------------------------------------------------------------------
-- 4. FOLIOS POR SUCURSAL
-- ----------------------------------------------------------------------------
-- Se retira la secuencia global; cada sede folía con su prefijo ('S1-P-105').
-- Los folios ya emitidos ('P-104'...) no se tocan: siguen siendo únicos.
DO $mig$
DECLARE
  v_ultimo BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'pedidos_folio_seq' AND relkind = 'S') THEN
    ALTER TABLE pedidos ALTER COLUMN folio DROP DEFAULT;
    SELECT last_value INTO v_ultimo FROM pedidos_folio_seq;
    UPDATE sucursales SET folio_contador = GREATEST(folio_contador, v_ultimo)
    WHERE nombre = 'Principal';
    DROP SEQUENCE pedidos_folio_seq;
  END IF;
END $mig$;

CREATE OR REPLACE FUNCTION fn_asignar_folio() RETURNS TRIGGER AS $$
DECLARE
  v_prefijo TEXT;
  v_n       BIGINT;
BEGIN
  IF NEW.folio IS NULL THEN
    UPDATE sucursales
      SET folio_contador = folio_contador + 1
      WHERE id = NEW.sucursal_id
      RETURNING prefijo_folio, folio_contador INTO v_prefijo, v_n;
    IF v_prefijo IS NULL THEN
      RAISE EXCEPTION 'La sucursal % no existe.', NEW.sucursal_id;
    END IF;
    NEW.folio := v_prefijo || '-P-' || v_n;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_folio ON pedidos;
CREATE TRIGGER trg_asignar_folio BEFORE INSERT ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_asignar_folio();

-- ----------------------------------------------------------------------------
-- 5. TURNO AUTOMÁTICO: AHORA EL DE LA SEDE DEL PEDIDO
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_asignar_turno_abierto() RETURNS TRIGGER AS $$
DECLARE
  v_turno_sucursal UUID;
BEGIN
  IF NEW.turno_id IS NULL THEN
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
-- (el trigger trg_asignar_turno de la migración 02 ya apunta a esta función)

-- ----------------------------------------------------------------------------
-- 6. HERENCIA Y BLINDAJE DE SUCURSAL EN INVENTARIO
-- ----------------------------------------------------------------------------
-- lotes / mermas / movimientos_inventario heredan la sede de su materia prima
-- si no la traen, y rechazan una sede distinta. Esto mantiene funcionando a
-- fn_consumir_insumo (que inserta movimientos sin conocer la sede) y elimina
-- de raíz los cruces de inventario entre sedes.
CREATE OR REPLACE FUNCTION fn_heredar_sucursal_de_materia() RETURNS TRIGGER AS $$
DECLARE
  v_suc UUID;
BEGIN
  SELECT sucursal_id INTO v_suc FROM materias_primas WHERE id = NEW.materia_prima_id;
  IF v_suc IS NULL THEN
    RAISE EXCEPTION 'La materia prima % no existe.', NEW.materia_prima_id;
  END IF;
  IF NEW.sucursal_id IS NULL THEN
    NEW.sucursal_id := v_suc;
  ELSIF NEW.sucursal_id <> v_suc THEN
    RAISE EXCEPTION 'Conflicto de sucursal: la materia prima pertenece a otra sede.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sucursal_lotes ON lotes;
CREATE TRIGGER trg_sucursal_lotes BEFORE INSERT ON lotes
  FOR EACH ROW EXECUTE FUNCTION fn_heredar_sucursal_de_materia();
DROP TRIGGER IF EXISTS trg_sucursal_mermas ON mermas;
CREATE TRIGGER trg_sucursal_mermas BEFORE INSERT ON mermas
  FOR EACH ROW EXECUTE FUNCTION fn_heredar_sucursal_de_materia();
DROP TRIGGER IF EXISTS trg_sucursal_movimientos ON movimientos_inventario;
CREATE TRIGGER trg_sucursal_movimientos BEFORE INSERT ON movimientos_inventario
  FOR EACH ROW EXECUTE FUNCTION fn_heredar_sucursal_de_materia();

-- Como las columnas quedan NOT NULL después del backfill y el BEFORE trigger
-- las llena, se endurecen aquí (el DO del punto 2 ya las dejó NOT NULL).

-- ----------------------------------------------------------------------------
-- 7. BLINDAJE CONTRA REFERENCIAS CRUZADAS ENTRE SEDES
-- ----------------------------------------------------------------------------
-- Un pedido de la sede A jamás debe referenciar productos/opciones de la B;
-- una receta jamás un insumo de otra sede; etc. La API filtrará por sede,
-- pero la base de datos es la última línea de defensa.

-- 7a. pedido_items: producto y opciones de la misma sede que el pedido.
CREATE OR REPLACE FUNCTION fn_validar_sucursal_pedido_item() RETURNS TRIGGER AS $$
DECLARE
  v_pedido_suc UUID;
  v_otra       UUID;
BEGIN
  SELECT sucursal_id INTO v_pedido_suc FROM pedidos WHERE id = NEW.pedido_id;

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

DROP TRIGGER IF EXISTS trg_validar_sucursal_pedido_item ON pedido_items;
CREATE TRIGGER trg_validar_sucursal_pedido_item BEFORE INSERT ON pedido_items
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sucursal_pedido_item();

-- 7b. pedido_item_extras: el extra debe ser de la sede del pedido.
CREATE OR REPLACE FUNCTION fn_validar_sucursal_item_extra() RETURNS TRIGGER AS $$
DECLARE
  v_pedido_suc UUID;
  v_extra_suc  UUID;
BEGIN
  SELECT p.sucursal_id INTO v_pedido_suc
  FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id
  WHERE pi.id = NEW.pedido_item_id;
  SELECT sucursal_id INTO v_extra_suc FROM opciones_extra WHERE id = NEW.extra_id;
  IF v_extra_suc IS DISTINCT FROM v_pedido_suc THEN
    RAISE EXCEPTION 'El extra pertenece a otra sucursal.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_sucursal_item_extra ON pedido_item_extras;
CREATE TRIGGER trg_validar_sucursal_item_extra BEFORE INSERT ON pedido_item_extras
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sucursal_item_extra();

-- 7c. receta_insumos_fijos: insumo de la misma sede que el producto.
CREATE OR REPLACE FUNCTION fn_validar_sucursal_receta_insumo() RETURNS TRIGGER AS $$
DECLARE
  v_prod_suc UUID;
  v_mat_suc  UUID;
BEGIN
  SELECT sucursal_id INTO v_prod_suc FROM productos WHERE id = NEW.producto_id;
  SELECT sucursal_id INTO v_mat_suc FROM materias_primas WHERE id = NEW.materia_prima_id;
  IF v_mat_suc IS DISTINCT FROM v_prod_suc THEN
    RAISE EXCEPTION 'El insumo pertenece a otra sucursal que el producto.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_sucursal_receta_insumo ON receta_insumos_fijos;
CREATE TRIGGER trg_validar_sucursal_receta_insumo BEFORE INSERT OR UPDATE ON receta_insumos_fijos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sucursal_receta_insumo();

-- 7d. opciones que descuentan un insumo: insumo de su misma sede.
CREATE OR REPLACE FUNCTION fn_validar_sucursal_opcion_materia() RETURNS TRIGGER AS $$
DECLARE
  v_mat_suc UUID;
BEGIN
  IF NEW.materia_prima_id IS NOT NULL THEN
    SELECT sucursal_id INTO v_mat_suc FROM materias_primas WHERE id = NEW.materia_prima_id;
    IF v_mat_suc IS DISTINCT FROM NEW.sucursal_id THEN
      RAISE EXCEPTION 'La materia prima pertenece a otra sucursal.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_sucursal_op_leche ON opciones_leche;
CREATE TRIGGER trg_validar_sucursal_op_leche BEFORE INSERT OR UPDATE ON opciones_leche
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sucursal_opcion_materia();
DROP TRIGGER IF EXISTS trg_validar_sucursal_op_cafe ON opciones_cafe;
CREATE TRIGGER trg_validar_sucursal_op_cafe BEFORE INSERT OR UPDATE ON opciones_cafe
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sucursal_opcion_materia();
DROP TRIGGER IF EXISTS trg_validar_sucursal_op_extra ON opciones_extra;
CREATE TRIGGER trg_validar_sucursal_op_extra BEFORE INSERT OR UPDATE ON opciones_extra
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sucursal_opcion_materia();

-- 7e. tamano_empaque: vaso y tapa de la misma sede que el tamaño.
CREATE OR REPLACE FUNCTION fn_validar_sucursal_empaque() RETURNS TRIGGER AS $$
DECLARE
  v_tam_suc  UUID;
  v_vaso_suc UUID;
  v_tapa_suc UUID;
BEGIN
  SELECT sucursal_id INTO v_tam_suc FROM opciones_tamano WHERE id = NEW.tamano_id;
  SELECT sucursal_id INTO v_vaso_suc FROM materias_primas WHERE id = NEW.materia_prima_vaso_id;
  SELECT sucursal_id INTO v_tapa_suc FROM materias_primas WHERE id = NEW.materia_prima_tapa_id;
  IF v_vaso_suc IS DISTINCT FROM v_tam_suc OR v_tapa_suc IS DISTINCT FROM v_tam_suc THEN
    RAISE EXCEPTION 'El empaque referencia insumos de otra sucursal.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_sucursal_empaque ON tamano_empaque;
CREATE TRIGGER trg_validar_sucursal_empaque BEFORE INSERT OR UPDATE ON tamano_empaque
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sucursal_empaque();

-- 7f. promoción de apertura: sus productos deben ser de su sede;
--     promoción de fidelidad: el premio debe ser de su sede.
CREATE OR REPLACE FUNCTION fn_validar_sucursal_promo_producto() RETURNS TRIGGER AS $$
DECLARE
  v_promo_suc UUID;
  v_prod_suc  UUID;
BEGIN
  SELECT sucursal_id INTO v_promo_suc FROM promociones_apertura WHERE id = NEW.promocion_id;
  SELECT sucursal_id INTO v_prod_suc FROM productos WHERE id = NEW.producto_id;
  IF v_prod_suc IS DISTINCT FROM v_promo_suc THEN
    RAISE EXCEPTION 'El producto pertenece a otra sucursal que la promoción.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_sucursal_promo_producto ON promocion_apertura_productos;
CREATE TRIGGER trg_validar_sucursal_promo_producto BEFORE INSERT OR UPDATE ON promocion_apertura_productos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sucursal_promo_producto();

CREATE OR REPLACE FUNCTION fn_validar_sucursal_premio_fidelidad() RETURNS TRIGGER AS $$
DECLARE
  v_prod_suc UUID;
BEGIN
  SELECT sucursal_id INTO v_prod_suc FROM productos WHERE id = NEW.producto_premio_id;
  IF v_prod_suc IS DISTINCT FROM NEW.sucursal_id THEN
    RAISE EXCEPTION 'El producto premio pertenece a otra sucursal.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_sucursal_premio ON promocion_fidelidad;
CREATE TRIGGER trg_validar_sucursal_premio BEFORE INSERT OR UPDATE ON promocion_fidelidad
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sucursal_premio_fidelidad();

-- ----------------------------------------------------------------------------
-- 8. GASTOS FIJOS Y MARGEN: FUNCIONES PARAMETRIZADAS POR SEDE
-- ----------------------------------------------------------------------------
-- Primero se retiran las vistas que dependen de las funciones sin parámetro
-- (se recrean por sede en la sección 9).
DROP VIEW IF EXISTS vw_desglose_costo_producto;
DROP VIEW IF EXISTS vw_punto_equilibrio_negocio;

CREATE OR REPLACE FUNCTION fn_gastos_fijos_totales_mes(p_sucursal_id UUID) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(monto_mensual), 0) FROM gastos_fijos
  WHERE activo AND sucursal_id = p_sucursal_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_costo_fijo_unitario(p_sucursal_id UUID) RETURNS NUMERIC AS $$
DECLARE
  v_unidades INTEGER;
BEGIN
  SELECT unidades_estimadas_mes INTO v_unidades FROM configuracion_margen
  WHERE sucursal_id = p_sucursal_id ORDER BY actualizado_en DESC LIMIT 1;
  IF v_unidades IS NULL OR v_unidades = 0 THEN
    RETURN NULL;
  END IF;
  RETURN ROUND(fn_gastos_fijos_totales_mes(p_sucursal_id) / v_unidades, 4);
END;
$$ LANGUAGE plpgsql STABLE;

-- Las versiones sin parámetro dejan de existir: cualquier código que las
-- llame debe decir de qué sede habla.
DROP FUNCTION IF EXISTS fn_costo_fijo_unitario();
DROP FUNCTION IF EXISTS fn_gastos_fijos_totales_mes();

CREATE OR REPLACE FUNCTION fn_costo_total_unitario(p_producto_id UUID) RETURNS NUMERIC AS $$
  SELECT fn_costo_teorico_producto(p_producto_id)
       + COALESCE(fn_costo_fijo_unitario((SELECT sucursal_id FROM productos WHERE id = p_producto_id)), 0);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_precio_sugerido(p_producto_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_costo    NUMERIC;
  v_margen   NUMERIC;
  v_redondeo NUMERIC;
  v_precio   NUMERIC;
BEGIN
  v_costo := fn_costo_total_unitario(p_producto_id);
  SELECT porcentaje_ganancia_normal, redondeo INTO v_margen, v_redondeo
  FROM configuracion_margen
  WHERE sucursal_id = (SELECT sucursal_id FROM productos WHERE id = p_producto_id)
  ORDER BY actualizado_en DESC LIMIT 1;
  v_margen := COALESCE(v_margen, 60);
  v_redondeo := COALESCE(v_redondeo, 1);
  v_precio := v_costo * (1 + v_margen / 100.0);
  RETURN CEIL(v_precio / v_redondeo) * v_redondeo;
END;
$$ LANGUAGE plpgsql STABLE;

-- fn_costo_teorico_producto buscaba las opciones de referencia por código
-- GLOBAL ('tradicional', 'entera', '12'); con catálogo por sede eso sería
-- ambiguo. Ahora cada búsqueda se limita a la sede del producto.
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
  IF v_producto.tipo = 'snack' THEN
    RETURN v_producto.precio_base * 0.4;
  END IF;

  SELECT id INTO v_tamano12 FROM opciones_tamano
  WHERE codigo = '12' AND sucursal_id = v_producto.sucursal_id;

  SELECT m.costo_unitario, m.unidad INTO v_cafe
  FROM opciones_cafe oc JOIN materias_primas m ON m.id = oc.materia_prima_id
  WHERE oc.codigo = 'tradicional' AND oc.sucursal_id = v_producto.sucursal_id;
  IF FOUND THEN
    v_costo := v_costo + fn_convertir_unidad(COALESCE(v_receta.gramaje_por_shot, 18), 'g', v_cafe.unidad) * COALESCE(v_cafe.costo_unitario, 0);
  END IF;

  IF v_producto.permite_leche THEN
    SELECT m.costo_unitario, m.unidad INTO v_leche
    FROM opciones_leche ol JOIN materias_primas m ON m.id = ol.materia_prima_id
    WHERE ol.codigo = 'entera' AND ol.sucursal_id = v_producto.sucursal_id;
    SELECT cantidad_ml INTO v_leche_ml FROM tamano_leche_cantidad WHERE tamano_id = v_tamano12;
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

-- ----------------------------------------------------------------------------
-- 9. VISTAS CON DIMENSIÓN DE SUCURSAL
-- ----------------------------------------------------------------------------
-- Se recrean con DROP + CREATE (agregan/reordenan columnas, cosa que
-- CREATE OR REPLACE VIEW no permite).

DROP VIEW IF EXISTS vw_stock_bajo;
CREATE VIEW vw_stock_bajo AS
SELECT m.sucursal_id, m.id, m.nombre, m.categoria_id, cm.nombre AS categoria,
       m.stock_actual, m.stock_minimo, m.unidad,
       p.nombre AS proveedor, p.telefono AS proveedor_telefono,
       ROUND(100.0 * m.stock_actual / GREATEST(m.stock_minimo, 0.001), 1) AS porcentaje_del_minimo
FROM materias_primas m
JOIN categorias_materia_prima cm ON cm.id = m.categoria_id
LEFT JOIN proveedores p ON p.id = m.proveedor_id
WHERE m.activo AND m.stock_actual < m.stock_minimo
ORDER BY porcentaje_del_minimo ASC;

DROP VIEW IF EXISTS vw_ventas_por_metodo_pago;
CREATE VIEW vw_ventas_por_metodo_pago AS
SELECT sucursal_id, metodo_pago, COUNT(*) AS num_pedidos, SUM(total) AS total
FROM pedidos
WHERE cobrado AND NOT no_show
GROUP BY sucursal_id, metodo_pago
ORDER BY total DESC;

DROP VIEW IF EXISTS vw_productos_mas_vendidos;
CREATE VIEW vw_productos_mas_vendidos AS
SELECT pr.sucursal_id, pr.id AS producto_id, pr.nombre, SUM(pi.cantidad) AS unidades_vendidas,
       SUM(pi.cantidad * pi.precio_unitario) AS ingresos
FROM pedido_items pi
JOIN pedidos p ON p.id = pi.pedido_id
JOIN productos pr ON pr.id = pi.producto_id
WHERE NOT p.cancelado AND NOT pi.es_regalo
GROUP BY pr.sucursal_id, pr.id, pr.nombre
ORDER BY unidades_vendidas DESC;

DROP VIEW IF EXISTS vw_cancelaciones_no_show;
CREATE VIEW vw_cancelaciones_no_show AS
SELECT
  sucursal_id,
  COUNT(*) FILTER (WHERE cancelado AND NOT no_show) AS cancelados,
  COUNT(*) FILTER (WHERE no_show)                   AS no_recogidos,
  SUM(total) FILTER (WHERE no_show)                 AS valor_perdido_no_show
FROM pedidos
GROUP BY sucursal_id;

DROP VIEW IF EXISTS vw_mermas_por_motivo;
CREATE VIEW vw_mermas_por_motivo AS
SELECT mr.sucursal_id, mr.motivo, COUNT(*) AS num_mermas, SUM(mr.cantidad) AS cantidad_total,
       SUM(fn_convertir_unidad(mr.cantidad, mr.unidad, mp.unidad) * mp.costo_unitario) AS costo_estimado
FROM mermas mr
JOIN materias_primas mp ON mp.id = mr.materia_prima_id
GROUP BY mr.sucursal_id, mr.motivo
ORDER BY costo_estimado DESC;

-- KPIs: ahora UNA FILA POR SUCURSAL (su turno abierto o, si no hay, el más
-- reciente). La API filtra la fila de la sede que le interesa.
DROP VIEW IF EXISTS vw_kpis_turno_actual;
CREATE VIEW vw_kpis_turno_actual AS
WITH turno_objetivo AS (
  SELECT DISTINCT ON (sucursal_id) sucursal_id, id, abierto_en
  FROM turnos
  ORDER BY sucursal_id, (cerrado_en IS NULL) DESC, abierto_en DESC
)
SELECT
  t.sucursal_id,
  t.id AS turno_id,
  COUNT(p.id) FILTER (WHERE NOT p.cancelado)                            AS pedidos,
  COALESCE(SUM(p.total) FILTER (WHERE p.cobrado AND NOT p.no_show), 0)  AS ventas,
  COALESCE(AVG(p.total) FILTER (WHERE p.cobrado AND NOT p.no_show), 0)  AS ticket_promedio,
  (SELECT COUNT(*) FROM mermas m
   WHERE m.creado_en >= t.abierto_en AND m.sucursal_id = t.sucursal_id) AS mermas
FROM turno_objetivo t
LEFT JOIN pedidos p ON p.turno_id = t.id
GROUP BY t.sucursal_id, t.id, t.abierto_en;

DROP VIEW IF EXISTS vw_costo_teorico_receta_12oz;
CREATE VIEW vw_costo_teorico_receta_12oz AS
SELECT pr.sucursal_id, pr.id AS producto_id, pr.nombre,
  CASE WHEN mc.id IS NULL THEN 0 ELSE fn_convertir_unidad(COALESCE(re.gramaje_por_shot, 0), 'g', mc.unidad) * COALESCE(mc.costo_unitario, 0) END
    + CASE WHEN ml.id IS NULL THEN 0 ELSE fn_convertir_unidad(COALESCE(tl.cantidad_ml, 0), 'ml', ml.unidad) * COALESCE(ml.costo_unitario, 0) END
    + COALESCE((SELECT SUM(fn_convertir_unidad(rif.cantidad, rif.unidad, mp2.unidad) * mp2.costo_unitario)
                FROM receta_insumos_fijos rif JOIN materias_primas mp2 ON mp2.id = rif.materia_prima_id
                WHERE rif.producto_id = pr.id), 0) AS costo_estimado
FROM productos pr
LEFT JOIN recetas re ON re.producto_id = pr.id
LEFT JOIN opciones_cafe oc ON oc.codigo = 'tradicional' AND oc.sucursal_id = pr.sucursal_id
LEFT JOIN materias_primas mc ON mc.id = oc.materia_prima_id
LEFT JOIN opciones_leche ol ON ol.codigo = 'entera' AND ol.sucursal_id = pr.sucursal_id
LEFT JOIN materias_primas ml ON ml.id = ol.materia_prima_id
LEFT JOIN tamano_leche_cantidad tl ON tl.tamano_id = (
  SELECT id FROM opciones_tamano WHERE codigo = '12' AND sucursal_id = pr.sucursal_id
)
WHERE pr.tipo <> 'snack';

DROP VIEW IF EXISTS vw_costo_real_por_venta;
CREATE VIEW vw_costo_real_por_venta AS
SELECT
  pr.sucursal_id,
  pi.id AS pedido_item_id,
  pi.pedido_id,
  pr.nombre AS producto,
  pi.precio_unitario * pi.cantidad AS precio_cobrado,
  SUM(mi.cantidad * -1 * COALESCE(l.costo_unitario, mp.costo_unitario)) AS costo_real,
  (pi.precio_unitario * pi.cantidad) - SUM(mi.cantidad * -1 * COALESCE(l.costo_unitario, mp.costo_unitario)) AS utilidad_real
FROM pedido_items pi
JOIN productos pr ON pr.id = pi.producto_id
LEFT JOIN movimientos_inventario mi ON mi.pedido_item_id = pi.id AND mi.tipo = 'consumo'
LEFT JOIN materias_primas mp ON mp.id = mi.materia_prima_id
LEFT JOIN lotes l ON l.id = mi.lote_id
WHERE pi.estado = 'terminado'
GROUP BY pr.sucursal_id, pi.id, pi.pedido_id, pr.nombre, pi.precio_unitario, pi.cantidad;

-- p.* ahora incluye sucursal_id; se recrea para que la vista la exponga.
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

DROP VIEW IF EXISTS vw_ventas_reales_promedio_mes;
CREATE VIEW vw_ventas_reales_promedio_mes AS
SELECT
  p.sucursal_id,
  COUNT(*) AS unidades_periodo,
  MIN(p.creado_en)::date AS desde,
  MAX(p.creado_en)::date AS hasta,
  GREATEST(1, CEIL(EXTRACT(EPOCH FROM (MAX(p.creado_en) - MIN(p.creado_en))) / 86400.0 / 30.0)) AS meses_de_historia,
  ROUND(COUNT(*) / GREATEST(1, EXTRACT(EPOCH FROM (MAX(p.creado_en) - MIN(p.creado_en))) / 86400.0 / 30.0)) AS unidades_promedio_mes
FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id
WHERE NOT p.cancelado AND NOT pi.es_regalo
GROUP BY p.sucursal_id;

CREATE VIEW vw_punto_equilibrio_negocio AS
WITH contribucion AS (
  SELECT p.sucursal_id, AVG(fn_precio_efectivo(p.id) - fn_costo_teorico_producto(p.id)) AS margen_contribucion_promedio
  FROM productos p WHERE p.activo
  GROUP BY p.sucursal_id
)
SELECT
  c.sucursal_id,
  fn_gastos_fijos_totales_mes(c.sucursal_id) AS gastos_fijos_mes,
  c.margen_contribucion_promedio,
  CASE WHEN c.margen_contribucion_promedio > 0
       THEN CEIL(fn_gastos_fijos_totales_mes(c.sucursal_id) / c.margen_contribucion_promedio)
       ELSE NULL END AS unidades_punto_equilibrio_mes,
  CASE WHEN c.margen_contribucion_promedio > 0
       THEN CEIL(fn_gastos_fijos_totales_mes(c.sucursal_id) / c.margen_contribucion_promedio / 30.0)
       ELSE NULL END AS unidades_punto_equilibrio_dia
FROM contribucion c;

CREATE VIEW vw_desglose_costo_producto AS
SELECT
  p.sucursal_id, p.id, p.nombre, p.precio_base, fn_precio_efectivo(p.id) AS precio_actual,
  fn_costo_teorico_producto(p.id) AS costo_directo,
  fn_costo_fijo_unitario(p.sucursal_id) AS costo_indirecto_unitario,
  fn_costo_total_unitario(p.id) AS costo_total,
  fn_precio_punto_equilibrio(p.id) AS precio_punto_equilibrio,
  fn_precio_sugerido(p.id) AS precio_sugerido,
  fn_precio_efectivo(p.id) - fn_costo_total_unitario(p.id) AS utilidad_real_estimada
FROM productos p
WHERE p.activo
ORDER BY p.nombre;

-- ----------------------------------------------------------------------------
-- 10. SESIONES: los tokens vigentes no traen sucursal — se revocan todos
-- ----------------------------------------------------------------------------
-- Sube token_version de todo el personal: al desplegar, cada quien vuelve a
-- iniciar sesión y su nuevo JWT ya trae la sede.
UPDATE usuarios SET token_version = token_version + 1;

COMMIT;
