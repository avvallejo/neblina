import React, { useState, useEffect, useRef } from 'react';
import {
  Coffee, ShoppingCart, Plus, Minus, X, Check, Clock, AlertTriangle,
  ChevronLeft, Package, TrendingDown, Banknote, CreditCard, Trash2,
  Gauge as GaugeIcon, Droplets, ClipboardList, Sparkles,
  RotateCcw, Users, Wallet, AlertCircle, Snowflake, Cookie, ArrowLeftRight, Receipt,
  Lock, History, UserPlus, Pencil, User, CupSoda, Milk, Thermometer, Palette
} from 'lucide-react';
import * as api from './api/client.js';

// Reemplaza el CONTENIDO de un arreglo en su lugar (sin reasignar la const),
// para que todas las referencias del prototipo sigan válidas cuando cargamos
// los catálogos reales desde la API.
function replaceArray(arr, items) { arr.length = 0; items.forEach(x => arr.push(x)); }

// Ícono (lucide) por nombre de categoría, para reconstruir CATEGORIES desde la API.
const ICON_BY_CAT = { Calientes: Coffee, 'Fríos': Snowflake, 'Frappés': Sparkles, Snacks: Cookie };

/* ============================================================
   DATOS MOCK — sustituir por llamadas a la API real (Fase 2/3)
   ============================================================ */

const CATEGORIES = [
  { id: 'Calientes', icon: Coffee },
  { id: 'Fríos', icon: Snowflake },
  { id: 'Frappés', icon: Sparkles },
  { id: 'Snacks', icon: Cookie },
];

const PRODUCTS = [
  { id: 'americano', name: 'Americano', cat: 'Calientes', icon: '☕', price: 38, tipo: 'bebida', leche: false, frio: false, sizes: true, coffeeType: true, extras: true },
  { id: 'espresso', name: 'Espresso', cat: 'Calientes', icon: '☕', price: 32, tipo: 'bebida', leche: false, frio: false, sizes: false, coffeeType: true, extras: true },
  { id: 'latte', name: 'Latte', cat: 'Calientes', icon: '🥛', price: 48, tipo: 'bebida', leche: true, frio: false, sizes: true, coffeeType: true, extras: true },
  { id: 'capuchino', name: 'Capuchino', cat: 'Calientes', icon: '☕', price: 46, tipo: 'bebida', leche: true, frio: false, sizes: true, coffeeType: true, extras: true },
  { id: 'moka', name: 'Moka', cat: 'Calientes', icon: '🍫', price: 54, tipo: 'bebida', leche: true, frio: false, sizes: true, coffeeType: true, extras: true },
  { id: 'caramel', name: 'Caramel Macchiato', cat: 'Calientes', icon: '🍮', price: 56, tipo: 'bebida', leche: true, frio: false, sizes: true, coffeeType: true, extras: true },
  { id: 'tonic', name: 'Espresso Tonic', cat: 'Fríos', icon: '🥂', price: 52, tipo: 'bebida', leche: false, frio: true, sizes: false, coffeeType: true, extras: true },
  { id: 'latte_helado', name: 'Latte Helado', cat: 'Fríos', icon: '🧊', price: 50, tipo: 'bebida', leche: true, frio: true, sizes: true, coffeeType: true, extras: true },
  { id: 'frappe', name: 'Frappé Café', cat: 'Frappés', icon: '🥤', price: 58, tipo: 'frappe', leche: true, frio: true, sizes: true, coffeeType: false, extras: true },
  { id: 'frappe_oreo', name: 'Frappé Oreo', cat: 'Frappés', icon: '🍪', price: 62, tipo: 'frappe', leche: true, frio: true, sizes: true, coffeeType: false, extras: true },
  { id: 'donitas', name: 'Donitas', cat: 'Snacks', icon: '🍩', price: 28, tipo: 'snack' },
  { id: 'galletas', name: 'Galletas', cat: 'Snacks', icon: '🍪', price: 24, tipo: 'snack' },
];

const SIZE_OPTIONS = [
  { id: '8', label: '8 oz', delta: -6 },
  { id: '12', label: '12 oz', delta: 0 },
  { id: '16', label: '16 oz', delta: 8 },
];

const MILK_OPTIONS = [
  { id: 'entera', label: 'Leche entera', delta: 0 },
  { id: 'deslactosada', label: 'Deslactosada', delta: 0 },
  { id: 'avena', label: 'Avena (vegetal)', delta: 8 },
  { id: 'almendra', label: 'Almendra (vegetal)', delta: 8 },
];

const COFFEE_OPTIONS = [
  { id: 'tradicional', label: 'Café tradicional', delta: 0 },
  { id: 'especial', label: 'Café de origen especial', delta: 6 },
];

const EXTRA_OPTIONS = [
  { id: 'shot', label: 'Shot extra', delta: 12 },
  { id: 'vainilla', label: 'Jarabe vainilla', delta: 8 },
  { id: 'caramelo', label: 'Jarabe caramelo', delta: 8 },
  { id: 'crema', label: 'Crema batida', delta: 10 },
  { id: 'chocolate', label: 'Chocolate extra', delta: 6 },
];

const MERMA_MOTIVOS = ['Espresso tirado', 'Bebida mal preparada', 'Leche quemada', 'Vaso roto', 'Producto derramado', 'Ingrediente contaminado', 'Otro'];
const MERMA_INSUMOS = ['Café', 'Leche', 'Vaso', 'Tapa', 'Jarabe', 'Hielo', 'Otro'];

const MATERIA_CATEGORIAS = ['Café', 'Leches', 'Vasos', 'Tapas', 'Jarabes', 'Hielo', 'Empaques', 'Otros'];
const UNIDADES = ['g', 'kg', 'ml', 'L', 'pieza'];
const PROVEEDOR_CATEGORIAS = ['Café', 'Leche', 'Empaques', 'Jarabes', 'Insumos de limpieza', 'Otro'];

const PROVEEDORES_SEED = [
  { id: 'pr1', nombre: 'Tueste Local', categoria: 'Café', contacto: 'Mario Pérez', telefono: '9611112233', activo: true },
  { id: 'pr2', nombre: 'Lácteos del Valle', categoria: 'Leche', contacto: 'Ana Gómez', telefono: '9612223344', activo: true },
  { id: 'pr3', nombre: 'Empaques Sureste', categoria: 'Empaques', contacto: 'Luis Ramírez', telefono: '9613334455', activo: true },
  { id: 'pr4', nombre: 'Saborizantes MX', categoria: 'Jarabes', contacto: 'Diana Cruz', telefono: '9614445566', activo: true },
];

const MATERIAS_PRIMAS_SEED = [
  { id: 'mp1', nombre: 'Café tradicional', categoria: 'Café', unidad: 'kg', stockActual: 8, stockMinimo: 3, costoUnitario: 180, proveedorId: 'pr1', activo: true },
  { id: 'mp2', nombre: 'Café especial Pluma Hidalgo', categoria: 'Café', unidad: 'kg', stockActual: 1.2, stockMinimo: 2, costoUnitario: 320, proveedorId: 'pr1', activo: true },
  { id: 'mp3', nombre: 'Leche entera', categoria: 'Leches', unidad: 'L', stockActual: 18, stockMinimo: 8, costoUnitario: 22, proveedorId: 'pr2', activo: true },
  { id: 'mp4', nombre: 'Leche deslactosada', categoria: 'Leches', unidad: 'L', stockActual: 2, stockMinimo: 5, costoUnitario: 26, proveedorId: 'pr2', activo: true },
  { id: 'mp5', nombre: 'Vasos 12 oz', categoria: 'Vasos', unidad: 'pieza', stockActual: 40, stockMinimo: 100, costoUnitario: 1.8, proveedorId: 'pr3', activo: true },
  { id: 'mp6', nombre: 'Vasos 16 oz', categoria: 'Vasos', unidad: 'pieza', stockActual: 150, stockMinimo: 80, costoUnitario: 2.1, proveedorId: 'pr3', activo: true },
  { id: 'mp7', nombre: 'Jarabe de vainilla', categoria: 'Jarabes', unidad: 'L', stockActual: 0.3, stockMinimo: 1, costoUnitario: 145, proveedorId: 'pr4', activo: true },
  { id: 'mp8', nombre: 'Hielo', categoria: 'Hielo', unidad: 'kg', stockActual: 25, stockMinimo: 10, costoUnitario: 8, proveedorId: 'pr3', activo: true },
];

// Productos que el administrador puede elegir como premio de la tarjeta de fidelidad.
// Se restringe a productos existentes para que el regalo también descuente inventario real.
const REWARD_PRODUCT_IDS = ['americano', 'frappe', 'donitas', 'galletas'];

const ROLE_LABELS = { admin: 'Administrador', cajero: 'Cajero', barista: 'Barista' };

const PAY_METHOD_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Pago mixto' };

// Ventana para avisar al cajero que un pedido en línea lleva mucho tiempo listo sin cobrarse.
// En producción esto sería una política configurable (ej. 30-60 min); aquí se deja corto para poder probarlo.
const NO_SHOW_WARNING_MS = 3 * 60 * 1000;

// Estado real de un pedido, combinando sus tickets con las banderas de cobro/no-show del pedido.
// "listo" = todos los productos están terminados pero el pedido en línea aún no se cobra/entrega.
function getOrderStatus(order, tickets) {
  if (order.noShow) return 'no_show';
  if (order.cancelado) return 'cancelado';
  const ts = tickets.filter(t => t.orderId === order.id);
  if (ts.length === 0) return 'pendiente';
  if (ts.every(t => t.status === 'terminado')) return order.cobrado ? 'terminado' : 'listo';
  if (ts.some(t => t.status !== 'pendiente')) return 'en_preparacion';
  return 'pendiente';
}

/* ============================================================
   HELPERS
   ============================================================ */

function getProduct(id) { return PRODUCTS.find(p => p.id === id); }
function labelOf(list, id) { const f = list.find(x => x.id === id); return f ? f.label : id; }
function money(n) { return `$${Number(n || 0).toFixed(2)}`; }

function calcUnitPrice(product, sel) {
  let price = product.price;
  if (product.sizes && sel.size) price += (SIZE_OPTIONS.find(s => s.id === sel.size) || {}).delta || 0;
  if (product.leche && sel.milk) price += (MILK_OPTIONS.find(m => m.id === sel.milk) || {}).delta || 0;
  if (product.coffeeType && sel.coffeeType) price += (COFFEE_OPTIONS.find(c => c.id === sel.coffeeType) || {}).delta || 0;
  (sel.extras || []).forEach(ex => { price += (EXTRA_OPTIONS.find(e => e.id === ex) || {}).delta || 0; });
  return price;
}

function extraIngredient(ex) {
  const map = {
    vainilla: { label: 'Jarabe de vainilla', cantidad: '15 ml' },
    caramelo: { label: 'Jarabe de caramelo', cantidad: '15 ml' },
    crema: { label: 'Crema batida', cantidad: '20 g' },
    chocolate: { label: 'Chocolate extra', cantidad: '15 g' },
    shot: { label: 'Shot extra de café', cantidad: '18 g' },
  };
  return map[ex] || { label: ex, cantidad: '1 porción' };
}

function buildRecipe(product, sel, override) {
  if (!product) return { ingredientes: [], pasos: [], params: { type: 'simple', fields: [] }, vaso: null, tapa: null };

  if (product.tipo === 'snack') {
    return {
      ingredientes: [{ label: product.name, cantidad: '1 pieza' }, { label: 'Servilleta', cantidad: '1 pieza' }],
      pasos: ['Tomar producto de la vitrina', 'Verificar que esté fresco', 'Colocar en plato o bolsa de papel', 'Entregar junto con la bebida'],
      params: { type: 'simple', fields: [] },
    };
  }

  const ov = override || {};
  const size = sel.size || '12';
  const extras = sel.extras || [];
  const hasShotExtra = extras.includes('shot');
  const shots = hasShotExtra ? 2 : 1;
  const gramajeBase = ov.gramajePorShot || 18;
  const gramaje = gramajeBase * shots;
  const milkLabel = sel.milk ? labelOf(MILK_OPTIONS, sel.milk) : 'Leche entera';
  const coffeeLabel = sel.coffeeType ? labelOf(COFFEE_OPTIONS, sel.coffeeType) : 'Café tradicional';
  const ingredientes = [];
  let pasos = [];
  let params;

  if (product.tipo === 'frappe') {
    const cafeMolido = 14;
    const hielo = { 8: 120, 12: 180, 16: 240 }[size] || 180;
    const lecheFr = { 8: 120, 12: 180, 16: 240 }[size] || 180;
    ingredientes.push({ label: 'Café molido grueso', cantidad: `${cafeMolido} g` });
    ingredientes.push({ label: milkLabel, cantidad: `${lecheFr} ml` });
    ingredientes.push({ label: 'Hielo', cantidad: `${hielo} g` });
    ingredientes.push({ label: 'Base de frappé', cantidad: '30 ml' });
    if (product.name.includes('Oreo')) ingredientes.push({ label: 'Galleta Oreo triturada', cantidad: '2 piezas' });
    extras.forEach(ex => ingredientes.push(extraIngredient(ex)));
    ingredientes.push({ label: `Vaso frío ${size} oz`, cantidad: '1 pieza' });
    ingredientes.push({ label: `Tapa domo ${size} oz`, cantidad: '1 pieza' });
    ingredientes.push({ label: 'Popote ancho', cantidad: '1 pieza' });

    if (ov.pasos && ov.pasos.length) {
      pasos = [...ov.pasos];
    } else {
      pasos.push('Agregar café molido, leche, hielo y base al vaso licuador');
      pasos.push('Licuar a velocidad alta 25-30 segundos hasta lograr textura cremosa');
      pasos.push('Servir en vaso frío');
      if (product.name.includes('Oreo')) pasos.push('Decorar con galleta Oreo triturada');
      if (extras.length) pasos.push('Agregar extras seleccionados');
      pasos.push('Colocar tapa domo y popote');
    }

    params = {
      type: 'frappe',
      fields: [
        { label: 'Molienda', value: ov.molienda || 'Gruesa' },
        { label: 'Tiempo de licuado', value: ov.tiempoLicuado || ov.tiempoExtraccion || '25-30 s' },
        { label: 'Rendimiento', value: '1 vaso' },
        { label: 'Temperatura', value: ov.temperatura || 'Frío / con hielo' },
      ],
    };
  } else {
    ingredientes.push({ label: coffeeLabel, cantidad: `${gramaje} g` });
    if (product.leche) ingredientes.push({ label: milkLabel, cantidad: `${({ 8: 180, 12: 280, 16: 360 }[size] || 280)} ml` });
    if (product.name.includes('Moka')) ingredientes.push({ label: 'Chocolate', cantidad: '20 g' });
    if (product.name.includes('Caramel')) ingredientes.push({ label: 'Jarabe de caramelo', cantidad: '15 ml' });
    if (product.name.includes('Tonic')) { ingredientes.push({ label: 'Agua tónica', cantidad: '150 ml' }); ingredientes.push({ label: 'Hielo', cantidad: '100 g' }); }
    extras.forEach(ex => { if (ex !== 'shot') ingredientes.push(extraIngredient(ex)); else ingredientes.push(extraIngredient(ex)); });
    if (product.sizes) {
      ingredientes.push({ label: `Vaso ${product.frio ? 'frío' : 'caliente'} ${size} oz`, cantidad: '1 pieza' });
      ingredientes.push({ label: `Tapa ${size} oz`, cantidad: '1 pieza' });
    } else {
      ingredientes.push({ label: `Taza/vaso ${product.frio ? 'frío' : 'caliente'}`, cantidad: '1 pieza' });
    }
    if (product.frio) ingredientes.push({ label: 'Popote', cantidad: '1 pieza' });

    if (ov.pasos && ov.pasos.length) {
      pasos = [...ov.pasos];
    } else {
      pasos.push('Moler el café justo antes de preparar');
      pasos.push(`Tarar y dosificar ${gramaje} g de café molido`);
      pasos.push(`Extraer espresso ${shots > 1 ? 'doble' : 'sencillo'}`);
      if (product.leche) pasos.push('Vaporizar y texturizar la leche a 60-65°C');
      pasos.push(product.frio ? 'Servir sobre hielo' : 'Verter sobre el café en el vaso');
      if (extras.length) pasos.push('Agregar extras seleccionados');
      pasos.push('Colocar tapa y entregar a la barra de pedidos');
    }

    const moliendaDefault = sel.coffeeType === 'especial' ? 'Media (origen)' : 'Media-fina';
    const ajusteDefault = sel.coffeeType === 'especial' ? '4.2' : '3.5';
    params = {
      type: 'espresso',
      fields: [
        { label: 'Gramaje', value: `${gramaje} g` },
        { label: 'Molienda', value: sel.coffeeType === 'especial' ? (ov.moliendaEspecial || moliendaDefault) : (ov.molienda || moliendaDefault) },
        { label: 'Ajuste molino', value: sel.coffeeType === 'especial' ? (ov.ajusteMolinoEspecial || ajusteDefault) : (ov.ajusteMolino || ajusteDefault) },
        { label: 'Tiempo extracción', value: (sel.coffeeType === 'especial' ? (ov.tiempoExtraccionEspecial || ov.tiempoExtraccion) : ov.tiempoExtraccion) || (shots > 1 ? '50-55 s' : '26-30 s') },
        { label: 'Rendimiento', value: `${gramaje * 2} g aprox` },
        { label: 'Temperatura', value: ov.temperatura || (product.frio ? '92°C / servir frío' : '92°C') },
      ],
    };
  }

  return { ingredientes, pasos, params };
}

