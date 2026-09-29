const { createHash } = require('node:crypto');
const { ApiError } = require('../utils/asyncHandler');
const { cleanText } = require('../utils/catalogValidation');
const { moneyAmount } = require('./cashDrawer');
const A = require('./accounting');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round = A.round2;

async function closingPreview(q, sucursalId, id) {
  if (!UUID.test(id || '')) throw new ApiError(400, 'Selecciona un turno válido.');
  const { rows: [turno] } = await q(`SELECT t.*, u.nombre AS abierto_por_nombre
    FROM turnos t LEFT JOIN usuarios u ON u.id=t.abierto_por WHERE t.id=$1 AND t.sucursal_id=$2`, [id, sucursalId]);
  if (!turno) throw new ApiError(404, 'Turno no encontrado en esta sucursal.');
  if (turno.corte) return { turno, ...turno.corte, guardado: true };
  const { rows: pagos } = await q(`SELECT id,folio,total,metodo_pago,importe_efectivo
    FROM pedidos WHERE turno_cobro_id=$1 AND sucursal_id=$2 AND cobrado AND NOT cancelado AND NOT no_show ORDER BY id`, [id, sucursalId]);
  const { rows: egresos } = await q(`SELECT e.id,e.folio,e.concepto,e.monto,e.referencia,e.nota,e.tiene_comprobante,
    e.pagado,e.pagado_en,e.anulado,e.actualizado_en,d.clave AS cuenta_dinero_clave,
    p.nombre AS proveedor_nombre,u.nombre AS usuario_nombre
    FROM egresos e LEFT JOIN cuentas_dinero d ON d.id=e.cuenta_dinero_id
    LEFT JOIN proveedores p ON p.id=e.proveedor_id LEFT JOIN usuarios u ON u.id=e.usuario_id
    WHERE e.turno_id=$1 AND e.sucursal_id=$2 ORDER BY e.creado_en,e.id`, [id, sucursalId]);
  const notas = egresos.map(e => A.normalizarFechas(e));
  const sum = (rows, fn) => round(rows.reduce((n, x) => n + Number(fn(x) || 0), 0));
  const vigentes = notas.filter(e => !e.anulado);
  const efectivo = sum(pagos, p => p.importe_efectivo);
  const salidas = sum(vigentes.filter(e => e.pagado && e.cuenta_dinero_clave === 'caja'), e => e.monto);
  const sinDesglose = pagos.filter(p => p.importe_efectivo === null).length;
  const resumen = {
    fondo: turno.fondo_inicial === null ? null : Number(turno.fondo_inicial),
    ventas: sum(pagos, p => p.total), efectivo,
    transferencias: sum(pagos.filter(p => p.metodo_pago === 'transferencia'), p => p.total),
    tarjeta: sum(pagos.filter(p => p.metodo_pago === 'tarjeta'), p => p.total),
    mixtoBanco: sum(pagos.filter(p => p.metodo_pago === 'mixto' && p.importe_efectivo !== null), p => Number(p.total) - Number(p.importe_efectivo)),
    sinDesglose, salidas,
    notasPendientesPago: sum(vigentes.filter(e => !e.pagado), e => e.monto),
    esperado: turno.fondo_inicial === null || sinDesglose ? null : round(Number(turno.fondo_inicial) + efectivo - salidas),
  };
  // Impide confirmar un corte que cambió mientras se contaba o revisaba.
  const revision = createHash('sha256').update(JSON.stringify({ fondo: turno.fondo_inicial, cerrado: turno.cerrado_en, pagos, notas })).digest('hex');
  return { turno, resumen, notas, revision, guardado: false };
}

