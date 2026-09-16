const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const { cleanText, parseNumber } = require('../utils/catalogValidation');
const A = require('../services/accounting');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// ---- Consolidado (solo administrador general): todas las sedes sumadas ----
router.get('/consolidado/estado-resultados', asyncHandler(async (req, res) => {
  if (req.auth.sucursalId) throw new ApiError(403, 'El consolidado es solo para el administrador general.');
  const periodo = A.validarPeriodo(req.query.periodo);
  const { rows: sedes } = await query('SELECT id, nombre FROM sucursales WHERE activo ORDER BY nombre');
  const porSede = [];
  for (const s of sedes) porSede.push({ sucursalId: s.id, sucursal: s.nombre, ...(await A.estadoResultados(query, s.id, periodo)) });
  const suma = fn => A.round2(porSede.reduce((acc, x) => acc + Number(fn(x) || 0), 0));
  res.json({
    periodo, nombre: porSede[0] ? porSede[0].nombre : A.rangoPeriodo(periodo).nombre, sedes: porSede,
    ventas: suma(x => x.ventas.total), costoVentas: suma(x => x.costoVentas.total), utilidadBruta: suma(x => x.utilidadBruta),
    gastosOperacion: suma(x => x.gastosOperacion), utilidadOperacion: suma(x => x.utilidadOperacion),
    gastosFinancieros: suma(x => x.gastosFinancieros), impuestos: suma(x => x.impuestos), utilidadNeta: suma(x => x.utilidadNeta),
    mayordomia: { diezmo: suma(x => x.mayordomia.diezmo), ofrenda: suma(x => x.mayordomia.ofrenda), diezmoEntregado: suma(x => x.mayordomia.diezmoEntregado), ofrendaEntregada: suma(x => x.mayordomia.ofrendaEntregada) },
  });
}));

router.use(resolveSucursal);

