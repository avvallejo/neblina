// Comparte únicamente lecturas en curso; los cobros y demás escrituras nunca
// se reintentan automáticamente. Cada sesión y sucursal tiene su propia clave.
export function createHttpClient({ fetchImpl = (...args) => fetch(...args), now = Date.now, onResponse = () => {} } = {}) {
  const pendingReads = new Map();
  const cooldowns = new Map();
  const scopeOf = (url, method) => {
    const path = new URL(url, 'http://local').pathname;
    // Un bloqueo de PIN/SMS/autorización no debe detener el resto del negocio.
    return method === 'GET' ? 'reads' : `${method}:${path}`;
  };
  function limited(until) {
    const seconds = Math.max(1, Math.ceil((until - now()) / 1000));
    const error = new Error(`Demasiadas solicitudes. Espera ${seconds} segundos e intenta de nuevo.`);
    error.status = 429;
    error.retryAfterSeconds = seconds;
    return error;
  }
  async function send(url, options, scope) {
    const res = await fetchImpl(url, options);
    onResponse(res, options);
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (res.status === 429) {
      const retry = res.headers.get('Retry-After');
      const delay = retry?.trim() && Number.isFinite(Number(retry))
        ? Number(retry) * 1000 : Date.parse(retry) - now();
      const until = now() + (Number.isFinite(delay) && delay > 0 ? delay : 60000);
      cooldowns.set(scope, Math.max(cooldowns.get(scope) || 0, until));
      const error = limited(cooldowns.get(scope));
      if (data?.error) error.message = `${data.error} Puedes reintentar en ${error.retryAfterSeconds} segundos.`;
      throw error;
    }
    if (!res.ok) {
      const error = new Error(data?.error || `Error ${res.status}`);
      error.status = res.status;
      error.details = data?.details;
      throw error;
    }
    return data;
  }
  return function request(url, options = {}) {
    const method = options.method || 'GET';
    const scope = scopeOf(url, method);
    const until = cooldowns.get(scope) || 0;
    if (until > now()) return Promise.reject(limited(until));
    cooldowns.delete(scope);
    if (method !== 'GET') return send(url, options, scope);
    const key = JSON.stringify([url, options.headers || {}]);
    if (!pendingReads.has(key)) {
      pendingReads.set(key, send(url, options, scope).finally(() => pendingReads.delete(key)));
    }
    return pendingReads.get(key);
  };
}
