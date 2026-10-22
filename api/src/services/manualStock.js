'use strict';
// Existencias capturadas "a mano" (alta de insumo con existencias, o edición de
// "Stock actual"). Nunca más sin rastro: cada una deja un movimiento con usuario,
// fecha y motivo, y las cantidades grandes exigen confirmarse escribiéndolas otra vez.
// Ninguno de estos movimientos es costo de ventas (a diferencia de 'ajuste').
const { ApiError } = require('../utils/asyncHandler');
const { cleanText } = require('../utils/catalogValidation');

// A partir de aquí la cantidad se considera "grande" y pide confirmación.
const UMBRAL_GRANDE = { kg: 50, l: 50, g: 50000, ml: 50000, pieza: 500 };

function esCantidadGrande(unidad, cantidad) {
  const u = UMBRAL_GRANDE[unidad];
  return u !== undefined && Math.abs(Number(cantidad)) >= u;
}

function exigirConfirmacion(unidad, cantidad, confirmar) {
  if (!esCantidadGrande(unidad, cantidad)) return;
  if (Number(confirmar) === Math.abs(Number(cantidad))) return;
  throw new ApiError(409, `Son ${cantidad} ${unidad}: es una cantidad muy grande. Escríbela otra vez en "Confirmar cantidad" para continuar.`,
    { codigo: 'confirmar_cantidad', cantidad: Number(cantidad), unidad });
}

function motivoObligatorio(valor, que) {
  const m = cleanText(valor, { field: 'motivo', max: 300 });
  if (!m) throw new ApiError(400, `Indica ${que}.`);
  return m;
}

async function registrarMovimientoManual(client, { materiaId, tipo, cantidad, usuarioId, motivo }) {
  if (!['existencia_inicial', 'correccion_captura'].includes(tipo)) throw new Error('tipo inválido');
  await client.query(
    `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, usuario_id, motivo)
     VALUES ($1,$2::tipo_movimiento,$3,$4,$5)`, [materiaId, tipo, cantidad, usuarioId, motivo]);
}

module.exports = { UMBRAL_GRANDE, esCantidadGrande, exigirConfirmacion, motivoObligatorio, registrarMovimientoManual };
