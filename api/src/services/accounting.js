// CONTABILIDAD DEL NEGOCIO Y MAYORDOMÍA (migración 32).
//
// Lo que ENTRA ya lo mide el sistema (ventas cobradas); lo que CUESTA producir
// también (consumo real PEPS, mermas). Aquí se registra lo que SALE de dinero
// (egresos) y se arma, por mes y por sede, el estado de resultados:
//   Ventas − Costo de ventas = Utilidad bruta
//   − Gastos de operación = Utilidad de operación
//   − Gastos financieros − Impuestos = Utilidad NETA  ← base del diezmo
// Sobre la utilidad neta se calcula el diezmo (10 %) y la ofrenda (5 %) — los
// porcentajes se configuran por sede — y se compara con lo entregado.
// La compra de insumos NO es gasto: sale del dinero y entra al inventario; el
// gasto se reconoce cuando el insumo se consume (o se merma). Inversiones en
// equipo, retiros del dueño y el diezmo entregado tampoco bajan la utilidad.
const { ApiError } = require('../utils/asyncHandler');
const { cleanText, parseNumber } = require('../utils/catalogValidation');

const TZ = 'America/Mexico_City';
const GRUPOS = ['costo_ventas', 'gasto_operacion', 'gasto_financiero', 'impuesto', 'inventario', 'inversion', 'retiro', 'diezmo_ofrenda'];
const GRUPO_LABELS = {
  costo_ventas: 'Costo de ventas', gasto_operacion: 'Gastos de operación', gasto_financiero: 'Gastos financieros',
  impuesto: 'Impuestos', inventario: 'Compra de insumos (inventario)', inversion: 'Inversiones en equipo',
  retiro: 'Retiros del dueño', diezmo_ofrenda: 'Diezmos y ofrendas',
};
const AFECTA_UTILIDAD = new Set(['costo_ventas', 'gasto_operacion', 'gasto_financiero', 'impuesto']);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Claves de configuración (tabla configuracion) — por sede.
const CLAVE_DIEZMO = 'diezmo_porcentaje';
const CLAVE_OFRENDA = 'ofrenda_porcentaje';
const CLAVE_INICIO = 'contabilidad_inicio';
const DIEZMO_DEFAULT = 10;
const OFRENDA_DEFAULT = 5;

const round2 = n => Math.round(Number(n) * 100) / 100;
const num = v => (v === null || v === undefined ? 0 : Number(v));

function validarPeriodo(p) {
  const s = String(p || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new ApiError(400, 'Indica el mes como AAAA-MM (ej. 2026-09).');
  return s;
}
function rangoPeriodo(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  const desde = `${periodo}-01`;
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde, hasta: `${periodo}-${String(ultimo).padStart(2, '0')}`, anio: a, mes: m, nombre: `${MESES[m - 1]} ${a}` };
}
// node-pg entrega las columnas DATE como Date (medianoche local): normalizar a AAAA-MM-DD.
function fechaISO(v) {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v || '').trim().slice(0, 10);
}
function periodoDe(fecha) { return fechaISO(fecha).slice(0, 7); }
function validarFecha(v, label = 'fecha') {
  const s = fechaISO(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new ApiError(400, `Indica la ${label} como AAAA-MM-DD.`);
  return s;
}
function validarPorcentaje(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ApiError(400, `${label}: indica un porcentaje entre 0 y 100.`);
  return Math.round(n * 100) / 100;
}
function hoyMx() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // AAAA-MM-DD
}

// ---- Configuración de mayordomía ------------------------------------------
async function leerConfigContabilidad(queryFn, sucursalId) {
  const { rows } = await queryFn('SELECT clave, valor FROM configuracion WHERE sucursal_id = $1 AND clave = ANY($2)', [sucursalId, [CLAVE_DIEZMO, CLAVE_OFRENDA, CLAVE_INICIO]]);
  const map = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  const pct = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100 ? Number(v) : d);
  return {
    diezmoPorcentaje: pct(map[CLAVE_DIEZMO], DIEZMO_DEFAULT),
    ofrendaPorcentaje: pct(map[CLAVE_OFRENDA], OFRENDA_DEFAULT),
    contabilidadInicio: typeof map[CLAVE_INICIO] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(map[CLAVE_INICIO]) ? map[CLAVE_INICIO] : null,
  };
}

