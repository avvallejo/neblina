// JORNADAS — horas trabajadas y pago semanal del personal que se paga por hora
// (migración 50).
//
// OJO con el nombre: "turno" ya es el turno de CAJA (abrir/cerrar caja, fondo
// y corte). Esto es otra cosa y se llama JORNADA: lo que una persona trabajó,
// de su entrada a su salida, menos el tiempo que estuvo fuera (pausas).
//
// Reglas:
//   * La entrada se registra sola al entrar con el PIN (si no hay una abierta).
//   * Cerrar la sesión NO cierra la jornada: la cierra la persona al contestar
//     "¿Terminaste tu turno?", o la administración al corregirla.
//   * Salir / Regresar son pausas SIN goce de sueldo.
//   * Minutos completos: cada hora se toma al minuto (se descartan los
//     segundos). Pagable = minutos de entrada a salida − minutos de pausa.
//     Monto = pagable × tarifa ÷ 60, a centavos.
//   * Una jornada que pasa del tope, o con una pausa demasiado larga, queda
//     "por_revisar": no se paga hasta que la administración la corrija o
//     apruebe. Nunca se inventa una hora de salida.
//   * Semana de pago: domingo a sábado (hora de la sede, America/Mexico_City).
//   * El pago es un EGRESO real en "Sueldos y salarios", sin turno de caja: lo
//     registra la administración, no el corte. Ver pagarHoras().
const { ApiError } = require('../utils/asyncHandler');
const { cleanText } = require('../utils/catalogValidation');
const A = require('./accounting');

const TZ = 'America/Mexico_City';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JORNADA_TOPE_HORAS = 12;      // más que esto sin cerrarse → por_revisar
const PAUSA_MAX_MINUTOS = 120;      // una pausa más larga → por_revisar
const JORNADA_MAX_MANUAL_HORAS = 24;

const MS_MINUTO = 60 * 1000;

// ---- Cálculo (funciones puras, sin base de datos) ---------------------------------

// Minutos completos transcurridos entre dos instantes: los segundos se descartan
// en CADA extremo (08:02:45 → 08:02), así que la suma de tramos es consistente.
function minutosEntre(inicio, fin) {
  const a = Math.floor(new Date(inicio).getTime() / MS_MINUTO);
  const b = Math.floor(new Date(fin).getTime() / MS_MINUTO);
  return Math.max(0, b - a);
}

// Monto a centavos sin errores de punto flotante: minutos × tarifa(centavos) ÷ 60.
function montoPorMinutos(minutos, tarifaHora) {
  const centavos = Math.round(Number(tarifaHora) * 100);
  return Math.round((minutos * centavos) / 60) / 100;
}

function calcularJornada({ entrada, salida, minutosPausa = 0, tarifaHora }) {
  const minutosTotales = minutosEntre(entrada, salida);
  const pausa = Math.min(Math.max(0, Math.trunc(Number(minutosPausa) || 0)), minutosTotales);
  const minutosPagables = minutosTotales - pausa;
  return { minutosTotales, minutosPausa: pausa, minutosPagables, monto: montoPorMinutos(minutosPagables, tarifaHora) };
}

// Fecha local (AAAA-MM-DD) de un instante, en la zona de la sede.
function fechaLocal(instante) {
  return new Date(instante).toLocaleDateString('en-CA', { timeZone: TZ });
}

// Semana de pago de una fecha: de domingo a sábado.
function semanaDe(fechaISO) {
  const f = A.validarFecha(fechaISO);
  const [y, m, d] = f.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const dow = base.getUTCDay(); // 0 = domingo
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const desde = base.getTime() - dow * 86400000;
  return { desde: iso(desde), hasta: iso(desde + 6 * 86400000) };
}

function sumarDias(fechaISO, dias) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + dias * 86400000).toISOString().slice(0, 10);
}

// ¿Por qué una jornada recién cerrada necesita revisión? null = está bien.
function motivoRevision({ minutosTotales, pausas = [] }) {
  if (minutosTotales > JORNADA_TOPE_HORAS * 60) return `Duró más de ${JORNADA_TOPE_HORAS} horas.`;
  if (pausas.some(p => p > PAUSA_MAX_MINUTOS)) return `Una pausa duró más de ${PAUSA_MAX_MINUTOS / 60} horas: ¿olvidó presionar Regresar?`;
  return null;
}

// ---- Lectura de datos ---------------------------------------------------------------