// ---- Configuración de mayordomía --------------------------------------------
router.get('/config', asyncHandler(async (req, res) => res.json(await A.leerConfigContabilidad(query, req.sucursalId))));
router.put('/config', asyncHandler(async (req, res) => {
  const guardar = async (clave, valor) => query(
    `INSERT INTO configuracion (sucursal_id, clave, valor, actualizado_en) VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (sucursal_id, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [req.sucursalId, clave, JSON.stringify(valor)]);
  if ('diezmoPorcentaje' in req.body) await guardar(A.CLAVE_DIEZMO, A.validarPorcentaje(req.body.diezmoPorcentaje, 'Diezmo'));
  if ('ofrendaPorcentaje' in req.body) await guardar(A.CLAVE_OFRENDA, A.validarPorcentaje(req.body.ofrendaPorcentaje, 'Ofrenda'));
  if ('contabilidadInicio' in req.body) await guardar(A.CLAVE_INICIO, A.validarFecha(req.body.contabilidadInicio, 'fecha de inicio'));
  res.json(await A.leerConfigContabilidad(query, req.sucursalId));
}));

// ---- Catálogo de cuentas ----------------------------------------------------
router.get('/cuentas', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, fn_grupo_afecta_utilidad(c.grupo) AS afecta_utilidad,
            (SELECT COUNT(*) FROM egresos e WHERE e.cuenta_contable_id = c.id AND NOT e.anulado) AS movimientos,
            (SELECT COALESCE(SUM(g.monto_mensual),0) FROM gastos_fijos g WHERE g.cuenta_contable_id = c.id AND g.activo) AS gasto_fijo_mes
     FROM cuentas_contables c WHERE c.sucursal_id = $1 ORDER BY c.orden, c.nombre`, [req.sucursalId]);
  res.json(rows);
}));
router.post('/cuentas', asyncHandler(async (req, res) => {
  const nombre = cleanText(req.body.nombre === undefined ? '' : req.body.nombre, { required: true, field: 'el nombre de la cuenta', max: 80 });
  if (!A.GRUPOS.includes(req.body.grupo)) throw new ApiError(400, 'Elige el grupo de la cuenta.');
  const { rows: [max] } = await query('SELECT COALESCE(MAX(orden),0) AS m FROM cuentas_contables WHERE sucursal_id = $1 AND grupo = $2', [req.sucursalId, req.body.grupo]);
  try {
    // entra_al_costo: si no se indica, el trigger de la base pone lo sensato
    // según el grupo (los gastos de operación sí; el resto no).
    const { rows } = await query(
      'INSERT INTO cuentas_contables (sucursal_id, nombre, grupo, orden, entra_al_costo) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.sucursalId, nombre, req.body.grupo, Number(max.m) + 1,
        req.body.entraAlCosto === undefined ? null : !!req.body.entraAlCosto]);
    res.status(201).json(rows[0]);
  } catch (e) { if (e.code === '23505') throw new ApiError(409, 'Ya existe una cuenta con ese nombre.'); throw e; }
}));
router.patch('/cuentas/:id', asyncHandler(async (req, res) => {
  const sets = []; const values = []; let i = 1;
  if (req.body.nombre !== undefined) { sets.push(`nombre = $${i++}`); values.push(cleanText(req.body.nombre, { required: true, field: 'el nombre de la cuenta', max: 80 })); }
  if (req.body.activo !== undefined) { sets.push(`activo = $${i++}`); values.push(!!req.body.activo); }
  // ¿Los gastos de esta cuenta son costo del producto? (migración 34) Mueve el
  // piso de los precios, nunca la utilidad ni el diezmo.
  if (req.body.entraAlCosto !== undefined) { sets.push(`entra_al_costo = $${i++}`); values.push(!!req.body.entraAlCosto); }
  if (!sets.length) throw new ApiError(400, 'No se envió ningún campo para actualizar.');
  values.push(Number(req.params.id), req.sucursalId);
  try {
    const { rows } = await query(`UPDATE cuentas_contables SET ${sets.join(', ')} WHERE id = $${i} AND sucursal_id = $${i + 1} RETURNING *`, values);
    if (!rows.length) throw new ApiError(404, 'Cuenta no encontrada.');
    res.json(rows[0]);
  } catch (e) { if (e.code === '23505') throw new ApiError(409, 'Ya existe una cuenta con ese nombre.'); throw e; }
}));
router.delete('/cuentas/:id', asyncHandler(async (req, res) => {
  const { rows: [c] } = await query('SELECT * FROM cuentas_contables WHERE id = $1 AND sucursal_id = $2', [Number(req.params.id), req.sucursalId]);
  if (!c) throw new ApiError(404, 'Cuenta no encontrada.');
  if (c.clave) throw new ApiError(400, 'Las cuentas del sistema no se borran; puedes desactivarla.');
  const { rows: [uso] } = await query('SELECT (SELECT COUNT(*) FROM egresos WHERE cuenta_contable_id = $1) + (SELECT COUNT(*) FROM gastos_fijos WHERE cuenta_contable_id = $1) AS n', [c.id]);
  if (Number(uso.n) > 0) throw new ApiError(409, 'Esta cuenta ya tiene movimientos o gastos fijos ligados; desactívala en lugar de borrarla.');
  await query('DELETE FROM cuentas_contables WHERE id = $1', [c.id]);
  res.json({ id: c.id, eliminada: true });
}));

// ---- Cuentas de dinero ------------------------------------------------------------
router.get('/cuentas-dinero', asyncHandler(async (req, res) => res.json(await A.saldosActuales(query, req.sucursalId))));
router.patch('/cuentas-dinero/:id', asyncHandler(async (req, res) => {
  const sets = []; const values = []; let i = 1;
  if (req.body.nombre !== undefined) { sets.push(`nombre = $${i++}`); values.push(cleanText(req.body.nombre, { required: true, field: 'el nombre', max: 60 })); }
  if (req.body.saldoInicial !== undefined) { sets.push(`saldo_inicial = $${i++}`); values.push(A.round2(parseNumber(req.body.saldoInicial, 'saldo inicial', { required: true }))); }
  if (req.body.fechaSaldoInicial !== undefined) { sets.push(`fecha_saldo_inicial = $${i++}`); values.push(req.body.fechaSaldoInicial ? A.validarFecha(req.body.fechaSaldoInicial, 'fecha del saldo inicial') : null); }
  if (!sets.length) throw new ApiError(400, 'No se envió ningún campo para actualizar.');
  values.push(Number(req.params.id), req.sucursalId);
  const { rows } = await query(`UPDATE cuentas_dinero SET ${sets.join(', ')} WHERE id = $${i} AND sucursal_id = $${i + 1} RETURNING *`, values);
  if (!rows.length) throw new ApiError(404, 'Cuenta de dinero no encontrada.');
  res.json(rows[0]);
}));

