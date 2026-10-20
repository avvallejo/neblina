// JORNADAS — la parte de quien se paga por hora (la cajera): su reloj en la barra de arriba,
// el botón Salir / Regresar (pausa sin goce de sueldo), la pregunta "¿Terminaste tu turno?"
// al cerrar sesión y "Mis horas". Las reglas viven en la API (services/jornadas.js).
//
// OJO: "turno" es el turno de CAJA. Esto es la jornada de trabajo de una persona.
import React, { useCallback, useEffect, useState } from 'react';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import * as api from '../api/client.js';
import { Sheet, FormError, useAccionUnica } from './ui.jsx';
import { money } from '../lib/helpers.js';
import { formatDuracion, formatHora, diaCorto, rangoSemana, vivoDe, sumarDias, semanaDomingo, ESTADO_LABELS } from '../lib/jornada.js';

// Estado de la jornada del usuario en sesión. Se refresca cada minuto y al volver a la pestaña;
// entre una lectura y otra el avance se calcula en el dispositivo con la hora del SERVIDOR.
export function useJornada(activo) {
  const [estado, setEstado] = useState(null);
  const [recibidoEn, setRecibidoEn] = useState(0);
  const [, setLatido] = useState(0);
  const cargar = useCallback(async () => {
    try { const e = await api.getJornadaActual(); setEstado(e); setRecibidoEn(Date.now()); return e; } catch { return null; }
  }, []);
  useEffect(() => {
    if (!activo) return undefined;
    cargar();
    const lectura = setInterval(cargar, 60000);
    const visible = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(lectura); document.removeEventListener('visibilitychange', visible); };
  }, [activo, cargar]);
  useEffect(() => {
    if (!activo) return undefined;
    const latido = setInterval(() => setLatido(x => x + 1), 15000);
    return () => clearInterval(latido);
  }, [activo]);
  return { estado, recibidoEn, cargar };
}

const horaCorta = iso => formatHora(iso).replace(/\s/g, ' ');