const jornadaSql = `SELECT j.id, j.sucursal_id, j.usuario_id, u.nombre AS usuario_nombre, j.entrada, j.salida, j.tarifa_hora::float8 AS tarifa_hora,
    j.estado, j.minutos_pausa, j.minutos_pagables, j.monto::float8 AS monto, j.manual, j.nota, j.motivo_revision, j.pago_id,
    to_char(j.entrada AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS fecha_local,
    (SELECT p.inicio FROM jornada_pausas p WHERE p.jornada_id = j.id AND p.fin IS NULL) AS pausa_desde
  FROM jornadas j JOIN usuarios u ON u.id = j.usuario_id`;

function darForma(row) {
  if (!row) return null;
  return {
    id: row.id, usuarioId: row.usuario_id, usuarioNombre: row.usuario_nombre, sucursalId: row.sucursal_id,
    entrada: row.entrada, salida: row.salida, fecha: row.fecha_local, tarifaHora: row.tarifa_hora, estado: row.estado,
    minutosPausa: row.minutos_pausa, minutosPagables: row.minutos_pagables, monto: row.monto,
    manual: row.manual, nota: row.nota, motivoRevision: row.motivo_revision, pagoId: row.pago_id, pausaDesde: row.pausa_desde,
  };
}

async function cargarUsuario(q, usuarioId, { bloquear = false } = {}) {
  const { rows: [u] } = await q(`SELECT id, nombre, rol, activo, sucursal_id, paga_por_hora FROM usuarios WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`, [usuarioId]);
  return u || null;
}

// Tarifa que regía en ese instante; si la persona no tenía ninguna todavía, la más antigua.
async function tarifaVigente(q, usuarioId, instante = new Date()) {
  const { rows: [t] } = await q(
    `SELECT tarifa::float8 AS tarifa FROM tarifas_hora WHERE usuario_id = $1
     ORDER BY (vigente_desde <= $2) DESC, CASE WHEN vigente_desde <= $2 THEN vigente_desde END DESC NULLS LAST, vigente_desde ASC LIMIT 1`,
    [usuarioId, instante]);
  return t ? t.tarifa : null;
}

// Una jornada abierta que rebasó el tope pasa a "por_revisar". No hay tarea
// programada: se aplica cada vez que alguien toca las jornadas.
async function marcarVencidas(q, { usuarioId = null, sucursalId = null } = {}) {
  await q(
    `UPDATE jornadas SET estado = 'por_revisar', motivo_revision = $3
     WHERE estado = 'abierta' AND entrada < now() - make_interval(hours => $4::int)
       AND ($1::uuid IS NULL OR usuario_id = $1) AND ($2::uuid IS NULL OR sucursal_id = $2)`,
    [usuarioId, sucursalId, `Pasó de ${JORNADA_TOPE_HORAS} horas sin cerrarse.`, JORNADA_TOPE_HORAS]);
}

async function jornadaAbierta(q, usuarioId, { bloquear = false } = {}) {
  const { rows: [j] } = await q(`${jornadaSql} WHERE j.usuario_id = $1 AND j.estado = 'abierta'${bloquear ? ' FOR UPDATE OF j' : ''}`, [usuarioId]);
  return j || null;
}

async function pausasDe(q, jornadaId) {
  const { rows } = await q('SELECT id, inicio, fin FROM jornada_pausas WHERE jornada_id = $1 ORDER BY inicio', [jornadaId]);
  return rows;
}

// ---- La persona: entrar, pausar, terminar ------------------------------------------

// Idempotente: si ya hay una jornada abierta la devuelve; si no, abre una.
// `c` va dentro de una transacción. Devuelve null si la persona no se paga por hora.
async function iniciarJornada(c, { usuarioId }) {
  const q = c.query.bind(c);
  const u = await cargarUsuario(q, usuarioId, { bloquear: true });
  if (!u || !u.activo || !u.paga_por_hora) return null;
  if (!u.sucursal_id) throw new ApiError(409, 'Para registrar horas la persona necesita una sucursal fija.');
  await marcarVencidas(q, { usuarioId });
  const abierta = await jornadaAbierta(q, usuarioId);
  if (abierta) return { jornada: darForma(abierta), creada: false };
  const tarifa = await tarifaVigente(q, usuarioId);
  if (!tarifa) throw new ApiError(409, 'Falta la tarifa por hora de esta persona. Pídele a la administración que la configure.');
  const { rows: [nueva] } = await q(
    'INSERT INTO jornadas (sucursal_id, usuario_id, tarifa_hora) VALUES ($1, $2, $3) RETURNING id', [u.sucursal_id, usuarioId, tarifa]);
  const { rows: [j] } = await q(`${jornadaSql} WHERE j.id = $1`, [nueva.id]);
  return { jornada: darForma(j), creada: true };
}

