const { query } = require('../db');
const { ApiError } = require('./asyncHandler');

// Calcula el precio unitario de una línea de pedido en el servidor — el precio
// que manda el frontend nunca se usa para cobrar, solo para mostrarlo de
// forma optimista mientras llega la respuesta real.
async function calcularPrecioItem({ productoId, tamanoId, lecheId, cafeId, extraIds = [] }, queryFn = query) {
  if (!Array.isArray(extraIds)) throw new ApiError(400, 'extraIds debe ser una lista.');
  if (new Set(extraIds.map(String)).size !== extraIds.length) throw new ApiError(400, 'No se puede repetir el mismo extra.');

  const prodRow = await queryFn('SELECT * FROM productos WHERE id = $1 AND activo = true', [productoId]);
  if (prodRow.rows.length === 0) throw new ApiError(404, 'Producto no encontrado.');
  const producto = prodRow.rows[0];

  // Si el producto permite elegir tamaño/leche/café, esa elección es
  // OBLIGATORIA — no opcional — porque el trigger de descuento de inventario
  // (fn_descontar_inventario) solo descuenta café/leche cuando viene el id de
  // la opción elegida. Sin esta validación, un pedido podría quedar
  // "completo" pero sin descontar el insumo principal de la bebida.
  if (producto.permite_tamanos && !tamanoId) throw new ApiError(400, `"${producto.nombre}" requiere elegir un tamaño.`);
  if (producto.permite_leche && !lecheId) throw new ApiError(400, `"${producto.nombre}" requiere elegir el tipo de leche.`);
  if (producto.permite_tipo_cafe && !cafeId) throw new ApiError(400, `"${producto.nombre}" requiere elegir el tipo de café.`);
  if (!producto.permite_tamanos && tamanoId) throw new ApiError(400, `"${producto.nombre}" no permite elegir tamaño.`);
  if (!producto.permite_leche && lecheId) throw new ApiError(400, `"${producto.nombre}" no permite elegir leche.`);
  if (!producto.permite_tipo_cafe && cafeId) throw new ApiError(400, `"${producto.nombre}" no permite elegir tipo de café.`);
  if (!producto.permite_extras && extraIds.length > 0) throw new ApiError(400, `"${producto.nombre}" no permite extras.`);

  let total = Number(producto.precio_base);
  const efectivo = await queryFn('SELECT fn_precio_efectivo($1) AS precio', [productoId]);
  total = Number(efectivo.rows[0].precio);

  if (tamanoId) {
    const r = await queryFn('SELECT delta_precio FROM opciones_tamano WHERE id = $1', [tamanoId]);
    if (r.rows.length === 0) throw new ApiError(400, 'Tamaño inválido.');
    total += Number(r.rows[0].delta_precio);
  }
  if (lecheId) {
    const r = await queryFn('SELECT delta_precio FROM opciones_leche WHERE id = $1 AND activo', [lecheId]);
    if (r.rows.length === 0) throw new ApiError(400, 'Opción de leche inválida.');
    total += Number(r.rows[0].delta_precio);
  }
  if (cafeId) {
    const r = await queryFn('SELECT delta_precio FROM opciones_cafe WHERE id = $1 AND activo', [cafeId]);
    if (r.rows.length === 0) throw new ApiError(400, 'Opción de café inválida.');
    total += Number(r.rows[0].delta_precio);
  }
  for (const extraId of extraIds) {
    // eslint-disable-next-line no-await-in-loop
    const r = await queryFn('SELECT delta_precio FROM opciones_extra WHERE id = $1 AND activo', [extraId]);
    if (r.rows.length === 0) throw new ApiError(400, `Extra inválido: ${extraId}`);
    total += Number(r.rows[0].delta_precio);
  }
  if (!Number.isFinite(total) || total < 0) throw new ApiError(400, 'La combinación seleccionada produce un precio inválido.');
  return Math.round(total * 100) / 100;
}

module.exports = { calcularPrecioItem };
