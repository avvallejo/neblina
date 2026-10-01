import React, { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, History, ArrowLeft, ArrowRight, Info, Lock } from 'lucide-react';
import * as api from '../api/client.js';
import { money, unidadDisplay } from '../lib/helpers.js';
import { Sheet, FormError, useAccionUnica } from './ui.jsx';
import './StockAdjustments.css';

export const stockToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
const monthName = date => new Date(`${date.slice(0,7)}-15T12:00:00Z`).toLocaleDateString('es-MX', { month:'long', year:'numeric', timeZone:'America/Mexico_City' });
const displayDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('es-MX', { day:'numeric',month:'short',year:'numeric',timeZone:'America/Mexico_City' });
const captureDate = date => new Date(date).toLocaleString('es-MX', { dateStyle:'medium',timeStyle:'short',timeZone:'America/Mexico_City' });
const qty = n => Number(n).toLocaleString('es-MX',{maximumFractionDigits:3});

export function AdjustmentDateField({ value, onChange, disabled = false }) {
  const today = stockToday();
  const [year,month] = today.split('-').map(Number);
  const previousClose = new Date(Date.UTC(year,month-1,0,12)).toISOString().slice(0,10);
  return <div className="stock-accounting-date">
    <label><span><CalendarDays size={17}/> Fecha contable del ajuste</span>
      <input type="date" value={value} max={today} disabled={disabled} onChange={e => onChange(e.target.value)} required/>
    </label>
    <div className="stock-date-shortcuts">
      <button type="button" disabled={disabled} onClick={() => onChange(today)}>Hoy</button>
      <button type="button" disabled={disabled} onClick={() => onChange(previousClose)}>Cierre anterior · {displayDate(previousClose)}</button>
    </div>
    <p>El costo corresponde a <strong>{value ? monthName(value) : 'la fecha que elijas'}</strong>. La fecha real de captura se conserva.</p>
  </div>;
}

