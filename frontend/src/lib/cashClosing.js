import { money } from './helpers.js';

export const closingFields = [
  ['efectivoEntregado', 'Efectivo que recibiste'],
  ['fondoRetenido', 'Fondo que queda en caja'],
  ['transferenciasVerificadas', 'Transferencias verificadas en banco'],
  ['tarjetaVerificada', 'Cobros verificados en terminal'],
];
const round = value => Math.round(value * 100) / 100;
const amount = value => ['string', 'number'].includes(typeof value) && String(value).trim() !== '' &&
  Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 99999999.99 ? round(Number(value)) : null;

// Las mismas diferencias que valida el servidor, visibles antes de confirmar.
export function reviewClosing(data, form, revisadas) {
  const r = data.resumen, errors = [], reasons = [];
  const values = Object.fromEntries(closingFields.map(([key, label]) => {
    const value = amount(form[key]);
    if (value === null) errors.push({ field: key, message: `${label}: escribe un importe válido. Si no hubo movimiento, escribe 0.` });
    return [key, value];
  }));
  for (const [field, label] of [['entrega', 'quién entrega'], ['recibe', 'quién recibe']]) {
    if (!form[field]?.trim()) errors.push({ field, message: `Escribe ${label} el corte.` });
  }
  const cash = values.efectivoEntregado !== null && values.fondoRetenido !== null && r.esperado !== null
    ? round(values.efectivoEntregado + values.fondoRetenido - r.esperado) : null;
  const bankReady = values.transferenciasVerificadas !== null && values.tarjetaVerificada !== null && !r.sinDesglose;
  const bank = bankReady ? round(values.transferenciasVerificadas + values.tarjetaVerificada - r.transferencias - r.tarjeta - r.mixtoBanco) : null;
  const transfers = bankReady && !r.mixtoBanco ? round(values.transferenciasVerificadas - r.transferencias) : null;
  const card = bankReady && !r.mixtoBanco ? round(values.tarjetaVerificada - r.tarjeta) : null;
  const difference = (label, value) => { if (value !== null && value !== 0) reasons.push(`${label}: ${value > 0 ? 'sobran' : 'faltan'} ${money(Math.abs(value))}.`); };
  difference('Efectivo', cash);
  if (r.mixtoBanco) difference('Banco', bank);
  else { difference('Transferencias', transfers); difference('Tarjeta', card); }
  if (r.esperado === null || r.sinDesglose) reasons.push('Hay importes por aclarar por falta de fondo inicial o desglose de pagos.');
  const pending = data.notas.filter(n => !n.anulado && !revisadas.includes(n.id)).length;
  if (pending) reasons.push(`${pending} nota(s) pendiente(s) de revisar.`);
  if (reasons.length && !form.observaciones?.trim()) errors.push({ field: 'observaciones', message: 'Escribe en Observaciones la explicación de las diferencias o los pendientes indicados arriba.' });
  return { cash, bank, transfers, card, reasons, errors };
}
