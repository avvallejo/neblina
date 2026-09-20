import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryLabel, readyUnits, groupCashCommands } from '../src/lib/preparationTracking.js';

test('preparación y entrega son estados distintos con cantidades parciales', () => {
  const item = { estado:'terminado',cantidad:3,cantidad_entregada:0 };
  assert.equal(deliveryLabel(item),'Listo para entregar');
  assert.equal(deliveryLabel({...item,cantidad_entregada:1}),'1 de 3 entregados · 2 listos');
  assert.equal(deliveryLabel({...item,cantidad_entregada:3}),'Entregado');
  assert.equal(deliveryLabel({...item,estado:'en_preparacion'}),'En preparación');
});
test('caja cuenta solo unidades listas, pendientes de entrega y no bloqueadas', () => {
  const item = {estado:'terminado',cantidad:3,cantidad_entregada:1};
  assert.equal(readyUnits([item,{...item,estado:'pendiente'},{...item,cancelado:true},{...item,no_show:true},{...item,cancelacion_estado:'pendiente'}]),2);
  assert.equal(readyUnits([{...item,cantidad_entregada:3}]),0);
});
test('mantiene estaciones y productos entregados dentro del mismo ticket', () => {
  const groups=groupCashCommands([{pedido_id:'a',id:'1',estacion:'barra',cantidad_entregada:1},{pedido_id:'b',id:'2',estacion:'barra'},{pedido_id:'a',id:'3',estacion:'parrilla'}]);
  assert.equal(groups.length,2);
  assert.deepEqual(groups[0].items.map(i=>i.id),['1','3']);
});

test('sin preparación está listo para surtir, nunca entregado automáticamente', () => {
  const item={estado:'terminado',estacion:'caja',cantidad:2,cantidad_entregada:0};
  assert.equal(deliveryLabel(item),'Listo para surtir · sin preparación');
  assert.equal(readyUnits([item]),2);
  assert.equal(deliveryLabel({...item,cantidad_entregada:2}),'Entregado');
});
