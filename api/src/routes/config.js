const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Claves de configuración del negocio (en BD) que expone la app.
const CLAVES = ['sms_verificacion', 'nombre_negocio', 'logo'];

// Lee la config y la entrega con nombres amigables para el front.
async function leerConfig() {
  const { rows } = await query('SELECT clave, valor FROM configuracion WHERE clave = ANY($1)', [CLAVES]);
  const map = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  return {
    smsVerificacion: map.sms_verificacion === true,
    nombreNegocio: typeof map.nombre_negocio === 'string' ? map.nombre_negocio : '',
    logo: typeof map.logo === 'string' ? map.logo : '',
  };
}

async function guardar(clave, valor) {
  await query(
    `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
    [clave, JSON.stringify(valor)]
  );
}

// Público: el cliente necesita el nombre/logo (marca) y saber si debe verificar
// su teléfono por SMS, ANTES de loguearse.
router.get('/', asyncHandler(async (req, res) => {
  res.json(await leerConfig());
}));

// Solo admin. Actualiza ÚNICAMENTE los campos enviados (parcial), así el mismo
// endpoint sirve para el toggle de SMS y para la identidad del negocio.
router.put('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if ('smsVerificacion' in req.body) await guardar('sms_verificacion', !!req.body.smsVerificacion);
  if ('nombreNegocio' in req.body) await guardar('nombre_negocio', String(req.body.nombreNegocio || '').slice(0, 60));
  if ('logo' in req.body) await guardar('logo', String(req.body.logo || ''));
  res.json(await leerConfig());
}));

module.exports = router;
