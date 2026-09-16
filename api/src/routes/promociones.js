const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, resolveSucursalPublico } = require('../middleware/auth');

const router = express.Router();

// GET es público POR SEDE: el cliente necesita el premio/umbral de SU
// cafetería para mostrar su tarjeta de fidelidad sin ser admin.
router.get('/fidelidad', resolveSucursalPublico, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT pf.*, p.nombre AS premio_nombre, p.icono AS premio_icono
     FROM promocion_fidelidad pf JOIN productos p ON p.id = pf.producto_premio_id
     WHERE pf.sucursal_id = $1
     ORDER BY pf.actualizado_en DESC LIMIT 1`,
    [req.sucursalId]
  );
  res.json(rows[0] || null);
}));

router.put('/fidelidad', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const { activo, cadaNPedidos, productoPremioId } = req.body;
  if (!cadaNPedidos || cadaNPedidos < 2) throw new ApiError(400, 'cadaNPedidos debe ser al menos 2.');
  if (!productoPremioId) throw new ApiError(400, 'Selecciona el producto premio.');

  // El premio debe ser un producto de ESTA sede (el trigger de la base lo
  // vuelve a verificar, pero aquí el error es más claro).
  const premio = await query('SELECT id FROM productos WHERE id = $1 AND sucursal_id = $2', [productoPremioId, req.sucursalId]);
  if (premio.rows.length === 0) throw new ApiError(400, 'El producto premio no pertenece a esta sucursal.');

  const existe = await query('SELECT id FROM promocion_fidelidad WHERE sucursal_id = $1 LIMIT 1', [req.sucursalId]);
  let id;
  if (existe.rows.length > 0) {
    await query(
      'UPDATE promocion_fidelidad SET activo=$1, cada_n_pedidos=$2, producto_premio_id=$3, actualizado_por=$4, actualizado_en=now() WHERE id=$5',
      [!!activo, cadaNPedidos, productoPremioId, req.auth.id, existe.rows[0].id]
    );
    id = existe.rows[0].id;
  } else {
    const creado = await query(
      'INSERT INTO promocion_fidelidad (activo, cada_n_pedidos, producto_premio_id, actualizado_por, sucursal_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [!!activo, cadaNPedidos, productoPremioId, req.auth.id, req.sucursalId]
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

// Promociones de apertura: vigencia por fecha, POR SEDE.
router.get('/apertura', resolveSucursalPublico, asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM promociones_apertura WHERE sucursal_id = $1 ORDER BY fecha_inicio DESC',
    [req.sucursalId]
  );
  res.json(rows);
}));

router.post('/apertura', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const { nombre, fechaInicio, fechaFin, porcentajeDescuento, productos } = req.body;
  if (!nombre?.trim()) throw new ApiError(400, 'Ingresa un nombre para la promoción.');
  if (!fechaInicio || !fechaFin) throw new ApiError(400, 'Indica fecha de inicio y de fin.');

  const { rows } = await query(
    'INSERT INTO promociones_apertura (nombre, fecha_inicio, fecha_fin, porcentaje_descuento, sucursal_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [nombre.trim(), fechaInicio, fechaFin, porcentajeDescuento || null, req.sucursalId]
  );
  const promo = rows[0];

  if (Array.isArray(productos)) {
    for (const p of productos) {
      // El trigger de la base rechaza productos de otra sede.
      // eslint-disable-next-line no-await-in-loop
      await query('INSERT INTO promocion_apertura_productos (promocion_id, producto_id, precio_especial) VALUES ($1,$2,$3)', [promo.id, p.productoId, p.precioEspecial]);
    }
  }
  res.status(201).json(promo);
}));

router.patch('/apertura/:id', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const { activo } = req.body;
  if (activo === undefined) throw new ApiError(400, 'Solo se puede actualizar "activo" en este endpoint.');
  const { rows } = await query(
    'UPDATE promociones_apertura SET activo=$1 WHERE id=$2 AND sucursal_id=$3 RETURNING *',
    [!!activo, req.params.id, req.sucursalId]
  );
  if (rows.length === 0) throw new ApiError(404, 'Promoción no encontrada.');
  res.json(rows[0]);
}));

// Configuración de margen: usada por fn_precio_sugerido, POR SEDE.
router.get('/margen', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const config = await query('SELECT * FROM configuracion_margen WHERE sucursal_id = $1 ORDER BY actualizado_en DESC LIMIT 1', [req.sucursalId]);
  const real = await query('SELECT * FROM vw_ventas_reales_promedio_mes WHERE sucursal_id = $1', [req.sucursalId]);
  res.json({ ...(config.rows[0] || null), ventas_reales_promedio_mes: real.rows[0] });
}));

router.put('/margen', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const { porcentajeGananciaNormal, redondeo, unidadesEstimadasMes } = req.body;
  // Es margen de CONTRIBUCIÓN: precio = insumo / (1 - margen), así que 100 no
  // existe (sería dividir entre cero) y 0 significaría vender al costo.
  const margen = porcentajeGananciaNormal === undefined || porcentajeGananciaNormal === null || porcentajeGananciaNormal === ''
    ? 60 : Number(porcentajeGananciaNormal);
  if (!Number.isFinite(margen) || margen <= 0 || margen >= 100) {
    throw new ApiError(400, 'El margen de contribución general debe ser un porcentaje mayor que 0 y menor que 100.');
  }
  const { rows } = await query(
    'INSERT INTO configuracion_margen (porcentaje_ganancia_normal, redondeo, unidades_estimadas_mes, actualizado_por, sucursal_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [Math.round(margen * 100) / 100, redondeo ?? 1, unidadesEstimadasMes || null, req.auth.id, req.sucursalId]
  );
  res.json(rows[0]);
}));

// PESOS POR ESTACIÓN: cuánto del local y del tiempo consume un producto según
// dónde se prepara. Solo reparte los gastos fijos costeables para calcular el
// PISO de cada precio; no se cobra al cliente.
router.get('/pesos-estacion', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT pe.estacion, pe.peso,
            (SELECT COUNT(*)::int FROM productos p WHERE p.sucursal_id = pe.sucursal_id AND p.activo AND COALESCE(p.estacion,'barra') = pe.estacion) AS productos
       FROM pesos_estacion pe WHERE pe.sucursal_id = $1 ORDER BY pe.estacion`, [req.sucursalId]);
  const { rows: [fijos] } = await query(
    'SELECT fn_gastos_fijos_totales_mes($1) AS totales, fn_gastos_fijos_costeables_mes($1) AS costeables', [req.sucursalId]);
  res.json({ pesos: rows, gastosFijosMes: Number(fijos.totales), gastosFijosCosteablesMes: Number(fijos.costeables) });
}));

