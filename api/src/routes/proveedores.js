const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const { cleanPhone, cleanText, toBoolean } = require('../utils/catalogValidation');

// Un proveedor surte UNA O VARIAS categorías de insumos. Acepta lista
// (categorias) o, por compatibilidad, el string único anterior (categoria).
function cleanCategorias(body) {
  let lista = body.categorias;
  if (lista === undefined && body.categoria !== undefined) lista = [body.categoria];
  if (lista === undefined) return undefined;
  if (!Array.isArray(lista)) throw new ApiError(400, 'categorias debe ser una lista.');
  const limpias = [...new Set(lista.map(c => cleanText(c, { field: 'categoría', max: 80 })).filter(Boolean))];
  if (limpias.length > 10) throw new ApiError(400, 'Máximo 10 categorías por proveedor.');
  return limpias.length ? limpias : ['Otro'];
}

const router = express.Router();
router.use(requireAuth, requireRole('admin'), resolveSucursal);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM proveedores WHERE sucursal_id = $1 ORDER BY nombre', [req.sucursalId]);
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, contacto, telefono } = req.body;
  const nombreLimpio = cleanText(nombre, { required: true, field: 'el nombre del proveedor', max: 120 });
  const { rows } = await query(
    'INSERT INTO proveedores (nombre, categorias, contacto, telefono, sucursal_id) VALUES ($1,$2::text[],$3,$4,$5) RETURNING *',
    [
      nombreLimpio,
      cleanCategorias(req.body) || ['Otro'],
      cleanText(contacto, { field: 'contacto', max: 120 }),
      cleanPhone(telefono),
      req.sucursalId,
    ]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, contacto, telefono, activo } = req.body;
  const sets = [];
  const values = [];
  let i = 1;
  if (nombre !== undefined) { sets.push(`nombre = $${i++}`); values.push(cleanText(nombre, { required: true, field: 'el nombre del proveedor', max: 120 })); }
  const categorias = cleanCategorias(req.body);
  if (categorias !== undefined) { sets.push(`categorias = $${i++}::text[]`); values.push(categorias); }
  if (contacto !== undefined) { sets.push(`contacto = $${i++}`); values.push(cleanText(contacto, { field: 'contacto', max: 120 })); }
  if (telefono !== undefined) { sets.push(`telefono = $${i++}`); values.push(cleanPhone(telefono)); }
  if (activo !== undefined) { sets.push(`activo = $${i++}`); values.push(toBoolean(activo)); }
  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');

  values.push(req.params.id, req.sucursalId);
  const { rows } = await query(`UPDATE proveedores SET ${sets.join(', ')} WHERE id = $${i} AND sucursal_id = $${i + 1} RETURNING *`, values);
  if (rows.length === 0) throw new ApiError(404, 'Proveedor no encontrado.');
  res.json(rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await withTransaction(async client => {
    const usado = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM materias_primas WHERE proveedor_id = $1)
         + (SELECT COUNT(*) FROM lotes WHERE proveedor_id = $1) AS refs`,
      [req.params.id]
    );
    const refs = Number(usado.rows[0]?.refs || 0);

    if (refs === 0) {
      const { rows } = await client.query('DELETE FROM proveedores WHERE id = $1 AND sucursal_id = $2 RETURNING *', [req.params.id, req.sucursalId]);
      if (rows.length === 0) throw new ApiError(404, 'Proveedor no encontrado.');
      return { ...rows[0], eliminado: true, modo_eliminacion: 'definitivo' };
    }

    const { rows } = await client.query('UPDATE proveedores SET activo = false WHERE id = $1 AND sucursal_id = $2 RETURNING *', [req.params.id, req.sucursalId]);
    if (rows.length === 0) throw new ApiError(404, 'Proveedor no encontrado.');
    return { ...rows[0], eliminado: true, modo_eliminacion: 'desactivado_por_historial' };
  });

  res.json(result);
}));

module.exports = router;
