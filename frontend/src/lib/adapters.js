// Adaptadores API (snake_case) -> forma que usan las pantallas (camelCase).
import { PAY_METHOD_LABELS } from './catalog.js';
import { normalizeUnidad } from './helpers.js';

// Pedido de vw_pedidos_con_estado -> forma de la UI. El "estado" lo calcula la
// vista en el servidor.
export function adaptPedido(p) {
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

// Item de la cola del barista -> "ticket". Las opciones ya vienen como código.
export function adaptTicket(pi) {
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

export function adaptCliente(c) {
  return {
    id: c.id,
    nombre: c.nombre,
    apellido: c.apellido,
    telefono: c.telefono,
    pedidosApp: c.pedidos_app_contador ?? 0,
    recompensaPendiente: !!c.recompensa_pendiente,
  };
}

// Estado de un pedido del cliente (la ruta /clientes/yo/pedidos no trae el
// estado calculado; se deriva de banderas + items).
export function estadoPedidoCliente(p) {
  if (p.no_show) return 'no_show';
  if (p.cancelado) return 'cancelado';
  const its = p.items || [];
  if (its.length > 0 && its.every(i => i.estado === 'terminado')) return p.cobrado ? 'terminado' : 'listo';
  if (its.some(i => i.estado && i.estado !== 'pendiente')) return 'en_preparacion';
  return 'pendiente';
}

export function adaptMateria(m) {
  return {
    id: m.id,
    nombre: m.nombre,
    categoria: m.categoria,
    unidad: normalizeUnidad(m.unidad),
    stockActual: Number(m.stock_actual),
    stockMinimo: Number(m.stock_minimo),
    costoUnitario: Number(m.costo_unitario),
    proveedorId: m.proveedor_id || null,
    requiereLote: !!m.requiere_lote,
    activo: m.activo !== false,
  };
}

// Receta de la API -> "override" para buildRecipe (null -> undefined para que
// buildRecipe caiga a sus valores por defecto).
export function adaptReceta(r) {
  const lecheMl = r.leche_ml_por_tamano && typeof r.leche_ml_por_tamano === 'object' ? r.leche_ml_por_tamano : null;
  return {
    esPersonalizada: !!r.es_personalizada,
    // Si la receta no fue personalizada, los pasos guardados son los genéricos:
    // se dejan vacíos para que buildRecipe genere los suyos (con gramaje, etc.).
    pasos: r.es_personalizada && Array.isArray(r.pasos) ? r.pasos : [],
    // Ingredientes fijos del inventario (lo que de verdad se descuenta).
    insumosFijos: Array.isArray(r.insumos_fijos)
      ? r.insumos_fijos.map(f => ({ materiaPrimaId: f.materia_prima_id, label: f.materia_prima, cantidad: Number(f.cantidad), unidad: f.unidad }))
      : undefined,
    // ml de leche por código de tamaño propios de este producto (null = de la sede).
    lecheMl: lecheMl ? Object.fromEntries(Object.entries(lecheMl).map(([k, v]) => [k, Number(v)])) : null,
    gramajePorShot: r.gramaje_por_shot != null ? Number(r.gramaje_por_shot) : undefined,
    molienda: r.molienda || undefined,
    moliendaEspecial: r.molienda_especial || undefined,
    ajusteMolino: r.ajuste_molino || undefined,
    ajusteMolinoEspecial: r.ajuste_molino_especial || undefined,
    tiempoExtraccion: r.tiempo_extraccion || undefined,
    tiempoExtraccionEspecial: r.tiempo_extraccion_especial || undefined,
    tiempoLicuado: r.tiempo_extraccion || undefined, // frappés
    temperatura: r.temperatura_servicio || undefined,
    texturaLeche: r.textura_leche || undefined,
  };
}
