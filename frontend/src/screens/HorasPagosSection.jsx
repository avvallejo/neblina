// HORAS Y PAGOS (Admin): las jornadas del personal que se paga por hora.
//   * Semana de domingo a sábado, una tarjeta por persona con lo trabajado y lo por pagar.
//   * Jornadas "por revisar" (se quedó abierta o la pausa fue larguísima) y "en curso".
//   * Corregir / aprobar / anular una jornada (siempre con motivo; queda en auditoría).
//   * Registrar el pago: crea el egreso en "Sueldos y salarios" y sale de Caja en efectivo.
//     No pasa por el corte de caja: se puede pagar en cualquier semana del mes.
//   * Bitácora de pagos.
// "Turno" es el turno de CAJA; aquí hablamos de la jornada de trabajo de una persona.
import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Ban, HandCoins, AlertTriangle, Clock } from 'lucide-react';
import * as api from '../api/client.js';
import { money } from '../lib/helpers.js';
import { Sheet, EmptyState, FormError, useAccionUnica } from '../components/ui.jsx';
import { formatDuracion, formatHora, diaCorto, rangoSemana, sumarDias, semanaDomingo, aInputLocal, ESTADO_LABELS } from '../lib/jornada.js';

const hora = iso => formatHora(iso);
const fmtFecha = f => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '');

/* ---------- Corregir / aprobar una jornada ---------- */
function CorregirSheet({ jornada, onClose, onDone, addToast }) {
  const [entrada, setEntrada] = useState(aInputLocal(jornada.entrada));
  const [salida, setSalida] = useState(aInputLocal(jornada.salida));
  const [pausa, setPausa] = useState(String(jornada.minutosPausa || 0));
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [busy, guardar] = useAccionUnica(async () => {
    setError('');
    if (!motivo.trim()) { setError('Escribe el motivo de la corrección.'); return; }
    const body = { entrada, motivo: motivo.trim(), minutosPausa: Number(pausa || 0) };
    body.salida = salida || null;
    try { await api.corregirJornada(jornada.id, body); addToast('Jornada corregida', 'success'); onDone(); onClose(); }
    catch (e) { setError(e.message); }
  });
  return (
    <Sheet title={jornada.estado === 'por_revisar' ? 'Revisar jornada' : 'Corregir jornada'} onClose={onClose}>
      <p className="field-hint" style={{ marginBottom: 10 }}>
        {jornada.usuarioNombre}{jornada.motivoRevision ? ` — ${jornada.motivoRevision}` : ''}
        {!jornada.salida ? ' Indica la hora real de salida para poder pagarla.' : ''}
      </p>
      <div className="option-group"><div className="option-label">Entrada</div>
        <input type="datetime-local" className="text-input" value={entrada} onChange={e => setEntrada(e.target.value)} /></div>
      <div className="option-group"><div className="option-label">Salida</div>
        <input type="datetime-local" className="text-input" value={salida} onChange={e => setSalida(e.target.value)} /></div>
      <div className="option-group"><div className="option-label">Minutos de pausa (no se pagan)</div>
        <input className="text-input" inputMode="numeric" value={pausa} onChange={e => setPausa(e.target.value.replace(/\D/g, '').slice(0, 4))} /></div>
      <div className="option-group"><div className="option-label">Motivo</div>
        <input className="text-input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej. Se le olvidó cerrar su turno; salió a las 5 pm" /></div>
      <FormError>{error}</FormError>
      <div className="sheet-footer"><span /><button className="btn-primary" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </Sheet>
  );
}

