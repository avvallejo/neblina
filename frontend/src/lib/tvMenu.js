export const categoryOf = p => p.cat || (p.tipo === 'snack' ? 'Snacks' : p.tipo === 'frappe' ? 'Frappés' : p.frio ? 'Fríos' : 'Calientes');
// Cada página conserva una sola categoría y sus opciones de personalización.
export function chunks(items, limit) {
  return Array.from({ length: Math.ceil(items.length / limit) }, (_, i) => items.slice(i * limit, (i + 1) * limit));
}
export function categoryOptions(products, options = {}) {
  const result = [];
  const add = (group, items) => (items || []).forEach(item => result.push({ ...item, group, key: `${group}-${item.id || item.label}` }));
  const coffees = products.filter(p => p.coffeeType);
  if (coffees.length) add('Café', (options.cafes || []).map(o => {
    const prices = coffees.map(p => Number(p.coffeePrices?.[o.id] ?? o.delta));
    return { ...o, delta: Math.min(...prices), maxDelta: Math.max(...prices) };
  }));
  if (products.some(p => p.leche)) add('Leche', options.leches);
  for (const scope of ['bebidas', 'alimentos']) {
    if (products.some(p => p.extras && (p.tipo === 'alimento' ? 'alimentos' : 'bebidas') === scope)) {
      add(scope === 'alimentos' ? 'Extras de parrilla' : 'Extras de bebida', (options.extras || []).filter(o => (o.aplicaA || 'bebidas') === scope));
    }
  }
  return result;
}
export function categoryPages(categories, products, categoryOf, options, layout, visibility = {}) {
  return categories.flatMap(title => {
    const items = products.filter(p => categoryOf(p) === title);
    const settings = visibility[title];
    const extras = settings?.visible === false ? [] : categoryOptions(items, options).filter(o => !settings?.ocultas?.includes(o.key));
    const productPages = chunks(items, layout.products);
    const extraPages = chunks(extras, layout.extras);
    const count = Math.max(productPages.length, extraPages.length);
    return Array.from({ length: count }, (_, i) => ({ title,
      items: productPages[i % productPages.length], extras: extraPages.length ? extraPages[i % extraPages.length] : [],
      part: i + 1, count, extraPart: extraPages.length ? i % extraPages.length + 1 : 0, extraCount: extraPages.length,
    }));
  });
}
