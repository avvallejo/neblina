const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { assertStaffPin } = require('../security/policies');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, nombre, rol, activo, creado_en FROM usuarios ORDER BY creado_en');
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, rol, pin } = req.body;
  if (!nombre?.trim()) throw new ApiError(400, 'Ingresa un nombre.');
  if (!['admin', 'cajero', 'barista'].includes(rol)) throw new ApiError(400, 'Rol inválido.');
  assertStaffPin(pin);

  const hash = await bcrypt.hash(pin, 10);
  const { rows } = await query(
    'INSERT INTO usuarios (nombre, rol, pin_hash) VALUES ($1,$2,$3) RETURNING id, nombre, rol, activo, creado_en',
    [nombre.trim(), rol, hash]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, rol, pin, activo } = req.body;
  const sets = [];
  const values = [];
  let i = 1;

  if (nombre !== undefined) { sets.push(`nombre = $${i++}`); values.push(nombre.trim()); }
  if (rol !== undefined) {
    if (!['admin', 'cajero', 'barista'].includes(rol)) throw new ApiError(400, 'Rol inválido.');
    sets.push(`rol = $${i++}`); values.push(rol);
  }
  if (activo !== undefined) { sets.push(`activo = $${i++}`); values.push(!!activo); }
  if (pin !== undefined) {
    assertStaffPin(pin);
    sets.push(`pin_hash = $${i++}`); values.push(await bcrypt.hash(pin, 10));
  }
  if (rol !== undefined || activo !== undefined || pin !== undefined) sets.push('token_version = token_version + 1');
  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');

  values.push(req.params.id);
  const { rows } = await query(
    `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, nombre, rol, activo`,
    values
  );
  if (rows.length === 0) throw new ApiError(404, 'Usuario no encontrado.');
  res.json(rows[0]);
}));

module.exports = router;
