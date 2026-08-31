const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, UUID_RE } = require('../middleware/auth');
const { assertStaffPin } = require('../security/policies');

const router = express.Router();

// Jerarquía multi-sucursal:
//   * ADMIN GENERAL (sucursal_id NULL): administra el personal de TODAS las
//     sedes (elige cuál con X-Sucursal-Id), crea admins de sede y otros
//     admins generales, y puede reasignar a alguien de sede.
//   * ADMIN DE SEDE: administra ÚNICAMENTE el personal de su sede (incluidos
//     otros admins de su sede). No ve ni toca a los admins generales, ni
//     puede crear uno.
router.use(requireAuth, requireRole('admin'), resolveSucursal);

const esGeneral = req => req.auth.sucursalId === null;

router.get('/', asyncHandler(async (req, res) => {
  // El admin general también ve a los admins generales (para administrarlos);
  // el admin de sede solo ve el personal de su sede.
  const { rows } = esGeneral(req)
    ? await query(
      'SELECT id, nombre, rol, activo, sucursal_id, creado_en FROM usuarios WHERE sucursal_id = $1 OR sucursal_id IS NULL ORDER BY creado_en',
      [req.sucursalId]
    )
    : await query(
      'SELECT id, nombre, rol, activo, sucursal_id, creado_en FROM usuarios WHERE sucursal_id = $1 ORDER BY creado_en',
      [req.sucursalId]
    );
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, rol, pin, esAdminGeneral } = req.body;
  if (!nombre?.trim()) throw new ApiError(400, 'Ingresa un nombre.');
  if (!['admin', 'cajero', 'barista', 'mostrador'].includes(rol)) throw new ApiError(400, 'Rol inválido.');
  assertStaffPin(pin);

  let sucursalDestino = req.sucursalId;
  if (esAdminGeneral === true) {
    if (!esGeneral(req)) throw new ApiError(403, 'Solo un administrador general puede crear otro administrador general.');
    if (rol !== 'admin') throw new ApiError(400, 'Solo el rol admin puede ser administrador general.');
    sucursalDestino = null;
  }

  const hash = await bcrypt.hash(pin, 10);
  const { rows } = await query(
    'INSERT INTO usuarios (nombre, rol, pin_hash, sucursal_id) VALUES ($1,$2,$3,$4) RETURNING id, nombre, rol, activo, sucursal_id, creado_en',
    [nombre.trim(), rol, hash, sucursalDestino]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const objetivo = (await query('SELECT id, rol, sucursal_id FROM usuarios WHERE id = $1', [req.params.id])).rows[0];
  // 404 también cuando el objetivo está fuera de tu alcance: un admin de sede
  // no debe poder confirmar la existencia de usuarios de otras sedes.
  const fueraDeAlcance = !objetivo
    || (!esGeneral(req) && objetivo.sucursal_id !== req.auth.sucursalId);
  if (fueraDeAlcance) throw new ApiError(404, 'Usuario no encontrado.');

  const { nombre, rol, pin, activo, sucursalId } = req.body;
  if (req.params.id === req.auth.id && activo === false) {
    throw new ApiError(400, 'No puedes desactivar tu propia cuenta.');
  }

  const sets = [];
  const values = [];
  let i = 1;

  if (nombre !== undefined) { sets.push(`nombre = $${i++}`); values.push(nombre.trim()); }
  if (rol !== undefined) {
    if (!['admin', 'cajero', 'barista', 'mostrador'].includes(rol)) throw new ApiError(400, 'Rol inválido.');
    // Quitar el rol admin a un admin general lo dejaría sin sede y sin
    // permiso de tenerla — primero hay que asignarle sede.
    if (rol !== 'admin' && objetivo.sucursal_id === null && sucursalId === undefined) {
      throw new ApiError(400, 'Asigna una sucursal (sucursalId) antes de cambiar el rol de un administrador general.');
    }
    sets.push(`rol = $${i++}`); values.push(rol);
  }
  if (sucursalId !== undefined) {
    // Solo el admin general mueve gente de sede o convierte a alguien en
    // administrador general (sucursalId: null).
    if (!esGeneral(req)) throw new ApiError(403, 'Solo un administrador general puede cambiar la sucursal de un usuario.');
    if (sucursalId === null) {
      const rolFinal = rol !== undefined ? rol : objetivo.rol;
      if (rolFinal !== 'admin') throw new ApiError(400, 'Solo el rol admin puede quedar sin sucursal (administrador general).');
      sets.push(`sucursal_id = $${i++}`); values.push(null);
    } else {
      if (!UUID_RE.test(String(sucursalId))) throw new ApiError(400, 'sucursalId inválido.');
      const existe = await query('SELECT id FROM sucursales WHERE id = $1 AND activo', [sucursalId]);
      if (existe.rows.length === 0) throw new ApiError(404, 'La sucursal destino no existe o está inactiva.');
      sets.push(`sucursal_id = $${i++}`); values.push(sucursalId);
    }
  }
  if (activo !== undefined) { sets.push(`activo = $${i++}`); values.push(!!activo); }
  if (pin !== undefined) {
    assertStaffPin(pin);
    sets.push(`pin_hash = $${i++}`); values.push(await bcrypt.hash(pin, 10));
  }
  if (rol !== undefined || activo !== undefined || pin !== undefined || sucursalId !== undefined) {
    sets.push('token_version = token_version + 1');
  }
  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');

  values.push(req.params.id);
  const { rows } = await query(
    `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, nombre, rol, activo, sucursal_id`,
    values
  );
  if (rows.length === 0) throw new ApiError(404, 'Usuario no encontrado.');
  res.json(rows[0]);
}));

module.exports = router;
