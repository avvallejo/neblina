-- ============================================================================
-- CAFETERÍA MÓVIL — DATOS DE EJEMPLO (SOLO DESARROLLO)
-- ============================================================================
-- NO ejecutar en producción: contiene cuentas con PIN públicos. El Compose de
-- producción omite este archivo. Replica el catálogo, proveedores e identidades del
-- prototipo, para poder probar el esquema con datos reales de inmediato.
-- Requiere haber ejecutado schema.sql y functions_triggers.sql primero.
--
-- Los usuarios de prueba usan los mismos PIN del prototipo, pero guardados con
-- hash bcrypt real (vía pgcrypto) — ver el INSERT de usuarios más abajo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Personal (mismos PIN que el prototipo, para poder seguir probando con ellos)
-- ----------------------------------------------------------------------------
-- Los PIN se guardan con hash bcrypt real (vía pgcrypto), no en texto plano.
-- Los PIN de prueba son los mismos que usaste en el prototipo (1234/1111/2222)
-- para que puedas seguir entrando con ellos — pero ya no quedan legibles en la
-- base de datos, y la API los verifica con bcrypt, no con un simple "=".
INSERT INTO usuarios (nombre, rol, pin_hash) VALUES
  ('Administrador', 'admin',   crypt('1234', gen_salt('bf'))),
  ('Caja 1',         'cajero',  crypt('1111', gen_salt('bf'))),
  ('Barista 1',      'barista', crypt('2222', gen_salt('bf')));

-- ----------------------------------------------------------------------------
-- Proveedores
-- ----------------------------------------------------------------------------
INSERT INTO proveedores (nombre, categoria, contacto, telefono) VALUES
  ('Tueste Local',        'Café',    'Mario Pérez',   '9611112233'),
  ('Lácteos del Valle',   'Leche',   'Ana Gómez',     '9612223344'),
  ('Empaques Sureste',    'Empaques','Luis Ramírez',  '9613334455'),
  ('Saborizantes MX',     'Jarabes', 'Diana Cruz',    '9614445566');

-- ----------------------------------------------------------------------------
-- Categorías de materia prima y catálogo de insumos
-- ----------------------------------------------------------------------------
INSERT INTO categorias_materia_prima (nombre) VALUES
  ('Café'), ('Leches'), ('Vasos'), ('Tapas'), ('Jarabes'), ('Hielo'), ('Empaques'), ('Otros');

-- Café (se controla por lote -> PEPS real). stock_actual arranca en 0 y se llena
-- con el lote inicial, porque para insumos con requiere_lote=true el stock vigente
-- siempre es la suma de sus lotes (ver fn_consumir_insumo).
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id, requiere_lote)
  SELECT 'Café tradicional', cm.id, 'kg', 0, 3, 180, pr.id, true
  FROM categorias_materia_prima cm, proveedores pr WHERE cm.nombre='Café' AND pr.nombre='Tueste Local';
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id, requiere_lote)
  SELECT 'Café especial Pluma Hidalgo', cm.id, 'kg', 0, 2, 320, pr.id, true
  FROM categorias_materia_prima cm, proveedores pr WHERE cm.nombre='Café' AND pr.nombre='Tueste Local';

-- Lote inicial de cada café (compra de apertura), y sincronizar stock_actual desde los lotes:
INSERT INTO lotes (materia_prima_id, numero_lote, fecha_compra, cantidad_comprada, cantidad_disponible, unidad, costo_total, proveedor_id, usuario_id)
  SELECT m.id, 'L-APERTURA-001', CURRENT_DATE, 8, 8, 'kg', 8*180, pr.id, u.id
  FROM materias_primas m, proveedores pr, usuarios u
  WHERE m.nombre='Café tradicional' AND pr.nombre='Tueste Local' AND u.rol='admin';
INSERT INTO lotes (materia_prima_id, numero_lote, fecha_compra, cantidad_comprada, cantidad_disponible, unidad, costo_total, proveedor_id, usuario_id)
  SELECT m.id, 'L-APERTURA-002', CURRENT_DATE, 1.2, 1.2, 'kg', 1.2*320, pr.id, u.id
  FROM materias_primas m, proveedores pr, usuarios u
  WHERE m.nombre='Café especial Pluma Hidalgo' AND pr.nombre='Tueste Local' AND u.rol='admin';
