const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/', asyncHandler(async (req, res) => {
  const { categoria } = req.query;
  const condiciones = [];
  const values = [];
  if (categoria) { values.push(categoria); condiciones.push(`cm.nombre = $${values.length}`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
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
  const { rows } = await query('SELECT * FROM vw_stock_bajo');
  res.json(rows);
}));

router.get('/categorias', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM categorias_materia_prima ORDER BY nombre');
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, categoriaId, unidad, stockActual, stockMinimo, costoUnitario, proveedorId, requiereLote, requiereCaducidad } = req.body;
  if (!nombre?.trim()) throw new ApiError(400, 'Ingresa un nombre.');
  if (!categoriaId) throw new ApiError(400, 'Selecciona una categoría.');
  const { rows } = await query(
    `INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, proveedor_id, requiere_lote, requiere_caducidad)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [nombre.trim(), categoriaId, unidad, stockActual || 0, stockMinimo || 0, costoUnitario || 0, proveedorId || null, !!requiereLote, !!requiereCaducidad]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const mapeo = {
    nombre: 'nombre', categoriaId: 'categoria_id', unidad: 'unidad', stockMinimo: 'stock_minimo',
    costoUnitario: 'costo_unitario', proveedorId: 'proveedor_id', activo: 'activo', observaciones: 'observaciones',
  };
  const sets = [];
  const values = [];
  let i = 1;
  for (const [campoApi, columna] of Object.entries(mapeo)) {
    if (req.body[campoApi] !== undefined) { sets.push(`${columna} = $${i++}`); values.push(req.body[campoApi]); }
  }
  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE materias_primas SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (rows.length === 0) throw new ApiError(404, 'Materia prima no encontrada.');
  res.json(rows[0]);
}));

// Ajuste manual de stock (ej. conteo físico). Queda registrado en
// movimientos_inventario como 'ajuste' para no perder el rastro de por qué
// cambió el número.
router.post('/:id/ajustar-stock', asyncHandler(async (req, res) => {
  const { nuevaCantidad, motivo } = req.body;
  if (nuevaCantidad === undefined || nuevaCantidad < 0) throw new ApiError(400, 'Indica la nueva cantidad (no negativa).');

  const actual = await query('SELECT stock_actual, requiere_lote FROM materias_primas WHERE id = $1', [req.params.id]);
  if (actual.rows.length === 0) throw new ApiError(404, 'Materia prima no encontrada.');
  if (actual.rows[0].requiere_lote) {
    throw new ApiError(400, 'Este insumo se controla por lote: registra una compra (lote) o una merma en vez de ajustar el stock directo.');
  }

  const diferencia = nuevaCantidad - Number(actual.rows[0].stock_actual);
  const { rows } = await query('UPDATE materias_primas SET stock_actual = $1 WHERE id = $2 RETURNING *', [nuevaCantidad, req.params.id]);
  await query(
    `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, usuario_id, motivo) VALUES ($1,'ajuste',$2,$3,$4)`,
    [req.params.id, diferencia, req.auth.id, motivo || 'Ajuste manual de stock']
  );
  res.json(rows[0]);
}));

// Registrar una compra (lote nuevo). Para insumos sin requiereLote, también
// suma directo a stock_actual.
router.post('/:id/lotes', asyncHandler(async (req, res) => {
  const { cantidadComprada, unidad, costoTotal, proveedorId, numeroLote, fechaCaducidad } = req.body;
  if (!cantidadComprada || cantidadComprada <= 0) throw new ApiError(400, 'Indica una cantidad comprada mayor a 0.');
  if (costoTotal === undefined || costoTotal < 0) throw new ApiError(400, 'Indica el costo total de la compra.');

  const materia = await query('SELECT requiere_lote FROM materias_primas WHERE id = $1', [req.params.id]);
  if (materia.rows.length === 0) throw new ApiError(404, 'Materia prima no encontrada.');

  const { rows } = await query(
    `INSERT INTO lotes (materia_prima_id, numero_lote, fecha_caducidad, cantidad_comprada, cantidad_disponible, unidad, costo_total, proveedor_id, usuario_id)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.id, numeroLote || null, fechaCaducidad || null, cantidadComprada, unidad, costoTotal, proveedorId || null, req.auth.id]
  );

  if (materia.rows[0].requiere_lote) {
    await query(
      `UPDATE materias_primas SET stock_actual = (SELECT COALESCE(SUM(cantidad_disponible),0) FROM lotes WHERE materia_prima_id = $1) WHERE id = $1`,
      [req.params.id]
    );
  } else {
    await query('UPDATE materias_primas SET stock_actual = stock_actual + $1 WHERE id = $2', [cantidadComprada, req.params.id]);
    await query(
      `INSERT INTO movimientos_inventario (materia_prima_id, tipo, cantidad, lote_id, usuario_id) VALUES ($1,'compra',$2,$3,$4)`,
      [req.params.id, cantidadComprada, rows[0].id, req.auth.id]
    );
  }
  res.status(201).json(rows[0]);
}));

module.exports = router;
