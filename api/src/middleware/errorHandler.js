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
  if (err.code === '23502') {
    return res.status(400).json({ error: 'Falta un dato obligatorio para guardar el registro.' });
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'El valor no cumple una restricción del sistema (ej. cantidad negativa).' });
  }
  if (err.code === '22P02') {
    return res.status(400).json({ error: 'Uno de los valores enviados no es válido para este catálogo.' });
  }
  if (err.code === '22023') {
    return res.status(400).json({ error: err.message || 'No se puede convertir entre esas unidades.' });
  }

  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

module.exports = { errorHandler };
