const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { ApiError } = require('../utils/asyncHandler');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Nunca arrancar con un secreto por default — eso es exactamente el tipo de
  // hueco de seguridad que esta migración a "desarrollo real" busca cerrar.
  throw new Error('Falta JWT_SECRET en las variables de entorno. Revisa .env.example.');
}

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
      req.auth = decoded;
      return next();
    }
    if (decoded.tipo !== 'staff' || !decoded.id) return next(new ApiError(401, 'Tipo de sesión inválido.'));

    return queryFn('SELECT id, nombre, rol, activo, token_version FROM usuarios WHERE id = $1', [decoded.id])
      .then(result => {
        const current = result.rows[0];
        if (!current?.activo || Number(decoded.ver) !== Number(current.token_version)) {
          throw new ApiError(401, 'La sesión de personal fue revocada. Inicia sesión otra vez.');
        }
        req.auth = { tipo: 'staff', id: current.id, nombre: current.nombre, rol: current.rol, ver: current.token_version };
        next();
      })
      .catch(err => next(err instanceof ApiError ? err : new ApiError(503, 'No se pudo validar la sesión de personal.')));
  };
}

// Verifica firma y, para personal, también estado, rol y versión vigentes.
const requireAuth = createRequireAuth();

// Limita el acceso a ciertos roles de personal (admin, cajero, barista).
// Úsalo DESPUÉS de requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || req.auth.tipo !== 'staff' || !roles.includes(req.auth.rol)) {
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

module.exports = { requireAuth, requireRole, requireCliente, createRequireAuth, JWT_SECRET };
