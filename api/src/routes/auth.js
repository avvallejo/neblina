const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { JWT_SECRET, UUID_RE, requireAuth } = require('../middleware/auth');
const { enviarSms } = require('../services/sms');
const { createUnverifiedCustomer } = require('../services/customerRegistration');

const router = express.Router();

// Multi-sucursal: toda sesión nace atada a una sede, así que cada flujo de
// login empieza validando cuál. Este helper valida forma y existencia.
async function validarSucursal(valor) {
  const sucursalId = String(valor || '').trim();
  if (!UUID_RE.test(sucursalId)) throw new ApiError(400, 'Indica la sucursal (sucursalId).');
  const { rows } = await query('SELECT id FROM sucursales WHERE id = $1 AND activo', [sucursalId]);
  if (!rows[0]) throw new ApiError(404, 'La sucursal no existe o está inactiva.');
  return sucursalId;
}

// ¿Quién soy? — para RESTAURAR la sesión al recargar la página (el celular
// descarta la pestaña al bloquearse; el token sigue guardado en el
// dispositivo). requireAuth ya revalida activo, rol, sede y token_version,
// así que una sesión revocada NO se restaura.
router.get('/yo', requireAuth, asyncHandler(async (req, res) => {
  res.json({
    tipo: req.auth.tipo,
    id: req.auth.id,
    nombre: req.auth.nombre || null,
    rol: req.auth.rol || null,
    sucursalId: req.auth.sucursalId ?? null,
  });
}));

// El PIN es de solo 4 dígitos — sin límite de intentos, alguien podría
// probarlos todos en minutos. 10 intentos por 15 minutos por IP es generoso
// para un uso normal y bloquea un ataque de fuerza bruta.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// POST /api/auth/login  { pin, sucursalId }  -> login de personal
// La pantalla de login pide primero la sede (GET /api/sucursales) y luego el
// PIN. El PIN se compara solo contra el personal de ESA sede más los
// administradores generales — así el barrido de bcrypt no crece con el total
// de empleados del negocio, y el mismo PIN puede existir en dos sedes sin
// ambigüedad.
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4}$/.test(pin)) throw new ApiError(400, 'El PIN debe tener 4 dígitos.');
  const sucursalId = await validarSucursal(req.body.sucursalId);

  const { rows } = await query(
    `SELECT id, nombre, rol, pin_hash, token_version, sucursal_id FROM usuarios
     WHERE activo = true AND (sucursal_id = $1 OR (rol = 'admin' AND sucursal_id IS NULL))`,
    [sucursalId]
  );

  let encontrado = null;
  for (const u of rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(pin, u.pin_hash)) { encontrado = u; break; }
  }

  if (!encontrado) throw new ApiError(401, 'PIN incorrecto.');

  // suc en el token: la sede FIJA del usuario (null = admin general). No se
  // guarda la sede elegida en el login: el admin general elige sede por
  // petición con X-Sucursal-Id, y el resto del personal solo tiene la suya.
  const token = jwt.sign(
    { tipo: 'staff', id: encontrado.id, nombre: encontrado.nombre, rol: encontrado.rol, ver: encontrado.token_version, suc: encontrado.sucursal_id || null },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({
    token,
    usuario: { id: encontrado.id, nombre: encontrado.nombre, rol: encontrado.rol, sucursalId: encontrado.sucursal_id || null },
  });
}));

const clienteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const codigoLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false });

function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos, nunca empieza en 0
}

