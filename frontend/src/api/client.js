// Cliente HTTP de la API de la cafetería.
//
// Centraliza: el token JWT, el manejo de errores y la TRADUCCIÓN entre la forma
// del prototipo (las opciones se identifican por "código": '12', 'entera',
// 'tradicional', 'shot'...) y la forma de la base de datos (ids numéricos). Así
// los componentes del prototipo siguen usando códigos y solo aquí, al mandar un
// pedido, se traducen a los ids que la API espera.
//
// Escrito para funcionar igual en el navegador (Vite hace proxy de /api -> API)
// y en Node (para pruebas: usar setBaseUrl('http://localhost:3000/api')).

const LS = typeof localStorage !== 'undefined' ? localStorage : null;

let BASE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '/api';
export function setBaseUrl(u) { BASE = u; }

let token = LS ? LS.getItem('cafeteria_token') : null;
let tokenCliente = LS ? LS.getItem('cafeteria_token_cliente') : null;

export function setToken(t) {
  token = t || null;
  if (LS) { t ? LS.setItem('cafeteria_token', t) : LS.removeItem('cafeteria_token'); }
}
export function setTokenCliente(t) {
  tokenCliente = t || null;
  if (LS) { t ? LS.setItem('cafeteria_token_cliente', t) : LS.removeItem('cafeteria_token_cliente'); }
}
export function getToken() { return token; }
export function getTokenCliente() { return tokenCliente; }
export function logout() { setToken(null); setTokenCliente(null); }

async function request(path, { method = 'GET', body, useClienteToken = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const tk = useClienteToken ? tokenCliente : token;
  if (tk) headers.Authorization = `Bearer ${tk}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Error ${res.status}`);
    err.status = res.status;
    err.details = data && data.details;
    throw err;
  }
  return data;
}

/* ============================================================
   ADAPTADORES  (API -> forma del prototipo)
   ============================================================ */

function adaptProducto(p) {
  return {
    id: p.id,
    name: p.nombre,
    cat: p.categoria,
    icon: p.icono || '☕',
    price: Number(p.precio_efectivo ?? p.precio_base),
    tipo: p.tipo,
    leche: !!p.permite_leche,
    frio: !!p.es_frio,
    sizes: !!p.permite_tamanos,
    coffeeType: !!p.permite_tipo_cafe,
    extras: !!p.permite_extras,
    activo: p.activo !== false,
  };
}

// Las opciones conservan el "código" como id (lo que el prototipo ya usa para
// seleccionar y para sus valores por defecto). El id numérico real se guarda
// aparte, en los mapas de abajo, para traducir al crear el pedido.
const codigoToId = { tamano: {}, leche: {}, cafe: {}, extra: {} };

function adaptOpcion(o, tipo) {
  codigoToId[tipo][o.codigo] = o.id;
  return {
    id: o.codigo,
    codigo: o.codigo,
    label: o.etiqueta,
    delta: Number(o.delta_precio || 0),
    dbId: o.id,
    ...(o.es_shot_adicional ? { esShot: true } : {}),
  };
}

/* ============================================================
   AUTENTICACIÓN
   ============================================================ */

export async function login(pin) {
  const r = await request('/auth/login', { method: 'POST', body: { pin } });
  setToken(r.token);
  return r.usuario; // { id, nombre, rol }
}

export async function clienteSolicitarCodigo(telefono) {
  return request('/auth/cliente/solicitar-codigo', { method: 'POST', body: { telefono } });
}

export async function clienteVerificarCodigo({ telefono, codigo, nombre, apellido }) {
  const r = await request('/auth/cliente/verificar-codigo', {
    method: 'POST',
    body: { telefono, codigo, nombre, apellido },
  });
  setTokenCliente(r.token);
  return r.cliente;
}

// Alta directa sin SMS (solo válida si la verificación por SMS está apagada).
export async function clienteRegistroDirecto({ telefono, nombre, apellido }) {
  const r = await request('/auth/cliente/registro', { method: 'POST', body: { telefono, nombre, apellido } });
  setTokenCliente(r.token);
  return r.cliente;
}

// Configuración general de la app (ej. si el alta de clientes exige SMS).
export function getConfig() { return request('/config'); }
export function setConfig(body) { return request('/config', { method: 'PUT', body }); }

/* ============================================================
   CATÁLOGO  (menú + opciones)
   ============================================================ */

export async function getCategorias() {
  return request('/productos/categorias'); // [{ id, nombre, orden, ... }]
}

export async function getProductos() {
  const rows = await request('/productos');
  return rows.map(adaptProducto);
}

