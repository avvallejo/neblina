-- ============================================================================
-- CAFETERÍA MÓVIL — ESQUEMA DE BASE DE DATOS (PostgreSQL 14+)
-- ============================================================================
-- Corresponde 1:1 con el prototipo funcional ya validado (Cliente, Caja,
-- Barista, Admin). Las secciones marcadas "Fase 2" existen como tablas desde
-- ahora para no migrar después, pero su UI todavía no se construyó.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ============================================================================
-- 1. TIPOS ENUMERADOS
-- ============================================================================
CREATE TYPE rol_usuario        AS ENUM ('admin', 'cajero', 'barista');
CREATE TYPE tipo_producto      AS ENUM ('bebida', 'frappe', 'snack');
CREATE TYPE unidad_medida      AS ENUM ('g', 'kg', 'ml', 'l', 'pieza');
CREATE TYPE origen_pedido      AS ENUM ('mostrador', 'app');
CREATE TYPE metodo_pago        AS ENUM ('efectivo', 'tarjeta', 'transferencia', 'mixto', 'regalo');
CREATE TYPE estado_pedido_item AS ENUM ('pendiente', 'en_preparacion', 'terminado', 'cancelado', 'no_recogido');
CREATE TYPE tipo_movimiento    AS ENUM ('compra', 'consumo', 'merma', 'ajuste');

-- ============================================================================
-- 2. PERSONAL Y TURNOS
-- ============================================================================
CREATE TABLE usuarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,
  rol             rol_usuario NOT NULL,
  pin_hash        TEXT NOT NULL,              -- hash (bcrypt/argon2); el PIN nunca se guarda en texto plano
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE usuarios IS 'Personal con acceso al sistema. El prototipo usa PIN de 4 dígitos; aquí se guarda su hash.';

CREATE TABLE turnos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  abierto_por  UUID NOT NULL REFERENCES usuarios(id),
  abierto_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_por  UUID REFERENCES usuarios(id),
  cerrado_en   TIMESTAMPTZ,
  CHECK (cerrado_en IS NULL OR cerrado_en >= abierto_en)
);
-- Garantiza que solo exista un turno abierto a la vez:
CREATE UNIQUE INDEX uq_un_turno_abierto ON turnos ((true)) WHERE cerrado_en IS NULL;

-- ============================================================================
-- 3. CLIENTES Y FIDELIDAD
-- ============================================================================
CREATE TABLE clientes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                 TEXT NOT NULL,
  apellido               TEXT NOT NULL,
  telefono               VARCHAR(10) NOT NULL UNIQUE,
  pedidos_app_contador   INTEGER NOT NULL DEFAULT 0,      -- avanza solo con pedidos COBRADOS (no con regalos)
  recompensa_pendiente   BOOLEAN NOT NULL DEFAULT false,
  creado_en              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clientes_telefono ON clientes(telefono);