function firmarTokenCliente(cliente, sucursalId) {
  return jwt.sign(
    { tipo: 'cliente', id: cliente.id, telefono: cliente.telefono, suc: sucursalId },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// PASO 1 — POST /api/auth/cliente/solicitar-codigo { telefono, sucursalId }
// Manda un código de 6 dígitos por SMS. Nunca confirma si el teléfono ya
// tiene cuenta o no (eso se sabe hasta verificar el código), para no dejar
// que cualquiera use este endpoint para enumerar qué números están
// registrados. Los códigos y sus límites viven POR SEDE (la cartera de
// clientes es por sucursal).
router.post('/cliente/solicitar-codigo', codigoLimiter, asyncHandler(async (req, res) => {
  const telefono = String(req.body.telefono || '').replace(/\D/g, '');
  if (!/^\d{10}$/.test(telefono)) throw new ApiError(400, 'El teléfono debe tener 10 dígitos.');
  const sucursalId = await validarSucursal(req.body.sucursalId);

  // Límite por teléfono (no solo por IP): evita que alguien bombardee de SMS
  // a un número ajeno cambiando de IP, y limita el costo real de SNS.
  const reciente = await query(
    'SELECT creado_en FROM verificaciones_telefono WHERE telefono = $1 AND sucursal_id = $2 ORDER BY creado_en DESC LIMIT 1',
    [telefono, sucursalId]
  );
  if (reciente.rows[0] && Date.now() - new Date(reciente.rows[0].creado_en).getTime() < 60 * 1000) {
    throw new ApiError(429, 'Espera un minuto antes de pedir otro código.');
  }
  const enLaUltimaHora = await query(
    "SELECT COUNT(*) FROM verificaciones_telefono WHERE telefono = $1 AND sucursal_id = $2 AND creado_en > now() - interval '1 hour'",
    [telefono, sucursalId]
  );
  if (Number(enLaUltimaHora.rows[0].count) >= 5) {
    throw new ApiError(429, 'Demasiados códigos solicitados para este número. Intenta en una hora.');
  }

  const codigo = generarCodigo();
  await query(
    "INSERT INTO verificaciones_telefono (telefono, codigo, expira_en, sucursal_id) VALUES ($1,$2, now() + interval '10 minutes', $3)",
    [telefono, codigo, sucursalId]
  );
  await enviarSms(telefono, `Tu código de verificación de Cafetería Móvil es ${codigo}. Vence en 10 minutos. No lo compartas.`);

  res.json({ ok: true, mensaje: 'Código enviado por SMS.' });
}));

// PASO 2 — POST /api/auth/cliente/verificar-codigo { telefono, codigo, sucursalId, nombre?, apellido? }
// nombre/apellido solo son obligatorios si el teléfono nunca se ha
// registrado antes EN ESTA SEDE; un cliente que regresa solo necesita el código.
router.post('/cliente/verificar-codigo', clienteLimiter, asyncHandler(async (req, res) => {
  const telefono = String(req.body.telefono || '').replace(/\D/g, '');
  const codigo = String(req.body.codigo || '').trim();
  const { nombre, apellido } = req.body;
  if (!/^\d{10}$/.test(telefono)) throw new ApiError(400, 'El teléfono debe tener 10 dígitos.');
  if (!/^\d{6}$/.test(codigo)) throw new ApiError(400, 'El código debe tener 6 dígitos.');
  const sucursalId = await validarSucursal(req.body.sucursalId);

  const verif = await query(
    'SELECT * FROM verificaciones_telefono WHERE telefono = $1 AND sucursal_id = $2 AND verificado = false ORDER BY creado_en DESC LIMIT 1',
    [telefono, sucursalId]
  );
  if (verif.rows.length === 0) throw new ApiError(400, 'Solicita un código antes de verificar.');
  const v = verif.rows[0];

  if (new Date(v.expira_en).getTime() < Date.now()) throw new ApiError(400, 'El código venció. Solicita uno nuevo.');
  if (v.intentos >= 5) throw new ApiError(429, 'Demasiados intentos con este código. Solicita uno nuevo.');

  if (v.codigo !== codigo) {
    await query('UPDATE verificaciones_telefono SET intentos = intentos + 1 WHERE id = $1', [v.id]);
    throw new ApiError(401, 'Código incorrecto.');
  }

  let cliente = (await query(
    'SELECT id, nombre, apellido, telefono, pedidos_app_contador, recompensa_pendiente FROM clientes WHERE telefono = $1 AND sucursal_id = $2',
    [telefono, sucursalId]
  )).rows[0];

  // Si es necesario crear la cuenta y falta nombre/apellido, se falla AQUÍ,
  // antes de marcar el código como usado — para que el cliente pueda
  // reintentar con el mismo código en vez de tener que pedir uno nuevo solo
  // porque se le olvidó mandar su nombre la primera vez.
  if (!cliente && (!nombre?.trim() || !apellido?.trim())) {
    throw new ApiError(400, 'Para tu primer pedido necesitamos tu nombre y apellido.');
  }

  await query('UPDATE verificaciones_telefono SET verificado = true WHERE id = $1', [v.id]);

  if (!cliente) {
    cliente = (await query(
      'INSERT INTO clientes (nombre, apellido, telefono, telefono_verificado, sucursal_id) VALUES ($1,$2,$3,true,$4) RETURNING id, nombre, apellido, telefono, pedidos_app_contador, recompensa_pendiente',
      [nombre.trim(), apellido.trim(), telefono, sucursalId]
    )).rows[0];
  } else {
    await query('UPDATE clientes SET telefono_verificado = true WHERE id = $1', [cliente.id]);
  }

  res.json({ token: firmarTokenCliente(cliente, sucursalId), cliente });
}));

// Alta directa SIN SMS — solo permitida cuando la verificación por SMS está
// DESACTIVADA en la configuración DE ESA SEDE (el admin la prende/apaga por
// sucursal). Si la sede no ha configurado nada, se asume ACTIVA (modo seguro,
// igual que la migración 10).
router.post('/cliente/registro', clienteLimiter, asyncHandler(async (req, res) => {
  const sucursalId = await validarSucursal(req.body.sucursalId);
  const cfg = await query(
    "SELECT valor FROM configuracion WHERE clave = 'sms_verificacion' AND sucursal_id = $1",
    [sucursalId]
  );
  const smsActivo = !cfg.rows[0] || cfg.rows[0].valor === true;
  if (smsActivo) {
    throw new ApiError(403, 'La verificación por SMS está activa: solicita un código.');
  }
  const telefono = String(req.body.telefono || '').replace(/\D/g, '');
  const { nombre, apellido } = req.body;
  if (!/^\d{10}$/.test(telefono)) throw new ApiError(400, 'El teléfono debe tener 10 dígitos.');

  const cliente = await createUnverifiedCustomer({ telefono, nombre, apellido, sucursalId });

  res.json({ token: firmarTokenCliente(cliente, sucursalId), cliente });
}));

module.exports = router;
