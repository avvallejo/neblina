// BITÁCORA: quién hizo qué y cuándo.
//  - bitacora_acciones: una fila por cada acción de escritura del personal
//    (la llena el middleware middleware/bitacora.js).
//  - auditoria: el detalle antes/después de los cambios importantes (se llena
//    con registrarCambio desde cada servicio).
//  - movimientos_inventario: cada entrada/salida de existencias con su usuario.
// Las tres son de solo lectura desde aquí; las dos primeras ni siquiera admiten
// UPDATE/DELETE en la base (migración 51).
const { ApiError } = require('../utils/asyncHandler');

const TZ = 'America/Mexico_City';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const SECRETO = /pin|pass|contrase|token|secret|hash|otp|codigo|authorization/i;

// Resumen del cuerpo de una petición, sin secretos ni textos enormes (logos,
// imágenes en base64…). Acotado en profundidad y tamaño.
function sanitizar(valor, profundidad = 0) {
  if (valor === null || valor === undefined) return valor ?? null;
  if (typeof valor === 'string') return valor.length > 200 ? `[texto de ${valor.length} caracteres]` : valor;
  if (typeof valor !== 'object') return valor;
  if (profundidad >= 3) return '[…]';
  if (Array.isArray(valor)) {
    const salida = valor.slice(0, 20).map(v => sanitizar(v, profundidad + 1));
    if (valor.length > 20) salida.push(`[+${valor.length - 20} más]`);
    return salida;
  }
  const salida = {};
  let n = 0;
  for (const [clave, v] of Object.entries(valor)) {
    if (n++ >= 40) { salida['…'] = 'más campos'; break; }
    salida[clave] = SECRETO.test(clave) ? '[oculto]' : sanitizar(v, profundidad + 1);
  }
  return salida;
}

