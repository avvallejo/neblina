// Agrupa por identidad del pedido, nunca por nombre, mesa o folio.
// Conserva productos terminados junto a los pendientes hasta completar el ticket.
export function groupPreparationOrders(tickets) {
  const groups = new Map();
  for (const ticket of tickets) {
    if (!['pendiente', 'en_preparacion', 'terminado'].includes(ticket.status)) continue;
    const key = ticket.orderId || ticket.id;
    if (!groups.has(key)) groups.set(key, { id: key, items: [], createdAt: ticket.createdAt });
    const group = groups.get(key);
    group.items.push(ticket);
    group.createdAt = Math.min(group.createdAt, ticket.createdAt);
  }
  return [...groups.values()].map(group => ({
    ...group,
    items: group.items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    status: group.items.every(t => t.status === 'terminado') ? 'terminado' : group.items.some(t => t.status !== 'pendiente') ? 'en_preparacion' : 'pendiente',
  })).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
