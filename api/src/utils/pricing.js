const { query } = require('../db');
const { ApiError } = require('./asyncHandler');

// Calcula el precio unitario de una línea de pedido en el servidor — el precio
// que manda el frontend nunca se usa para cobrar, solo para mostrarlo de
// forma optimista mientras llega la respuesta real.
async function calcularPrecioItem({ productoId, tamanoId, lecheId, cafeId, extraIds = [], esRegalo = false }) {
  const prodRow = await query('SELECT * FROM productos WHERE id = $1', [productoId]);
  if (prodRow.rows.length === 0) throw new ApiError(404, 'Producto no encontrado.');
  const producto = prodRow.rows[0];

  if (esRegalo) return 0;

  // Si el producto permite elegir tamaño/leche/café, esa elección es
  // OBLIGATORIA — no opcional — porque el trigger de descuento de inventario
  // (fn_descontar_inventario) solo descuenta café/leche cuando viene el id de
  // la opción elegida. Sin esta validación, un pedido podría quedar
  // "completo" pero sin descontar el insumo principal de la bebida.
  if (producto.permite_tamanos && !tamanoId) throw new ApiError(400, `"${producto.nombre}" requiere elegir un tamaño.`);
  if (producto.permite_leche && !lecheId) throw new ApiError(400, `"${producto.nombre}" requiere elegir el tipo de leche.`);
  if (producto.permite_tipo_cafe && !cafeId) throw new ApiError(400, `"${producto.nombre}" requiere elegir el tipo de café.`);

  let total = Number(producto.precio_base);
  const efectivo = await query('SELECT fn_precio_efectivo($1) AS precio', [productoId]);
  total = Number(efectivo.rows[0].precio);

  if (tamanoId) {
    const r = await query('SELECT delta_precio FROM opciones_tamano WHERE id = $1', [tamanoId]);
    if (r.rows.length === 0) throw new ApiError(400, 'Tamaño inválido.');
    total += Number(r.rows[0].delta_precio);
  }
  if (lecheId) {
    const r = await query('SELECT delta_precio FROM opciones_leche WHERE id = $1 AND activo', [lecheId]);
    if (r.rows.length === 0) throw new ApiError(400, 'Opción de leche inválida.');
    total += Number(r.rows[0].delta_precio);
  }
  if (cafeId) {
    const r = await query('SELECT delta_precio FROM opciones_cafe WHERE id = $1 AND activo', [cafeId]);
    if (r.rows.length === 0) throw new ApiError(400, 'Opción de café inválida.');
    total += Number(r.rows[0].delta_precio);
  }
  for (const extraId of extraIds) {
    // eslint-disable-next-line no-await-in-loop
    const r = await query('SELECT delta_precio FROM opciones_extra WHERE id = $1 AND activo', [extraId]);
    if (r.rows.length === 0) throw new ApiError(400, `Extra inválido: ${extraId}`);
    total += Number(r.rows[0].delta_precio);
  }
  return Math.round(total * 100) / 100;
}

module.exports = { calcularPrecioItem };