// ---- Egresos ---------------------------------------------------------------------
router.get('/egresos', asyncHandler(async (req, res) => {
  res.json(await A.listarEgresos(query, req.sucursalId, { periodo: req.query.periodo, pendientes: req.query.pendientes === 'true', cuentaId: req.query.cuenta, incluirAnulados: req.query.anulados === 'true' }));
}));
router.post('/egresos', asyncHandler(async (req, res) => {
  const egreso = await withTransaction(c => A.crearEgreso(c, { sucursalId: req.sucursalId, usuarioId: req.auth.id, ...req.body }));
  res.status(201).json(await A.obtenerEgreso(query, req.sucursalId, egreso.id));
}));
router.patch('/egresos/:id', asyncHandler(async (req, res) => {
  const out = await withTransaction(async c => {
    const q = c.query.bind(c);
    const actual = await A.obtenerEgreso(q, req.sucursalId, req.params.id);
    if (actual.anulado) throw new ApiError(409, 'Un egreso anulado no se edita.');
    await A.exigirMesAbierto(q, req.sucursalId, actual.fecha);
    const sets = []; const values = []; let i = 1;
    const add = (col, v) => { sets.push(`${col} = $${i++}`); values.push(v); };
    if (req.body.fecha !== undefined) { const f = A.validarFecha(req.body.fecha); await A.exigirMesAbierto(q, req.sucursalId, f); add('fecha', f); }
    if (req.body.cuentaContableId !== undefined) add('cuenta_contable_id', (await A.validarCuentaContable(q, req.sucursalId, req.body.cuentaContableId)).id);
    if (req.body.concepto !== undefined) add('concepto', cleanText(req.body.concepto, { required: true, field: 'el concepto', max: 160 }));
    if (req.body.monto !== undefined) { const m = parseNumber(req.body.monto, 'monto', { required: true, min: 0 }); if (!(m > 0)) throw new ApiError(400, 'El monto debe ser mayor a cero.'); add('monto', A.round2(m)); }
    if (req.body.cuentaDineroId !== undefined) { const cd = await A.validarCuentaDinero(q, req.sucursalId, req.body.cuentaDineroId); add('cuenta_dinero_id', cd ? cd.id : null); }
    if (req.body.proveedorId !== undefined) {
      if (req.body.proveedorId) { const { rows } = await q('SELECT id FROM proveedores WHERE id = $1 AND sucursal_id = $2', [req.body.proveedorId, req.sucursalId]); if (!rows.length) throw new ApiError(400, 'El proveedor no pertenece a esta sucursal.'); }
      add('proveedor_id', req.body.proveedorId || null);
    }
    if (req.body.periodo !== undefined) add('periodo', req.body.periodo ? A.validarPeriodo(req.body.periodo) : null);
    if (req.body.referencia !== undefined) add('referencia', cleanText(req.body.referencia, { field: 'referencia', max: 80 }));
    if (req.body.nota !== undefined) add('nota', cleanText(req.body.nota, { field: 'nota', max: 300 }));
    if (req.body.pagado !== undefined) {
      const pagado = !!req.body.pagado;
      add('pagado', pagado);
      if (pagado) { const fp = A.validarFecha(req.body.pagadoEn || actual.pagado_en || A.hoyMx(), 'fecha de pago'); await A.exigirMesAbierto(q, req.sucursalId, fp); add('pagado_en', fp); }
      else { add('pagado_en', null); add('cuenta_dinero_id', null); }
    } else if (req.body.pagadoEn !== undefined && actual.pagado) {
      const fp = A.validarFecha(req.body.pagadoEn, 'fecha de pago'); await A.exigirMesAbierto(q, req.sucursalId, fp); add('pagado_en', fp);
    }
    if (!sets.length) throw new ApiError(400, 'No se envió ningún campo para actualizar.');
    values.push(req.params.id, req.sucursalId);
    await q(`UPDATE egresos SET ${sets.join(', ')} WHERE id = $${i} AND sucursal_id = $${i + 1}`, values);
    return A.obtenerEgreso(q, req.sucursalId, req.params.id);
  });
  res.json(out);
}));
router.post('/egresos/:id/anular', asyncHandler(async (req, res) => {
  const out = await withTransaction(async c => {
    const q = c.query.bind(c);
    const actual = await A.obtenerEgreso(q, req.sucursalId, req.params.id);
    if (actual.anulado) throw new ApiError(409, 'Este egreso ya estaba anulado.');
    await A.exigirMesAbierto(q, req.sucursalId, actual.fecha);
    if (actual.pagado_en) await A.exigirMesAbierto(q, req.sucursalId, actual.pagado_en);
    const motivo = cleanText(req.body.motivo, { field: 'motivo', max: 200 });
    await q('UPDATE egresos SET anulado = true, anulado_en = now(), anulado_por = $2, motivo_anulacion = $3 WHERE id = $1', [actual.id, req.auth.id, motivo]);
    await q(`INSERT INTO auditoria (entidad, entidad_id, accion, valor_anterior, motivo, usuario_id, sucursal_id) VALUES ('egresos', $1, 'anular', $2::jsonb, $3, $4, $5)`,
      [actual.id, JSON.stringify({ concepto: actual.concepto, monto: actual.monto, fecha: actual.fecha, cuenta: actual.cuenta_nombre }), motivo, req.auth.id, req.sucursalId]);
    return A.obtenerEgreso(q, req.sucursalId, actual.id);
  });
  res.json(out);
}));

