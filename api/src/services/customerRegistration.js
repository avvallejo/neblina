const { query } = require('../db');
const { ApiError } = require('../utils/asyncHandler');

const EXISTING_PHONE_ERROR = 'Este número ya tiene cuenta. Verifícalo por SMS para iniciar sesión.';

// Multi-sucursal: la cartera de clientes es POR SEDE — el mismo teléfono
// puede tener cuenta en dos sucursales, pero no dos veces en la misma.
async function createUnverifiedCustomer({ telefono, nombre, apellido, sucursalId }, queryFn = query) {
  if (!sucursalId) throw new ApiError(400, 'Indica la sucursal (sucursalId).');
  const existing = await queryFn('SELECT id FROM clientes WHERE telefono = $1 AND sucursal_id = $2', [telefono, sucursalId]);
  if (existing.rows.length > 0) throw new ApiError(409, EXISTING_PHONE_ERROR);
  if (!nombre?.trim() || !apellido?.trim()) {
    throw new ApiError(400, 'Para tu primer pedido necesitamos tu nombre y apellido.');
  }

  try {
    const result = await queryFn(
      `INSERT INTO clientes (nombre, apellido, telefono, telefono_verificado, sucursal_id)
       VALUES ($1,$2,$3,false,$4)
       RETURNING id, nombre, apellido, telefono, pedidos_app_contador, recompensa_pendiente`,
      [nombre.trim(), apellido.trim(), telefono, sucursalId]
    );
    return result.rows[0];
  } catch (err) {
    if (err && err.code === '23505') throw new ApiError(409, EXISTING_PHONE_ERROR);
    throw err;
  }
}

module.exports = { createUnverifiedCustomer, EXISTING_PHONE_ERROR };
