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

const { eliminarMateria } = require('../services/deleteMateria');

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
    `SELECT m.*, cm.nombre AS categoria, p.nombre AS proveedor
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

  const { rows } = await query(
    `INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id, requiere_lote, requiere_caducidad, sucursal_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      nombreLimpio,
      categoriaId,
      unidadNormalizada,
      parseNumber(stockActual, 'stock actual', { min: 0 }) ?? 0,
      parseNumber(stockMinimo, 'stock mínimo', { min: 0 }) ?? 0,
      parseNumber(costoUnitario, 'costo unitario', { min: 0 }) ?? 0,
      proveedorId || null,
      toBoolean(requiereLote) ?? false,
      toBoolean(requiereCaducidad) ?? false,
      req.sucursalId,
    ]
  );
  res.status(201).json(rows[0]);
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
  const { nuevaCantidad, motivo } = req.body;
  const cantidad = parseNumber(nuevaCantidad, 'la nueva cantidad', { required: true, min: 0 });

  const result = await withTransaction(async client => {
    const actual = await client.query('SELECT stock_actual, requiere_lote FROM materias_primas WHERE id = $1 AND sucursal_id = $2 FOR UPDATE', [req.params.id, req.sucursalId]);
    if (actual.rows.length === 0) throw new ApiError(404, 'Materia prima no encontrada.');
    if (actual.rows[0].requiere_lote) {
      throw new ApiError(400, 'Este insumo se controla por lote: registra una compra (lote) o una merma en vez de ajustar el stock directo.');
    }

    const diferencia = cantidad - Number(actual.rows[0].stock_actual);
    const { rows } = await client.query('UPDATE materias_primas SET stock_actual = $1 WHERE id = $2 RETURNING *', [cantidad, req.params.id]);
    await client.query(
      `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, usuario_id, motivo) VALUES ($1,'ajuste',$2,$3,$4)`,
      [req.params.id, diferencia, req.auth.id, cleanText(motivo, { field: 'motivo', max: 500 }) || 'Ajuste manual de stock']
    );
    return rows[0];
  });

  res.json(result);
}));

// Registrar una compra (lote nuevo). Si el lote viene en otra unidad compatible
// (ej. compra en kg, inventario visible en g), se conserva la unidad del lote y
// el stock visible se recalcula convertido a la unidad de la materia prima.
router.post('/:id/lotes', asyncHandler(async (req, res) => {
  const { cantidadComprada, unidad, costoTotal, proveedorId, numeroLote, fechaCaducidad } = req.body;
  const cantidad = parseNumber(cantidadComprada, 'cantidad comprada', { required: true, min: 0 });
  if (cantidad <= 0) throw new ApiError(400, 'Indica una cantidad comprada mayor a 0.');
  const costo = parseNumber(costoTotal, 'costo total', { required: true, min: 0 });

  const result = await withTransaction(async client => {
    const materia = await client.query('SELECT requiere_lote, unidad FROM materias_primas WHERE id = $1 AND sucursal_id = $2 FOR UPDATE', [req.params.id, req.sucursalId]);
    if (materia.rows.length === 0) throw new ApiError(404, 'Materia prima no encontrada.');
    const unidadLote = normalizeUnidadMedida(unidad, 'unidad del lote') || materia.rows[0].unidad;
    await assertConvertible(client, unidadLote, materia.rows[0].unidad);
    if (proveedorId) {
      const proveedorPropio = await client.query('SELECT id FROM proveedores WHERE id = $1 AND sucursal_id = $2', [proveedorId, req.sucursalId]);
      if (proveedorPropio.rows.length === 0) throw new ApiError(400, 'El proveedor no pertenece a esta sucursal.');
    }

    const { rows } = await client.query(
      `INSERT INTO lotes (materia_prima_id, numero_lote, fecha_caducidad, cantidad_comprada, cantidad_disponible, unidad, costo_total, proveedor_id, usuario_id)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.params.id,
        cleanText(numeroLote, { field: 'número de lote', max: 120 }),
        fechaCaducidad || null,
        cantidad,
        unidadLote,
        costo,
        proveedorId || null,
        req.auth.id,
      ]
    );

    // El costo de ESTA compra pasa a ser el costo de referencia del insumo
    // (convertido a su unidad). Es lo que hace que, si el proveedor subió el
    // precio, el costo de las recetas cambie y "precios por revisar" avise.
    const unitarioLote = costo / cantidad; // $ por unidad del lote
    const unoConvertido = await client.query(
      'SELECT fn_convertir_unidad(1, $1::unidad_medida, $2::unidad_medida) AS factor',
      [materia.rows[0].unidad, unidadLote]
    );
    const factor = Number(unoConvertido.rows[0].factor); // unidades de lote por 1 unidad de stock
    if (Number.isFinite(factor) && factor > 0 && cantidad > 0 && costo > 0) {
      await client.query('UPDATE materias_primas SET costo_unitario = $1 WHERE id = $2',
        [Math.round(unitarioLote * factor * 10000) / 10000, req.params.id]);
    }

    if (materia.rows[0].requiere_lote) {
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
    } else {
      const convertido = await client.query(
        'SELECT fn_convertir_unidad($1, $2::unidad_medida, $3::unidad_medida) AS cantidad',
        [cantidad, unidadLote, materia.rows[0].unidad]
      );
      const cantidadStock = Number(convertido.rows[0].cantidad);
      await client.query('UPDATE materias_primas SET stock_actual = stock_actual + $1 WHERE id = $2', [cantidadStock, req.params.id]);
      await client.query(
        `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, usuario_id) VALUES ($1,'compra',$2,$3,$4)`,
        [req.params.id, cantidadStock, rows[0].id, req.auth.id]
      );
    }
    return rows[0];
  });

  res.status(201).json(result);
}));

module.exports = router;