UPDATE materias_primas m SET stock_actual = (SELECT COALESCE(SUM(cantidad_disponible),0) FROM lotes WHERE materia_prima_id = m.id)
  WHERE m.requiere_lote;

-- Leches
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id)
  SELECT 'Leche entera', cm.id, 'l', 18, 8, 22, pr.id FROM categorias_materia_prima cm, proveedores pr WHERE cm.nombre='Leches' AND pr.nombre='Lácteos del Valle';
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id)
  SELECT 'Leche deslactosada', cm.id, 'l', 2, 5, 26, pr.id FROM categorias_materia_prima cm, proveedores pr WHERE cm.nombre='Leches' AND pr.nombre='Lácteos del Valle';
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id)
  SELECT 'Leche de avena', cm.id, 'l', 6, 4, 48, pr.id FROM categorias_materia_prima cm, proveedores pr WHERE cm.nombre='Leches' AND pr.nombre='Lácteos del Valle';
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id)
  SELECT 'Leche de almendra', cm.id, 'l', 5, 4, 52, pr.id FROM categorias_materia_prima cm, proveedores pr WHERE cm.nombre='Leches' AND pr.nombre='Lácteos del Valle';

-- Jarabes y toppings
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id)
  SELECT 'Jarabe de vainilla', cm.id, 'l', 0.3, 1, 145, pr.id FROM categorias_materia_prima cm, proveedores pr WHERE cm.nombre='Jarabes' AND pr.nombre='Saborizantes MX';
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id)
  SELECT 'Jarabe de caramelo', cm.id, 'l', 1.5, 1, 145, pr.id FROM categorias_materia_prima cm, proveedores pr WHERE cm.nombre='Jarabes' AND pr.nombre='Saborizantes MX';
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario)
  SELECT 'Crema batida', cm.id, 'kg', 4, 2, 110 FROM categorias_materia_prima cm WHERE cm.nombre='Otros';
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario)
  SELECT 'Chocolate', cm.id, 'kg', 3, 1.5, 160 FROM categorias_materia_prima cm WHERE cm.nombre='Otros';
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario)
  SELECT 'Agua tónica', cm.id, 'l', 6, 3, 35 FROM categorias_materia_prima cm WHERE cm.nombre='Otros';
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario)
  SELECT 'Galleta Oreo', cm.id, 'pieza', 120, 40, 2.5 FROM categorias_materia_prima cm WHERE cm.nombre='Otros';

-- Hielo
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id)
  SELECT 'Hielo', cm.id, 'kg', 25, 10, 8, pr.id FROM categorias_materia_prima cm, proveedores pr WHERE cm.nombre='Hielo' AND pr.nombre='Empaques Sureste';

-- Empaque: vasos (caliente / fría / frappé) y tapas por tamaño, popote y servilleta
INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id) VALUES
  ('Vaso caliente 8 oz',  (SELECT id FROM categorias_materia_prima WHERE nombre='Vasos'), 'pieza', 150, 80,  1.5, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Vaso caliente 12 oz', (SELECT id FROM categorias_materia_prima WHERE nombre='Vasos'), 'pieza', 40,  100, 1.8, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Vaso caliente 16 oz', (SELECT id FROM categorias_materia_prima WHERE nombre='Vasos'), 'pieza', 150, 80,  2.1, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Vaso frío 8 oz',      (SELECT id FROM categorias_materia_prima WHERE nombre='Vasos'), 'pieza', 150, 80,  1.6, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Vaso frío 12 oz',     (SELECT id FROM categorias_materia_prima WHERE nombre='Vasos'), 'pieza', 150, 80,  1.9, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Vaso frío 16 oz',     (SELECT id FROM categorias_materia_prima WHERE nombre='Vasos'), 'pieza', 150, 80,  2.2, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Vaso frappé 12 oz',   (SELECT id FROM categorias_materia_prima WHERE nombre='Vasos'), 'pieza', 100, 60,  2.0, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Vaso frappé 16 oz',   (SELECT id FROM categorias_materia_prima WHERE nombre='Vasos'), 'pieza', 100, 60,  2.3, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste'));

INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id) VALUES
  ('Tapa 8 oz',        (SELECT id FROM categorias_materia_prima WHERE nombre='Tapas'), 'pieza', 150, 80,  0.7, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Tapa 12 oz',       (SELECT id FROM categorias_materia_prima WHERE nombre='Tapas'), 'pieza', 200, 100, 0.9, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Tapa 16 oz',       (SELECT id FROM categorias_materia_prima WHERE nombre='Tapas'), 'pieza', 150, 80,  1.0, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Tapa domo 12 oz',  (SELECT id FROM categorias_materia_prima WHERE nombre='Tapas'), 'pieza', 100, 60,  1.2, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Tapa domo 16 oz',  (SELECT id FROM categorias_materia_prima WHERE nombre='Tapas'), 'pieza', 100, 60,  1.3, (SELECT id FROM proveedores WHERE nombre='Empaques Sureste')),
  ('Popote',           (SELECT id FROM categorias_materia_prima WHERE nombre='Otros'), 'pieza', 300, 150, 0.3, NULL),
  ('Servilleta',       (SELECT id FROM categorias_materia_prima WHERE nombre='Otros'), 'pieza', 500, 200, 0.1, NULL);

-- ----------------------------------------------------------------------------
-- Catálogo de productos
-- ----------------------------------------------------------------------------
INSERT INTO categorias_producto (nombre, orden) VALUES ('Calientes',1), ('Fríos',2), ('Frappés',3), ('Snacks',4);

INSERT INTO productos (nombre, categoria_id, tipo, icono, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, es_frio) VALUES
  ('Americano',          (SELECT id FROM categorias_producto WHERE nombre='Calientes'), 'bebida', '☕', 38, true,  false, true,  true,  false),
  ('Espresso',           (SELECT id FROM categorias_producto WHERE nombre='Calientes'), 'bebida', '☕', 32, false, false, true,  true,  false),
  ('Latte',              (SELECT id FROM categorias_producto WHERE nombre='Calientes'), 'bebida', '🥛', 48, true,  true,  true,  true,  false),
  ('Capuchino',          (SELECT id FROM categorias_producto WHERE nombre='Calientes'), 'bebida', '☕', 46, true,  true,  true,  true,  false),
  ('Moka',               (SELECT id FROM categorias_producto WHERE nombre='Calientes'), 'bebida', '🍫', 54, true,  true,  true,  true,  false),
  ('Caramel Macchiato',  (SELECT id FROM categorias_producto WHERE nombre='Calientes'), 'bebida', '🍮', 56, true,  true,  true,  true,  false),
  ('Espresso Tonic',     (SELECT id FROM categorias_producto WHERE nombre='Fríos'),     'bebida', '🥂', 52, false, false, true,  true,  true),
  ('Latte Helado',       (SELECT id FROM categorias_producto WHERE nombre='Fríos'),     'bebida', '🧊', 50, true,  true,  true,  true,  true),
  ('Frappé Café',        (SELECT id FROM categorias_producto WHERE nombre='Frappés'),   'frappe', '🥤', 58, true,  true,  false, true,  true),
  ('Frappé Oreo',        (SELECT id FROM categorias_producto WHERE nombre='Frappés'),   'frappe', '🍪', 62, true,  true,  false, true,  true),
  ('Donitas',            (SELECT id FROM categorias_producto WHERE nombre='Snacks'),    'snack',  '🍩', 28, false, false, false, false, false),
  ('Galletas',           (SELECT id FROM categorias_producto WHERE nombre='Snacks'),    'snack',  '🍪', 24, false, false, false, false, false);

-- ----------------------------------------------------------------------------
-- Opciones de personalización
-- ----------------------------------------------------------------------------
INSERT INTO opciones_tamano (codigo, etiqueta, onzas, delta_precio) VALUES
  ('8', '8 oz', 8, -6), ('12', '12 oz', 12, 0), ('16', '16 oz', 16, 8);

