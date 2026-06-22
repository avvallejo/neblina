const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'cafeteria',
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', err => {
  // Una conexión ociosa que truena no debe tirar el proceso completo.
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

// Helper para una sola consulta (la mayoría de los endpoints).
async function query(text, params) {
  return pool.query(text, params);
}

// Helper para operaciones que necesitan varias instrucciones en una sola
// transacción (ej. crear pedido + sus items + sus extras).
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
