// Envuelve un handler async para que cualquier error caiga directo al
// middleware de errores, sin escribir try/catch en cada ruta.
function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Error con código HTTP explícito, para que el middleware sepa qué responder
// (en vez de siempre devolver 500).
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

module.exports = { asyncHandler, ApiError };
