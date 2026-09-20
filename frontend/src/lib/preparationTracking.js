export function deliveryLabel(item) {
  if (item.estado === 'cancelado') return 'Cancelado';
  if (item.estado !== 'terminado') return item.estado === 'en_preparacion' ? 'En preparación' : 'Pendiente';
  const delivered = Number(item.cantidad_entregada || 0);
  const quantity = Number(item.cantidad);
  if (delivered >= quantity) return 'Entregado';
  if (delivered) return `${delivered} de ${quantity} entregados · ${quantity - delivered} listos`;
  return item.estacion === 'caja' ? 'Listo para surtir · sin preparación' : 'Listo para entregar';
}
export function groupCashCommands(rows) {
  const groups = new Map();
  for (const item of rows) {
    if (!groups.has(item.pedido_id)) groups.set(item.pedido_id, { ...item, items: [] });
    groups.get(item.pedido_id).items.push(item);
  }
  return [...groups.values()];
}
export function readyUnits(rows) {
  return rows.reduce((total, item) => total + (item.estado === 'terminado' && !item.cancelado && !item.no_show && item.cancelacion_estado !== 'pendiente'
    ? Math.max(0, Number(item.cantidad) - Number(item.cantidad_entregada || 0)) : 0), 0);
}
