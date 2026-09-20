// Emojis Unicode: disponibles sin descargas en caja, barra y menú.
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const PRODUCT_EMOJIS = [
  ['☕', 'Café'], ['🧋', 'Frappé'], ['🥤', 'Bebida fría'], ['🍵', 'Té'],
  ['🍫', 'Chocolate'], ['🥛', 'Leche y horchata'], ['🌺', 'Jamaica'], ['🍓', 'Fresa'],
  ['💧', 'Agua'], ['🍋', 'Limón'], ['🍊', 'Naranja'], ['🥭', 'Mango'],
  ['🍔', 'Hamburguesa'], ['🥪', 'Torta o sándwich'], ['🍟', 'Papas'], ['🌭', 'Hot dog'],
  ['🍕', 'Pizza'], ['🌮', 'Taco'], ['🥬', 'Vegetariano'], ['🥗', 'Ensalada'],
  ['🍪', 'Galleta'], ['🧁', 'Muffin'], ['🍰', 'Pastel o tarta'], ['🥐', 'Pan dulce'],
  ['🍞', 'Pan'], ['🧇', 'Waffle'], ['🥞', 'Hot cakes'], ['🍦', 'Helado'],
  ['🍽️', 'Alimento'], ['🛍️', 'Otro producto'],
];

export function suggestedProductEmoji(product = {}) {
  const name = normalize(product.name || product.nombre || product.producto_nombre);
  const cat = normalize(product.cat || product.categoria);
  const rules = [
    [/hamburguesa.*veget|burger.*veget/, '🥬'], [/hamburgues|burger/, '🍔'],
    [/\btorta\b|sandwich|baguette|panini/, '🥪'], [/papas|patatas/, '🍟'],
    [/hot dog|jocho/, '🌭'], [/pizza/, '🍕'], [/taco|quesadilla/, '🌮'], [/ensalada/, '🥗'],
    [/brownie/, '🍫'], [/galleta|cookie|oreo(?!.*frap)/, '🍪'],
    [/muffin|panque|cupcake/, '🧁'], [/pastel|tarta|cheesecake/, '🍰'],
    [/concha|oreja|croissant|cuernito|palmier/, '🥐'], [/waffle/, '🧇'], [/hot cakes|pancake/, '🥞'],
    [/frap/, '🧋'], [/chocomilk|choco milk|chocolate|moka|mocha/, '🍫'],
    [/\bte\b|infusion|tisana|matcha/, '🍵'], [/jamaica/, '🌺'], [/horchata|leche/, '🥛'],
    [/limon|limonada/, '🍋'], [/naranja|naranjada/, '🍊'], [/mango/, '🥭'], [/fresa/, '🍓'],
    [/refresco|cola|soda|esquimo|licuado|smoothie|jugo/, '🥤'], [/agua/, '💧'],
    [/helado|nieve/, '🍦'], [/pan/, '🍞'],
  ];
  // Resolver frappés antes de sus sabores (Oreo, chocolate, fresa…).
  if (/frap/.test(name)) return '🧋';
  const match = rules.find(([pattern]) => pattern.test(name));
  if (match) return match[1];
  if (product.tipo === 'frappe' || /frap/.test(cat)) return '🧋';
  if (product.frio || product.es_frio || /frio/.test(cat)) return '🥤';
  if (/cafe|espresso|americano|latte|capuch|cappuc|cortado|macchiato/.test(name) || /caliente/.test(cat)) return '☕';
  if (product.tipo === 'alimento' || /parrilla|cocina/.test(cat)) return '🍽️';
  if (product.tipo === 'snack' || /snack|postre/.test(cat)) return '🍪';
  return product.tipo === 'bebida' ? '☕' : '🛍️';
}

export function productEmoji(product = {}) {
  const saved = String(product?.icon || product?.icono || '').trim();
  // La taza es el antiguo valor genérico del catálogo.
  return saved && saved !== '☕' ? saved : suggestedProductEmoji(product || {});
}