function mmss(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function customizationSummary(item) {
  const product = getProduct(item.productId);
  const parts = [];
  if (product.sizes) parts.push(labelOf(SIZE_OPTIONS, item.size));
  if (product.leche) parts.push(labelOf(MILK_OPTIONS, item.milk));
  if (product.coffeeType) parts.push(labelOf(COFFEE_OPTIONS, item.coffeeType));
  (item.extras || []).forEach(ex => parts.push(labelOf(EXTRA_OPTIONS, ex)));
  return parts.join(' • ');
}

function validPhone(str) {
  const digits = (str || '').replace(/\D/g, '');
  return digits.length === 10;
}

function fmtHora(ts) {
  return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// Adapta un pedido de la API (vw_pedidos_con_estado) a la forma que usa la UI
// del prototipo. El "estado" lo calcula la vista en el servidor con la MISMA
// lógica que getOrderStatus, así que se usa directo.
function adaptPedido(p) {
  return {
    id: p.id,
    folio: p.folio || p.id,
    total: Number(p.total || 0),
    subtotal: Number(p.subtotal || 0),
    payMethod: p.metodo_pago ? (PAY_METHOD_LABELS[p.metodo_pago] || p.metodo_pago) : 'Por cobrar',
    cashGiven: p.monto_recibido != null ? Number(p.monto_recibido) : null,
    change: p.cambio != null ? Number(p.cambio) : null,
    origen: p.origen,
    cliente: p.cliente_nombre ? { nombre: p.cliente_nombre, apellido: p.cliente_apellido || '' } : null,
    horaRecogida: p.hora_recogida ? new Date(p.hora_recogida).getTime() : null,
    cobrado: !!p.cobrado,
    noShow: !!p.no_show,
    cancelado: !!p.cancelado,
    esRecompensaPura: !!p.es_regalo_fidelidad,
    createdAt: p.creado_en ? new Date(p.creado_en).getTime() : Date.now(),
    estado: p.estado || 'pendiente',
    numItems: Number(p.num_items || 0),
  };
}

// Adapta un item de la cola del barista a la forma "ticket" del prototipo. Las
// opciones vienen ya como código (tamano_codigo, etc.), que es justo lo que la
// UI espera.
function adaptTicket(pi) {
  return {
    id: pi.id,
    folio: pi.folio || '',
    orderId: pi.pedido_id,
    productId: pi.producto_id,
    size: pi.tamano_codigo || null,
    milk: pi.leche_codigo || null,
    coffeeType: pi.cafe_codigo || null,
    extras: Array.isArray(pi.extras) ? pi.extras.map(e => e.codigo) : [],
    qty: pi.cantidad || 1,
    notas: pi.notas || '',
    status: pi.estado,
    createdAt: pi.creado_en ? new Date(pi.creado_en).getTime() : Date.now(),
    startedAt: pi.iniciado_en ? new Date(pi.iniciado_en).getTime() : null,
    finishedAt: pi.terminado_en ? new Date(pi.terminado_en).getTime() : null,
    origen: pi.origen,
    cliente: pi.cliente_nombre ? { nombre: pi.cliente_nombre, apellido: pi.cliente_apellido || '' } : null,
    horaRecogida: pi.hora_recogida ? new Date(pi.hora_recogida).getTime() : null,
    isReward: !!pi.es_regalo,
  };
}

// Cliente de la API -> forma del prototipo.
function adaptCliente(c) {
  return {
    id: c.id,
    nombre: c.nombre,
    apellido: c.apellido,
    telefono: c.telefono,
    pedidosApp: c.pedidos_app_contador ?? 0,
    recompensaPendiente: !!c.recompensa_pendiente,
  };
}

// Estado de un pedido del cliente (la ruta /clientes/yo/pedidos no trae el estado
// calculado, así que se deriva de las banderas + el estado de sus items).
function estadoPedidoCliente(p) {
  if (p.no_show) return 'no_show';
  if (p.cancelado) return 'cancelado';
  const its = p.items || [];
  if (its.length > 0 && its.every(i => i.estado === 'terminado')) return p.cobrado ? 'terminado' : 'listo';
  if (its.some(i => i.estado && i.estado !== 'pendiente')) return 'en_preparacion';
  return 'pendiente';
}

// Receta de la API -> forma de "override" que usa buildRecipe. Los campos en
// null se dejan undefined para que buildRecipe caiga a su valor por defecto.
function adaptReceta(r) {
  return {
    pasos: Array.isArray(r.pasos) ? r.pasos : [],
    gramajePorShot: r.gramaje_por_shot != null ? Number(r.gramaje_por_shot) : undefined,
    molienda: r.molienda || undefined,
    moliendaEspecial: r.molienda_especial || undefined,
    ajusteMolino: r.ajuste_molino || undefined,
    ajusteMolinoEspecial: r.ajuste_molino_especial || undefined,
    tiempoExtraccion: r.tiempo_extraccion || undefined,
    tiempoExtraccionEspecial: r.tiempo_extraccion_especial || undefined,
    tiempoLicuado: r.tiempo_extraccion || undefined, // para frappés
    temperatura: r.temperatura_servicio || undefined,
    texturaLeche: r.textura_leche || undefined,
  };
}

// Materia prima de la API -> forma del prototipo (snake_case -> camelCase).
function adaptMateria(m) {
  return {
    id: m.id,
    nombre: m.nombre,
    categoria: m.categoria,
    unidad: m.unidad,
    stockActual: Number(m.stock_actual),
    stockMinimo: Number(m.stock_minimo),
    costoUnitario: Number(m.costo_unitario),
    proveedorId: m.proveedor_id || null,
    activo: m.activo !== false,
  };
}

/* ============================================================
   GAUGE — elemento distintivo (manómetro de tiempo, inspirado
   en el manómetro de presión de una máquina de espresso)
   ============================================================ */

function Gauge({ seconds = 0, size = 84 }) {
  const value = Math.min(9, seconds / 60);
  const cx = 50, cy = 50, r = 36;
  const angleFor = v => -135 + (v / 9) * 270;
  const needleAngle = angleFor(value);
  const ticks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(v => {
    const a = (angleFor(v) * Math.PI) / 180;
    const major = v % 3 === 0;
    const rIn = major ? r - 9 : r - 5;
    return {
      v, major,
      x1: cx + rIn * Math.sin(a), y1: cy - rIn * Math.cos(a),
      x2: cx + r * Math.sin(a), y2: cy - r * Math.cos(a),
    };
  });
  const zoneColor = value < 5 ? '#7FA87A' : value < 7.5 ? '#E3A23D' : '#D1572E';

  return (
    <div className="gauge-wrap" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx={cx} cy={cy} r={r + 7} className="gauge-face" />
        <circle cx={cx} cy={cy} r={r} className="gauge-inner" />
        {ticks.map(t => (
          <line key={t.v} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.major ? 'tick-major' : 'tick-minor'} />
        ))}
        <line x1={cx} y1={cy} x2={cx} y2={cy - r + 13} className="needle" style={{ stroke: zoneColor }} transform={`rotate(${needleAngle} ${cx} ${cy})`} />
        <line x1={cx} y1={cy} x2={cx} y2={cy + 9} className="needle-tail" style={{ stroke: zoneColor }} transform={`rotate(${needleAngle} ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r="4.2" style={{ fill: zoneColor }} />
      </svg>
      <div className="gauge-readout" style={{ color: zoneColor }}>{mmss(seconds)}</div>
    </div>
  );
}

/* ============================================================
   ÁTOMOS DE UI
   ============================================================ */

function StatusChip({ status }) {
  const map = {
    pendiente: { label: 'Pendiente', cls: 'status-pendiente', Icon: Clock },
    en_preparacion: { label: 'En preparación', cls: 'status-en_preparacion', Icon: Droplets },
    listo: { label: 'Listo — falta cobrar', cls: 'status-listo', Icon: Banknote },
    terminado: { label: 'Terminado', cls: 'status-terminado', Icon: Check },
    cancelado: { label: 'Cancelado', cls: 'status-cancelado', Icon: X },
    no_show: { label: 'No recogido', cls: 'status-cancelado', Icon: AlertCircle },
  };
  const m = map[status] || map.pendiente;
  const { Icon } = m;
  return <span className={`status-chip ${m.cls}`}><Icon size={12} />{m.label}</span>;
}

function UserChip({ user }) {
  if (!user) return null;
  return <span className="user-chip"><User size={11} /> {user.nombre}</span>;
}

function Stepper({ value, min = 1, max = 99, onChange }) {
  return (
    <div className="stepper">
      <button className="stepper-btn" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Disminuir"><Minus size={16} /></button>
      <span className="stepper-value">{value}</span>
      <button className="stepper-btn" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Aumentar"><Plus size={16} /></button>
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmLabel = 'Confirmar', danger }) {
  if (!open) return null;
  return (
    <div className="overlay overlay-center" onClick={onCancel}>
      <div className="confirm-card" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function ToastHost({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.tone === 'success' ? <Check size={16} /> : t.tone === 'warn' ? <AlertTriangle size={16} /> : <Sparkles size={16} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={28} /></div>
      <p className="empty-title">{title}</p>
      {subtitle && <p className="empty-subtitle">{subtitle}</p>}
    </div>
  );
}

/* ============================================================
   PANTALLA: SELECCIÓN DE ROL
   ============================================================ */

function PinGate({ onSuccess, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  // El PIN se verifica contra la API (bcrypt del lado del servidor), no contra
  // una lista local: el frontend nunca conoce los PIN reales.
  const press = digit => {
    if (pin.length >= 4 || error || loading) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      setLoading(true);
      api.login(next)
        .then(u => onSuccess(u))
        .catch(() => {
          setError(true);
          setLoading(false);
          setTimeout(() => { setError(false); setPin(''); }, 700);
        });
    }
  };
  const del = () => setPin(p => p.slice(0, -1));
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div className="content pin-gate">
      <button className="icon-btn pin-back" onClick={onCancel} aria-label="Volver"><ChevronLeft size={20} /></button>
      <div className="pin-head">
        <div className="registro-icon"><Lock size={24} /></div>
        <h2>Acceso del personal</h2>
        <p className="registro-sub">Ingresa tu PIN de 4 dígitos</p>
      </div>
      <div className={`pin-dots ${error ? 'error' : ''}`}>
        {[0, 1, 2, 3].map(i => <span key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />)}
      </div>
      {error && <div className="form-error pin-error"><AlertTriangle size={13} /> PIN incorrecto, intenta otra vez.</div>}
      <div className="pin-keypad">
        {keys.map((k, i) => (
          k === '' ? <span key={i} /> :
          k === 'del' ? (
            <button key={i} className="pin-key" onClick={del} aria-label="Borrar"><X size={18} /></button>
          ) : (
            <button key={i} className="pin-key" onClick={() => press(k)}>{k}</button>
          )
        ))}
      </div>
    </div>
  );
}

function RoleSelect({ onSelectCliente, onStaffLogin, usuarios, nombreNegocio, logo }) {
  const [showPin, setShowPin] = useState(false);

  if (showPin) {
    return <PinGate usuarios={usuarios} onSuccess={onStaffLogin} onCancel={() => setShowPin(false)} />;
  }

  return (
    <div className="content role-select">
      <div className="role-select-head">
        <div className={`brand-mark${logo ? ' has-logo' : ''}`}>{logo ? <img src={logo} alt="" className="brand-logo" /> : <Coffee size={26} />}</div>
        <h1>{nombreNegocio || 'Mi Cafetería'}</h1>
        <p>Especialidad sobre ruedas</p>
      </div>

      <button className="client-cta" onClick={onSelectCliente}>
        <span className="client-cta-icon"><Coffee size={26} /></span>
        <span className="client-cta-text">
          <span className="client-cta-title">Ordenar mi café</span>
          <span className="client-cta-sub">Regístrate, mira el menú y levanta tu pedido</span>
        </span>
        <ChevronLeft size={18} style={{ transform: 'rotate(180deg)' }} />
      </button>

      <button className="staff-link" onClick={() => setShowPin(true)}>
        <Lock size={14} /> Acceso del personal
      </button>
    </div>
  );
}

/* ============================================================
   TOPBAR
   ============================================================ */

function TopBar({ title, subtitle, onBack, onSwitchRole, right }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        {onBack && <button className="icon-btn" onClick={onBack}><ChevronLeft size={20} /></button>}
        <div>
          <div className="topbar-title">{title}</div>
          {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div className="topbar-right">
        {right}
        {onSwitchRole && <button className="icon-btn" onClick={onSwitchRole} aria-label="Cambiar rol"><Users size={19} /></button>}
      </div>
    </div>
  );
}

/* ============================================================
   CAJERO
   ============================================================ */

function CategoryTabs({ active, onSelect }) {
  return (
    <div className="cat-tabs">
      {CATEGORIES.map(c => {
        const Icon = c.icon;
        return (
          <button key={c.id} className={`cat-tab ${active === c.id ? 'active' : ''}`} onClick={() => onSelect(c.id)}>
            <Icon size={16} /> {c.id}
          </button>
        );
      })}
    </div>
  );
}

function ProductGrid({ activeCat, onTap }) {
  const list = PRODUCTS.filter(p => p.cat === activeCat && p.activo !== false);
  return (
    <div className="product-grid">
      {list.length === 0 ? (
        <EmptyState icon={Coffee} title="Sin productos disponibles en esta categoría" />
      ) : (
        list.map(p => (
          <button key={p.id} className="product-card" onClick={() => onTap(p)}>
            {p.frio && <span className="frio-tag"><Snowflake size={11} /></span>}
            <span className="product-icon">{p.icon}</span>
            <span className="product-name">{p.name}</span>
            <span className="product-price">{p.sizes ? `desde ${money(p.price - 6)}` : money(p.price)}</span>
          </button>
        ))
      )}
    </div>
  );
}

function CustomizeSheet({ product, onClose, onAdd, onPreviewRecipe }) {
  const [sel, setSel] = useState({
    size: product.sizes ? '12' : null,
    milk: product.leche ? 'entera' : null,
    coffeeType: product.coffeeType ? 'tradicional' : null,
    extras: [],
    notas: '',
    qty: 1,
  });

  const toggleExtra = id => {
    setSel(s => ({ ...s, extras: s.extras.includes(id) ? s.extras.filter(e => e !== id) : [...s.extras, id] }));
  };

  const unitPrice = calcUnitPrice(product, sel);
  const lineTotal = unitPrice * sel.qty;

  return (
    <Sheet title={product.name} onClose={onClose}>
      {onPreviewRecipe && (
        <button className="recipe-preview-link" onClick={() => onPreviewRecipe(sel)}>
          <ClipboardList size={14} /> Ver receta de esta bebida
        </button>
      )}
      {product.sizes && (
        <div className="option-group">
          <div className="option-label">Tamaño</div>
          <div className="option-row">
            {SIZE_OPTIONS.map(o => (
              <button key={o.id} className={`option-chip ${sel.size === o.id ? 'selected' : ''}`} onClick={() => setSel(s => ({ ...s, size: o.id }))}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {product.leche && (
        <div className="option-group">
          <div className="option-label">Leche</div>
          <div className="option-row">
            {MILK_OPTIONS.map(o => (
              <button key={o.id} className={`option-chip ${sel.milk === o.id ? 'selected' : ''}`} onClick={() => setSel(s => ({ ...s, milk: o.id }))}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {product.coffeeType && (
        <div className="option-group">
          <div className="option-label">Café</div>
          <div className="option-row">
            {COFFEE_OPTIONS.map(o => (
              <button key={o.id} className={`option-chip ${sel.coffeeType === o.id ? 'selected' : ''}`} onClick={() => setSel(s => ({ ...s, coffeeType: o.id }))}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {product.extras && (
        <div className="option-group">
          <div className="option-label">Extras</div>
          <div className="option-row">
            {EXTRA_OPTIONS.map(o => (
              <button key={o.id} className={`option-chip ${sel.extras.includes(o.id) ? 'selected' : ''}`} onClick={() => toggleExtra(o.id)}>
                {o.label} (+{o.delta})
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="option-group">
        <div className="option-label">Cantidad</div>
        <Stepper value={sel.qty} onChange={v => setSel(s => ({ ...s, qty: v }))} />
      </div>
      <div className="option-group">
        <div className="option-label">Notas para el barista</div>
        <textarea className="notes-input" rows={2} placeholder="Ej. sin azúcar, bien caliente..." value={sel.notas} onChange={e => setSel(s => ({ ...s, notas: e.target.value }))} />
      </div>
      <div className="sheet-footer">
        <div>
          <div className="footer-label">Total</div>
          <div className="price-total">{money(lineTotal)}</div>
        </div>
        <button className="btn-primary" onClick={() => { onAdd({ uid: `${product.id}-${Date.now()}`, productId: product.id, ...sel, unitPrice }); onClose(); }}>
          Agregar al carrito
        </button>
      </div>
    </Sheet>
  );
}

function DiscountSheet({ onClose, onApply, current }) {
  const [pct, setPct] = useState(current?.porcentaje || 10);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const apply = async () => {
    setLoading(true); setError('');
    try { await onApply(pct, code); onClose(); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  return (
    <Sheet title="Aplicar descuento" onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Porcentaje</div>
        <div className="option-row">
          {[5, 10, 15, 20].map(p => (
            <button key={p} className={`option-chip ${pct === p ? 'selected' : ''}`} onClick={() => setPct(p)}>{p}%</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Código de autorización (administrador)</div>
        <input className="text-input" placeholder="Ej. 1234" value={code} onChange={e => setCode(e.target.value)} />
        {error && <div className="form-error"><AlertTriangle size={13} /> {error}</div>}
      </div>
      <div className="sheet-footer">
        {current ? <button className="btn-ghost" onClick={() => { onApply(null); onClose(); }}>Quitar descuento</button> : <span />}
        <button className="btn-primary" disabled={!/^\d{4}$/.test(code) || loading} onClick={apply}>{loading ? 'Autorizando…' : `Aplicar ${pct}%`}</button>
      </div>
    </Sheet>
  );
}

function CartView({ cart, setCart, discount, setDiscount, onAuthorizeDiscount, onCheckout, allowDiscount = true, ctaLabel, footerExtra }) {
  const [discountOpen, setDiscountOpen] = useState(false);
  const updateQty = (uid, qty) => {
    if (qty <= 0) { setCart(c => c.filter(i => i.uid !== uid)); return; }
    setCart(c => c.map(i => (i.uid === uid ? { ...i, qty } : i)));
  };
  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const discountPct = discount?.porcentaje || 0;
  const discountAmt = discountPct ? subtotal * (discountPct / 100) : 0;
  const total = subtotal - discountAmt;

  if (cart.length === 0) {
    return <EmptyState icon={ShoppingCart} title="Tu carrito está vacío" subtitle="Toca un producto en el menú para comenzar" />;
  }

  return (
    <div className="cart-view">
      <div className="cart-list">
        {cart.map(item => {
          const product = getProduct(item.productId);
          return (
            <div key={item.uid} className="cart-item">
              <span className="cart-item-icon">{product.icon}</span>
              <div className="cart-item-info">
                <div className="cart-item-name">{product.name}{item.isReward ? ' 🎁' : ''}</div>
                <div className="cart-item-sub">{customizationSummary(item) || 'Sin personalización'}</div>
                {item.notas && <div className="cart-item-notes">"{item.notas}"</div>}
              </div>
              <div className="cart-item-controls">
                <Stepper value={item.qty} onChange={v => updateQty(item.uid, v)} />
                <div className="cart-item-price">{money(item.unitPrice * item.qty)}</div>
                <button className="icon-btn small" onClick={() => setCart(c => c.filter(i => i.uid !== item.uid))}><Trash2 size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cart-summary">
        {allowDiscount && (
          <button className="discount-link" onClick={() => setDiscountOpen(true)}>
            {discount ? `Descuento aplicado: ${discountPct}% — editar` : '+ Aplicar descuento (requiere autorización)'}
          </button>
        )}
        {footerExtra}
        <div className="summary-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {discount && <div className="summary-row discount-row"><span>Descuento ({discountPct}%)</span><span>-{money(discountAmt)}</span></div>}
        <div className="summary-row total"><span>Total</span><span>{money(total)}</span></div>
        <button className="btn-primary full" onClick={() => onCheckout({ subtotal, discountAmt, total })}>{ctaLabel || `Cobrar ${money(total)}`}</button>
      </div>

      {allowDiscount && discountOpen && <DiscountSheet current={discount} onClose={() => setDiscountOpen(false)} onApply={onAuthorizeDiscount} />}
    </div>
  );
}

function CheckoutView({ amounts, onConfirm, onBack }) {
  const { total } = amounts;
  const [method, setMethod] = useState('efectivo');
  const [cash, setCash] = useState('');
  const [mixCash, setMixCash] = useState('');
  const [mixCard, setMixCard] = useState('');

  const cashGiven = parseFloat(cash) || 0;
  const change = cashGiven - total;
  const mixSum = (parseFloat(mixCash) || 0) + (parseFloat(mixCard) || 0);

  const canConfirm =
    method === 'tarjeta' || method === 'transferencia'
      ? true
      : method === 'efectivo'
      ? cashGiven >= total
      : Math.abs(mixSum - total) < 0.01;

  const methods = [
    { id: 'efectivo', label: 'Efectivo', Icon: Banknote },
    { id: 'tarjeta', label: 'Tarjeta', Icon: CreditCard },
    { id: 'transferencia', label: 'Transferencia', Icon: ArrowLeftRight },
    { id: 'mixto', label: 'Mixto', Icon: Wallet },
  ];

  return (
    <div className="checkout-view">
      <div className="checkout-total-card">
        <span className="footer-label">Total a cobrar</span>
        <span className="price-total big">{money(total)}</span>
      </div>

      <div className="option-label">Forma de pago</div>
      <div className="pay-methods">
        {methods.map(m => (
          <button key={m.id} className={`pay-method-btn ${method === m.id ? 'selected' : ''}`} onClick={() => setMethod(m.id)}>
            <m.Icon size={20} /><span>{m.label}</span>
          </button>
        ))}
      </div>

      {method === 'efectivo' && (
        <div className="option-group">
          <div className="option-label">Monto recibido</div>
          <div className="option-row">
            {[total, Math.ceil(total / 50) * 50, 200, 500].filter((v, i, a) => a.indexOf(v) === i).map(v => (
              <button key={v} className="option-chip" onClick={() => setCash(String(v))}>{money(v)}</button>
            ))}
          </div>
          <input className="text-input" type="number" placeholder="Otro monto..." value={cash} onChange={e => setCash(e.target.value)} />
          <div className={`change-display ${change < 0 ? 'warn' : ''}`}>
            <span className="footer-label">{change < 0 ? 'Falta' : 'Cambio a entregar'}</span>
            <span className="change-amount">{money(Math.abs(change || 0))}</span>
          </div>
        </div>
      )}

      {method === 'mixto' && (
        <div className="option-group">
          <div className="option-label">Efectivo</div>
          <input className="text-input" type="number" placeholder="$0.00" value={mixCash} onChange={e => setMixCash(e.target.value)} />
          <div className="option-label">Tarjeta / transferencia</div>
          <input className="text-input" type="number" placeholder="$0.00" value={mixCard} onChange={e => setMixCard(e.target.value)} />
          <div className={`change-display ${Math.abs(mixSum - total) > 0.01 ? 'warn' : ''}`}>
            <span className="footer-label">Diferencia con el total</span>
            <span className="change-amount">{money(total - mixSum)}</span>
          </div>
        </div>
      )}

      <div className="sheet-footer static">
        <button className="btn-ghost" onClick={onBack}>Volver al carrito</button>
        <button
          className="btn-primary"
          disabled={!canConfirm}
          onClick={() => onConfirm({ method, cashGiven: method === 'efectivo' ? cashGiven : null, change: method === 'efectivo' ? change : null })}
        >
          Confirmar pago
        </button>
      </div>
    </div>
  );
}

function ConfirmedView({ order, onNewSale }) {
  useEffect(() => {
    const t = setTimeout(onNewSale, 5000);
    return () => clearTimeout(t);
  }, [onNewSale]);
  return (
    <div className="confirm-screen">
      <div className="confirm-check"><Check size={40} /></div>
      <div className="confirm-order-id">{order.folio || order.id}</div>
      <p>Pedido enviado a la barra de preparación</p>
      <div className="confirm-total">{money(order.total)}</div>
      <button className="btn-primary" onClick={onNewSale}><RotateCcw size={16} /> Nueva venta</button>
    </div>
  );
}

function TurnoView({ orders, now, onCancel, onCobrar, onNoShow }) {
  const total = orders.filter(o => o.cobrado && !o.noShow).reduce((s, o) => s + o.total, 0);

  if (orders.length === 0) {
    return <EmptyState icon={Receipt} title="Aún no hay ventas en este turno" />;
  }

  return (
    <div className="turno-view">
      <div className="turno-total"><span>Total del turno</span><span className="price-total">{money(total)}</span></div>
      {orders.map(o => {
        const status = o.estado;
        const vencido = status === 'listo' && o.horaRecogida && now - o.horaRecogida > NO_SHOW_WARNING_MS;
        return (
          <div key={o.id} className="turno-row">
            <div>
              <div className="turno-id">{o.folio}</div>
              <div className="turno-sub">
                {new Date(o.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} • {o.numItems} producto(s) • {o.payMethod}
                {o.origen === 'app' && o.cliente && ` • 🌐 En línea — ${o.cliente.nombre} ${o.cliente.apellido}`}
              </div>
              {vencido && <div className="vencido-warning"><AlertTriangle size={11} /> Pasada la hora de recogida sin cobrarse</div>}
            </div>
            <div className="turno-right">
              <div className="turno-amount">{money(o.total)}</div>
              <StatusChip status={status} />
              {status === 'pendiente' && (
                <button className="link-danger" onClick={() => onCancel(o.id)}>Cancelar</button>
              )}
              {status === 'listo' && (
                <div className="turno-actions">
                  <button className="btn-primary small" onClick={() => onCobrar(o)}>
                    {o.total > 0 ? `Cobrar ${money(o.total)}` : 'Confirmar entrega'}
                  </button>
                  <button className="link-danger" onClick={() => onNoShow(o.id)}>No recogido</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CajeroApp({ tickets, createOrder, orders, cancelOrderFn, confirmarEntrega, marcarNoShow, addToast, onSwitchRole, turnoAbierto, onToggleTurno, currentUser, now }) {
  const [screen, setScreen] = useState('menu');
  const [activeCat, setActiveCat] = useState('Calientes');
  const [customizing, setCustomizing] = useState(null);
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(null);
  const [amounts, setAmounts] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [noShowTarget, setNoShowTarget] = useState(null);
  const [chargingOrder, setChargingOrder] = useState(null);

  const authorizeDiscount = async (porcentaje, pin) => {
    if (!porcentaje) { setDiscount(null); return; }
    const approval = await api.crearAprobacionDescuento({ pin, descuentoPorcentaje: porcentaje });
    setDiscount({ porcentaje, autorizacion: approval.token });
  };

  const quickAdd = product => {
    setCart(c => [...c, { uid: `${product.id}-${Date.now()}`, productId: product.id, qty: 1, unitPrice: product.price, extras: [] }]);
    addToast(`Agregado: ${product.name}`, 'success');
  };

  const backFromCheckout = () => {
    if (chargingOrder) { setChargingOrder(null); setScreen('turno'); }
    else { setScreen('cart'); }
  };

  const handleConfirmPay = async payInfo => {
    if (chargingOrder) {
      await confirmarEntrega(chargingOrder.id, { metodoPago: payInfo.method, montoRecibido: payInfo.cashGiven });
      setChargingOrder(null);
      setAmounts(null);
      setScreen('turno');
      return;
    }
    try {
      const order = await createOrder({
        cart,
        descuentoPorcentaje: discount?.porcentaje,
        autorizacionDescuento: discount?.autorizacion,
        pago: { metodoPago: payInfo.method, montoRecibido: payInfo.cashGiven },
      });
      setLastOrder(order);
      setCart([]);
      setDiscount(null);
      setScreen('confirmed');
    } catch (e) {
      addToast('No se pudo crear el pedido: ' + e.message, 'warn');
    }
  };

  const handleCobrarClick = order => {
    if (order.total > 0) {
      setChargingOrder(order);
      setAmounts({ subtotal: order.total, discountAmt: 0, total: order.total });
      setScreen('checkout');
    } else {
      confirmarEntrega(order.id);
    }
  };

  return (
    <>
      <TopBar
        title="Punto de venta"
        subtitle={screen === 'menu' ? activeCat : undefined}
        onBack={screen === 'checkout' ? backFromCheckout : null}
        onSwitchRole={onSwitchRole}
        right={
          <>
            <button className={`turno-pill ${turnoAbierto ? 'open' : 'closed'}`} onClick={onToggleTurno}>
              {turnoAbierto ? '● Turno abierto' : 'Abrir turno'}
            </button>
            <UserChip user={currentUser} />
          </>
        }
      />
      <div className="content">
        {screen === 'menu' && (
          <>
            <CategoryTabs active={activeCat} onSelect={setActiveCat} />
            <ProductGrid activeCat={activeCat} onTap={p => (p.tipo === 'snack' ? quickAdd(p) : setCustomizing(p))} />
          </>
        )}
        {screen === 'cart' && (
          <CartView cart={cart} setCart={setCart} discount={discount} setDiscount={setDiscount} onAuthorizeDiscount={authorizeDiscount} onCheckout={amts => { setAmounts(amts); setScreen('checkout'); }} />
        )}
        {screen === 'checkout' && (
          <CheckoutView amounts={amounts} onBack={backFromCheckout} onConfirm={handleConfirmPay} />
        )}
        {screen === 'confirmed' && lastOrder && (
          <ConfirmedView order={lastOrder} onNewSale={() => setScreen('menu')} />
        )}
        {screen === 'turno' && (
          <TurnoView
            orders={orders} tickets={tickets} now={now}
            onCancel={id => setCancelTarget(id)}
            onCobrar={handleCobrarClick}
            onNoShow={id => setNoShowTarget(id)}
          />
        )}
      </div>

      {(screen === 'menu' || screen === 'cart' || screen === 'turno') && (
        <div className="tabbar">
          <button className={`tab-btn ${screen === 'menu' ? 'active' : ''}`} onClick={() => setScreen('menu')}>
            <Coffee size={20} /><span>Menú</span>
          </button>
          <button className={`tab-btn ${screen === 'cart' ? 'active' : ''}`} onClick={() => setScreen('cart')}>
            <span className="tab-icon-badge">
              <ShoppingCart size={20} />
              {cart.length > 0 && <span className="badge-count">{cart.reduce((s, i) => s + i.qty, 0)}</span>}
            </span>
            <span>Carrito</span>
          </button>
          <button className={`tab-btn ${screen === 'turno' ? 'active' : ''}`} onClick={() => setScreen('turno')}>
            <Receipt size={20} /><span>Turno</span>
          </button>
        </div>
      )}

      {customizing && <CustomizeSheet product={customizing} onClose={() => setCustomizing(null)} onAdd={item => { setCart(c => [...c, item]); addToast(`Agregado: ${getProduct(item.productId).name}`, 'success'); }} />}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancelar pedido"
        message={`¿Seguro que quieres cancelar el pedido ${cancelTarget}? Esta acción notificará a la barra de preparación.`}
        confirmLabel="Sí, cancelar"
        danger
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => { cancelOrderFn(cancelTarget); setCancelTarget(null); }}
      />

      <ConfirmDialog
        open={!!noShowTarget}
        title="Marcar como no recogido"
        message={`¿Confirmas que el cliente no pasó por el pedido ${noShowTarget}? Se registrará la merma de lo ya preparado y se restará un punto de su tarjeta de fidelidad.`}
        confirmLabel="Sí, marcar"
        danger
        onCancel={() => setNoShowTarget(null)}
        onConfirm={() => { marcarNoShow(noShowTarget); setNoShowTarget(null); }}
      />
    </>
  );
}

/* ============================================================
   BARISTA
   ============================================================ */

function TicketCard({ ticket, now, onVerReceta, onIniciar, onTerminar, onMerma }) {
  const product = getProduct(ticket.productId);
  const elapsedSec = (now - (ticket.status === 'pendiente' ? ticket.createdAt : ticket.startedAt || ticket.createdAt)) / 1000;
  return (
    <div className={`ticket-card status-border-${ticket.status}`}>
      <div className="ticket-head">
        <div>
          <div className="ticket-id">{ticket.folio || ticket.id}</div>
          <div className="ticket-time">{new Date(ticket.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <Gauge seconds={elapsedSec} size={68} />
      </div>

      <div className="ticket-product">
        <span className="ticket-product-icon">{product.icon}</span>
        <div>
          <div className="ticket-product-name">{product.name} {ticket.qty > 1 && `x${ticket.qty}`}</div>
          <div className="ticket-product-sub">{customizationSummary(ticket) || 'Sin personalización'}</div>
        </div>
      </div>

      {(ticket.origen === 'app' || ticket.isReward) && (
        <div className="ticket-tags">
          {ticket.origen === 'app' && (
            <span className="tag-online"><Sparkles size={11} /> En línea{ticket.cliente ? ` — ${ticket.cliente.nombre}` : ''}</span>
          )}
          {ticket.horaRecogida && <span className="tag-scheduled"><Clock size={11} /> Recoge {fmtHora(ticket.horaRecogida)}</span>}
          {ticket.isReward && <span className="tag-reward"><Sparkles size={11} /> Regalo de fidelidad</span>}
        </div>
      )}

      {ticket.notas && <div className="order-notes">"{ticket.notas}"</div>}

      <div className="ticket-actions">
        <button className="btn-secondary" onClick={onVerReceta}><ClipboardList size={15} /> Ver receta</button>
        {ticket.status === 'pendiente' && <button className="btn-primary" onClick={onIniciar}>Iniciar</button>}
        {ticket.status === 'en_preparacion' && <button className="btn-primary" onClick={onTerminar}>Terminar</button>}
        <button className="icon-btn small" onClick={onMerma} aria-label="Registrar merma"><AlertCircle size={16} /></button>
      </div>
    </div>
  );
}

function iconForParam(label) {
  const l = label.toLowerCase();
  if (l.includes('gramaje')) return Coffee;
  if (l.includes('molienda')) return Sparkles;
  if (l.includes('ajuste')) return GaugeIcon;
  if (l.includes('tiempo') || l.includes('licuado')) return Clock;
  if (l.includes('rendimiento')) return Droplets;
  if (l.includes('temperatura')) return Thermometer;
  return Coffee;
}

function RecipeModal({ ticket, onClose, onFinish, readOnly, override, onEdit }) {
  const product = getProduct(ticket.productId);
  const recipe = buildRecipe(product, ticket, override);
  const sizeLabel = product.sizes ? labelOf(SIZE_OPTIONS, ticket.size || '12') : '—';
  const lecheIng = recipe.ingredientes.find(i => i.label.toLowerCase().includes('leche'));
  const texturaLeche = (override && override.texturaLeche) || 'Microespuma suave y sedosa';
  const showFicha = recipe.params.fields.length > 0;
  const showTextura = !!lecheIng && product.tipo === 'bebida';

  const specRows = [
    { Icon: CupSoda, label: 'Tamaño de taza', value: sizeLabel },
    ...recipe.params.fields.map(f => ({ Icon: iconForParam(f.label), label: f.label, value: f.value })),
    ...(lecheIng ? [{ Icon: Milk, label: 'Leche', value: lecheIng.cantidad }] : []),
    ...(showTextura ? [{ Icon: Sparkles, label: 'Textura de la leche', value: texturaLeche }] : []),
    ...(product.tipo === 'bebida' ? [{ Icon: GaugeIcon, label: 'Presión', value: '9 Bar' }] : []),
  ];

  return (
    <div className="recipe-modal">
      <div className="recipe-header">
        <button className="icon-btn" onClick={onClose}><ChevronLeft size={20} /></button>
        <div className="recipe-header-title">{readOnly ? product.name : ticket.id}</div>
        <div style={{ width: 36 }} />
      </div>

      <div className="recipe-hero">
        <span className="recipe-hero-icon">{product.icon}</span>
        <h2>{product.name}</h2>
        <span className="recipe-hero-sub">{customizationSummary(ticket) || 'Estándar'}</span>
      </div>

      {ticket.notas && <div className="recipe-section"><div className="order-notes">"{ticket.notas}"</div></div>}

      {showFicha && (
        <div className="recipe-section">
          <div className="recipe-section-title"><ClipboardList size={15} /> Ficha técnica</div>
          <div className="spec-table">
            {specRows.map((row, i) => (
              <div key={i} className="spec-row">
                <span className="spec-icon"><row.Icon size={16} /></span>
                <span className="spec-label">{row.label}</span>
                <span className="spec-value">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="recipe-section">
        <div className="recipe-section-title"><Droplets size={15} /> Ingredientes</div>
        <div className="ingredient-list">
          {recipe.ingredientes.map((ing, i) => (
            <div key={i} className="ingredient-row"><span>{ing.label}</span><span className="ingredient-qty">{ing.cantidad}</span></div>
          ))}
        </div>
      </div>

      {showTextura && (
        <div className="recipe-section">
          <div className="recipe-section-title"><Sparkles size={15} /> Guía de textura de la leche</div>
          <div className="texture-guide">
            <div className="texture-row good">
              <Check size={16} className="texture-icon" />
              <div className="texture-text"><strong>Perfecta</strong><span>Brillante y sedosa, sin burbujas grandes.</span></div>
            </div>
            <div className="texture-row bad">
              <X size={16} className="texture-icon" />
              <div className="texture-text"><strong>Demasiado aire</strong><span>Burbujas grandes, textura aireada.</span></div>
            </div>
            <div className="texture-row bad">
              <X size={16} className="texture-icon" />
              <div className="texture-text"><strong>Demasiado líquida</strong><span>Aguada, sin cuerpo ni brillo.</span></div>
            </div>
          </div>
        </div>
      )}

      <div className="recipe-section">
        <div className="recipe-section-title"><ClipboardList size={15} /> Pasos de preparación</div>
        <div className="steps-list">
          {recipe.pasos.map((p, i) => (
            <div key={i} className="step-row"><span className="step-num">{i + 1}</span><span>{p}</span></div>
          ))}
        </div>
      </div>

      <div className="finish-btn-wrap">
        {readOnly ? (
          <div className="recipe-footer-actions">
            {onEdit && <button className="btn-secondary" onClick={onEdit}><Pencil size={14} /> Editar receta</button>}
            <button className={onEdit ? 'btn-secondary' : 'btn-secondary full'} onClick={onClose}>Volver</button>
          </div>
        ) : ticket.status === 'terminado' ? (
          <div className="already-done"><Check size={16} /> Bebida terminada</div>
        ) : (
          <button className="finish-btn" onClick={onFinish}><Check size={18} /> Terminar bebida</button>
        )}
      </div>
    </div>
  );
}

function MermaModal({ ticket, onClose, onSave }) {
  const [materias, setMaterias] = useState([]);
  const [materiaId, setMateriaId] = useState(null);
  const [motivo, setMotivo] = useState(MERMA_MOTIVOS[0]);
  const [cantidad, setCantidad] = useState(1);
  const [nota, setNota] = useState('');

  // Lista de insumos reales desde la API (la merma descuenta inventario de verdad).
  useEffect(() => {
    api.getMaterias()
      .then(rows => {
        const activas = rows.filter(m => m.activo !== false);
        setMaterias(activas);
        if (activas[0]) setMateriaId(activas[0].id);
      })
      .catch(() => {});
  }, []);

  const materia = materias.find(m => m.id === materiaId);

  return (
    <Sheet title="Registrar merma" onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Insumo afectado</div>
        <div className="option-row">
          {materias.length === 0
            ? <span style={{ color: '#B8A795', fontSize: 12 }}>Cargando insumos…</span>
            : materias.map(m => (
                <button key={m.id} className={`option-chip ${materiaId === m.id ? 'selected' : ''}`} onClick={() => setMateriaId(m.id)}>{m.nombre}</button>
              ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Motivo</div>
        <div className="option-row">
          {MERMA_MOTIVOS.map(m => (
            <button key={m} className={`option-chip ${motivo === m ? 'selected' : ''}`} onClick={() => setMotivo(m)}>{m}</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Cantidad {materia ? `(${materia.unidad})` : ''}</div>
        <Stepper value={cantidad} onChange={setCantidad} />
      </div>
      <div className="option-group">
        <div className="option-label">Observación (opcional)</div>
        <textarea className="notes-input" rows={2} value={nota} onChange={e => setNota(e.target.value)} />
      </div>
      <div className="sheet-footer">
        <span />
        <button className="btn-danger" disabled={!materia} onClick={() => {
          onSave({
            materiaPrimaId: materia.id,
            cantidad,
            unidad: materia.unidad,
            motivo,
            observacion: nota || undefined,
            pedidoItemId: ticket ? ticket.id : undefined,
          });
          onClose();
        }}>
          Registrar merma
        </button>
      </div>
    </Sheet>
  );
}

function BaristaApp({ tickets, startTicket, finishTicket, addMerma, addToast, onSwitchRole, now, currentUser, recetaOverrides }) {
  const [tab, setTab] = useState('pendientes');
  const [recipeTicket, setRecipeTicket] = useState(null);
  const [mermaTicket, setMermaTicket] = useState(null);

  const dueKey = t => t.horaRecogida || t.createdAt;
  const pendientes = tickets.filter(t => t.status === 'pendiente').sort((a, b) => dueKey(a) - dueKey(b));
  const enPrep = tickets.filter(t => t.status === 'en_preparacion').sort((a, b) => dueKey(a) - dueKey(b));
  const visible = tab === 'pendientes' ? pendientes : enPrep;

  const handleFinish = ticket => {
    finishTicket(ticket);
    if (recipeTicket && recipeTicket.id === ticket.id) setRecipeTicket(null);
  };

  return (
    <>
      <TopBar title="Barra de preparación" subtitle={`${pendientes.length} pendientes • ${enPrep.length} en preparación`} onSwitchRole={onSwitchRole} right={<UserChip user={currentUser} />} />
      <div className="content">
        {visible.length === 0 ? (
          <EmptyState icon={Coffee} title={tab === 'pendientes' ? 'Sin pedidos pendientes' : 'Nada en preparación'} subtitle="¡Buen trabajo!" />
        ) : (
          visible.map(t => (
            <TicketCard
              key={t.id}
              ticket={t}
              now={now}
              onVerReceta={() => setRecipeTicket(t)}
              onIniciar={() => startTicket(t.id)}
              onTerminar={() => handleFinish(t)}
              onMerma={() => setMermaTicket(t)}
            />
          ))
        )}
      </div>
      <div className="tabbar">
        <button className={`tab-btn ${tab === 'pendientes' ? 'active' : ''}`} onClick={() => setTab('pendientes')}>
          <span className="tab-icon-badge"><Clock size={20} />{pendientes.length > 0 && <span className="badge-count">{pendientes.length}</span>}</span>
          <span>Pendientes</span>
        </button>
        <button className={`tab-btn ${tab === 'preparacion' ? 'active' : ''}`} onClick={() => setTab('preparacion')}>
          <span className="tab-icon-badge"><Droplets size={20} />{enPrep.length > 0 && <span className="badge-count">{enPrep.length}</span>}</span>
          <span>En preparación</span>
        </button>
      </div>

      {recipeTicket && (
        <RecipeModal
          ticket={tickets.find(t => t.id === recipeTicket.id) || recipeTicket}
          override={recetaOverrides[recipeTicket.productId]}
          onClose={() => setRecipeTicket(null)}
          onFinish={() => handleFinish(recipeTicket)}
        />
      )}
      {mermaTicket && <MermaModal ticket={mermaTicket} onClose={() => setMermaTicket(null)} onSave={addMerma} />}
    </>
  );
}

/* ============================================================
   ADMIN (panel ligero — alcance completo en Fase 2/3)
   ============================================================ */

function PromoConfigSheet({ config, onClose, onSave }) {
  const [activo, setActivo] = useState(config.activo);
  const [cada, setCada] = useState(config.cada);
  const [premioId, setPremioId] = useState(config.premioId);
  return (
    <Sheet title="Promoción de fidelidad" onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Estado de la promoción</div>
        <div className="option-row">
          <button className={`option-chip ${activo ? 'selected' : ''}`} onClick={() => setActivo(true)}>Activa</button>
          <button className={`option-chip ${!activo ? 'selected' : ''}`} onClick={() => setActivo(false)}>Inactiva</button>
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Cada cuántos pedidos por la app</div>
        <Stepper value={cada} min={2} max={50} onChange={setCada} />
      </div>
      <div className="option-group">
        <div className="option-label">Premio</div>
        <div className="option-row">
          {PRODUCTS.filter(p => p.activo !== false).map(p => (
            <button key={p.id} className={`option-chip ${premioId === p.id ? 'selected' : ''}`} onClick={() => setPremioId(p.id)}>
              {p.icon} {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" onClick={() => { onSave({ activo, cada, premioId }); onClose(); }}>Guardar promoción</button>
      </div>
    </Sheet>
  );
}

function UsuarioFormSheet({ user, onClose, onSave }) {
  const isNew = !user || !user.id;
  const [nombre, setNombre] = useState(user ? user.nombre || '' : '');
  const [rol, setRol] = useState(user ? user.rol || 'cajero' : 'cajero');
  const [pin, setPin] = useState(user ? user.pin || '' : '');
  const [error, setError] = useState('');

  const submit = () => {
    if (!nombre.trim()) { setError('Ingresa un nombre.'); return; }
    if (isNew && !/^\d{4}$/.test(pin)) { setError('El PIN debe tener exactamente 4 dígitos.'); return; }
    if (!isNew && pin && !/^\d{4}$/.test(pin)) { setError('Si cambias el PIN, debe tener 4 dígitos.'); return; }
    setError('');
    onSave({ id: isNew ? undefined : user.id, nombre: nombre.trim(), rol, pin, activo: isNew ? true : user.activo });
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Agregar usuario' : 'Editar usuario'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre</div>
        <input className="text-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Ana López" />
      </div>
      <div className="option-group">
        <div className="option-label">Rol</div>
        <div className="option-row">
          {['cajero', 'barista', 'admin'].map(r => (
            <button key={r} className={`option-chip ${rol === r ? 'selected' : ''}`} onClick={() => setRol(r)}>{ROLE_LABELS[r]}</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">PIN de acceso (4 dígitos)</div>
        <input className="text-input" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Ej. 5831" />
      </div>
      {error && <div className="form-error"><AlertTriangle size={13} /> {error}</div>}
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" onClick={submit}>{isNew ? 'Agregar usuario' : 'Guardar cambios'}</button>
      </div>
    </Sheet>
  );
}

function ProveedorFormSheet({ proveedor, onClose, onSave }) {
  const isNew = !proveedor || !proveedor.id;
  const [nombre, setNombre] = useState(proveedor ? proveedor.nombre || '' : '');
  const [categoria, setCategoria] = useState(proveedor ? proveedor.categoria || PROVEEDOR_CATEGORIAS[0] : PROVEEDOR_CATEGORIAS[0]);
  const [contacto, setContacto] = useState(proveedor ? proveedor.contacto || '' : '');
  const [telefono, setTelefono] = useState(proveedor ? proveedor.telefono || '' : '');
  const [error, setError] = useState('');

  const submit = () => {
    if (!nombre.trim()) { setError('Ingresa el nombre del proveedor.'); return; }
    setError('');
    onSave({
      id: isNew ? undefined : proveedor.id, nombre: nombre.trim(), categoria,
      contacto: contacto.trim(), telefono: telefono.replace(/\D/g, '').slice(0, 10),
      activo: isNew ? true : proveedor.activo,
    });
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Agregar proveedor' : 'Editar proveedor'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre del proveedor</div>
        <input className="text-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Tueste Local" />
      </div>
      <div className="option-group">
        <div className="option-label">Categoría de insumos</div>
        <div className="option-row">
          {PROVEEDOR_CATEGORIAS.map(c => (
            <button key={c} className={`option-chip ${categoria === c ? 'selected' : ''}`} onClick={() => setCategoria(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Persona de contacto</div>
        <input className="text-input" value={contacto} onChange={e => setContacto(e.target.value)} placeholder="Ej. Mario Pérez" />
      </div>
      <div className="option-group">
        <div className="option-label">Teléfono</div>
        <input className="text-input" inputMode="numeric" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="Ej. 9611234567" />
      </div>
      {error && <div className="form-error"><AlertTriangle size={13} /> {error}</div>}
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" onClick={submit}>{isNew ? 'Agregar proveedor' : 'Guardar cambios'}</button>
      </div>
    </Sheet>
  );
}

function MateriaFormSheet({ item, proveedores, onClose, onSave }) {
  const isNew = !item || !item.id;
  const [nombre, setNombre] = useState(item ? item.nombre || '' : '');
  const [categoria, setCategoria] = useState(item ? item.categoria || MATERIA_CATEGORIAS[0] : MATERIA_CATEGORIAS[0]);
  const [unidad, setUnidad] = useState(item ? item.unidad || 'kg' : 'kg');
  const [stockActual, setStockActual] = useState(item ? String(item.stockActual ?? '') : '');
  const [stockMinimo, setStockMinimo] = useState(item ? String(item.stockMinimo ?? '') : '');
  const [costoUnitario, setCostoUnitario] = useState(item ? String(item.costoUnitario ?? '') : '');
  const [proveedorId, setProveedorId] = useState(item ? item.proveedorId || (proveedores[0] ? proveedores[0].id : '') : (proveedores[0] ? proveedores[0].id : ''));
  const [error, setError] = useState('');

  const submit = () => {
    if (!nombre.trim()) { setError('Ingresa un nombre.'); return; }
    if (stockActual === '' || stockMinimo === '' || costoUnitario === '') { setError('Completa stock actual, mínimo y costo.'); return; }
    setError('');
    onSave({
      id: isNew ? undefined : item.id, nombre: nombre.trim(), categoria, unidad,
      stockActual: parseFloat(stockActual) || 0, stockMinimo: parseFloat(stockMinimo) || 0,
      costoUnitario: parseFloat(costoUnitario) || 0, proveedorId,
      activo: isNew ? true : item.activo,
    });
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Agregar materia prima' : 'Editar materia prima'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre</div>
        <input className="text-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Leche entera" />
      </div>
      <div className="option-group">
        <div className="option-label">Categoría</div>
        <div className="option-row">
          {MATERIA_CATEGORIAS.map(c => (
            <button key={c} className={`option-chip ${categoria === c ? 'selected' : ''}`} onClick={() => setCategoria(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Unidad de medida</div>
        <div className="option-row">
          {UNIDADES.map(u => (
            <button key={u} className={`option-chip ${unidad === u ? 'selected' : ''}`} onClick={() => setUnidad(u)}>{u}</button>
          ))}
        </div>
      </div>
      <div className="option-group two-col">
        <div>
          <div className="option-label">Stock actual</div>
          <input className="text-input" type="number" step="0.1" value={stockActual} onChange={e => setStockActual(e.target.value)} placeholder="0" />
        </div>
        <div>
          <div className="option-label">Stock mínimo</div>
          <input className="text-input" type="number" step="0.1" value={stockMinimo} onChange={e => setStockMinimo(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Costo unitario ($ por {unidad})</div>
        <input className="text-input" type="number" step="0.01" value={costoUnitario} onChange={e => setCostoUnitario(e.target.value)} placeholder="0.00" />
      </div>
      {proveedores.length > 0 && (
        <div className="option-group">
          <div className="option-label">Proveedor</div>
          <div className="option-row">
            {proveedores.map(p => (
              <button key={p.id} className={`option-chip ${proveedorId === p.id ? 'selected' : ''}`} onClick={() => setProveedorId(p.id)}>{p.nombre}</button>
            ))}
          </div>
        </div>
      )}
      {error && <div className="form-error"><AlertTriangle size={13} /> {error}</div>}
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" onClick={submit}>{isNew ? 'Agregar' : 'Guardar cambios'}</button>
      </div>
    </Sheet>
  );
}

function MateriasSection({ materias, proveedores, onEdit, onAdd, onToggleActivo }) {
  const [filtro, setFiltro] = useState('Todas');
  const categorias = ['Todas', ...MATERIA_CATEGORIAS];
  const lista = filtro === 'Todas' ? materias : materias.filter(m => m.categoria === filtro);
  return (
    <>
      <div className="cat-tabs">
        {categorias.map(c => (
          <button key={c} className={`cat-tab ${filtro === c ? 'active' : ''}`} onClick={() => setFiltro(c)}>{c}</button>
        ))}
      </div>
      {lista.map(m => {
        const proveedor = proveedores.find(p => p.id === m.proveedorId);
        const pct = Math.min(100, Math.round((m.stockActual / m.stockMinimo) * 100));
        const bajo = m.stockActual < m.stockMinimo;
        return (
          <div key={m.id} className="materia-row">
            <div className="materia-info">
              <div className="materia-name">{m.nombre}{!m.activo ? ' • Inactivo' : ''}</div>
              <div className="materia-sub">{m.categoria} • {proveedor ? proveedor.nombre : 'Sin proveedor'} • {money(m.costoUnitario)}/{m.unidad}</div>
              <div className="stock-bar"><div className={`stock-bar-fill ${bajo ? '' : 'ok'}`} style={{ width: `${pct}%` }} /></div>
              <div className="materia-stock-label">
                {m.stockActual} / {m.stockMinimo} {m.unidad}
                {bajo && <span className="bajo-tag"><AlertTriangle size={11} /> Bajo</span>}
              </div>
            </div>
            <div className="usuario-actions vertical">
              <button className="icon-btn small" onClick={() => onEdit(m)} aria-label="Editar"><Pencil size={14} /></button>
              <button className="link-toggle" onClick={() => onToggleActivo(m.id, m.activo)}>{m.activo ? 'Desactivar' : 'Activar'}</button>
            </div>
          </div>
        );
      })}
      <button className="btn-secondary full" onClick={onAdd}><Plus size={15} /> Agregar materia prima</button>
    </>
  );
}

function ProveedoresSection({ proveedores, materias, onEdit, onAdd, onToggleActivo }) {
  return (
    <>
      {proveedores.map(p => {
        const nInsumos = materias.filter(m => m.proveedorId === p.id).length;
        return (
          <div key={p.id} className="proveedor-row">
            <span className="usuario-avatar role-admin">{p.nombre.charAt(0).toUpperCase()}</span>
            <div className="proveedor-info">
              <div className="usuario-name">{p.nombre}{!p.activo ? ' • Inactivo' : ''}</div>
              <div className="usuario-role">{p.categoria} • {p.contacto || 'Sin contacto'}{p.telefono ? ` • ${p.telefono}` : ''}</div>
              <div className="proveedor-meta">{nInsumos} insumo(s) registrados</div>
            </div>
            <div className="usuario-actions vertical">
              <button className="icon-btn small" onClick={() => onEdit(p)} aria-label="Editar"><Pencil size={14} /></button>
              <button className="link-toggle" onClick={() => onToggleActivo(p.id, p.activo)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
            </div>
          </div>
        );
      })}
      <button className="btn-secondary full" onClick={onAdd}><Plus size={15} /> Agregar proveedor</button>
    </>
  );
}

function RecetasSection({ onView, recetaOverrides }) {
  return (
    <>
      <p className="recetas-hint">Toca una bebida para ver su receta (12 oz, leche entera, café tradicional) y desde ahí puedes editarla. Las cantidades de ingredientes siguen ajustándose solas según tamaño/extras; lo que editas aquí son los pasos y los parámetros de extracción.</p>
      <div className="product-grid">
        {PRODUCTS.filter(p => p.tipo !== 'snack' && p.activo !== false).map(p => (
          <button key={p.id} className="product-card" onClick={() => onView(p)}>
            {recetaOverrides[p.id] && <span className="custom-badge"><Pencil size={11} /></span>}
            <span className="product-icon">{p.icon}</span>
            <span className="product-name">{p.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function RecetaFormSheet({ product, receta, onClose, onSave }) {
  const isFrappe = product.tipo === 'frappe';
  const defaults = buildRecipe(product, { size: '12', milk: 'entera', coffeeType: 'tradicional', extras: [] }, null);
  const [pasos, setPasos] = useState((receta && receta.pasos ? receta.pasos : defaults.pasos).join('\n'));
  const [gramaje, setGramaje] = useState(String((receta && receta.gramajePorShot) || 18));
  const [molienda, setMolienda] = useState((receta && receta.molienda) || (isFrappe ? 'Gruesa' : 'Media-fina'));
  const [moliendaEspecial, setMoliendaEspecial] = useState((receta && receta.moliendaEspecial) || 'Media (origen)');
  const [ajusteMolino, setAjusteMolino] = useState((receta && receta.ajusteMolino) || '3.5');
  const [ajusteMolinoEspecial, setAjusteMolinoEspecial] = useState((receta && receta.ajusteMolinoEspecial) || '4.2');
  const [tiempoExtraccion, setTiempoExtraccion] = useState((receta && (receta.tiempoExtraccion || receta.tiempoLicuado)) || (isFrappe ? '25-30 s' : '26-30 s'));
  const [tiempoExtraccionEspecial, setTiempoExtraccionEspecial] = useState((receta && (receta.tiempoExtraccionEspecial || receta.tiempoExtraccion)) || '26-30 s');
  const [temperatura, setTemperatura] = useState((receta && receta.temperatura) || (isFrappe ? 'Frío / con hielo' : (product.frio ? '92°C / servir frío' : '92°C')));
  const [texturaLeche, setTexturaLeche] = useState((receta && receta.texturaLeche) || 'Microespuma suave y sedosa');
  const [error, setError] = useState('');

  const submit = () => {
    const pasosArr = pasos.split('\n').map(s => s.trim()).filter(Boolean);
    if (pasosArr.length === 0) { setError('Agrega al menos un paso.'); return; }
    setError('');
    onSave(product.id, isFrappe
      ? { pasos: pasosArr, molienda, tiempoLicuado: tiempoExtraccion, temperatura }
      : { pasos: pasosArr, gramajePorShot: parseInt(gramaje, 10) || 18, molienda, moliendaEspecial, ajusteMolino, ajusteMolinoEspecial, tiempoExtraccion, tiempoExtraccionEspecial, temperatura, texturaLeche }
    );
    onClose();
  };

  return (
    <Sheet title={`Editar receta: ${product.name}`} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Pasos de preparación (uno por línea)</div>
        <textarea className="notes-input" rows={6} value={pasos} onChange={e => setPasos(e.target.value)} />
      </div>
      {!isFrappe && (
        <div className="option-group two-col">
          <div>
            <div className="option-label">Gramaje por shot (g)</div>
            <input className="text-input" type="number" value={gramaje} onChange={e => setGramaje(e.target.value)} />
          </div>
          <div>
            <div className="option-label">Tiempo extracción (tradicional)</div>
            <input className="text-input" value={tiempoExtraccion} onChange={e => setTiempoExtraccion(e.target.value)} placeholder="26-30 s" />
          </div>
        </div>
      )}
      {isFrappe && (
        <div className="option-group">
          <div className="option-label">Tiempo de licuado</div>
          <input className="text-input" value={tiempoExtraccion} onChange={e => setTiempoExtraccion(e.target.value)} placeholder="25-30 s" />
        </div>
      )}
      <div className="option-group two-col">
        <div>
          <div className="option-label">Molienda{!isFrappe ? ' (tradicional)' : ''}</div>
          <input className="text-input" value={molienda} onChange={e => setMolienda(e.target.value)} />
        </div>
        {!isFrappe && (
          <div>
            <div className="option-label">Ajuste molino (tradicional)</div>
            <input className="text-input" value={ajusteMolino} onChange={e => setAjusteMolino(e.target.value)} />
          </div>
        )}
      </div>
      {!isFrappe && (
        <div className="option-group two-col">
          <div>
            <div className="option-label">Molienda (origen especial)</div>
            <input className="text-input" value={moliendaEspecial} onChange={e => setMoliendaEspecial(e.target.value)} />
          </div>
          <div>
            <div className="option-label">Ajuste molino (especial)</div>
            <input className="text-input" value={ajusteMolinoEspecial} onChange={e => setAjusteMolinoEspecial(e.target.value)} />
          </div>
        </div>
      )}
      {!isFrappe && (
        <div className="option-group">
          <div className="option-label">Tiempo extracción (origen especial)</div>
          <input className="text-input" value={tiempoExtraccionEspecial} onChange={e => setTiempoExtraccionEspecial(e.target.value)} placeholder="26-30 s" />
        </div>
      )}
      <div className="option-group">
        <div className="option-label">Temperatura de servicio</div>
        <input className="text-input" value={temperatura} onChange={e => setTemperatura(e.target.value)} />
      </div>
      {product.leche && !isFrappe && (
        <div className="option-group">
          <div className="option-label">Textura de la leche</div>
          <input className="text-input" value={texturaLeche} onChange={e => setTexturaLeche(e.target.value)} placeholder="Microespuma suave y sedosa" />
        </div>
      )}
      {error && <div className="form-error"><AlertTriangle size={13} /> {error}</div>}
      <div className="sheet-footer">
        <button className="btn-ghost" onClick={() => { onSave(product.id, null); onClose(); }}>Restaurar predeterminada</button>
        <button className="btn-primary" onClick={submit}>Guardar receta</button>
      </div>
    </Sheet>
  );
}

function ProductoFormSheet({ producto, onClose, onSave }) {
  const isNew = !producto || !producto.id;
  const [name, setName] = useState(producto ? producto.name || '' : '');
  const [cat, setCat] = useState(producto ? producto.cat || CATEGORIES[0].id : CATEGORIES[0].id);
  const [icon, setIcon] = useState(producto ? producto.icon || '☕' : '☕');
  const [tipo, setTipo] = useState(producto ? producto.tipo || 'bebida' : 'bebida');
  const [price, setPrice] = useState(producto ? String(producto.price ?? '') : '');
  const [sizes, setSizes] = useState(producto ? !!producto.sizes : true);
  const [leche, setLeche] = useState(producto ? !!producto.leche : false);
  const [coffeeType, setCoffeeType] = useState(producto ? !!producto.coffeeType : true);
  const [extras, setExtras] = useState(producto ? producto.extras !== false : true);
  const [frio, setFrio] = useState(producto ? !!producto.frio : false);
  const [error, setError] = useState('');

  const submit = () => {
    if (!name.trim()) { setError('Ingresa un nombre.'); return; }
    const precioNum = parseFloat(price);
    if (price === '' || isNaN(precioNum)) { setError('Ingresa un precio válido.'); return; }
    setError('');
    const base = { name: name.trim(), cat, icon: icon.trim() || '☕', tipo, price: precioNum };
    onSave(
      tipo === 'snack'
        ? { id: isNew ? undefined : producto.id, ...base, sizes: false, leche: false, coffeeType: false, extras: false, frio: false, activo: isNew ? true : producto.activo !== false }
        : { id: isNew ? undefined : producto.id, ...base, sizes, leche, coffeeType: tipo === 'bebida' ? coffeeType : false, extras, frio, activo: isNew ? true : producto.activo !== false }
    );
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Agregar producto' : 'Editar producto'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre</div>
        <input className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Chai Latte" />
      </div>
      <div className="option-group two-col">
        <div>
          <div className="option-label">Ícono (emoji)</div>
          <input className="text-input" value={icon} onChange={e => setIcon(e.target.value)} placeholder="☕" maxLength={4} />
        </div>
        <div>
          <div className="option-label">Precio base ($)</div>
          <input className="text-input" type="number" step="0.5" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Categoría</div>
        <div className="option-row">
          {CATEGORIES.map(c => (
            <button key={c.id} className={`option-chip ${cat === c.id ? 'selected' : ''}`} onClick={() => setCat(c.id)}>{c.id}</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Tipo de preparación</div>
        <div className="option-row">
          <button className={`option-chip ${tipo === 'bebida' ? 'selected' : ''}`} onClick={() => setTipo('bebida')}>Bebida (espresso)</button>
          <button className={`option-chip ${tipo === 'frappe' ? 'selected' : ''}`} onClick={() => setTipo('frappe')}>Frappé</button>
          <button className={`option-chip ${tipo === 'snack' ? 'selected' : ''}`} onClick={() => setTipo('snack')}>Snack</button>
        </div>
      </div>
      {tipo !== 'snack' && (
        <div className="option-group">
          <div className="option-label">Personalización que permite</div>
          <div className="option-row">
            <button className={`option-chip ${sizes ? 'selected' : ''}`} onClick={() => setSizes(v => !v)}>Tamaños</button>
            <button className={`option-chip ${leche ? 'selected' : ''}`} onClick={() => setLeche(v => !v)}>Leche</button>
            {tipo === 'bebida' && <button className={`option-chip ${coffeeType ? 'selected' : ''}`} onClick={() => setCoffeeType(v => !v)}>Tipo de café</button>}
            <button className={`option-chip ${extras ? 'selected' : ''}`} onClick={() => setExtras(v => !v)}>Extras</button>
            <button className={`option-chip ${frio ? 'selected' : ''}`} onClick={() => setFrio(v => !v)}>Bebida fría</button>
          </div>
        </div>
      )}
      {error && <div className="form-error"><AlertTriangle size={13} /> {error}</div>}
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" onClick={submit}>{isNew ? 'Agregar producto' : 'Guardar cambios'}</button>
      </div>
    </Sheet>
  );
}

function ProductosSection({ productos, onEdit, onAdd, onToggleActivo }) {
  const [filtro, setFiltro] = useState('Todas');
  const categorias = ['Todas', ...CATEGORIES.map(c => c.id)];
  const lista = filtro === 'Todas' ? productos : productos.filter(p => p.cat === filtro);
  return (
    <>
      <div className="cat-tabs">
        {categorias.map(c => (
          <button key={c} className={`cat-tab ${filtro === c ? 'active' : ''}`} onClick={() => setFiltro(c)}>{c}</button>
        ))}
      </div>
      {lista.map(p => (
        <div key={p.id} className="materia-row">
          <div className="materia-info">
            <div className="materia-name">{p.icon} {p.name}{p.activo === false ? ' • Inactivo' : ''}</div>
            <div className="materia-sub">{p.cat} • {p.sizes ? `desde ${money(p.price - 6)}` : money(p.price)}</div>
          </div>
          <div className="usuario-actions vertical">
            <button className="icon-btn small" onClick={() => onEdit(p)} aria-label="Editar"><Pencil size={14} /></button>
            <button className="link-toggle" onClick={() => onToggleActivo(p.id, p.activo !== false)}>{p.activo === false ? 'Activar' : 'Desactivar'}</button>
          </div>
        </div>
      ))}
      <button className="btn-secondary full" onClick={onAdd}><Plus size={15} /> Agregar producto</button>
    </>
  );
}

function ReportesSection({ data }) {
  if (!data) return <EmptyState icon={Receipt} title="Cargando reportes…" />;
  const { ventasPorMetodo = [], masVendidos = [], cancelaciones = {}, mermasPorMotivo = [] } = data;

  return (
    <>
      <div className="section-title"><Wallet size={16} /> Ventas por forma de pago</div>
      {ventasPorMetodo.length === 0 ? (
        <EmptyState icon={Wallet} title="Sin ventas cobradas todavía" />
      ) : (
        ventasPorMetodo.map(r => (
          <div key={r.metodo_pago} className="reporte-row"><span>{PAY_METHOD_LABELS[r.metodo_pago] || r.metodo_pago}</span><span className="turno-amount">{money(r.total)}</span></div>
        ))
      )}

      <div className="section-title" style={{ marginTop: 20 }}><Coffee size={16} /> Productos más vendidos</div>
      {masVendidos.length === 0 ? (
        <EmptyState icon={Coffee} title="Aún no hay ventas registradas" />
      ) : (
        masVendidos.map((r, i) => (
          <div key={r.producto_id} className="reporte-row"><span>{i + 1}. {r.nombre}</span><span className="turno-amount">{r.unidades_vendidas} und.</span></div>
        ))
      )}

      <div className="section-title" style={{ marginTop: 20 }}><AlertCircle size={16} /> Cancelaciones y no recogidos</div>
      <div className="kpi-grid">
        <div className="kpi-card"><span className="kpi-label">Cancelados</span><span className="kpi-value">{Number(cancelaciones.cancelados || 0)}</span></div>
        <div className="kpi-card"><span className="kpi-label">No recogidos</span><span className="kpi-value">{Number(cancelaciones.no_recogidos || 0)}</span></div>
      </div>

      <div className="section-title" style={{ marginTop: 20 }}><AlertTriangle size={16} /> Mermas por motivo</div>
      {mermasPorMotivo.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Sin mermas registradas" />
      ) : (
        mermasPorMotivo.map(r => (
          <div key={r.motivo} className="reporte-row"><span>{r.motivo}</span><span className="turno-amount">{r.num_mermas}</span></div>
        ))
      )}
    </>
  );
}

// Redimensiona una imagen (logo) a un lado máximo y la devuelve como data URL
// base64, para guardarla liviana en la configuración del negocio.
function redimensionarImagen(file, max) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > max || height > max) {
          if (width >= height) { height = Math.round(height * max / width); width = max; }
          else { width = Math.round(width * max / height); height = max; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Editor de la identidad del negocio (marca blanca): nombre + logo. Lo edita el
// admin y aplica a TODA la app (no por usuario).
function BrandingEditor({ nombreNegocio, logo, onSave }) {
  const [nombre, setNombre] = useState(nombreNegocio || '');
  const [logoLocal, setLogoLocal] = useState(logo || '');
  const [guardando, setGuardando] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { setNombre(nombreNegocio || ''); }, [nombreNegocio]);
  useEffect(() => { setLogoLocal(logo || ''); }, [logo]);

  const elegirLogo = async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try { setLogoLocal(await redimensionarImagen(file, 256)); } catch { /* imagen inválida */ }
  };

  const cambiado = nombre.trim() !== (nombreNegocio || '') || logoLocal !== (logo || '');
  const guardar = async () => { setGuardando(true); await onSave({ nombreNegocio: nombre.trim(), logo: logoLocal }); setGuardando(false); };

  return (
    <div className="branding-editor">
      <label className="branding-field-label">Nombre del negocio</label>
      <input className="branding-input" value={nombre} maxLength={60} placeholder="Mi Cafetería"
             onChange={e => setNombre(e.target.value)} />
      <div className="branding-logo-row">
        <div className="branding-logo-preview">{logoLocal ? <img src={logoLocal} alt="logo" /> : <Coffee size={28} />}</div>
        <div className="branding-logo-actions">
          <button className="btn-secondary" onClick={() => fileRef.current && fileRef.current.click()}>Subir logo</button>
          {logoLocal && <button className="link-toggle" onClick={() => setLogoLocal('')}>Quitar logo</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={elegirLogo} />
        </div>
      </div>
      <div className="branding-hint">El logo se ajusta solo a 256 px. Aparece en la pantalla de inicio; el título de la pestaña usa el nombre.</div>
      <button className="btn-primary full" style={{ marginTop: 12 }} disabled={!cambiado || guardando} onClick={guardar}>
        {guardando ? 'Guardando…' : 'Guardar identidad'}
      </button>
    </div>
  );
}

function AdminApp({ kpis, reportes, recargarCatalogo, addToast, smsActivo, onToggleSms, nombreNegocio, logo, onSaveBranding, onSwitchRole, turnoAbierto, promoConfig, setPromoConfig, usuarios, addUsuario, updateUsuario, currentUser, materias, addMateria, updateMateria, proveedores, addProveedor, updateProveedor, recetaOverrides, setRecetaOverride }) {
  const [screen, setScreen] = useState('dashboard');
  const [promoOpen, setPromoOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editingMateria, setEditingMateria] = useState(null);
  const [editingProveedor, setEditingProveedor] = useState(null);
  const [editingProducto, setEditingProducto] = useState(null);
  const [recipeProduct, setRecipeProduct] = useState(null);
  const [editingRecetaProduct, setEditingRecetaProduct] = useState(null);
  const [, bumpProductos] = useState(0); // PRODUCTS vive fuera de React; esto solo fuerza el repintado de Admin.

  // El catálogo se mantiene en el arreglo PRODUCTS (compartido con Caja, Cliente y Recetas) para
  // que un cambio de precio o de disponibilidad se refleje en todo el prototipo sin duplicar datos.
  // En la versión con base de datos real esto sería una tabla "productos" normal.
  const addProducto = async p => {
    try { await api.crearProducto(p); await recargarCatalogo(); bumpProductos(v => v + 1); addToast('Producto agregado', 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const updateProducto = async (id, patch) => {
    try { await api.actualizarProducto(id, patch); await recargarCatalogo(); bumpProductos(v => v + 1); }
    catch (e) { addToast(e.message, 'warn'); }
  };

  const pedidosHoy = kpis ? Number(kpis.pedidos || 0) : 0;
  const ventasHoy = kpis ? Number(kpis.ventas || 0) : 0;
  const ticketProm = kpis ? Number(kpis.ticket_promedio || 0) : 0;
  const premioActual = getProduct(promoConfig.premioId);
  const materiasBajas = materias.filter(m => m.stockActual < m.stockMinimo);

  const TITLES = {
    dashboard: { title: 'Panel administrativo', subtitle: 'Resumen del día' },
    usuarios: { title: 'Usuarios y roles', subtitle: `${usuarios.length} cuenta(s) de personal` },
    materias: { title: 'Materias primas', subtitle: `${materias.length} insumo(s) registrados` },
    proveedores: { title: 'Proveedores', subtitle: `${proveedores.length} proveedor(es)` },
    productos: { title: 'Catálogo de productos', subtitle: `${PRODUCTS.length} producto(s)` },
    recetas: { title: 'Recetas', subtitle: 'Vista estándar por producto' },
    reportes: { title: 'Reportes', subtitle: 'Del turno actual' },
  };

  const navTiles = [
    { id: 'usuarios', label: 'Usuarios y roles', Icon: Lock },
    { id: 'materias', label: 'Materias primas', Icon: Droplets },
    { id: 'proveedores', label: 'Proveedores', Icon: Package },
    { id: 'productos', label: 'Catálogo de productos', Icon: Coffee },
    { id: 'recetas', label: 'Recetas', Icon: ClipboardList },
    { id: 'reportes', label: 'Reportes', Icon: Receipt },
  ];

  return (
    <>
      <TopBar
        title={TITLES[screen].title}
        subtitle={TITLES[screen].subtitle}
        onBack={screen !== 'dashboard' ? () => setScreen('dashboard') : null}
        onSwitchRole={onSwitchRole}
        right={<UserChip user={currentUser} />}
      />
      <div className="content">
        {screen === 'dashboard' && (
          <>
            <div className="turno-status-card">
              <span>Estado del turno</span>
              <span className={turnoAbierto ? 'status-open-text' : 'status-closed-text'}>{turnoAbierto ? 'Abierto' : 'Cerrado'}</span>
            </div>

            <div className="kpi-grid">
              <div className="kpi-card"><span className="kpi-label">Ventas hoy</span><span className="kpi-value">{money(ventasHoy)}</span></div>
              <div className="kpi-card"><span className="kpi-label">Pedidos hoy</span><span className="kpi-value">{pedidosHoy}</span></div>
              <div className="kpi-card"><span className="kpi-label">Ticket promedio</span><span className="kpi-value">{money(ticketProm)}</span></div>
              <div className="kpi-card"><span className="kpi-label">Mermas hoy</span><span className="kpi-value">{kpis ? Number(kpis.mermas || 0) : 0}</span></div>
            </div>

            <div className="section-title"><Sparkles size={16} /> Fidelidad de clientes</div>
            <div className="promo-summary-card">
              {promoConfig.activo
                ? `Activa: cada ${promoConfig.cada} pedidos por la app, el cliente recibe ${premioActual.name} gratis.`
                : 'La promoción de fidelidad está inactiva.'}
            </div>
            <button className="btn-secondary full" onClick={() => setPromoOpen(true)}><Sparkles size={15} /> Configurar promoción</button>

            <div className="section-title" style={{ marginTop: 22 }}><Lock size={16} /> Acceso de clientes</div>
            <div className="turno-status-card">
              <span>Verificación por SMS</span>
              <button className={`turno-pill ${smsActivo ? 'open' : 'closed'}`} onClick={() => onToggleSms(!smsActivo)}>
                {smsActivo ? '● Activada' : 'Desactivada'}
              </button>
            </div>
            <div className="promo-summary-card">
              {smsActivo
                ? 'Los clientes verifican su teléfono con un código por SMS antes de pedir.'
                : 'Los clientes se registran solo con nombre y teléfono (sin código).'}
            </div>

            <div className="section-title" style={{ marginTop: 22 }}><Palette size={16} /> Identidad del negocio</div>
            <BrandingEditor nombreNegocio={nombreNegocio} logo={logo} onSave={onSaveBranding} />

            {materiasBajas.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 22 }}><TrendingDown size={16} /> Stock bajo</div>
                {materiasBajas.map(m => {
                  const proveedor = proveedores.find(p => p.id === m.proveedorId);
                  const pct = Math.min(100, Math.round((m.stockActual / m.stockMinimo) * 100));
                  return (
                    <div key={m.id} className="stock-alert-card">
                      <div className="stock-row"><strong>{m.nombre}</strong><span>{m.stockActual} / {m.stockMinimo} {m.unidad}</span></div>
                      <div className="stock-bar"><div className="stock-bar-fill" style={{ width: `${pct}%` }} /></div>
                      <div className="stock-meta">
                        <span>{m.categoria}</span>
                        <span>{proveedor ? proveedor.nombre : 'Sin proveedor'}</span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            <div className="section-title" style={{ marginTop: 22 }}>Administración</div>
            <div className="future-tiles">
              {navTiles.map(t => (
                <button key={t.id} className="nav-tile" onClick={() => setScreen(t.id)}>
                  <t.Icon size={22} className="nav-tile-icon" /><span>{t.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {screen === 'usuarios' && (
          <>
            {usuarios.map(u => (
              <div key={u.id} className="usuario-row">
                <div className="usuario-info">
                  <span className={`usuario-avatar role-${u.rol}`}>{u.nombre.charAt(0).toUpperCase()}</span>
                  <div>
                    <div className="usuario-name">{u.nombre}{currentUser && currentUser.id === u.id ? ' (tú)' : ''}</div>
                    <div className="usuario-role">{ROLE_LABELS[u.rol]}{!u.activo && ' • Inactivo'}</div>
                  </div>
                </div>
                <div className="usuario-actions">
                  <button className="icon-btn small" onClick={() => setEditingUser(u)} aria-label="Editar usuario"><Pencil size={14} /></button>
                  <button className="link-toggle" onClick={() => updateUsuario(u.id, { activo: !u.activo })}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
              </div>
            ))}
            <button className="btn-secondary full" onClick={() => setEditingUser({})}><UserPlus size={15} /> Agregar usuario</button>
          </>
        )}

        {screen === 'materias' && (
          <MateriasSection
            materias={materias} proveedores={proveedores} onEdit={setEditingMateria} onAdd={() => setEditingMateria({})}
            onToggleActivo={(id, activo) => updateMateria(id, { activo: !activo })}
          />
        )}

        {screen === 'proveedores' && (
          <ProveedoresSection
            proveedores={proveedores} materias={materias} onEdit={setEditingProveedor} onAdd={() => setEditingProveedor({})}
            onToggleActivo={(id, activo) => updateProveedor(id, { activo: !activo })}
          />
        )}

        {screen === 'productos' && (
          <ProductosSection
            productos={PRODUCTS} onEdit={setEditingProducto} onAdd={() => setEditingProducto({})}
            onToggleActivo={(id, activo) => updateProducto(id, { activo: !activo })}
          />
        )}

        {screen === 'recetas' && <RecetasSection onView={setRecipeProduct} recetaOverrides={recetaOverrides} />}

        {screen === 'reportes' && <ReportesSection data={reportes} />}
      </div>

      {promoOpen && <PromoConfigSheet config={promoConfig} onClose={() => setPromoOpen(false)} onSave={setPromoConfig} />}

      {editingUser && (
        <UsuarioFormSheet
          user={editingUser.id ? editingUser : null}
          onClose={() => setEditingUser(null)}
          onSave={u => (u.id ? updateUsuario(u.id, u) : addUsuario(u))}
        />
      )}

      {editingMateria && (
        <MateriaFormSheet
          item={editingMateria.id ? editingMateria : null}
          proveedores={proveedores}
          onClose={() => setEditingMateria(null)}
          onSave={m => (m.id ? updateMateria(m.id, m) : addMateria(m))}
        />
      )}

      {editingProveedor && (
        <ProveedorFormSheet
          proveedor={editingProveedor.id ? editingProveedor : null}
          onClose={() => setEditingProveedor(null)}
          onSave={p => (p.id ? updateProveedor(p.id, p) : addProveedor(p))}
        />
      )}

      {editingProducto && (
        <ProductoFormSheet
          producto={editingProducto.id ? editingProducto : null}
          onClose={() => setEditingProducto(null)}
          onSave={p => (p.id ? updateProducto(p.id, p) : addProducto(p))}
        />
      )}

      {recipeProduct && (
        <RecipeModal
          ticket={{ productId: recipeProduct.id, size: '12', milk: 'entera', coffeeType: 'tradicional', extras: [] }}
          override={recetaOverrides[recipeProduct.id]}
          readOnly
          onClose={() => setRecipeProduct(null)}
          onEdit={() => { setEditingRecetaProduct(recipeProduct); setRecipeProduct(null); }}
        />
      )}

      {editingRecetaProduct && (
        <RecetaFormSheet
          product={editingRecetaProduct}
          receta={recetaOverrides[editingRecetaProduct.id]}
          onClose={() => setEditingRecetaProduct(null)}
          onSave={(productId, override) => setRecetaOverride(productId, override)}
        />
      )}
    </>
  );
}

/* ============================================================
   CLIENTE — registro, estado de la tienda, pedido propio
   y tarjeta de fidelidad
   ============================================================ */

function LoyaltyCard({ count, cada, premioLabel, pending, onClaim }) {
  const progreso = pending ? cada : count % cada;
  const faltan = cada - progreso;
  const cups = Array.from({ length: cada }, (_, i) => i < progreso);
  return (
    <div className={`loyalty-card ${pending ? 'ready' : ''}`}>
      <div className="loyalty-head">
        <span>Tarjeta de fidelidad</span>
        <span className="loyalty-count">{progreso}/{cada}</span>
      </div>
      <div className="loyalty-cups">
        {cups.map((filled, i) => (
          <span key={i} className={`loyalty-cup ${filled ? 'filled' : ''} ${!filled && i === progreso ? 'next' : ''}`}>
            <Coffee size={14} />
          </span>
        ))}
      </div>
      {pending ? (
        <button className="loyalty-claim-btn" onClick={onClaim}><Sparkles size={14} /> Reclamar mi regalo: {premioLabel}</button>
      ) : (
        <div className="loyalty-footer">Faltan {faltan} pedido(s) por la app para: {premioLabel}</div>
      )}
    </div>
  );
}

function RegistroCliente({ form, setForm, error, onSubmit, sending }) {
  return (
    <div className="registro-card">
      <div className="registro-icon"><Coffee size={26} /></div>
      <h2>Crea tu cuenta exprés</h2>
      <p className="registro-sub">Solo necesitamos esto para tu pedido y tu tarjeta de fidelidad.</p>
      <div className="option-group">
        <div className="option-label">Nombre</div>
        <input className="text-input" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. María" />
      </div>
      <div className="option-group">
        <div className="option-label">Apellido</div>
        <input className="text-input" value={form.apellido} onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} placeholder="Ej. González" />
      </div>
      <div className="option-group">
        <div className="option-label">Teléfono (10 dígitos)</div>
        <input className="text-input" inputMode="numeric" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="Ej. 9611234567" />
      </div>
      {error && <div className="form-error"><AlertTriangle size={13} /> {error}</div>}
      <button className="btn-primary full" disabled={sending} onClick={onSubmit}>{sending ? 'Enviando…' : 'Continuar'}</button>
    </div>
  );
}

function PickupModeSelect({ onAhora, onDespues, title }) {
  return (
    <div className="pickup-select">
      <h2 className="pickup-title">{title || '¿Cómo quieres tu pedido?'}</h2>
      <button className="pickup-option" onClick={onAhora}>
        <span className="pickup-option-icon"><Coffee size={22} /></span>
        <span className="pickup-option-text"><strong>Pasarlo a recoger ahora</strong><span>Ya estoy en la cafetería</span></span>
      </button>
      <button className="pickup-option" onClick={onDespues}>
        <span className="pickup-option-icon"><Clock size={22} /></span>
        <span className="pickup-option-text"><strong>Pasar a recoger después</strong><span>Elige a qué hora llegas</span></span>
      </button>
    </div>
  );
}

function PickupTimePicker({ onConfirm, onBack, title }) {
  const [customTime, setCustomTime] = useState('');
  const quick = [15, 30, 45, 60];
  const confirmCustom = () => {
    const [h, m] = customTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    onConfirm(d.getTime());
  };
  return (
    <div className="pickup-select">
      <h2 className="pickup-title">{title || '¿A qué hora pasas?'}</h2>
      <div className="option-row" style={{ marginBottom: 14 }}>
        {quick.map(min => (
          <button key={min} className="option-chip" onClick={() => onConfirm(Date.now() + min * 60000)}>en {min} min</button>
        ))}
      </div>
      <div className="option-label">Elegir hora exacta</div>
      <input className="text-input" type="time" value={customTime} onChange={e => setCustomTime(e.target.value)} />
      <button className="btn-primary full" disabled={!customTime} onClick={confirmCustom}>Confirmar hora</button>
      <button className="btn-ghost" onClick={onBack}>Volver</button>
    </div>
  );
}

function ClienteConfirmado({ order, modo, horaRecogida, reward, onVerEstado }) {
  return (
    <div className="confirm-screen">
      <div className="confirm-check"><Check size={40} /></div>
      <div className="confirm-order-id">{order.folio || order.id}</div>
      <p>{modo === 'programado' ? `Tu pedido estará listo cerca de las ${fmtHora(horaRecogida)}` : 'Tu pedido ya entró a preparación'}</p>
      {order.total > 0 && <div className="confirm-total">{money(order.total)}</div>}
      {reward && <div className="reward-banner"><Sparkles size={16} /> ¡Incluye tu regalo de fidelidad: {reward.name}!</div>}
      <button className="btn-primary" onClick={onVerEstado}><Clock size={16} /> Ver estado de mi pedido</button>
    </div>
  );
}

function ClienteSeguimiento({ order, onNuevoPedido }) {
  const items = order.items || [];
  const steps = ['pendiente', 'en_preparacion', 'terminado'];
  const allDone = items.length > 0 && items.every(t => t.estado === 'terminado' || t.estado === 'cancelado');
  const entregado = allDone && order.cobrado;
  return (
    <div className="seguimiento">
      <div className="seguimiento-head">
        <div className="confirm-order-id">{order.folio || order.id}</div>
        <div className="footer-label">
          {order.no_show ? 'No recogido' : entregado ? '¡Entregado!' : allDone ? '¡Listo para recoger!' : 'Preparando tu pedido...'}
        </div>
      </div>
      {order.no_show ? (
        <div className="noshow-banner">
          <AlertCircle size={20} /> Lamentamos que no pudiste pasar por este pedido. Por políticas de merma, se restó 1 punto de tu tarjeta de fidelidad.
        </div>
      ) : entregado ? (
        <div className="ready-banner"><Check size={20} /> Pedido entregado. ¡Gracias por tu visita!</div>
      ) : allDone && (
        <div className="ready-banner"><Check size={20} /> ¡Tu pedido está listo! Pasa al mostrador.</div>
      )}
      <div className="seguimiento-list">
        {items.map(t => {
          const icon = (PRODUCTS.find(p => p.name === t.producto) || {}).icon || '☕';
          const stepIndex = t.estado === 'cancelado' ? -1 : steps.indexOf(t.estado);
          return (
            <div key={t.id} className="seguimiento-item">
              <span className="ticket-product-icon">{icon}</span>
              <div style={{ flex: 1 }}>
                <div className="ticket-product-name">{t.producto}{t.es_regalo ? ' 🎁' : ''}</div>
                <div className="progress-track">
                  {steps.map((s, i) => <span key={s} className={`progress-dot ${i <= stepIndex ? 'done' : ''}`} />)}
                </div>
              </div>
              <StatusChip status={t.estado} />
            </div>
          );
        })}
      </div>
      <button className="btn-secondary full" onClick={onNuevoPedido}>Hacer otro pedido</button>
    </div>
  );
}

function CuentaCliente({ client, misPedidos, promoConfig, onBack, onClaimReward, onLogout }) {
  const premio = getProduct(promoConfig.premioId);
  const pedidos = misPedidos || [];
  const regalosObtenidos = pedidos.filter(p => (p.items || []).some(i => i.es_regalo) && p.cobrado).length;

  return (
    <div className="cuenta-view">
      <div className="cuenta-head">
        <span className="cuenta-avatar"><User size={20} /></span>
        <div>
          <div className="cuenta-name">{client.nombre} {client.apellido}</div>
          <div className="cuenta-phone">{client.telefono}</div>
        </div>
      </div>

      <div className="section-title"><Sparkles size={16} /> Tus recompensas</div>
      <LoyaltyCard
        count={client.pedidosApp}
        cada={promoConfig.cada}
        premioLabel={premio ? premio.name : '—'}
        pending={client.recompensaPendiente}
        onClaim={onClaimReward}
      />
      <div className="rewards-summary-card">
        <span>Regalos obtenidos hasta hoy</span>
        <span className="kpi-value-sm">{regalosObtenidos}</span>
      </div>

      <div className="section-title"><History size={16} /> Tu historial de pedidos</div>
      {pedidos.length === 0 ? (
        <EmptyState icon={History} title="Aún no tienes pedidos" subtitle="Cuando ordenes desde la app, los verás aquí" />
      ) : (
        pedidos.map(p => (
          <div key={p.id} className="historial-row">
            <div>
              <div className="turno-id">{p.folio || ''}</div>
              <div className="turno-sub">
                {new Date(p.creado_en).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })} {fmtHora(p.creado_en)} • {(p.items || []).length} producto(s)
                {(p.items || []).some(i => i.es_regalo) ? ' • 🎁 incluyó regalo' : ''}
              </div>
            </div>
            <div className="turno-right">
              <div className="turno-amount">{money(p.total)}</div>
              <StatusChip status={estadoPedidoCliente(p)} />
            </div>
          </div>
        ))
      )}

      <button className="btn-secondary full" onClick={onBack}>Volver</button>
      <button className="btn-ghost" style={{ width: '100%', marginTop: 6 }} onClick={onLogout}>Cerrar sesión</button>
    </div>
  );
}

function ClienteApp({ turnoAbierto, promoConfig, smsActivo, addToast, onSwitchRole, recetaOverrides }) {
  const [cliente, setCliente] = useState(null);
  const [form, setForm] = useState({ nombre: '', apellido: '', telefono: '' });
  const [codigo, setCodigo] = useState('');
  const [formError, setFormError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [screen, setScreen] = useState('registro');
  const [modo, setModo] = useState(null);
  const [horaRecogida, setHoraRecogida] = useState(null);
  const [claimingReward, setClaimingReward] = useState(false);
  const [activeCat, setActiveCat] = useState('Calientes');
  const [customizing, setCustomizing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cart, setCart] = useState([]);
  const [lastOrder, setLastOrder] = useState(null);
  const [misPedidos, setMisPedidos] = useState([]);
  const [rewardInfo, setRewardInfo] = useState(null);

  const client = cliente; // se conserva el nombre "client" para no tocar el resto del render
  const mustShowClosed = cliente && !turnoAbierto && !['seguimiento', 'confirmado', 'cuenta'].includes(screen);

  // Refresca fidelidad e historial del cliente (para seguimiento en vivo y cuenta).
  const refrescarCuenta = React.useCallback(async () => {
    try {
      const [c, ped] = await Promise.all([api.getMiCuenta(), api.getMisPedidos()]);
      setCliente(adaptCliente(c));
      setMisPedidos(ped);
    } catch { /* ignore */ }
  }, []);

  // Restaura la sesión del cliente desde el token guardado: así NO pierde su
  // historial al navegar, recargar la página o volver de otro rol.
  useEffect(() => {
    if (!api.getTokenCliente()) return;
    api.getMiCuenta()
      .then(c => { setCliente(adaptCliente(c)); setScreen(s => (s === 'registro' ? 'modo' : s)); })
      .catch(() => { api.setTokenCliente(null); });
  }, []);

  // Refresca fidelidad e historial mientras ve su seguimiento o su cuenta.
  useEffect(() => {
    if (!['seguimiento', 'cuenta'].includes(screen) || !api.getTokenCliente()) return undefined;
    refrescarCuenta();
    const t = setInterval(refrescarCuenta, 4000);
    return () => clearInterval(t);
  }, [screen, refrescarCuenta]);

  // Paso 1 del alta: pedir el código por SMS.
  const solicitarCodigo = async () => {
    const tel = form.telefono.replace(/\D/g, '');
    if (!form.nombre.trim() || !form.apellido.trim()) { setFormError('Completa tu nombre y apellido.'); return; }
    if (!validPhone(tel)) { setFormError('Ingresa un teléfono válido de 10 dígitos.'); return; }
    setFormError(''); setEnviando(true);
    try {
      if (smsActivo) {
        await api.clienteSolicitarCodigo(tel);
        setCodigo('');
        setScreen('codigo');
        addToast('Te enviamos un código por SMS.', 'success');
      } else {
        // SMS desactivado: alta directa, sin código.
        const c = await api.clienteRegistroDirecto({ telefono: tel, nombre: form.nombre.trim(), apellido: form.apellido.trim() });
        setCliente(adaptCliente(c));
        setScreen('modo');
      }
    } catch (e) { setFormError(e.message); }
    finally { setEnviando(false); }
  };

  // Paso 2: verificar el código -> queda registrado y con sesión de cliente.
  const verificarCodigo = async () => {
    const tel = form.telefono.replace(/\D/g, '');
    if (!/^\d{6}$/.test(codigo)) { setFormError('El código es de 6 dígitos.'); return; }
    setFormError(''); setEnviando(true);
    try {
      const c = await api.clienteVerificarCodigo({ telefono: tel, codigo, nombre: form.nombre.trim(), apellido: form.apellido.trim() });
      setCliente(adaptCliente(c));
      setScreen('modo');
    } catch (e) { setFormError(e.message); }
    finally { setEnviando(false); }
  };

  const quickAddClient = product => {
    setCart(c => [...c, { uid: `${product.id}-${Date.now()}`, productId: product.id, qty: 1, unitPrice: product.price, extras: [] }]);
    addToast(`Agregado: ${product.name}`, 'success');
  };

  const handleConfirmarPedido = async () => {
    try {
      const r = await api.crearPedido({ cart, horaRecogida, comoCliente: true });
      setLastOrder(adaptPedido(r.pedido));
      setRewardInfo(null);
      setCart([]);
      setScreen('confirmado');
    } catch (e) { addToast('No se pudo enviar el pedido: ' + e.message, 'warn'); }
  };

  // Reclamo de recompensa: pedido propio (total 0) que entra a la cola del barista.
  const startClaimReward = () => { setClaimingReward(true); setScreen('modo'); };

  const handleClaimReward = async hr => {
    const premio = getProduct(promoConfig.premioId);
    if (!premio) { addToast('No hay premio configurado.', 'warn'); return; }
    const rewardCart = [{
      uid: `reward-${Date.now()}`, productId: premio.id, qty: 1, unitPrice: 0,
      size: premio.sizes ? '12' : null,
      milk: premio.leche ? 'entera' : null,
      coffeeType: premio.coffeeType ? 'tradicional' : null,
      extras: [], notas: 'Regalo de fidelidad', isReward: true,
    }];
    try {
      const r = await api.crearPedido({ cart: rewardCart, horaRecogida: hr, comoCliente: true });
      setClaimingReward(false);
      setModo(hr ? 'programado' : 'ahora');
      setHoraRecogida(hr);
      setLastOrder(adaptPedido(r.pedido));
      setRewardInfo(premio);
      setScreen('confirmado');
      refrescarCuenta();
    } catch (e) { addToast('No se pudo reclamar el regalo: ' + e.message, 'warn'); }
  };

  const cerrarSesionCliente = () => {
    api.setTokenCliente(null);
    setCliente(null);
    setMisPedidos([]);
    setLastOrder(null);
    setForm({ nombre: '', apellido: '', telefono: '' });
    setScreen('registro');
  };

  const seguimientoOrder = lastOrder ? (misPedidos.find(p => p.id === lastOrder.id) || null) : null;

  return (
    <>
      <TopBar
        title={screen === 'cuenta' ? 'Mi cuenta' : 'Mi pedido'}
        subtitle={client ? `${client.nombre} ${client.apellido}` : undefined}
        onBack={
          screen === 'cart' ? () => setScreen('menu')
          : (screen === 'modo' && claimingReward) ? () => { setClaimingReward(false); setScreen('menu'); }
          : null
        }
        onSwitchRole={onSwitchRole}
        right={client && screen !== 'cuenta' && (
          <button className="icon-btn" onClick={() => setScreen('cuenta')} aria-label="Mi cuenta"><History size={19} /></button>
        )}
      />
      <div className="content">
        {screen === 'registro' && (
          <RegistroCliente form={form} setForm={setForm} error={formError} sending={enviando} onSubmit={solicitarCodigo} />
        )}

        {screen === 'codigo' && (
          <div className="registro-card">
            <div className="registro-icon"><Lock size={26} /></div>
            <h2>Verifica tu teléfono</h2>
            <p className="registro-sub">Te enviamos un código de 6 dígitos por SMS al {form.telefono}.</p>
            <div className="option-group">
              <div className="option-label">Código de verificación</div>
              <input className="text-input" inputMode="numeric" maxLength={6} value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 dígitos" />
            </div>
            {formError && <div className="form-error"><AlertTriangle size={13} /> {formError}</div>}
            <button className="btn-primary full" disabled={enviando} onClick={verificarCodigo}>Verificar y entrar</button>
            <button className="btn-ghost" onClick={() => { setScreen('registro'); setCodigo(''); setFormError(''); }}>Volver</button>
          </div>
        )}

        {screen !== 'registro' && mustShowClosed && (
          <EmptyState icon={Clock} title="Estamos cerrados por ahora" subtitle="Esta pantalla se actualizará sola cuando abramos el turno. ¡Te esperamos!" />
        )}

        {screen !== 'registro' && !mustShowClosed && (
          <>
            {screen === 'modo' && (
              <PickupModeSelect
                title={claimingReward ? '¿Cómo quieres tu regalo?' : undefined}
                onAhora={() => {
                  if (claimingReward) { handleClaimReward(null); }
                  else { setModo('ahora'); setHoraRecogida(null); setScreen('menu'); }
                }}
                onDespues={() => setScreen('hora')}
              />
            )}
            {screen === 'hora' && (
              <PickupTimePicker
                title={claimingReward ? '¿A qué hora pasas por tu regalo?' : undefined}
                onBack={() => setScreen('modo')}
                onConfirm={ts => {
                  if (claimingReward) { handleClaimReward(ts); }
                  else { setModo('programado'); setHoraRecogida(ts); setScreen('menu'); }
                }}
              />
            )}
            {screen === 'menu' && (
              <>
                {client && client.recompensaPendiente && (
                  <button className="reward-ready-banner" onClick={startClaimReward}>
                    <Sparkles size={18} /> ¡Tienes un regalo listo para reclamar!
                  </button>
                )}
                <CategoryTabs active={activeCat} onSelect={setActiveCat} />
                <ProductGrid activeCat={activeCat} onTap={p => (p.tipo === 'snack' ? quickAddClient(p) : setCustomizing(p))} />
              </>
            )}
            {screen === 'cart' && (
              <CartView
                cart={cart} setCart={setCart} discount={null} setDiscount={() => {}}
                allowDiscount={false}
                ctaLabel="Confirmar pedido"
                footerExtra={client && (
                  <LoyaltyCard
                    count={client.pedidosApp} cada={promoConfig.cada} premioLabel={getProduct(promoConfig.premioId).name}
                    pending={client.recompensaPendiente} onClaim={startClaimReward}
                  />
                )}
                onCheckout={handleConfirmarPedido}
              />
            )}
            {screen === 'confirmado' && lastOrder && (
              <ClienteConfirmado order={lastOrder} modo={modo} horaRecogida={horaRecogida} reward={rewardInfo} onVerEstado={() => setScreen('seguimiento')} />
            )}
            {screen === 'cuenta' && client && (
              <CuentaCliente client={client} misPedidos={misPedidos} promoConfig={promoConfig} onBack={() => setScreen('menu')} onClaimReward={startClaimReward} onLogout={cerrarSesionCliente} />
            )}
            {screen === 'seguimiento' && lastOrder && (
              <ClienteSeguimiento
                order={seguimientoOrder || lastOrder}
                onNuevoPedido={() => { setScreen('menu'); setLastOrder(null); setMisPedidos([]); }}
              />
            )}
          </>
        )}
      </div>

      {!mustShowClosed && (screen === 'menu' || screen === 'cart') && (
        <div className="tabbar">
          <button className={`tab-btn ${screen === 'menu' ? 'active' : ''}`} onClick={() => setScreen('menu')}>
            <Coffee size={20} /><span>Menú</span>
          </button>
          <button className={`tab-btn ${screen === 'cart' ? 'active' : ''}`} onClick={() => setScreen('cart')}>
            <span className="tab-icon-badge">
              <ShoppingCart size={20} />
              {cart.length > 0 && <span className="badge-count">{cart.reduce((s, i) => s + i.qty, 0)}</span>}
            </span>
            <span>Carrito</span>
          </button>
          {lastOrder && (
            <button className="tab-btn" onClick={() => setScreen('seguimiento')}>
              <Clock size={20} /><span>Mi pedido</span>
            </button>
          )}
        </div>
      )}

      {customizing && (
        <CustomizeSheet
          product={customizing}
          onClose={() => setCustomizing(null)}
          onAdd={item => { setCart(c => [...c, item]); addToast(`Agregado: ${getProduct(item.productId).name}`, 'success'); }}
          onPreviewRecipe={sel => setPreview({ productId: customizing.id, ...sel })}
        />
      )}
      {preview && <RecipeModal ticket={preview} override={recetaOverrides[preview.productId]} readOnly onClose={() => setPreview(null)} />}
    </>
  );
}

/* ============================================================
   APP ROOT
   ============================================================ */

const STYLES = `
.posproto { min-height:100vh; padding:24px 12px; background:#120D0A; display:flex; align-items:flex-start; justify-content:center;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#F3ECE3; }
.posproto, .posproto * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
.posproto button { font-family:inherit; cursor:pointer; border:none; }

.phone-frame { width:min(420px,94vw); height:min(860px,92vh); margin:0 auto; border-radius:32px; overflow:hidden;
  display:flex; flex-direction:column; position:relative; background:#1C120D;
  box-shadow:0 30px 60px -20px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.06); }

.status-bar { display:flex; justify-content:space-between; padding:10px 20px 4px; font-size:12px; color:#B8A795; font-weight:600; letter-spacing:.02em; }

.topbar { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; background:#2B1D15; border-bottom:1px solid rgba(255,255,255,.06); }
.topbar-left { display:flex; align-items:center; gap:10px; }
.topbar-title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:18px; }
.topbar-subtitle { font-size:12px; color:#B8A795; margin-top:1px; }
.topbar-right { display:flex; align-items:center; gap:8px; }

.icon-btn { width:40px; height:40px; min-height:40px; border-radius:50%; background:#3A2718; color:#F3ECE3; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.icon-btn:active { transform:scale(.92); }
.icon-btn.small { width:34px; height:34px; }

.content { flex:1; overflow-y:auto; padding:16px; -webkit-overflow-scrolling:touch; }

.tabbar { display:flex; background:#2B1D15; border-top:1px solid rgba(255,255,255,.06); padding:8px 6px max(8px,env(safe-area-inset-bottom)); }
.tab-btn { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 4px; min-height:52px; background:transparent; color:#9C8B79; font-size:11px; font-weight:600; border-radius:14px; }
.tab-btn.active { color:#E3A23D; background:rgba(227,162,61,.1); }
.tab-icon-badge { position:relative; }
.badge-count { position:absolute; top:-6px; right:-9px; background:#D1572E; color:#fff; font-size:10px; font-weight:700; border-radius:9px; min-width:17px; height:17px; display:flex; align-items:center; justify-content:center; padding:0 4px; }

/* Role select */
.role-select { display:flex; flex-direction:column; justify-content:center; height:100%; }
.role-select-head { text-align:center; margin-bottom:28px; }
.brand-mark { width:56px; height:56px; border-radius:18px; background:#E3A23D; color:#1C120D; display:flex; align-items:center; justify-content:center; margin:0 auto 14px; }
.brand-mark.has-logo { background:#fff; overflow:hidden; }
.brand-logo { width:100%; height:100%; object-fit:contain; }
.branding-editor { background:#2B1D15; border:1px solid rgba(255,255,255,.06); border-radius:16px; padding:14px; }
.branding-field-label { display:block; font-size:12px; color:#B8A795; margin-bottom:6px; }
.branding-input { width:100%; box-sizing:border-box; background:#1C120D; border:1px solid rgba(255,255,255,.1); border-radius:10px; padding:11px 12px; color:#F4ECE2; font-size:14px; font-family:inherit; }
.branding-input:focus { outline:none; border-color:#E3A23D; }
.branding-logo-row { display:flex; align-items:center; gap:14px; margin-top:14px; }
.branding-logo-preview { width:64px; height:64px; flex-shrink:0; border-radius:14px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; color:#1C120D; }
.branding-logo-preview img { width:100%; height:100%; object-fit:contain; }
.branding-logo-actions { display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
.branding-hint { font-size:11px; color:#8A7A6B; margin-top:10px; line-height:1.4; }
.branding-editor .btn-primary:disabled { opacity:.5; cursor:default; }
.role-select-head h1 { font-family:'Space Grotesk',sans-serif; font-size:24px; margin:0 0 6px; }
.role-select-head p { color:#B8A795; font-size:14px; margin:0; }
.role-grid { display:flex; flex-direction:column; gap:12px; }
.role-card { background:#2B1D15; border:1px solid rgba(255,255,255,.06); border-radius:20px; padding:18px; display:flex; align-items:center; gap:14px; text-align:left; min-height:64px; }
.role-card:active { transform:scale(.98); background:#34241A; }
.role-card-icon { width:48px; height:48px; border-radius:14px; background:rgba(227,162,61,.15); color:#E3A23D; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.role-card-title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:16px; display:block; }
.role-card-desc { font-size:12px; color:#B8A795; display:block; margin-top:2px; }

/* Category tabs / product grid */
.cat-tabs { display:flex; gap:8px; overflow-x:auto; padding-bottom:12px; margin-bottom:4px; }
.cat-tab { flex-shrink:0; display:flex; align-items:center; gap:6px; padding:10px 16px; min-height:44px; border-radius:999px; background:#2B1D15; color:#B8A795; font-size:13px; font-weight:600; white-space:nowrap; }
.cat-tab.active { background:#E3A23D; color:#1C120D; }
.product-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.product-card { background:#2B1D15; border:1px solid rgba(255,255,255,.06); border-radius:18px; padding:14px; display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-height:128px; position:relative; }
.product-card:active { transform:scale(.97); background:#34241A; }
.product-icon { font-size:30px; margin-bottom:6px; }
.product-name { font-weight:700; font-size:14px; line-height:1.25; }
.product-price { font-family:'IBM Plex Mono',monospace; color:#E3A23D; font-size:13px; font-weight:600; margin-top:auto; }
.frio-tag { position:absolute; top:10px; right:10px; color:#5C8A87; }

/* Sheets / overlays */
.overlay { position:absolute; inset:0; background:rgba(10,6,4,.72); display:flex; align-items:flex-end; z-index:50; }
.overlay-center { align-items:center; justify-content:center; padding:24px; z-index:70; }
.sheet { width:100%; max-height:85%; background:#2E2019; border-radius:24px 24px 0 0; padding:10px 18px calc(16px + env(safe-area-inset-bottom)); overflow-y:auto; animation:slideUp .2s ease-out; }
@keyframes slideUp { from { transform:translateY(24px); opacity:0; } to { transform:translateY(0); opacity:1; } }
.sheet-handle { width:36px; height:4px; background:rgba(255,255,255,.2); border-radius:4px; margin:6px auto 12px; }
.sheet-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.sheet-header h3 { font-family:'Space Grotesk',sans-serif; font-size:18px; margin:0; }
.sheet-body { display:flex; flex-direction:column; }
.sheet-footer { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:14px; border-top:1px solid rgba(255,255,255,.08); margin-top:8px; }
.sheet-footer.static { position:sticky; bottom:0; background:#1C120D; margin:12px -16px -16px; padding:14px 16px max(14px,env(safe-area-inset-bottom)); border-top:1px solid rgba(255,255,255,.08); }

.option-group { margin-bottom:16px; }
.option-label { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#B8A795; margin-bottom:8px; }
.option-row { display:flex; gap:8px; flex-wrap:wrap; }
.option-chip { padding:10px 14px; min-height:44px; border-radius:999px; border:1px solid rgba(255,255,255,.12); background:#241810; color:#F3ECE3; font-size:13px; font-weight:600; }
.option-chip.selected { background:#E3A23D; color:#1C120D; border-color:#E3A23D; }
.notes-input, .text-input { width:100%; background:#1C120D; border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:12px; color:#F3ECE3; font-size:14px; resize:none; margin-bottom:6px; }

.stepper { display:flex; align-items:center; gap:10px; }
.stepper-btn { width:34px; height:34px; min-height:34px; border-radius:10px; background:#241810; color:#F3ECE3; display:flex; align-items:center; justify-content:center; }
.stepper-value { font-family:'IBM Plex Mono',monospace; font-weight:700; min-width:20px; text-align:center; }

.btn-primary { background:#E3A23D; color:#1C120D; font-weight:700; padding:13px 22px; min-height:48px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; gap:6px; font-size:14px; }
.btn-primary.full { width:100%; margin-top:6px; }
.btn-primary:disabled { opacity:.4; }
.btn-primary:active:not(:disabled) { transform:scale(.97); }
.btn-secondary { background:transparent; border:1.5px solid #E3A23D; color:#E3A23D; font-weight:700; padding:10px 16px; min-height:42px; border-radius:999px; display:inline-flex; align-items:center; gap:6px; font-size:13px; }
.btn-danger { background:#D1572E; color:#fff; font-weight:700; padding:13px 20px; min-height:48px; border-radius:999px; }
.btn-ghost { background:transparent; color:#B8A795; font-weight:600; padding:13px 16px; min-height:48px; }

.footer-label { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#B8A795; display:block; }
.price-total { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:20px; color:#E3A23D; }
.price-total.big { font-size:30px; }

/* Cart / checkout / turno */
.cart-list { display:flex; flex-direction:column; gap:10px; margin-bottom:14px; }
.cart-item { display:flex; gap:10px; background:#2B1D15; border-radius:16px; padding:12px; align-items:flex-start; }
.cart-item-icon { font-size:24px; }
.cart-item-info { flex:1; min-width:0; }
.cart-item-name { font-weight:700; font-size:14px; }
.cart-item-sub { font-size:12px; color:#B8A795; margin-top:2px; }
.cart-item-notes { font-size:12px; color:#E3A23D; font-style:italic; margin-top:4px; }
.cart-item-controls { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
.cart-item-price { font-family:'IBM Plex Mono',monospace; font-size:13px; font-weight:700; }

.cart-summary { background:#2B1D15; border-radius:18px; padding:16px; }
.discount-link { background:none; color:#5C8A87; font-size:13px; font-weight:600; padding:0; margin-bottom:10px; text-align:left; min-height:32px; }
.summary-row { display:flex; justify-content:space-between; font-size:14px; color:#B8A795; padding:4px 0; }
.summary-row.total { color:#F3ECE3; font-weight:700; font-size:16px; border-top:1px solid rgba(255,255,255,.08); margin-top:6px; padding-top:10px; }
.summary-row.discount-row { color:#D1572E; }

.checkout-total-card { background:#2B1D15; border-radius:18px; padding:18px; text-align:center; margin-bottom:18px; }
.pay-methods { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:6px; }
.pay-method-btn { background:#241810; border:1px solid rgba(255,255,255,.1); border-radius:14px; padding:14px; min-height:64px; display:flex; flex-direction:column; align-items:center; gap:6px; color:#F3ECE3; font-size:12px; font-weight:600; }
.pay-method-btn.selected { background:rgba(227,162,61,.15); border-color:#E3A23D; color:#E3A23D; }
.change-display { background:#1C120D; border-radius:14px; padding:14px; text-align:center; margin-top:10px; }
.change-display.warn .change-amount { color:#D1572E; }
.change-amount { font-family:'IBM Plex Mono',monospace; font-size:26px; font-weight:700; color:#7FA87A; display:block; margin-top:4px; }

.confirm-screen { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; gap:10px; }
.confirm-check { width:80px; height:80px; border-radius:50%; background:#7FA87A; color:#1C120D; display:flex; align-items:center; justify-content:center; margin-bottom:8px; }
.confirm-order-id { font-family:'IBM Plex Mono',monospace; font-size:24px; font-weight:700; color:#E3A23D; }
.confirm-total { font-family:'IBM Plex Mono',monospace; font-size:22px; font-weight:700; margin-bottom:6px; }

.turno-total { display:flex; justify-content:space-between; align-items:center; background:#2B1D15; border-radius:16px; padding:14px 16px; margin-bottom:14px; font-weight:700; }
.turno-row { display:flex; justify-content:space-between; align-items:flex-start; padding:12px 0; border-bottom:1px solid rgba(255,255,255,.06); gap:10px; }
.turno-id { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:14px; }
.turno-sub { font-size:12px; color:#B8A795; margin-top:2px; }
.turno-right { display:flex; flex-direction:column; align-items:flex-end; gap:5px; }
.turno-amount { font-family:'IBM Plex Mono',monospace; font-weight:700; }
.link-danger { background:none; color:#D1572E; font-size:12px; font-weight:700; padding:0; min-height:24px; }
.turno-actions { display:flex; flex-direction:column; align-items:flex-end; gap:6px; margin-top:2px; }
.btn-primary.small { padding:8px 14px; min-height:36px; font-size:12.5px; }
.vencido-warning { display:flex; align-items:center; gap:5px; font-size:11px; color:#D1572E; font-weight:700; margin-top:4px; }

/* Status chips */
.status-chip { display:inline-flex; align-items:center; gap:4px; padding:4px 9px; border-radius:999px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; }
.status-pendiente { background:rgba(227,162,61,.18); color:#E3A23D; }
.status-en_preparacion { background:rgba(92,138,135,.2); color:#5C8A87; }
.status-terminado { background:rgba(127,168,122,.2); color:#7FA87A; }
.status-cancelado { background:rgba(209,87,46,.2); color:#D1572E; }
.status-listo { background:rgba(227,162,61,.2); color:#E3A23D; }

/* Barista tickets */
.ticket-card { background:#2B1D15; border-radius:18px; padding:14px; margin-bottom:12px; border-left:4px solid #E3A23D; }
.status-border-pendiente { border-left-color:#E3A23D; }
.status-border-en_preparacion { border-left-color:#5C8A87; }
.ticket-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.ticket-id { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:14px; }
.ticket-time { font-size:11px; color:#B8A795; }
.ticket-product { display:flex; gap:10px; align-items:center; margin-bottom:6px; }
.ticket-product-icon { font-size:26px; }
.ticket-product-name { font-weight:700; font-size:14px; }
.ticket-product-sub { font-size:12px; color:#B8A795; margin-top:1px; }
.order-notes { font-size:12px; font-style:italic; color:#E3A23D; background:rgba(227,162,61,.08); padding:8px 10px; border-radius:10px; margin:6px 0; }
.ticket-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }

/* Gauge */
.gauge-wrap { display:flex; flex-direction:column; align-items:center; }
.gauge-face { fill:#1C120D; }
.gauge-inner { fill:none; stroke:rgba(255,255,255,.08); stroke-width:1; }
.tick-major { stroke:#B8A795; stroke-width:2; }
.tick-minor { stroke:rgba(184,167,149,.4); stroke-width:1; }
.needle { stroke-width:2.4; stroke-linecap:round; }
.needle-tail { stroke-width:2.4; stroke-linecap:round; opacity:.5; }
.gauge-readout { font-family:'IBM Plex Mono',monospace; font-size:11px; font-weight:700; margin-top:2px; }

/* Recipe modal */
.recipe-modal { position:absolute; inset:0; background:#1C120D; z-index:60; overflow-y:auto; }
.recipe-header { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:#1C120D; position:sticky; top:0; border-bottom:1px solid rgba(255,255,255,.06); z-index:2; }
.recipe-header-title { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:14px; }
.recipe-hero { display:flex; flex-direction:column; align-items:center; gap:4px; padding:22px 16px; text-align:center; }
.recipe-hero-icon { font-size:52px; }
.recipe-hero h2 { font-family:'Space Grotesk',sans-serif; margin:4px 0 0; font-size:22px; }
.recipe-hero-sub { font-size:13px; color:#B8A795; }
.recipe-section { padding:0 16px 18px; }
.recipe-section-title { display:flex; align-items:center; gap:7px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:#E3A23D; margin-bottom:10px; }
.ingredient-list { display:flex; flex-direction:column; gap:8px; }
.ingredient-row { display:flex; justify-content:space-between; background:#2B1D15; border-radius:12px; padding:11px 14px; font-size:13px; }
.ingredient-qty { font-family:'IBM Plex Mono',monospace; font-weight:700; color:#E3A23D; }
.steps-list { display:flex; flex-direction:column; gap:11px; }
.step-row { display:flex; gap:12px; align-items:flex-start; font-size:13px; line-height:1.4; }
.step-num { flex-shrink:0; width:24px; height:24px; border-radius:50%; background:#E3A23D; color:#1C120D; display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:12px; }
.molino-panel { display:grid; grid-template-columns:1fr 1fr; gap:10px; background:#2B1D15; border:1px solid rgba(227,162,61,.25); border-radius:16px; padding:14px; }
.molino-item { display:flex; flex-direction:column; gap:2px; }
.molino-label { font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:#B8A795; }
.molino-value { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:14px; }

/* Ficha técnica estilo infografía: filas con ícono, inspirada en la guía de baristas */
.spec-table { background:#2B1D15; border:1px solid rgba(227,162,61,.25); border-radius:16px; overflow:hidden; }
.spec-row { display:flex; align-items:center; gap:12px; padding:11px 14px; border-bottom:1px solid rgba(255,255,255,.06); }
.spec-row:last-child { border-bottom:none; }
.spec-icon { width:32px; height:32px; border-radius:10px; background:rgba(227,162,61,.15); color:#E3A23D; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.spec-label { flex:1; font-size:12.5px; color:#B8A795; font-weight:600; }
.spec-value { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:13.5px; color:#F3ECE3; text-align:right; white-space:nowrap; }

/* Guía de textura de la leche */
.texture-guide { display:flex; flex-direction:column; gap:8px; }
.texture-row { display:flex; align-items:flex-start; gap:10px; background:#2B1D15; border-radius:12px; padding:10px 12px; }
.texture-icon { flex-shrink:0; margin-top:1px; }
.texture-row.good .texture-icon { color:#7FA87A; }
.texture-row.bad .texture-icon { color:#D1572E; }
.texture-text { display:flex; flex-direction:column; }
.texture-text strong { font-size:12.5px; }
.texture-text span { font-size:11px; color:#B8A795; }

.finish-btn-wrap { position:sticky; bottom:0; padding:14px 16px max(14px,env(safe-area-inset-bottom)); background:linear-gradient(180deg,rgba(28,18,13,0),#1C120D 30%); }
.finish-btn { width:100%; background:#7FA87A; color:#10210F; font-weight:700; padding:15px; border-radius:999px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; }
.already-done { display:flex; align-items:center; justify-content:center; gap:8px; color:#7FA87A; font-weight:700; padding:14px; }
.recipe-footer-actions { display:flex; gap:10px; }
.recipe-footer-actions .btn-secondary { flex:1; justify-content:center; }

/* Insignia de receta personalizada (Admin) */
.custom-badge { position:absolute; top:10px; right:10px; color:#E3A23D; background:rgba(227,162,61,.18); border-radius:8px; width:22px; height:22px; display:flex; align-items:center; justify-content:center; }

/* Admin */
.kpi-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px; }
.kpi-card { background:#2B1D15; border-radius:16px; padding:14px; }
.kpi-label { font-size:11px; text-transform:uppercase; color:#B8A795; letter-spacing:.03em; display:block; margin-bottom:6px; }
.kpi-value { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:21px; color:#E3A23D; }
.section-title { display:flex; align-items:center; gap:7px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:#B8A795; margin:18px 0 10px; }
.stock-alert-card { background:#2B1D15; border-left:4px solid #D1572E; border-radius:14px; padding:12px 14px; margin-bottom:10px; }
.stock-row { display:flex; justify-content:space-between; font-size:13px; margin-bottom:8px; }
.stock-bar { height:6px; background:#1C120D; border-radius:4px; overflow:hidden; }
.stock-bar-fill { height:100%; background:#D1572E; }
.stock-bar-fill.ok { background:#7FA87A; }
.stock-meta { display:flex; justify-content:space-between; font-size:11px; color:#B8A795; margin-top:8px; gap:8px; flex-wrap:wrap; }
.future-tiles { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.future-tile { background:transparent; border:1.5px dashed rgba(255,255,255,.15); border-radius:14px; padding:16px; display:flex; flex-direction:column; align-items:center; gap:6px; color:#7A6A59; font-size:12px; font-weight:600; }
.nav-tile { background:#2B1D15; border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:16px; display:flex; flex-direction:column; align-items:center; gap:6px; color:#F3ECE3; font-size:12px; font-weight:600; min-height:84px; }
.nav-tile:active { background:#34241A; transform:scale(.97); }
.nav-tile-icon { color:#E3A23D; }

/* Confirm dialog */
.confirm-card { background:#2E2019; border-radius:20px; padding:20px; width:100%; max-width:300px; }
.confirm-card h3 { font-family:'Space Grotesk',sans-serif; margin:0 0 8px; font-size:16px; }
.confirm-card p { font-size:13px; color:#B8A795; margin:0 0 16px; line-height:1.4; }
.confirm-actions { display:flex; gap:8px; justify-content:flex-end; }

/* Toasts */
.toast-wrap { position:absolute; left:14px; right:14px; bottom:84px; z-index:80; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
.toast { background:#2E2019; border-left:4px solid #7FA87A; border-radius:12px; padding:11px 14px; display:flex; align-items:center; gap:9px; font-size:12.5px; box-shadow:0 8px 24px rgba(0,0,0,.4); animation:toastIn .2s ease-out; }
.toast-warn { border-left-color:#D1572E; }
.toast-success { border-left-color:#7FA87A; }
@keyframes toastIn { from { transform:translateY(8px); opacity:0; } to { transform:translateY(0); opacity:1; } }

/* Empty state */
.empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:60px 20px; color:#B8A795; gap:8px; }
.empty-icon { width:56px; height:56px; border-radius:18px; background:#2B1D15; display:flex; align-items:center; justify-content:center; color:#E3A23D; margin-bottom:6px; }
.empty-title { font-weight:700; color:#F3ECE3; font-size:14px; }
.empty-subtitle { font-size:12px; }

/* Role select — CTA de cliente */
.client-cta { width:100%; background:linear-gradient(135deg,#E3A23D,#C9842B); color:#1C120D; border-radius:22px; padding:18px; display:flex; align-items:center; gap:14px; margin-bottom:22px; box-shadow:0 14px 30px -10px rgba(227,162,61,.5); }
.client-cta:active { transform:scale(.98); }
.client-cta-icon { width:48px; height:48px; border-radius:14px; background:rgba(28,18,13,.15); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.client-cta-text { flex:1; text-align:left; display:flex; flex-direction:column; }
.client-cta-title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:17px; }
.client-cta-sub { font-size:12px; opacity:.85; margin-top:2px; }
.role-divider { display:flex; align-items:center; gap:10px; color:#7A6A59; font-size:11px; text-transform:uppercase; letter-spacing:.06em; margin-bottom:14px; }
.role-divider::before, .role-divider::after { content:''; flex:1; height:1px; background:rgba(255,255,255,.08); }
.staff-row { display:flex; gap:10px; }
.staff-card { flex:1; background:#2B1D15; border:1px solid rgba(255,255,255,.06); border-radius:16px; padding:14px 8px; display:flex; flex-direction:column; align-items:center; gap:6px; font-size:11px; font-weight:600; color:#B8A795; min-height:64px; }
.staff-card:active { background:#34241A; }

/* Botón secundario de ancho completo (cerrar receta / nuevo pedido) */
.btn-secondary.full { width:100%; justify-content:center; }

/* Pastilla de turno abierto/cerrado en Caja */
.turno-pill { padding:7px 12px; border-radius:999px; font-size:11px; font-weight:700; background:#241810; color:#7A6A59; white-space:nowrap; min-height:32px; }
.turno-pill.open { color:#7FA87A; background:rgba(127,168,122,.15); }
.turno-pill.closed { color:#E3A23D; background:rgba(227,162,61,.15); }

/* Estado del turno y promoción en Admin */
.turno-status-card { display:flex; justify-content:space-between; align-items:center; background:#2B1D15; border-radius:14px; padding:12px 14px; margin-bottom:14px; font-size:13px; font-weight:600; }
.status-open-text { color:#7FA87A; font-weight:700; }
.status-closed-text { color:#D1572E; font-weight:700; }
.promo-summary-card { font-size:12px; color:#B8A795; background:#2B1D15; border-radius:12px; padding:10px 12px; margin-bottom:10px; }

/* Link de "ver receta" dentro de la hoja de personalización */
.recipe-preview-link { background:none; color:#5C8A87; font-size:12.5px; font-weight:700; display:flex; align-items:center; gap:6px; margin-bottom:14px; padding:0; min-height:28px; }

/* Tags sobre la tarjeta del ticket: en línea / programado / regalo */
.ticket-tags { display:flex; gap:6px; flex-wrap:wrap; margin:6px 0; }
.tag-online, .tag-scheduled, .tag-reward { display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:999px; }
.tag-online { background:rgba(92,138,135,.18); color:#5C8A87; }
.tag-scheduled { background:rgba(227,162,61,.15); color:#E3A23D; }
.tag-reward { background:rgba(227,162,61,.18); color:#E3A23D; }

/* Registro de cliente */
.registro-card { background:#2B1D15; border-radius:20px; padding:22px; margin-top:10px; }
.registro-icon { width:48px; height:48px; border-radius:14px; background:rgba(227,162,61,.15); color:#E3A23D; display:flex; align-items:center; justify-content:center; margin-bottom:12px; }
.registro-card h2 { font-family:'Space Grotesk',sans-serif; font-size:18px; margin:0 0 4px; }
.registro-sub { font-size:12px; color:#B8A795; margin:0 0 16px; }
.form-error { display:flex; align-items:center; gap:6px; color:#D1572E; font-size:12px; margin-bottom:12px; font-weight:600; }

/* Selección de modo de pedido y horario */
.pickup-select { display:flex; flex-direction:column; gap:12px; margin-top:6px; }
.pickup-title { font-family:'Space Grotesk',sans-serif; font-size:18px; text-align:center; margin-bottom:6px; }
.pickup-option { background:#2B1D15; border:1px solid rgba(255,255,255,.06); border-radius:18px; padding:16px; display:flex; align-items:center; gap:14px; text-align:left; min-height:64px; }
.pickup-option:active { background:#34241A; }
.pickup-option-icon { width:46px; height:46px; border-radius:13px; background:rgba(227,162,61,.15); color:#E3A23D; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.pickup-option-text { display:flex; flex-direction:column; gap:2px; font-size:13px; color:#B8A795; }
.pickup-option-text strong { font-size:14px; color:#F3ECE3; }

/* Banner de regalo en la confirmación del cliente */
.reward-banner { background:rgba(227,162,61,.15); color:#E3A23D; border-radius:14px; padding:10px 16px; font-size:13px; font-weight:700; display:flex; align-items:center; gap:8px; margin-bottom:6px; }

/* Tarjeta de fidelidad (elemento distintivo del cliente) */
.loyalty-card { background:#2B1D15; border:1px solid rgba(227,162,61,.25); border-radius:16px; padding:14px; margin-bottom:14px; }
.loyalty-card.ready { border-color:#7FA87A; }
.loyalty-claim-btn { width:100%; background:#7FA87A; color:#0E1A0D; font-weight:700; border-radius:999px; padding:11px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; margin-top:4px; }
.loyalty-claim-btn:active { transform:scale(.97); }

/* Banner de "regalo listo" en el menú del cliente */
.reward-ready-banner { width:100%; background:linear-gradient(135deg,#7FA87A,#5C8A6F); color:#0E1A0D; border-radius:16px; padding:14px 16px; display:flex; align-items:center; gap:10px; font-weight:700; font-size:13px; margin-bottom:14px; }
.reward-ready-banner:active { transform:scale(.98); }
.loyalty-head { display:flex; justify-content:space-between; font-size:12px; font-weight:700; color:#B8A795; margin-bottom:10px; text-transform:uppercase; letter-spacing:.03em; }
.loyalty-count { color:#E3A23D; font-family:'IBM Plex Mono',monospace; }
.loyalty-cups { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
.loyalty-cup { width:24px; height:24px; border-radius:50%; background:#1C120D; border:1.5px solid rgba(255,255,255,.12); display:flex; align-items:center; justify-content:center; color:#4A3A2C; }
.loyalty-cup.filled { background:#E3A23D; border-color:#E3A23D; color:#1C120D; }
.loyalty-cup.next { border-color:#E3A23D; color:#E3A23D; animation:loyaltyPulse 1.6s infinite; }
@keyframes loyaltyPulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
.loyalty-footer { font-size:12px; color:#B8A795; }

/* Seguimiento de pedido del cliente */
.seguimiento-head { text-align:center; margin-bottom:14px; }
.ready-banner { background:rgba(127,168,122,.18); color:#7FA87A; border-radius:14px; padding:14px; display:flex; align-items:center; gap:10px; font-weight:700; margin-bottom:16px; justify-content:center; }
.noshow-banner { background:rgba(209,87,46,.18); color:#D1572E; border-radius:14px; padding:14px; display:flex; align-items:flex-start; gap:10px; font-weight:700; margin-bottom:16px; line-height:1.4; }
.seguimiento-list { display:flex; flex-direction:column; gap:10px; margin-bottom:18px; }
.seguimiento-item { display:flex; align-items:center; gap:10px; background:#2B1D15; border-radius:14px; padding:12px; }
.progress-track { display:flex; gap:4px; margin-top:6px; }
.progress-dot { width:18px; height:4px; border-radius:2px; background:rgba(255,255,255,.12); }
.progress-dot.done { background:#E3A23D; }

/* Link discreto de acceso al personal en RoleSelect */
.staff-link { display:flex; align-items:center; justify-content:center; gap:7px; width:100%; background:none; color:#7A6A59; font-size:12px; font-weight:600; min-height:40px; margin-top:auto; }
.staff-link:active { color:#B8A795; }

/* PIN gate */
.pin-gate { display:flex; flex-direction:column; align-items:center; padding-top:8px; position:relative; }
.pin-back { position:absolute; left:0; top:0; }
.pin-head { text-align:center; margin-bottom:18px; display:flex; flex-direction:column; align-items:center; }
.pin-head h2 { font-family:'Space Grotesk',sans-serif; font-size:18px; margin:0 0 4px; }
.pin-dots { display:flex; gap:14px; margin-bottom:10px; }
.pin-dots.error .pin-dot.filled { background:#D1572E; border-color:#D1572E; }
.pin-dot { width:14px; height:14px; border-radius:50%; border:1.5px solid rgba(255,255,255,.18); background:transparent; }
.pin-dot.filled { background:#E3A23D; border-color:#E3A23D; }
.pin-error { justify-content:center; }
.pin-keypad { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; margin-top:18px; width:100%; max-width:240px; }
.pin-key { aspect-ratio:1; border-radius:50%; background:#241810; color:#F3ECE3; font-size:18px; font-weight:700; display:flex; align-items:center; justify-content:center; min-height:52px; }
.pin-key:active { background:#34241A; transform:scale(.95); }

/* Chip de usuario con sesión activa */
.user-chip { display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:700; color:#B8A795; background:#241810; padding:7px 10px; border-radius:999px; white-space:nowrap; min-height:32px; }

/* Usuarios y roles (Admin) */
.usuario-row { display:flex; justify-content:space-between; align-items:center; background:#2B1D15; border-radius:14px; padding:10px 12px; margin-bottom:8px; }
.usuario-info { display:flex; align-items:center; gap:10px; }
.usuario-avatar { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; color:#1C120D; flex-shrink:0; }
.usuario-avatar.role-admin { background:#E3A23D; }
.usuario-avatar.role-cajero { background:#5C8A87; }
.usuario-avatar.role-barista { background:#7FA87A; }
.usuario-name { font-weight:700; font-size:13px; }
.usuario-role { font-size:11px; color:#B8A795; }
.usuario-actions { display:flex; align-items:center; gap:10px; }
.usuario-actions.vertical { flex-direction:column; align-items:flex-end; gap:6px; flex-shrink:0; }
.link-toggle { background:none; color:#D1572E; font-size:11px; font-weight:700; padding:0; min-height:28px; white-space:nowrap; }

/* Materias primas (Admin) */
.option-group.two-col { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.materia-row { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; background:#2B1D15; border-radius:14px; padding:12px 14px; margin-bottom:8px; width:100%; text-align:left; }
.materia-info { flex:1; min-width:0; }
.materia-name { font-weight:700; font-size:13px; margin-bottom:2px; }
.materia-sub { font-size:11px; color:#B8A795; margin-bottom:8px; }
.materia-stock-label { display:flex; align-items:center; gap:8px; font-size:11px; color:#B8A795; margin-top:6px; }
.bajo-tag { display:inline-flex; align-items:center; gap:3px; color:#D1572E; font-weight:700; }
.materia-edit-icon { color:#7A6A59; flex-shrink:0; margin-top:2px; }

/* Proveedores (Admin) */
.proveedor-row { display:flex; align-items:center; gap:12px; background:#2B1D15; border-radius:14px; padding:12px 14px; margin-bottom:8px; width:100%; text-align:left; }
.proveedor-info { flex:1; min-width:0; }
.proveedor-meta { font-size:11px; color:#7A6A59; margin-top:2px; }

/* Recetas (Admin) */
.recetas-hint { font-size:12px; color:#B8A795; margin-bottom:14px; line-height:1.4; }

/* Reportes (Admin) */
.reporte-row { display:flex; justify-content:space-between; align-items:center; background:#2B1D15; border-radius:12px; padding:11px 14px; margin-bottom:8px; font-size:13px; }

/* Cuenta del cliente: historial y recompensas */
.cuenta-head { display:flex; align-items:center; gap:12px; margin-bottom:18px; }
.cuenta-avatar { width:46px; height:46px; border-radius:50%; background:rgba(227,162,61,.18); color:#E3A23D; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.cuenta-name { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:16px; }
.cuenta-phone { font-size:12px; color:#B8A795; }
.rewards-summary-card { display:flex; justify-content:space-between; align-items:center; background:#2B1D15; border-radius:14px; padding:12px 14px; margin-bottom:18px; font-size:13px; font-weight:600; color:#B8A795; }
.kpi-value-sm { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:18px; color:#E3A23D; }
.historial-row { display:flex; justify-content:space-between; align-items:flex-start; padding:11px 0; border-bottom:1px solid rgba(255,255,255,.06); gap:10px; }
`;

function BootScreen({ state, onRetry }) {
  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, textAlign: 'center' }}>
      <div className="brand-mark"><Coffee size={26} /></div>
      {state === 'loading' ? (
        <p style={{ color: '#B8A795' }}>Cargando el menú…</p>
      ) : (
        <>
          <p style={{ color: '#D1572E', fontWeight: 700 }}>No se pudo conectar con la API.</p>
          <p style={{ color: '#B8A795', fontSize: 13 }}>¿Está corriendo el backend en el puerto 3000?</p>
          <button className="btn-primary" onClick={onRetry}>Reintentar</button>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState(null);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [mermas, setMermas] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [turnoAbierto, setTurnoAbierto] = useState(false);
  const [clientes, setClientes] = useState([]);
  const [promoConfig, setPromoConfig] = useState({ activo: true, cada: 10, premioId: 'americano' });
  const [usuarios, setUsuarios] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [materias, setMaterias] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [reportes, setReportes] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [smsActivo, setSmsActivo] = useState(true); // falla cerrado hasta poder leer la configuración
  const [nombreNegocio, setNombreNegocio] = useState(''); // marca blanca: nombre del negocio
  const [logo, setLogo] = useState(''); // marca blanca: logo (data URL base64)
  const [recetaOverrides, setRecetaOverrides] = useState({});
  const [bootState, setBootState] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [pedidos, setPedidos] = useState([]); // pedidos reales (API) para Caja
  const [cola, setCola] = useState([]); // cola real (API) para Barista
  const orderCounterRef = useRef(104);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // El título de la pestaña del navegador usa el nombre del negocio (marca blanca).
  useEffect(() => { document.title = nombreNegocio || 'Mi Cafetería'; }, [nombreNegocio]);

  // Carga el catálogo real (menú, categorías y opciones) desde la API y lo vuelca
  // en los arreglos que ya usa todo el prototipo. Son endpoints públicos, así que
  // no requieren login.
  const cargarCatalogo = React.useCallback(async () => {
    setBootState('loading');
    try {
      const [cats, prods, ops] = await Promise.all([api.getCategorias(), api.getProductos(), api.getOpciones()]);
      replaceArray(CATEGORIES, cats.map(c => ({ id: c.nombre, icon: ICON_BY_CAT[c.nombre] || Coffee })));
      replaceArray(PRODUCTS, prods);
      replaceArray(SIZE_OPTIONS, ops.tamanos);
      replaceArray(MILK_OPTIONS, ops.leches);
      replaceArray(COFFEE_OPTIONS, ops.cafes);
      replaceArray(EXTRA_OPTIONS, ops.extras);
      // Configuración de fidelidad real (endpoint público) para que Cliente y
      // Admin vean el mismo premio/umbral. Si no hay, se cae al Americano.
      try {
        const fid = await api.getFidelidad();
        if (fid && fid.producto_premio_id) setPromoConfig({ activo: fid.activo, cada: fid.cada_n_pedidos, premioId: fid.producto_premio_id });
        else { const premio = prods.find(p => p.name === 'Americano') || prods[0]; if (premio) setPromoConfig(pc => ({ ...pc, premioId: premio.id })); }
      } catch {
        const premio = prods.find(p => p.name === 'Americano') || prods[0];
        if (premio) setPromoConfig(pc => ({ ...pc, premioId: premio.id }));
      }
      try { const cfg = await api.getConfig(); setSmsActivo(!!cfg.smsVerificacion); setNombreNegocio(cfg.nombreNegocio || ''); setLogo(cfg.logo || ''); } catch { /* conserva el modo seguro */ }
      setBootState('ready');
    } catch {
      setBootState('error');
    }
  }, []);

  useEffect(() => { cargarCatalogo(); }, [cargarCatalogo]);

  // ---- Caja + Barista contra la API real ----
  const refrescarPedidos = React.useCallback(async () => {
    try { const rows = await api.getPedidos(); setPedidos(rows.map(adaptPedido)); } catch { /* conserva lo último */ }
  }, []);
  const refrescarCola = React.useCallback(async () => {
    try { const rows = await api.getColaBarista(); setCola(rows.map(adaptTicket)); } catch { /* conserva lo último */ }
  }, []);
  const refrescarTurno = React.useCallback(async () => {
    try { const e = await api.getTurnoEstado(); setTurnoAbierto(!!e.abierto); } catch { /* ignore */ }
  }, []);

  // Mientras hay personal con sesión, refresca pedidos y cola cada pocos segundos
  // (varios dispositivos golpean la misma API).
  useEffect(() => {
    if (!['cajero', 'barista', 'admin'].includes(role)) return undefined;
    refrescarTurno(); refrescarPedidos(); refrescarCola();
    const t = setInterval(() => { refrescarPedidos(); refrescarCola(); }, 3500);
    return () => clearInterval(t);
  }, [role, refrescarPedidos, refrescarCola, refrescarTurno]);

  const crearPedidoCaja = async ({ cart, descuentoPorcentaje, pago, autorizacionDescuento, clienteTelefono }) => {
    const r = await api.crearPedido({ cart, pago, descuentoPorcentaje, autorizacionDescuento, clienteTelefono });
    await refrescarPedidos(); await refrescarCola();
    addToast(`Pedido ${r.pedido.folio} enviado a preparación`, 'success');
    return adaptPedido(r.pedido);
  };
  const cobrarPedidoApi = async (orderId, payInfo = null) => {
    await api.cobrarPedido(orderId, payInfo ? { metodoPago: payInfo.metodoPago, montoRecibido: payInfo.montoRecibido } : {});
    await refrescarPedidos(); await refrescarCola();
    addToast('Cobro confirmado', 'success');
  };
  const cancelarPedidoApi = async (orderId) => {
    try { await api.cancelarPedido(orderId); await refrescarPedidos(); await refrescarCola(); addToast('Pedido cancelado', 'warn'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const noShowPedidoApi = async (orderId) => {
    try { await api.noShowPedido(orderId); await refrescarPedidos(); await refrescarCola(); addToast('Marcado como no recogido', 'warn'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const iniciarTicketApi = async (id) => {
    try { await api.iniciarItem(id); await refrescarCola(); } catch (e) { addToast(e.message, 'warn'); }
  };
  const terminarTicketApi = async (ticket) => {
    try {
      await api.terminarItem(ticket.id);
      await refrescarCola(); await refrescarPedidos();
      const p = getProduct(ticket.productId);
      addToast(`${p ? p.name : 'Bebida'} terminada — inventario actualizado`, 'success');
      if (ticket.origen === 'app' && ticket.cliente) addToast(`📲 Aviso a ${ticket.cliente.nombre}: ¡tu pedido está listo!`, 'success');
    } catch (e) { addToast(e.message, 'warn'); }
  };
  const crearMermaApi = async (body) => {
    try { await api.crearMerma(body); await refrescarCola(); addToast('Merma registrada — inventario descontado', 'warn'); }
    catch (e) { addToast(e.message, 'warn'); }
  };

  // ---- Admin contra la API real ----
  const recargarAdmin = React.useCallback(async () => {
    try {
      const [us, prov, mats] = await Promise.all([api.getUsuarios(), api.getProveedores(), api.getMaterias()]);
      setUsuarios(us);
      setProveedores(prov);
      setMaterias(mats.map(adaptMateria));
      api.getMateriasCategorias(); api.getCategoriasProducto(); // llenan los mapas nombre->id para crear/editar
      const fid = await api.getFidelidad();
      if (fid) setPromoConfig({ activo: fid.activo, cada: fid.cada_n_pedidos, premioId: fid.producto_premio_id });
      const [rep, k] = await Promise.all([api.getReportes(), api.getKpisTurno()]);
      setReportes(rep); setKpis(k);
    } catch { /* conserva lo último */ }
  }, []);

  useEffect(() => {
    if (role !== 'admin') return undefined;
    recargarAdmin();
    const t = setInterval(recargarAdmin, 5000);
    return () => clearInterval(t);
  }, [role, recargarAdmin]);

  // Recetas personalizadas reales (molienda/tiempo por tipo de café) en el mapa
  // que ya usa todo el prototipo, para que el barista vea lo que el admin guardó.
  const recargarRecetas = React.useCallback(async () => {
    try {
      const rows = await api.getRecetas();
      const map = {};
      rows.forEach(r => { if (r.es_personalizada) map[r.producto_id] = adaptReceta(r); });
      setRecetaOverrides(map);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!['cajero', 'barista', 'admin'].includes(role)) return undefined;
    recargarRecetas();
    return undefined;
  }, [role, recargarRecetas]);

  const addToast = (msg, tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3400);
  };

  const createOrder = ({ cart, total, payMethod, cashGiven, change, discount, origen = 'mostrador', cliente = null, horaRecogida = null, esRecompensaPura = false, cobrado }) => {
    const orderId = `P-${orderCounterRef.current}`;
    orderCounterRef.current += 1;
    // Las ventas de mostrador se cobran en el momento. Los pedidos por la app (incluido el
    // reclamo de un regalo) quedan "por cobrar" hasta que caja confirme que el cliente sí pasó.
    const isCobrado = cobrado !== undefined ? cobrado : origen !== 'app';
    const order = {
      id: orderId, items: cart, total, payMethod, cashGiven, change, discount, origen, cliente, horaRecogida,
      esRecompensaPura, cobrado: isCobrado, noShow: false, createdAt: Date.now(), cancelado: false,
    };
    const newTickets = cart.map((item, idx) => ({
      id: `${orderId}-${idx + 1}`, orderId, ...item, status: 'pendiente', createdAt: Date.now(), startedAt: null, finishedAt: null,
      origen, cliente, horaRecogida,
    }));
    setOrders(prev => [order, ...prev]);
    setTickets(prev => [...newTickets, ...prev]);
    addToast(
      origen === 'app'
        ? (esRecompensaPura ? `Regalo ${orderId} registrado — pasa por él` : `Pedido ${orderId} recibido — ¡gracias ${cliente?.nombre}!`)
        : `Pedido ${orderId} enviado a preparación`,
      'success'
    );
    return order;
  };

  const startTicket = id => setTickets(prev => prev.map(t => (t.id === id ? { ...t, status: 'en_preparacion', startedAt: Date.now() } : t)));

  const finishTicket = ticket => {
    setTickets(prev => prev.map(t => (t.id === ticket.id ? { ...t, status: 'terminado', finishedAt: Date.now() } : t)));
    const product = getProduct(ticket.productId);
    const recipe = buildRecipe(product, ticket, recetaOverrides[ticket.productId]);
    const lines = recipe.ingredientes.slice(0, 3).map(i => `${i.label} ${i.cantidad}`).join(', ');
    addToast(`${product.name} listo — inventario actualizado: ${lines}${recipe.ingredientes.length > 3 ? '…' : ''}`, 'success');
    if (ticket.origen === 'app' && ticket.cliente) {
      addToast(`📲 Notificación enviada a ${ticket.cliente.nombre}: ¡tu pedido está listo, pasa por él!`, 'success');
    }
  };

  const cancelOrderFn = orderId => {
    setOrders(prev => prev.map(o => (o.id === orderId ? { ...o, cancelado: true } : o)));
    setTickets(prev => prev.map(t => (t.orderId === orderId ? { ...t, status: 'cancelado' } : t)));
    addToast(`Pedido ${orderId} cancelado`, 'warn');
  };

  const addMerma = record => {
    setMermas(prev => [{ ...record, id: Date.now(), fecha: Date.now() }, ...prev]);
    addToast('Merma registrada', 'warn');
  };

  // Caja confirma que el cliente sí pasó por su pedido en línea (con o sin cobro real si era un
  // regalo). Solo AQUÍ se acredita el punto de fidelidad — nunca al solo levantar el pedido.
  const confirmarEntrega = (orderId, payInfo = null) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    setOrders(prev => prev.map(o => (o.id === orderId ? {
      ...o,
      cobrado: true,
      payMethod: payInfo ? payInfo.payMethod : o.payMethod,
      cashGiven: payInfo ? payInfo.cashGiven : o.cashGiven,
      change: payInfo ? payInfo.change : o.change,
    } : o)));
    if (order.origen === 'app' && order.cliente && !order.esRecompensaPura) {
      incrementLoyalty(order.cliente.telefono);
    }
    addToast(`Pedido ${orderId} ${order.total > 0 ? 'cobrado' : 'entregado'} correctamente`, 'success');
  };

  // El cliente nunca pasó por un pedido ya listo: se penaliza un punto de fidelidad y se
  // registra como merma lo que el barista ya preparó (políticas de merma).
  const marcarNoShow = orderId => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    setOrders(prev => prev.map(o => (o.id === orderId ? { ...o, noShow: true } : o)));
    if (order.cliente) {
      setClientes(prev => prev.map(c => (c.telefono === order.cliente.telefono ? { ...c, pedidosApp: Math.max(0, c.pedidosApp - 1) } : c)));
    }
    order.items.forEach(item => {
      const product = getProduct(item.productId);
      addMerma({ insumo: product.name, motivo: 'Pedido no recogido', cantidad: item.qty, nota: `Pedido ${orderId}${order.cliente ? ` — ${order.cliente.nombre} ${order.cliente.apellido}` : ''}`, pedidoId: orderId });
    });
    if (order.cliente) {
      addToast(`📲 Notificación enviada a ${order.cliente.nombre}: lamentamos que no pudiste pasar por tu pedido ${orderId}. Por políticas de merma, se restó 1 punto de tu tarjeta de fidelidad.`, 'warn');
    } else {
      addToast(`Pedido ${orderId} marcado como no recogido`, 'warn');
    }
  };

  const toggleTurno = async () => {
    try {
      if (turnoAbierto) { await api.cerrarTurno(); addToast('Turno cerrado', 'warn'); }
      else { await api.abrirTurno(); addToast('Turno abierto — ¡a vender!', 'success'); }
      await refrescarTurno();
      await refrescarPedidos();
    } catch (e) { addToast(e.message, 'warn'); }
  };

  const registerClient = ({ nombre, apellido, telefono }) => {
    setClientes(prev => (prev.some(c => c.telefono === telefono) ? prev : [...prev, { nombre, apellido, telefono, pedidosApp: 0, recompensaPendiente: false }]));
  };

  const incrementLoyalty = telefono => {
    setClientes(prev => prev.map(c => {
      if (c.telefono !== telefono) return c;
      const nuevoConteo = c.pedidosApp + 1;
      const recompensaLista = promoConfig.activo && nuevoConteo % promoConfig.cada === 0;
      return { ...c, pedidosApp: nuevoConteo, recompensaPendiente: c.recompensaPendiente || recompensaLista };
    }));
  };

  const clearRecompensaPendiente = telefono => {
    setClientes(prev => prev.map(c => (c.telefono === telefono ? { ...c, recompensaPendiente: false } : c)));
  };

  const logout = () => {
    api.setToken(null); // cierra sesión del PERSONAL; la del cliente se conserva (token en localStorage) para que pueda volver
    setRole(null);
    setCurrentUser(null);
  };

  const addUsuario = async u => {
    try { await api.crearUsuario({ nombre: u.nombre, rol: u.rol, pin: u.pin }); await recargarAdmin(); addToast('Usuario agregado', 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const updateUsuario = async (id, patch) => {
    try {
      const body = {};
      ['nombre', 'rol', 'activo'].forEach(k => { if (patch[k] !== undefined) body[k] = patch[k]; });
      if (patch.pin) body.pin = patch.pin;
      await api.actualizarUsuario(id, body); await recargarAdmin();
    } catch (e) { addToast(e.message, 'warn'); }
  };

  const addMateria = async m => {
    try { await api.crearMateria(m); await recargarAdmin(); addToast('Materia prima agregada', 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const updateMateria = async (id, patch) => {
    try { await api.actualizarMateria(id, patch); await recargarAdmin(); }
    catch (e) { addToast(e.message, 'warn'); }
  };

  const addProveedor = async p => {
    try { await api.crearProveedor(p); await recargarAdmin(); addToast('Proveedor agregado', 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const updateProveedor = async (id, patch) => {
    try { await api.actualizarProveedor(id, patch); await recargarAdmin(); }
    catch (e) { addToast(e.message, 'warn'); }
  };

  const guardarPromo = async cfg => {
    try { await api.guardarFidelidad(cfg); setPromoConfig(cfg); await recargarAdmin(); addToast('Promoción guardada', 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };

  const guardarSmsConfig = async val => {
    try { await api.setConfig({ smsVerificacion: val }); setSmsActivo(val); addToast(val ? 'Verificación por SMS activada' : 'Verificación por SMS desactivada', 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };

  const guardarBranding = async cambios => {
    try {
      const cfg = await api.setConfig(cambios);
      setNombreNegocio(cfg.nombreNegocio || '');
      setLogo(cfg.logo || '');
      addToast('Identidad del negocio actualizada', 'success');
    } catch (e) { addToast(e.message, 'warn'); }
  };

  const setRecetaOverride = async (productId, override) => {
    try {
      if (override === null) { await api.restaurarReceta(productId); addToast('Receta restaurada a su versión predeterminada', 'success'); }
      else { await api.guardarReceta(productId, override); addToast('Receta actualizada', 'success'); }
      await recargarRecetas();
    } catch (e) { addToast(e.message, 'warn'); }
  };

  const clock = new Date(now).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="posproto">
      <style>{STYLES}</style>
      <div className="phone-frame">
        <div className="status-bar"><span>{clock}</span><span>● ● ● 100%</span></div>

        {!role && (bootState === 'ready'
          ? <RoleSelect onSelectCliente={() => setRole('cliente')} onStaffLogin={u => { setCurrentUser(u); setRole(u.rol); }} usuarios={usuarios} nombreNegocio={nombreNegocio} logo={logo} />
          : <BootScreen state={bootState} onRetry={cargarCatalogo} />)}
        {role === 'cliente' && (
          <ClienteApp
            turnoAbierto={turnoAbierto}
            promoConfig={promoConfig}
            smsActivo={smsActivo}
            addToast={addToast}
            onSwitchRole={logout}
            recetaOverrides={recetaOverrides}
          />
        )}
        {role === 'cajero' && (
          <CajeroApp
            tickets={cola} orders={pedidos} createOrder={crearPedidoCaja} cancelOrderFn={cancelarPedidoApi}
            confirmarEntrega={cobrarPedidoApi} marcarNoShow={noShowPedidoApi} addToast={addToast}
            onSwitchRole={logout} turnoAbierto={turnoAbierto} onToggleTurno={toggleTurno} currentUser={currentUser} now={now}
          />
        )}
        {role === 'barista' && (
          <BaristaApp
            tickets={cola} startTicket={iniciarTicketApi} finishTicket={terminarTicketApi} addMerma={crearMermaApi} addToast={addToast}
            onSwitchRole={logout} now={now} currentUser={currentUser} recetaOverrides={recetaOverrides}
          />
        )}
        {role === 'admin' && (
          <AdminApp
            kpis={kpis} reportes={reportes} recargarCatalogo={cargarCatalogo} addToast={addToast}
            smsActivo={smsActivo} onToggleSms={guardarSmsConfig}
            nombreNegocio={nombreNegocio} logo={logo} onSaveBranding={guardarBranding}
            onSwitchRole={logout} turnoAbierto={turnoAbierto} promoConfig={promoConfig} setPromoConfig={guardarPromo}
            usuarios={usuarios} addUsuario={addUsuario} updateUsuario={updateUsuario} currentUser={currentUser}
            materias={materias} addMateria={addMateria} updateMateria={updateMateria}
            proveedores={proveedores} addProveedor={addProveedor} updateProveedor={updateProveedor}
            recetaOverrides={recetaOverrides} setRecetaOverride={setRecetaOverride}
          />
        )}

        <ToastHost toasts={toasts} />
      </div>
    </div>
  );
}
