const { ApiError } = require('../utils/asyncHandler');
const { parseNumber } = require('../utils/catalogValidation');

// Salida de inventario SIN venta: consumibles que se ponen en las mesas
// (azúcar, salsas, servilletas…), consumo del personal o uso interno. No se
// sabe cuánto toma cada cliente, así que se registra lo que se SURTE cuando se
// rellena. Entra al costo de ventas del mes como su propia línea (movimiento
// 'consumo' sin pedido) y descuenta los lotes más antiguos (PEPS).
const MOTIVOS = {
  mesas: 'Consumibles de mesa',
  personal: 'Consumo del personal',
  interno: 'Uso interno',
};

// Debe ejecutarse dentro de una transacción.
async function registrarSalidaInterna(client, { id, sucursalId, usuarioId, cantidad, motivo, nota }) {
  const q = parseNumber(cantidad, 'la cantidad que surtiste', { required: true, min: 0 });
  if (!(q > 0)) throw new ApiError(400, 'Indica cuánto surtiste (más de 0).');
  if (Math.abs(q * 1000 - Math.round(q * 1000)) > 0.0001) throw new ApiError(400, 'Usa una cantidad con hasta tres decimales.');
  const clave = motivo || 'mesas';
  if (!MOTIVOS[clave]) throw new ApiError(400, 'Motivo inválido (mesas, personal o interno).');
  const extra = typeof nota === 'string' ? nota.trim().slice(0, 200) : '';
  const texto = extra ? `${MOTIVOS[clave]}: ${extra}` : MOTIVOS[clave];

  const { rows: [m] } = await client.query('SELECT * FROM materias_primas WHERE id = $1 AND sucursal_id = $2 FOR UPDATE', [id, sucursalId]);
  if (!m) throw new ApiError(404, 'Insumo no encontrado.');
  if (q > Number(m.stock_actual) + 0.0005) {
    throw new ApiError(409, `En el sistema solo hay ${Number(m.stock_actual)} ${m.unidad} de ${m.nombre}. Registra primero la compra o ajusta el conteo.`);
  }
  await client.query('SELECT fn_consumir_insumo($1, $2, $3::unidad_medida, $4)', [id, q, m.unidad, usuarioId]);
  // fn_consumir_insumo no recibe motivo: se lo ponemos a lo que acaba de crear
  // esta transacción (mismo now()) para distinguirlo del consumo por ventas.
  await client.query(
    `UPDATE movimientos_inventario SET motivo = $2
     WHERE materia_prima_id = $1 AND tipo = 'consumo' AND pedido_item_id IS NULL AND merma_id IS NULL AND creado_en = now()`,
    [id, texto]);
  await client.query(
    `INSERT INTO auditoria (entidad, entidad_id, accion, valor_nuevo, motivo, usuario_id, sucursal_id)
     VALUES ('materias_primas', $1, 'salida_interna', $2::jsonb, $3, $4, $5)`,
    [id, JSON.stringify({ cantidad: q, unidad: m.unidad, motivo: clave }), texto, usuarioId, sucursalId]);
  const { rows: [updated] } = await client.query('SELECT * FROM materias_primas WHERE id = $1', [id]);
  return updated;
}

module.exports = { registrarSalidaInterna, MOTIVOS_SALIDA: MOTIVOS };