// ---- Catálogos ---------------------------------------------------------------
async function cuentaPorClave(queryFn, sucursalId, clave) {
  const { rows: [c] } = await queryFn('SELECT * FROM cuentas_contables WHERE sucursal_id = $1 AND clave = $2', [sucursalId, clave]);
  if (!c) throw new ApiError(500, `Falta la cuenta contable "${clave}" en esta sucursal (migración 32).`);
  return c;
}
async function cuentaDineroPorClave(queryFn, sucursalId, clave) {
  const { rows: [c] } = await queryFn('SELECT * FROM cuentas_dinero WHERE sucursal_id = $1 AND clave = $2', [sucursalId, clave]);
  if (!c) throw new ApiError(500, `Falta la cuenta de dinero "${clave}" en esta sucursal (migración 32).`);
  return c;
}
async function validarCuentaContable(queryFn, sucursalId, id) {
  const n = Number(id);
  if (!Number.isInteger(n)) throw new ApiError(400, 'Elige la cuenta contable del egreso.');
  const { rows: [c] } = await queryFn('SELECT * FROM cuentas_contables WHERE id = $1 AND sucursal_id = $2 AND activo', [n, sucursalId]);
  if (!c) throw new ApiError(400, 'La cuenta contable no existe en esta sucursal o está inactiva.');
  return c;
}
async function validarCuentaDinero(queryFn, sucursalId, id, { requerida = false } = {}) {
  if (id === undefined || id === null || id === '') {
    if (requerida) throw new ApiError(400, 'Indica con qué cuenta se pagó (caja o banco).');
    return null;
  }
  const n = Number(id);
  if (!Number.isInteger(n)) throw new ApiError(400, 'Cuenta de dinero inválida.');
  const { rows: [c] } = await queryFn('SELECT * FROM cuentas_dinero WHERE id = $1 AND sucursal_id = $2 AND activo', [n, sucursalId]);
  if (!c) throw new ApiError(400, 'La cuenta de dinero no existe en esta sucursal.');
  return c;
}

// ---- Cierre de mes -----------------------------------------------------------
async function mesCerrado(queryFn, sucursalId, periodo) {
  const { rows } = await queryFn('SELECT 1 FROM cierres_mes WHERE sucursal_id = $1 AND periodo = $2', [sucursalId, periodo]);
  return rows.length > 0;
}
async function exigirMesAbierto(queryFn, sucursalId, fecha) {
  const periodo = periodoDe(fecha);
  if (await mesCerrado(queryFn, sucursalId, periodo)) {
    throw new ApiError(409, `El mes ${rangoPeriodo(periodo).nombre} ya está cerrado. Reábrelo en Contabilidad → Estado de resultados para registrar cambios.`);
  }
}