async function exigirAbierta(q, usuarioId, { bloquear = true } = {}) {
  const u = await cargarUsuario(q, usuarioId, { bloquear });
  if (!u || !u.paga_por_hora) throw new ApiError(403, 'Tu usuario no registra horas.');
  await marcarVencidas(q, { usuarioId });
  const j = await jornadaAbierta(q, usuarioId, { bloquear });
  if (!j) throw new ApiError(409, 'No tienes una jornada abierta. Si la anterior pasó de 12 horas, la administración debe revisarla.', { codigo: 'sin_jornada' });
  return j;
}

// "Salir": empieza una pausa (sin goce de sueldo) dentro de la jornada abierta.
async function iniciarPausa(c, { usuarioId }) {
  const q = c.query.bind(c);
  const j = await exigirAbierta(q, usuarioId);
  if (j.pausa_desde) return darForma(j); // idempotente
  await q('INSERT INTO jornada_pausas (jornada_id) VALUES ($1)', [j.id]);
  const { rows: [out] } = await q(`${jornadaSql} WHERE j.id = $1`, [j.id]);
  return darForma(out);
}

// "Regresar": cierra la pausa abierta.
async function terminarPausa(c, { usuarioId }) {
  const q = c.query.bind(c);
  const j = await exigirAbierta(q, usuarioId);
  await q('UPDATE jornada_pausas SET fin = now() WHERE jornada_id = $1 AND fin IS NULL', [j.id]);
  const { rows: [out] } = await q(`${jornadaSql} WHERE j.id = $1`, [j.id]);
  return darForma(out);
}

// Cierra la jornada con la hora del servidor (la del dispositivo no cuenta).
async function terminarJornada(c, { usuarioId }) {
  const q = c.query.bind(c);
  const j = await exigirAbierta(q, usuarioId);
  // GREATEST(…): JavaScript solo guarda milisegundos y la base microsegundos; sin esto,
  // cerrar en el mismo instante en que se abrió podría dejar la salida un instante ANTES.
  const { rows: [{ ahora }] } = await q('SELECT now() AS ahora');
  await q('UPDATE jornada_pausas SET fin = GREATEST($2::timestamptz, inicio) WHERE jornada_id = $1 AND fin IS NULL', [j.id, ahora]);
  const pausas = (await pausasDe(q, j.id)).map(p => minutosEntre(p.inicio, p.fin));
  const calculo = calcularJornada({ entrada: j.entrada, salida: ahora, minutosPausa: pausas.reduce((s, m) => s + m, 0), tarifaHora: j.tarifa_hora });
  const revisar = motivoRevision({ minutosTotales: calculo.minutosTotales, pausas });
  await q(
    `UPDATE jornadas SET salida = GREATEST($2::timestamptz, entrada), estado = $3, minutos_pausa = $4, minutos_pagables = $5, monto = $6, motivo_revision = $7 WHERE id = $1`,
    [j.id, ahora, revisar ? 'por_revisar' : 'cerrada', calculo.minutosPausa, calculo.minutosPagables, calculo.monto, revisar]);
  const { rows: [out] } = await q(`${jornadaSql} WHERE j.id = $1`, [j.id]);
  return darForma(out);
}

// ---- Resúmenes ------------------------------------------------------------------------

// Lo que lleva una jornada ABIERTA en este momento (pausas descontadas), para mostrarlo en vivo.
async function avanceEnCurso(q, j, ahora) {
  const pausas = await pausasDe(q, j.id);
  const enPausa = pausas.reduce((s, p) => s + minutosEntre(p.inicio, p.fin || ahora), 0);
  const calculo = calcularJornada({ entrada: j.entrada, salida: ahora, minutosPausa: enPausa, tarifaHora: j.tarifa_hora });
  return { minutosPagables: calculo.minutosPagables, minutosPausa: calculo.minutosPausa, monto: calculo.monto };
}

const ESTADOS_CON_MONTO = new Set(['cerrada', 'pagada', 'por_revisar']);

