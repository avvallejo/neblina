// Cliente HTTP de la API de la cafetería — MULTI-SUCURSAL.
//
// Centraliza: el token JWT (personal y cliente), la SUCURSAL ACTIVA, el manejo
// de errores y la TRADUCCIÓN entre la forma de la UI (opciones por "código":
// '12', 'entera', 'tradicional'...) y la forma de la base de datos (ids).
//
// Sucursal activa:
//   * Se guarda en localStorage y se manda SIEMPRE:
//       - como ?sucursal= en los endpoints públicos (menú, config, estado...)
//       - como X-Sucursal-Id en los autenticados (el backend lo usa solo si
//         la sesión es de un administrador general; para el personal con sede
//         fija lo ignora y usa la suya).
//   * El personal con sede fija queda "anclado" a su sede por el token; el
//     ADMIN GENERAL cambia de sede con setSucursal() (el switcher del panel).

const LS = typeof localStorage !== 'undefined' ? localStorage : null;

let BASE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '/api';
export function setBaseUrl(u) { BASE = u; }

let token = LS ? LS.getItem('cafeteria_token') : null;
let tokenCliente = LS ? LS.getItem('cafeteria_token_cliente') : null;
let sucursal = null;
try { sucursal = LS && LS.getItem('cafeteria_sucursal') ? JSON.parse(LS.getItem('cafeteria_sucursal')) : null; } catch { sucursal = null; }

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

export function setSucursal(s) {
  sucursal = s || null;
  if (LS) { s ? LS.setItem('cafeteria_sucursal', JSON.stringify({ id: s.id, nombre: s.nombre })) : LS.removeItem('cafeteria_sucursal'); }
}
export function getSucursal() { return sucursal; }
export function getSucursalId() { return sucursal ? sucursal.id : null; }

