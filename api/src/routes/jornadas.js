const express = require('express');
const { query, withTransaction } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal } = require('../middleware/auth');
const J = require('../services/jornadas');

// JORNADAS (migración 50): horas trabajadas del personal que se paga por hora y
// su pago semanal. "Turno" es el turno de CAJA; esto es otra cosa. Ver
// services/jornadas.js para las reglas completas.
const router = express.Router();
router.use(requireAuth, requireRole('admin', 'cajero', 'barista'), resolveSucursal);

// ---- Mi jornada (cada persona ve y mueve SOLO la suya) -------------------------------------------
// Estado completo: jornada en curso, si está en pausa, tarifa y la semana (hoy y acumulado).
router.get('/actual', asyncHandler(async (req, res) => res.json(await J.estadoActual(query, req.auth.id))));

// Mi semana (domingo a sábado): ?fecha=AAAA-MM-DD cualquier día de la semana que quieras ver.
router.get('/mias', asyncHandler(async (req, res) => {
  const estado = await J.estadoActual(query, req.auth.id);
  if (!estado.aplica) return res.json({ aplica: false });
  res.json({ aplica: true, ...(await J.resumenPersona(query, req.auth.id, req.query.fecha || null)) });
}));

// La entrada también se registra sola al iniciar sesión; esto es por si hace falta pedirla (idempotente).
router.post('/iniciar', asyncHandler(async (req, res) => {
  const r = await withTransaction(c => J.iniciarJornada(c, { usuarioId: req.auth.id }));
  res.json(r ? { aplica: true, ...r } : { aplica: false });
}));

// "Salir" y "Regresar": pausa sin goce de sueldo dentro de la jornada.
router.post('/pausa/salir', asyncHandler(async (req, res) => {
  res.json({ jornada: await withTransaction(c => J.iniciarPausa(c, { usuarioId: req.auth.id })) });
}));
router.post('/pausa/regresar', asyncHandler(async (req, res) => {
  res.json({ jornada: await withTransaction(c => J.terminarPausa(c, { usuarioId: req.auth.id })) });
}));

// "¿Terminaste tu turno?" → Sí. Cierra con la hora del servidor y responde lo que cobraría hoy y en la semana.
router.post('/terminar', asyncHandler(async (req, res) => {
  const jornada = await withTransaction(c => J.terminarJornada(c, { usuarioId: req.auth.id }));
  res.json({ jornada, resumen: await J.resumenPersona(query, req.auth.id, jornada.fecha) });
}));

// ---- Administración -----------------------------------------------------------------------------
const admin = express.Router();
admin.use(requireRole('admin'));

// Semana (domingo a sábado) de todo el personal por hora, con pendientes y totales.
admin.get('/semana', asyncHandler(async (req, res) => res.json(await J.semanaAdmin(query, req.sucursalId, req.query.fecha || null))));

// Bitácora del pago de horas.
admin.get('/pagos', asyncHandler(async (req, res) => {
  res.json(await J.listarPagos(query, req.sucursalId, { usuarioId: req.query.usuarioId || null }));
}));

// Registrar el pago de la semana de una persona: crea el egreso en Sueldos y salarios.
admin.post('/pagos', asyncHandler(async (req, res) => {
  res.status(201).json(await withTransaction(c => J.pagarHoras(c, { sucursalId: req.sucursalId, adminId: req.auth.id, body: req.body })));
}));

// Jornada capturada a mano (un día que no se registró).
admin.post('/manual', asyncHandler(async (req, res) => {
  res.status(201).json(await withTransaction(c => J.crearJornadaManual(c, { sucursalId: req.sucursalId, adminId: req.auth.id, body: req.body })));
}));

// Corregir o aprobar una jornada (motivo obligatorio).
admin.patch('/:id', asyncHandler(async (req, res) => {
  res.json(await withTransaction(c => J.corregirJornada(c, { sucursalId: req.sucursalId, adminId: req.auth.id, id: req.params.id, body: req.body })));
}));

// Anular una jornada (motivo obligatorio). Nada se borra.
admin.post('/:id/anular', asyncHandler(async (req, res) => {
  res.json(await withTransaction(c => J.anularJornada(c, { sucursalId: req.sucursalId, adminId: req.auth.id, id: req.params.id, motivo: req.body.motivo })));
}));

router.use('/admin', admin);

module.exports = router;
