const jwt = require('jsonwebtoken');
const { ApiError } = require('../utils/asyncHandler');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Nunca arrancar con un secreto por default — eso es exactamente el tipo de
  // hueco de seguridad que esta migración a "desarrollo real" busca cerrar.
  throw new Error('Falta JWT_SECRET en las variables de entorno. Revisa .env.example.');
}

// Verifica el token y deja al usuario (o cliente) disponible en req.auth.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'Falta el token de autenticación');

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    throw new ApiError(401, 'Token inválido o expirado');
  }
}

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

module.exports = { requireAuth, requireRole, requireCliente, JWT_SECRET };
