// COMPRAS DE INSUMOS: una sola lógica para "Registrar compra" y para la
// primera compra al dar de alta un insumo. La compra se captura como llega
// del proveedor (cantidad en su unidad, o N paquetes de la presentación) y
// el sistema convierte a la unidad de control, suma existencias y deja el
// costo unitario de referencia = total pagado / cantidad. Nadie calcula el
// costo por kilo a mano.
const { ApiError } = require('../utils/asyncHandler');
const { cleanText, parseNumber } = require('../utils/catalogValidation');

const UNIDADES = ['g', 'kg', 'ml', 'l', 'pieza'];

function normalizarUnidad(value, label = 'unidad') {
  if (value === undefined || value === null || value === '') return null;
  const u = String(value).trim().toLowerCase();
  if (!UNIDADES.includes(u)) throw new ApiError(400, `${label}: usa g, kg, ml, l o pieza.`);
  return u;
}

const FAMILIA = { g: 'peso', kg: 'peso', ml: 'volumen', l: 'volumen', pieza: 'pieza' };

// Se comprueba la familia ANTES de preguntarle a la base: fn_convertir_unidad
// lanza error (y aborta la transacción) cuando las unidades no son compatibles.
async function factorConversion(client, from, to) {
  if (!from || !to || from === to) return 1;
  if (FAMILIA[from] !== FAMILIA[to]) throw new ApiError(400, `No se puede convertir de ${from} a ${to}: usa una unidad de la misma familia (peso, volumen o piezas).`);
  const { rows } = await client.query('SELECT fn_convertir_unidad(1, $1::unidad_medida, $2::unidad_medida) AS factor', [from, to]);
  const f = Number(rows[0].factor);
  if (!Number.isFinite(f) || f <= 0) throw new ApiError(400, `No se puede convertir de ${from} a ${to}.`);
  return f;
}

// Presentación de compra: { cantidad, unidad, nombre } | null (quitar) | undefined (no tocar).
async function normalizarPresentacion(client, value, unidadControl) {
  if (value === undefined) return undefined;
  if (value === null || value === false) return null;
  if (typeof value !== 'object') throw new ApiError(400, 'Presentación: indica cantidad, unidad y nombre del paquete.');
  const cantidad = parseNumber(value.cantidad, 'contenido del paquete', { required: true, min: 0 });
  if (cantidad <= 0) throw new ApiError(400, 'Presentación: el contenido del paquete debe ser mayor que 0.');
  const unidad = normalizarUnidad(value.unidad, 'unidad de la presentación') || unidadControl;
  await factorConversion(client, unidad, unidadControl); // debe ser convertible a la unidad de control
  const nombre = cleanText(value.nombre, { field: 'nombre del paquete', max: 30 }) || 'paquete';
  return { cantidad, unidad, nombre };
}

// Resuelve "qué se compró": N paquetes (usa la presentación del insumo) o
// cantidad + unidad. Devuelve { cantidad, unidad, paquetes }.
function resolverCantidadCompra(body, materia) {
  const paquetes = body.paquetes === undefined || body.paquetes === null || body.paquetes === '' ? null : parseNumber(body.paquetes, 'paquetes', { min: 0 });
  if (paquetes !== null) {
    if (paquetes <= 0) throw new ApiError(400, 'Indica cuántos paquetes compraste (más de 0).');
    if (!materia.presentacion_cantidad) throw new ApiError(400, 'Este insumo no tiene presentación por paquete; captura la cantidad comprada.');
    return { cantidad: Math.round(paquetes * Number(materia.presentacion_cantidad) * 1000) / 1000, unidad: materia.presentacion_unidad, paquetes };
  }
  const cantidad = parseNumber(body.cantidadComprada, 'cantidad comprada', { required: true, min: 0 });
  if (cantidad <= 0) throw new ApiError(400, 'Indica una cantidad comprada mayor a 0.');
  const unidad = normalizarUnidad(body.unidad, 'unidad del lote') || materia.unidad;
  return { cantidad, unidad, paquetes: null };
}

// Registra una compra (lote) del insumo `materiaId`. Debe ir en transacción.
async function registrarCompra(client, { materiaId, sucursalId, usuarioId, body }) {
  const { rows: [materia] } = await client.query(
    'SELECT id, requiere_lote, unidad, presentacion_cantidad, presentacion_unidad FROM materias_primas WHERE id = $1 AND sucursal_id = $2 FOR UPDATE',
    [materiaId, sucursalId]
  );
  if (!materia) throw new ApiError(404, 'Materia prima no encontrada.');
  const { cantidad, unidad: unidadLote, paquetes } = resolverCantidadCompra(body, materia);
  const costo = parseNumber(body.costoTotal, 'costo total', { required: true, min: 0 });
  await factorConversion(client, unidadLote, materia.unidad);
  if (body.proveedorId) {
    const { rows } = await client.query('SELECT id FROM proveedores WHERE id = $1 AND sucursal_id = $2', [body.proveedorId, sucursalId]);
    if (!rows.length) throw new ApiError(400, 'El proveedor no pertenece a esta sucursal.');
  }

  const { rows: [lote] } = await client.query(
    `INSERT INTO lotes (materia_prima_id, numero_lote, fecha_caducidad, cantidad_comprada, cantidad_disponible, unidad, costo_total, proveedor_id, usuario_id, paquetes)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [materiaId, cleanText(body.numeroLote, { field: 'número de lote', max: 120 }), body.fechaCaducidad || null, cantidad, unidadLote, costo, body.proveedorId || null, usuarioId, paquetes]
  );

  // Costo de referencia = lo que costó ESTA compra, por unidad de control.
  // (Si el proveedor subió el precio, las recetas y "precios por revisar" lo reflejan.)
  const factor = await factorConversion(client, materia.unidad, unidadLote); // unidades de lote por 1 unidad de control
  const costoUnitario = costo > 0 ? Math.round((costo / cantidad) * factor * 10000) / 10000 : null;
  if (costoUnitario !== null) await client.query('UPDATE materias_primas SET costo_unitario = $1 WHERE id = $2', [costoUnitario, materiaId]);

  if (materia.requiere_lote) {
    await client.query(
      `UPDATE materias_primas m SET stock_actual = (
         SELECT COALESCE(SUM(fn_convertir_unidad(l.cantidad_disponible, l.unidad, m.unidad)), 0) FROM lotes l WHERE l.materia_prima_id = m.id
       ) WHERE m.id = $1`, [materiaId]);
  } else {
    const { rows: [conv] } = await client.query('SELECT fn_convertir_unidad($1, $2::unidad_medida, $3::unidad_medida) AS cantidad', [cantidad, unidadLote, materia.unidad]);
    const cantidadStock = Number(conv.cantidad);
    await client.query('UPDATE materias_primas SET stock_actual = stock_actual + $1 WHERE id = $2', [cantidadStock, materiaId]);
    await client.query(`INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, usuario_id) VALUES ($1,'compra',$2,$3,$4)`, [materiaId, cantidadStock, lote.id, usuarioId]);
  }
  return { ...lote, costo_unitario_referencia: costoUnitario };
}

module.exports = { normalizarUnidad, normalizarPresentacion, resolverCantidadCompra, registrarCompra, factorConversion };
