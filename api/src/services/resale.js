// SNACKS DE REVENTA (comprados hechos). Un snack se liga a UN insumo del
// inventario (normalmente en piezas) mediante receta_insumos_fijos: cada venta
// descuenta `cantidad` del insumo, el costo del snack es el costo de compra y
// el inventario avisa cuánto pedir. `reventa: null` quita el control.
const { ApiError } = require('../utils/asyncHandler');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizarReventa(value) {
  if (value === undefined) return undefined;
  if (value === null || value === false) return null;
  if (typeof value !== 'object') throw new ApiError(400, 'Existencias: indica el insumo y la cantidad por venta.');
  const insumoId = String(value.insumoId || '');
  if (!UUID.test(insumoId)) throw new ApiError(400, 'Existencias: elige el insumo del inventario que se descuenta.');
  const cantidad = value.cantidad === undefined || value.cantidad === null || value.cantidad === '' ? 1 : Number(value.cantidad);
  if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1000) throw new ApiError(400, 'Existencias: la cantidad por venta debe ser mayor que 0.');
  return { insumoId, cantidad: Math.round(cantidad * 1000) / 1000 };
}

// Guarda (o quita) el insumo de reventa de un snack. Debe ir en transacción.
async function guardarReventa(client, { productoId, sucursalId, tipo, reventa }) {
  if (reventa === undefined) return;
  if (tipo !== 'snack') {
    if (reventa === null) return; // las bebidas no llevan reventa: nada que quitar
    throw new ApiError(400, 'Solo los snacks se ligan a un insumo de reventa; las bebidas usan su receta.');
  }
  await client.query('DELETE FROM receta_insumos_fijos WHERE producto_id = $1', [productoId]);
  if (reventa === null) return;
  const { rows: [m] } = await client.query('SELECT id, unidad FROM materias_primas WHERE id = $1 AND sucursal_id = $2 AND activo', [reventa.insumoId, sucursalId]);
  if (!m) throw new ApiError(400, 'El insumo no existe en esta sucursal o está inactivo.');
  await client.query(
    'INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES ($1, $2, $3, $4)',
    [productoId, m.id, reventa.cantidad, m.unidad]
  );
}

// Subconsulta para GET /productos: existencias del insumo ligado (solo snacks).
const reventaSql = `(SELECT jsonb_build_object(
    'insumoId', m.id, 'nombre', m.nombre, 'cantidad', rif.cantidad, 'unidad', m.unidad,
    'stock', m.stock_actual, 'stockMinimo', m.stock_minimo, 'stockMaximo', m.stock_maximo,
    'costoUnitario', m.costo_unitario,
    'aPedir', CASE WHEN m.stock_actual < m.stock_minimo THEN GREATEST(COALESCE(m.stock_maximo, m.stock_minimo) - m.stock_actual, 0) ELSE 0 END)
  FROM receta_insumos_fijos rif JOIN materias_primas m ON m.id = rif.materia_prima_id
  WHERE rif.producto_id = p.id AND p.tipo = 'snack' ORDER BY rif.id LIMIT 1)`;

module.exports = { normalizarReventa, guardarReventa, reventaSql };