-- Configuración única de la promoción (su historial de cambios vive en auditoria).
CREATE TABLE promocion_fidelidad (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activo             BOOLEAN NOT NULL DEFAULT true,
  cada_n_pedidos     INTEGER NOT NULL DEFAULT 10 CHECK (cada_n_pedidos >= 2),
  producto_premio_id UUID NOT NULL,   -- FK a productos se agrega más abajo (orden de declaración)
  actualizado_por    UUID REFERENCES usuarios(id),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. PROVEEDORES E INVENTARIO (materias primas y lotes / PEPS)
-- ============================================================================
CREATE TABLE proveedores (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre    TEXT NOT NULL,
  categoria TEXT NOT NULL,
  contacto  TEXT,
  telefono  VARCHAR(10),
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categorias_materia_prima (
  id     SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE materias_primas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre             TEXT NOT NULL,
  categoria_id       INTEGER NOT NULL REFERENCES categorias_materia_prima(id),
  unidad             unidad_medida NOT NULL,
  stock_actual       NUMERIC(12,3) NOT NULL DEFAULT 0,   -- para insumos con requiere_lote=true, este valor
                                                          -- se mantiene igual a la suma de lotes.cantidad_disponible
  stock_minimo       NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_maximo       NUMERIC(12,3),
  costo_unitario     NUMERIC(12,4) NOT NULL DEFAULT 0,   -- costo de referencia; el costo real por lote vive en lotes
  proveedor_id       UUID REFERENCES proveedores(id),
  requiere_lote      BOOLEAN NOT NULL DEFAULT false,
  requiere_caducidad BOOLEAN NOT NULL DEFAULT false,
  activo             BOOLEAN NOT NULL DEFAULT true,
  observaciones      TEXT,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (stock_actual >= 0)
);
-- Índice parcial: la consulta de "stock bajo" del dashboard de Admin es O(filas calificadas), no un escaneo completo.
CREATE INDEX idx_materias_stock_bajo ON materias_primas (id) WHERE stock_actual < stock_minimo;

CREATE TABLE lotes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  materia_prima_id    UUID NOT NULL REFERENCES materias_primas(id),
  numero_lote         TEXT,
  fecha_compra        DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_caducidad     DATE,
  cantidad_comprada   NUMERIC(12,3) NOT NULL CHECK (cantidad_comprada > 0),
  cantidad_disponible NUMERIC(12,3) NOT NULL,
  unidad              unidad_medida NOT NULL,
  costo_total         NUMERIC(12,2) NOT NULL,
  proveedor_id        UUID REFERENCES proveedores(id),
  factura_referencia  TEXT,
  usuario_id          UUID NOT NULL REFERENCES usuarios(id),
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cantidad_disponible >= 0 AND cantidad_disponible <= cantidad_comprada)
);
-- PEPS: "dame el lote más antiguo con saldo disponible de esta materia prima".
CREATE INDEX idx_lotes_peps ON lotes (materia_prima_id, fecha_compra) WHERE cantidad_disponible > 0;