// Semana (domingo a sábado) de UNA persona: jornadas por día, con lo de hoy y lo acumulado.
async function resumenPersona(q, usuarioId, referencia = null) {
  const { rows: [{ ahora, hoy }] } = await q(`SELECT now() AS ahora, to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS hoy`);
  const semana = semanaDe(referencia || hoy);
  const { rows } = await q(
    `${jornadaSql} WHERE j.usuario_id = $1 AND j.estado <> 'anulada'
       AND (j.entrada AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3 ORDER BY j.entrada`, [usuarioId, semana.desde, semana.hasta]);
  const jornadas = [];
  for (const r of rows) {
    const j = darForma(r);
    if (j.estado === 'abierta') {
      const avance = await avanceEnCurso(q, r, ahora);
      Object.assign(j, avance, { enCurso: true });
    } else j.enCurso = false;
    jornadas.push(j);
  }
  const totales = { minutos: 0, monto: 0, porPagar: 0, pagado: 0, porRevisar: 0, enCurso: 0 };
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const fecha = sumarDias(semana.desde, i);
    const delDia = jornadas.filter(j => j.fecha === fecha);
    dias.push({
      fecha,
      minutos: delDia.reduce((s, j) => s + (j.minutosPagables || 0), 0),
      monto: A.round2(delDia.reduce((s, j) => s + (j.monto || 0), 0)),
      jornadas: delDia,
    });
  }
  for (const j of jornadas) {
    const monto = j.monto || 0; const min = j.minutosPagables || 0;
    totales.minutos += min; totales.monto += monto;
    if (j.estado === 'cerrada') totales.porPagar += monto;
    else if (j.estado === 'pagada') totales.pagado += monto;
    else if (j.estado === 'por_revisar') totales.porRevisar += monto;
    else if (j.estado === 'abierta') totales.enCurso += monto;
  }
  for (const k of ['monto', 'porPagar', 'pagado', 'porRevisar', 'enCurso']) totales[k] = A.round2(totales[k]);
  const hoyDia = dias.find(d => d.fecha === hoy) || { minutos: 0, monto: 0 };
  return { ahora, hoy, semana, dias, totales, deHoy: { minutos: hoyDia.minutos, monto: hoyDia.monto } };
}

// Estado completo para la pantalla de la persona.
async function estadoActual(q, usuarioId) {
  const u = await cargarUsuario(q, usuarioId);
  if (!u || !u.paga_por_hora) return { aplica: false };
  await marcarVencidas(q, { usuarioId });
  const abierta = await jornadaAbierta(q, usuarioId);
  const resumen = await resumenPersona(q, usuarioId);
  const { rows: [{ n }] } = await q("SELECT count(*)::int AS n FROM jornadas WHERE usuario_id = $1 AND estado = 'por_revisar'", [usuarioId]);
  return {
    aplica: true, ahora: resumen.ahora, tarifaHora: await tarifaVigente(q, usuarioId),
    jornada: abierta ? resumen.dias.flatMap(d => d.jornadas).find(j => j.id === abierta.id) || darForma(abierta) : null,
    enPausa: !!(abierta && abierta.pausa_desde), pendientesRevision: n, resumen,
  };
}

// ---- Administración -------------------------------------------------------------------

// Entrada de fecha/hora del admin: con zona horaria se respeta tal cual; sin zona
// ("2026-10-20T08:30") se toma como hora de la sede.
async function aInstante(q, valor, etiqueta) {
  const s = String(valor ?? '').trim();
  if (!s) throw new ApiError(400, `Indica ${etiqueta}.`);
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, `${etiqueta}: fecha y hora inválidas.`);
    return d;
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) throw new ApiError(400, `${etiqueta}: usa AAAA-MM-DDTHH:MM.`);
  const { rows: [r] } = await q('SELECT ($1::timestamp AT TIME ZONE $2) AS t', [s, TZ]);
  return r.t;
}

async function exigirSinEmpalme(q, { usuarioId, id = null, entrada, salida }) {
  const { rows } = await q(
    `SELECT id FROM jornadas WHERE usuario_id = $1 AND ($2::uuid IS NULL OR id <> $2) AND estado <> 'anulada'
       AND tstzrange(entrada, COALESCE(salida, 'infinity'::timestamptz), '[)') && tstzrange($3::timestamptz, COALESCE($4::timestamptz, 'infinity'::timestamptz), '[)') LIMIT 1`,
    [usuarioId, id, entrada, salida || null]);
  if (rows.length) throw new ApiError(409, 'Ese horario se empalma con otra jornada de la misma persona.');
}

function validarMinutosPausa(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 24 * 60) throw new ApiError(400, 'Los minutos de pausa deben ser un número entero (0 o más).');
  return n;
}

