const { ApiError } = require('../utils/asyncHandler');

function validateDate(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, 'Indica una fecha válida (AAAA-MM-DD).');
  }
  return value;
}

// El esquema conserva la fecha de registro, no la fecha de cobro.
const dailySalesSql = `
WITH dia AS (
  SELECT COALESCE($2::date, (now() AT TIME ZONE 'America/Mexico_City')::date) AS fecha
), limites AS (
  SELECT fecha, fecha::timestamp AT TIME ZONE 'America/Mexico_City' AS inicio,
    (fecha + 1)::timestamp AT TIME ZONE 'America/Mexico_City' AS fin FROM dia
)
SELECT l.fecha::text,
  COUNT(p.id) FILTER (WHERE NOT p.cancelado) AS pedidos,
  COALESCE(SUM(p.total) FILTER (WHERE p.cobrado AND NOT p.cancelado AND NOT p.no_show), 0) AS ventas,
  COALESCE(AVG(p.total) FILTER (WHERE p.cobrado AND NOT p.cancelado AND NOT p.no_show), 0) AS ticket_promedio,
  (SELECT COUNT(*) FROM mermas m WHERE m.sucursal_id = $1
    AND m.creado_en >= l.inicio AND m.creado_en < l.fin) AS mermas
FROM limites l
LEFT JOIN pedidos p ON p.sucursal_id = $1 AND p.creado_en >= l.inicio AND p.creado_en < l.fin
GROUP BY l.fecha, l.inicio, l.fin`;

module.exports = { validateDate, dailySalesSql };
