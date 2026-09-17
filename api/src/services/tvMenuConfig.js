// Solo controla la visibilidad en la TV; no cambia opciones ni precios de venta.
function normalizarPantallaPersonalizacion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 100).filter(([category]) => category.length > 0 && category.length <= 120).map(([category, settings]) => [category, {
    visible: settings?.visible !== false,
    ocultas: Array.isArray(settings?.ocultas) ? [...new Set(settings.ocultas.filter(key => typeof key === 'string' && key.length <= 200))].slice(0, 300) : [],
  }]));
}
module.exports = { normalizarPantallaPersonalizacion };
