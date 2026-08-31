const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { ApiError } = require('../utils/asyncHandler');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Nunca arrancar con un secreto por default — eso es exactamente el tipo de
  // hueco de seguridad que esta migración a "desarrollo real" busca cerrar.
  throw new Error('Falta JWT_SECRET en las variables de entorno. Revisa .env.example.');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createRequireAuth({ verifyToken = jwt.verify, queryFn = query } = {}) {
  return function requireAuthMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(new ApiError(401, 'Falta el token de autenticación'));

    let decoded;
    try {
      decoded = verifyToken(token, JWT_SECRET);
    } catch (err) {
      return next(new ApiError(401, 'Token inválido o expirado'));
    }

    if (decoded.tipo === 'cliente' && decoded.id) {
      // Multi-sucursal: el token de cliente DEBE decir de qué sede es. Un
      // token anterior a la migración no lo trae — se pide re-login.
      if (!decoded.suc) return next(new ApiError(401, 'Tu sesión es de una versión anterior. Inicia sesión otra vez.'));
      req.auth = { ...decoded, sucursalId: decoded.suc };
      return next();
    }
    if (decoded.tipo !== 'staff' || !decoded.id) return next(new ApiError(401, 'Tipo de sesión inválido.'));

    return queryFn('SELECT id, nombre, rol, activo, token_version, sucursal_id FROM usuarios WHERE id = $1', [decoded.id])
      .then(result => {
        const current = result.rows[0];
        if (!current?.activo || Number(decoded.ver) !== Number(current.token_version)) {
          throw new ApiError(401, 'La sesión de personal fue revocada. Inicia sesión otra vez.');
        }
        // La sede se lee SIEMPRE de la base (no del token): si el admin
        // reasigna a alguien de sucursal, surte efecto en su siguiente
        // petición. sucursalId === null significa "admin general".
        req.auth = {
          tipo: 'staff',
          id: current.id,
          nombre: current.nombre,
          rol: current.rol,
          ver: current.token_version,
          sucursalId: current.sucursal_id || null,
        };
        next();
      })
      .catch(err => next(err instanceof ApiError ? err : new ApiError(503, 'No se pudo validar la sesión de personal.')));
  };
}

// Verifica firma y, para personal, también estado, rol, sede y versión vigentes.
const requireAuth = createRequireAuth();

// Limita el acceso a ciertos roles de personal (admin, cajero, barista).
// Úsalo DESPUÉS de requireAuth.
// 'mostrador' = cajero + barista en la misma persona (sucursales chicas):
// pasa cualquier verificación que acepte a uno de los dos.
function rolCumple(rol, roles) {
  if (roles.includes(rol)) return true;
  return rol === 'mostrador' && (roles.includes('cajero') || roles.includes('barista'));
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || req.auth.tipo !== 'staff' || !rolCumple(req.auth.rol, roles)) {
      throw new ApiError(403, `Esta acción requiere uno de estos roles: ${roles.join(', ')}`);
    }
    next();
  };
}

// Para rutas que solo debe usar el cliente autenticado (su propia cuenta).
function requireCliente(req, res, next) {
  if (!req.auth || req.auth.tipo !== 'cliente') {
    throw new ApiError(403, 'Esta acción requiere una sesión de cliente');
  }
  next();
}

// ----------------------------------------------------------------------------
// Multi-sucursal: resuelve EN QUÉ SEDE opera esta petición y la deja en
// req.sucursalId. Úsalo DESPUÉS de requireAuth en toda ruta de datos.
//
//   - Cliente o personal con sede fija: su propia sede, SIEMPRE. Cualquier
//     encabezado que mande se ignora — un cajero de la sede A no puede operar
//     la B ni mandando X-Sucursal-Id.
//   - Admin general (sucursalId NULL): elige la sede activa con el encabezado
//     X-Sucursal-Id (o ?sucursal= en la query).
// ----------------------------------------------------------------------------
function createResolveSucursal({ queryFn = query } = {}) {
  return function resolveSucursalMiddleware(req, res, next) {
    if (!req.auth) return next(new ApiError(401, 'Falta el token de autenticación'));

    if (req.auth.sucursalId) {
      req.sucursalId = req.auth.sucursalId;
      return next();
    }

    if (req.auth.tipo !== 'staff' || req.auth.rol !== 'admin') {
      return next(new ApiError(403, 'Tu sesión no tiene una sucursal asignada.'));
    }

    const pedida = String(req.headers['x-sucursal-id'] || req.query.sucursal || '').trim();
    if (!pedida) return next(new ApiError(400, 'Como administrador general, indica la sucursal a operar (encabezado X-Sucursal-Id).'));
    if (!UUID_RE.test(pedida)) return next(new ApiError(400, 'El identificador de sucursal no es válido.'));

    return queryFn('SELECT id, activo FROM sucursales WHERE id = $1', [pedida])
      .then(result => {
        const sucursal = result.rows[0];
        if (!sucursal || !sucursal.activo) throw new ApiError(404, 'La sucursal no existe o está inactiva.');
        req.sucursalId = sucursal.id;
        next();
      })
      .catch(err => next(err instanceof ApiError ? err : new ApiError(503, 'No se pudo validar la sucursal.')));
  };
}

const resolveSucursal = createResolveSucursal();

// Variante PÚBLICA (sin sesión): para los endpoints abiertos que aun así son
// de UNA sede (el menú, el estado del turno, la marca del negocio). La sede
// viene de ?sucursal= o del encabezado X-Sucursal-Id; si el router ya montó
// requireAuth antes y la sesión trae sede fija, esa sede manda.
function createResolveSucursalPublico({ queryFn = query } = {}) {
  return function resolveSucursalPublicoMiddleware(req, res, next) {
    if (req.auth?.sucursalId) {
      req.sucursalId = req.auth.sucursalId;
      return next();
    }
    const pedida = String(req.headers['x-sucursal-id'] || req.query.sucursal || '').trim();
    if (!pedida) return next(new ApiError(400, 'Indica la sucursal (?sucursal= o encabezado X-Sucursal-Id).'));
    if (!UUID_RE.test(pedida)) return next(new ApiError(400, 'El identificador de sucursal no es válido.'));
    return queryFn('SELECT id, activo FROM sucursales WHERE id = $1', [pedida])
      .then(result => {
        const sucursal = result.rows[0];
        if (!sucursal || !sucursal.activo) throw new ApiError(404, 'La sucursal no existe o está inactiva.');
        req.sucursalId = sucursal.id;
        next();
      })
      .catch(err => next(err instanceof ApiError ? err : new ApiError(503, 'No se pudo validar la sucursal.')));
  };
}

const resolveSucursalPublico = createResolveSucursalPublico();

// Solo el administrador general (rol admin SIN sede fija) puede administrar
// las sucursales mismas. Úsalo DESPUÉS de requireAuth.
function requireAdminGeneral(req, res, next) {
  if (!req.auth || req.auth.tipo !== 'staff' || req.auth.rol !== 'admin' || req.auth.sucursalId) {
    throw new ApiError(403, 'Esta acción requiere un administrador general (sin sucursal fija).');
  }
  next();
}

module.exports = {
  rolCumple,
  requireAuth,
  requireRole,
  requireCliente,
  resolveSucursal,
  resolveSucursalPublico,
  createResolveSucursalPublico,
  requireAdminGeneral,
  createRequireAuth,
  createResolveSucursal,
  UUID_RE,
  JWT_SECRET,
};