router.put('/pesos-estacion', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const pesos = Array.isArray(req.body.pesos) ? req.body.pesos : [];
  if (!pesos.length) throw new ApiError(400, 'Envía los pesos por estación.');
  for (const p of pesos) {
    const n = Number(p.peso);
    if (!p.estacion || typeof p.estacion !== 'string') throw new ApiError(400, 'Cada peso necesita su estación.');
    if (!Number.isFinite(n) || n < 0 || n > 20) throw new ApiError(400, 'El peso de una estación debe ir de 0 a 20 (1 = una unidad normal).');
  }
  await withTransaction(async client => {
    for (const p of pesos) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO pesos_estacion (sucursal_id, estacion, peso, actualizado_en) VALUES ($1,$2,$3,now())
         ON CONFLICT (sucursal_id, estacion) DO UPDATE SET peso = EXCLUDED.peso, actualizado_en = now()`,
        [req.sucursalId, String(p.estacion).trim().toLowerCase(), Math.round(Number(p.peso) * 100) / 100]);
    }
  });
  const { rows } = await query('SELECT estacion, peso FROM pesos_estacion WHERE sucursal_id = $1 ORDER BY estacion', [req.sucursalId]);
  res.json(rows);
}));

// Punto de equilibrio DE ESTA SEDE: cuántas bebidas hay que vender al mes/día
// para cubrir SUS gastos fijos con el margen promedio de SU catálogo.
router.get('/punto-equilibrio', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vw_punto_equilibrio_negocio WHERE sucursal_id = $1', [req.sucursalId]);
  res.json(rows[0] || null);
}));

module.exports = router;
