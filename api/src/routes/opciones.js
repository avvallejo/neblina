const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, resolveSucursalPublico } = require('../middleware/auth');

const router = express.Router();

/* ============================================================
   ADMINISTRACIÓN DE OPCIONES (tamaños, leches, cafés, extras)
   Los "delta_precio" de estas tablas son lo que el cliente ve como
   "(+6)" / "(+8)" al personalizar y lo que el servidor suma al cobrar
   (utils/pricing.js). Aquí el admin los ajusta con una referencia de
   cuánto le CUESTA cada opción según su inventario.
   ============================================================ */

const TABLAS = { tamanos: 'opciones_tamano', leches: 'opciones_leche', cafes: 'opciones_cafe', extras: 'opciones_extra' };

// Conversión de unidades equivalente a fn_convertir_unidad (solo lectura).
function convertir(cantidad, origen, destino) {
  if (cantidad === null || cantidad === undefined) return null;
  if (origen === destino) return Number(cantidad);
  const f = { 'g>kg': 1 / 1000, 'kg>g': 1000, 'ml>l': 1 / 1000, 'l>ml': 1000 }[`${origen}>${destino}`];
  return f === undefined ? null : Number(cantidad) * f;
}
// Costo de `cantidad unidad` de una materia prima según su costo de referencia.
function costoDe(materia, cantidad, unidad) {
  if (!materia) return null;
  const conv = convertir(cantidad, unidad, materia.unidad);
  return conv === null ? null : conv * Number(materia.costo_unitario || 0);
}
function sugerir(costo, margen, redondeo) {
  if (costo === null || !Number.isFinite(costo)) return null;
  if (Math.abs(costo) < 0.005) return 0;
  const r = Number(redondeo) > 0 ? Number(redondeo) : 1;
  const bruto = Math.abs(costo) * (1 + Number(margen) / 100);
  return Math.sign(costo) * Math.ceil(bruto / r - 1e-9) * r;
}
function slug(texto) {
  return String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'opcion';
}

router.get('/admin', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const suc = req.sucursalId;
  const [mats, tam, lec, caf, ext, cfg, emp] = await Promise.all([
    query('SELECT id, nombre, costo_unitario, unidad, activo FROM materias_primas WHERE sucursal_id = $1', [suc]),
    query('SELECT t.*, tl.cantidad_ml AS leche_ml FROM opciones_tamano t LEFT JOIN tamano_leche_cantidad tl ON tl.tamano_id = t.id WHERE t.sucursal_id = $1 ORDER BY t.onzas', [suc]),
    query('SELECT * FROM opciones_leche WHERE sucursal_id = $1 ORDER BY etiqueta', [suc]),
    query('SELECT * FROM opciones_cafe WHERE sucursal_id = $1 ORDER BY etiqueta', [suc]),
    query('SELECT * FROM opciones_extra WHERE sucursal_id = $1 ORDER BY etiqueta', [suc]),
    query('SELECT porcentaje_ganancia_normal, redondeo FROM configuracion_margen WHERE sucursal_id = $1 ORDER BY actualizado_en DESC LIMIT 1', [suc]),
    query('SELECT te.tamano_id, te.variante, mv.costo_unitario AS vaso, mt.costo_unitario AS tapa FROM tamano_empaque te JOIN materias_primas mv ON mv.id = te.materia_prima_vaso_id JOIN materias_primas mt ON mt.id = te.materia_prima_tapa_id JOIN opciones_tamano t ON t.id = te.tamano_id WHERE t.sucursal_id = $1', [suc]),
  ]);
  const materias = Object.fromEntries(mats.rows.map(m => [m.id, m]));
  const margen = Number(cfg.rows[0]?.porcentaje_ganancia_normal ?? 60);
  const redondeo = Number(cfg.rows[0]?.redondeo ?? 1);
  const conSugerido = (fila, costo) => ({ ...fila, costo_extra: costo === null ? null : Math.round(costo * 100) / 100, precio_sugerido: sugerir(costo, margen, redondeo) });

  const base = tam.rows.find(t => Number(t.delta_precio) === 0) || tam.rows.find(t => t.codigo === '12') || tam.rows[0];
  const lecheEntera = lec.rows.find(l => l.codigo === 'entera') || lec.rows[0];
  const cafeTrad = caf.rows.find(c => c.codigo === 'tradicional') || caf.rows[0];
  const mEntera = lecheEntera ? materias[lecheEntera.materia_prima_id] : null;
  const mTrad = cafeTrad ? materias[cafeTrad.materia_prima_id] : null;
  const mlBase = base && base.leche_ml !== null ? Number(base.leche_ml) : 280;
  const empaqueDe = (tamanoId, variante = 'caliente') => {
    const e = emp.rows.find(x => x.tamano_id === tamanoId && x.variante === variante);
    return e ? Number(e.vaso || 0) + Number(e.tapa || 0) : null;
  };

  // Tamaño: diferencia de leche + empaque respecto al tamaño base (delta 0).
  const tamanos = tam.rows.map(t => {
    if (!base || t.id === base.id) return conSugerido(t, 0);
    const dMl = (t.leche_ml !== null ? Number(t.leche_ml) : mlBase) - mlBase;
    const cLeche = mEntera ? costoDe(mEntera, dMl, 'ml') : 0;
    const eT = empaqueDe(t.id); const eB = empaqueDe(base.id);
    const cEmp = eT !== null && eB !== null ? eT - eB : 0;
    return conSugerido(t, (cLeche ?? 0) + cEmp);
  });
  // Leche: lo que cuesta de más (o de menos) esa leche frente a la entera en el tamaño base.
  const leches = lec.rows.map(l => {
    const m = materias[l.materia_prima_id];
    if (!m || !mEntera) return conSugerido(l, null);
    return conSugerido(l, (costoDe(m, mlBase, 'ml') ?? 0) - (costoDe(mEntera, mlBase, 'ml') ?? 0));
  });
  // Café: diferencia por shot (18 g de referencia) frente al tradicional.
  const cafes = caf.rows.map(c => {
    const m = materias[c.materia_prima_id];
    if (!m || !mTrad) return conSugerido(c, null);
    return conSugerido(c, (costoDe(m, 18, 'g') ?? 0) - (costoDe(mTrad, 18, 'g') ?? 0));
  });
  // Extra: costo de la porción; el shot extra = un shot más de café tradicional.
  const extras = ext.rows.map(e => {
    if (e.es_shot_adicional) return conSugerido(e, mTrad ? costoDe(mTrad, 18, 'g') : null);
    const m = materias[e.materia_prima_id];
    return conSugerido(e, m && e.cantidad ? costoDe(m, e.cantidad, e.unidad) : null);
  });

  res.json({
    margen, redondeo, leche_ml_base: mlBase, tamano_base: base ? base.codigo : null,
    tamanos, leches, cafes, extras,
    materias: mats.rows.filter(m => m.activo !== false).map(m => ({ id: m.id, nombre: m.nombre, unidad: m.unidad, costo_unitario: m.costo_unitario })),
  });
}));

