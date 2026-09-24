const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const {
  cleanText,
  normalizeUnidadMedida,
  parseNumber,
  toBoolean,
} = require('../utils/catalogValidation');

const { normalizarPresentacion, registrarCompra } = require('../services/purchases');
const { guardarCategoriasUso } = require('../services/ingredientCategories');
const { eliminarMateria } = require('../services/deleteMateria');
const { ajustarStock } = require('../services/adjustStock');
const { registrarSalidaInterna } = require('../services/internalUse');

const router = express.Router();
router.use(requireAuth, requireRole('admin'), resolveSucursal);

async function assertConvertible(client, from, to) {
  if (!from || !to || from === to) return 1;
  const { rows } = await client.query('SELECT fn_convertir_unidad(1, $1::unidad_medida, $2::unidad_medida) AS factor', [from, to]);
  return Number(rows[0].factor);
}

router.get('/', asyncHandler(async (req, res) => {
  const { categoria } = req.query;
  const condiciones = [];
  const values = [];
  values.push(req.sucursalId);
  condiciones.push(`m.sucursal_id = $${values.length}`);
  if (categoria) { values.push(categoria); condiciones.push(`cm.nombre = $${values.length}`); }
  const where = `WHERE ${condiciones.join(' AND ')}`;
  const { rows } = await query(
    `SELECT m.*, cm.nombre AS categoria, p.nombre AS proveedor,
            ARRAY(SELECT u.categoria_id FROM materia_categorias_uso u WHERE u.materia_prima_id=m.id ORDER BY u.categoria_id) AS categorias_uso
     FROM materias_primas m
     JOIN categorias_materia_prima cm ON cm.id = m.categoria_id
     LEFT JOIN proveedores p ON p.id = m.proveedor_id
     ${where}
     ORDER BY m.nombre`,
    values
  );
  res.json(rows);
}));

router.get('/stock-bajo', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vw_stock_bajo WHERE sucursal_id = $1', [req.sucursalId]);
  res.json(rows);
}));

router.get('/categorias', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM categorias_materia_prima WHERE sucursal_id = $1 ORDER BY nombre', [req.sucursalId]);
  res.json(rows);
}));

// Categorías de insumos: las define cada sucursal (crear, renombrar, borrar
// si ninguna materia prima la usa). El nombre es único por sede.
router.post('/categorias', asyncHandler(async (req, res) => {
  const nombre = cleanText(req.body.nombre, { required: true, field: 'un nombre de categoría', max: 40 });
  const { rows } = await query('INSERT INTO categorias_materia_prima (nombre, sucursal_id) VALUES ($1, $2) RETURNING *', [nombre, req.sucursalId]);
  res.status(201).json(rows[0]);
}));
router.patch('/categorias/:id', asyncHandler(async (req, res) => {
  const nombre = cleanText(req.body.nombre, { required: true, field: 'un nombre de categoría', max: 40 });
  const { rows } = await query('UPDATE categorias_materia_prima SET nombre = $1 WHERE id = $2 AND sucursal_id = $3 RETURNING *', [nombre, req.params.id, req.sucursalId]);
  if (!rows.length) throw new ApiError(404, 'Categoría no encontrada.');
  res.json(rows[0]);
}));
router.delete('/categorias/:id', asyncHandler(async (req, res) => {
  const { rows: [uso] } = await query('SELECT COUNT(*)::int AS n FROM materias_primas WHERE categoria_id = $1', [req.params.id]);
  if (uso.n > 0) throw new ApiError(409, `No se puede borrar: ${uso.n} insumo(s) usan esta categoría. Cámbialos de categoría primero.`);
  const { rows } = await query('DELETE FROM categorias_materia_prima WHERE id = $1 AND sucursal_id = $2 RETURNING id', [req.params.id, req.sucursalId]);
  if (!rows.length) throw new ApiError(404, 'Categoría no encontrada.');
  res.json({ ok: true });
}));

