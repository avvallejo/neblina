// Utilidades compartidas por todas las pantallas.

export function money(n) { return `$${Number(n || 0).toFixed(2)}`; }

export function mmss(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function fmtHora(ts) {
  return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export function validPhone(str) {
  const digits = (str || '').replace(/\D/g, '');
  return digits.length === 10;
}

/* ---- Unidades de medida ---- */
export const UNIDADES = ['g', 'kg', 'ml', 'l', 'pieza'];
const UNIDAD_LABELS = { g: 'g', kg: 'kg', ml: 'ml', l: 'l', pieza: 'pieza' };

export function normalizeUnidad(unidad) {
  if (!unidad) return 'kg';
  const raw = String(unidad).trim().toLowerCase();
  if (['lt', 'lts', 'litro', 'litros'].includes(raw)) return 'l';
  if (['gr', 'gramo', 'gramos'].includes(raw)) return 'g';
  if (['pieza', 'piezas', 'pz', 'pza', 'pzas', 'unidad', 'unidades'].includes(raw)) return 'pieza';
  return raw;
}
export function unidadDisplay(unidad) { return UNIDAD_LABELS[normalizeUnidad(unidad)] || unidad; }
export function unidadFamilia(unidad) {
  const u = normalizeUnidad(unidad);
  if (u === 'g' || u === 'kg') return 'peso';
  if (u === 'ml' || u === 'l') return 'volumen';
  if (u === 'pieza') return 'pieza';
  return 'otra';
}
export function convertirCantidad(valor, origen, destino) {
  const n = Number(valor);
  if (!Number.isFinite(n) || valor === '') return valor;
  const from = normalizeUnidad(origen);
  const to = normalizeUnidad(destino);
  if (from === to) return n;
  if (from === 'kg' && to === 'g') return n * 1000;
  if (from === 'g' && to === 'kg') return n / 1000;
  if (from === 'l' && to === 'ml') return n * 1000;
  if (from === 'ml' && to === 'l') return n / 1000;
  return null;
}
export function convertirCostoUnitario(valor, origen, destino) {
  const n = Number(valor);
  if (!Number.isFinite(n) || valor === '') return valor;
  const unoConvertido = convertirCantidad(1, origen, destino);
  return unoConvertido && unoConvertido > 0 ? n / unoConvertido : null;
}
export function formatNumeroInput(n, decimals = 3) {
  if (n === '' || n === null || n === undefined || !Number.isFinite(Number(n))) return '';
  return Number(n).toFixed(decimals).replace(/\.?0+$/, '');
}
export function unidadHint(unidad) {
  const u = normalizeUnidad(unidad);
  if (u === 'g') return 'Captura gramos como entero: 100 significa 100 g. Si quieres usar 0.100, cambia la unidad a kg.';
  if (u === 'kg') return 'Captura kilos con decimales: 0.100 kg equivale a 100 g. Las recetas en gramos se convierten solas.';
  if (u === 'ml') return 'Captura mililitros como entero: 250 significa 250 ml. Si quieres usar 0.250, cambia la unidad a l.';
  if (u === 'l') return 'Captura litros con decimales: 0.250 l equivale a 250 ml. Las recetas en ml se convierten solas.';
  return 'Captura piezas como número entero: vasos, tapas, servilletas, etc.';
}
export function unidadStep(unidad) {
  const u = normalizeUnidad(unidad);
  return (u === 'g' || u === 'ml' || u === 'pieza') ? '1' : '0.001';
}
export function stockPct(actual, minimo) {
  const min = Number(minimo || 0);
  const act = Number(actual || 0);
  if (min <= 0) return act > 0 ? 100 : 0;
  return Math.min(100, Math.round((act / min) * 100));
}

// Redimensiona una imagen (logo) a un lado máximo y la devuelve como data URL
// base64, para guardarla liviana en la configuración del negocio.
export function redimensionarImagen(file, max) {
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
