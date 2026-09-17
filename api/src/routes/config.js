const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, resolveSucursalPublico } = require('../middleware/auth');
const { CLAVE_CUPO, normalizarCupo, MAX_CUPO } = require('../services/courtesies');
const { CLAVE_MESAS, normalizarMesas, MESAS_DEFAULT, MAX_MESAS } = require('../services/stations');

const { normalizarPantallaPersonalizacion } = require('../services/tvMenuConfig');

const router = express.Router();

// Claves de configuración del negocio (en BD) que expone la app. Cada sede
// tiene las suyas: nombre, logo y verificación por SMS son POR SUCURSAL.
const CLAVES = ['sms_verificacion', 'nombre_negocio', 'logo', 'lema', 'pie_pantalla', 'pantalla_estilo', 'pantalla_personalizacion', CLAVE_CUPO, CLAVE_MESAS];

// Lee la config de UNA sede y la entrega con nombres amigables para el front.
async function leerConfig(sucursalId) {
  const { rows } = await query(
    'SELECT clave, valor FROM configuracion WHERE sucursal_id = $1 AND clave = ANY($2)',
    [sucursalId, CLAVES]
  );
  const map = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  return {
    // Sin fila explícita, el SMS se asume ACTIVO (modo seguro, igual que la
    // migración 10 y el alta de sedes nuevas).
    smsVerificacion: !(map.sms_verificacion === false),
    nombreNegocio: typeof map.nombre_negocio === 'string' ? map.nombre_negocio : '',
    logo: typeof map.logo === 'string' ? map.logo : '',
    // Pantalla del negocio (TV): frase bajo el nombre, pie de página y estilo.
    lema: typeof map.lema === 'string' ? map.lema : '',
    piePantalla: typeof map.pie_pantalla === 'string' ? map.pie_pantalla : '',
    pantallaEstilo: ['clasico','ilustrado'].includes(map.pantalla_estilo) ? map.pantalla_estilo : 'pizarra',
    pantallaPersonalizacion: normalizarPantallaPersonalizacion(map.pantalla_personalizacion),
    // Cortesías: cupo mensual COMPARTIDO por sucursal para el rol cajero.
    // Sin fila = 0 (toda cortesía requiere autorización del administrador).
    cortesiasMesCajero: Number.isInteger(Number(map[CLAVE_CUPO])) && Number(map[CLAVE_CUPO]) >= 0 ? Math.min(Number(map[CLAVE_CUPO]), MAX_CUPO) : 0,
    // Mesas de la sede (destino del pedido en Caja): Mesa 1..N; sin fila = 4.
    mesas: map[CLAVE_MESAS] !== undefined && Number.isInteger(Number(map[CLAVE_MESAS])) && Number(map[CLAVE_MESAS]) >= 0 ? Math.min(Number(map[CLAVE_MESAS]), MAX_MESAS) : MESAS_DEFAULT,
  };
}

async function guardar(sucursalId, clave, valor) {
  await query(
    `INSERT INTO configuracion (sucursal_id, clave, valor, actualizado_en) VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (sucursal_id, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
    [sucursalId, clave, JSON.stringify(valor)]
  );
}

// Público: el cliente necesita el nombre/logo (marca) de SU sede y saber si
// debe verificar su teléfono por SMS, ANTES de loguearse.
// GET /api/config?sucursal=<id>
router.get('/', resolveSucursalPublico, asyncHandler(async (req, res) => {
  res.json(await leerConfig(req.sucursalId));
}));

// Solo admin (el de la sede, o el general eligiendo sede con X-Sucursal-Id).
// Actualiza ÚNICAMENTE los campos enviados (parcial).
router.put('/', requireAuth, requireRole('admin'), resolveSucursal, asyncHandler(async (req, res) => {
  if ('smsVerificacion' in req.body) await guardar(req.sucursalId, 'sms_verificacion', !!req.body.smsVerificacion);
  if ('nombreNegocio' in req.body) await guardar(req.sucursalId, 'nombre_negocio', String(req.body.nombreNegocio || '').slice(0, 60));
  if ('logo' in req.body) await guardar(req.sucursalId, 'logo', String(req.body.logo || ''));
  if ('lema' in req.body) await guardar(req.sucursalId, 'lema', String(req.body.lema || '').slice(0, 80));
  if ('piePantalla' in req.body) await guardar(req.sucursalId, 'pie_pantalla', String(req.body.piePantalla || '').slice(0, 120));
  if ('pantallaEstilo' in req.body) await guardar(req.sucursalId, 'pantalla_estilo', ['clasico','ilustrado'].includes(req.body.pantallaEstilo) ? req.body.pantallaEstilo : 'pizarra');
  if ('pantallaPersonalizacion' in req.body) await guardar(req.sucursalId, 'pantalla_personalizacion', normalizarPantallaPersonalizacion(req.body.pantallaPersonalizacion));
  if ('cortesiasMesCajero' in req.body) await guardar(req.sucursalId, CLAVE_CUPO, normalizarCupo(req.body.cortesiasMesCajero));
  if ('mesas' in req.body) await guardar(req.sucursalId, CLAVE_MESAS, normalizarMesas(req.body.mesas));
  res.json(await leerConfig(req.sucursalId));
}));

module.exports = router;
