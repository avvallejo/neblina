// MESAS Y ESTACIONES DE PREPARACIÓN.
//   * Destino del pedido (Caja): mesa N | barra | llevar. Obligatorio para las
//     ventas de mostrador; los pedidos en línea no lo llevan (el cliente recoge).
//   * Estación del producto: barra | parrilla | caja. Los ítems de 'caja' no
//     pasan por ninguna comanda: nacen terminados (el trigger de inventario se
//     dispara igual porque se insertan pendientes y se actualizan).
//   * Estaciones del usuario (barista/mostrador): qué comanda ve.
const { ApiError } = require('../utils/asyncHandler');

const DESTINOS = ['mesa', 'barra', 'llevar'];
const ESTACIONES_PRODUCTO = ['barra', 'parrilla', 'caja'];
const ESTACIONES_USUARIO = ['barra', 'parrilla'];
const CLAVE_MESAS = 'mesas';
const MESAS_DEFAULT = 4;
const MAX_MESAS = 200;

function normalizarMesas(value) {
  if (value === undefined || value === null || value === '') return MESAS_DEFAULT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_MESAS) throw new ApiError(400, `La cantidad de mesas debe ser un entero entre 0 y ${MAX_MESAS}.`);
  return n;
}

async function leerMesas(queryFn, sucursalId) {
  const { rows } = await queryFn('SELECT valor FROM configuracion WHERE sucursal_id = $1 AND clave = $2', [sucursalId, CLAVE_MESAS]);
  const n = rows[0] ? Number(rows[0].valor) : NaN;
  return Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_MESAS) : MESAS_DEFAULT;
}

// Valida el destino que manda la Caja. Devuelve { destino, mesaNumero }.
async function resolverDestino(queryFn, sucursalId, { destino, mesa }, { obligatorio = true } = {}) {
  if (destino === undefined || destino === null || destino === '') {
    if (obligatorio) throw new ApiError(400, 'Indica a dónde va el pedido: mesa, barra o para llevar.');
    return { destino: null, mesaNumero: null };
  }
  if (!DESTINOS.includes(destino)) throw new ApiError(400, 'Destino inválido (mesa, barra o llevar).');
  if (destino !== 'mesa') {
    if (mesa !== undefined && mesa !== null && mesa !== '') throw new ApiError(400, 'Solo un pedido de mesa lleva número de mesa.');
    return { destino, mesaNumero: null };
  }
  const n = Number(mesa);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'Indica el número de mesa.');
  const total = await leerMesas(queryFn, sucursalId);
  if (n > total) throw new ApiError(400, total === 0 ? 'Esta sucursal no tiene mesas configuradas.' : `Esta sucursal tiene ${total} mesa(s); la mesa ${n} no existe.`);
  return { destino, mesaNumero: n };
}

function normalizarEstacionProducto(value, { tipo } = {}) {
  if (value === undefined || value === null || value === '') return tipo === 'snack' || tipo === 'alimento' ? 'parrilla' : 'barra';
  if (!ESTACIONES_PRODUCTO.includes(value)) throw new ApiError(400, 'Estación inválida (barra, parrilla o caja).');
  return value;
}

function normalizarEstacionesUsuario(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, 'Elige al menos una estación (barra o parrilla).');
  const set = [...new Set(value)];
  if (!set.every(e => ESTACIONES_USUARIO.includes(e))) throw new ApiError(400, 'Estación inválida (barra o parrilla).');
  return ESTACIONES_USUARIO.filter(e => set.includes(e)); // orden estable
}

// Sin preparación: quedan LISTOS de inmediato para reservar/descontar inventario.
// Esto NO registra la entrega física: cantidad_entregada sigue en cero hasta
// que caja/mostrador la confirme en Comandas. Se conserva el nombre por compatibilidad.
async function entregarItemsDeCaja(client, pedidoId) {
  const { rows } = await client.query(
    `UPDATE pedido_items pi SET estado = 'terminado', terminado_en = now()
     WHERE pi.pedido_id = $1 AND pi.estado = 'pendiente' AND pi.estacion_preparacion = 'caja'
     RETURNING pi.id`,
    [pedidoId]
  );
  return rows.length;
}

// Estaciones que ve un usuario en su comanda (los admin ven todas).
async function estacionesDe(queryFn, auth) {
  if (auth.rol === 'admin') return ESTACIONES_USUARIO;
  if (Array.isArray(auth.estaciones) && auth.estaciones.length) return auth.estaciones; // requireAuth ya las leyó
  const { rows } = await queryFn('SELECT estaciones FROM usuarios WHERE id = $1', [auth.id]);
  const e = rows[0] ? rows[0].estaciones : null;
  return Array.isArray(e) && e.length ? e : ESTACIONES_USUARIO;
}

function etiquetaDestino({ destino, mesa_numero: mesaNumero, origen }) {
  if (destino === 'mesa') return `Mesa ${mesaNumero}`;
  if (destino === 'barra') return 'Barra';
  if (destino === 'llevar') return 'Para llevar';
  return origen === 'app' ? 'En línea · recoger' : null;
}

module.exports = {
  DESTINOS, ESTACIONES_PRODUCTO, ESTACIONES_USUARIO, CLAVE_MESAS, MESAS_DEFAULT, MAX_MESAS,
  normalizarMesas, leerMesas, resolverDestino, normalizarEstacionProducto, normalizarEstacionesUsuario,
  entregarItemsDeCaja, estacionesDe, etiquetaDestino,
};
