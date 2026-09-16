const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');

const A = require('../services/accounting');

const CATEGORIAS = ['Renta', 'Personal', 'Servicios', 'Transporte', 'Seguros', 'Mantenimiento', 'Financiero', 'Impuestos', 'Otro'];
const CLAVE_POR_CATEGORIA = { Renta: 'renta', Personal: 'sueldos', Servicios: 'servicios', Transporte: 'transporte', Seguros: 'seguros', Mantenimiento: 'mantenimiento', Financiero: 'prestamo', Impuestos: 'impuestos', Otro: 'otros_gastos' };
function validarDiaPago(v) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 28) throw new ApiError(400, 'El día de pago debe estar entre 1 y 28.');
  return n;
}

const router = express.Router();
router.use(requireAuth, requireRole('admin'), resolveSucursal);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT g.*, c.nombre AS cuenta_nombre, d.nombre AS cuenta_dinero_nombre FROM gastos_fijos g
     LEFT JOIN cuentas_contables c ON c.id = g.cuenta_contable_id LEFT JOIN cuentas_dinero d ON d.id = g.cuenta_dinero_id
     WHERE g.sucursal_id = $1 ORDER BY g.categoria, g.concepto`, [req.sucursalId]);
  res.json(rows);
}));

router.get('/total-mensual', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT fn_gastos_fijos_totales_mes($1) AS total', [req.sucursalId]);
  res.json({ total: rows[0].total });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { concepto, categoria, montoMensual } = req.body;
  if (!concepto?.trim()) throw new ApiError(400, 'Describe el gasto (ej. "Renta del local").');
  if (montoMensual === undefined || montoMensual < 0) throw new ApiError(400, 'Indica el monto mensual.');
  const cat = categoria || 'Otro';
  if (!CATEGORIAS.includes(cat)) throw new ApiError(400, 'Categoría inválida.');
  // Cuenta contable: la elegida o la que corresponde a la categoría.
  const cuenta = req.body.cuentaContableId ? await A.validarCuentaContable(query, req.sucursalId, req.body.cuentaContableId) : await A.cuentaPorClave(query, req.sucursalId, CLAVE_POR_CATEGORIA[cat]);
  const cuentaDinero = await A.validarCuentaDinero(query, req.sucursalId, req.body.cuentaDineroId);
  const { rows } = await query(
    'INSERT INTO gastos_fijos (concepto, categoria, monto_mensual, sucursal_id, cuenta_contable_id, cuenta_dinero_id, dia_pago) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [concepto.trim(), cat, montoMensual, req.sucursalId, cuenta.id, cuentaDinero ? cuentaDinero.id : null, validarDiaPago(req.body.diaPago) ?? 1]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const mapeo = { concepto: 'concepto', categoria: 'categoria', montoMensual: 'monto_mensual', activo: 'activo' };
  const sets = [];
  const values = [];
  let i = 1;
  if (req.body.categoria !== undefined && !CATEGORIAS.includes(req.body.categoria)) throw new ApiError(400, 'Categoría inválida.');
  for (const [campoApi, columna] of Object.entries(mapeo)) {
    if (req.body[campoApi] !== undefined) { sets.push(`${columna} = $${i++}`); values.push(req.body[campoApi]); }
  }
  if (req.body.cuentaContableId !== undefined) { sets.push(`cuenta_contable_id = $${i++}`); values.push((await A.validarCuentaContable(query, req.sucursalId, req.body.cuentaContableId)).id); }
  else if (req.body.categoria !== undefined) { sets.push(`cuenta_contable_id = $${i++}`); values.push((await A.cuentaPorClave(query, req.sucursalId, CLAVE_POR_CATEGORIA[req.body.categoria])).id); }
  if (req.body.cuentaDineroId !== undefined) { const cd = await A.validarCuentaDinero(query, req.sucursalId, req.body.cuentaDineroId); sets.push(`cuenta_dinero_id = $${i++}`); values.push(cd ? cd.id : null); }
  if (req.body.diaPago !== undefined) { sets.push(`dia_pago = $${i++}`); values.push(validarDiaPago(req.body.diaPago)); }
  if (sets.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar.');
  values.push(req.params.id, req.sucursalId);
  const { rows } = await query(
    `UPDATE gastos_fijos SET ${sets.join(', ')} WHERE id = $${i} AND sucursal_id = $${i + 1} RETURNING *`,
    values
  );
  if (rows.length === 0) throw new ApiError(404, 'Gasto no encontrado.');
  res.json(rows[0]);
}));

// Un gasto fijo no deja historial en otras tablas (no hay FKs hacia él), así
// que se puede borrar de verdad. "Desactivar" queda para pausas temporales
// (ej. un gasto de temporada) sin perder el dato.
router.delete('/:id', asyncHandler(async (req, res) => {
  const { rows: [uso] } = await query('SELECT COUNT(*) AS n FROM egresos WHERE gasto_fijo_id = $1', [req.params.id]);
  if (Number(uso.n) > 0) throw new ApiError(409, 'Este gasto ya tiene pagos registrados en Contabilidad; desactívalo en lugar de borrarlo.');
  const { rows } = await query('DELETE FROM gastos_fijos WHERE id = $1 AND sucursal_id = $2 RETURNING id', [req.params.id, req.sucursalId]);
  if (rows.length === 0) throw new ApiError(404, 'Gasto no encontrado.');
  res.json({ id: rows[0].id, eliminado: true });
}));

module.exports = router;
