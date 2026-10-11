import './MermasSection.css';
import React, { useEffect, useState } from 'react';
import * as api from '../api/client.js';
import { MERMA_MOTIVOS } from '../lib/catalog.js';
import { unidadDisplay } from '../lib/helpers.js';
import { FormError, useAccionUnica } from '../components/ui.jsx';
import { stockToday } from '../components/StockAdjustments.jsx';

export default function MermasSection({ materias, onChanged }) {
  const [materiaId, setMateriaId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [fecha, setFecha] = useState(stockToday);
  const [motivo, setMotivo] = useState(MERMA_MOTIVOS[0]);
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [rows, setRows] = useState([]);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const materia = materias.find(m => m.id === materiaId);
  useEffect(() => {
    let active = true;
    setLoading(true); setHistoryError('');
    api.getMermas({ desde, hasta }).then(data => { if (active) setRows(data); })
      .catch(e => { if (active) setHistoryError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [desde, hasta, revision]);
  const [busy, guardar] = useAccionUnica(async () => {
    setError(''); setMensaje('');
    try {
      await api.crearMerma({ materiaPrimaId: materia.id, cantidad: Number(cantidad), unidad: materia.unidad,
        motivo, observacion: nota.trim() || undefined, fechaContable: fecha });
    } catch (e) { setError(e.message); return; }
    setMensaje(`Merma registrada para el ${fecha}: ${cantidad} ${unidadDisplay(materia.unidad)} de ${materia.nombre}. Inventario descontado.`);
    setCantidad(''); setNota(''); setRevision(r => r + 1);
    try { await onChanged(); } catch { setError('La merma se guardó, pero no se pudo actualizar el inventario en pantalla. Recarga la página.'); }
  });
  return <>
    <form className="mermas-form" onSubmit={e => { e.preventDefault(); guardar(); }}>
      <h2>Registrar merma</h2>
      <p>Registra un insumo por vez, sin necesidad de una comanda. Para pérdidas de meses anteriores, elige la fecha en que ocurrieron.</p>
      <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
        <label className="mermas-field">Insumo afectado
          <select className="text-input" required value={materiaId} onChange={e => setMateriaId(e.target.value)}>
            <option value="">Selecciona un insumo</option>
            {materias.map(m => <option key={m.id} value={m.id}>{m.nombre}{m.activo ? '' : ' (inactivo)'}</option>)}
          </select>
        </label>
        <label className="mermas-field">Cantidad {materia && `(${unidadDisplay(materia.unidad)})`}
          <input className="text-input" required type="number" min="0.001" step="0.001" value={cantidad} onChange={e => setCantidad(e.target.value)} />
        </label>
        <label className="mermas-field">Fecha de la merma
          <input className="text-input" required type="date" max={stockToday()} value={fecha} onChange={e => setFecha(e.target.value)} />
        </label>
        <label className="mermas-field">Motivo
          <select className="text-input" value={motivo} onChange={e => setMotivo(e.target.value)}>
            {MERMA_MOTIVOS.map(m => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="mermas-field">Observación {motivo === 'Otro' ? '(obligatoria)' : '(opcional)'}
          <textarea className="text-input" required={motivo === 'Otro'} maxLength={1000} value={nota} onChange={e => setNota(e.target.value)} />
        </label>
        <p className="field-hint">Se descontará del inventario actual y su costo contará en el mes seleccionado. La fecha de captura se conserva. Si ya descontaste esta pérdida mediante un ajuste, revisa ese ajuste antes de registrarla para no descontarla dos veces.</p>
        <button className="btn-danger" type="submit" disabled={!materia || !(Number(cantidad) > 0) || !fecha || (motivo === 'Otro' && !nota.trim())}>{busy ? 'Guardando…' : 'Registrar merma'}</button>
      </fieldset>
      <FormError>{error}</FormError>
      {mensaje && <p role="status">{mensaje}</p>}
    </form>
    <h2>Historial de mermas</h2>
    <div className="inv-toolbar">
      <label>Desde <input className="text-input" type="date" value={desde} onChange={e => setDesde(e.target.value)} /></label>
      <label>Hasta <input className="text-input" type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
    </div>
    <p className="field-hint">Hasta 200 registros más recientes del rango elegido, de la sucursal actual.</p>
    <FormError>{historyError}</FormError>
    {loading ? <p>Cargando historial…</p> : !historyError && <>
      {!rows.length && <p>No hay mermas registradas en este rango.</p>}
      {rows.map(r => <div className="list-row" key={r.id}>
        <div className="list-row-main"><div>
          <div className="list-row-title">{r.materia_prima} · {Number(r.cantidad).toLocaleString('es-MX')} {unidadDisplay(r.unidad)}</div>
          <div className="list-row-sub">Fecha: {r.fecha_contable} · {r.motivo} · {r.usuario}</div>
          {r.observacion && <p>{r.observacion}</p>}
          <small>Capturada: {new Date(r.creado_en).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</small>
        </div></div>
      </div>)}
    </>}
  </>;
}
