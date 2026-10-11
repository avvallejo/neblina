const { ApiError } = require('../utils/asyncHandler');
const { validateDate } = require('./dailySales');

function mermaDate(value, rol, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const date = validateDate(value) || today;
  if (date > today) throw new ApiError(400, 'La fecha de la merma no puede ser futura.');
  if (date !== today && rol !== 'admin') throw new ApiError(403, 'Solo Administración puede registrar mermas de fechas anteriores.');
  return date;
}
module.exports = { mermaDate };