// Guarda el detalle antes/después de un cambio. `q` es un client o una función
// de consulta; dentro de una transacción, usa el client para que el rastro se
// confirme o se revierta junto con el cambio.
async function registrarCambio(q, { sucursalId, usuarioId, entidad, entidadId, accion, anterior, nuevo, motivo }) {
  const run = typeof q === 'function' ? q : q.query.bind(q);
  await run(
    `INSERT INTO auditoria (usuario_id, sucursal_id, entidad, entidad_id, accion, valor_anterior, valor_nuevo, motivo)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
    [usuarioId || null, sucursalId || null, entidad, String(entidadId), accion,
      anterior === undefined || anterior === null ? null : JSON.stringify(anterior),
      nuevo === undefined || nuevo === null ? null : JSON.stringify(nuevo), motivo || null]);
}

// ---- Listados (solo lectura) ----------------------------------------------------
function paginacion(params) {
  const limite = params.limite === undefined || params.limite === '' ? 50 : Number(params.limite);
  const desplazamiento = params.offset === undefined || params.offset === '' ? 0 : Number(params.offset);
  if (!Number.isInteger(limite) || limite < 1 || limite > 200) throw new ApiError(400, 'El tamaño de página debe estar entre 1 y 200.');
  if (!Number.isInteger(desplazamiento) || desplazamiento < 0) throw new ApiError(400, 'Página inválida.');
  return { limite, desplazamiento };
}

// Construye condiciones comunes. `col` indica las columnas de cada tabla.
function condiciones(params, col, { sucursalId, incluirGlobal }) {
  const valores = [sucursalId];
  const where = [incluirGlobal ? `(${col.sucursal} = $1 OR ${col.sucursal} IS NULL)` : `${col.sucursal} = $1`];
  const agregar = (sql, valor) => { valores.push(valor); where.push(sql.replace('?', `$${valores.length}`)); };
  if (params.desde) {
    if (!FECHA.test(params.desde)) throw new ApiError(400, 'Fecha inicial inválida (AAAA-MM-DD).');
    agregar(`(${col.fecha} AT TIME ZONE '${TZ}')::date >= ?::date`, params.desde);
  }
  if (params.hasta) {
    if (!FECHA.test(params.hasta)) throw new ApiError(400, 'Fecha final inválida (AAAA-MM-DD).');
    agregar(`(${col.fecha} AT TIME ZONE '${TZ}')::date <= ?::date`, params.hasta);
  }
  if (params.usuario) {
    if (!UUID.test(params.usuario)) throw new ApiError(400, 'Usuario inválido.');
    agregar(`${col.usuario} = ?`, params.usuario);
  }
  return { valores, where };
}

async function listarAcciones(queryFn, sucursalId, params = {}, { incluirGlobal = false } = {}) {
  const { limite, desplazamiento } = paginacion(params);
  const { valores, where } = condiciones(params, { sucursal: 'b.sucursal_id', fecha: 'b.creado_en', usuario: 'b.usuario_id' }, { sucursalId, incluirGlobal });
  if (params.entidad) { valores.push(String(params.entidad).slice(0, 80)); where.push(`b.entidad = $${valores.length}`); }
  if (params.resultado === 'ok') where.push('b.estado_http < 400');
  else if (params.resultado === 'fallida') where.push('b.estado_http >= 400');
  else if (params.resultado) throw new ApiError(400, 'Resultado inválido.');
  if (params.q) {
    valores.push(`%${String(params.q).slice(0, 80).replace(/[\\%_]/g, m => `\\${m}`)}%`);
    where.push(`(b.ruta ILIKE $${valores.length} OR b.accion ILIKE $${valores.length} OR b.usuario_nombre ILIKE $${valores.length}
      OR b.entidad_id ILIKE $${valores.length} OR b.detalle::text ILIKE $${valores.length})`);
  }
  const cond = where.join(' AND ');
  const { rows: [{ total }] } = await queryFn(`SELECT count(*)::int AS total FROM bitacora_acciones b WHERE ${cond}`, valores);
  const { rows } = await queryFn(
    `SELECT b.id, b.creado_en, b.usuario_id, COALESCE(u.nombre, b.usuario_nombre) AS usuario, b.rol, b.metodo, b.ruta, b.entidad,
            b.entidad_id, b.accion, b.estado_http, b.ip, b.detalle
     FROM bitacora_acciones b LEFT JOIN usuarios u ON u.id = b.usuario_id
     WHERE ${cond} ORDER BY b.creado_en DESC, b.id DESC LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, limite, desplazamiento]);
  return { total, filas: rows };
}

