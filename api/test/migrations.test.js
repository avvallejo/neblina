const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

// Simula docker exec -i: consume stdin, aunque psql reciba una consulta con -c.
// No se conecta a ninguna base ni modifica migraciones reales.
function deployWithFakePsql({ fail = false, dry = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'neblina-migrations-'));
  try {
    const psql = join(directory, 'psql');
    writeFileSync(psql, `#!/bin/sh\ncat > /dev/null\n${fail ? 'exit 17' : 'printf "1\\n"'}\n`, { mode: 0o700 });
    return spawnSync('bash', [], {
      cwd: resolve(__dirname, '../..'),
      env: { ...process.env, PSQL: psql },
      encoding: 'utf8',
      input: `set -euo pipefail\nbash db/migrar.sh${dry ? ' --dry-run' : ''}\nprintf 'DESPLIEGUE_CONTINUA\\n'\n`,
      timeout: 10000,
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('migraciones dejan ejecutar los comandos siguientes de un despliegue pegado', () => {
  const result = deployWithFakePsql();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 migración\(es\) aplicada\(s\)/);
  assert.match(result.stdout, /DESPLIEGUE_CONTINUA/);
});

test('la revisión de migraciones tampoco consume los comandos siguientes', () => {
  const result = deployWithFakePsql({ dry: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DESPLIEGUE_CONTINUA/);
});

test('un error real de base de datos sigue deteniendo el despliegue', () => {
  const result = deployWithFakePsql({ fail: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /No pude conectarme/);
  assert.doesNotMatch(result.stdout, /DESPLIEGUE_CONTINUA/);
});