function validarDelta(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < -1000 || n > 1000) throw new ApiError(400, 'El ajuste de precio debe ser un número entre -1000 y 1000.');
  return Math.round(n * 100) / 100;
}
async function validarMateria(id, sucursalId) {
  if (!id) return null;
  const r = await query('SELECT id FROM materias_primas WHERE id = $1 AND sucursal_id = $2', [id, sucursalId]);
  if (r.rows.length === 0) throw new ApiError(400, 'La materia prima no pertenece a esta sucursal.');
  return id;
}
const UNIDADES = ['g', 'kg', 'ml', 'l', 'pieza'];

// Nueva opción de leche, café o extra (los tamaños son fijos: 8/12/16 oz).
router.post('/:tipo', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const tabla = TABLAS[req.params.tipo];
  if (!tabla || req.params.tipo === 'tamanos') throw new ApiError(400, 'Solo se pueden crear leches, cafés y extras.');
  const { etiqueta, deltaPrecio, materiaPrimaId, cantidad, unidad } = req.body;
  if (!etiqueta?.trim()) throw new ApiError(400, 'Ingresa el nombre de la opción.');
  const delta = validarDelta(deltaPrecio ?? 0);
  const materia = await validarMateria(materiaPrimaId, req.sucursalId);
  if (req.params.tipo !== 'extras' && !materia) throw new ApiError(400, 'Elige la materia prima que descuenta esta opción.');

  // Código único por sede a partir del nombre (es lo que usa el frontend como id).
  let codigo = slug(etiqueta);
  const existentes = await query(`SELECT codigo FROM ${tabla} WHERE sucursal_id = $1`, [req.sucursalId]);
  const usados = new Set(existentes.rows.map(r => r.codigo));
  let n = 2; const baseCodigo = codigo;
  while (usados.has(codigo)) codigo = `${baseCodigo}_${n++}`;

  let rows;
  if (req.params.tipo === 'extras') {
    const cant = cantidad === undefined || cantidad === null || cantidad === '' ? null : Number(cantidad);
    if (materia && (!Number.isFinite(cant) || cant <= 0)) throw new ApiError(400, 'Indica la porción del extra (cantidad mayor a 0).');
    if (materia && !UNIDADES.includes(unidad)) throw new ApiError(400, 'Unidad inválida.');
    ({ rows } = await query(
      `INSERT INTO opciones_extra (codigo, etiqueta, delta_precio, materia_prima_id, cantidad, unidad, es_shot_adicional, sucursal_id)
       VALUES ($1,$2,$3,$4,$5,$6,false,$7) RETURNING *`,
      [codigo, etiqueta.trim(), delta, materia, materia ? cant : null, materia ? unidad : null, req.sucursalId]
    ));
  } else {
    ({ rows } = await query(
      `INSERT INTO ${tabla} (codigo, etiqueta, delta_precio, materia_prima_id, sucursal_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [codigo, etiqueta.trim(), delta, materia, req.sucursalId]
    ));
  }
  res.status(201).json(rows[0]);
}));

// Ajustar precio/nombre/activo (y porción/insumo en extras).
router.patch('/:tipo/:id', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const tabla = TABLAS[req.params.tipo];
  if (!tabla) throw new ApiError(404, 'Tipo de opción desconocido.');
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new ApiError(400, 'Id inválido.');
  const sets = []; const values = []; let i = 1;
  const add = (col, val) => { sets.push(`${col} = $${i++}`); values.push(val); };

  if (req.body.deltaPrecio !== undefined) add('delta_precio', validarDelta(req.body.deltaPrecio));
  if (req.body.etiqueta !== undefined) {
    if (!String(req.body.etiqueta).trim()) throw new ApiError(400, 'El nombre no puede quedar vacío.');
    add('etiqueta', String(req.body.etiqueta).trim());
  }
  if (req.body.activo !== undefined) {
    if (req.params.tipo === 'tamanos') throw new ApiError(400, 'Los tamaños no se desactivan.');
    add('activo', !!req.body.activo);
  }
  if (req.params.tipo !== 'tamanos' && req.body.materiaPrimaId !== undefined) {
    add('materia_prima_id', await validarMateria(req.body.materiaPrimaId, req.sucursalId));
  }
  if (req.params.tipo === 'extras') {
    if (req.body.cantidad !== undefined) {
      const cant = req.body.cantidad === null || req.body.cantidad === '' ? null : Number(req.body.cantidad);
      if (cant !== null && (!Number.isFinite(cant) || cant <= 0)) throw new ApiError(400, 'La porción debe ser mayor a 0.');
      add('cantidad', cant);
    }
    if (req.body.unidad !== undefined) {
      if (req.body.unidad !== null && !UNIDADES.includes(req.body.unidad)) throw new ApiError(400, 'Unidad inválida.');
      add('unidad', req.body.unidad);
    }
  }
  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');

  // La leche "entera" y el café "tradicional" son la referencia de costos y
  // de las recetas: se pueden repreciar pero no desactivar.
  if (req.body.activo === false) {
    const ref = await query(`SELECT codigo FROM ${tabla} WHERE id = $1 AND sucursal_id = $2`, [id, req.sucursalId]);
    if (ref.rows[0] && ['entera', 'tradicional'].includes(ref.rows[0].codigo)) throw new ApiError(400, 'Esta opción es la base de las recetas y no se puede desactivar.');
  }

  values.push(id, req.sucursalId);
  const { rows } = await query(`UPDATE ${tabla} SET ${sets.join(', ')} WHERE id = $${i} AND sucursal_id = $${i + 1} RETURNING *`, values);
  if (rows.length === 0) throw new ApiError(404, 'Opción no encontrada.');
  res.json(rows[0]);
}));

// El catálogo de opciones es de lectura pública, pero POR SEDE:
// GET /api/opciones/...?sucursal=<id>
router.use(resolveSucursalPublico);

router.get('/tamanos', asyncHandler(async (req, res) => {
  // leche_ml = leche predeterminada de la sede para ese tamaño (una receta
  // puede sobreescribirla con recetas.leche_ml_por_tamano).
  res.json((await query(
    `SELECT t.*, tl.cantidad_ml AS leche_ml
     FROM opciones_tamano t LEFT JOIN tamano_leche_cantidad tl ON tl.tamano_id = t.id
     WHERE t.sucursal_id = $1 ORDER BY t.onzas`, [req.sucursalId])).rows);
}));

router.get('/leches', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM opciones_leche WHERE activo AND sucursal_id = $1 ORDER BY etiqueta', [req.sucursalId])).rows);
}));

router.get('/cafes', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM opciones_cafe WHERE activo AND sucursal_id = $1 ORDER BY etiqueta', [req.sucursalId])).rows);
}));

router.get('/extras', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM opciones_extra WHERE activo AND sucursal_id = $1 ORDER BY etiqueta', [req.sucursalId])).rows);
}));

module.exports = router;