// ---- Egresos -----------------------------------------------------------------
// Crea un egreso validado. `client` en transacción. Devuelve la fila.
async function crearEgreso(client, { sucursalId, usuarioId, fecha, cuentaContableId, cuentaContable, concepto, monto, cuentaDineroId, pagado, pagadoEn, proveedorId, periodo, gastoFijoId, loteId, turnoId, referencia, nota }) {
  const q = client.query.bind(client);
  const f = validarFecha(fecha || hoyMx());
  await exigirMesAbierto(q, sucursalId, f);
  const cuenta = cuentaContable || await validarCuentaContable(q, sucursalId, cuentaContableId);
  const montoNum = parseNumber(monto, 'monto', { required: true, min: 0 });
  if (!(montoNum > 0)) throw new ApiError(400, 'El monto debe ser mayor a cero.');
  const conceptoLimpio = cleanText(concepto === undefined ? '' : concepto, { required: true, field: 'el concepto', max: 160 });
  const pagadoBool = pagado === undefined ? true : !!pagado;
  const cuentaDinero = await validarCuentaDinero(q, sucursalId, cuentaDineroId, { requerida: false });
  let fechaPago = null;
  if (pagadoBool) {
    fechaPago = validarFecha(pagadoEn || f, 'fecha de pago');
    await exigirMesAbierto(q, sucursalId, fechaPago);
  }
  if (proveedorId) {
    const { rows } = await q('SELECT id FROM proveedores WHERE id = $1 AND sucursal_id = $2', [proveedorId, sucursalId]);
    if (!rows.length) throw new ApiError(400, 'El proveedor no pertenece a esta sucursal.');
  }
  const per = periodo ? validarPeriodo(periodo) : null;
  const { rows: [egreso] } = await q(
    `INSERT INTO egresos (sucursal_id, fecha, cuenta_contable_id, concepto, monto, cuenta_dinero_id, pagado, pagado_en, proveedor_id, periodo,
                          gasto_fijo_id, lote_id, turno_id, referencia, nota, usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [sucursalId, f, cuenta.id, conceptoLimpio, round2(montoNum), cuentaDinero ? cuentaDinero.id : null, pagadoBool, fechaPago, proveedorId || null, per,
      gastoFijoId || null, loteId || null, turnoId || null, cleanText(referencia, { field: 'referencia', max: 80 }) || null, cleanText(nota, { field: 'nota', max: 300 }) || null, usuarioId || null]
  );
  return egreso;
}

const egresoSql = `SELECT e.*, c.nombre AS cuenta_nombre, c.grupo, c.clave AS cuenta_clave, fn_grupo_afecta_utilidad(c.grupo) AS afecta_utilidad,
    d.nombre AS cuenta_dinero_nombre, d.clave AS cuenta_dinero_clave, pr.nombre AS proveedor_nombre, u.nombre AS usuario_nombre,
    g.concepto AS gasto_fijo_concepto, m.nombre AS lote_insumo, m.id AS lote_materia_id,
    fn_convertir_unidad(l.cantidad_comprada, l.unidad, m.unidad) AS lote_cantidad, m.unidad AS lote_unidad,
    pago_usuario.nombre AS pagado_caja_por,
    pago_caja.valor_nuevo->'comprobantePago'->>'referencia' AS pago_caja_referencia,
    pago_caja.valor_nuevo->'comprobantePago'->>'nota' AS pago_caja_nota
  FROM egresos e
  JOIN cuentas_contables c ON c.id = e.cuenta_contable_id
  LEFT JOIN cuentas_dinero d ON d.id = e.cuenta_dinero_id
  LEFT JOIN proveedores pr ON pr.id = e.proveedor_id
  LEFT JOIN usuarios u ON u.id = e.usuario_id
  LEFT JOIN LATERAL (SELECT usuario_id,valor_nuevo FROM auditoria
    WHERE entidad='egresos' AND entidad_id=e.id::text AND accion IN ('pago_caja','gasto_caja')
    ORDER BY creado_en DESC LIMIT 1) pago_caja ON true
  LEFT JOIN usuarios pago_usuario ON pago_usuario.id=pago_caja.usuario_id
  LEFT JOIN gastos_fijos g ON g.id = e.gasto_fijo_id
  LEFT JOIN lotes l ON l.id = e.lote_id LEFT JOIN materias_primas m ON m.id = l.materia_prima_id`;

// Fechas como AAAA-MM-DD en la respuesta (no medianoche UTC).
function normalizarFechas(row, campos = ['fecha', 'pagado_en', 'egreso_fecha']) {
  const out = { ...row };
  for (const k of campos) if (out[k] !== undefined && out[k] !== null) out[k] = fechaISO(out[k]);
  return out;
}

async function listarEgresos(queryFn, sucursalId, { periodo, pagadoPeriodo, pendientes, cuentaId, incluirAnulados } = {}) {
  const cond = ['e.sucursal_id = $1']; const values = [sucursalId];
  if (periodo) { const r = rangoPeriodo(validarPeriodo(periodo)); values.push(r.desde, r.hasta); cond.push(`e.fecha BETWEEN $${values.length - 1} AND $${values.length}`); }
  // Pagados DENTRO del mes (por fecha de pago, como el flujo de dinero), sin
  // importar a qué mes pertenece el gasto: así Caja/Banco cuadran con el flujo.
  if (pagadoPeriodo) { const r = rangoPeriodo(validarPeriodo(pagadoPeriodo)); values.push(r.desde, r.hasta); cond.push(`e.pagado AND e.pagado_en BETWEEN $${values.length - 1} AND $${values.length}`); }
  if (pendientes) cond.push('NOT e.pagado');
  if (cuentaId) { values.push(Number(cuentaId)); cond.push(`e.cuenta_contable_id = $${values.length}`); }
  if (!incluirAnulados) cond.push('NOT e.anulado');
  const { rows } = await queryFn(`${egresoSql} WHERE ${cond.join(' AND ')} ORDER BY e.fecha DESC, e.creado_en DESC LIMIT 1000`, values);
  return rows.map(r => normalizarFechas(r));
}
async function obtenerEgreso(queryFn, sucursalId, id) {
  const { rows: [e] } = await queryFn(`${egresoSql} WHERE e.id = $1 AND e.sucursal_id = $2`, [id, sucursalId]);
  if (!e) throw new ApiError(404, 'Egreso no encontrado.');
  return normalizarFechas(e);
}

// ---- Estado de resultados ---------------------------------------------------
// Valor de un movimiento de inventario: el costo congelado al registrarlo
// (migración 32); si faltara, el del lote o el costo de referencia del insumo.
const costoMovimientoSql = `(-mi.cantidad) * COALESCE(mi.costo_unitario, l.costo_total / NULLIF(fn_convertir_unidad(l.cantidad_comprada, l.unidad, mp.unidad), 0), mp.costo_unitario, 0)`;

async function estadoResultados(queryFn, sucursalId, periodo, cfg) {
  const p = validarPeriodo(periodo);
  const r = rangoPeriodo(p);
  const config = cfg || await leerConfigContabilidad(queryFn, sucursalId);
  const { rows: [v] } = await queryFn(
    `SELECT COALESCE(SUM(p.total),0) AS ventas, COUNT(*) AS pedidos,
            COALESCE(SUM(COALESCE(p.importe_efectivo, CASE WHEN p.metodo_pago = 'efectivo' THEN p.total ELSE 0 END)),0) AS ventas_efectivo,
            COUNT(*) FILTER (WHERE p.metodo_pago = 'mixto' AND p.importe_efectivo IS NULL) AS pagos_sin_desglose,
            COUNT(*) FILTER (WHERE p.cortesia_estado IS NOT NULL) AS cortesias,
            COALESCE(SUM(p.cortesia_valor),0) AS cortesias_valor,
            COALESCE(SUM(p.subtotal - p.cortesia_valor - p.total) FILTER (WHERE NOT p.es_regalo_fidelidad),0) AS descuentos
     FROM pedidos p
     WHERE p.sucursal_id = $1 AND p.cobrado AND NOT p.cancelado AND NOT p.no_show
       AND (p.creado_en AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3`, [sucursalId, r.desde, r.hasta]);
  const { rows: [c] } = await queryFn(
    `SELECT COALESCE(SUM(${costoMovimientoSql}) FILTER (WHERE mi.tipo = 'consumo'),0) AS consumo,
            COALESCE(SUM(${costoMovimientoSql}) FILTER (WHERE mi.tipo = 'consumo' AND mi.pedido_item_id IS NULL AND mi.merma_id IS NULL),0) AS consumo_interno,
            COALESCE(SUM(${costoMovimientoSql}) FILTER (WHERE mi.tipo = 'merma'),0) AS mermas,
            COALESCE(SUM(${costoMovimientoSql}) FILTER (WHERE mi.tipo = 'ajuste'),0) AS ajustes,
            COALESCE(SUM(${costoMovimientoSql}) FILTER (WHERE mi.tipo = 'ajuste' AND mi.pedido_item_id IS NOT NULL),0) AS devoluciones
     FROM movimientos_inventario mi
     JOIN materias_primas mp ON mp.id = mi.materia_prima_id
     LEFT JOIN lotes l ON l.id = mi.lote_id
     WHERE mp.sucursal_id = $1 AND mi.tipo IN ('consumo','merma','ajuste')
       AND (mi.creado_en AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3`, [sucursalId, r.desde, r.hasta]);
  // Ventas cobradas cuyo costo todavía no entra (o nunca entrará) al costo de
  // ventas: el inventario se descuenta cuando la línea pasa a 'terminado'
  // (trigger trg_descontar_inventario). Una línea cobrada que sigue pendiente o
  // en preparación ya suma a ventas pero aún no a costo; una terminada sin
  // consumo valorado (producto sin receta o insumos a $0) nunca sumará costo.
  const { rows: sinCosto } = await queryFn(
    `SELECT CASE WHEN pi.estado IN ('pendiente','en_preparacion') THEN 'sin_terminar' ELSE 'sin_receta' END AS motivo,
            COALESCE(pr.nombre, pi.concepto_libre, 'Producto') AS producto,
            COUNT(DISTINCT p.id) AS pedidos, SUM(pi.cantidad) AS unidades,
            COALESCE(SUM(pi.precio_unitario * pi.cantidad) FILTER (WHERE NOT pi.es_cortesia),0) AS venta,
            MIN((p.creado_en AT TIME ZONE '${TZ}')::date) AS desde
     FROM pedidos p
     JOIN pedido_items pi ON pi.pedido_id = p.id
     LEFT JOIN productos pr ON pr.id = pi.producto_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(${costoMovimientoSql}),0) AS costo
       FROM movimientos_inventario mi JOIN materias_primas mp ON mp.id = mi.materia_prima_id LEFT JOIN lotes l ON l.id = mi.lote_id
       WHERE mi.pedido_item_id = pi.id AND mi.tipo = 'consumo') cst ON true
     WHERE p.sucursal_id = $1 AND p.cobrado AND NOT p.cancelado AND NOT p.no_show
       AND (p.creado_en AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3
       AND (pi.estado IN ('pendiente','en_preparacion') OR (pi.estado = 'terminado' AND cst.costo <= 0))
     GROUP BY 1, 2 ORDER BY 1, venta DESC`, [sucursalId, r.desde, r.hasta]);
  const resumenSinCosto = motivo => {
    const filas = sinCosto.filter(x => x.motivo === motivo);
    return {
      lineas: filas.length,
      unidades: filas.reduce((s, x) => s + Number(x.unidades), 0),
      venta: round2(filas.reduce((s, x) => s + num(x.venta), 0)),
      productos: filas.slice(0, 12).map(x => ({ producto: x.producto, pedidos: Number(x.pedidos), unidades: Number(x.unidades), venta: round2(x.venta), desde: fechaISO(x.desde) })),
    };
  };
  const { rows: cuentas } = await queryFn(
    `SELECT c.id, c.nombre, c.grupo, c.clave, c.orden, COALESCE(SUM(e.monto),0) AS monto, COUNT(e.id) AS movimientos,
            COALESCE(SUM(e.monto) FILTER (WHERE NOT e.pagado),0) AS por_pagar
     FROM cuentas_contables c
     LEFT JOIN egresos e ON e.cuenta_contable_id = c.id AND NOT e.anulado AND e.fecha BETWEEN $2 AND $3
     WHERE c.sucursal_id = $1
     GROUP BY c.id ORDER BY c.orden, c.nombre`, [sucursalId, r.desde, r.hasta]);
  const porGrupo = Object.fromEntries(GRUPOS.map(g => [g, 0]));
  for (const row of cuentas) porGrupo[row.grupo] += num(row.monto);

  const ventas = round2(v.ventas);
  const costoVentas = round2(num(c.consumo) + num(c.mermas) + num(c.ajustes) + porGrupo.costo_ventas);
  const utilidadBruta = round2(ventas - costoVentas);
  const utilidadOperacion = round2(utilidadBruta - porGrupo.gasto_operacion);
  const utilidadNeta = round2(utilidadOperacion - porGrupo.gasto_financiero - porGrupo.impuesto);
  const base = Math.max(utilidadNeta, 0);
  const diezmo = round2(base * config.diezmoPorcentaje / 100);
  const ofrenda = round2(base * config.ofrendaPorcentaje / 100);
  const { rows: [ent] } = await queryFn(
    `SELECT COALESCE(SUM(e.monto) FILTER (WHERE c.clave = 'diezmo'),0) AS diezmo,
            COALESCE(SUM(e.monto) FILTER (WHERE c.clave = 'ofrenda'),0) AS ofrenda
     FROM egresos e JOIN cuentas_contables c ON c.id = e.cuenta_contable_id
     WHERE e.sucursal_id = $1 AND NOT e.anulado AND e.pagado AND e.periodo = $2 AND c.grupo = 'diezmo_ofrenda'`, [sucursalId, p]);
  const cerrado = await mesCerrado(queryFn, sucursalId, p);
  // Valor del inventario HOY (lo que está en el almacén, a su costo): lotes a
  // su costo de compra; insumos sin lotes, al costo de referencia.
  const { rows: [inv] } = await queryFn(
    `SELECT COALESCE(SUM(CASE WHEN m.requiere_lote
              THEN (SELECT COALESCE(SUM(fn_convertir_unidad(l.cantidad_disponible, l.unidad, m.unidad)
                     * COALESCE(l.costo_total / NULLIF(fn_convertir_unidad(l.cantidad_comprada, l.unidad, m.unidad), 0), 0)), 0)
                    FROM lotes l WHERE l.materia_prima_id = m.id AND l.cantidad_disponible > 0)
              ELSE GREATEST(m.stock_actual, 0) * COALESCE(m.costo_unitario, 0) END), 0) AS valor,
            COUNT(*) FILTER (WHERE m.stock_actual > 0) AS insumos
     FROM materias_primas m WHERE m.sucursal_id = $1`, [sucursalId]);
  return {
    periodo: p, nombre: r.nombre, desde: r.desde, hasta: r.hasta, cerrado,
    ventas: { total: ventas, pedidos: Number(v.pedidos), efectivo: round2(v.ventas_efectivo), banco: round2(ventas - num(v.ventas_efectivo)), pagosSinDesglose: Number(v.pagos_sin_desglose), cortesias: Number(v.cortesias), cortesiasValor: round2(v.cortesias_valor), descuentos: round2(v.descuentos) },
    costoVentas: {
      // Desglose: lo vendido (neto de insumos que regresaron por tickets
      // cancelados o devueltos), lo surtido sin venta (mesas, personal),
      // mermas y ajustes por conteo físico (faltantes/sobrantes).
      total: costoVentas, consumo: round2(c.consumo),
      consumoVentas: round2(num(c.consumo) - num(c.consumo_interno) + num(c.devoluciones)), consumoInterno: round2(c.consumo_interno),
      mermas: round2(c.mermas), ajustes: round2(c.ajustes), ajustesConteo: round2(num(c.ajustes) - num(c.devoluciones)), devoluciones: round2(c.devoluciones), manual: round2(porGrupo.costo_ventas),
      // Ventas cobradas sin su costo: pendientes de terminar (el costo llegará) y terminadas sin costo (no llegará).
      sinTerminar: resumenSinCosto('sin_terminar'), sinReceta: resumenSinCosto('sin_receta'),
    },
    utilidadBruta,
    gastosOperacion: round2(porGrupo.gasto_operacion),
    utilidadOperacion,
    gastosFinancieros: round2(porGrupo.gasto_financiero),
    impuestos: round2(porGrupo.impuesto),
    utilidadNeta,
    margenNeto: ventas > 0 ? round2(utilidadNeta / ventas * 100) : null,
    // Salidas que NO bajan la utilidad (para el flujo de dinero y la conciencia del dueño).
    inventarioHoy: { valor: round2(inv.valor), insumos: Number(inv.insumos) },
    otrasSalidas: { inventario: round2(porGrupo.inventario), inversion: round2(porGrupo.inversion), retiros: round2(porGrupo.retiro), diezmoOfrenda: round2(porGrupo.diezmo_ofrenda) },
    mayordomia: {
      base, diezmoPorcentaje: config.diezmoPorcentaje, ofrendaPorcentaje: config.ofrendaPorcentaje,
      diezmo, ofrenda, diezmoEntregado: round2(ent.diezmo), ofrendaEntregada: round2(ent.ofrenda),
      diezmoPendiente: round2(diezmo - num(ent.diezmo)), ofrendaPendiente: round2(ofrenda - num(ent.ofrenda)),
      utilidadDespues: round2(utilidadNeta - diezmo - ofrenda),
    },
    cuentas: cuentas.map(x => ({ id: x.id, nombre: x.nombre, grupo: x.grupo, clave: x.clave, monto: round2(x.monto), movimientos: Number(x.movimientos), porPagar: round2(x.por_pagar), afectaUtilidad: AFECTA_UTILIDAD.has(x.grupo) })).filter(x => x.monto > 0 || x.movimientos > 0),
  };
}

// ---- Flujo de dinero y saldos ----------------------------------------------
// Movimientos de una cuenta de dinero entre dos fechas (inclusive):
// entradas por ventas (efectivo → caja; lo demás → banco), egresos pagados,
// traspasos. `desde` NULL = desde el inicio de la contabilidad.
async function movimientosCuenta(queryFn, sucursalId, cuenta, desde, hasta) {
  const ventasSql = cuenta.clave === 'caja'
    ? `COALESCE(SUM(COALESCE(p.importe_efectivo, CASE WHEN p.metodo_pago = 'efectivo' THEN p.total ELSE 0 END)),0)`
    : cuenta.clave === 'banco'
      ? `COALESCE(SUM(p.total - COALESCE(p.importe_efectivo, CASE WHEN p.metodo_pago = 'efectivo' THEN p.total ELSE 0 END)),0)`
      : '0';
  const { rows: [vt] } = await queryFn(
    `SELECT ${ventasSql} AS ventas FROM pedidos p
     WHERE p.sucursal_id = $1 AND p.cobrado AND NOT p.cancelado AND NOT p.no_show
       AND (p.creado_en AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3`, [sucursalId, desde, hasta]);
  const { rows: [eg] } = await queryFn(
    `SELECT COALESCE(SUM(monto),0) AS salidas FROM egresos
     WHERE sucursal_id = $1 AND NOT anulado AND pagado AND cuenta_dinero_id = $4 AND pagado_en BETWEEN $2 AND $3`, [sucursalId, desde, hasta, cuenta.id]);
  const { rows: [tr] } = await queryFn(
    `SELECT COALESCE(SUM(monto) FILTER (WHERE a_cuenta_id = $4),0) AS entradas, COALESCE(SUM(monto) FILTER (WHERE de_cuenta_id = $4),0) AS salidas
     FROM traspasos_dinero WHERE sucursal_id = $1 AND NOT anulado AND fecha BETWEEN $2 AND $3`, [sucursalId, desde, hasta, cuenta.id]);
  return { ventas: round2(vt.ventas), egresos: round2(eg.salidas), traspasosEntrada: round2(tr.entradas), traspasosSalida: round2(tr.salidas) };
}
function sumaFlujo(m) { return round2(m.ventas + m.traspasosEntrada - m.egresos - m.traspasosSalida); }

async function flujoDinero(queryFn, sucursalId, periodo, cfg) {
  const p = validarPeriodo(periodo);
  const r = rangoPeriodo(p);
  const config = cfg || await leerConfigContabilidad(queryFn, sucursalId);
  const { rows: cuentas } = await queryFn('SELECT * FROM cuentas_dinero WHERE sucursal_id = $1 AND activo ORDER BY id', [sucursalId]);
  const out = [];
  for (const cuenta of cuentas) {
    const inicio = cuenta.fecha_saldo_inicial ? fechaISO(cuenta.fecha_saldo_inicial) : config.contabilidadInicio;
    // Saldo al inicio del mes: saldo inicial + todo lo ocurrido desde la fecha del saldo inicial hasta el día anterior.
    let saldoInicio = num(cuenta.saldo_inicial);
    const diaAntes = new Date(Date.UTC(r.anio, r.mes - 1, 0)).toISOString().slice(0, 10);
    if (inicio && inicio <= diaAntes) saldoInicio = round2(saldoInicio + sumaFlujo(await movimientosCuenta(queryFn, sucursalId, cuenta, inicio, diaAntes)));
    const desdeMes = inicio && inicio > r.desde ? inicio : r.desde;
    const mov = inicio && inicio > r.hasta ? { ventas: 0, egresos: 0, traspasosEntrada: 0, traspasosSalida: 0 } : await movimientosCuenta(queryFn, sucursalId, cuenta, desdeMes, r.hasta);
    out.push({
      id: cuenta.id, nombre: cuenta.nombre, tipo: cuenta.tipo, clave: cuenta.clave,
      saldoInicial: num(cuenta.saldo_inicial), fechaSaldoInicial: inicio, saldoInicioMes: saldoInicio, ...mov, saldoFinMes: round2(saldoInicio + sumaFlujo(mov)),
    });
  }
  const { rows: [sc] } = await queryFn(
    `SELECT COALESCE(SUM(monto),0) AS sin_cuenta, COUNT(*) AS n FROM egresos
     WHERE sucursal_id = $1 AND NOT anulado AND pagado AND cuenta_dinero_id IS NULL AND pagado_en BETWEEN $2 AND $3`, [sucursalId, r.desde, r.hasta]);
  const { rows: [pp] } = await queryFn(
    `SELECT COALESCE(SUM(monto),0) AS por_pagar, COUNT(*) AS n FROM egresos WHERE sucursal_id = $1 AND NOT anulado AND NOT pagado`, [sucursalId]);
  return { periodo: p, nombre: r.nombre, cuentas: out, pagadosSinCuenta: { monto: round2(sc.sin_cuenta), n: Number(sc.n) }, porPagar: { monto: round2(pp.por_pagar), n: Number(pp.n) } };
}

// Saldo actual de cada cuenta (hasta hoy).
async function saldosActuales(queryFn, sucursalId, cfg) {
  const config = cfg || await leerConfigContabilidad(queryFn, sucursalId);
  const { rows: cuentas } = await queryFn('SELECT * FROM cuentas_dinero WHERE sucursal_id = $1 AND activo ORDER BY id', [sucursalId]);
  const hoy = hoyMx();
  const out = [];
  for (const cuenta of cuentas) {
    const inicio = cuenta.fecha_saldo_inicial ? fechaISO(cuenta.fecha_saldo_inicial) : config.contabilidadInicio;
    let saldo = num(cuenta.saldo_inicial);
    if (inicio && inicio <= hoy) saldo = round2(saldo + sumaFlujo(await movimientosCuenta(queryFn, sucursalId, cuenta, inicio, hoy)));
    out.push({ id: cuenta.id, nombre: cuenta.nombre, tipo: cuenta.tipo, clave: cuenta.clave, saldoInicial: num(cuenta.saldo_inicial), fechaSaldoInicial: inicio, saldo, activo: cuenta.activo });
  }
  return out;
}

// ---- Mayordomía anual -----------------------------------------------------------
async function mayordomiaAnual(queryFn, sucursalId, anio, cfg) {
  const a = Number(anio);
  if (!Number.isInteger(a) || a < 2020 || a > 2100) throw new ApiError(400, 'Indica el año (ej. 2026).');
  const config = cfg || await leerConfigContabilidad(queryFn, sucursalId);
  const hoy = hoyMx();
  const inicio = config.contabilidadInicio || `${a}-01-01`;
  const meses = [];
  for (let m = 1; m <= 12; m++) {
    const periodo = `${a}-${String(m).padStart(2, '0')}`;
    if (periodo > hoy.slice(0, 7)) break;                 // meses futuros no
    if (`${periodo}-31` < inicio.slice(0, 7) + '-01') continue; // antes del arranque
    const er = await estadoResultados(queryFn, sucursalId, periodo, config);
    meses.push({ periodo, nombre: er.nombre, cerrado: er.cerrado, ventas: er.ventas.total, utilidadNeta: er.utilidadNeta, ...er.mayordomia });
  }
  const suma = k => round2(meses.reduce((s, x) => s + num(x[k]), 0));
  return {
    anio: a, inicio, diezmoPorcentaje: config.diezmoPorcentaje, ofrendaPorcentaje: config.ofrendaPorcentaje, meses,
    totales: { ventas: suma('ventas'), utilidadNeta: suma('utilidadNeta'), base: suma('base'), diezmo: suma('diezmo'), ofrenda: suma('ofrenda'), diezmoEntregado: suma('diezmoEntregado'), ofrendaEntregada: suma('ofrendaEntregada'), diezmoPendiente: suma('diezmoPendiente'), ofrendaPendiente: suma('ofrendaPendiente') },
  };
}

module.exports = {
  TZ, GRUPOS, GRUPO_LABELS, AFECTA_UTILIDAD, MESES, CLAVE_DIEZMO, CLAVE_OFRENDA, CLAVE_INICIO, DIEZMO_DEFAULT, OFRENDA_DEFAULT,
  validarPeriodo, rangoPeriodo, periodoDe, validarFecha, fechaISO, validarPorcentaje, hoyMx, round2,
  leerConfigContabilidad, cuentaPorClave, cuentaDineroPorClave, validarCuentaContable, validarCuentaDinero,
  mesCerrado, exigirMesAbierto, crearEgreso, listarEgresos, obtenerEgreso, egresoSql, normalizarFechas,
  estadoResultados, flujoDinero, saldosActuales, mayordomiaAnual,
};