// ---- Gastos fijos recurrentes: propuesta mensual y confirmación ------------------
router.get('/recurrentes', asyncHandler(async (req, res) => {
  const periodo = A.validarPeriodo(req.query.periodo);
  const { rows } = await query(
    `SELECT g.id, g.concepto, g.categoria, g.monto_mensual, g.dia_pago, g.cuenta_contable_id, c.nombre AS cuenta_nombre, g.cuenta_dinero_id, d.nombre AS cuenta_dinero_nombre,
            e.id AS egreso_id, e.monto AS egreso_monto, e.fecha AS egreso_fecha, e.pagado AS egreso_pagado
     FROM gastos_fijos g
     LEFT JOIN cuentas_contables c ON c.id = g.cuenta_contable_id
     LEFT JOIN cuentas_dinero d ON d.id = g.cuenta_dinero_id
     LEFT JOIN egresos e ON e.gasto_fijo_id = g.id AND e.periodo = $2 AND NOT e.anulado
     WHERE g.sucursal_id = $1 AND g.activo ORDER BY g.dia_pago, g.concepto`, [req.sucursalId, periodo]);
  res.json(rows.map(r => ({ ...A.normalizarFechas(r), registrado: !!r.egreso_id })));
}));
router.post('/recurrentes/:id/registrar', asyncHandler(async (req, res) => {
  const periodo = A.validarPeriodo(req.body.periodo);
  const out = await withTransaction(async c => {
    const q = c.query.bind(c);
    const { rows: [g] } = await q('SELECT * FROM gastos_fijos WHERE id = $1 AND sucursal_id = $2', [req.params.id, req.sucursalId]);
    if (!g) throw new ApiError(404, 'Gasto fijo no encontrado.');
    const { rows: ya } = await q('SELECT id FROM egresos WHERE gasto_fijo_id = $1 AND periodo = $2 AND NOT anulado', [g.id, periodo]);
    if (ya.length) throw new ApiError(409, `"${g.concepto}" ya está registrado en ${A.rangoPeriodo(periodo).nombre}.`);
    const cuentaContableId = g.cuenta_contable_id || (await A.cuentaPorClave(q, req.sucursalId, 'otros_gastos')).id;
    const r = A.rangoPeriodo(periodo);
    const fechaDefault = `${periodo}-${String(Math.min(g.dia_pago || 1, Number(r.hasta.slice(8)))).padStart(2, '0')}`;
    const egreso = await A.crearEgreso(c, {
      sucursalId: req.sucursalId, usuarioId: req.auth.id,
      fecha: req.body.fecha || fechaDefault, cuentaContableId,
      concepto: `${g.concepto} · ${r.nombre}`,
      monto: req.body.monto !== undefined && req.body.monto !== '' ? req.body.monto : g.monto_mensual,
      cuentaDineroId: req.body.cuentaDineroId !== undefined ? req.body.cuentaDineroId : g.cuenta_dinero_id,
      pagado: req.body.pagado === undefined ? true : !!req.body.pagado, pagadoEn: req.body.pagadoEn,
      periodo, gastoFijoId: g.id, referencia: req.body.referencia, nota: req.body.nota,
    });
    return A.obtenerEgreso(q, req.sucursalId, egreso.id);
  });
  res.status(201).json(out);
}));