async function request(path, { method = 'GET', body, useClienteToken = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const tk = useClienteToken ? tokenCliente : token;
  if (tk) headers.Authorization = `Bearer ${tk}`;
  // La sede activa viaja en cada petición; el backend decide si aplica.
  if (sucursal && sucursal.id) headers['X-Sucursal-Id'] = sucursal.id;

  const res = await fetch(`${BASE}${path}`, {
    method,
    cache: method === 'GET' ? 'no-store' : 'default',
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

// Endpoints públicos: la sede va en la query (?sucursal=).
function pub(path) {
  if (!sucursal || !sucursal.id) return path;
  return `${path}${path.includes('?') ? '&' : '?'}sucursal=${sucursal.id}`;
}

/* ============================================================
   SUCURSALES
   ============================================================ */

export function getSucursales() { return request('/sucursales'); } // público: [{ id, nombre }]
export function getSucursalesTodas() { return request('/sucursales/todas'); } // admin general
export function crearSucursal({ nombre, prefijoFolio }) {
  return request('/sucursales', { method: 'POST', body: { nombre, prefijoFolio } });
}
export function actualizarSucursal(id, body) { return request(`/sucursales/${id}`, { method: 'PATCH', body }); }

/* ============================================================
   ADAPTADORES  (API -> forma de la UI)
   ============================================================ */

function adaptProducto(p) {
  return {
    id: p.id,
    name: p.nombre,
    cat: p.categoria,
    icon: p.icono || '☕',
    price: Number(p.precio_efectivo ?? p.precio_base),
    precioBase: Number(p.precio_base),            // para tachar el precio normal cuando hay promoción
    precioPromocional: p.precio_promocional === null || p.precio_promocional === undefined ? null : Number(p.precio_promocional),
    descripcion: p.descripcion || '',
    tipo: p.tipo,
    leche: !!p.permite_leche,
    frio: !!p.es_frio,
    sizes: !!p.permite_tamanos,
    coffeeType: !!p.permite_tipo_cafe,
    coffeePrices: p.recargos_cafe || {},
    extras: !!p.permite_extras,
    activo: p.activo !== false,
  };
}

function normalizeUnidadMedida(unidad) {
  if (unidad === undefined || unidad === null || unidad === '') return unidad;
  const raw = String(unidad).trim().toLowerCase();
  const aliases = {
    gr: 'g', gramo: 'g', gramos: 'g',
    kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
    mililitro: 'ml', mililitros: 'ml',
    lt: 'l', lts: 'l', litro: 'l', litros: 'l',
    piezas: 'pieza', pz: 'pieza', pza: 'pieza', pzas: 'pieza', unidad: 'pieza', unidades: 'pieza',
  };
  return aliases[raw] || raw;
}

// Las opciones conservan el "código" como id. El id numérico real (de ESTA
// sede) se guarda aparte para traducir al crear el pedido.
const codigoToId = { tamano: {}, leche: {}, cafe: {}, extra: {} };

function adaptOpcion(o, tipo) {
  codigoToId[tipo][o.codigo] = o.id;
  return {
    id: o.codigo,
    codigo: o.codigo,
    label: o.etiqueta,
    delta: Number(o.delta_precio || 0),
    dbId: o.id,
    ...(o.leche_ml !== undefined && o.leche_ml !== null ? { lecheMl: Number(o.leche_ml) } : {}), // tamaños: leche predeterminada de la sede
    ...(o.es_shot_adicional ? { esShot: true } : {}),
    ...(tipo === 'extra' && o.cantidad ? { cantidad: Number(o.cantidad), unidad: o.unidad } : {}), // porción del extra (para la receta)
  };
}

/* ============================================================
   AUTENTICACIÓN
   ============================================================ */

// Restaura la sesión guardada (personal). 401 = token vencido o revocado.
export function getYo() { return request('/auth/yo'); }

export async function login(pin) {
  const r = await request('/auth/login', { method: 'POST', body: { pin, sucursalId: getSucursalId() } });
  setToken(r.token);
  return r.usuario; // { id, nombre, rol, sucursalId } — sucursalId null = admin general
}

export function clienteSolicitarCodigo(telefono) {
  return request('/auth/cliente/solicitar-codigo', { method: 'POST', body: { telefono, sucursalId: getSucursalId() } });
}

export async function clienteVerificarCodigo({ telefono, codigo, nombre, apellido }) {
  const r = await request('/auth/cliente/verificar-codigo', {
    method: 'POST',
    body: { telefono, codigo, nombre, apellido, sucursalId: getSucursalId() },
  });
  setTokenCliente(r.token);
  return r.cliente;
}

// Alta directa sin SMS (solo válida si la verificación por SMS está apagada EN ESTA SEDE).
export async function clienteRegistroDirecto({ telefono, nombre, apellido }) {
  const r = await request('/auth/cliente/registro', { method: 'POST', body: { telefono, nombre, apellido, sucursalId: getSucursalId() } });
  setTokenCliente(r.token);
  return r.cliente;
}

// Configuración de la sede (nombre, logo, SMS).
export function getConfig() { return request(pub('/config')); }
export function setConfig(body) { return request('/config', { method: 'PUT', body }); }

/* ============================================================
   CATÁLOGO  (menú + opciones) — de la sede activa
   ============================================================ */

export function getCategorias() { return request(pub('/productos/categorias')); }

export async function getProductos() {
  const rows = await request(pub('/productos'));
  return rows.map(adaptProducto);
}

export async function getProductosAdmin() {
  const rows = await request(pub('/productos?incluirInactivos=1'));
  return rows.map(adaptProducto);
}

export async function getOpciones() {
  const [tamanos, leches, cafes, extras] = await Promise.all([
    request(pub('/opciones/tamanos')),
    request(pub('/opciones/leches')),
    request(pub('/opciones/cafes')),
    request(pub('/opciones/extras')),
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

export function getTurnoEstado() { return request(pub('/turnos/estado')); } // { abierto, turno }
export function abrirTurno() { return request('/turnos/abrir', { method: 'POST' }); }
export function cerrarTurno() { return request('/turnos/cerrar', { method: 'POST' }); }
export function getKpisTurno() { return request('/turnos/actual/kpis'); }
export function getKpisDia(fecha = '') { return request(`/reportes/resumen-dia?fecha=${encodeURIComponent(fecha)}`); }

/* ============================================================
   PEDIDOS
   ============================================================ */

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
    useClienteToken: !!comoCliente,
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

export function getPedidos() { return request('/pedidos'); }
export function getPedido(id) { return request(`/pedidos/${id}`); }
export function cobrarPedido(id, { metodoPago, montoRecibido } = {}) {
  return request(`/pedidos/${id}/cobrar`, { method: 'PATCH', body: { metodoPago, montoRecibido } });
}
export function cancelarPedido(id) { return request(`/pedidos/${id}/cancelar`, { method: 'PATCH' }); }
export function cancelarMiPedido(id) { return request(`/pedidos/${id}/cancelar`, { method: 'PATCH', useClienteToken: true }); }
export function noShowPedido(id) { return request(`/pedidos/${id}/no-show`, { method: 'PATCH' }); }

/* ============================================================
   BARISTA
   ============================================================ */

export function getColaBarista() { return request('/pedido-items/cola'); }
export function iniciarItem(id) { return request(`/pedido-items/${id}/iniciar`, { method: 'PATCH' }); }
export function terminarItem(id) { return request(`/pedido-items/${id}/terminar`, { method: 'PATCH' }); }

/* ============================================================
   MERMAS E INVENTARIO
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

const matCatId = {};
const prodCatId = {};

export function getUsuarios() { return request('/usuarios'); }
export function crearUsuario(body) { return request('/usuarios', { method: 'POST', body }); }
export function actualizarUsuario(id, body) { return request(`/usuarios/${id}`, { method: 'PATCH', body }); }

export function getProveedores() { return request('/proveedores'); }
export function crearProveedor(body) { return request('/proveedores', { method: 'POST', body }); }
export function actualizarProveedor(id, body) { return request(`/proveedores/${id}`, { method: 'PATCH', body }); }
export function eliminarProveedor(id) { return request(`/proveedores/${id}`, { method: 'DELETE' }); }

export async function getMateriasCategorias() {
  const rows = await request('/materias-primas/categorias');
  rows.forEach(c => { matCatId[c.nombre] = c.id; });
  return rows;
}
export function crearMateria(m) {
  return request('/materias-primas', {
    method: 'POST',
    body: {
      nombre: m.nombre, categoriaId: matCatId[m.categoria], unidad: normalizeUnidadMedida(m.unidad),
      stockActual: m.stockActual, stockMinimo: m.stockMinimo, costoUnitario: m.costoUnitario,
      proveedorId: m.proveedorId || null,
    },
  });
}
export function actualizarMateria(id, m) {
  const body = {};
  if (m.nombre !== undefined) body.nombre = m.nombre;
  if (m.categoria !== undefined) body.categoriaId = matCatId[m.categoria];
  if (m.unidad !== undefined) body.unidad = normalizeUnidadMedida(m.unidad);
  if (m.stockActual !== undefined) body.stockActual = m.stockActual;
  if (m.stockMinimo !== undefined) body.stockMinimo = m.stockMinimo;
  if (m.costoUnitario !== undefined) body.costoUnitario = m.costoUnitario;
  if (m.proveedorId !== undefined) body.proveedorId = m.proveedorId;
  if (m.activo !== undefined) body.activo = m.activo;
  return request(`/materias-primas/${id}`, { method: 'PATCH', body });
}
export function eliminarMateria(id, desvincular = false) { return request(`/materias-primas/${id}${desvincular ? '?desvincular=true' : ''}`, { method: 'DELETE' }); }

// Compras (lotes) y ajustes de conteo físico — el kardex del inventario.
export function registrarCompra(materiaId, { cantidadComprada, unidad, costoTotal, proveedorId, numeroLote, fechaCaducidad }) {
  return request(`/materias-primas/${materiaId}/lotes`, {
    method: 'POST',
    body: { cantidadComprada, unidad, costoTotal, proveedorId, numeroLote, fechaCaducidad },
  });
}
export function ajustarStock(materiaId, { nuevaCantidad, motivo, stockEsperado, fechaCaducidad }) {
  return request(`/materias-primas/${materiaId}/ajustar-stock`, { method: 'POST', body: { nuevaCantidad, motivo, stockEsperado, fechaCaducidad } });
}

export async function getCategoriasProducto() {
  const rows = await request(pub('/productos/categorias'));
  rows.forEach(c => { prodCatId[c.nombre] = c.id; });
  return rows;
}
export function crearProducto(p) {
  return request('/productos', {
    method: 'POST',
    body: {
      nombre: p.name, categoriaId: prodCatId[p.cat], tipo: p.tipo, icono: p.icon, precioBase: p.price,
      permiteTamanos: p.sizes, permiteLeche: p.leche, permiteTipoCafe: p.coffeeType, permiteExtras: p.extras, esFrio: p.frio,
      margenPorcentaje: p.margenPorcentaje, descripcion: p.descripcion, precioPromocional: p.precioPromocional,
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
  if (p.margenPorcentaje !== undefined) body.margenPorcentaje = p.margenPorcentaje;
  if (p.descripcion !== undefined) body.descripcion = p.descripcion;
  if (p.precioPromocional !== undefined) body.precioPromocional = p.precioPromocional;
  return request(`/productos/${id}`, { method: 'PATCH', body });
}
export function eliminarProducto(id) { return request(`/productos/${id}`, { method: 'DELETE' }); }

// Flujo costo → margen → precio.
export function getPrecioSugerido(id) { return request(`/productos/${id}/precio-sugerido`); }
export function getPreciosPorRevisar() { return request('/productos/precios-por-revisar'); }
export function mantenerPrecio(id, revision) {
  return request(`/productos/${id}/mantener-precio`, { method: 'POST', body: { revision } });
}

// Costos indirectos: gastos fijos mensuales de la sede (renta, sueldos…) y la
// configuración de margen/volumen con la que se prorratean por bebida.
export function getGastosFijos() { return request('/gastos-fijos'); }
export function crearGastoFijo({ concepto, categoria, montoMensual }) {
  return request('/gastos-fijos', { method: 'POST', body: { concepto, categoria, montoMensual } });
}
export function actualizarGastoFijo(id, body) { return request(`/gastos-fijos/${id}`, { method: 'PATCH', body }); }
export function eliminarGastoFijo(id) { return request(`/gastos-fijos/${id}`, { method: 'DELETE' }); }
export function getMargen() { return request('/promociones/margen'); } // incluye ventas_reales_promedio_mes
export function guardarMargen({ porcentajeGananciaNormal, redondeo, unidadesEstimadasMes }) {
  return request('/promociones/margen', { method: 'PUT', body: { porcentajeGananciaNormal, redondeo, unidadesEstimadasMes } });
}
export function getPuntoEquilibrio() { return request('/promociones/punto-equilibrio'); }

// Opciones de personalización (tamaños, leches, cafés, extras) con su costo
// estimado y precio sugerido; el admin ajusta el "delta_precio" que ve el
// cliente como (+6) y que el servidor suma al cobrar.
export function getOpcionesAdmin() { return request('/opciones/admin'); }
export function crearOpcion(tipo, body) { return request(`/opciones/${tipo}`, { method: 'POST', body }); }
export function actualizarOpcion(tipo, id, body) { return request(`/opciones/${tipo}/${id}`, { method: 'PATCH', body }); }

export function getPromocionesApertura() { return request(pub('/promociones/apertura')); } // público por sede
export function getFidelidad() { return request(pub('/promociones/fidelidad')); }
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

// Comparativo entre sedes — SOLO admin general.
export function getReportesConsolidados() {
  return Promise.all([
    request('/reportes/ventas-por-metodo-pago?consolidado=true'),
    request('/reportes/productos-mas-vendidos?consolidado=true'),
    request('/reportes/cancelaciones-no-show?consolidado=true'),
    request('/reportes/mermas-por-motivo?consolidado=true'),
  ]).then(([ventasPorMetodo, masVendidos, cancelaciones, mermasPorMotivo]) =>
    ({ ventasPorMetodo, masVendidos, cancelaciones, mermasPorMotivo }));
}

/* ============================================================
   RECETAS
   ============================================================ */

export function getRecetas() { return request('/recetas'); }
export function getReceta(productoId) { return request(`/recetas/${productoId}`); } // incluye insumos_fijos
export function guardarReceta(productoId, ov) {
  return request(`/recetas/${productoId}`, {
    method: 'PUT',
    body: {
      insumosFijos: ov.insumosFijos, // [{ materiaPrimaId, cantidad, unidad }] — reemplaza los ingredientes
      lecheMlPorTamano: ov.lecheMlPorTamano, // { '12': 280, ... } | null = predeterminado de la sede
      pasos: ov.pasos,
      gramajePorShot: ov.gramajePorShot,
      molienda: ov.molienda,
      moliendaEspecial: ov.moliendaEspecial,
      ajusteMolino: ov.ajusteMolino,
      ajusteMolinoEspecial: ov.ajusteMolinoEspecial,
      tiempoExtraccion: ov.tiempoExtraccion || ov.tiempoLicuado,
      tiempoExtraccionEspecial: ov.tiempoExtraccionEspecial,
      temperaturaServicio: ov.temperatura,
      texturaLeche: ov.texturaLeche,
    },
  });
}
export function restaurarReceta(productoId) { return request(`/recetas/${productoId}/restaurar`, { method: 'POST' }); }