function closingAmounts(resumen, body) {
  const entregado = moneyAmount(body.efectivoEntregado, 'Efectivo entregado');
  const fondoRetenido = moneyAmount(body.fondoRetenido, 'Fondo que queda en caja');
  const transferencias = moneyAmount(body.transferenciasVerificadas, 'Transferencias verificadas');
  const tarjeta = moneyAmount(body.tarjetaVerificada, 'Tarjeta verificada');
  const contado = round(entregado + fondoRetenido);
  const bancoEsperado = round(resumen.transferencias + resumen.tarjeta + resumen.mixtoBanco);
  return { entregado, fondoRetenido, contado, transferencias, tarjeta, bancoEsperado,
    diferenciaEfectivo: resumen.esperado === null ? null : round(contado - resumen.esperado),
    diferenciaTransferencias: resumen.sinDesglose || resumen.mixtoBanco ? null : round(transferencias - resumen.transferencias),
    diferenciaTarjeta: resumen.sinDesglose || resumen.mixtoBanco ? null : round(tarjeta - resumen.tarjeta),
    diferenciaBanco: resumen.sinDesglose ? null : round(transferencias + tarjeta - bancoEsperado) };
}

async function saveClosing(c, { sucursalId, usuarioId, nombreUsuario, id, body }) {
  if (!UUID.test(id || '') || !UUID.test(body.solicitudId || '')) throw new ApiError(400, 'Falta el identificador del corte. Actualiza la pantalla.');
  const q = c.query.bind(c);
  const { rows: [t] } = await q('SELECT id,corte,folio_corte FROM turnos WHERE id=$1 AND sucursal_id=$2 FOR UPDATE', [id, sucursalId]);
  if (!t) throw new ApiError(404, 'Turno no encontrado en esta sucursal.');
  const signature = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if (t.corte) {
    if (t.corte.solicitudId === body.solicitudId && t.corte.signature === signature && t.corte.registradoPorId === usuarioId) return { turno: t, ...t.corte, guardado: true };
    throw new ApiError(409, 'Este turno ya tiene un corte guardado. Consulta el historial.');
  }
  const preview = await closingPreview(q, sucursalId, id);
  if (body.revision !== preview.revision) throw new ApiError(409, 'Los movimientos cambiaron. Actualiza y revisa el corte antes de confirmar.');
  const recibe = cleanText(body.recibe, { required: true, field: 'quién recibe el corte', max: 100 });
  const entrega = cleanText(body.entrega, { required: true, field: 'quién entrega el corte', max: 100 });
  const observaciones = cleanText(body.observaciones, { field: 'observaciones', max: 1000 }) || '';
  const importes = closingAmounts(preview.resumen, body);
  const revisadas = new Set(Array.isArray(body.notasRevisadas) ? body.notasRevisadas : []);
  const vigentes = preview.notas.filter(n => !n.anulado);
  if ([...revisadas].some(id => !vigentes.some(n => n.id === id))) throw new ApiError(400, 'La revisión incluye notas ajenas a este corte.');
  const pendientes = vigentes.filter(n => !revisadas.has(n.id));
  const hayDiferencia = importes.diferenciaEfectivo !== 0 || importes.diferenciaBanco !== 0 ||
    (importes.diferenciaTransferencias !== null && importes.diferenciaTransferencias !== 0) ||
    (importes.diferenciaTarjeta !== null && importes.diferenciaTarjeta !== 0);
  if ((hayDiferencia || pendientes.length) && !observaciones) throw new ApiError(400, 'Explica la diferencia, el desglose pendiente o las notas que faltan revisar.');
  const corte = { resumen: preview.resumen, notas: preview.notas, importes, recibe, entrega, observaciones,
    notasRevisadas: [...revisadas], pendientesRevision: pendientes.length,
    registradoPorId: usuarioId, registradoPor: nombreUsuario, registradoEn: new Date().toISOString(),
    solicitudId: body.solicitudId, signature, folio: t.folio_corte };
  const { rows: [turno] } = await q(`UPDATE turnos SET corte=$3::jsonb,cerrado_en=COALESCE(cerrado_en,now()),
    cerrado_por=COALESCE(cerrado_por,$4) WHERE id=$1 AND sucursal_id=$2 RETURNING *`, [id, sucursalId, JSON.stringify(corte), usuarioId]);
  await q(`INSERT INTO auditoria(entidad,entidad_id,accion,valor_nuevo,usuario_id,sucursal_id)
    VALUES('turnos',$1,'corte',$2::jsonb,$3,$4)`, [id, JSON.stringify(corte), usuarioId, sucursalId]);
  return { turno, ...corte, guardado: true };
}

module.exports = { closingPreview, closingAmounts, saveClosing };