INSERT INTO opciones_leche (codigo, etiqueta, delta_precio, materia_prima_id) VALUES
  ('entera',       'Leche entera',        0, (SELECT id FROM materias_primas WHERE nombre='Leche entera')),
  ('deslactosada', 'Deslactosada',        0, (SELECT id FROM materias_primas WHERE nombre='Leche deslactosada')),
  ('avena',        'Avena (vegetal)',     8, (SELECT id FROM materias_primas WHERE nombre='Leche de avena')),
  ('almendra',      'Almendra (vegetal)',  8, (SELECT id FROM materias_primas WHERE nombre='Leche de almendra'));

INSERT INTO opciones_cafe (codigo, etiqueta, delta_precio, materia_prima_id) VALUES
  ('tradicional', 'Café tradicional',          0, (SELECT id FROM materias_primas WHERE nombre='Café tradicional')),
  ('especial',    'Café de origen especial',   6, (SELECT id FROM materias_primas WHERE nombre='Café especial Pluma Hidalgo'));

INSERT INTO opciones_extra (codigo, etiqueta, delta_precio, materia_prima_id, cantidad, unidad, es_shot_adicional) VALUES
  ('shot',      'Shot extra',        12, NULL, NULL, NULL, true),
  ('vainilla',  'Jarabe vainilla',    8, (SELECT id FROM materias_primas WHERE nombre='Jarabe de vainilla'), 0.015, 'l', false),
  ('caramelo',  'Jarabe caramelo',    8, (SELECT id FROM materias_primas WHERE nombre='Jarabe de caramelo'), 0.015, 'l', false),
  ('crema',     'Crema batida',      10, (SELECT id FROM materias_primas WHERE nombre='Crema batida'),       20,    'g', false),
  ('chocolate', 'Chocolate extra',    6, (SELECT id FROM materias_primas WHERE nombre='Chocolate'),          15,    'g', false);

-- Empaque por tamaño y variante (caliente / fría / frappé)
INSERT INTO tamano_empaque (tamano_id, variante, materia_prima_vaso_id, materia_prima_tapa_id) VALUES
  ((SELECT id FROM opciones_tamano WHERE codigo='8'),  'caliente', (SELECT id FROM materias_primas WHERE nombre='Vaso caliente 8 oz'),  (SELECT id FROM materias_primas WHERE nombre='Tapa 8 oz')),
  ((SELECT id FROM opciones_tamano WHERE codigo='12'), 'caliente', (SELECT id FROM materias_primas WHERE nombre='Vaso caliente 12 oz'), (SELECT id FROM materias_primas WHERE nombre='Tapa 12 oz')),
  ((SELECT id FROM opciones_tamano WHERE codigo='16'), 'caliente', (SELECT id FROM materias_primas WHERE nombre='Vaso caliente 16 oz'), (SELECT id FROM materias_primas WHERE nombre='Tapa 16 oz')),
  ((SELECT id FROM opciones_tamano WHERE codigo='8'),  'fria',     (SELECT id FROM materias_primas WHERE nombre='Vaso frío 8 oz'),      (SELECT id FROM materias_primas WHERE nombre='Tapa 8 oz')),
  ((SELECT id FROM opciones_tamano WHERE codigo='12'), 'fria',     (SELECT id FROM materias_primas WHERE nombre='Vaso frío 12 oz'),     (SELECT id FROM materias_primas WHERE nombre='Tapa 12 oz')),
  ((SELECT id FROM opciones_tamano WHERE codigo='16'), 'fria',     (SELECT id FROM materias_primas WHERE nombre='Vaso frío 16 oz'),     (SELECT id FROM materias_primas WHERE nombre='Tapa 16 oz')),
  ((SELECT id FROM opciones_tamano WHERE codigo='12'), 'frappe',   (SELECT id FROM materias_primas WHERE nombre='Vaso frappé 12 oz'),   (SELECT id FROM materias_primas WHERE nombre='Tapa domo 12 oz')),
  ((SELECT id FROM opciones_tamano WHERE codigo='16'), 'frappe',   (SELECT id FROM materias_primas WHERE nombre='Vaso frappé 16 oz'),   (SELECT id FROM materias_primas WHERE nombre='Tapa domo 16 oz'));

INSERT INTO tamano_leche_cantidad (tamano_id, cantidad_ml) VALUES
  ((SELECT id FROM opciones_tamano WHERE codigo='8'), 180),
  ((SELECT id FROM opciones_tamano WHERE codigo='12'), 280),
  ((SELECT id FROM opciones_tamano WHERE codigo='16'), 360);

