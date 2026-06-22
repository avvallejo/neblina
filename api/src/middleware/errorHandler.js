const { ApiError } = require('../utils/asyncHandler');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  // Errores de PostgreSQL que sí queremos traducir a algo legible, en vez de
  // un 500 genérico que no le dice nada al frontend.
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Ya existe un registro con ese valor único.' });
  }
  if (err.code === '23503') {
    return res.status(409).json({ error: 'La operación referencia un registro que no existe.' });
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'El valor no cumple una restricción del sistema (ej. cantidad negativa).' });
  }

  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

module.exports = { errorHandler };
