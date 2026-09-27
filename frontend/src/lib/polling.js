// Espera a que termine cada actualización antes de programar la siguiente.
// Una pestaña oculta deja de consultar y se actualiza al volver a verla.
export function startPolling(refresh, interval, {
  page = document, schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let stopped = false;
  let running = false;
  let timer;
  const run = async () => {
    if (stopped || running || page.hidden) return;
    cancel(timer);
    running = true;
    try { await refresh(); }
    catch { /* Cada pantalla presenta su error; el sondeo debe continuar. */ }
    finally {
      running = false;
      if (!stopped && !page.hidden) timer = schedule(run, interval);
    }
  };
  const visibility = () => {
    cancel(timer);
    if (!page.hidden) run();
  };
  page.addEventListener('visibilitychange', visibility);
  run();
  return () => {
    stopped = true;
    cancel(timer);
    page.removeEventListener('visibilitychange', visibility);
  };
}
