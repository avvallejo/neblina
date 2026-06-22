const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { ApiError } = require('../utils/asyncHandler');

const MAX_FAILED_ATTEMPTS = 5;
const APPROVAL_TTL_MINUTES = 5;

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createDiscountApproval({ requesterId, pin, discount }, queryFn = query) {
  if (!/^\d{4}$/.test(String(pin || ''))) throw new ApiError(400, 'El PIN de autorización debe tener 4 dígitos.');

  // El llamador ejecuta esta función dentro de una transacción. El bloqueo
  // serializa intentos concurrentes del mismo usuario para que no puedan pasar
  // todos antes de que el contador de fallos sea visible.
  await queryFn('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [requesterId]);
  const attempts = await queryFn(
    `SELECT COUNT(*) FROM intentos_autorizacion_descuento
     WHERE solicitante_id = $1 AND exitoso = false AND creado_en > now() - interval '1 hour'`,
    [requesterId]
  );
  if (Number(attempts.rows[0].count) >= MAX_FAILED_ATTEMPTS) {
    throw new ApiError(429, 'Autorización bloqueada por demasiados intentos. Espera una hora.');
  }

  const admins = await queryFn("SELECT id, pin_hash FROM usuarios WHERE rol = 'admin' AND activo = true");
  let authorizerId = null;
  for (const admin of admins.rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(pin, admin.pin_hash)) { authorizerId = admin.id; break; }
  }

  await queryFn(
    'INSERT INTO intentos_autorizacion_descuento (solicitante_id, exitoso) VALUES ($1,$2)',
    [requesterId, !!authorizerId]
  );
  // No lanzar aquí: el intento vive dentro de una transacción y debe quedar
  // confirmado para que el bloqueo persistente no se pueda evadir.
  if (!authorizerId) return { denied: true };

  const token = crypto.randomBytes(32).toString('base64url');
  await queryFn(
    `INSERT INTO aprobaciones_descuento
       (token_hash, solicitante_id, autorizador_id, descuento_porcentaje, expira_en)
     VALUES ($1,$2,$3,$4, now() + interval '${APPROVAL_TTL_MINUTES} minutes')`,
    [tokenHash(token), requesterId, authorizerId, discount]
  );
  return { token, expiresInSeconds: APPROVAL_TTL_MINUTES * 60, denied: false };
}

async function consumeDiscountApproval(client, { requesterId, token, discount }) {
  if (!token || typeof token !== 'string') {
    throw new ApiError(400, 'El descuento requiere una autorización vigente.');
  }
  const result = await client.query(
    `UPDATE aprobaciones_descuento
     SET usada_en = now()
     WHERE token_hash = $1
       AND solicitante_id = $2
       AND descuento_porcentaje = $3
       AND usada_en IS NULL
       AND expira_en > now()
     RETURNING autorizador_id`,
    [tokenHash(token), requesterId, discount]
  );
  if (result.rows.length === 0) {
    throw new ApiError(401, 'La autorización de descuento es inválida, expiró o ya fue utilizada.');
  }
  return result.rows[0].autorizador_id;
}

module.exports = { createDiscountApproval, consumeDiscountApproval, tokenHash, MAX_FAILED_ATTEMPTS };
