// Alta del menú de parrilla y de las bebidas embotelladas de una sede.
//   node scripts/agregar-parrilla.js <uuid-sede>            → valida y REVIERTE (ensayo)
//   node scripts/agregar-parrilla.js <uuid-sede> --apply    → aplica
// Crea (si no existen, por nombre): proveedores Leo (carne y pan) y Monterrey
// (abarrotes y bebidas), categorías de insumos "Parrilla" y "Bebidas
// embotelladas", los insumos con niveles de reorden y costo de REFERENCIA,
// la categoría de menú "Parrilla" con Hamburguesa, Quesoburger, Hamburguesa
// vegetariana y Torta (tipo alimento, estación parrilla, receta con
// ingredientes y pasos), los extras de parrilla (tocino, queso extra, doble
// carne) y, en "Fríos", Jamaica, Horchata y Refresco como comprados hechos
// ligados a su insumo. Todo queda en existencia 0: las compras reales se
// registran en Inventario → Registrar compra, y ahí se fija el costo real.
// Precios y cantidades son de referencia: se ajustan en Admin.
// Requiere la migración 30. Idempotente: lo que ya existe se conserva.
const { pool } = require('../src/db');

const PROVEEDORES = [
  { nombre: 'Leo', categorias: ['Carne', 'Pan'], contacto: 'Proveedor de carne y pan' },
  { nombre: 'Monterrey', categorias: ['Abarrotes', 'Verduras', 'Bebidas'], contacto: 'Abarrotes, verduras y bebidas' },
];
const CATEGORIAS_INSUMO = ['Parrilla', 'Bebidas embotelladas'];
// unidad: unidad de control del inventario; costo: referencia por esa unidad;
// min/max: niveles de reorden; presentacion: cómo se compra (opcional).
const INSUMOS = [
  { nombre: 'Pan para hamburguesa', cat: 'Parrilla', unidad: 'pieza', costo: 6, min: 12, max: 40, prov: 'Leo', presentacion: { cantidad: 8, unidad: 'pieza', nombre: 'paquete' } },
  { nombre: 'Telera para torta', cat: 'Parrilla', unidad: 'pieza', costo: 4, min: 10, max: 30, prov: 'Leo' },
  { nombre: 'Carne de res molida (hamburguesa)', cat: 'Parrilla', unidad: 'kg', costo: 180, min: 2, max: 6, prov: 'Leo' },
  { nombre: 'Bistec de res (torta)', cat: 'Parrilla', unidad: 'kg', costo: 200, min: 1, max: 4, prov: 'Leo' },
  { nombre: 'Tocino', cat: 'Parrilla', unidad: 'kg', costo: 220, min: 0.5, max: 2, prov: 'Leo' },
  { nombre: 'Medallón vegetariano', cat: 'Parrilla', unidad: 'pieza', costo: 22, min: 6, max: 20, prov: 'Monterrey' },
  { nombre: 'Queso amarillo (rebanadas)', cat: 'Parrilla', unidad: 'pieza', costo: 2.5, min: 24, max: 72, prov: 'Monterrey', presentacion: { cantidad: 24, unidad: 'pieza', nombre: 'paquete' } },
  { nombre: 'Frijoles refritos', cat: 'Parrilla', unidad: 'kg', costo: 60, min: 1, max: 3, prov: 'Monterrey' },
  { nombre: 'Aguacate', cat: 'Parrilla', unidad: 'kg', costo: 90, min: 1, max: 3, prov: 'Monterrey' },
  { nombre: 'Lechuga', cat: 'Parrilla', unidad: 'kg', costo: 35, min: 0.5, max: 2, prov: 'Monterrey' },
  { nombre: 'Jitomate', cat: 'Parrilla', unidad: 'kg', costo: 40, min: 1, max: 3, prov: 'Monterrey' },
  { nombre: 'Cebolla', cat: 'Parrilla', unidad: 'kg', costo: 30, min: 1, max: 3, prov: 'Monterrey' },
  { nombre: 'Mayonesa', cat: 'Parrilla', unidad: 'kg', costo: 80, min: 0.5, max: 2, prov: 'Monterrey' },
  { nombre: 'Catsup', cat: 'Parrilla', unidad: 'kg', costo: 55, min: 0.5, max: 2, prov: 'Monterrey' },
  { nombre: 'Mostaza', cat: 'Parrilla', unidad: 'kg', costo: 70, min: 0.3, max: 1, prov: 'Monterrey' },
  { nombre: 'Envoltura para hamburguesa/torta', cat: 'Parrilla', unidad: 'pieza', costo: 0.8, min: 50, max: 200, prov: 'Monterrey', presentacion: { cantidad: 100, unidad: 'pieza', nombre: 'paquete' } },
  { nombre: 'Agua de jamaica embotellada', cat: 'Bebidas embotelladas', unidad: 'pieza', costo: 14, min: 6, max: 24, prov: 'Monterrey' },
  { nombre: 'Agua de horchata embotellada', cat: 'Bebidas embotelladas', unidad: 'pieza', costo: 14, min: 6, max: 24, prov: 'Monterrey' },
  { nombre: 'Refresco 355 ml', cat: 'Bebidas embotelladas', unidad: 'pieza', costo: 16, min: 12, max: 48, prov: 'Monterrey' },
];
const BASE_HAMBURGUESA = [
  ['Pan para hamburguesa', 1, 'pieza'], ['Lechuga', 20, 'g'], ['Jitomate', 30, 'g'], ['Cebolla', 15, 'g'],
  ['Mayonesa', 15, 'g'], ['Catsup', 10, 'g'], ['Mostaza', 5, 'g'], ['Envoltura para hamburguesa/torta', 1, 'pieza'],
];
const PASOS_HAMBURGUESA = [
  'Poner la carne en la plancha y sazonar; cocinar 3-4 min por lado hasta término medio',
  'Tostar el pan por dentro en la plancha',
  'Untar mayonesa, catsup y mostaza en el pan',
  'Armar: carne, lechuga, jitomate y cebolla',
  'Envolver o emplatar y entregar en la barra de pedidos',
];
const ALIMENTOS = [
  { nombre: 'Hamburguesa', icono: '🍔', precio: 85, descripcion: 'Carne de res a la parrilla con lechuga, jitomate y cebolla',
    ingredientes: [['Carne de res molida (hamburguesa)', 150, 'g'], ...BASE_HAMBURGUESA], pasos: PASOS_HAMBURGUESA,
    tiempo: '8-10 min', temperatura: 'Plancha a fuego medio · término medio' },
  { nombre: 'Quesoburger', icono: '🍔', precio: 95, descripcion: 'Hamburguesa de res con queso amarillo fundido',
    ingredientes: [['Carne de res molida (hamburguesa)', 150, 'g'], ['Queso amarillo (rebanadas)', 1, 'pieza'], ...BASE_HAMBURGUESA],
    pasos: [PASOS_HAMBURGUESA[0], 'Poner la rebanada de queso sobre la carne y tapar 30 s para fundir', ...PASOS_HAMBURGUESA.slice(1)],
    tiempo: '8-10 min', temperatura: 'Plancha a fuego medio · término medio' },
  { nombre: 'Hamburguesa vegetariana', icono: '🥬', precio: 90, descripcion: 'Medallón vegetariano a la plancha con aguacate y verduras frescas',
    ingredientes: [['Medallón vegetariano', 1, 'pieza'], ['Aguacate', 30, 'g'], ['Pan para hamburguesa', 1, 'pieza'], ['Lechuga', 20, 'g'], ['Jitomate', 30, 'g'], ['Cebolla', 15, 'g'], ['Mayonesa', 15, 'g'], ['Envoltura para hamburguesa/torta', 1, 'pieza']],
    pasos: ['Calentar el medallón vegetariano en la plancha 3 min por lado', 'Tostar el pan por dentro', 'Untar mayonesa y colocar el aguacate', 'Armar con lechuga, jitomate y cebolla', 'Envolver o emplatar y entregar en la barra de pedidos'],
    tiempo: '6-8 min', temperatura: 'Plancha a fuego medio' },
  { nombre: 'Torta', icono: '🥪', precio: 75, descripcion: 'Torta de bistec con frijoles, queso, aguacate y verduras',
    ingredientes: [['Telera para torta', 1, 'pieza'], ['Bistec de res (torta)', 120, 'g'], ['Frijoles refritos', 40, 'g'], ['Queso amarillo (rebanadas)', 1, 'pieza'], ['Aguacate', 30, 'g'], ['Jitomate', 30, 'g'], ['Cebolla', 15, 'g'], ['Lechuga', 15, 'g'], ['Mayonesa', 15, 'g'], ['Envoltura para hamburguesa/torta', 1, 'pieza']],
    pasos: ['Asar el bistec en la plancha 2-3 min por lado y picarlo', 'Abrir la telera, untar frijoles y tostar en la plancha', 'Untar mayonesa y colocar el queso sobre la carne caliente', 'Armar con aguacate, jitomate, cebolla y lechuga', 'Envolver o emplatar y entregar en la barra de pedidos'],
    tiempo: '8-10 min', temperatura: 'Plancha a fuego medio-alto' },
];
const EXTRAS = [
  { codigo: 'tocino', etiqueta: 'Tocino', delta: 15, insumo: 'Tocino', cantidad: 30, unidad: 'g' },
  { codigo: 'queso_extra', etiqueta: 'Queso extra', delta: 10, insumo: 'Queso amarillo (rebanadas)', cantidad: 1, unidad: 'pieza' },
  { codigo: 'doble_carne', etiqueta: 'Doble carne', delta: 35, insumo: 'Carne de res molida (hamburguesa)', cantidad: 150, unidad: 'g' },
];
const BEBIDAS = [
  { nombre: 'Jamaica', icono: '🌺', precio: 25, descripcion: 'Agua de jamaica embotellada', insumo: 'Agua de jamaica embotellada' },
  { nombre: 'Horchata', icono: '🥛', precio: 25, descripcion: 'Agua de horchata embotellada', insumo: 'Agua de horchata embotellada' },
  { nombre: 'Refresco', icono: '🥤', precio: 25, descripcion: 'Refresco embotellado 355 ml', insumo: 'Refresco 355 ml' },
];

