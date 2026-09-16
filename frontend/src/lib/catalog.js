// Catálogo vivo de la SEDE ACTIVA. Igual que en el prototipo, se mantiene en
// arreglos de módulo compartidos por todas las pantallas: al cambiar de sede
// (o recargar), replaceArray() vuelca el catálogo nuevo y todas las
// referencias siguen siendo válidas.
import { Coffee, Snowflake, Sparkles, Cookie, Flame } from 'lucide-react';

export function replaceArray(arr, items) { arr.length = 0; items.forEach(x => arr.push(x)); }

// Precio "desde" de un producto con tamaños: precio base + el ajuste del
// tamaño más barato (configurable en Admin → Opciones).
export function precioDesde(product) {
  if (!product.sizes || SIZE_OPTIONS.length === 0) return product.price;
  return product.price + Math.min(...SIZE_OPTIONS.map(s => Number(s.delta) || 0));
}

export const ICON_BY_CAT = { Calientes: Coffee, 'Fríos': Snowflake, 'Frappés': Sparkles, Snacks: Cookie, Parrilla: Flame, Cocina: Flame };

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
// Categorías de insumos de la sede: se llenan desde la API (replaceArray) al
// cargar el panel; el admin puede crear más desde el formulario o Configuración.
export const MATERIA_CATEGORIAS = [];
export const PROVEEDOR_CATEGORIAS = ['Café', 'Leche', 'Empaques', 'Jarabes', 'Insumos de limpieza', 'Otro'];
export const ROLE_LABELS = { admin: 'Administrador', cajero: 'Cajero', barista: 'Barista', mostrador: 'Caja + barra' };
export const PAY_METHOD_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Pago mixto', regalo: 'Regalo', cortesia: 'Cortesía' };
// Estado de una cortesía frente al cupo mensual de la sucursal.
// Estaciones de preparación y destino del pedido (mesas).
export const ESTACION_LABELS = { barra: 'Barra', parrilla: 'Parrilla', caja: 'Se entrega en caja' };

// Tipo de preparación de un producto. 'snack' es lo comprado hecho (galletas,
// refrescos, aguas embotelladas…) y 'alimento' lo que se cocina con receta de
// varios ingredientes (hamburguesas, tortas…).
export const TIPO_PRODUCTO_LABELS = { bebida: 'Bebida (espresso)', frappe: 'Frappé', alimento: 'Parrilla / cocina', snack: 'Comprado hecho' };
export const esAlimento = p => !!p && p.tipo === 'alimento';
// Ámbito de extras que ofrece un producto: los de alimentos (tocino, queso
// extra…) o los de bebidas (vainilla, shot…).
export const ambitoExtras = p => (esAlimento(p) ? 'alimentos' : 'bebidas');
export const extrasPara = p => EXTRA_OPTIONS.filter(o => (o.aplicaA || 'bebidas') === ambitoExtras(p));
export const ESTACION_USUARIO_LABELS = { barra: 'Barra (barista)', parrilla: 'Parrilla (parrillero)' };
// Etiqueta del rol considerando las estaciones: Barista, Parrillero o ambos.
export function rolEtiqueta(u) {
  if (!u) return '';
  const est = Array.isArray(u.estaciones) ? u.estaciones : ['barra', 'parrilla'];
  const soloParrilla = est.length === 1 && est[0] === 'parrilla';
  const ambas = est.includes('barra') && est.includes('parrilla');
  if (u.rol === 'barista') return soloParrilla ? 'Parrillero' : ambas ? 'Barista + parrillero' : 'Barista';
  if (u.rol === 'mostrador') return soloParrilla ? 'Caja + parrilla' : ambas ? 'Caja + barra y parrilla' : 'Caja + barra';
  return ROLE_LABELS[u.rol] || u.rol;
}
// "Mesa 3" / "Barra" / "Para llevar" / pedido en línea (recoger).
export function destinoLabel({ destino, mesaNumero, origen } = {}) {
  if (destino === 'mesa') return `Mesa ${mesaNumero}`;
  if (destino === 'barra') return 'Barra';
  if (destino === 'llevar') return 'Para llevar';
  return origen === 'app' ? 'En línea · recoger' : '';
}
export const CORTESIA_ESTADO_LABELS = { dentro_plan: 'Cortesía del plan', pendiente: 'Pendiente de autorización', autorizada: 'Cortesía autorizada', rechazada: 'Cortesía rechazada' };

// Cancelación de tickets: mientras está "pendiente" el ticket sigue contando
// en las ventas del día; solo al autorizarla baja del corte.
export const CANCELACION_ESTADO_LABELS = {
  pendiente: 'Cancelación por autorizar',
  autorizada: 'Cancelado',
  rechazada: 'Cancelación rechazada',
};

// Ventana para avisar al cajero que un pedido en línea lleva mucho tiempo
// listo sin cobrarse (política corta para poder probarla en demo).
export const NO_SHOW_WARNING_MS = 3 * 60 * 1000;
