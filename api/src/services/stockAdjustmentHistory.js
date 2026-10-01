const { ApiError } = require('../utils/asyncHandler');
const { cleanText } = require('../utils/catalogValidation');
const A = require('./accounting');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fechaContable(value = A.hoyMx()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, 'Elige una fecha contable válida.');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value || value > A.hoyMx()) throw new ApiError(400, 'La fecha contable debe existir y no puede ser futura.');
  return value;
}
async function mesesAbiertos(client, sucursalId, dates) {
  for (const period of [...new Set(dates.map(d => d.slice(0,7)))].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`costos-mes:${sucursalId}:${period}`]);
    await A.exigirMesAbierto(client.query.bind(client), sucursalId, `${period}-01`);
  }
}
const selection = `SELECT a.*, m.nombre AS insumo, m.unidad, u.nombre AS usuario,
  COALESCE(mov.cantidad,0) AS diferencia, COALESCE(mov.costo,0) AS costo,
  COALESCE(mov.movimientos,0) AS movimientos,
  EXISTS(SELECT 1 FROM cierres_mes c WHERE c.sucursal_id=a.sucursal_id AND c.periodo=to_char(a.fecha_contable,'YYYY-MM')) AS cerrado
  FROM ajustes_stock a JOIN materias_primas m ON m.id=a.materia_prima_id LEFT JOIN usuarios u ON u.id=a.usuario_id
  LEFT JOIN LATERAL (SELECT sum(mi.cantidad) AS cantidad, count(*) AS movimientos,
    sum(-mi.cantidad*COALESCE(mi.costo_unitario,l.costo_total/NULLIF(fn_convertir_unidad(l.cantidad_comprada,l.unidad,m.unidad),0),m.costo_unitario,0)) AS costo
    FROM movimientos_inventario mi LEFT JOIN lotes l ON l.id=mi.lote_id WHERE mi.ajuste_stock_id=a.id) mov ON true`;
const normalize = a => ({ ...a, fecha_contable: A.fechaISO(a.fecha_contable),
  folio: `AJ-${a.id.slice(0,8).toUpperCase()}`, diferencia: Number(a.diferencia), costo: A.round2(a.costo),
  cantidad_anterior: a.cantidad_anterior === null ? null : Number(a.cantidad_anterior),
  cantidad_contada: a.cantidad_contada === null ? null : Number(a.cantidad_contada),
  firma: undefined, respuesta: undefined });
async function listar(query, sucursalId, params) {
  const p = A.rangoPeriodo(A.validarPeriodo(params.periodo));
  const basis = params.por || 'captura';
  if (!['captura','contable'].includes(basis)) throw new ApiError(400, 'Filtro de fecha inválido.');
  const offset = Number(params.offset || 0);
  if (!Number.isInteger(offset) || offset < 0) throw new ApiError(400, 'Página inválida.');
  if (params.insumo && !UUID.test(params.insumo)) throw new ApiError(400, 'Insumo inválido.');
  const values = [sucursalId,p.desde,p.hasta];
  let where = `WHERE a.sucursal_id=$1 AND ${basis === 'captura' ? "(a.creado_en AT TIME ZONE 'America/Mexico_City')::date" : 'a.fecha_contable'} BETWEEN $2 AND $3`;
  if (params.insumo) { values.push(params.insumo); where += ` AND a.materia_prima_id=$4`; }
  const { rows: [count] } = await query(`SELECT count(*) AS total FROM ajustes_stock a ${where}`, values);
  const { rows } = await query(`${selection} ${where} ORDER BY a.creado_en DESC,a.id LIMIT 50 OFFSET $${values.length+1}`, [...values,offset]);
  return { total: Number(count.total), ajustes: rows.map(normalize) };
}
async function obtener(query, sucursalId, id) {
  if (!UUID.test(id)) throw new ApiError(400, 'Ajuste inválido.');
  const { rows: [a] } = await query(`${selection} WHERE a.id=$1 AND a.sucursal_id=$2`, [id,sucursalId]);
  if (!a) throw new ApiError(404, 'Ajuste no encontrado en esta sucursal.');
  const { rows: cambios } = await query(`SELECT au.creado_en, au.motivo,au.valor_anterior,au.valor_nuevo,u.nombre AS usuario
    FROM auditoria au LEFT JOIN usuarios u ON u.id=au.usuario_id
    WHERE au.entidad='ajustes_stock' AND au.entidad_id=$1 AND au.sucursal_id=$2 ORDER BY au.creado_en DESC,au.id DESC`, [id,sucursalId]);
  return { ...normalize(a), cambios };
}
async function corregir(client, { sucursalId, usuarioId, id, body }) {
  const fecha = fechaContable(body.fechaContable);
  const motivo = cleanText(body.motivo, { max:500,field:'motivo del ajuste' });
  const razon = cleanText(body.razonCambio, { max:500,field:'motivo de la corrección' });
  if (!motivo || !razon || razon.length < 5) throw new ApiError(400, 'Escribe el motivo del ajuste y explica por qué lo corriges.');
  if (!Number.isInteger(body.version) || body.version < 1) throw new ApiError(400, 'Abre el ajuste antes de corregirlo.');
  if (Object.keys(body).some(k => !['fechaContable','motivo','razonCambio','version'].includes(k))) throw new ApiError(400, 'Aquí solo puedes corregir la fecha contable y el motivo. Para cambiar existencias, registra un nuevo conteo.');
  const before = await obtener(client.query.bind(client),sucursalId,id);
  await client.query("SET LOCAL lock_timeout='5s'");
  await mesesAbiertos(client,sucursalId,[before.fecha_contable,fecha]);
  const { rows: [locked] } = await client.query('SELECT version FROM ajustes_stock WHERE id=$1 AND sucursal_id=$2 FOR UPDATE',[id,sucursalId]);
  if (locked.version !== body.version || before.version !== body.version) throw new ApiError(409, 'Este ajuste cambió. Actualiza el historial antes de corregirlo.');
  if (fecha === before.fecha_contable && motivo === before.motivo) throw new ApiError(400, 'No hay cambios de fecha o motivo para guardar.');
  await client.query('UPDATE ajustes_stock SET fecha_contable=$2,motivo=$3,version=version+1 WHERE id=$1',[id,fecha,motivo]);
  const old = { fechaContable:before.fecha_contable, motivo:before.motivo, version:body.version };
  const next = { fechaContable:fecha, motivo, version:body.version+1 };
  await client.query(`INSERT INTO auditoria(entidad,entidad_id,accion,valor_anterior,valor_nuevo,motivo,usuario_id,sucursal_id)
    VALUES('ajustes_stock',$1,'corregir',$2,$3,$4,$5,$6)`,[id,old,next,razon,usuarioId,sucursalId]);
  return obtener(client.query.bind(client),sucursalId,id);
}
module.exports = { fechaContable, mesesAbiertos, listar, obtener, corregir };
