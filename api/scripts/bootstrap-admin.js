require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query } = require('../src/db');

const name = String(process.env.BOOTSTRAP_ADMIN_NAME || '').trim();
const pin = String(process.env.BOOTSTRAP_ADMIN_PIN || '');
const knownPins = new Set(['0000', '1111', '1234', '2222']);

async function main() {
  if (!name) throw new Error('Define BOOTSTRAP_ADMIN_NAME.');
  if (!/^\d{4}$/.test(pin)) throw new Error('BOOTSTRAP_ADMIN_PIN debe tener 4 dígitos.');
  if (knownPins.has(pin) || new Set(pin).size < 3) {
    throw new Error('BOOTSTRAP_ADMIN_PIN es demasiado predecible o corresponde a un PIN de demostración.');
  }

  const existing = await query("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = true LIMIT 1");
  if (existing.rows.length > 0) throw new Error('Ya existe un administrador activo; no se creó otro.');

  const pinHash = await bcrypt.hash(pin, 12);
  const created = await query(
    "INSERT INTO usuarios (nombre, rol, pin_hash) VALUES ($1, 'admin', $2) RETURNING id, nombre",
    [name, pinHash]
  );
  console.log(`Administrador inicial creado: ${created.rows[0].nombre} (${created.rows[0].id}).`);
  console.log('El PIN no se imprimió. Elimina BOOTSTRAP_ADMIN_PIN del entorno.');
}

main()
  .catch(err => {
    console.error(`No se pudo crear el administrador inicial: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