// ---- Traspasos entre cuentas de dinero ---------------------------------------------
router.get('/traspasos', asyncHandler(async (req, res) => {
  const r = A.rangoPeriodo(A.validarPeriodo(req.query.periodo));
  const { rows } = await query(
    `SELECT t.*, de.nombre AS de_nombre, a.nombre AS a_nombre, u.nombre AS usuario_nombre FROM traspasos_dinero t
     JOIN cuentas_dinero de ON de.id = t.de_cuenta_id JOIN cuentas_dinero a ON a.id = t.a_cuenta_id LEFT JOIN usuarios u ON u.id = t.usuario_id
     WHERE t.sucursal_id = $1 AND NOT t.anulado AND t.fecha BETWEEN $2 AND $3 ORDER BY t.fecha DESC, t.creado_en DESC`, [req.sucursalId, r.desde, r.hasta]);
  res.json(rows.map(x => A.normalizarFechas(x)));
}));
router.post('/traspasos', asyncHandler(async (req, res) => {
  const out = await withTransaction(async c => {
    const q = c.query.bind(c);
    const fecha = A.validarFecha(req.body.fecha || A.hoyMx());
    await A.exigirMesAbierto(q, req.sucursalId, fecha);
    const de = await A.validarCuentaDinero(q, req.sucursalId, req.body.deCuentaId, { requerida: true });
    const a = await A.validarCuentaDinero(q, req.sucursalId, req.body.aCuentaId, { requerida: true });
    if (de.id === a.id) throw new ApiError(400, 'Elige dos cuentas distintas.');
    const monto = parseNumber(req.body.monto, 'monto', { required: true, min: 0 });
    if (!(monto > 0)) throw new ApiError(400, 'El monto debe ser mayor a cero.');
    const { rows: [t] } = await q('INSERT INTO traspasos_dinero (sucursal_id, fecha, de_cuenta_id, a_cuenta_id, monto, nota, usuario_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.sucursalId, fecha, de.id, a.id, A.round2(monto), cleanText(req.body.nota, { field: 'nota', max: 200 }), req.auth.id]);
    return { ...A.normalizarFechas(t), de_nombre: de.nombre, a_nombre: a.nombre };
  });
  res.status(201).json(out);
}));
router.post('/traspasos/:id/anular', asyncHandler(async (req, res) => {
  const out = await withTransaction(async c => {
    const q = c.query.bind(c);
    const { rows: [t] } = await q('SELECT * FROM traspasos_dinero WHERE id = $1 AND sucursal_id = $2', [req.params.id, req.sucursalId]);
    if (!t) throw new ApiError(404, 'Traspaso no encontrado.');
    if (t.anulado) throw new ApiError(409, 'Este traspaso ya estaba anulado.');
    await A.exigirMesAbierto(q, req.sucursalId, t.fecha);
    const { rows: [r] } = await q('UPDATE traspasos_dinero SET anulado = true, anulado_en = now(), anulado_por = $2 WHERE id = $1 RETURNING *', [t.id, req.auth.id]);
    return r;
  });
  res.json(out);
}));

// ---- Estado de resultados, flujo, mayordomía --------------------------------------
router.get('/estado-resultados', asyncHandler(async (req, res) => res.json(await A.estadoResultados(query, req.sucursalId, req.query.periodo))));
router.get('/flujo', asyncHandler(async (req, res) => res.json(await A.flujoDinero(query, req.sucursalId, req.query.periodo))));
router.get('/mayordomia', asyncHandler(async (req, res) => res.json(await A.mayordomiaAnual(query, req.sucursalId, req.query.anio || A.hoyMx().slice(0, 4)))));

// ---- Cierre de mes ----------------------------------------------------------------
router.get('/cierres', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT c.id, c.periodo, c.cerrado_en, u.nombre AS cerrado_por_nombre FROM cierres_mes c LEFT JOIN usuarios u ON u.id = c.cerrado_por WHERE c.sucursal_id = $1 ORDER BY c.periodo DESC', [req.sucursalId]);
  res.json(rows);
}));
router.post('/cierres', asyncHandler(async (req, res) => {
  const periodo = A.validarPeriodo(req.body.periodo);
  if (periodo > A.hoyMx().slice(0, 7)) throw new ApiError(400, 'No se puede cerrar un mes futuro.');
  const out = await withTransaction(async c => {
    const q = c.query.bind(c);
    if (await A.mesCerrado(q, req.sucursalId, periodo)) throw new ApiError(409, 'Ese mes ya está cerrado.');
    const estado = await A.estadoResultados(q, req.sucursalId, periodo);
    const flujo = await A.flujoDinero(q, req.sucursalId, periodo);
    const { rows: [cierre] } = await q('INSERT INTO cierres_mes (sucursal_id, periodo, cerrado_por, resumen) VALUES ($1,$2,$3,$4::jsonb) RETURNING *',
      [req.sucursalId, periodo, req.auth.id, JSON.stringify({ estado, flujo })]);
    await q(`INSERT INTO auditoria (entidad, entidad_id, accion, valor_nuevo, usuario_id, sucursal_id) VALUES ('cierres_mes', $1, 'cerrar', $2::jsonb, $3, $4)`,
      [cierre.id, JSON.stringify({ periodo, utilidadNeta: estado.utilidadNeta, diezmo: estado.mayordomia.diezmo }), req.auth.id, req.sucursalId]);
    return cierre;
  });
  res.status(201).json(out);
}));
router.delete('/cierres/:periodo', asyncHandler(async (req, res) => {
  const periodo = A.validarPeriodo(req.params.periodo);
  const motivo = cleanText(req.body.motivo === undefined ? '' : req.body.motivo, { required: true, field: 'el motivo de la reapertura', max: 200 });
  const out = await withTransaction(async c => {
    const q = c.query.bind(c);
    const { rows: [cierre] } = await q('DELETE FROM cierres_mes WHERE sucursal_id = $1 AND periodo = $2 RETURNING *', [req.sucursalId, periodo]);
    if (!cierre) throw new ApiError(404, 'Ese mes no estaba cerrado.');
    await q(`INSERT INTO auditoria (entidad, entidad_id, accion, valor_anterior, motivo, usuario_id, sucursal_id) VALUES ('cierres_mes', $1, 'reabrir', $2::jsonb, $3, $4, $5)`,
      [cierre.id, JSON.stringify(cierre.resumen.estado ? { utilidadNeta: cierre.resumen.estado.utilidadNeta, diezmo: cierre.resumen.estado.mayordomia.diezmo } : {}), motivo, req.auth.id, req.sucursalId]);
    return { periodo, reabierto: true };
  });
  res.json(out);
}));

module.exports = router;
