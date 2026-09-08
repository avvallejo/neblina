// Catálogo vivo de la SEDE ACTIVA. Igual que en el prototipo, se mantiene en
// arreglos de módulo compartidos por todas las pantallas: al cambiar de sede
// (o recargar), replaceArray() vuelca el catálogo nuevo y todas las
// referencias siguen siendo válidas.
import { Coffee, Snowflake, Sparkles, Cookie } from 'lucide-react';

export function replaceArray(arr, items) { arr.length = 0; items.forEach(x => arr.push(x)); }

// Precio "desde" de un producto con tamaños: precio base + el ajuste del
// tamaño más barato (configurable en Admin → Opciones).
export function precioDesde(product) {
  if (!product.sizes || SIZE_OPTIONS.length === 0) return product.price;
  return product.price + Math.min(...SIZE_OPTIONS.map(s => Number(s.delta) || 0));
}

export const ICON_BY_CAT = { Calientes: Coffee, 'Fríos': Snowflake, 'Frappés': Sparkles, Snacks: Cookie };

export const CATEGORIES = [];
export const PRODUCTS = [];
export const SIZE_OPTIONS = [];
export const MILK_OPTIONS = [];
export const COFFEE_OPTIONS = [];
export const EXTRA_OPTIONS = [];

export function defaultSize(){return (SIZE_OPTIONS.find(o=>Number(o.delta)===0)||SIZE_OPTIONS[0])?.id || null;}

export function getProduct(id) { return PRODUCTS.find(p => p.id === id); }
export function labelOf(list, id) { const f = list.find(x => x.id === id); return f ? f.label : id; }

export function calcUnitPrice(product, sel) {
  let price = product.price;
  if (product.sizes && sel.size) price += (SIZE_OPTIONS.find(s => s.id === sel.size) || {}).delta || 0;
  if (product.leche && sel.milk) price += (MILK_OPTIONS.find(m => m.id === sel.milk) || {}).delta || 0;
  if (product.coffeeType && sel.coffeeType) price += Number(product.coffeePrices?.[sel.coffeeType] ?? (COFFEE_OPTIONS.find(c => c.id === sel.coffeeType) || {}).delta ?? 0);
  (sel.extras || []).forEach(ex => { price += (EXTRA_OPTIONS.find(e => e.id === ex) || {}).delta || 0; });
  return price;
}

export function customizationSummary(item) {
  const product = getProduct(item.productId);
  if (!product) return '';
  const parts = [];
  if (product.sizes) parts.push(labelOf(SIZE_OPTIONS, item.size));
  if (product.leche) parts.push(labelOf(MILK_OPTIONS, item.milk));
  if (product.coffeeType) parts.push(labelOf(COFFEE_OPTIONS, item.coffeeType));
  (item.extras || []).forEach(ex => parts.push(labelOf(EXTRA_OPTIONS, ex)));
  return parts.filter(Boolean).join(' • ');
}

/* ---- Constantes de negocio ---- */
export const MERMA_MOTIVOS = ['Espresso tirado', 'Bebida mal preparada', 'Leche quemada', 'Vaso roto', 'Producto derramado', 'Ingrediente contaminado', 'Otro'];
export const MATERIA_CATEGORIAS = ['Café', 'Leches', 'Vasos', 'Tapas', 'Jarabes', 'Hielo', 'Empaques', 'Otros'];
export const PROVEEDOR_CATEGORIAS = ['Café', 'Leche', 'Empaques', 'Jarabes', 'Insumos de limpieza', 'Otro'];
export const ROLE_LABELS = { admin: 'Administrador', cajero: 'Cajero', barista: 'Barista', mostrador: 'Caja + barra' };
export const PAY_METHOD_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Pago mixto', regalo: 'Regalo' };

// Ventana para avisar al cajero que un pedido en línea lleva mucho tiempo
// listo sin cobrarse (política corta para poder probarla en demo).
export const NO_SHOW_WARNING_MS = 3 * 60 * 1000;
