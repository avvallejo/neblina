// DESCARTAR EL COSTO DE UN AJUSTE POR ERROR DE CAPTURA
//
// Un ajuste que quita existencias es, para el estado de resultados, una pérdida
// (costo de ventas). Si esas existencias nunca existieron (se capturaron mal),
// no hubo pérdida. Aquí NO se cambian las existencias ni se borra nada: por cada
// movimiento del ajuste se agregan dos movimientos
//   - 'ajuste' contrario, al mismo costo  → el costo del ajuste suma cero;
//   - 'correccion_captura' igual al original → conserva la cantidad (no es costo de ventas).
// El ajuste queda marcado (quién, cuándo, por qué) y con rastro en la bitácora.
const { ApiError } = require('../utils/asyncHandler');
const { cleanText } = require('../utils/catalogValidation');
const A = require('./accounting');
const H = require('./stockAdjustmentHistory');
const B = require('./bitacora');

const r2 = n => Math.round(Number(n) * 100) / 100;

async function descartarCostoAjuste(client, { sucursalId, usuarioId, ajusteId, motivo }) {
  if (!B.UUID.test(String(ajusteId || ''))) throw new ApiError(400, 'Ajuste inválido.');
  const razon = cleanText(motivo, { required: true, field: 'el motivo', max: 500 });
  if (!razon || razon.length < 5) throw new ApiError(400, 'Explica con unas palabras por qué fue un error de captura.');
  await client.query("SET LOCAL lock_timeout='5s'");
  const { rows: [ajuste] } = await client.query(
    `SELECT a.*, m.nombre AS insumo, m.unidad FROM ajustes_stock a JOIN materias_primas m ON m.id = a.materia_prima_id
     WHERE a.id = $1 AND a.sucursal_id = $2 FOR UPDATE OF a`, [ajusteId, sucursalId]);
  if (!ajuste) throw new ApiError(404, 'Ajuste no encontrado en esta sucursal.');
  if (ajuste.revertido_en) throw new ApiError(409, 'A este ajuste ya se le descartó el costo o se revirtió.');
  await client.query('SELECT 1 FROM materias_primas WHERE id = $1 FOR UPDATE', [ajuste.materia_prima_id]);
  await H.mesesAbiertos(client, sucursalId, [A.hoyMx(), A.fechaISO(ajuste.fecha_contable)]);

  const { rows: movs } = await client.query(
    `SELECT mi.* FROM movimientos_inventario mi
     WHERE mi.ajuste_stock_id = $1 AND mi.tipo = 'ajuste' AND mi.revierte_movimiento_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id = mi.id)
     ORDER BY mi.creado_en, mi.id`, [ajuste.id]);
  if (!movs.length) throw new ApiError(409, 'Este ajuste no tiene movimientos con costo que descartar.');
  const motivoMov = `Error de captura: ${razon}`.slice(0, 500);
  let impacto = 0;
  for (const m of movs) {
    await client.query(
      `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, usuario_id, motivo, costo_unitario, revierte_movimiento_id, ajuste_stock_id)
       VALUES ($1,'ajuste',$2,$3,$4,$5,$6,$7,$8)`, [m.materia_prima_id, -Number(m.cantidad), m.lote_id, usuarioId, motivoMov, m.costo_unitario, m.id, ajuste.id]);
    await client.query(
      `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, usuario_id, motivo, costo_unitario, ajuste_stock_id)
       VALUES ($1,'correccion_captura',$2,$3,$4,$5,$6,$7)`, [m.materia_prima_id, Number(m.cantidad), m.lote_id, usuarioId, motivoMov, m.costo_unitario, ajuste.id]);
    impacto += -Number(m.cantidad) * Number(m.costo_unitario || 0);
  }
  await client.query('UPDATE ajustes_stock SET revertido_en = now(), revertido_por = $2, motivo_reversion = $3 WHERE id = $1', [ajuste.id, usuarioId, `Error de captura: ${razon}`]);
  await B.registrarCambio(client, { sucursalId, usuarioId, entidad: 'ajustes_stock', entidadId: ajuste.id, accion: 'descartar_costo',
    anterior: { insumo: ajuste.insumo, cantidadAnterior: ajuste.cantidad_anterior, cantidadContada: ajuste.cantidad_contada, costoEnResultados: r2(impacto) },
    nuevo: { costoEnResultados: 0, existenciasSinCambio: true }, motivo: razon });
  return { ajusteId: ajuste.id, insumo: ajuste.insumo, impactoResultados: r2(impacto), movimientos: movs.length };
}

module.exports = { descartarCostoAjuste };
