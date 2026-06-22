const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Público: el cliente necesita saber, ANTES de loguearse, si debe verificar su
// teléfono por SMS o si puede registrarse directo.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT valor FROM configuracion WHERE clave = 'sms_verificacion'");
  res.json({ smsVerificacion: rows[0] ? rows[0].valor === true : false });
}));

// Solo admin puede activar/desactivar la verificación por SMS.
router.put('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const valor = !!req.body.smsVerificacion;
  await query(
    `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES ('sms_verificacion', $1::jsonb, now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
    [JSON.stringify(valor)]
  );
  res.json({ smsVerificacion: valor });
}));

module.exports = router;
