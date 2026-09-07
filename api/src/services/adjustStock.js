const { randomUUID } = require('node:crypto');
const { ApiError } = require('../utils/asyncHandler');
const { parseNumber, cleanText } = require('../utils/catalogValidation');

// Debe ejecutarse dentro de una transacción: lotes, saldo e historial son atómicos.
async function ajustarStock(client, { id, sucursalId, usuarioId, nuevaCantidad, stockEsperado, motivo, fechaCaducidad }) {
  const cantidad = parseNumber(nuevaCantidad, 'la cantidad contada', { required: true, min: 0 });
  if (cantidad > 999999999.999 || Math.abs(cantidad * 1000 - Math.round(cantidad * 1000)) > 0.0001) {
    throw new ApiError(400, 'Usa una cantidad con hasta tres decimales y menor a mil millones.');
  }
  const esperado = parseNumber(stockEsperado, 'el stock mostrado', { min: 0 });
  const razon = cleanText(motivo, { max: 500, field: 'motivo' });
  const { rows: [materia] } = await client.query(
    'SELECT * FROM materias_primas WHERE id = $1 AND sucursal_id = $2 FOR UPDATE', [id, sucursalId]);
  if (!materia) throw new ApiError(404, 'Materia prima no encontrada.');
  if (esperado !== undefined && Number(materia.stock_actual) !== esperado) {
    throw new ApiError(409, 'El stock cambió mientras hacías el conteo. Cierra el ajuste y vuelve a abrirlo.');
  }
  if (materia.requiere_lote && !razon) throw new ApiError(400, 'Indica el motivo de la corrección de inventario.');
  const registrar = (diferencia, loteId = null) => client.query(
    `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, usuario_id, motivo)
     VALUES ($1,'ajuste',$2,$3,$4,$5)`, [id, diferencia, loteId, usuarioId, razon || 'Ajuste por conteo físico']);

  if (materia.requiere_lote) {
    const { rows: lotes } = await client.query(
      `SELECT *, fn_convertir_unidad(cantidad_disponible, unidad, $2::unidad_medida) AS saldo,
         fn_convertir_unidad(1, $2::unidad_medida, unidad) AS factor
       FROM lotes WHERE materia_prima_id = $1
       ORDER BY fecha_compra, creado_en, id FOR UPDATE`, [id, materia.unidad]);
    const total = lotes.reduce((sum, lote) => sum + Number(lote.saldo), 0);
    if (Math.abs(total - Number(materia.stock_actual)) > 0.000501) {
      throw new ApiError(409, 'El saldo de los lotes no coincide con el inventario. Revisa los movimientos antes de ajustar.');
    }
    const diferencia = cantidad - total;
    if (diferencia > 0.0000001) {
      if (materia.requiere_caducidad && !fechaCaducidad) throw new ApiError(400, 'Indica la caducidad de las existencias encontradas.');
      if (fechaCaducidad && (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCaducidad) || !Number.isFinite(Date.parse(fechaCaducidad)) || new Date(fechaCaducidad).toISOString().slice(0, 10) !== fechaCaducidad)) {
        throw new ApiError(400, 'Indica una fecha de caducidad válida.');
      }
      // Lote identificado como corrección, sin registrar una compra ni cambiar costos.
      const { rows: [lote] } = await client.query(
        `INSERT INTO lotes (materia_prima_id, numero_lote, cantidad_comprada, cantidad_disponible, unidad, costo_total, usuario_id, fecha_caducidad)
         VALUES ($1,$2,$3,$3,$4,0,$5,$6) RETURNING id`,
        [id, `AJUSTE-${randomUUID()}`, diferencia, materia.unidad, usuarioId, fechaCaducidad || null]);
      await registrar(diferencia, lote.id);
    } else if (diferencia < -0.0000001) {
      let restante = -diferencia;
      for (const lote of lotes) {
        if (restante < 0.0000001) break;
        if (Number(lote.saldo) <= 0) continue;
        const tomar = Math.min(Number(lote.saldo), restante);
        const nuevoSaldo = Math.round((Number(lote.cantidad_disponible) - tomar * Number(lote.factor)) * 1000) / 1000;
        const descuento = (Number(lote.cantidad_disponible) - nuevoSaldo) / Number(lote.factor);
        if (descuento <= 0) continue;
        await client.query('UPDATE lotes SET cantidad_disponible = $1 WHERE id = $2', [nuevoSaldo, lote.id]);
        await registrar(-descuento, lote.id);
        restante -= descuento;
      }
    }
    const { rows: [saldo] } = await client.query(
      `SELECT COALESCE(SUM(fn_convertir_unidad(cantidad_disponible, unidad, $2::unidad_medida)),0) AS total
       FROM lotes WHERE materia_prima_id = $1`, [id, materia.unidad]);
    if (Math.abs(Number(saldo.total) - cantidad) > 0.000501) {
      throw new ApiError(400, 'La cantidad es demasiado precisa para las unidades de los lotes. Usa un conteo con menos decimales.');
    }
  } else if (cantidad !== Number(materia.stock_actual)) {
    await registrar(cantidad - Number(materia.stock_actual));
  }
  const { rows: [updated] } = await client.query(
    'UPDATE materias_primas SET stock_actual = $1 WHERE id = $2 RETURNING *', [cantidad, id]);
  return updated;
}

module.exports = { ajustarStock };
