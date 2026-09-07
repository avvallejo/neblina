const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, resolveSucursalPublico } = require('../middleware/auth');
const { cleanText, parseNumber, toBoolean } = require('../utils/catalogValidation');
const { preciosPorRevisar, mantenerPrecio } = require('../services/priceReview');

const router = express.Router();

function requireAdminForInactiveCatalog(req, res, next) {
  if (!req.query.incluirInactivos) return next();
  return requireAuth(req, res, err => {
    if (err) return next(err);
    return requireRole('admin')(req, res, next);
  });
}

// El menú es de lectura pública: tanto Caja como el Cliente lo necesitan para
// mostrar el catálogo antes de que exista ninguna sesión.
router.get('/', requireAdminForInactiveCatalog, resolveSucursalPublico, asyncHandler(async (req, res) => {
  const { categoria, incluirInactivos } = req.query;
  const condiciones = [];
  const values = [];
  values.push(req.sucursalId);
  condiciones.push(`p.sucursal_id = $${values.length}`);
  if (!incluirInactivos) condiciones.push('p.activo = true');
  if (categoria) { values.push(categoria); condiciones.push(`cp.nombre = $${values.length}`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT p.*, cp.nombre AS categoria, fn_precio_efectivo(p.id) AS precio_efectivo
     FROM productos p JOIN categorias_producto cp ON cp.id = p.categoria_id
     ${where} ORDER BY cp.orden, p.nombre`,
    values
  );
  res.json(rows);
}));

router.get('/categorias', resolveSucursalPublico, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM categorias_producto WHERE sucursal_id = $1 ORDER BY orden', [req.sucursalId]);
  res.json(rows);
}));

// Costo y precio del producto: TODO lo que el panel necesita para que el
// administrador solo decida el margen — costo directo (según la receta),
// indirecto (prorrateo de gastos fijos), punto de equilibrio, margen
// aplicable (propio o de la sede) y redondeo.
router.get('/:id/precio-sugerido', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const propio = await query('SELECT id, precio_base, margen_porcentaje FROM productos WHERE id = $1 AND sucursal_id = $2', [req.params.id, req.sucursalId]);
  if (propio.rows.length === 0) throw new ApiError(404, 'Producto no encontrado.');
  const { rows } = await query(
    `SELECT
       fn_costo_teorico_producto($1) AS costo_directo,
       fn_costo_fijo_unitario($2) AS costo_indirecto_unitario,
       fn_costo_total_unitario($1) AS costo_total,
       fn_precio_punto_equilibrio($1) AS precio_punto_equilibrio,
       fn_precio_sugerido($1) AS precio_sugerido,
       cm.porcentaje_ganancia_normal AS margen_sucursal,
       COALESCE(cm.redondeo, 1) AS redondeo
     FROM (SELECT 1) x
     LEFT JOIN LATERAL (
       SELECT porcentaje_ganancia_normal, redondeo FROM configuracion_margen
       WHERE sucursal_id = $2 ORDER BY actualizado_en DESC LIMIT 1
     ) cm ON true`,
    [req.params.id, req.sucursalId]
  );
  res.json({
    ...rows[0],
    precio_base: propio.rows[0].precio_base,
    margen_producto: propio.rows[0].margen_porcentaje,
  });
}));

// Aviso de reprecio: productos activos cuyo precio de menú ya no corresponde
// a su costo + margen. El precio NUNCA cambia solo — el admin lo aplica.
router.get('/precios-por-revisar', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  res.json(await preciosPorRevisar({ query }, req.sucursalId));
}));

router.post('/:id/mantener-precio', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  res.json(await mantenerPrecio({ query }, { id:req.params.id, sucursalId:req.sucursalId, revision:req.body.revision }));
}));

router.get('/:id/desglose-costo', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vw_desglose_costo_producto WHERE id = $1 AND sucursal_id = $2', [req.params.id, req.sucursalId]);
  if (rows.length === 0) throw new ApiError(404, 'Producto no encontrado o inactivo.');
  res.json(rows[0]);
}));

router.use(requireAuth, requireRole('admin'), resolveSucursal);

function parseMargen(valor) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new ApiError(400, 'El margen debe ser un porcentaje entre 0 y 1000.');
  return Math.round(n * 100) / 100;
}

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, categoriaId, tipo, icono, precioBase, permiteTamanos, permiteLeche, permiteTipoCafe, permiteExtras, esFrio, margenPorcentaje } = req.body;
  const nombreLimpio = cleanText(nombre, { required: true, field: 'un nombre', max: 120 });
  if (!['bebida', 'frappe', 'snack'].includes(tipo)) throw new ApiError(400, 'Tipo inválido.');
  if (!categoriaId) throw new ApiError(400, 'Selecciona una categoría.');
  const precio = parseNumber(precioBase, 'precio base', { required: true, min: 0 });

  const categoriaPropia = await query('SELECT id FROM categorias_producto WHERE id = $1 AND sucursal_id = $2', [categoriaId, req.sucursalId]);
  if (categoriaPropia.rows.length === 0) throw new ApiError(400, 'La categoría no pertenece a esta sucursal.');
  const margen = parseMargen(margenPorcentaje);

  // El producto nace con su RECETA ya creada (con valores predeterminados
  // según su tipo), para que el flujo inventario → receta → costo → precio
  // funcione sin pasos manuales: solo falta ajustar ingredientes y margen.
  const producto = await withTransaction(async client => {
    const { rows } = await client.query(
      `INSERT INTO productos (nombre, categoria_id, tipo, icono, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, es_frio, sucursal_id, margen_porcentaje, descripcion, precio_promocional)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        nombreLimpio,
        categoriaId,
        tipo,
        cleanText(icono, { field: 'ícono', max: 12 }) || '☕',
        precio,
        toBoolean(permiteTamanos) ?? false,
        toBoolean(permiteLeche) ?? false,
        toBoolean(permiteTipoCafe) ?? false,
        toBoolean(permiteExtras) ?? false,
        toBoolean(esFrio) ?? false,
        req.sucursalId,
        margen ?? null,
        cleanText(req.body.descripcion, { field: 'descripción', max: 140 }) || null,
        req.body.precioPromocional === undefined || req.body.precioPromocional === null || req.body.precioPromocional === ''
          ? null : parseNumber(req.body.precioPromocional, 'precio promocional', { min: 0 }),
      ]
    );
    if (tipo !== 'snack') {
      await client.query('INSERT INTO recetas (producto_id) VALUES ($1)', [rows[0].id]);
      await client.query('SELECT fn_resetear_receta($1)', [rows[0].id]);
    }
    return rows[0];
  });
  res.status(201).json(producto);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const sets = [];
  const values = [];
  let i = 1;
  const add = (columna, value) => { sets.push(`${columna} = $${i++}`); values.push(value); };

  if (req.body.nombre !== undefined) add('nombre', cleanText(req.body.nombre, { required: true, field: 'un nombre', max: 120 }));
  if (req.body.categoriaId !== undefined) {
    if (!req.body.categoriaId) throw new ApiError(400, 'Selecciona una categoría.');
    const categoriaPropia = await query('SELECT id FROM categorias_producto WHERE id = $1 AND sucursal_id = $2', [req.body.categoriaId, req.sucursalId]);
    if (categoriaPropia.rows.length === 0) throw new ApiError(400, 'La categoría no pertenece a esta sucursal.');
    add('categoria_id', req.body.categoriaId);
  }
  if (req.body.tipo !== undefined) {
    if (!['bebida', 'frappe', 'snack'].includes(req.body.tipo)) throw new ApiError(400, 'Tipo inválido.');
    add('tipo', req.body.tipo);
  }
  if (req.body.icono !== undefined) add('icono', cleanText(req.body.icono, { field: 'ícono', max: 12 }) || '☕');
  if (req.body.descripcion !== undefined) add('descripcion', cleanText(req.body.descripcion, { field: 'descripción', max: 140 }) || null);
  if (req.body.precioBase !== undefined) add('precio_base', parseNumber(req.body.precioBase, 'precio base', { required: true, min: 0 }));
  if (req.body.precioPromocional !== undefined) {
    add('precio_promocional', req.body.precioPromocional === null || req.body.precioPromocional === ''
      ? null
      : parseNumber(req.body.precioPromocional, 'precio promocional', { min: 0 }));
  }
  if (req.body.permiteTamanos !== undefined) add('permite_tamanos', toBoolean(req.body.permiteTamanos));
  if (req.body.permiteLeche !== undefined) add('permite_leche', toBoolean(req.body.permiteLeche));
  if (req.body.permiteTipoCafe !== undefined) add('permite_tipo_cafe', toBoolean(req.body.permiteTipoCafe));
  if (req.body.permiteExtras !== undefined) add('permite_extras', toBoolean(req.body.permiteExtras));
  if (req.body.esFrio !== undefined) add('es_frio', toBoolean(req.body.esFrio));
  if (req.body.activo !== undefined) add('activo', toBoolean(req.body.activo));
  if (req.body.margenPorcentaje !== undefined) add('margen_porcentaje', parseMargen(req.body.margenPorcentaje));
  if (req.body.tiempoEstimadoMin !== undefined) {
    add('tiempo_estimado_min', req.body.tiempoEstimadoMin === null || req.body.tiempoEstimadoMin === ''
      ? null
      : parseNumber(req.body.tiempoEstimadoMin, 'tiempo estimado', { min: 0, integer: true }));
  }

  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');
  values.push(req.params.id, req.sucursalId);
  const { rows } = await query(`UPDATE productos SET ${sets.join(', ')} WHERE id = $${i} AND sucursal_id = $${i + 1} RETURNING *`, values);
  if (rows.length === 0) throw new ApiError(404, 'Producto no encontrado.');
  res.json(rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await withTransaction(async client => {
    const usado = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM pedido_items WHERE producto_id = $1)
         + (SELECT COUNT(*) FROM promocion_fidelidad WHERE producto_premio_id = $1)
         + (SELECT COUNT(*) FROM promocion_apertura_productos WHERE producto_id = $1) AS refs`,
      [req.params.id]
    );
    const refs = Number(usado.rows[0]?.refs || 0);

    if (refs === 0) {
      const { rows } = await client.query('DELETE FROM productos WHERE id = $1 AND sucursal_id = $2 RETURNING *', [req.params.id, req.sucursalId]);
      if (rows.length === 0) throw new ApiError(404, 'Producto no encontrado.');
      return { ...rows[0], eliminado: true, modo_eliminacion: 'definitivo' };
    }

    const { rows } = await client.query('UPDATE productos SET activo = false WHERE id = $1 AND sucursal_id = $2 RETURNING *', [req.params.id, req.sucursalId]);
    if (rows.length === 0) throw new ApiError(404, 'Producto no encontrado.');
    return { ...rows[0], eliminado: true, modo_eliminacion: 'desactivado_por_historial' };
  });

  res.json(result);
}));

module.exports = router;
