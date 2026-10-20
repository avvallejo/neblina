const express = require('express');
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, UUID_RE } = require('../middleware/auth');
const { assertStaffPin } = require('../security/policies');
const { normalizarEstacionesUsuario } = require('../services/stations');
const { fijarTarifa } = require('../services/jornadas');

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

// Columnas que ve la administración. Incluye si se paga por hora y su tarifa vigente (migración 50).
const COLUMNAS = `id, nombre, rol, activo, sucursal_id, creado_en, estaciones, paga_por_hora,
  (SELECT t.tarifa::float8 FROM tarifas_hora t WHERE t.usuario_id = usuarios.id AND t.vigente_desde <= now() ORDER BY t.vigente_desde DESC LIMIT 1) AS tarifa_hora`;
const leerUsuario = async (q, id) => (await q(`SELECT ${COLUMNAS} FROM usuarios WHERE id = $1`, [id])).rows[0];

function validarTarifa(v) {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n) || n <= 0 || n > 100000) throw new ApiError(400, 'Indica la tarifa por hora (mayor a cero).');
  return Math.round(n * 100) / 100;
}

router.get('/', asyncHandler(async (req, res) => {
  // El admin general también ve a los admins generales (para administrarlos);
  // el admin de sede solo ve el personal de su sede.
  const { rows } = esGeneral(req)
    ? await query(
      `SELECT ${COLUMNAS} FROM usuarios WHERE sucursal_id = $1 OR sucursal_id IS NULL ORDER BY creado_en`,
      [req.sucursalId]
    )
    : await query(
      `SELECT ${COLUMNAS} FROM usuarios WHERE sucursal_id = $1 ORDER BY creado_en`,
      [req.sucursalId]
    );
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, rol, pin, esAdminGeneral } = req.body;
  if (!nombre?.trim()) throw new ApiError(400, 'Ingresa un nombre.');
  if (!['admin', 'cajero', 'barista', 'mostrador'].includes(rol)) throw new ApiError(400, 'Rol inválido.');
  assertStaffPin(pin);
  // Estaciones de la comanda (barista/mostrador): {barra} = barista,
  // {parrilla} = parrillero, ambas = ve todos los pedidos. Sin dato: ambas.
  const estaciones = normalizarEstacionesUsuario(req.body.estaciones) || ['barra', 'parrilla'];

  let sucursalDestino = req.sucursalId;
  if (esAdminGeneral === true) {
    if (!esGeneral(req)) throw new ApiError(403, 'Solo un administrador general puede crear otro administrador general.');
    if (rol !== 'admin') throw new ApiError(400, 'Solo el rol admin puede ser administrador general.');
    sucursalDestino = null;
  }

  // Se paga por hora: registra jornadas (entrada con el PIN, pausas y salida). Exige sede fija y tarifa.
  const pagaPorHora = req.body.pagaPorHora === true;
  let tarifa = null;
  if (pagaPorHora) {
    if (!sucursalDestino) throw new ApiError(400, 'Quien se paga por hora necesita una sucursal fija.');
    tarifa = validarTarifa(req.body.tarifaHora);
  }

  const hash = await bcrypt.hash(pin, 10);
  const creado = await withTransaction(async c => {
    const { rows: [u] } = await c.query(
      'INSERT INTO usuarios (nombre, rol, pin_hash, sucursal_id, estaciones, paga_por_hora) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [nombre.trim(), rol, hash, sucursalDestino, estaciones, pagaPorHora]
    );
    if (pagaPorHora) await fijarTarifa(c.query.bind(c), { usuarioId: u.id, tarifa, adminId: req.auth.id });
    return leerUsuario(c.query.bind(c), u.id);
  });
  res.status(201).json(creado);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const objetivo = (await query('SELECT id, rol, sucursal_id, paga_por_hora FROM usuarios WHERE id = $1', [req.params.id])).rows[0];
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
  const estaciones = normalizarEstacionesUsuario(req.body.estaciones);
  if (estaciones !== undefined) { sets.push(`estaciones = $${i++}`); values.push(estaciones); }
  if (pin !== undefined) {
    assertStaffPin(pin);
    sets.push(`pin_hash = $${i++}`); values.push(await bcrypt.hash(pin, 10));
  }
  if (rol !== undefined || activo !== undefined || pin !== undefined || sucursalId !== undefined) {
    sets.push('token_version = token_version + 1');
  }

  // Horas (migración 50): marcar o quitar "se paga por hora" y cambiar la tarifa (queda con historial).
  const sedeFinal = sucursalId !== undefined ? sucursalId : objetivo.sucursal_id;
  const pagaFinal = req.body.pagaPorHora !== undefined ? req.body.pagaPorHora === true : objetivo.paga_por_hora;
  let tarifa = null;
  if (req.body.pagaPorHora !== undefined) { sets.push(`paga_por_hora = $${i++}`); values.push(req.body.pagaPorHora === true); }
  if (pagaFinal) {
    if (!sedeFinal) throw new ApiError(400, 'Quien se paga por hora necesita una sucursal fija.');
    const yaTiene = (await query('SELECT 1 FROM tarifas_hora WHERE usuario_id = $1 LIMIT 1', [objetivo.id])).rows.length > 0;
    if (req.body.tarifaHora !== undefined || !yaTiene) tarifa = validarTarifa(req.body.tarifaHora);
  }
  if (objetivo.paga_por_hora) {
    const abiertas = (await query("SELECT 1 FROM jornadas WHERE usuario_id = $1 AND estado = 'abierta' LIMIT 1", [objetivo.id])).rows.length > 0;
    if (req.body.pagaPorHora === false && abiertas) throw new ApiError(409, 'Tiene una jornada abierta. Pídele que la termine (o corrígela en Horas y pagos) antes de quitarle el pago por hora.');
    if (sucursalId !== undefined && sucursalId !== objetivo.sucursal_id) {
      const pendientes = (await query("SELECT 1 FROM jornadas WHERE usuario_id = $1 AND estado IN ('abierta', 'por_revisar', 'cerrada') LIMIT 1", [objetivo.id])).rows.length > 0;
      if (pendientes) throw new ApiError(409, 'Tiene horas sin pagar en su sucursal actual. Págalas o resuélvelas en Horas y pagos antes de cambiarla de sucursal.');
    }
  }
  if (sets.length === 0 && tarifa === null) throw new ApiError(400, 'No se envió ningún campo para actualizar.');

  const actualizado = await withTransaction(async c => {
    const q = c.query.bind(c);
    if (sets.length) {
      const { rowCount } = await q(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${i}`, [...values, req.params.id]);
      if (rowCount === 0) throw new ApiError(404, 'Usuario no encontrado.');
    }
    if (tarifa !== null) await fijarTarifa(q, { usuarioId: objetivo.id, tarifa, adminId: req.auth.id });
    return leerUsuario(q, objetivo.id);
  });
  res.json(actualizado);
}));

module.exports = router;
