import test from 'node:test';
import assert from 'node:assert/strict';
import { etiquetaAccion, etiquetaCambio, resumenCambio, esRechazada } from '../src/lib/bitacora.js';

test('etiquetas conocidas y respaldo legible', () => {
  assert.equal(etiquetaAccion('materias-primas', 'ajustar-stock'), 'Ajustó existencias (conteo)');
  assert.equal(etiquetaAccion('auth', 'crear', '/api/auth/login'), 'Entró al sistema');
  assert.equal(etiquetaAccion('algo', 'raro'), 'raro · algo');
  assert.equal(etiquetaCambio('lotes', 'anular_compra'), 'Anuló una compra por error');
  assert.equal(etiquetaCambio('x', 'y'), 'y · x');
});

test('resumenCambio muestra antes → después y altas', () => {
  assert.deepEqual(resumenCambio({ stock_actual: 212 }, { stock_actual: 12 }), ['Existencias: 212 → 12']);
  assert.deepEqual(resumenCambio(null, { nombre: 'Azúcar', unidad: 'kg' }), ['Nombre: Azúcar', 'Unidad: kg']);
  assert.deepEqual(resumenCambio({ costo_unitario: null }, { costo_unitario: 20 }), ['Costo unitario: — → 20']);
});

test('una acción con estado 4xx/5xx se marca como rechazada', () => {
  assert.equal(esRechazada(403), true);
  assert.equal(esRechazada(200), false);
});
