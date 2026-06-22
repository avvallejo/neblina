const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM proveedores ORDER BY nombre');
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, categoria, contacto, telefono } = req.body;
  if (!nombre?.trim()) throw new ApiError(400, 'Ingresa el nombre del proveedor.');
  const { rows } = await query(
    'INSERT INTO proveedores (nombre, categoria, contacto, telefono) VALUES ($1,$2,$3,$4) RETURNING *',
    [nombre.trim(), categoria || 'Otro', contacto || null, (telefono || '').replace(/\D/g, '').slice(0, 10) || null]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, categoria, contacto, telefono, activo } = req.body;
  const sets = [];
  const values = [];
  let i = 1;
  if (nombre !== undefined) { sets.push(`nombre = $${i++}`); values.push(nombre.trim()); }
  if (categoria !== undefined) { sets.push(`categoria = $${i++}`); values.push(categoria); }
  if (contacto !== undefined) { sets.push(`contacto = $${i++}`); values.push(contacto); }
  if (telefono !== undefined) { sets.push(`telefono = $${i++}`); values.push(String(telefono).replace(/\D/g, '').slice(0, 10)); }
  if (activo !== undefined) { sets.push(`activo = $${i++}`); values.push(!!activo); }
  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');

  values.push(req.params.id);
  const { rows } = await query(`UPDATE proveedores SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (rows.length === 0) throw new ApiError(404, 'Proveedor no encontrado.');
  res.json(rows[0]);
}));

module.exports = router;