async function auditar(q, { jornadaId, accion, anterior = null, nuevo = null, motivo = null, usuarioId, sucursalId }) {
  await q(
    `INSERT INTO auditoria (entidad, entidad_id, accion, valor_anterior, valor_nuevo, motivo, usuario_id, sucursal_id)
     VALUES ('jornadas', $1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
    [jornadaId, accion, anterior ? JSON.stringify(anterior) : null, nuevo ? JSON.stringify(nuevo) : null, motivo, usuarioId, sucursalId]);
}

const resumenAuditoria = j => ({ entrada: j.entrada, salida: j.salida, minutosPausa: j.minutos_pausa ?? j.minutosPausa, minutosPagables: j.minutos_pagables ?? j.minutosPagables, monto: j.monto, estado: j.estado });

function exigirMotivo(texto) {
  const motivo = cleanText(texto, { field: 'motivo', max: 200 });
  if (!motivo) throw new ApiError(400, 'Explica el motivo de la corrección.');
  return motivo;
}

// Semana completa para la administración: por persona, sus jornadas y sus totales.
async function semanaAdmin(q, sucursalId, referencia = null) {
  await marcarVencidas(q, { sucursalId });
  const { rows: [{ hoy }] } = await q(`SELECT to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS hoy`);
  const semana = semanaDe(referencia || hoy);
  const { rows: personas } = await q(
    `SELECT u.id, u.nombre, u.activo, u.paga_por_hora FROM usuarios u
     WHERE u.sucursal_id = $1 AND (u.paga_por_hora OR EXISTS (SELECT 1 FROM jornadas j WHERE j.usuario_id = u.id))
     ORDER BY u.paga_por_hora DESC, u.nombre`, [sucursalId]);
  const resultado = [];
  for (const p of personas) {
    const r = await resumenPersona(q, p.id, semana.desde);
    const pendientes = r.dias.flatMap(d => d.jornadas).filter(j => ['abierta', 'por_revisar'].includes(j.estado)).length;
    resultado.push({ id: p.id, nombre: p.nombre, activo: p.activo, pagaPorHora: p.paga_por_hora, tarifaHora: await tarifaVigente(q, p.id), dias: r.dias, totales: r.totales, pendientes });
  }
  // Jornadas por revisar de CUALQUIER semana (una olvidada del mes pasado también cuenta).
  const { rows: porRevisar } = await q(`${jornadaSql} WHERE j.sucursal_id = $1 AND j.estado = 'por_revisar' ORDER BY j.entrada`, [sucursalId]);
  const { rows: enCurso } = await q(`${jornadaSql} WHERE j.sucursal_id = $1 AND j.estado = 'abierta' ORDER BY j.entrada`, [sucursalId]);
  return { hoy, semana, personas: resultado, porRevisar: porRevisar.map(darForma), enCurso: enCurso.map(darForma) };
}

// Corrige una jornada. Con `motivo` obligatorio y rastro en auditoría. Si ya tiene
// salida queda "cerrada" (corregida o aprobada por la administración).
async function corregirJornada(c, { sucursalId, adminId, id, body }) {
  if (!UUID_RE.test(String(id))) throw new ApiError(400, 'Jornada inválida.');
  const q = c.query.bind(c);
  const motivo = exigirMotivo(body.motivo);
  const { rows: [actual] } = await q(`${jornadaSql} WHERE j.id = $1 AND j.sucursal_id = $2 FOR UPDATE OF j`, [id, sucursalId]);
  if (!actual) throw new ApiError(404, 'Jornada no encontrada en esta sucursal.');
  if (actual.estado === 'pagada') throw new ApiError(409, 'Esta jornada ya se pagó. Para corregirla, primero anula el egreso del pago en Contabilidad.');
  if (actual.estado === 'anulada') throw new ApiError(409, 'Esta jornada está anulada.');

  const entrada = body.entrada !== undefined ? await aInstante(q, body.entrada, 'la hora de entrada') : actual.entrada;
  const salida = body.salida !== undefined ? (body.salida === null || body.salida === '' ? null : await aInstante(q, body.salida, 'la hora de salida')) : actual.salida;
  const { rows: [{ ahora }] } = await q('SELECT now() AS ahora');
  if (new Date(entrada) > new Date(ahora)) throw new ApiError(400, 'La entrada no puede estar en el futuro.');
  if (salida && new Date(salida) > new Date(new Date(ahora).getTime() + MS_MINUTO)) throw new ApiError(400, 'La salida no puede estar en el futuro.');
  if (salida && new Date(salida) < new Date(entrada)) throw new ApiError(400, 'La salida debe ser posterior a la entrada.');
  if (salida && minutosEntre(entrada, salida) > JORNADA_MAX_MANUAL_HORAS * 60) throw new ApiError(400, `Una jornada no puede durar más de ${JORNADA_MAX_MANUAL_HORAS} horas.`);
  await exigirSinEmpalme(q, { usuarioId: actual.usuario_id, id: actual.id, entrada, salida });

  const anterior = resumenAuditoria(actual);
  let estado = actual.estado; let minutosPausa = actual.minutos_pausa;
  let minutosPagables = actual.minutos_pagables; let monto = actual.monto; let motivoRev = actual.motivo_revision;
  if (salida) {
    // Si no la traía cerrada, la pausa se deriva de los registros de Salir/Regresar (cerrando la que quedó abierta).
    if (!actual.salida) {
      await q('UPDATE jornada_pausas SET fin = GREATEST(inicio, $2) WHERE jornada_id = $1 AND fin IS NULL', [actual.id, salida]);
      minutosPausa = (await pausasDe(q, actual.id)).reduce((s, p) => s + minutosEntre(p.inicio, p.fin), 0);
    }
    if (body.minutosPausa !== undefined) minutosPausa = validarMinutosPausa(body.minutosPausa);
    const calculo = calcularJornada({ entrada, salida, minutosPausa, tarifaHora: actual.tarifa_hora });
    minutosPausa = calculo.minutosPausa; minutosPagables = calculo.minutosPagables; monto = calculo.monto;
    estado = 'cerrada'; motivoRev = null;
  } else {
    if (body.minutosPausa !== undefined) minutosPausa = validarMinutosPausa(body.minutosPausa);
    estado = actual.estado === 'por_revisar' ? 'por_revisar' : 'abierta'; minutosPagables = null; monto = null;
  }
  const nota = body.nota !== undefined ? (cleanText(body.nota, { field: 'nota', max: 300 }) || null) : actual.nota;
  await q(
    `UPDATE jornadas SET entrada = $2, salida = $3, estado = $4, minutos_pausa = $5, minutos_pagables = $6, monto = $7, motivo_revision = $8, nota = $9 WHERE id = $1`,
    [actual.id, entrada, salida, estado, minutosPausa, minutosPagables, monto, motivoRev, nota]);
  const { rows: [out] } = await q(`${jornadaSql} WHERE j.id = $1`, [actual.id]);
  await auditar(q, { jornadaId: actual.id, accion: 'corregir', anterior, nuevo: resumenAuditoria(out), motivo, usuarioId: adminId, sucursalId });
  return darForma(out);
}

// Jornada capturada por la administración (un día que se le olvidó entrar).
async function crearJornadaManual(c, { sucursalId, adminId, body }) {
  const q = c.query.bind(c);
  if (!UUID_RE.test(String(body.usuarioId || ''))) throw new ApiError(400, 'Elige a la persona.');
  const u = await cargarUsuario(q, body.usuarioId, { bloquear: true });
  if (!u || u.sucursal_id !== sucursalId) throw new ApiError(404, 'Esa persona no pertenece a esta sucursal.');
  if (!u.paga_por_hora) throw new ApiError(400, 'Esa persona no está marcada como "se paga por hora".');
  const motivo = exigirMotivo(body.motivo);
  const entrada = await aInstante(q, body.entrada, 'la hora de entrada');
  const salida = await aInstante(q, body.salida, 'la hora de salida');
  const { rows: [{ ahora }] } = await q('SELECT now() AS ahora');
  if (new Date(salida) > new Date(new Date(ahora).getTime() + MS_MINUTO)) throw new ApiError(400, 'La salida no puede estar en el futuro.');
  if (new Date(salida) <= new Date(entrada)) throw new ApiError(400, 'La salida debe ser posterior a la entrada.');
  if (minutosEntre(entrada, salida) > JORNADA_MAX_MANUAL_HORAS * 60) throw new ApiError(400, `Una jornada no puede durar más de ${JORNADA_MAX_MANUAL_HORAS} horas.`);
  const pausa = body.minutosPausa === undefined ? 0 : validarMinutosPausa(body.minutosPausa);
  await exigirSinEmpalme(q, { usuarioId: u.id, entrada, salida });
  const tarifa = await tarifaVigente(q, u.id, entrada);
  if (!tarifa) throw new ApiError(409, 'Falta la tarifa por hora de esta persona.');
  const calculo = calcularJornada({ entrada, salida, minutosPausa: pausa, tarifaHora: tarifa });
  const { rows: [nueva] } = await q(
    `INSERT INTO jornadas (sucursal_id, usuario_id, entrada, salida, tarifa_hora, estado, minutos_pausa, minutos_pagables, monto, manual, nota)
     VALUES ($1, $2, $3, $4, $5, 'cerrada', $6, $7, $8, true, $9) RETURNING id`,
    [sucursalId, u.id, entrada, salida, tarifa, calculo.minutosPausa, calculo.minutosPagables, calculo.monto, cleanText(body.nota, { field: 'nota', max: 300 }) || null]);
  const { rows: [out] } = await q(`${jornadaSql} WHERE j.id = $1`, [nueva.id]);
  await auditar(q, { jornadaId: nueva.id, accion: 'crear_manual', nuevo: resumenAuditoria(out), motivo, usuarioId: adminId, sucursalId });
  return darForma(out);
}

// Una entrada por error (alguien que solo entró a ver algo) no se borra: se anula, con motivo.
async function anularJornada(c, { sucursalId, adminId, id, motivo: texto }) {
  if (!UUID_RE.test(String(id))) throw new ApiError(400, 'Jornada inválida.');
  const q = c.query.bind(c);
  const motivo = exigirMotivo(texto);
  const { rows: [actual] } = await q(`${jornadaSql} WHERE j.id = $1 AND j.sucursal_id = $2 FOR UPDATE OF j`, [id, sucursalId]);
  if (!actual) throw new ApiError(404, 'Jornada no encontrada en esta sucursal.');
  if (actual.estado === 'pagada') throw new ApiError(409, 'Esta jornada ya se pagó. Para anularla, primero anula el egreso del pago en Contabilidad.');
  if (actual.estado === 'anulada') throw new ApiError(409, 'Esta jornada ya estaba anulada.');
  await q("UPDATE jornada_pausas SET fin = now() WHERE jornada_id = $1 AND fin IS NULL", [actual.id]);
  await q("UPDATE jornadas SET estado = 'anulada' WHERE id = $1", [actual.id]);
  await auditar(q, { jornadaId: actual.id, accion: 'anular', anterior: resumenAuditoria(actual), motivo, usuarioId: adminId, sucursalId });
  const { rows: [out] } = await q(`${jornadaSql} WHERE j.id = $1`, [actual.id]);
  return darForma(out);
}

const ddmm = f => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

// Paga las horas de UNA persona en UNA semana (domingo a sábado): crea el egreso en
// "Sueldos y salarios" y deja cada jornada ligada a su pago. Sale de Caja (efectivo)
// salvo que se elija otra cuenta; NO va ligado al turno de caja, así que no entra al
// corte: lo registra la administración desde Contabilidad en cualquier momento.
async function pagarHoras(c, { sucursalId, adminId, body }) {
  const q = c.query.bind(c);
  if (!UUID_RE.test(String(body.usuarioId || ''))) throw new ApiError(400, 'Elige a la persona.');
  const u = await cargarUsuario(q, body.usuarioId, { bloquear: true });
  if (!u || u.sucursal_id !== sucursalId) throw new ApiError(404, 'Esa persona no pertenece a esta sucursal.');
  const semana = semanaDe(body.semana || fechaLocal(new Date()));
  const fechaPago = A.validarFecha(body.fecha || A.hoyMx(), 'fecha de pago');
  await marcarVencidas(q, { usuarioId: u.id });
  const { rows } = await q(
    `SELECT id, estado, monto::float8 AS monto, minutos_pagables FROM jornadas
     WHERE usuario_id = $1 AND sucursal_id = $2 AND estado IN ('abierta', 'por_revisar', 'cerrada')
       AND (entrada AT TIME ZONE '${TZ}')::date BETWEEN $3 AND $4 ORDER BY entrada FOR UPDATE`, [u.id, sucursalId, semana.desde, semana.hasta]);
  const sinResolver = rows.filter(r => r.estado !== 'cerrada').length;
  if (sinResolver) throw new ApiError(409, `Hay ${sinResolver} jornada(s) abierta(s) o por revisar en esa semana. Corrígelas o apruébalas antes de pagar.`, { codigo: 'jornadas_sin_resolver' });
  const pagables = rows.filter(r => r.estado === 'cerrada');
  if (!pagables.length) throw new ApiError(409, 'No hay horas por pagar de esa persona en esa semana.', { codigo: 'sin_horas_por_pagar' });
  const monto = A.round2(pagables.reduce((s, r) => s + r.monto, 0));
  const minutos = pagables.reduce((s, r) => s + r.minutos_pagables, 0);
  if (!(monto > 0)) throw new ApiError(409, 'El total a pagar es $0.00; revisa las jornadas.');
  const cuentaDinero = body.cuentaDineroId !== undefined && body.cuentaDineroId !== null && body.cuentaDineroId !== ''
    ? await A.validarCuentaDinero(q, sucursalId, body.cuentaDineroId, { requerida: true })
    : await A.cuentaDineroPorClave(q, sucursalId, 'caja');
  const cuenta = await A.cuentaPorClave(q, sucursalId, 'sueldos');
  const nota = cleanText(body.nota, { field: 'nota', max: 300 }) || null;
  const egreso = await A.crearEgreso(c, {
    sucursalId, usuarioId: adminId, fecha: fechaPago, cuentaContable: cuenta, cuentaDineroId: cuentaDinero.id, pagado: true, pagadoEn: fechaPago,
    concepto: `Pago de horas — ${u.nombre} — semana ${ddmm(semana.desde)} al ${ddmm(semana.hasta)}`, monto, nota,
  });
  const { rows: [pago] } = await q(
    `INSERT INTO pagos_horas (sucursal_id, usuario_id, semana_desde, semana_hasta, fecha, jornadas, minutos, monto, egreso_id, nota, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [sucursalId, u.id, semana.desde, semana.hasta, fechaPago, pagables.length, minutos, monto, egreso.id, nota, adminId]);
  await q("UPDATE jornadas SET estado = 'pagada', pago_id = $2 WHERE id = ANY($1::uuid[])", [pagables.map(r => r.id), pago.id]);
  await q(
    `INSERT INTO auditoria (entidad, entidad_id, accion, valor_nuevo, motivo, usuario_id, sucursal_id) VALUES ('pagos_horas', $1, 'pagar', $2::jsonb, $3, $4, $5)`,
    [pago.id, JSON.stringify({ usuario: u.nombre, semana, monto, minutos, jornadas: pagables.length, egresoId: egreso.id, cuentaDinero: cuentaDinero.nombre }), 'Pago semanal de horas', adminId, sucursalId]);
  return { pagoId: pago.id, egresoId: egreso.id, folio: egreso.folio ?? null, usuarioId: u.id, usuarioNombre: u.nombre, semana, fecha: fechaPago, jornadas: pagables.length, minutos, monto, cuentaDinero: cuentaDinero.nombre };
}

// Bitácora del pago de horas (más recientes primero).
async function listarPagos(q, sucursalId, { usuarioId = null, limite = 100 } = {}) {
  const { rows } = await q(
    `SELECT p.id, p.usuario_id, u.nombre AS usuario_nombre, to_char(p.semana_desde, 'YYYY-MM-DD') AS semana_desde, to_char(p.semana_hasta, 'YYYY-MM-DD') AS semana_hasta,
            to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.jornadas, p.minutos, p.monto::float8 AS monto, p.nota, p.anulado, p.egreso_id, e.folio AS egreso_folio,
            d.nombre AS cuenta_dinero_nombre, a.nombre AS pagado_por
     FROM pagos_horas p JOIN usuarios u ON u.id = p.usuario_id JOIN egresos e ON e.id = p.egreso_id
     LEFT JOIN cuentas_dinero d ON d.id = e.cuenta_dinero_id LEFT JOIN usuarios a ON a.id = p.creado_por
     WHERE p.sucursal_id = $1 AND ($2::uuid IS NULL OR p.usuario_id = $2)
     ORDER BY p.fecha DESC, p.creado_en DESC LIMIT $3`, [sucursalId, usuarioId, limite]);
  return rows.map(r => ({
    id: r.id, usuarioId: r.usuario_id, usuarioNombre: r.usuario_nombre, semanaDesde: r.semana_desde, semanaHasta: r.semana_hasta, fecha: r.fecha,
    jornadas: r.jornadas, minutos: r.minutos, monto: r.monto, nota: r.nota, anulado: r.anulado, egresoId: r.egreso_id, folio: r.egreso_folio,
    cuentaDinero: r.cuenta_dinero_nombre, pagadoPor: r.pagado_por,
  }));
}

// Tarifa por hora: la administración la configura; queda con historial.
async function fijarTarifa(q, { usuarioId, tarifa, adminId }) {
  const n = Number(tarifa);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) throw new ApiError(400, 'Indica una tarifa por hora mayor a cero.');
  const actual = await tarifaVigente(q, usuarioId);
  if (actual !== null && Math.round(actual * 100) === Math.round(n * 100)) return actual;
  await q('INSERT INTO tarifas_hora (usuario_id, tarifa, creado_por) VALUES ($1, $2, $3)', [usuarioId, A.round2(n), adminId]);
  return A.round2(n);
}

module.exports = {
  TZ, JORNADA_TOPE_HORAS, PAUSA_MAX_MINUTOS,
  minutosEntre, montoPorMinutos, calcularJornada, semanaDe, sumarDias, fechaLocal, motivoRevision,
  tarifaVigente, fijarTarifa, marcarVencidas, iniciarJornada, iniciarPausa, terminarPausa, terminarJornada,
  estadoActual, resumenPersona, semanaAdmin, corregirJornada, crearJornadaManual, anularJornada, pagarHoras, listarPagos,
};