export default function StockAdjustments({ materias, onClose, onChanged }) {
  const [period, setPeriod] = useState(stockToday().slice(0,7));
  const [basis, setBasis] = useState('captura');
  const [material, setMaterial] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [motive, setMotive] = useState('');
  const [saved, setSaved] = useState(false);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    api.getAjustesInventario({periodo:period,por:basis,insumo:material,offset}).then(r => { if (alive) setData(r); })
      .catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period,basis,material,offset,revision]);
  const open = async a => {
    setError(''); setOpening(true);
    try {
      const d = await api.getAjusteInventario(a.id);
      setSelected(d); setDate(d.fecha_contable); setMotive(d.motivo); setReason(''); setSaved(false);
    } catch(e) { setError(e.message); } finally { setOpening(false); }
  };
  const [busy, save] = useAccionUnica(async () => {
    setError('');
    try {
      const result = await api.corregirAjusteInventario(selected.id, {fechaContable:date,motivo:motive,razonCambio:reason,version:selected.version});
      setSelected(result); setSaved(true); setRevision(r => r+1); onChanged?.();
    } catch(e) { setError(e.message); }
  });
  const back = () => { setSelected(null); setError(''); };
  return <Sheet title={selected ? 'Detalle del ajuste' : 'Historial de ajustes'} className="stock-history-sheet" onClose={onClose} closable={!busy && !opening}>
    {selected ? <>
      <button type="button" className="btn-ghost stock-back" disabled={busy} onClick={back}><ArrowLeft size={16}/> Volver al historial</button>
      <div className="stock-adjustment-heading"><span>{selected.folio}</span><h4>{selected.insumo}</h4><p>Capturado el {captureDate(selected.creado_en)} · {selected.usuario || 'Usuario no registrado'}</p></div>
      <div className="stock-adjustment-totals">
        <div><span>Cambio de existencias</span><strong>{selected.diferencia > 0 ? '+' : ''}{qty(selected.diferencia)} {unidadDisplay(selected.unidad)}</strong>
          <small>{selected.cantidad_anterior === null ? 'Registro anterior: conserva la diferencia original.' : `${qty(selected.cantidad_anterior)} → ${qty(selected.cantidad_contada)} ${unidadDisplay(selected.unidad)}`}</small></div>
        <div><span>Efecto en costo de ventas</span><strong>{selected.costo < 0 ? '− ' : '+ '}{money(Math.abs(selected.costo))}</strong><small>{monthName(selected.fecha_contable)}</small></div>
      </div>
      {saved ? <div className="stock-adjustment-success" role="status"><CheckCircle2 size={25}/><div><strong>Corrección guardada</strong><p>El ajuste corresponde al {displayDate(selected.fecha_contable)}. Las existencias y los lotes no se movieron de nuevo.</p></div></div> : <>
        <div className="stock-adjustment-notice"><Info size={18}/><p>Aquí corriges la fecha contable y el motivo. La cantidad original se conserva. Si la cantidad está equivocada, vuelve a <strong>Inventario → Ajustar</strong> y registra un nuevo conteo con el motivo de la corrección.</p></div>
        {selected.cerrado && <div className="stock-adjustment-notice"><Lock size={18}/><p>El mes de este ajuste está cerrado. Reábrelo en Contabilidad antes de corregirlo; el mes de destino también debe estar abierto.</p></div>}
        <AdjustmentDateField value={date} onChange={setDate} disabled={busy || selected.cerrado}/>
        <label className="stock-adjustment-field">Motivo del ajuste<textarea value={motive} maxLength={500} disabled={busy || selected.cerrado} onChange={e => setMotive(e.target.value)}/></label>
        <label className="stock-adjustment-field">¿Por qué lo corriges?<textarea value={reason} maxLength={500} disabled={busy || selected.cerrado} onChange={e => setReason(e.target.value)} placeholder="Ej. El conteo corresponde al cierre del 30 de septiembre."/></label>
        <p className="stock-adjustment-hint">Cambiar el mes traslada el mismo costo; no registra otra salida de inventario. Si el consumo ya fue costeado en “Revisar costos”, necesita conciliación para evitar contarlo dos veces.</p>
      </>}
      <FormError>{error}</FormError>
      {!saved && <button type="button" className="btn-primary full" disabled={busy || selected.cerrado || !date || !motive.trim() || reason.trim().length < 5 || (date === selected.fecha_contable && motive === selected.motivo)} onClick={save}>{busy ? 'Guardando corrección…' : 'Guardar fecha y motivo'}</button>}
      {!!selected.cambios.length && <details className="stock-corrections"><summary><History size={16}/> Historial de correcciones</summary>{selected.cambios.map((c,i) => <div key={i}><strong>{c.usuario || 'Administrador'} · {captureDate(c.creado_en)}</strong><p>{c.motivo}</p><small>{displayDate(c.valor_anterior.fechaContable)} → {displayDate(c.valor_nuevo.fechaContable)}</small></div>)}</details>}
    </> : <>
      <p className="stock-adjustment-intro">Consulta tus conteos y corrige el mes al que corresponde su costo. También aparecen los ajustes registrados antes de esta actualización.</p>
      <div className="stock-history-filters">
        <label>Buscar por<select value={basis} onChange={e => {setBasis(e.target.value);setOffset(0);}}><option value="captura">Mes de captura</option><option value="contable">Mes contable</option></select></label>
        <label>Mes<input type="month" max={stockToday().slice(0,7)} value={period} onChange={e => {if(e.target.value) {setPeriod(e.target.value);setOffset(0);}}}/></label>
        <label>Insumo<select value={material} onChange={e => {setMaterial(e.target.value);setOffset(0);}}><option value="">Todos los insumos</option>{materias.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></label>
      </div>
      <FormError>{error}</FormError>
      {loading ? <p className="stock-history-empty" role="status">Cargando ajustes…</p> : data && <>
        <div className="stock-history-count"><strong>{data.total} ajuste(s)</strong><span>{basis === 'captura' ? 'Registrados' : 'Contabilizados'} en {monthName(period)}</span></div>
        {!data.ajustes.length && <p className="stock-history-empty">No hay ajustes para estos filtros.</p>}
        <div className="stock-adjustment-list">{data.ajustes.map(a => <article key={a.id}>
          <div className="stock-adjustment-row-heading"><strong>{a.insumo}</strong><span>{a.folio}</span></div>
          <p>{a.motivo}</p>
          <div className="stock-adjustment-row-values"><span>{a.diferencia > 0 ? '+' : ''}{qty(a.diferencia)} {unidadDisplay(a.unidad)}</span><span>{a.costo < 0 ? '− ' : '+ '}{money(Math.abs(a.costo))} de costo</span></div>
          <div className="stock-adjustment-row-footer"><div><span className="stock-date-badge"><CalendarDays size={13}/>{displayDate(a.fecha_contable)}{a.cerrado && <Lock size={12}/>}</span><small>Captura: {captureDate(a.creado_en)} · {a.usuario || 'Sin usuario'}</small></div><button type="button" className="btn-secondary" disabled={opening} onClick={() => open(a)}>Ver / corregir <ArrowRight size={14}/></button></div>
        </article>)}</div>
        {data.total > 50 && <div className="stock-history-pages"><button type="button" className="btn-secondary" disabled={!offset} onClick={() => setOffset(v=>Math.max(0,v-50))}>Anterior</button><span>{offset+1}–{Math.min(offset+50,data.total)}</span><button type="button" className="btn-secondary" disabled={offset+50>=data.total} onClick={() => setOffset(v=>v+50)}>Siguiente</button></div>}
      </>}
    </>}
  </Sheet>;
}