async function listarCambios(queryFn, sucursalId, params = {}, { incluirGlobal = false } = {}) {
  const { limite, desplazamiento } = paginacion(params);
  const { valores, where } = condiciones(params, { sucursal: 'au.sucursal_id', fecha: 'au.creado_en', usuario: 'au.usuario_id' }, { sucursalId, incluirGlobal });
  if (params.entidad) { valores.push(String(params.entidad).slice(0, 80)); where.push(`au.entidad = $${valores.length}`); }
  if (params.q) {
    valores.push(`%${String(params.q).slice(0, 80).replace(/[\\%_]/g, m => `\\${m}`)}%`);
    where.push(`(au.accion ILIKE $${valores.length} OR au.entidad ILIKE $${valores.length} OR au.motivo ILIKE $${valores.length}
      OR au.entidad_id ILIKE $${valores.length} OR u.nombre ILIKE $${valores.length}
      OR au.valor_nuevo::text ILIKE $${valores.length} OR au.valor_anterior::text ILIKE $${valores.length})`);
  }
  const cond = where.join(' AND ');
  const { rows: [{ total }] } = await queryFn(`SELECT count(*)::int AS total FROM auditoria au LEFT JOIN usuarios u ON u.id = au.usuario_id WHERE ${cond}`, valores);
  const { rows } = await queryFn(
    `SELECT au.id, au.creado_en, u.nombre AS usuario, au.entidad, au.entidad_id, au.accion, au.valor_anterior, au.valor_nuevo, au.motivo,
       CASE au.entidad
         WHEN 'materias_primas' THEN (SELECT nombre FROM materias_primas WHERE id::text = au.entidad_id)
         WHEN 'lotes' THEN (SELECT m.nombre FROM lotes l JOIN materias_primas m ON m.id = l.materia_prima_id WHERE l.id::text = au.entidad_id)
         WHEN 'ajustes_stock' THEN (SELECT m.nombre FROM ajustes_stock a JOIN materias_primas m ON m.id = a.materia_prima_id WHERE a.id::text = au.entidad_id)
         WHEN 'egresos' THEN (SELECT concepto FROM egresos WHERE id::text = au.entidad_id)
       END AS referencia
     FROM auditoria au LEFT JOIN usuarios u ON u.id = au.usuario_id
     WHERE ${cond} ORDER BY au.creado_en DESC, au.id DESC LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, limite, desplazamiento]);
  return { total, filas: rows };
}

const TIPOS_MOVIMIENTO = ['compra', 'consumo', 'merma', 'ajuste', 'anulacion_compra', 'correccion_captura', 'existencia_inicial'];
// Entradas y salidas de existencias. El consumo de ventas (una fila por insumo
// de cada vaso) queda fuera salvo que se pida: ahogaría lo importante.
async function listarMovimientos(queryFn, sucursalId, params = {}) {
  const { limite, desplazamiento } = paginacion(params);
  const { valores, where } = condiciones(params, { sucursal: 'mp.sucursal_id', fecha: 'mi.creado_en', usuario: 'mi.usuario_id' }, { sucursalId, incluirGlobal: false });
  if (params.insumo) {
    if (!UUID.test(params.insumo)) throw new ApiError(400, 'Insumo inválido.');
    valores.push(params.insumo); where.push(`mi.materia_prima_id = $${valores.length}`);
  }
  if (params.tipo) {
    if (!TIPOS_MOVIMIENTO.includes(params.tipo)) throw new ApiError(400, 'Tipo de movimiento inválido.');
    valores.push(params.tipo); where.push(`mi.tipo = $${valores.length}::tipo_movimiento`);
  }
  if (params.incluirVentas !== 'true') where.push('(mi.tipo <> \'consumo\' OR mi.pedido_item_id IS NULL)');
  const cond = where.join(' AND ');
  const { rows: [{ total }] } = await queryFn(
    `SELECT count(*)::int AS total FROM movimientos_inventario mi JOIN materias_primas mp ON mp.id = mi.materia_prima_id WHERE ${cond}`, valores);
  const { rows } = await queryFn(
    `SELECT mi.id, mi.creado_en, mp.id AS insumo_id, mp.nombre AS insumo, mp.unidad, mi.tipo, mi.cantidad, mi.costo_unitario,
            round((-mi.cantidad * COALESCE(mi.costo_unitario, 0))::numeric, 2) AS valor, mi.motivo, u.nombre AS usuario,
            mi.lote_id, mi.ajuste_stock_id, mi.revierte_movimiento_id, mi.pedido_item_id, mi.merma_id
     FROM movimientos_inventario mi
     JOIN materias_primas mp ON mp.id = mi.materia_prima_id
     LEFT JOIN usuarios u ON u.id = mi.usuario_id
     WHERE ${cond} ORDER BY mi.creado_en DESC, mi.id DESC LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, limite, desplazamiento]);
  return { total, filas: rows };
}