/* ---------- Jornada capturada a mano ---------- */
function ManualSheet({ personas, onClose, onDone, addToast }) {
  const [usuarioId, setUsuarioId] = useState(personas[0]?.id || '');
  const [entrada, setEntrada] = useState('');
  const [salida, setSalida] = useState('');
  const [pausa, setPausa] = useState('0');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [busy, guardar] = useAccionUnica(async () => {
    setError('');
    if (!usuarioId) { setError('Elige a la persona.'); return; }
    if (!entrada || !salida) { setError('Indica la entrada y la salida.'); return; }
    if (!motivo.trim()) { setError('Escribe el motivo.'); return; }
    try { await api.crearJornadaManual({ usuarioId, entrada, salida, minutosPausa: Number(pausa || 0), motivo: motivo.trim() }); addToast('Jornada registrada', 'success'); onDone(); onClose(); }
    catch (e) { setError(e.message); }
  });
  return (
    <Sheet title="Registrar jornada" onClose={onClose}>
      <p className="field-hint" style={{ marginBottom: 10 }}>Para un día que no se registró solo (por ejemplo, no pudo entrar con su PIN).</p>
      <div className="option-group"><div className="option-label">Persona</div>
        <select className="text-input" value={usuarioId} onChange={e => setUsuarioId(e.target.value)}>
          {personas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select></div>
      <div className="option-group"><div className="option-label">Entrada</div>
        <input type="datetime-local" className="text-input" value={entrada} onChange={e => setEntrada(e.target.value)} /></div>
      <div className="option-group"><div className="option-label">Salida</div>
        <input type="datetime-local" className="text-input" value={salida} onChange={e => setSalida(e.target.value)} /></div>
      <div className="option-group"><div className="option-label">Minutos de pausa (no se pagan)</div>
        <input className="text-input" inputMode="numeric" value={pausa} onChange={e => setPausa(e.target.value.replace(/\D/g, '').slice(0, 4))} /></div>
      <div className="option-group"><div className="option-label">Motivo</div>
        <input className="text-input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej. Se cayó el sistema" /></div>
      <FormError>{error}</FormError>
      <div className="sheet-footer"><span /><button className="btn-primary" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Registrar jornada'}</button></div>
    </Sheet>
  );
}

/* ---------- Anular una jornada ---------- */
function AnularSheet({ jornada, onClose, onDone, addToast }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [busy, anular] = useAccionUnica(async () => {
    setError('');
    if (!motivo.trim()) { setError('Escribe el motivo.'); return; }
    try { await api.anularJornada(jornada.id, motivo.trim()); addToast('Jornada anulada', 'success'); onDone(); onClose(); }
    catch (e) { setError(e.message); }
  });
  return (
    <Sheet title="Anular jornada" onClose={onClose}>
      <p className="field-hint" style={{ marginBottom: 10 }}>
        {jornada.usuarioNombre} · {diaCorto(jornada.fecha)} · {hora(jornada.entrada)}. Una jornada anulada no se paga ni cuenta en la semana; queda el registro en auditoría.
      </p>
      <div className="option-group"><div className="option-label">Motivo</div>
        <input className="text-input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej. Entró por error" /></div>
      <FormError>{error}</FormError>
      <div className="sheet-footer"><span /><button className="btn-danger" disabled={busy} onClick={anular}>{busy ? 'Anulando…' : 'Anular jornada'}</button></div>
    </Sheet>
  );
}

/* ---------- Registrar el pago de la semana de una persona ---------- */
function PagoSheet({ persona, semana, hoy, onClose, onDone, addToast }) {
  const [fecha, setFecha] = useState(hoy);
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [busy, pagar] = useAccionUnica(async () => {
    setError('');
    try { await api.pagarHoras({ usuarioId: persona.id, semana: semana.desde, fecha, nota: nota.trim() || undefined }); addToast(`Pago registrado: ${money(persona.totales.porPagar)}`, 'success'); onDone(); onClose(); }
    catch (e) { setError(e.message); }
  });
  return (
    <Sheet title="Registrar pago de horas" onClose={onClose}>
      <div className="jornada-resumen-grande">
        <div className="jornada-resumen-etiqueta">{persona.nombre} · semana {rangoSemana(semana)}</div>
        <div className="jornada-resumen-monto">{money(persona.totales.porPagar)}</div>
        <div className="jornada-resumen-detalle">{formatDuracion(persona.totales.minutos)} trabajadas · {money(persona.tarifaHora || 0)} por hora</div>
      </div>
      <p className="field-hint" style={{ marginBottom: 10 }}>Sale de Caja en efectivo y se registra como egreso en <strong>Sueldos y salarios</strong>. No afecta el corte de caja.</p>
      <div className="option-group"><div className="option-label">Fecha del pago</div>
        <input type="date" className="text-input" value={fecha} max={hoy} onChange={e => setFecha(e.target.value)} /></div>
      <div className="option-group"><div className="option-label">Nota (opcional)</div>
        <input className="text-input" value={nota} onChange={e => setNota(e.target.value)} /></div>
      <FormError>{error}</FormError>
      <div className="sheet-footer"><span /><button className="btn-primary" disabled={busy || !fecha} onClick={pagar}>{busy ? 'Registrando…' : `Pagar ${money(persona.totales.porPagar)}`}</button></div>
    </Sheet>
  );
}

function JornadaLinea({ j, onCorregir, onAnular }) {
  const editable = j.estado !== 'pagada' && j.estado !== 'anulada';
  return (
    <div className="mis-horas-fila">
      <div>
        <div className="mis-horas-horario">{hora(j.entrada)} – {j.estado === 'abierta' ? 'en curso' : (j.salida ? hora(j.salida) : 'sin salida')}</div>
        <div className="mis-horas-detalle">
          {formatDuracion(j.minutosPagables || 0)}{j.minutosPausa ? ` · pausa ${formatDuracion(j.minutosPausa)}` : ''}{j.manual ? ' · manual' : ''}
        </div>
        {j.motivoRevision && <div className="mis-horas-detalle aviso">{j.motivoRevision}</div>}
      </div>
      <div className="mis-horas-monto">
        <strong>{j.monto == null ? '—' : money(j.monto)}</strong>
        <span className={`jornada-estado ${j.estado}`}>{ESTADO_LABELS[j.estado] || j.estado}</span>
        {editable && (
          <span className="horas-acciones">
            <button className="icon-btn small" aria-label="Corregir jornada" onClick={() => onCorregir(j)}><Pencil size={13} /></button>
            <button className="icon-btn small" aria-label="Anular jornada" onClick={() => onAnular(j)}><Ban size={13} /></button>
          </span>
        )}
      </div>
    </div>
  );
}

export default function HorasPagosSection({ addToast }) {
  const [fecha, setFecha] = useState(null);
  const [datos, setDatos] = useState(null);
  const [pagos, setPagos] = useState([]);
  const [error, setError] = useState('');
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [anulando, setAnulando] = useState(null);
  const [pagando, setPagando] = useState(null);
  const [manual, setManual] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([api.getHorasSemana(fecha), api.getPagosHoras()]);
      setDatos(d); setPagos(p); setError('');
    } catch (e) { setError(e.message); }
  }, [fecha]);
  useEffect(() => { cargar(); }, [cargar]);
  // El reloj de quien está trabajando avanza: se refresca cada minuto.
  useEffect(() => { const t = setInterval(cargar, 60000); return () => clearInterval(t); }, [cargar]);

  if (error && !datos) return <EmptyState icon={AlertTriangle} title="No se pudieron cargar las horas" subtitle={error} />;
  if (!datos) return <p className="field-hint">Cargando…</p>;

  const { semana, personas, porRevisar, enCurso, hoy } = datos;
  const esActual = hoy >= semana.desde && hoy <= semana.hasta;
  const quienesPagan = personas.filter(p => p.pagaPorHora && p.activo);
  const totalPorPagar = personas.reduce((s, p) => s + (p.totales.porPagar || 0), 0);

  return (
    <>
      <div className="mis-horas-nav" style={{ marginBottom: 12 }}>
        <button className="icon-btn" aria-label="Semana anterior" onClick={() => setFecha(sumarDias(semana.desde, -1))}><ChevronLeft size={18} /></button>
        <div className="mis-horas-semana">{rangoSemana(semana)}{esActual ? ' · esta semana' : ''}</div>
        <button className="icon-btn" aria-label="Semana siguiente" disabled={esActual} onClick={() => setFecha(sumarDias(semana.hasta, 1))}><ChevronRight size={18} /></button>
      </div>
      {!esActual && <button className="btn-ghost small" style={{ marginBottom: 8 }} onClick={() => setFecha(semanaDomingo(hoy).desde)}>Ir a esta semana</button>}
      <FormError>{error}</FormError>

      <div className="jornada-semana" style={{ marginBottom: 14 }}>
        <div className="jornada-semana-fila principal"><span>Por pagar esta semana</span><strong>{money(totalPorPagar)}</strong></div>
      </div>

      {porRevisar.length > 0 && (
        <div className="horas-bloque aviso">
          <div className="section-title"><AlertTriangle size={14} /> Por revisar ({porRevisar.length})</div>
          <p className="field-hint">No se pueden pagar hasta que indiques la hora correcta o las apruebes.</p>
          {porRevisar.map(j => (
            <div key={j.id} className="list-row">
              <div className="list-row-main"><div>
                <div className="list-row-title">{j.usuarioNombre}</div>
                <div className="list-row-sub">{diaCorto(j.fecha)} · entró {hora(j.entrada)}{j.salida ? ` · salió ${hora(j.salida)}` : ' · sin salida'}</div>
                <div className="mis-horas-detalle aviso">{j.motivoRevision}</div>
              </div></div>
              <div className="list-row-actions">
                <button className="btn-secondary" onClick={() => setCorrigiendo(j)}>Revisar</button>
                <button className="icon-btn small" aria-label="Anular jornada" onClick={() => setAnulando(j)}><Ban size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {enCurso.length > 0 && (
        <div className="horas-bloque">
          <div className="section-title"><Clock size={14} /> Trabajando ahora ({enCurso.length})</div>
          {enCurso.map(j => (
            <div key={j.id} className="list-row">
              <div className="list-row-main"><div>
                <div className="list-row-title">{j.usuarioNombre}{j.pausaDesde ? ' · en pausa' : ''}</div>
                <div className="list-row-sub">Entró {diaCorto(j.fecha)} a las {hora(j.entrada)}</div>
              </div></div>
              <div className="list-row-actions"><button className="icon-btn small" aria-label="Corregir jornada" onClick={() => setCorrigiendo(j)}><Pencil size={14} /></button></div>
            </div>
          ))}
        </div>
      )}

      {personas.length === 0 && <EmptyState icon={Clock} title="Nadie se paga por hora todavía" subtitle="En Personal, edita a la persona y activa “Se paga por hora” con su tarifa." />}

      {personas.map(p => {
        const dias = p.dias.filter(d => d.jornadas.length);
        const puedePagar = p.totales.porPagar > 0 && p.pendientes === 0;
        return (
          <div key={p.id} className="horas-persona">
            <div className="horas-persona-cab">
              <div>
                <div className="list-row-title">{p.nombre}{!p.activo ? ' (inactivo)' : ''}</div>
                <div className="list-row-sub">{p.pagaPorHora ? `${money(p.tarifaHora || 0)} por hora` : 'Ya no se paga por hora'} · {formatDuracion(p.totales.minutos)} en la semana</div>
              </div>
              <div className="horas-persona-monto">
                <strong>{money(p.totales.monto)}</strong>
                {p.totales.pagado > 0 && <span className="mis-horas-detalle">pagado {money(p.totales.pagado)}</span>}
              </div>
            </div>
            {dias.length === 0 && <div className="mis-horas-detalle">Sin horas registradas en esta semana.</div>}
            {dias.map(d => (
              <div key={d.fecha} className="mis-horas-dia">
                <div className="mis-horas-dia-cab"><span>{diaCorto(d.fecha)}</span><strong>{money(d.monto)}</strong></div>
                {d.jornadas.map(j => <JornadaLinea key={j.id} j={{ ...j, usuarioNombre: p.nombre }} onCorregir={setCorrigiendo} onAnular={setAnulando} />)}
              </div>
            ))}
            {p.pendientes > 0 && <div className="mis-horas-detalle aviso">Hay {p.pendientes} jornada(s) abierta(s) o por revisar: resuélvelas antes de pagar.</div>}
            {p.totales.porPagar > 0 && (
              <button className="btn-primary full" style={{ marginTop: 8 }} disabled={!puedePagar} onClick={() => setPagando(p)}>
                <HandCoins size={16} /> Registrar pago · {money(p.totales.porPagar)}
              </button>
            )}
          </div>
        );
      })}

      {quienesPagan.length > 0 && <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setManual(true)}><Plus size={15} /> Registrar jornada manual</button>}

      <div className="section-title" style={{ marginTop: 22 }}>Bitácora de pagos</div>
      {pagos.length === 0 && <p className="field-hint">Aún no se ha registrado ningún pago de horas.</p>}
      {pagos.map(p => (
        <div key={p.id} className="list-row">
          <div className="list-row-main"><div>
            <div className="list-row-title">{p.usuarioNombre} · {money(p.monto)}{p.anulado ? ' · ANULADO' : ''}</div>
            <div className="list-row-sub">Semana {rangoSemana({ desde: p.semanaDesde, hasta: p.semanaHasta })} · {formatDuracion(p.minutos)} · pagado el {fmtFecha(p.fecha)}{p.cuentaDinero ? ` desde ${p.cuentaDinero}` : ''}{p.folio ? ` · egreso ${p.folio}` : ''}</div>
          </div></div>
        </div>
      ))}
      <p className="field-hint" style={{ marginTop: 6 }}>Para anular un pago, anula su egreso en Contabilidad: las horas vuelven a quedar por pagar.</p>

      {corrigiendo && <CorregirSheet jornada={corrigiendo} addToast={addToast} onClose={() => setCorrigiendo(null)} onDone={cargar} />}
      {anulando && <AnularSheet jornada={anulando} addToast={addToast} onClose={() => setAnulando(null)} onDone={cargar} />}
      {pagando && <PagoSheet persona={pagando} semana={semana} hoy={hoy} addToast={addToast} onClose={() => setPagando(null)} onDone={cargar} />}
      {manual && <ManualSheet personas={quienesPagan} addToast={addToast} onClose={() => setManual(false)} onDone={cargar} />}
    </>
  );
}