export async function getOpciones() {
  const [tamanos, leches, cafes, extras] = await Promise.all([
    request('/opciones/tamanos'),
    request('/opciones/leches'),
    request('/opciones/cafes'),
    request('/opciones/extras'),
  ]);
  return {
    tamanos: tamanos.map(o => adaptOpcion(o, 'tamano')),
    leches: leches.map(o => adaptOpcion(o, 'leche')),
    cafes: cafes.map(o => adaptOpcion(o, 'cafe')),
    extras: extras.map(o => adaptOpcion(o, 'extra')),
  };
}

/* ============================================================
   TURNO
   ============================================================ */

export function getTurnoEstado() { return request('/turnos/estado'); } // { abierto, turno }
export function abrirTurno() { return request('/turnos/abrir', { method: 'POST' }); }
export function cerrarTurno() { return request('/turnos/cerrar', { method: 'POST' }); }
export function getKpisTurno() { return request('/turnos/actual/kpis'); }

/* ============================================================
   PEDIDOS
   ============================================================ */

// Traduce un item del carrito (con códigos) al formato que la API espera (ids).
function itemToApi(item) {
  return {
    productoId: item.productId,
    tamanoId: item.size ? codigoToId.tamano[item.size] : undefined,
    lecheId: item.milk ? codigoToId.leche[item.milk] : undefined,
    cafeId: item.coffeeType ? codigoToId.cafe[item.coffeeType] : undefined,
    extraIds: (item.extras || []).map(c => codigoToId.extra[c]).filter(Boolean),
    cantidad: item.qty || 1,
    notas: item.notas || undefined,
    esRegalo: !!item.isReward,
  };
}

export function crearAprobacionDescuento({ pin, descuentoPorcentaje }) {
  return request('/pedidos/aprobaciones-descuento', { method: 'POST', body: { pin, descuentoPorcentaje } });
}

export function crearPedido({ cart, pago, descuentoPorcentaje, autorizacionDescuento, clienteTelefono, horaRecogida, comoCliente }) {
  return request('/pedidos', {
    method: 'POST',
    useClienteToken: !!comoCliente, // un pedido del Cliente usa su token, no el del personal
    body: {
      items: cart.map(itemToApi),
      pago,
      descuentoPorcentaje,
      autorizacionDescuento,
      clienteTelefono,
      horaRecogida,
    },
  });
}

export function getPedidos() { return request('/pedidos'); } // vista vw_pedidos_con_estado
export function getPedido(id) { return request(`/pedidos/${id}`); }
export function cobrarPedido(id, { metodoPago, montoRecibido } = {}) {
  return request(`/pedidos/${id}/cobrar`, { method: 'PATCH', body: { metodoPago, montoRecibido } });
}
export function cancelarPedido(id) { return request(`/pedidos/${id}/cancelar`, { method: 'PATCH' }); }
// El cliente cancela SU propio pedido (con su token), si la preparación no inició.
export function cancelarMiPedido(id) { return request(`/pedidos/${id}/cancelar`, { method: 'PATCH', useClienteToken: true }); }
export function noShowPedido(id) { return request(`/pedidos/${id}/no-show`, { method: 'PATCH' }); }

/* ============================================================
   BARISTA
   ============================================================ */

export function getColaBarista() { return request('/pedido-items/cola'); }
export function iniciarItem(id) { return request(`/pedido-items/${id}/iniciar`, { method: 'PATCH' }); }
export function terminarItem(id) { return request(`/pedido-items/${id}/terminar`, { method: 'PATCH' }); }

/* ============================================================
   MERMAS  (el prototipo manda nombre de insumo; la API pide materiaPrimaId.
   Esa traducción se resolverá al cablear Barista; por ahora se expone crudo.)
   ============================================================ */

export function crearMerma(body) { return request('/mermas', { method: 'POST', body }); }
export function getMaterias() { return request('/materias-primas'); }

/* ============================================================
   CLIENTE  (su cuenta / historial)
   ============================================================ */

export function getMiCuenta() { return request('/clientes/yo', { useClienteToken: true }); }
export function getMisPedidos() { return request('/clientes/yo/pedidos', { useClienteToken: true }); }

/* ============================================================
   ADMIN
   ============================================================ */

// Mapas nombre-de-categoría -> id, que se llenan al pedir las categorías y se
// usan para traducir los formularios del prototipo (que eligen categoría por
// NOMBRE) al id que la API necesita.
const matCatId = {};
const prodCatId = {};

export function getUsuarios() { return request('/usuarios'); }
export function crearUsuario(body) { return request('/usuarios', { method: 'POST', body }); }
export function actualizarUsuario(id, body) { return request(`/usuarios/${id}`, { method: 'PATCH', body }); }