-- ----------------------------------------------------------------------------
-- Recetas estándar (igual que los valores por defecto del prototipo;
-- es_personalizada=false hasta que un admin la edite desde la pantalla Recetas)
-- ----------------------------------------------------------------------------
INSERT INTO recetas (producto_id, pasos, gramaje_por_shot, molienda, molienda_especial, ajuste_molino, ajuste_molino_especial, tiempo_extraccion, temperatura_servicio, textura_leche)
SELECT id,
  CASE WHEN tipo = 'frappe' THEN
    '["Agregar café molido, leche, hielo y base al vaso licuador", "Licuar a velocidad alta 25-30 segundos", "Servir en vaso frío", "Colocar tapa domo y popote"]'::jsonb
  ELSE
    '["Moler el café justo antes de preparar", "Tarar y dosificar el café molido", "Extraer el espresso", "Vaporizar y texturizar la leche si aplica", "Servir y colocar tapa"]'::jsonb
  END,
  CASE WHEN tipo = 'bebida' THEN 18 ELSE NULL END,
  CASE WHEN tipo = 'frappe' THEN 'Gruesa' ELSE 'Media-fina' END,
  'Media (origen)',
  CASE WHEN tipo = 'bebida' THEN '3.5' ELSE NULL END,
  '4.2',
  CASE WHEN tipo = 'frappe' THEN '25-30 s' ELSE '26-30 s' END,
  CASE WHEN es_frio THEN '92°C / servir frío' WHEN tipo='frappe' THEN 'Frío / con hielo' ELSE '92°C' END,
  CASE WHEN permite_leche THEN 'Microespuma suave y sedosa' ELSE NULL END
FROM productos WHERE tipo <> 'snack';

-- Ingredientes fijos extra por producto (lo que en el prototipo eran condicionales
-- por nombre de producto, ahora es un dato normal y editable):
INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES
  ((SELECT id FROM productos WHERE nombre='Moka'),              (SELECT id FROM materias_primas WHERE nombre='Chocolate'),       20,  'g'),
  ((SELECT id FROM productos WHERE nombre='Caramel Macchiato'), (SELECT id FROM materias_primas WHERE nombre='Jarabe de caramelo'), 0.015, 'l'),
  ((SELECT id FROM productos WHERE nombre='Espresso Tonic'),    (SELECT id FROM materias_primas WHERE nombre='Agua tónica'),     0.150, 'l'),
  ((SELECT id FROM productos WHERE nombre='Espresso Tonic'),    (SELECT id FROM materias_primas WHERE nombre='Hielo'),           100, 'g'),
  ((SELECT id FROM productos WHERE nombre='Frappé Oreo'),       (SELECT id FROM materias_primas WHERE nombre='Galleta Oreo'),    2,   'pieza'),
  -- Los frappés no permiten elegir tipo de café (permite_tipo_cafe=false), así que su café
  -- molido va como insumo fijo en vez de resolverse por opciones_cafe:
  ((SELECT id FROM productos WHERE nombre='Frappé Café'),       (SELECT id FROM materias_primas WHERE nombre='Café tradicional'), 14,  'g'),
  ((SELECT id FROM productos WHERE nombre='Frappé Oreo'),       (SELECT id FROM materias_primas WHERE nombre='Café tradicional'), 14,  'g'),
  ((SELECT id FROM productos WHERE nombre='Frappé Café'),       (SELECT id FROM materias_primas WHERE nombre='Hielo'),           180, 'g'),
  ((SELECT id FROM productos WHERE nombre='Frappé Oreo'),       (SELECT id FROM materias_primas WHERE nombre='Hielo'),           180, 'g');

-- ----------------------------------------------------------------------------
-- Fidelidad y margen (Fase 2)
-- ----------------------------------------------------------------------------
INSERT INTO promocion_fidelidad (activo, cada_n_pedidos, producto_premio_id)
  SELECT true, 10, id FROM productos WHERE nombre='Americano';

INSERT INTO configuracion_margen (porcentaje_ganancia_normal, redondeo) VALUES (60, 1);
