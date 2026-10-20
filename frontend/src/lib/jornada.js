// Ayudas de las JORNADAS (horas del personal que se paga por hora, migración 50).
// Sin React ni red, para poder probarlas solas. Las reglas de verdad (minutos
// completos, pausas, semana domingo-sábado) viven en la API; aquí solo se
// muestran y se estima el avance mientras la jornada sigue abierta.
export const TZ = 'America/Mexico_City';
const MIN = 60 * 1000;

// Minutos completos entre dos instantes (se descartan los segundos en cada extremo).
export function minutosEntre(inicio, fin) {
  return Math.max(0, Math.floor(new Date(fin).getTime() / MIN) - Math.floor(new Date(inicio).getTime() / MIN));
}

export function formatDuracion(minutos) {
  const m = Math.max(0, Math.round(Number(minutos) || 0));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

export function formatHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-MX', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
}

// 'AAAA-MM-DD' → 'dom 18 oct' (el mediodía UTC evita que la zona horaria cambie el día).
export function diaCorto(fechaISO) {
  return new Date(`${fechaISO}T12:00:00Z`).toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '').replace(',', '');
}

export function sumarDias(fechaISO, dias) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + dias * 86400000).toISOString().slice(0, 10);
}

// Semana de pago: de domingo a sábado.
export function semanaDomingo(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const desde = sumarDias(fechaISO, -dow);
  return { desde, hasta: sumarDias(desde, 6) };
}

// '18 – 24 oct 2026' (o '28 sep – 4 oct 2026' si cruza de mes).
export function rangoSemana({ desde, hasta }) {
  const f = (iso, conMes, conAnio) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-MX', { timeZone: 'UTC', day: 'numeric', ...(conMes ? { month: 'short' } : {}), ...(conAnio ? { year: 'numeric' } : {}) }).replace(/\./g, '');
  const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
  return `${f(desde, !mismoMes, false)} – ${f(hasta, true, true)}`;
}

// Instante → 'AAAA-MM-DDTHH:mm' en hora de la sede, para <input type="datetime-local">.
export function aInputLocal(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T').slice(0, 16);
}

// Lo que lleva la jornada abierta AHORA: el servidor mandó su avance a la hora `estado.ahora`;
// mientras no esté en pausa se suman los minutos que han pasado desde entonces.
export function vivoDe(estado, ahoraMs, recibidoEnMs) {
  const j = estado && estado.jornada;
  if (!j) return { minutos: 0, monto: 0, minutosPausa: 0 };
  const base = new Date(estado.ahora).getTime();
  const transcurrido = Math.max(0, ahoraMs - recibidoEnMs);
  const extra = Math.floor((base + transcurrido) / MIN) - Math.floor(base / MIN);
  const minutos = (j.minutosPagables || 0) + (estado.enPausa ? 0 : extra);
  const minutosPausa = j.pausaDesde ? minutosEntre(j.pausaDesde, base + transcurrido) : 0;
  const tarifa = Number(j.tarifaHora || estado.tarifaHora || 0);
  return { minutos, minutosPausa, monto: Math.round((minutos * Math.round(tarifa * 100)) / 60) / 100 };
}

export const ESTADO_LABELS = { abierta: 'En curso', por_revisar: 'Por revisar', cerrada: 'Por pagar', pagada: 'Pagada', anulada: 'Anulada' };