export function getProveedores() { return request('/proveedores'); }
export function crearProveedor(body) { return request('/proveedores', { method: 'POST', body }); }
export function actualizarProveedor(id, body) { return request(`/proveedores/${id}`, { method: 'PATCH', body }); }

export async function getMateriasCategorias() {
  const rows = await request('/materias-primas/categorias');
  rows.forEach(c => { matCatId[c.nombre] = c.id; });
  return rows;
}
export function crearMateria(m) {
  return request('/materias-primas', {
    method: 'POST',
    body: {
      nombre: m.nombre, categoriaId: matCatId[m.categoria], unidad: m.unidad,
      stockActual: m.stockActual, stockMinimo: m.stockMinimo, costoUnitario: m.costoUnitario,
      proveedorId: m.proveedorId || null,
    },
  });
}
export function actualizarMateria(id, m) {
  const body = {};
  if (m.nombre !== undefined) body.nombre = m.nombre;
  if (m.categoria !== undefined) body.categoriaId = matCatId[m.categoria];
  if (m.unidad !== undefined) body.unidad = m.unidad;
  if (m.stockMinimo !== undefined) body.stockMinimo = m.stockMinimo;
  if (m.costoUnitario !== undefined) body.costoUnitario = m.costoUnitario;
  if (m.proveedorId !== undefined) body.proveedorId = m.proveedorId;
  if (m.activo !== undefined) body.activo = m.activo;
  return request(`/materias-primas/${id}`, { method: 'PATCH', body });
}

export async function getCategoriasProducto() {
  const rows = await request('/productos/categorias');
  rows.forEach(c => { prodCatId[c.nombre] = c.id; });
  return rows;
}
export function crearProducto(p) {
  return request('/productos', {
    method: 'POST',
    body: {
      nombre: p.name, categoriaId: prodCatId[p.cat], tipo: p.tipo, icono: p.icon, precioBase: p.price,
      permiteTamanos: p.sizes, permiteLeche: p.leche, permiteTipoCafe: p.coffeeType, permiteExtras: p.extras, esFrio: p.frio,
    },
  });
}
export function actualizarProducto(id, p) {
  const body = {};
  if (p.name !== undefined) body.nombre = p.name;
  if (p.cat !== undefined) body.categoriaId = prodCatId[p.cat];
  if (p.tipo !== undefined) body.tipo = p.tipo;
  if (p.icon !== undefined) body.icono = p.icon;
  if (p.price !== undefined) body.precioBase = p.price;
  if (p.sizes !== undefined) body.permiteTamanos = p.sizes;
  if (p.leche !== undefined) body.permiteLeche = p.leche;
  if (p.coffeeType !== undefined) body.permiteTipoCafe = p.coffeeType;
  if (p.extras !== undefined) body.permiteExtras = p.extras;
  if (p.frio !== undefined) body.esFrio = p.frio;
  if (p.activo !== undefined) body.activo = p.activo;
  return request(`/productos/${id}`, { method: 'PATCH', body });
}

export function getFidelidad() { return request('/promociones/fidelidad'); }
export function guardarFidelidad({ activo, cada, premioId }) {
  return request('/promociones/fidelidad', { method: 'PUT', body: { activo, cadaNPedidos: cada, productoPremioId: premioId } });
}

export function getReportes() {
  return Promise.all([
    request('/reportes/ventas-por-metodo-pago'),
    request('/reportes/productos-mas-vendidos'),
    request('/reportes/cancelaciones-no-show'),
    request('/reportes/mermas-por-motivo'),
  ]).then(([ventasPorMetodo, masVendidos, cancelaciones, mermasPorMotivo]) =>
    ({ ventasPorMetodo, masVendidos, cancelaciones, mermasPorMotivo }));
}

/* ============================================================
   RECETAS  (molienda / tiempo de extracción por tipo de café)
   ============================================================ */

export function getRecetas() { return request('/recetas'); }
export function guardarReceta(productoId, ov) {
  return request(`/recetas/${productoId}`, {
    method: 'PUT',
    body: {
      pasos: ov.pasos,
      gramajePorShot: ov.gramajePorShot,
      molienda: ov.molienda,
      moliendaEspecial: ov.moliendaEspecial,
      ajusteMolino: ov.ajusteMolino,
      ajusteMolinoEspecial: ov.ajusteMolinoEspecial,
      tiempoExtraccion: ov.tiempoExtraccion || ov.tiempoLicuado,        // frappé usa tiempoLicuado en la misma columna
      tiempoExtraccionEspecial: ov.tiempoExtraccionEspecial,
      temperaturaServicio: ov.temperatura,
      texturaLeche: ov.texturaLeche,
    },
  });
}
export function restaurarReceta(productoId) { return request(`/recetas/${productoId}/restaurar`, { method: 'POST' }); }
