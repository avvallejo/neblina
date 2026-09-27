export function publicMenuUrl(origin, sucursalId) {
  if (!sucursalId) throw new Error('Selecciona una sucursal válida.');
  const url = new URL('/', origin);
  url.search = new URLSearchParams({ pantalla: 'carta', sucursal: sucursalId });
  return url.href;
}
export function tableMenuUrl(origin, sucursalId, mesa) {
  if (!sucursalId || !Number.isInteger(mesa) || mesa < 1 || mesa > 200) throw new Error('Selecciona una sucursal y una mesa válida.');
  const url = new URL('/', origin);
  url.search = new URLSearchParams({ pantalla: 'carta', sucursal: sucursalId, mesa: String(mesa) });
  return url.href;
}
export function tableNumber(value, max) {
  return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= max ? Number(value) : null;
}