// Reloj de la jornada + Salir / Regresar. Vive en la barra de arriba de todas las pantallas.
export function JornadaBar({ jornada, onVerHoras }) {
  const { estado, recibidoEn, cargar } = jornada;
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const mostrar = useCallback((texto) => { setAviso(texto); setTimeout(() => setAviso(''), 7000); }, []);

  // Al entrar con el PIN la entrada se registra sola: se lo decimos para que sepa que ya está contando.
  useEffect(() => {
    if (!estado?.aplica || !estado.jornada || estado.jornada.enCurso === false) return;
    const antiguedad = new Date(estado.ahora).getTime() - new Date(estado.jornada.entrada).getTime();
    if (antiguedad >= 0 && antiguedad < 2 * 60 * 1000) mostrar(`Entrada registrada: ${horaCorta(estado.jornada.entrada)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado?.jornada?.id]);

  const [busy, ejecutar] = useAccionUnica(async (fn, mensaje) => {
    setError('');
    try { await fn(); await cargar(); if (mensaje) mostrar(mensaje); } catch (e) { setError(e.message); setTimeout(() => setError(''), 8000); }
  });

  if (!estado || !estado.aplica) return null;
  const vivo = vivoDe(estado, Date.now(), recibidoEn);

  if (!estado.jornada) {
    return (
      <div className="jornada-bar sin-jornada">
        <span className="jornada-chip static"><Clock size={14} /><span className="jornada-tiempo">Sin turno en curso</span></span>
        <button type="button" className="jornada-accion" disabled={busy} onClick={() => ejecutar(() => api.iniciarJornada(), 'Entrada registrada')}>Iniciar turno</button>
        {error && <span className="jornada-aviso error" role="alert">{error}</span>}
      </div>
    );
  }

  return (
    <div className={`jornada-bar${estado.enPausa ? ' en-pausa' : ''}`}>
      <button type="button" className="jornada-chip" onClick={onVerHoras} title="Ver mis horas de la semana">
        <Clock size={14} />
        <span className="jornada-tiempo">{estado.enPausa ? `En pausa · ${vivo.minutosPausa} min` : formatDuracion(vivo.minutos)}</span>
        <strong>{money(vivo.monto)}</strong>
      </button>
      <button type="button" className="jornada-accion" disabled={busy}
        title={estado.enPausa ? 'Vuelve a contar tu tiempo' : 'Pausa: el tiempo fuera no se paga'}
        onClick={() => ejecutar(estado.enPausa ? api.jornadaRegresar : api.jornadaSalir, estado.enPausa ? 'Qué bueno que regresaste: tu tiempo vuelve a contar' : 'Pausa iniciada: este tiempo no se paga')}>
        {estado.enPausa ? 'Regresar' : 'Salir'}
      </button>
      {aviso && <span className="jornada-aviso" role="status">{aviso}</span>}
      {error && <span className="jornada-aviso error" role="alert">{error}</span>}
    </div>
  );
}

function ResumenSemana({ totales }) {
  return (
    <div className="jornada-semana">
      <div className="jornada-semana-fila principal"><span>Acumulado de la semana</span><strong>{money(totales.monto)}</strong></div>
      {totales.porRevisar > 0 && <div className="jornada-semana-fila aviso"><span>Por revisar con la administración</span><strong>{money(totales.porRevisar)}</strong></div>}
      {totales.pagado > 0 && <div className="jornada-semana-fila"><span>Ya pagado</span><strong>{money(totales.pagado)}</strong></div>}
    </div>
  );
}

// "¿Terminaste tu turno?" — sustituye al "¿Cerrar la sesión?" para quien se paga por hora.
// Sí → cierra la jornada y muestra cuánto cobraría; No → cierra sesión SIN cerrar la jornada.
export function SalidaSheet({ jornada, onLogout, onClose }) {
  const { estado, recibidoEn, cargar } = jornada;
  const [fase, setFase] = useState('pregunta'); // pregunta | resumen
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');
  const [busy, terminar] = useAccionUnica(async () => {
    setError('');
    try { setResultado(await api.terminarJornada()); setFase('resumen'); cargar(); }
    catch (e) { setError(e.message); }
  });
  const vivo = estado?.jornada ? vivoDe(estado, Date.now(), recibidoEn) : null;
  const hoy = estado?.resumen?.deHoy;

  if (fase === 'resumen' && resultado) {
    const { jornada: j, resumen } = resultado;
    return (
      <Sheet title="Turno terminado" closable={false}>
        <div className="jornada-resumen-grande">
          <div className="jornada-resumen-etiqueta">Cobrarías por este turno</div>
          <div className="jornada-resumen-monto">{money(j.monto)}</div>
          <div className="jornada-resumen-detalle">
            {formatDuracion(j.minutosPagables)} trabajados{j.minutosPausa > 0 ? ` · ${formatDuracion(j.minutosPausa)} de pausa (no se paga)` : ''}
            <br />{horaCorta(j.entrada)} a {horaCorta(j.salida)} · {money(j.tarifaHora)} por hora
          </div>
        </div>
        {j.estado === 'por_revisar' && <div className="jornada-semana-fila aviso" style={{ marginBottom: 10 }}><span>{j.motivoRevision} La administración lo revisará antes de pagarlo.</span></div>}
        <div className="jornada-semana">
          <div className="jornada-semana-fila"><span>Hoy en total</span><strong>{money(resumen.deHoy.monto)}</strong></div>
        </div>
        <ResumenSemana totales={resumen.totales} />
        <button className="btn-primary full" onClick={onLogout}>Cerrar sesión</button>
      </Sheet>
    );
  }

  const sinJornada = !estado?.jornada;
  return (
    <Sheet title={sinJornada ? 'Cerrar sesión' : '¿Terminaste tu turno?'} onClose={onClose}>
      {sinJornada ? (
        <p>No tienes un turno en curso{estado?.pendientesRevision ? '; hay un turno anterior que la administración debe revisar' : ''}.</p>
      ) : (
        <>
          <div className="jornada-resumen-grande compacto">
            <div className="jornada-resumen-etiqueta">Llevas en este turno</div>
            <div className="jornada-resumen-monto">{money(vivo.monto)}</div>
            <div className="jornada-resumen-detalle">{formatDuracion(vivo.minutos)} trabajados{estado.enPausa ? ' · estás en pausa' : ''}{hoy ? ` · hoy en total ${money(hoy.monto)}` : ''}</div>
          </div>
          <p className="field-hint" style={{ marginBottom: 12 }}>
            <strong>Sí</strong> cierra tu turno y deja de contar tus horas. <strong>No</strong> solo cierra la sesión: tu turno sigue contando hasta que lo termines.
          </p>
        </>
      )}
      <FormError>{error}</FormError>
      <div className="jornada-botones">
        {!sinJornada && <button className="btn-primary full" disabled={busy} onClick={terminar}>{busy ? 'Guardando…' : 'Sí, terminé mi turno'}</button>}
        <button className={sinJornada ? 'btn-primary full' : 'btn-secondary full'} disabled={busy} onClick={onLogout}>{sinJornada ? 'Cerrar sesión' : 'No, solo cerrar sesión'}</button>
        <button className="btn-ghost full" disabled={busy} onClick={onClose}>Cancelar</button>
      </div>
    </Sheet>
  );
}

function JornadaFila({ j }) {
  return (
    <div className="mis-horas-fila">
      <div>
        <div className="mis-horas-horario">
          {horaCorta(j.entrada)} – {j.enCurso ? 'en curso' : (j.salida ? horaCorta(j.salida) : 'sin salida')}
        </div>
        <div className="mis-horas-detalle">
          {formatDuracion(j.minutosPagables || 0)}{j.minutosPausa ? ` · pausa ${formatDuracion(j.minutosPausa)}` : ''}{j.manual ? ' · capturada por la administración' : ''}
        </div>
        {j.estado === 'por_revisar' && j.motivoRevision && <div className="mis-horas-detalle aviso">{j.motivoRevision}</div>}
      </div>
      <div className="mis-horas-monto">
        <strong>{j.monto === null || j.monto === undefined ? '—' : money(j.monto)}</strong>
        <span className={`jornada-estado ${j.estado}`}>{ESTADO_LABELS[j.estado] || j.estado}</span>
      </div>
    </div>
  );
}

// "Mis horas": la semana (domingo a sábado) con lo de cada día y lo acumulado antes del pago.
export function MisHorasSheet({ onClose }) {
  const [fecha, setFecha] = useState(null);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let vigente = true;
    setError('');
    api.getMisHoras(fecha).then(d => { if (vigente) setDatos(d); }).catch(e => { if (vigente) setError(e.message); });
    return () => { vigente = false; };
  }, [fecha]);
  const semana = datos?.semana;
  const esActual = datos && semana && datos.hoy >= semana.desde && datos.hoy <= semana.hasta;
  return (
    <Sheet title="Mis horas" onClose={onClose}>
      <FormError>{error}</FormError>
      {!datos && !error && <p className="field-hint">Cargando…</p>}
      {datos && datos.aplica === false && <p>Tu usuario no registra horas.</p>}
      {datos && semana && (
        <>
          <div className="mis-horas-nav">
            <button className="icon-btn" aria-label="Semana anterior" onClick={() => setFecha(sumarDias(semana.desde, -1))}><ChevronLeft size={18} /></button>
            <div className="mis-horas-semana">{rangoSemana(semana)}{esActual ? ' · esta semana' : ''}</div>
            <button className="icon-btn" aria-label="Semana siguiente" disabled={esActual} onClick={() => setFecha(sumarDias(semana.hasta, 1))}><ChevronRight size={18} /></button>
          </div>
          <ResumenSemana totales={datos.totales} />
          <div className="mis-horas-lista">
            {datos.dias.filter(d => d.jornadas.length).map(d => (
              <div key={d.fecha} className="mis-horas-dia">
                <div className="mis-horas-dia-cab"><span>{diaCorto(d.fecha)}{d.fecha === datos.hoy ? ' · hoy' : ''}</span><strong>{money(d.monto)}</strong></div>
                {d.jornadas.map(j => <JornadaFila key={j.id} j={j} />)}
              </div>
            ))}
            {!datos.dias.some(d => d.jornadas.length) && <p className="field-hint">Todavía no hay horas registradas en esta semana.</p>}
          </div>
          {!esActual && <button className="btn-ghost full" onClick={() => setFecha(semanaDomingo(datos.hoy).desde)}>Ir a esta semana</button>}
        </>
      )}
    </Sheet>
  );
}
