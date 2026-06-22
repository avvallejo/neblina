const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// El menú es de lectura pública: tanto Caja como el Cliente lo necesitan para
// mostrar el catálogo antes de que exista ninguna sesión.
router.get('/', asyncHandler(async (req, res) => {
  const { categoria, incluirInactivos } = req.query;
  const condiciones = [];
  const values = [];
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

router.get('/categorias', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM categorias_producto ORDER BY orden');
  res.json(rows);
}));

router.get('/:id/precio-sugerido', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT
       fn_costo_teorico_producto($1) AS costo_directo,
       fn_costo_fijo_unitario() AS costo_indirecto_unitario,
       fn_costo_total_unitario($1) AS costo_total,
       fn_precio_punto_equilibrio($1) AS precio_punto_equilibrio,
       fn_precio_sugerido($1) AS precio_sugerido`,
    [req.params.id]
  );
  res.json(rows[0]);
}));

router.get('/:id/desglose-costo', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vw_desglose_costo_producto WHERE id = $1', [req.params.id]);
  if (rows.length === 0) throw new ApiError(404, 'Producto no encontrado o inactivo.');
  res.json(rows[0]);
}));

router.use(requireAuth, requireRole('admin'));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, categoriaId, tipo, icono, precioBase, permiteTamanos, permiteLeche, permiteTipoCafe, permiteExtras, esFrio } = req.body;
  if (!nombre?.trim()) throw new ApiError(400, 'Ingresa un nombre.');
  if (!['bebida', 'frappe', 'snack'].includes(tipo)) throw new ApiError(400, 'Tipo inválido.');
  if (precioBase === undefined || precioBase < 0) throw new ApiError(400, 'Indica un precio base válido.');

  const { rows } = await query(
    `INSERT INTO productos (nombre, categoria_id, tipo, icono, precio_base, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras, es_frio)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [nombre.trim(), categoriaId, tipo, icono || '☕', precioBase, !!permiteTamanos, !!permiteLeche, !!permiteTipoCafe, !!permiteExtras, !!esFrio]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const mapeo = {
    nombre: 'nombre', categoriaId: 'categoria_id', tipo: 'tipo', icono: 'icono',
    precioBase: 'precio_base', precioPromocional: 'precio_promocional',
    permiteTamanos: 'permite_tamanos', permiteLeche: 'permite_leche', permiteTipoCafe: 'permite_tipo_cafe',
    permiteExtras: 'permite_extras', esFrio: 'es_frio', activo: 'activo', tiempoEstimadoMin: 'tiempo_estimado_min',
  };
  const sets = [];
  const values = [];
  let i = 1;
  for (const [campoApi, columna] of Object.entries(mapeo)) {
    if (req.body[campoApi] !== undefined) { sets.push(`${columna} = $${i++}`); values.push(req.body[campoApi]); }
  }
  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE productos SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (rows.length === 0) throw new ApiError(404, 'Producto no encontrado.');
  res.json(rows[0]);
}));

module.exports = router;
