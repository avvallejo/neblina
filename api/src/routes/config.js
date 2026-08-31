const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole, resolveSucursal, resolveSucursalPublico } = require('../middleware/auth');

const router = express.Router();

// Claves de configuración del negocio (en BD) que expone la app. Cada sede
// tiene las suyas: nombre, logo y verificación por SMS son POR SUCURSAL.
const CLAVES = ['sms_verificacion', 'nombre_negocio', 'logo', 'lema', 'pie_pantalla', 'pantalla_estilo'];

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
    pantallaEstilo: map.pantalla_estilo === 'clasico' ? 'clasico' : 'pizarra',
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
  if ('pantallaEstilo' in req.body) await guardar(req.sucursalId, 'pantalla_estilo', req.body.pantallaEstilo === 'clasico' ? 'clasico' : 'pizarra');
  res.json(await leerConfig(req.sucursalId));
}));

module.exports = router;