async function main() {
  const sede = process.argv[2];
  const aplicar = process.argv.includes('--apply');
  if (!sede || !/^[0-9a-f-]{36}$/i.test(sede)) throw new Error('Indica el UUID de la sucursal: node scripts/agregar-parrilla.js <uuid-sede> [--apply]');
  const c = await pool.connect();
  const resumen = { sede, aplicado: aplicar, proveedores: [], categoriasInsumo: [], insumos: [], categoriaMenu: null, alimentos: [], extras: [], bebidas: [], omitidos: [] };
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`alta-parrilla:${sede}`]);
    const { rows: [suc] } = await c.query('SELECT id, nombre FROM sucursales WHERE id = $1', [sede]);
    if (!suc) throw new Error('No existe esa sucursal.');
    const { rows: [tipo] } = await c.query("SELECT 1 AS ok FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'tipo_producto' AND e.enumlabel = 'alimento'");
    if (!tipo) throw new Error('Falta la migración 30 (tipo de producto "alimento"). Corre bash db/migrar.sh primero.');
    const uno = async (sql, params) => (await c.query(sql, params)).rows[0];

    // Proveedores
    const provId = {};
    for (const p of PROVEEDORES) {
      let row = await uno('SELECT id FROM proveedores WHERE sucursal_id = $1 AND lower(nombre) = lower($2) AND activo', [sede, p.nombre]);
      if (row) resumen.omitidos.push(`proveedor ${p.nombre} (ya existe)`);
      else { row = await uno('INSERT INTO proveedores (nombre, categorias, contacto, sucursal_id) VALUES ($1, $2::text[], $3, $4) RETURNING id', [p.nombre, p.categorias, p.contacto, sede]); resumen.proveedores.push(p.nombre); }
      provId[p.nombre] = row.id;
    }
    // Categorías de insumos
    const catInsumoId = {};
    for (const nombre of CATEGORIAS_INSUMO) {
      let row = await uno('SELECT id FROM categorias_materia_prima WHERE sucursal_id = $1 AND lower(nombre) = lower($2)', [sede, nombre]);
      if (row) resumen.omitidos.push(`categoría de insumos ${nombre} (ya existe)`);
      else { row = await uno('INSERT INTO categorias_materia_prima (nombre, sucursal_id) VALUES ($1, $2) RETURNING id', [nombre, sede]); resumen.categoriasInsumo.push(nombre); }
      catInsumoId[nombre] = row.id;
    }
    // Insumos
    const insumo = {};
    for (const m of INSUMOS) {
      let row = await uno('SELECT id, unidad FROM materias_primas WHERE sucursal_id = $1 AND lower(nombre) = lower($2) AND activo', [sede, m.nombre]);
      if (row) resumen.omitidos.push(`insumo ${m.nombre} (ya existe)`);
      else {
        row = await uno(
          `INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, stock_maximo, costo_unitario, proveedor_id, sucursal_id,
                                        presentacion_cantidad, presentacion_unidad, presentacion_nombre)
           VALUES ($1, $2, $3::unidad_medida, 0, $4, $5, $6, $7, $8, $9, $10::unidad_medida, $11) RETURNING id, unidad`,
          [m.nombre, catInsumoId[m.cat], m.unidad, m.min, m.max, m.costo, provId[m.prov], sede,
            m.presentacion ? m.presentacion.cantidad : null, m.presentacion ? m.presentacion.unidad : null, m.presentacion ? m.presentacion.nombre : null]);
        resumen.insumos.push(`${m.nombre} (${m.unidad}, ref. $${m.costo}, mín ${m.min} → ${m.max})`);
      }
      insumo[m.nombre] = row;
    }
    // Categoría de menú "Parrilla"
    let catMenu = await uno('SELECT id FROM categorias_producto WHERE sucursal_id = $1 AND lower(nombre) = lower($2)', [sede, 'Parrilla']);
    if (catMenu) resumen.omitidos.push('categoría de menú Parrilla (ya existe)');
    else {
      catMenu = await uno('INSERT INTO categorias_producto (nombre, orden, sucursal_id) VALUES ($1, COALESCE((SELECT MAX(orden) FROM categorias_producto WHERE sucursal_id = $2), 0) + 1, $2) RETURNING id', ['Parrilla', sede]);
      resumen.categoriaMenu = 'Parrilla (nueva)';
    }
    const frios = await uno("SELECT id FROM categorias_producto WHERE sucursal_id = $1 AND nombre = 'Fríos'", [sede]);
    if (!frios) throw new Error('La sede no tiene la categoría "Fríos" para las bebidas embotelladas.');

    // Alimentos con receta
    for (const a of ALIMENTOS) {
      const existe = await uno('SELECT id FROM productos WHERE sucursal_id = $1 AND lower(nombre) = lower($2)', [sede, a.nombre]);
      if (existe) { resumen.omitidos.push(`producto ${a.nombre} (ya existe)`); continue; }
      const p = await uno(
        `INSERT INTO productos (nombre, categoria_id, tipo, icono, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, es_frio, sucursal_id, descripcion, estacion)
         VALUES ($1, $2, 'alimento', $3, $4, false, false, false, true, false, $5, $6, 'parrilla') RETURNING id`,
        [a.nombre, catMenu.id, a.icono, a.precio, sede, a.descripcion]);
      await c.query(
        `INSERT INTO recetas (producto_id, pasos, es_personalizada, tiempo_extraccion, temperatura_servicio) VALUES ($1, $2::jsonb, true, $3, $4)`,
        [p.id, JSON.stringify(a.pasos), a.tiempo, a.temperatura]);
      for (const [nombre, cantidad, unidad] of a.ingredientes) {
        if (!insumo[nombre]) throw new Error(`Ingrediente desconocido: ${nombre}`);
        await c.query('INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES ($1, $2, $3, $4::unidad_medida)', [p.id, insumo[nombre].id, cantidad, unidad]);
      }
      const { rows: [costo] } = await c.query('SELECT fn_costo_teorico_producto($1) AS c, fn_precio_sugerido($1) AS s', [p.id]);
      await c.query(`INSERT INTO auditoria (entidad, entidad_id, accion, valor_nuevo, motivo, sucursal_id)
        VALUES ('productos', $1, 'crear', $2::jsonb, 'Alta del menú de parrilla (script agregar-parrilla): precio e ingredientes de referencia, por ajustar.', $3)`,
        [p.id, JSON.stringify({ nombre: a.nombre, precio: a.precio, ingredientes: a.ingredientes }), sede]);
      resumen.alimentos.push(`${a.nombre} $${a.precio} · costo ingredientes ref. $${Number(costo.c).toFixed(2)} · sugerido $${Number(costo.s).toFixed(2)} · ${a.ingredientes.length} ingredientes`);
    }
    // Extras de parrilla
    for (const e of EXTRAS) {
      const existe = await uno('SELECT id FROM opciones_extra WHERE sucursal_id = $1 AND (codigo = $2 OR lower(etiqueta) = lower($3))', [sede, e.codigo, e.etiqueta]);
      if (existe) { resumen.omitidos.push(`extra ${e.etiqueta} (ya existe)`); continue; }
      await c.query(
        `INSERT INTO opciones_extra (codigo, etiqueta, delta_precio, materia_prima_id, cantidad, unidad, es_shot_adicional, sucursal_id, aplica_a)
         VALUES ($1, $2, $3, $4, $5, $6::unidad_medida, false, $7, 'alimentos')`,
        [e.codigo, e.etiqueta, e.delta, insumo[e.insumo].id, e.cantidad, e.unidad, sede]);
      resumen.extras.push(`${e.etiqueta} +$${e.delta} (${e.cantidad} ${e.unidad} de ${e.insumo})`);
    }
    // Bebidas embotelladas en Fríos (comprado hecho, se entrega en caja)
    for (const b of BEBIDAS) {
      const existe = await uno('SELECT id FROM productos WHERE sucursal_id = $1 AND lower(nombre) = lower($2)', [sede, b.nombre]);
      if (existe) { resumen.omitidos.push(`producto ${b.nombre} (ya existe)`); continue; }
      const p = await uno(
        `INSERT INTO productos (nombre, categoria_id, tipo, icono, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, es_frio, sucursal_id, descripcion, estacion)
         VALUES ($1, $2, 'snack', $3, $4, false, false, false, false, true, $5, $6, 'caja') RETURNING id`,
        [b.nombre, frios.id, b.icono, b.precio, sede, b.descripcion]);
      await c.query('INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES ($1, $2, 1, $3::unidad_medida)', [p.id, insumo[b.insumo].id, insumo[b.insumo].unidad]);
      await c.query(`INSERT INTO auditoria (entidad, entidad_id, accion, valor_nuevo, motivo, sucursal_id)
        VALUES ('productos', $1, 'crear', $2::jsonb, 'Alta de bebida embotellada en Fríos (script agregar-parrilla): comprada hecha, ligada a su insumo.', $3)`,
        [p.id, JSON.stringify({ nombre: b.nombre, precio: b.precio, insumo: b.insumo }), sede]);
      resumen.bebidas.push(`${b.nombre} $${b.precio} → descuenta 1 pza de "${b.insumo}"`);
    }

    await c.query(aplicar ? 'COMMIT' : 'ROLLBACK');
    resumen.sucursal = suc.nombre;
    resumen.siguiente = aplicar
      ? 'Registra las compras reales en Inventario → Registrar compra (fija costo y existencias); revisa precios en Productos → Costo y precio; asigna la estación "parrilla" al personal que cocina.'
      : 'Ensayo sin cambios. Vuelve a correr con --apply para aplicar.';
    console.log(JSON.stringify(resumen, null, 2));
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
