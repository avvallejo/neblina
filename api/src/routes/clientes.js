const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireCliente, requireRole } = require('../middleware/auth');

const router = express.Router();

// El cliente solo puede ver SU PROPIA cuenta — el id viene del token, no del
// parámetro de la URL, para que un cliente no pueda leer el historial de otro
// con solo cambiar el id en la petición.
router.get('/yo', requireAuth, requireCliente, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, nombre, apellido, telefono, pedidos_app_contador, recompensa_pendiente FROM clientes WHERE id = $1', [req.auth.id]);
  if (rows.length === 0) throw new ApiError(404, 'Cliente no encontrado.');
  res.json(rows[0]);
}));

router.get('/yo/pedidos', requireAuth, requireCliente, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, COALESCE(json_agg(json_build_object(
        'id', pi.id, 'producto', pr.nombre, 'cantidad', pi.cantidad, 'estado', pi.estado, 'es_regalo', pi.es_regalo
      )) FILTER (WHERE pi.id IS NOT NULL), '[]') AS items
     FROM pedidos p
     LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
     LEFT JOIN productos pr ON pr.id = pi.producto_id
     WHERE p.cliente_id = $1
     GROUP BY p.id
     ORDER BY p.creado_en DESC`,
    [req.auth.id]
  );
  res.json(rows);
}));

// Listado para Admin (no se usó en el prototipo de UI, pero es natural tenerlo
// para soporte / atención a clientes).
router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, nombre, apellido, telefono, pedidos_app_contador, recompensa_pendiente, telefono_verificado, creado_en FROM clientes ORDER BY creado_en DESC');
  res.json(rows);
}));

// Caja puede registrar a un cliente en persona (ej. alguien sin smartphone que
// igual quiere su tarjeta de fidelidad). La presencia física frente al cajero
// es su propia verificación — no hace falta mandar SMS para esto.
router.post('/', requireAuth, requireRole('cajero', 'admin'), asyncHandler(async (req, res) => {
  const { nombre, apellido, telefono } = req.body;
  const telefonoLimpio = String(telefono || '').replace(/\D/g, '');
  if (!nombre?.trim() || !apellido?.trim()) throw new ApiError(400, 'Falta nombre o apellido.');
  if (!/^\d{10}$/.test(telefonoLimpio)) throw new ApiError(400, 'El teléfono debe tener 10 dígitos.');

  const existente = await query('SELECT id FROM clientes WHERE telefono = $1', [telefonoLimpio]);
  if (existente.rows.length > 0) throw new ApiError(409, 'Ya existe un cliente con ese teléfono.');

  const { rows } = await query(
    'INSERT INTO clientes (nombre, apellido, telefono, telefono_verificado) VALUES ($1,$2,$3,true) RETURNING *',
    [nombre.trim(), apellido.trim(), telefonoLimpio]
  );
  res.status(201).json(rows[0]);
}));

module.exports = router;
