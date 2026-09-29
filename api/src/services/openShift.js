const { ApiError } = require('../utils/asyncHandler');

// Mantener el bloqueo hasta terminar la venta: el cierre esperará al cobro
// en curso, o la venta verá que el turno ya se cerró y será rechazada.
async function requireOpenShift(client, sucursalId) {
  const { rows: [turno] } = await client.query(
    'SELECT id FROM turnos WHERE sucursal_id=$1 AND cerrado_en IS NULL FOR SHARE', [sucursalId]);
  if (!turno) throw new ApiError(409, 'Abre un turno y registra el fondo inicial antes de vender o cobrar.', { codigo: 'turno_cerrado' });
  return turno;
}

module.exports = { requireOpenShift };