router.post('/', asyncHandler(async (req, res) => {
  const {
    nombre,
    categoriaId,
    unidad,
    stockActual,
    stockMinimo,
    costoUnitario,
    proveedorId,
    requiereLote,
    requiereCaducidad,
  } = req.body;

  const nombreLimpio = cleanText(nombre, { required: true, field: 'un nombre', max: 120 });
  if (!categoriaId) throw new ApiError(400, 'Selecciona una categoría.');
  const unidadNormalizada = normalizeUnidadMedida(unidad, 'unidad') || 'kg';

  const categoriaPropia = await query('SELECT id FROM categorias_materia_prima WHERE id = $1 AND sucursal_id = $2', [categoriaId, req.sucursalId]);
  if (categoriaPropia.rows.length === 0) throw new ApiError(400, 'La categoría no pertenece a esta sucursal.');
  if (proveedorId) {
    const proveedorPropio = await query('SELECT id FROM proveedores WHERE id = $1 AND sucursal_id = $2', [proveedorId, req.sucursalId]);
    if (proveedorPropio.rows.length === 0) throw new ApiError(400, 'El proveedor no pertenece a esta sucursal.');
  }

  // Dos formas de arrancar: `primeraCompra` { cantidad|paquetes, unidad, costoTotal }
  // (lo normal: el costo unitario se deriva de lo que pagaste) o, si ya tienes
  // existencias sin ticket, `stockActual` + `costoUnitario` a mano.
  const primeraCompra = req.body.primeraCompra && typeof req.body.primeraCompra === 'object' ? req.body.primeraCompra : null;
  const creado = await withTransaction(async client => {
    const presentacion = await normalizarPresentacion(client, req.body.presentacion, unidadNormalizada);
    const { rows } = await client.query(
      `INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id, requiere_lote, requiere_caducidad, sucursal_id, stock_maximo,
                                    presentacion_cantidad, presentacion_unidad, presentacion_nombre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        nombreLimpio,
        categoriaId,
        unidadNormalizada,
        primeraCompra ? 0 : (parseNumber(stockActual, 'stock actual', { min: 0 }) ?? 0),
        parseNumber(stockMinimo, 'stock mínimo', { min: 0 }) ?? 0,
        primeraCompra ? 0 : (parseNumber(costoUnitario, 'costo unitario', { min: 0 }) ?? 0),
        proveedorId || null,
        toBoolean(requiereLote) ?? false,
        toBoolean(requiereCaducidad) ?? false,
        req.sucursalId,
        // "Reabastecer hasta": nivel al que conviene reponer (opcional).
        req.body.stockMaximo === undefined || req.body.stockMaximo === null || req.body.stockMaximo === '' ? null : parseNumber(req.body.stockMaximo, 'stock máximo', { min: 0 }),
        presentacion ? presentacion.cantidad : null,
        presentacion ? presentacion.unidad : null,
        presentacion ? presentacion.nombre : null,
      ]
    );
    await guardarCategoriasUso(client, rows[0].id, req.sucursalId, req.body.categoriasUso);
    if (primeraCompra) {
      await registrarCompra(client, { materiaId: rows[0].id, sucursalId: req.sucursalId, usuarioId: req.auth.id, body: { ...primeraCompra, proveedorId: primeraCompra.proveedorId ?? proveedorId ?? null } });
      const { rows: [actual] } = await client.query('SELECT * FROM materias_primas WHERE id = $1', [rows[0].id]);
      return actual;
    }
    return rows[0];
  });
  res.status(201).json(creado);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const updated = await withTransaction(async client => {
    const actual = await client.query('SELECT * FROM materias_primas WHERE id = $1 AND sucursal_id = $2 FOR UPDATE', [req.params.id, req.sucursalId]);
    if (actual.rows.length === 0) throw new ApiError(404, 'Materia prima no encontrada.');
    const current = actual.rows[0];

    const sets = [];
    const values = [];
    let nuevaUnidad = current.unidad;
    const addValue = (column, value) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    const addConversion = (column, sourceColumn) => {
      values.push(current.unidad);
      const oldIndex = values.length;
      values.push(nuevaUnidad);
      const newIndex = values.length;
      sets.push(`${column} = fn_convertir_unidad(${sourceColumn}, $${oldIndex}::unidad_medida, $${newIndex}::unidad_medida)`);
    };
    const addNullableConversion = (column, sourceColumn) => {
      values.push(current.unidad);
      const oldIndex = values.length;
      values.push(nuevaUnidad);
      const newIndex = values.length;
      sets.push(`${column} = CASE WHEN ${sourceColumn} IS NULL THEN NULL ELSE fn_convertir_unidad(${sourceColumn}, $${oldIndex}::unidad_medida, $${newIndex}::unidad_medida) END`);
    };

    if (req.body.nombre !== undefined) addValue('nombre', cleanText(req.body.nombre, { required: true, field: 'un nombre', max: 120 }));
    if (req.body.categoriaId !== undefined) {
      if (!req.body.categoriaId) throw new ApiError(400, 'Selecciona una categoría.');
      const categoriaPropia = await client.query('SELECT id FROM categorias_materia_prima WHERE id = $1 AND sucursal_id = $2', [req.body.categoriaId, req.sucursalId]);
      if (categoriaPropia.rows.length === 0) throw new ApiError(400, 'La categoría no pertenece a esta sucursal.');
      addValue('categoria_id', req.body.categoriaId);
    }
    if (req.body.activo !== undefined) addValue('activo', toBoolean(req.body.activo));
    if (req.body.observaciones !== undefined) addValue('observaciones', cleanText(req.body.observaciones, { field: 'observaciones', max: 500 }));
    if (req.body.proveedorId !== undefined) {
      if (req.body.proveedorId) {
        const proveedorPropio = await client.query('SELECT id FROM proveedores WHERE id = $1 AND sucursal_id = $2', [req.body.proveedorId, req.sucursalId]);
        if (proveedorPropio.rows.length === 0) throw new ApiError(400, 'El proveedor no pertenece a esta sucursal.');
      }
      addValue('proveedor_id', req.body.proveedorId || null);
    }
    if (req.body.requiereLote !== undefined) addValue('requiere_lote', toBoolean(req.body.requiereLote));
    if (req.body.presentacion !== undefined) {
      const unidadFinal = req.body.unidad !== undefined ? normalizeUnidadMedida(req.body.unidad, 'unidad') : current.unidad;
      const pres = await normalizarPresentacion(client, req.body.presentacion, unidadFinal);
      addValue('presentacion_cantidad', pres ? pres.cantidad : null);
      addValue('presentacion_unidad', pres ? pres.unidad : null);
      addValue('presentacion_nombre', pres ? pres.nombre : null);
    }
    if (req.body.requiereCaducidad !== undefined) addValue('requiere_caducidad', toBoolean(req.body.requiereCaducidad));

    if (req.body.unidad !== undefined) {
      nuevaUnidad = normalizeUnidadMedida(req.body.unidad, 'unidad');
      await assertConvertible(client, current.unidad, nuevaUnidad);
      addValue('unidad', nuevaUnidad);
    }

    if (req.body.stockMinimo !== undefined) {
      addValue('stock_minimo', parseNumber(req.body.stockMinimo, 'stock mínimo', { min: 0 }));
    } else if (nuevaUnidad !== current.unidad) {
      addConversion('stock_minimo', 'stock_minimo');
    }

    if (req.body.stockMaximo !== undefined) {
      addValue('stock_maximo', req.body.stockMaximo === null || req.body.stockMaximo === ''
        ? null
        : parseNumber(req.body.stockMaximo, 'stock máximo', { min: 0 }));
    } else if (nuevaUnidad !== current.unidad) {
      addNullableConversion('stock_maximo', 'stock_maximo');
    }

    if (req.body.costoUnitario !== undefined) {
      addValue('costo_unitario', parseNumber(req.body.costoUnitario, 'costo unitario', { min: 0 }));
    } else if (nuevaUnidad !== current.unidad) {
      const factor = await assertConvertible(client, current.unidad, nuevaUnidad);
      addValue('costo_unitario', Number(current.costo_unitario) / factor);
    }

    if (req.body.stockActual !== undefined) {
      if (current.requiere_lote) {
        throw new ApiError(400, 'Este insumo se controla por lote: ajusta el stock registrando compra/lote o merma.');
      }
      addValue('stock_actual', parseNumber(req.body.stockActual, 'stock actual', { min: 0 }));
    } else if (nuevaUnidad !== current.unidad && !current.requiere_lote) {
      addConversion('stock_actual', 'stock_actual');
    }

    if (req.body.categoriasUso !== undefined) {
      await guardarCategoriasUso(client, current.id, req.sucursalId, req.body.categoriasUso);
      if (!sets.length) addValue('nombre', current.nombre);
    }
    if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');

    values.push(req.params.id);
    const idIndex = values.length;

    const { rows } = await client.query(
      `UPDATE materias_primas SET ${sets.join(', ')} WHERE id = $${idIndex} RETURNING *`,
      values
    );

    if (nuevaUnidad !== current.unidad && current.requiere_lote) {
      await client.query(
        `UPDATE materias_primas m
         SET stock_actual = (
           SELECT COALESCE(SUM(fn_convertir_unidad(l.cantidad_disponible, l.unidad, m.unidad)), 0)
           FROM lotes l
           WHERE l.materia_prima_id = m.id
         )
         WHERE m.id = $1`,
        [req.params.id]
      );
      const refreshed = await client.query('SELECT * FROM materias_primas WHERE id = $1', [req.params.id]);
      return refreshed.rows[0];
    }

    return rows[0];
  });

  res.json(updated);
}));

// El intento de borrar informa el bloqueo por historial sin cambiar el estado.
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await withTransaction(client => eliminarMateria(client, {
    id: req.params.id, sucursalId: req.sucursalId, usuarioId: req.auth.id,
    desvincular: req.query.desvincular === 'true',
  }));
  res.json(result);
}));

// Ajuste manual de stock (ej. conteo físico). Queda registrado en
// movimientos_inventario como 'ajuste' para no perder el rastro de por qué
// cambió el número.
router.post('/:id/ajustar-stock', asyncHandler(async (req, res) => {
  const result = await withTransaction(client => ajustarStock(client, {
    ...req.body, id: req.params.id, sucursalId: req.sucursalId, usuarioId: req.auth.id,
  }));

  res.json(result);
}));

// Salida sin venta: surtir consumibles de mesa (azúcar, salsas…), consumo del
// personal o uso interno. Entra al costo de ventas como su propia línea.
router.post('/:id/salida-interna', asyncHandler(async (req, res) => {
  const result = await withTransaction(client => registrarSalidaInterna(client, {
    id: req.params.id, sucursalId: req.sucursalId, usuarioId: req.auth.id,
    cantidad: req.body.cantidad, motivo: req.body.motivo, nota: req.body.nota,
  }));
  res.json(result);
}));

// Registrar una compra (lote nuevo). Si el lote viene en otra unidad compatible
// (ej. compra en kg, inventario visible en g), se conserva la unidad del lote y
// el stock visible se recalcula convertido a la unidad de la materia prima.
// Registrar compra: cantidad + unidad (en la que venga) o N paquetes de la
// presentación del insumo; el costo unitario se deriva del total pagado.
router.post('/:id/lotes', asyncHandler(async (req, res) => {
  const result = await withTransaction(client => registrarCompra(client, { materiaId: req.params.id, sucursalId: req.sucursalId, usuarioId: req.auth.id, body: req.body }));
  res.status(201).json(result);
}));

module.exports = router;
