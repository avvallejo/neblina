import React, { useEffect, useState } from 'react';
import { Calculator, CheckCircle2, History, Package, RefreshCw, ArrowRight, Info, AlertTriangle } from 'lucide-react';
import * as api from '../api/client.js';
import { money } from '../lib/helpers.js';
import { Sheet, FormError, useAccionUnica } from './ui.jsx';
import './CostRegularization.css';

export default function CostRegularization({ periodo, regularizado, onChanged }) {
  const [open, setOpen] = useState(false);
  return <>
    <div className="cost-recovery-entry">
      <span className="cost-recovery-icon"><Calculator size={20} /></span>
      <div><strong>Costos de ventas anteriores</strong><p>{regularizado?.lineas
        ? `${money(regularizado.costo)} recuperados con recetas y costos actuales. Consulta el historial.`
        : '¿Ya corregiste las recetas y los insumos? Revisa qué costo falta registrar.'}</p></div>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Revisar costos <ArrowRight size={15} /></button>
    </div>
    {open && <CostRegularizationSheet key={`${api.getSucursalId()}:${periodo}`} periodo={periodo} onClose={() => setOpen(false)} onChanged={onChanged} />}
  </>;
}

export function CostRegularizationSheet({ periodo, onClose, onChanged }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(null);
  const [identity, setIdentity] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setConfirmed(false);
    api.getRegularizacionCostos(periodo).then(p => {
      if (alive) { setPlan(p); setIdentity(crypto.randomUUID()); }
    }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [periodo, revision]);
  const [busy, save] = useAccionUnica(async () => {
    setError('');
    try {
      const saved = await api.regularizarCostos({ periodo, modo: plan.modo, huella: plan.huella, clientUuid: identity, confirmado: confirmed });
      setResult(saved);
      onChanged?.();
    } catch (e) { setError(e.message); }
  });
  const ready = plan?.lineas.filter(l => l.listo) || [];
  const pending = plan?.lineas.filter(l => !l.listo) || [];
  const groups = new Map();
  for (const line of ready) {
    const group = groups.get(line.producto) || { producto: line.producto, cantidad: 0, costo: 0, tickets: new Set(), lines: [] };
    group.cantidad += line.cantidad; group.costo += line.costo; group.tickets.add(line.pedidoId);
    group.lines.push(line); groups.set(line.producto, group);
  }
  return <Sheet title={result ? 'Costos regularizados' : 'Recuperar costos anteriores'} className="cost-recovery-sheet" onClose={onClose} closable={!busy}>
    {result ? <div className="cost-recovery-success" role="status">
      <CheckCircle2 size={46} /><h4>La corrección quedó guardada</h4>
      <p>Folio <strong>{result.folio}</strong> · {result.periodo}</p>
      <div className="cost-recovery-saved-amount"><span>Costo agregado al mes</span><strong>{money(result.costoAgregar)}</strong></div>
      <p>El inventario actual, los lotes y el dinero de Caja y Banco se conservaron.</p>
      <p>{result.productos} productos en {result.tickets} tickets. El estado de resultados ya incluye este costo estimado.</p>
      {result.pendientes > 0 && <p>{result.pendientes === 1 ? 'Queda' : 'Quedan'} {result.pendientes} {result.pendientes === 1 ? 'partida' : 'partidas'} por revisar; consulta nuevamente los pendientes.</p>}
      <button type="button" className="btn-primary" onClick={onClose}>Volver al estado de resultados</button>
    </div> : <>
      <p className="cost-recovery-intro">Completa el costo de los productos que se vendieron y terminaron sin costo registrado.</p>
      {loading ? <p className="cost-recovery-loading" role="status">Calculando el costo de tus ventas anteriores…</p> : plan && <>
        <div className="cost-recovery-heading"><span>{plan.nombre}</span><button type="button" className="btn-ghost" disabled={busy} onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} /> Actualizar vista previa</button></div>
        <div className="cost-recovery-notice"><Info size={18} /><p><strong>Estimación con tus recetas y costos actuales.</strong> Si eran distintos al vender, el costo histórico puede variar. Solo se completan partidas sin costo; los costos históricos positivos se conservan.</p></div>
        {plan.cerrado && <div className="cost-recovery-warning"><AlertTriangle size={18} /><p>Este mes está cerrado. Reábrelo desde Contabilidad para registrar la corrección.</p></div>}
        <div className="cost-recovery-summary">
          <div className="cost-recovery-main"><span>Costo por recuperar</span><strong>{money(plan.resumen.costoAgregar)}</strong><small>{plan.resumen.productos} productos · {plan.resumen.tickets} tickets</small></div>
          <div><span>Costo de ventas del mes</span><s>{money(plan.resumen.costoAntes)}</s><strong>{money(plan.resumen.costoDespues)}</strong></div>
          <div><span>Utilidad neta estimada</span><s>{money(plan.resumen.utilidadAntes)}</s><strong>{money(plan.resumen.utilidadDespues)}</strong></div>
        </div>
        <div className="cost-recovery-inventory"><Package size={21} /><div><strong>Insumos que ya se consumieron</strong><p>Se agregará su costo al mes de la venta. No necesitas registrar entradas: las existencias y los lotes de hoy se conservan. Tampoco se registra otra compra ni una salida de Caja o Banco.</p></div></div>
        {groups.size > 0 ? <div className="cost-recovery-products">
          <h4>Listos para recuperar <span>{groups.size} {groups.size === 1 ? 'producto' : 'productos'}</span></h4>
          {[...groups.values()].map(g => <details key={g.producto} className="cost-recovery-product">
            <summary><span><strong>{g.producto}</strong><small>{g.cantidad} unidades · {g.tickets.size} {g.tickets.size === 1 ? 'ticket' : 'tickets'} · Costo histórico</small></span><b>{money(g.costo)}</b></summary>
            <div className="cost-recovery-tickets">{g.lines.map(l => <div key={l.itemId}><strong>{l.folio} · {l.cantidad} u.</strong><span>{money(l.costo)}</span><ul>{l.insumos.map(i => <li key={i.id}>{i.nombre}: {i.cantidadCosteada} {i.unidad} consumidos · {money(i.costo)}</li>)}</ul></div>)}</div>
          </details>)}
        </div> : <div className="cost-recovery-empty">No hay partidas listas para recuperar en este mes.</div>}
        {pending.length > 0 && <details className="cost-recovery-pending" open={!ready.length}>
          <summary><AlertTriangle size={16} /> {pending.length} {pending.length === 1 ? 'partida requiere' : 'partidas requieren'} revisión</summary>
          <p>Estas partidas no se aplicarán. Revisa la receta, el costo o los registros indicados; no agregues existencias para desbloquearlas.</p>
          {pending.map(l => <div key={l.itemId}><strong>{l.producto} · {l.folio}</strong><ul>{l.motivos.map(m => <li key={m}>{m}</li>)}</ul></div>)}
        </details>}
        {ready.length > 0 && !plan.cerrado && <div className="cost-recovery-confirm">
          <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /><span>Estos insumos ya se consumieron. Revisé los importes y confirmé que su costo no se registró antes como ajuste de inventario o egreso de costo de ventas.</span></label>
        </div>}
      </>}
      <FormError>{error}</FormError>
      {!loading && !plan && <button type="button" className="btn-secondary" onClick={() => setRevision(v => v + 1)}>Intentar de nuevo</button>}
      {plan && !loading && ready.length > 0 && !plan.cerrado && <button type="button" className="btn-primary cost-recovery-submit" disabled={!confirmed || busy} onClick={save}>{busy ? 'Guardando regularización…' : `Registrar ${money(plan.resumen.costoAgregar)} de costo histórico`}</button>}
      {!!plan?.historial.length && <details className="cost-recovery-history"><summary><History size={16} /> Regularizaciones guardadas</summary>{plan.historial.map(h => <div key={h.id}><strong>{h.folio}</strong><b>{money(h.resumen.costoAgregar)}</b><small>{h.resumen.modo === 'solo_costo' ? 'Sin modificar inventario' : 'Con revisión de inventario'} · {h.usuario} · {new Date(h.creado_en).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })}</small></div>)}</details>}
    </>}
  </Sheet>;
}