-- ============================================================================
-- 5. CATÁLOGO (productos, tamaños, leches, cafés, extras)
-- ============================================================================
CREATE TABLE categorias_producto (
  id     SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  orden  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE productos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              TEXT NOT NULL,
  categoria_id        INTEGER NOT NULL REFERENCES categorias_producto(id),
  tipo                tipo_producto NOT NULL,
  icono               TEXT,
  precio_base         NUMERIC(10,2) NOT NULL CHECK (precio_base >= 0),
  precio_promocional  NUMERIC(10,2),
  permite_tamanos     BOOLEAN NOT NULL DEFAULT true,
  permite_leche       BOOLEAN NOT NULL DEFAULT false,
  permite_tipo_cafe   BOOLEAN NOT NULL DEFAULT false,
  permite_extras      BOOLEAN NOT NULL DEFAULT true,
  es_frio             BOOLEAN NOT NULL DEFAULT false,
  tiempo_estimado_min INTEGER,
  activo              BOOLEAN NOT NULL DEFAULT true,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_productos_categoria ON productos(categoria_id) WHERE activo;

-- Ahora que productos existe, se cierra la referencia pendiente de promocion_fidelidad:
ALTER TABLE promocion_fidelidad
  ADD CONSTRAINT fk_promo_producto FOREIGN KEY (producto_premio_id) REFERENCES productos(id);

CREATE TABLE opciones_tamano (
  id           SERIAL PRIMARY KEY,
  codigo       TEXT NOT NULL UNIQUE,     -- '8','12','16'
  etiqueta     TEXT NOT NULL,            -- '8 oz'
  onzas        INTEGER NOT NULL,
  delta_precio NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE opciones_leche (
  id               SERIAL PRIMARY KEY,
  codigo           TEXT NOT NULL UNIQUE,
  etiqueta         TEXT NOT NULL,
  delta_precio     NUMERIC(10,2) NOT NULL DEFAULT 0,
  materia_prima_id UUID REFERENCES materias_primas(id),  -- a qué insumo descuenta
  activo           BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE opciones_cafe (
  id               SERIAL PRIMARY KEY,
  codigo           TEXT NOT NULL UNIQUE,
  etiqueta         TEXT NOT NULL,
  delta_precio     NUMERIC(10,2) NOT NULL DEFAULT 0,
  materia_prima_id UUID REFERENCES materias_primas(id),
  activo           BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE opciones_extra (
  id                  SERIAL PRIMARY KEY,
  codigo              TEXT NOT NULL UNIQUE,
  etiqueta             TEXT NOT NULL,
  delta_precio        NUMERIC(10,2) NOT NULL DEFAULT 0,
  materia_prima_id    UUID REFERENCES materias_primas(id),  -- NULL cuando es_shot_adicional=true (ver función de descuento)
  cantidad            NUMERIC(10,3),
  unidad              unidad_medida,
  es_shot_adicional   BOOLEAN NOT NULL DEFAULT false,        -- caso especial: suma gramaje de café, no un insumo fijo
  activo              BOOLEAN NOT NULL DEFAULT true
);

-- Empaque (vaso/tapa) por tamaño y variante. Se separa 'frappe' de 'fria' porque
-- el frappé usa vaso + tapa domo distintos a una bebida fría normal del mismo tamaño.
CREATE TABLE tamano_empaque (
  id                     SERIAL PRIMARY KEY,
  tamano_id              INTEGER NOT NULL REFERENCES opciones_tamano(id),
  variante               TEXT NOT NULL CHECK (variante IN ('caliente', 'fria', 'frappe')),
  materia_prima_vaso_id  UUID NOT NULL REFERENCES materias_primas(id),
  materia_prima_tapa_id  UUID NOT NULL REFERENCES materias_primas(id),
  UNIQUE (tamano_id, variante)
);

CREATE TABLE tamano_leche_cantidad (
  id          SERIAL PRIMARY KEY,
  tamano_id   INTEGER NOT NULL UNIQUE REFERENCES opciones_tamano(id),
  cantidad_ml NUMERIC(10,2) NOT NULL
);

-- ============================================================================
-- 6. RECETAS
-- ============================================================================
-- Lo que el administrador edita desde "Recetas": pasos y parámetros de
-- extracción. Las CANTIDADES de cada insumo se calculan en tiempo de pedido
-- combinando este registro con tamano_leche_cantidad / tamano_empaque /
-- opciones_leche / opciones_cafe / opciones_extra (ver fn_descontar_inventario).
CREATE TABLE recetas (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id            UUID NOT NULL UNIQUE REFERENCES productos(id) ON DELETE CASCADE,
  pasos                  JSONB NOT NULL DEFAULT '[]',   -- array de strings
  gramaje_por_shot       NUMERIC(6,2),                  -- solo bebidas espresso
  molienda               TEXT,
  molienda_especial      TEXT,
  ajuste_molino          TEXT,
  ajuste_molino_especial TEXT,
  tiempo_extraccion      TEXT,                          -- texto libre, ej. "26-30 s"
  temperatura_servicio   TEXT,
  textura_leche          TEXT,
  es_personalizada       BOOLEAN NOT NULL DEFAULT false, -- false = usa los valores calculados por defecto
  actualizado_por        UUID REFERENCES usuarios(id),
  actualizado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ingredientes fijos extra por producto (ej. Moka -> Chocolate 20g, Caramel Macchiato -> Jarabe 15ml).
CREATE TABLE receta_insumos_fijos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id      UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  materia_prima_id UUID NOT NULL REFERENCES materias_primas(id),
  cantidad         NUMERIC(10,3) NOT NULL,
  unidad           unidad_medida NOT NULL,
  UNIQUE (producto_id, materia_prima_id)
);

-- ============================================================================
-- 7. PEDIDOS Y TICKETS DE PREPARACIÓN
-- ============================================================================
CREATE SEQUENCE pedidos_folio_seq START 104;

CREATE TABLE pedidos (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio                    TEXT NOT NULL UNIQUE DEFAULT ('P-' || nextval('pedidos_folio_seq')),
  turno_id                 UUID REFERENCES turnos(id),
  origen                   origen_pedido NOT NULL DEFAULT 'mostrador',
  cliente_id               UUID REFERENCES clientes(id),        -- solo cuando origen='app'
  cajero_id                UUID REFERENCES usuarios(id),
  hora_recogida            TIMESTAMPTZ,                          -- NULL = "pedir ahora"
  subtotal                 NUMERIC(10,2) NOT NULL DEFAULT 0,
  descuento_porcentaje     NUMERIC(5,2) NOT NULL DEFAULT 0,
  descuento_autorizado_por UUID REFERENCES usuarios(id),
  total                    NUMERIC(10,2) NOT NULL DEFAULT 0,
  metodo_pago              metodo_pago,
  monto_recibido           NUMERIC(10,2),
  cambio                   NUMERIC(10,2),
  cobrado                  BOOLEAN NOT NULL DEFAULT false,       -- false hasta que caja confirme (pedidos en línea)
  cancelado                BOOLEAN NOT NULL DEFAULT false,
  no_show                  BOOLEAN NOT NULL DEFAULT false,
  es_regalo_fidelidad      BOOLEAN NOT NULL DEFAULT false,
  creado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pedidos_turno ON pedidos(turno_id);
CREATE INDEX idx_pedidos_cliente ON pedidos(cliente_id);

CREATE TABLE pedido_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id        UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES productos(id),
  tamano_id        INTEGER REFERENCES opciones_tamano(id),
  leche_id         INTEGER REFERENCES opciones_leche(id),
  cafe_id          INTEGER REFERENCES opciones_cafe(id),
  cantidad         INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario  NUMERIC(10,2) NOT NULL,
  notas            TEXT,
  es_regalo        BOOLEAN NOT NULL DEFAULT false,
  estado           estado_pedido_item NOT NULL DEFAULT 'pendiente',
  iniciado_en      TIMESTAMPTZ,
  terminado_en     TIMESTAMPTZ,
  barista_id       UUID REFERENCES usuarios(id),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pedido_items_pedido ON pedido_items(pedido_id);
CREATE INDEX idx_pedido_items_estado ON pedido_items(estado) WHERE estado IN ('pendiente', 'en_preparacion');

CREATE TABLE pedido_item_extras (
  pedido_item_id UUID NOT NULL REFERENCES pedido_items(id) ON DELETE CASCADE,
  extra_id       INTEGER NOT NULL REFERENCES opciones_extra(id),
  PRIMARY KEY (pedido_item_id, extra_id)
);

-- ============================================================================
-- 8. MERMAS Y MOVIMIENTOS DE INVENTARIO
-- ============================================================================
CREATE TABLE mermas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  materia_prima_id    UUID NOT NULL REFERENCES materias_primas(id),
  cantidad            NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  unidad              unidad_medida NOT NULL,
  motivo              TEXT NOT NULL,
  pedido_item_id      UUID REFERENCES pedido_items(id),
  usuario_id          UUID NOT NULL REFERENCES usuarios(id),
  observacion         TEXT,
  evidencia_foto_url  TEXT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE movimientos_inventario (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  materia_prima_id  UUID NOT NULL REFERENCES materias_primas(id),
  tipo              tipo_movimiento NOT NULL,
  cantidad          NUMERIC(12,3) NOT NULL,    -- positivo = entrada, negativo = salida
  lote_id           UUID REFERENCES lotes(id),
  pedido_item_id    UUID REFERENCES pedido_items(id),
  merma_id          UUID REFERENCES mermas(id),
  usuario_id        UUID REFERENCES usuarios(id),
  motivo            TEXT,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_movimientos_materia ON movimientos_inventario(materia_prima_id, creado_en);

-- ============================================================================
-- 9. FASE 2 — promociones de apertura y margen de ganancia
-- ============================================================================
CREATE TABLE promociones_apertura (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre               TEXT NOT NULL,
  fecha_inicio         DATE NOT NULL,
  fecha_fin            DATE NOT NULL,
  porcentaje_descuento NUMERIC(5,2),
  activo               BOOLEAN NOT NULL DEFAULT true,
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fecha_fin >= fecha_inicio)
);

CREATE TABLE promocion_apertura_productos (
  promocion_id    UUID NOT NULL REFERENCES promociones_apertura(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  precio_especial NUMERIC(10,2),
  PRIMARY KEY (promocion_id, producto_id)
);

CREATE TABLE configuracion_margen (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  porcentaje_ganancia_normal NUMERIC(5,2) NOT NULL DEFAULT 60,
  redondeo                   NUMERIC(4,2) NOT NULL DEFAULT 1,
  actualizado_por            UUID REFERENCES usuarios(id),
  actualizado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 10. AUDITORÍA
-- ============================================================================
CREATE TABLE auditoria (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID REFERENCES usuarios(id),
  entidad        TEXT NOT NULL,        -- 'productos','recetas','materias_primas','pedidos', etc.
  entidad_id     TEXT NOT NULL,
  accion         TEXT NOT NULL,        -- 'crear','editar','desactivar','cancelar','ajustar_stock'...
  valor_anterior JSONB,
  valor_nuevo    JSONB,
  motivo         TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_entidad ON auditoria(entidad, entidad_id);
