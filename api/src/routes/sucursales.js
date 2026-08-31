const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireAdminGeneral } = require('../middleware/auth');

const router = express.Router();

// Público: la pantalla de login del personal y el registro del cliente
// necesitan la lista de sedes ANTES de tener sesión. Solo expone lo mínimo.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, nombre FROM sucursales WHERE activo ORDER BY creado_en');
  res.json(rows);
}));

// Todo lo demás es del administrador general.
router.use(requireAuth, requireAdminGeneral);

// GET /api/sucursales/todas — vista completa para administrar (incluye inactivas).
router.get('/todas', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT id, nombre, prefijo_folio, folio_contador, activo, creado_en FROM sucursales ORDER BY creado_en'
  );
  res.json(rows);
}));

// POST /api/sucursales { nombre, prefijoFolio }
// Crear la sede también siembra su configuración mínima (margen con valores
// por defecto, SMS en modo seguro y su nombre de negocio), para que la sede
// nueva opere igual de segura que "Principal" desde el primer minuto.
router.post('/', asyncHandler(async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const prefijo = String(req.body.prefijoFolio || '').trim().toUpperCase();
  if (!nombre) throw new ApiError(400, 'Ingresa el nombre de la sucursal.');
  if (!/^[A-Z0-9]{1,6}$/.test(prefijo)) {
    throw new ApiError(400, 'El prefijo de folio debe tener 1 a 6 letras o números (ej. S2).');
  }

  try {
    const sucursal = await withTransaction(async (tx) => {
      const creada = (await tx.query(
        'INSERT INTO sucursales (nombre, prefijo_folio) VALUES ($1, $2) RETURNING id, nombre, prefijo_folio, activo, creado_en',
        [nombre, prefijo]
      )).rows[0];
      await tx.query('INSERT INTO configuracion_margen (sucursal_id) VALUES ($1)', [creada.id]);
      await tx.query(
        `INSERT INTO configuracion (clave, valor, sucursal_id) VALUES
           ('sms_verificacion', 'true'::jsonb, $1),
           ('nombre_negocio', to_jsonb($2::text), $1),
           ('logo', '""'::jsonb, $1)`,
        [creada.id, nombre]
      );
      return creada;
    });
    res.status(201).json(sucursal);
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'Ya existe una sucursal con ese nombre o ese prefijo de folio.');
    }
    throw err;
  }
}));

// PATCH /api/sucursales/:id { nombre?, activo? }
// El prefijo de folio NO se edita: cambiarlo rompería la continuidad de los
// folios ya emitidos por esa sede.
router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, activo } = req.body;
  const sets = [];
  const values = [];
  let i = 1;

  if (nombre !== undefined) {
    const limpio = String(nombre || '').trim();
    if (!limpio) throw new ApiError(400, 'El nombre no puede quedar vacío.');
    sets.push(`nombre = $${i++}`); values.push(limpio);
  }
  if (activo !== undefined) {
    if (activo === false) {
      const { rows } = await query('SELECT COUNT(*) FROM sucursales WHERE activo AND id <> $1', [req.params.id]);
      if (Number(rows[0].count) === 0) throw new ApiError(409, 'No puedes desactivar la última sucursal activa.');
    }
    sets.push(`activo = $${i++}`); values.push(!!activo);
  }
  if (sets.length === 0) throw new ApiError(400, 'No mandaste ningún campo para actualizar.');

  values.push(req.params.id);
  try {
    const { rows } = await query(
      `UPDATE sucursales SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, nombre, prefijo_folio, activo, creado_en`,
      values
    );
    if (rows.length === 0) throw new ApiError(404, 'La sucursal no existe.');
    res.json(rows[0]);
  } catch (err) {
    if (err && err.code === '23505') throw new ApiError(409, 'Ya existe una sucursal con ese nombre.');
    throw err;
  }
}));

module.exports = router;