// Compras y altas de insumos (lotes), incluidas las anuladas.
async function listarCompras(queryFn, sucursalId, params = {}) {
  const { limite, desplazamiento } = paginacion(params);
  const { valores, where } = condiciones(params, { sucursal: 'm.sucursal_id', fecha: 'l.creado_en', usuario: 'l.usuario_id' }, { sucursalId, incluirGlobal: false });
  if (params.insumo) {
    if (!UUID.test(params.insumo)) throw new ApiError(400, 'Insumo inválido.');
    valores.push(params.insumo); where.push(`l.materia_prima_id = $${valores.length}`);
  }
  if (params.estado === 'anuladas') where.push('l.anulado_en IS NOT NULL');
  else if (params.estado === 'vigentes') where.push('l.anulado_en IS NULL');
  else if (params.estado) throw new ApiError(400, 'Estado inválido.');
  const cond = where.join(' AND ');
  const { rows: [{ total }] } = await queryFn(
    `SELECT count(*)::int AS total FROM lotes l JOIN materias_primas m ON m.id = l.materia_prima_id WHERE ${cond}`, valores);
  const { rows } = await queryFn(
    `SELECT l.id, l.creado_en, l.fecha_compra, m.id AS insumo_id, m.nombre AS insumo, m.unidad AS unidad_insumo,
            l.cantidad_comprada, l.cantidad_disponible, l.unidad, l.costo_total, l.numero_lote, u.nombre AS registrado_por,
            pr.nombre AS proveedor, l.anulado_en, ua.nombre AS anulado_por, l.motivo_anulacion,
            (SELECT e.pagado FROM egresos e WHERE e.lote_id = l.id AND NOT e.anulado LIMIT 1) AS egreso_pagado,
            EXISTS (SELECT 1 FROM egresos e WHERE e.lote_id = l.id AND NOT e.anulado) AS tiene_egreso
     FROM lotes l
     JOIN materias_primas m ON m.id = l.materia_prima_id
     LEFT JOIN usuarios u ON u.id = l.usuario_id
     LEFT JOIN usuarios ua ON ua.id = l.anulado_por
     LEFT JOIN proveedores pr ON pr.id = l.proveedor_id
     WHERE ${cond} ORDER BY l.creado_en DESC, l.id DESC LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, limite, desplazamiento]);
  return { total, filas: rows };
}

// Ajustes de existencias (conteos) con lo que suman hoy al costo de ventas.
async function listarAjustes(queryFn, sucursalId, params = {}) {
  const { limite, desplazamiento } = paginacion(params);
  const { valores, where } = condiciones(params, { sucursal: 'a.sucursal_id', fecha: 'a.creado_en', usuario: 'a.usuario_id' }, { sucursalId, incluirGlobal: false });
  if (params.q) {
    valores.push(`%${String(params.q).slice(0, 80).replace(/[\\%_]/g, m => `\\${m}`)}%`);
    where.push(`(m.nombre ILIKE $${valores.length} OR a.motivo ILIKE $${valores.length} OR u.nombre ILIKE $${valores.length})`);
  }
  const cond = where.join(' AND ');
  const { rows: [{ total }] } = await queryFn(
    `SELECT count(*)::int AS total FROM ajustes_stock a JOIN materias_primas m ON m.id = a.materia_prima_id LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE ${cond}`, valores);
  const { rows } = await queryFn(
    `SELECT a.id, a.creado_en, a.fecha_contable, m.nombre AS insumo, m.unidad, u.nombre AS usuario, a.motivo,
            a.cantidad_anterior, a.cantidad_contada, a.revertido_en, a.motivo_reversion, ur.nombre AS revertido_por,
            COALESCE(mov.diferencia, 0) AS diferencia, COALESCE(mov.costo, 0) AS costo
     FROM ajustes_stock a
     JOIN materias_primas m ON m.id = a.materia_prima_id
     LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN usuarios ur ON ur.id = a.revertido_por
     LEFT JOIN LATERAL (SELECT sum(mi.cantidad) AS diferencia, sum(-mi.cantidad * COALESCE(mi.costo_unitario, 0)) FILTER (WHERE mi.tipo = 'ajuste') AS costo
       FROM movimientos_inventario mi WHERE mi.ajuste_stock_id = a.id AND mi.tipo IN ('ajuste','correccion_captura')) mov ON true
     WHERE ${cond} ORDER BY a.creado_en DESC, a.id DESC LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, limite, desplazamiento]);
  return { total, filas: rows.map(r => ({ ...r, diferencia: Number(r.diferencia), costo: Math.round(Number(r.costo) * 100) / 100 })) };
}

module.exports = { listarAjustes, sanitizar, registrarCambio, listarAcciones, listarCambios, listarMovimientos, listarCompras, UUID, TZ };
