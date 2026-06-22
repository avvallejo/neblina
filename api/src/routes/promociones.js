const express = require('express');
const { query } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET es público: el cliente necesita saber el premio/umbral para mostrar su
// tarjeta de fidelidad sin tener que ser admin.
router.get('/fidelidad', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT pf.*, p.nombre AS premio_nombre, p.icono AS premio_icono
     FROM promocion_fidelidad pf JOIN productos p ON p.id = pf.producto_premio_id
     ORDER BY pf.actualizado_en DESC LIMIT 1`
  );
  res.json(rows[0] || null);
}));

router.put('/fidelidad', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { activo, cadaNPedidos, productoPremioId } = req.body;
  if (!cadaNPedidos || cadaNPedidos < 2) throw new ApiError(400, 'cadaNPedidos debe ser al menos 2.');
  if (!productoPremioId) throw new ApiError(400, 'Selecciona el producto premio.');

  const existe = await query('SELECT id FROM promocion_fidelidad LIMIT 1');
  let id;
  if (existe.rows.length > 0) {
    await query(
      'UPDATE promocion_fidelidad SET activo=$1, cada_n_pedidos=$2, producto_premio_id=$3, actualizado_por=$4, actualizado_en=now() WHERE id=$5',
      [!!activo, cadaNPedidos, productoPremioId, req.auth.id, existe.rows[0].id]
    );
    id = existe.rows[0].id;
  } else {
    const creado = await query(
      'INSERT INTO promocion_fidelidad (activo, cada_n_pedidos, producto_premio_id, actualizado_por) VALUES ($1,$2,$3,$4) RETURNING id',
      [!!activo, cadaNPedidos, productoPremioId, req.auth.id]
    );
    id = creado.rows[0].id;
  }
  const { rows } = await query(
    `SELECT pf.*, p.nombre AS premio_nombre, p.icono AS premio_icono
     FROM promocion_fidelidad pf JOIN productos p ON p.id = pf.producto_premio_id WHERE pf.id = $1`,
    [id]
  );
  res.json(rows[0]);
}));

// Promociones de apertura (Fase 2 del requerimiento): vigencia por fecha.
router.get('/apertura', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM promociones_apertura ORDER BY fecha_inicio DESC');
  res.json(rows);
}));

router.post('/apertura', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { nombre, fechaInicio, fechaFin, porcentajeDescuento, productos } = req.body;
  if (!nombre?.trim()) throw new ApiError(400, 'Ingresa un nombre para la promoción.');
  if (!fechaInicio || !fechaFin) throw new ApiError(400, 'Indica fecha de inicio y de fin.');

  const { rows } = await query(
    'INSERT INTO promociones_apertura (nombre, fecha_inicio, fecha_fin, porcentaje_descuento) VALUES ($1,$2,$3,$4) RETURNING *',
    [nombre.trim(), fechaInicio, fechaFin, porcentajeDescuento || null]
  );
  const promo = rows[0];

  if (Array.isArray(productos)) {
    for (const p of productos) {
      // eslint-disable-next-line no-await-in-loop
      await query('INSERT INTO promocion_apertura_productos (promocion_id, producto_id, precio_especial) VALUES ($1,$2,$3)', [promo.id, p.productoId, p.precioEspecial]);
    }
  }
  res.status(201).json(promo);
}));

router.patch('/apertura/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { activo } = req.body;
  if (activo === undefined) throw new ApiError(400, 'Solo se puede actualizar "activo" en este endpoint.');
  const { rows } = await query('UPDATE promociones_apertura SET activo=$1 WHERE id=$2 RETURNING *', [!!activo, req.params.id]);
  if (rows.length === 0) throw new ApiError(404, 'Promoción no encontrada.');
  res.json(rows[0]);
}));

// Configuración de margen (Fase 2): usada por fn_precio_sugerido.
router.get('/margen', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = await query('SELECT * FROM configuracion_margen ORDER BY actualizado_en DESC LIMIT 1');
  const real = await query('SELECT * FROM vw_ventas_reales_promedio_mes');
  res.json({ ...(config.rows[0] || null), ventas_reales_promedio_mes: real.rows[0] });
}));

router.put('/margen', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { porcentajeGananciaNormal, redondeo, unidadesEstimadasMes } = req.body;
  const { rows } = await query(
    'INSERT INTO configuracion_margen (porcentaje_ganancia_normal, redondeo, unidades_estimadas_mes, actualizado_por) VALUES ($1,$2,$3,$4) RETURNING *',
    [porcentajeGananciaNormal ?? 60, redondeo ?? 1, unidadesEstimadasMes || null, req.auth.id]
  );
  res.json(rows[0]);
}));

// Punto de equilibrio del negocio completo: cuántas bebidas hay que vender al
// mes/día para cubrir TODOS los gastos fijos con el margen de contribución
// promedio del catálogo activo.
router.get('/punto-equilibrio', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vw_punto_equilibrio_negocio');
  res.json(rows[0]);
}));

module.exports = router;
