import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPreparationOrders } from '../src/lib/preparationOrders.js';
import { adaptPedido, adaptTicket } from '../src/lib/adapters.js';
const item = (id, orderId, status = 'pendiente', createdAt = 1) => ({ id, orderId, status, createdAt, nombreTicket: 'Ana', folio: 'T-1' });

test('separa tickets distintos aunque coincidan cliente, folio y mesa', () => {
  const groups = groupPreparationOrders([item('a', 'pedido1'), item('b', 'pedido2'), item('c', 'pedido1')]);
  assert.deepEqual(groups.map(g => g.items.map(t => t.id)), [['a', 'c'], ['b']]);
});
test('mantiene juntas las líneas pendientes y en preparación en una sola sección', () => {
  const groups = groupPreparationOrders([item('a', 'pedido1'), item('b', 'pedido1', 'en_preparacion'), item('c', 'pedido1', 'terminado')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].status, 'en_preparacion');
  assert.deepEqual(groups[0].items.map(t => t.id), ['a', 'b', 'c']);
});
test('agrega nuevas líneas al ticket existente y ordena por llegada sin alterar la cola', () => {
  const tickets = [item('new', 'pedido1', 'pendiente', 30), item('other', 'pedido2', 'pendiente', 20), item('old', 'pedido1', 'pendiente', 10)];
  const groups = groupPreparationOrders(tickets);
  assert.deepEqual(groups.map(g => g.id), ['pedido1', 'pedido2']);
  assert.deepEqual(groups[0].items.map(t => t.id), ['old', 'new']);
  assert.equal(tickets[0].id, 'new');
});
test('conserva el nombre libre, quien levantó y la identidad en caja y comandas', () => {
  const raw = { id: 'linea', pedido_id: 'pedido', nombre_ticket: 'Ana mesa jardín', cliente_nombre: 'Otro', levantado_por_nombre: 'Luisa' };
  for (const adapt of [adaptPedido, adaptTicket]) {
    assert.equal(adapt(raw).nombreTicket, 'Ana mesa jardín');
    assert.equal(adapt(raw).levantadoPor, 'Luisa');
    assert.equal(adapt({ cliente_nombre: 'Ana', cliente_apellido: 'Pérez' }).nombreTicket, 'Ana Pérez');
    assert.equal(adapt({}).nombreTicket, '');
  }
  assert.equal(adaptTicket(raw).orderId, 'pedido');
});

test('ticket terminado sigue visible y vuelve a preparación al agregar productos', () => {
  const done = item('a', 'pedido1', 'terminado');
  assert.equal(groupPreparationOrders([done])[0].status, 'terminado');
  const groups = groupPreparationOrders([done, item('b', 'pedido1')]);
  assert.equal(groups[0].status, 'en_preparacion');
  assert.equal(groups[0].items.length, 2);
});
