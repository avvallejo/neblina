const { ApiError } = require('./asyncHandler');

const UNIDAD_ALIASES = new Map([
  ['g', 'g'],
  ['gr', 'g'],
  ['gramo', 'g'],
  ['gramos', 'g'],
  ['kg', 'kg'],
  ['kilo', 'kg'],
  ['kilos', 'kg'],
  ['kilogramo', 'kg'],
  ['kilogramos', 'kg'],
  ['ml', 'ml'],
  ['mililitro', 'ml'],
  ['mililitros', 'ml'],
  ['l', 'l'],
  ['lt', 'l'],
  ['lts', 'l'],
  ['litro', 'l'],
  ['litros', 'l'],
  ['pieza', 'pieza'],
  ['piezas', 'pieza'],
  ['pz', 'pieza'],
  ['pza', 'pieza'],
  ['pzas', 'pieza'],
  ['unidad', 'pieza'],
  ['unidades', 'pieza'],
]);

function normalizeUnidadMedida(value, field = 'unidad') {
  if (value === undefined || value === null || value === '') return undefined;
  const key = String(value).trim().toLowerCase();
  const normalized = UNIDAD_ALIASES.get(key);
  if (!normalized) {
    throw new ApiError(400, `${field} inválida. Usa g, kg, ml, l o pieza.`);
  }
  return normalized;
}

function parseNumber(value, field, { required = false, min = null, integer = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `Indica ${field}.`);
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ApiError(400, `${field} debe ser un número válido.`);
  if (integer && !Number.isInteger(n)) throw new ApiError(400, `${field} debe ser un número entero.`);
  if (min !== null && n < min) throw new ApiError(400, `${field} debe ser mayor o igual a ${min}.`);
  return n;
}

function cleanText(value, { required = false, field = 'campo', max = null } = {}) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (required && !text) throw new ApiError(400, `Ingresa ${field}.`);
  if (max && text.length > max) throw new ApiError(400, `${field} no puede tener más de ${max} caracteres.`);
  return text || null;
}

function cleanPhone(value) {
  if (value === undefined) return undefined;
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  return digits || null;
}

function toBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'si', 'sí', 'activo'].includes(v)) return true;
    if (['false', '0', 'no', 'inactivo'].includes(v)) return false;
  }
  return !!value;
}

module.exports = {
  normalizeUnidadMedida,
  parseNumber,
  cleanText,
  cleanPhone,
  toBoolean,
};
