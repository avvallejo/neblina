const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeUnidadMedida, parseNumber } = require('../src/utils/catalogValidation');

const apiRoot = path.resolve(__dirname, '..');
const repoRoot = process.env.TEST_REPO_ROOT || path.resolve(apiRoot, '..');

test('catalog unit normalization accepts user-friendly units', () => {
  assert.equal(normalizeUnidadMedida('L'), 'l');
  assert.equal(normalizeUnidadMedida('litros'), 'l');
  assert.equal(normalizeUnidadMedida('gramos'), 'g');
  assert.equal(normalizeUnidadMedida('pzas'), 'pieza');
  assert.throws(() => normalizeUnidadMedida('onzas'), /unidad inválida/i);
});

test('catalog number parser rejects invalid and negative values', () => {
  assert.equal(parseNumber('100', 'stock', { min: 0 }), 100);
  assert.throws(() => parseNumber('-1', 'stock', { min: 0 }), /mayor o igual/);
  assert.throws(() => parseNumber('abc', 'stock'), /número válido/);
});

test('catalog routes expose safe delete endpoints', () => {
  const proveedores = fs.readFileSync(path.join(apiRoot, 'src/routes/proveedores.js'), 'utf8');
  const materias = fs.readFileSync(path.join(apiRoot, 'src/routes/materias.js'), 'utf8');
  const productos = fs.readFileSync(path.join(apiRoot, 'src/routes/productos.js'), 'utf8');
  assert.match(proveedores, /router\.delete\('\/:id'/);
  assert.match(materias, /router\.delete\('\/:id'/);
  assert.match(productos, /router\.delete\('\/:id'/);
  assert.match(proveedores, /desactivado_por_historial/);
  assert.match(materias, /desactivado_por_historial/);
  assert.match(productos, /desactivado_por_historial/);
});

test('frontend sends lowercase liters and DELETE catalog calls', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'frontend/src/App.jsx'), 'utf8');
  const client = fs.readFileSync(path.join(repoRoot, 'frontend/src/api/client.js'), 'utf8');
  assert.doesNotMatch(app, /const UNIDADES = \[[^\]]*'L'/);
  assert.match(client, /function eliminarProveedor/);
  assert.match(client, /function eliminarMateria/);
  assert.match(client, /function eliminarProducto/);
});

test('unit SQL migration converts lote quantities through lote units', () => {
  const migration = fs.readFileSync(path.join(repoRoot, 'db/11_catalogos_y_unidades.sql'), 'utf8');
  assert.match(migration, /fn_convertir_unidad\(l\.cantidad_disponible, l\.unidad, m\.unidad\)/);
  assert.match(migration, /No se puede convertir de/);
});
