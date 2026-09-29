import React, { useEffect, useRef, useState } from 'react';
import { Wallet, Receipt, ArrowDownLeft, CheckCircle2, Search } from 'lucide-react';
import * as api from '../api/client';
import { money } from '../lib/helpers';
import CajaGastos from './CajaGastos';
import './corteCaja.css';

const fecha = value => new Date(value).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const importe = value => value === null ? 'Por aclarar' : money(value);

export function BuscarNotas() {
  const [q, setQ] = useState(''), [rows, setRows] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function buscar(e) {
    e.preventDefault(); setBusy(true); setError(''); setRows(null);
    try { setRows(await api.buscarNotas(q)); } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <details className="corte-busqueda">
    <summary><Search size={16}/> Buscar una nota ya registrada</summary>
    <p className="field-hint">Busca en todos los turnos de esta sucursal por folio del sistema, referencia del proveedor o concepto.</p>
    <form className="corte-toolbar" onSubmit={buscar}><label>Folio o concepto<input className="text-input" value={q} onChange={e=>setQ(e.target.value)} placeholder="N-00000001 / remisión / leche"/></label><button className="btn-secondary" disabled={busy||!q.trim()}>{busy?'Buscando…':'Buscar'}</button></form>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {rows?.length===0&&<p>No se encontraron notas con esa búsqueda.</p>}
    {rows?.map(n=><div className="corte-nota" key={n.id}><strong>{n.folio} · {money(n.monto)}</strong><span>{n.concepto} · {n.fecha}</span><small>{n.anulado?'Anulada':n.pagado?'Registrada · pagada':'Registrada · por pagar'}{n.referencia?` · Ref. ${n.referencia}`:''}{n.proveedor_nombre?` · ${n.proveedor_nombre}`:''} · Capturó: {n.usuario_nombre||'Sin identificar'}</small></div>)}
  </details>;
}

export default function CorteCaja({ addToast, currentUser, onChanged }) {
  const [turnos, setTurnos] = useState([]), [id, setId] = useState(''), [filtro, setFiltro] = useState('');
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [form, setForm] = useState({}), [revisadas, setRevisadas] = useState([]), [compras, setCompras] = useState(false);
  const request = useRef(null), locked = useRef(false);
  useEffect(()=>{
    let alive=true; setLoading(true); setData(null); setError(''); setId('');
    api.getCortes(filtro).then(rows=>{if(alive){setTurnos(rows);setId(rows[0]?.id||'');setLoading(false);}}).catch(e=>{if(alive){setError(e.message);setLoading(false);}});
    return()=>{alive=false;};
  },[filtro]);
  useEffect(()=>{
    if(!id)return undefined;
    let alive=true;setLoading(true);setData(null);setError('');setCompras(false);request.current=null;
    api.getCorte(id).then(r=>{if(alive){setData(r);setRevisadas(r.notasRevisadas||[]);setForm({entrega:r.entrega||r.turno.abierto_por_nombre||'',recibe:r.recibe||'',observaciones:r.observaciones||''});setLoading(false);}}).catch(e=>{if(alive){setError(e.message);setLoading(false);}});
    return()=>{alive=false;};
  },[id]);
  async function refresh() {
    setError('');setLoading(true);
    try { const r=await api.getCorte(id);setData(r);setRevisadas(r.notasRevisadas||[]);request.current=null; }
    catch(e){setError(e.message);}finally{setLoading(false);}
  }
  const change=(key,value)=>setForm(f=>({...f,[key]:value}));
  async function save(e) {
    e.preventDefault();if(locked.current||loading)return;
    if(!window.confirm('¿Guardar este corte? Se conservarán los importes y las notas revisadas. Si el turno está abierto, se cerrará.'))return;
    locked.current=true;setBusy(true);setError('');
    try {
      const body={revision:data.revision,entrega:form.entrega,recibe:form.recibe,efectivoEntregado:form.efectivoEntregado,fondoRetenido:form.fondoRetenido,
        transferenciasVerificadas:form.transferenciasVerificadas,tarjetaVerificada:form.tarjetaVerificada,observaciones:form.observaciones,notasRevisadas:revisadas};
      if(request.current&&JSON.stringify(request.current.body)!==JSON.stringify(body))throw new Error('Reintenta con los mismos datos o pulsa Actualizar corte para comprobar si se guardó.');
      if(!request.current)request.current={id:crypto.randomUUID(),body};
      const r=await api.guardarCorte(id,{...body,solicitudId:request.current.id});
      setData(r);request.current=null;addToast(`Corte ${r.folio} guardado`,'success');
      setTurnos(await api.getCortes(filtro));
      if(onChanged)await onChanged();
    } catch(e) { if(e.status>=400&&e.status<500)request.current=null;setError(e.message); }
    finally{locked.current=false;setBusy(false);}
  }
  const r=data?.resumen;
  const banco=r?Math.round((r.transferencias+r.tarjeta+r.mixtoBanco)*100)/100:0;
  const diferencia=data?.guardado?data.importes.diferenciaEfectivo:r?.esperado!=null&&form.efectivoEntregado!==undefined&&form.fondoRetenido!==undefined&&form.efectivoEntregado!==''&&form.fondoRetenido!==''?Math.round((Number(form.efectivoEntregado)+Number(form.fondoRetenido)-r.esperado)*100)/100:null;
  const campos=[['efectivoEntregado','Efectivo que recibiste'],['fondoRetenido','Fondo que queda en caja'],['transferenciasVerificadas','Transferencias verificadas en banco'],['tarjetaVerificada','Cobros verificados en terminal']];
  return <div className="corte-page">
    <div className="corte-intro"><Wallet size={24}/><div><h2>Corte y entrega de caja</h2><p>Revisa el dinero con la administradora y marca cada nota que te entregó.</p></div></div>
    <div className="corte-toolbar">
      <label>Fecha de apertura<input type="date" className="text-input" value={filtro} disabled={busy||loading} onChange={e=>setFiltro(e.target.value)}/></label>
      {filtro&&<button className="btn-ghost" disabled={busy} onClick={()=>setFiltro('')}>Ver últimos turnos</button>}
      <label className="corte-selector">Turno<select className="text-input" value={id} disabled={busy||loading} onChange={e=>setId(e.target.value)}>{!turnos.length&&<option value="">Sin turnos</option>}{turnos.map(t=><option key={t.id} value={t.id}>{fecha(t.abierto_en)} · {t.corte_en?'Corte guardado':t.cerrado_en?'Pendiente de corte':'Abierto'} · {t.abierto_por_nombre}</option>)}</select></label>
      {id&&<button className="btn-secondary" disabled={busy||loading} onClick={refresh}>Actualizar corte</button>}
    </div>
    <BuscarNotas/>
    {loading&&<p role="status">Cargando corte…</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {!loading&&!id&&<p>No hay turnos en esta selección. Abre un turno desde Caja para empezar.</p>}
    {data&&r&&<>
      {data.guardado&&<div className="corte-guardado"><CheckCircle2 size={22}/><div><strong>{data.folio} · Corte guardado</strong><p>{fecha(data.registradoEn)} · Registró: {data.registradoPor}</p><small>Se conservan los movimientos tal como estaban al guardar el corte.</small></div></div>}
      <div className="corte-cards">
        <article><Wallet size={18}/><span>Efectivo esperado</span><strong>{importe(r.esperado)}</strong><small>Incluye el fondo inicial</small></article>
        <article><ArrowDownLeft size={18}/><span>Transferencias</span><strong>{money(r.transferencias)}</strong><small>Cobradas en este turno</small></article>
        <article><Receipt size={18}/><span>Tarjeta</span><strong>{money(r.tarjeta)}</strong><small>Cobrada en este turno</small></article>
        <article><Receipt size={18}/><span>Notas pagadas de caja</span><strong>{money(r.salidas)}</strong><small>Ya descontadas del efectivo</small></article>
      </div>
      <p className="corte-formula">Fondo inicial <b>{importe(r.fondo)}</b> + ventas en efectivo <b>{money(r.efectivo)}</b> − notas pagadas de caja <b>{money(r.salidas)}</b> = <b>{importe(r.esperado)}</b></p>
      {r.mixtoBanco>0&&<p className="corte-aviso">Hay {money(r.mixtoBanco)} de pagos mixtos cuya parte bancaria no distingue tarjeta de transferencia. Verifica ambos importes; se comparará su suma contra {money(banco)}.</p>}
      {(r.fondo===null||r.sinDesglose>0)&&<p className="corte-aviso">{r.fondo===null?'Falta el fondo inicial. ':''}{r.sinDesglose>0?`Hay ${r.sinDesglose} pago(s) sin desglose. `:''}El corte quedará con importes por aclarar; explica el pendiente en observaciones.</p>}
      {r.notasPendientesPago>0&&<p className="corte-aviso">Compras por pagar: {money(r.notasPendientesPago)}. No se descuentan del efectivo.</p>}
      {!data.guardado&&!data.turno.cerrado_en&&<><button className="btn-secondary" disabled={busy} onClick={()=>setCompras(!compras)}>{compras?'Ocultar captura':'Registrar compra o gasto que falta'}</button>{compras&&<CajaGastos turnoId={id} addToast={addToast} onChanged={async()=>{await refresh();if(onChanged)await onChanged();}}/>}</>}
      <section className="corte-panel"><h3>Notas registradas del turno</h3><p className="field-hint">El folio N-… se escribe a mano en la nota. Marca “Revisada” cuando la hayas cotejado con el papel. Registrar una nota no significa que ya esté revisada.</p>
        {!data.notas.length&&<p>Sin notas registradas en este turno.</p>}
        {data.notas.map(n=><div key={n.id} className={`corte-nota ${n.anulado?'anulada':''}`}>
          <div className="corte-nota-top"><strong>{n.folio} · {money(n.monto)}</strong>{!n.anulado&&<label><input type="checkbox" disabled={busy||data.guardado} checked={revisadas.includes(n.id)} onChange={e=>setRevisadas(old=>e.target.checked?[...old,n.id]:old.filter(x=>x!==n.id))}/> Revisada</label>}</div>
          <span>{n.concepto}{n.proveedor_nombre?` · ${n.proveedor_nombre}`:''}</span>
          <small>{n.anulado?'Anulada · no suma':!n.pagado?'Registrada · por pagar':n.cuenta_dinero_clave==='caja'?'Registrada · pagada de caja':'Registrada · pagada fuera de caja'} · {n.tiene_comprobante===true?'Con comprobante':n.tiene_comprobante===false?'Sin comprobante':'Comprobante por confirmar'}{n.referencia?` · Ref. ${n.referencia}`:''} · Capturó: {n.usuario_nombre||'Sin identificar'}</small>
          {n.nota&&<small>{n.nota}</small>}
        </div>)}
      </section>
      {data.guardado?<section className="corte-panel"><h3>Entrega registrada</h3><p>Entregó: <b>{data.entrega}</b> · Recibió: <b>{data.recibe}</b></p>
        <dl className="corte-importes"><dt>Efectivo recibido</dt><dd>{money(data.importes.entregado)}</dd><dt>Fondo que quedó en caja</dt><dd>{money(data.importes.fondoRetenido)}</dd><dt>Transferencias verificadas</dt><dd>{money(data.importes.transferencias)}</dd><dt>Tarjeta verificada</dt><dd>{money(data.importes.tarjeta)}</dd><dt>Diferencia de efectivo</dt><dd>{importe(diferencia)}</dd><dt>Diferencia bancaria total</dt><dd>{importe(data.importes.diferenciaBanco)}</dd>{r.mixtoBanco===0&&r.sinDesglose===0&&<><dt>Diferencia de transferencias</dt><dd>{importe(data.importes.diferenciaTransferencias)}</dd><dt>Diferencia de tarjeta</dt><dd>{importe(data.importes.diferenciaTarjeta)}</dd></>}<dt>Notas pendientes de revisar</dt><dd>{data.pendientesRevision}</dd></dl>
        {data.observaciones&&<p className="corte-aviso">{data.observaciones}</p>}
      </section>:<form className="corte-panel" onSubmit={save}><h3>Dinero y comprobantes que recibes</h3><p className="field-hint">Captura lo que verificaste. Si no hubo movimientos de un tipo, escribe 0. Las notas ya están descontadas arriba: no las sumes al efectivo entregado.</p>
        <fieldset disabled={busy||loading} className="corte-campos">{campos.map(([key,label])=><label key={key}>{label}<input required type="number" min="0" max="99999999.99" step="0.01" inputMode="decimal" className="text-input" value={form[key]??''} onChange={e=>change(key,e.target.value)} placeholder="0.00"/></label>)}
          <label>Quién entrega<input required maxLength={100} className="text-input" value={form.entrega||''} onChange={e=>change('entrega',e.target.value)}/></label><label>Quién recibe<input required maxLength={100} className="text-input" value={form.recibe||''} onChange={e=>change('recibe',e.target.value)} placeholder="Nombre de quien recibe"/></label>
        </fieldset>
        <p className={`corte-diferencia ${diferencia!==null&&diferencia!==0?'pendiente':''}`}>Diferencia de efectivo: <b>{diferencia===null?'Por calcular':money(diferencia)}</b><small>{diferencia<0?'Falta efectivo.':diferencia>0?'Sobra efectivo.':'Efectivo recibido + fondo que queda − efectivo esperado.'}</small></p>
        {form.transferenciasVerificadas!==undefined&&form.transferenciasVerificadas!==''&&form.tarjetaVerificada!==undefined&&form.tarjetaVerificada!==''&&!r.sinDesglose&&<p className="corte-formula">Diferencia bancaria total: <b>{money(Number(form.transferenciasVerificadas)+Number(form.tarjetaVerificada)-banco)}</b>{r.mixtoBanco===0&&<><br/>Transferencias: {money(Number(form.transferenciasVerificadas)-r.transferencias)} · Tarjeta: {money(Number(form.tarjetaVerificada)-r.tarjeta)}</>}</p>}
        <label>Observaciones<textarea className="text-input" maxLength={1000} value={form.observaciones||''} disabled={busy} onChange={e=>change('observaciones',e.target.value)} placeholder="Explica diferencias, notas sin revisar o importes por aclarar."/></label>
        <p className="field-hint">Quedará registrado con tu usuario: {currentUser?.nombre||currentUser?.name||'usuario actual'}. Los nombres de entrega y recepción son los que capturas aquí.</p>
        <button className="btn-primary" disabled={busy||loading}>{busy?'Guardando…':data.turno.cerrado_en?'Guardar corte del turno':'Guardar corte y cerrar turno'}</button>
      </form>}
    </>}
  </div>;
}
