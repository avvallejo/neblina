const { ApiError } = require('../utils/asyncHandler');

const PAYMENT_ROLES = new Set(['cajero', 'admin']);
const KNOWN_OR_WEAK_PINS = new Set(['0000', '1111', '1234', '2222']);

function assertStaffPin(pin) {
  const value = String(pin || '');
  if (!/^\d{4}$/.test(value)) throw new ApiError(400, 'El PIN debe tener 4 dígitos.');
  if (KNOWN_OR_WEAK_PINS.has(value) || new Set(value).size < 3) {
    throw new ApiError(400, 'El PIN es demasiado predecible o corresponde a uno de demostración.');
  }
  return value;
}

function assertPaymentAllowed(auth, pago) {
  if (pago === undefined || pago === null) return;
  if (!auth || auth.tipo !== 'staff' || !PAYMENT_ROLES.has(auth.rol)) {
    throw new ApiError(403, 'Solo caja o administración pueden registrar un pago.');
  }
}

function normalizeDiscount(value) {
  if (value === undefined || value === null || value === '') return 0;
  const discount = Number(value);
  if (!Number.isFinite(discount) || discount <= 0 || discount > 100) {
    throw new ApiError(400, 'El descuento debe ser mayor que 0 y máximo 100.');
  }
  return Math.round(discount * 100) / 100;
}

function assertDiscountRole(auth) {
  if (!auth || auth.tipo !== 'staff' || !PAYMENT_ROLES.has(auth.rol)) {
    throw new ApiError(403, 'Solo caja o administración pueden aplicar descuentos.');
  }
}

function parseTrustProxyHops(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('Falta TRUST_PROXY_HOPS en producción. Usa 1 para Caddy directo o 2 si también existe un proxy frontal.');
    return null;
  }
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 1 || hops > 3) {
    throw new Error('TRUST_PROXY_HOPS debe ser un entero entre 1 y 3.');
  }
  return hops;
}

module.exports = { assertStaffPin, assertPaymentAllowed, normalizeDiscount, assertDiscountRole, parseTrustProxyHops };
