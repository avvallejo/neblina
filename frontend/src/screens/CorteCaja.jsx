import React, { useEffect, useRef, useState } from 'react';
import { Wallet, Receipt, ArrowDownLeft, CheckCircle2, Search } from 'lucide-react';
import * as api from '../api/client';
import { money } from '../lib/helpers';
import { closingFields, reviewClosing } from '../lib/cashClosing.js';
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
  const [feedback, setFeedback] = useState(null), [syncWarning, setSyncWarning] = useState(false);
  const request = useRef(null), locked = useRef(false), formRef = useRef(null), feedbackRef = useRef(null), receiptRef = useRef(null);
  useEffect(()=>{
    if (!feedback) return;
    const target = feedback.kind === 'saved' ? receiptRef.current : feedback.field ? formRef.current?.elements.namedItem(feedback.field) : feedbackRef.current;
    target?.focus({preventScroll:true});target?.scrollIntoView({block:'center',behavior:'auto'});
  },[feedback]);
  useEffect(()=>{
    let alive=true; setLoading(true); setData(null); setError(''); setId('');
    api.getCortes(filtro).then(rows=>{if(alive){setTurnos(rows);setId(rows[0]?.id||'');setLoading(false);}}).catch(e=>{if(alive){setError(e.message);setLoading(false);}});
    return()=>{alive=false;};
  },[filtro]);
  useEffect(()=>{
    if(!id)return undefined;
    let alive=true;setLoading(true);setData(null);setError('');setCompras(false);setFeedback(null);setSyncWarning(false);request.current=null;
    api.getCorte(id).then(r=>{if(alive){setData(r);setRevisadas(r.notasRevisadas||[]);setForm({entrega:r.entrega||r.turno.abierto_por_nombre||'',recibe:r.recibe||'',observaciones:r.observaciones||''});setLoading(false);}}).catch(e=>{if(alive){setError(e.message);setLoading(false);}});
    return()=>{alive=false;};
  },[id]);
  async function refresh() {
    if(locked.current)return;
    locked.current=true;
    setError('');setLoading(true);
    try {
      const r=await api.getCorte(id);
      if(r.guardado) saved(r);
      else {
        setData(r);setRevisadas(old=>old.filter(noteId=>r.notas.some(n=>n.id===noteId&&!n.anulado)));
        setFeedback(request.current?{kind:'unknown',message:'Todavía no se confirma el guardado. Puedes reintentar el mismo corte; se conserva el identificador para evitar duplicados.'}:null);
      }
    }
    catch(e){if(request.current)setFeedback({kind:'unknown',message:'No pudimos comprobar el guardado. Conservamos tus datos; comprueba de nuevo cuando vuelva la conexión.'});else setError(e.message);}
    finally{locked.current=false;setLoading(false);}
  }
  const change=(key,value)=>{setForm(f=>({...f,[key]:value}));if(feedback?.field===key)setFeedback(null);};
  function saved(result) {
    setData(result);request.current=null;setError('');setFeedback({kind:'saved'});
    setTurnos(rows=>rows.map(t=>t.id===id?{...t,corte_en:result.registradoEn,folio:result.folio,cerrado_en:result.turno.cerrado_en||result.registradoEn}:t));
    addToast(`Corte ${result.folio} guardado · Turno cerrado`,'success');
    // Una falla al refrescar otras pantallas no convierte un corte guardado en error.
    if(onChanged)Promise.resolve().then(()=>onChanged()).catch(()=>setSyncWarning(true));
  }
  async function save(e) {
    e.preventDefault();if(locked.current||loading||data.guardado)return;
    if(!request.current&&review.errors.length){setFeedback({kind:'error',...review.errors[0]});return;}
    if(!request.current&&!window.confirm('¿Guardar este corte? Se conservarán los importes y las notas revisadas. Si el turno está abierto, se cerrará.'))return;
    locked.current=true;setBusy(true);setError('');setFeedback(null);
    try {
      const body={revision:data.revision,entrega:form.entrega,recibe:form.recibe,efectivoEntregado:form.efectivoEntregado,fondoRetenido:form.fondoRetenido,
        transferenciasVerificadas:form.transferenciasVerificadas,tarjetaVerificada:form.tarjetaVerificada,observaciones:form.observaciones,notasRevisadas:revisadas};
      if(!request.current)request.current={id:crypto.randomUUID(),body};
      saved(await api.guardarCorte(id,{...request.current.body,solicitudId:request.current.id}));
    } catch(e) {
      // Si se perdió la respuesta o alguien ya cerró el turno, buscar el recibo
      // antes de presentar un error que podría invitar a guardar otra vez.
      let checked=false;
      if(!e.status||e.status>=500||e.status===409){
        try {const result=await api.getCorte(id);checked=true;if(result.guardado){saved(result);return;}}catch{/* conservar el intento original */}
      }
      if(e.status>=400&&e.status<500&&(e.status!==409||checked)){request.current=null;setFeedback({kind:'error',message:e.message});}
      else setFeedback({kind:'unknown',message:'No pudimos confirmar si se guardó. Conservamos tus datos. Pulsa “Comprobar guardado” o reintenta el mismo corte; no se creará otro.'});
    }
    finally{locked.current=false;setBusy(false);}
  }
  const r=data?.resumen;
  const review=r?reviewClosing(data,form,revisadas):null;
  const pendingRequest=Boolean(request.current);
  const formDisabled=busy||loading||pendingRequest;
  const banco=r?Math.round((r.transferencias+r.tarjeta+r.mixtoBanco)*100)/100:0;
  const diferencia=data?.guardado?data.importes.diferenciaEfectivo:review?.cash;
  return <div className="corte-page">
    <div className="corte-intro"><Wallet size={24}/><div><h2>Corte y entrega de caja</h2><p>Revisa el dinero con la administradora y marca cada nota que te entregó.</p></div></div>
    <div className="corte-toolbar">
      <label>Fecha de apertura<input type="date" className="text-input" value={filtro} disabled={formDisabled} onChange={e=>setFiltro(e.target.value)}/></label>
      {filtro&&<button className="btn-ghost" disabled={formDisabled} onClick={()=>setFiltro('')}>Ver últimos turnos</button>}
      <label className="corte-selector">Turno<select className="text-input" value={id} disabled={formDisabled} onChange={e=>setId(e.target.value)}>{!turnos.length&&<option value="">Sin turnos</option>}{turnos.map(t=><option key={t.id} value={t.id}>{fecha(t.abierto_en)} · {t.corte_en?'Corte guardado':t.cerrado_en?'Pendiente de corte':'Abierto'} · {t.abierto_por_nombre}</option>)}</select></label>
      {id&&<button className="btn-secondary" disabled={busy||loading} onClick={refresh}>Actualizar corte</button>}
    </div>
    <BuscarNotas/>
    {loading&&<p role="status">Cargando corte…</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {!loading&&!id&&<p>No hay turnos en esta selección. Abre un turno desde Caja para empezar.</p>}
    {data&&r&&<>
      {data.guardado&&<div className="corte-guardado" role="status" tabIndex={-1} ref={receiptRef}><CheckCircle2 size={26}/><div><h3>Corte guardado · Turno cerrado</h3><strong>Folio {data.folio}</strong><p>{fecha(data.registradoEn)} · Registró: {data.registradoPor}</p><p>La entrega quedó registrada. No necesitas volver a guardar.</p><small>Puedes consultar este comprobante en el historial de cortes.</small>{syncWarning&&<p>El corte está guardado. Falta actualizar las otras pantallas; recarga cuando vuelva la conexión.</p>}</div></div>}
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
      {!data.guardado&&!data.turno.cerrado_en&&<><button className="btn-secondary" disabled={formDisabled} onClick={()=>setCompras(!compras)}>{compras?'Ocultar captura':'Registrar compra o gasto que falta'}</button>{compras&&<fieldset className="corte-captura" disabled={formDisabled}><CajaGastos turnoId={id} addToast={addToast} onChanged={async()=>{await refresh();if(onChanged)await onChanged();}}/></fieldset>}</>}
      <section className="corte-panel"><h3>Notas registradas del turno</h3><p className="field-hint">El folio N-… se escribe a mano en la nota. Marca “Revisada” cuando la hayas cotejado con el papel. Registrar una nota no significa que ya esté revisada.</p>
        {!data.notas.length&&<p>Sin notas registradas en este turno.</p>}
        {data.notas.map(n=><div key={n.id} className={`corte-nota ${n.anulado?'anulada':''}`}>
          <div className="corte-nota-top"><strong>{n.folio} · {money(n.monto)}</strong>{!n.anulado&&<label><input type="checkbox" disabled={formDisabled||data.guardado} checked={revisadas.includes(n.id)} onChange={e=>setRevisadas(old=>e.target.checked?[...old,n.id]:old.filter(x=>x!==n.id))}/> Revisada</label>}</div>
          <span>{n.concepto}{n.proveedor_nombre?` · ${n.proveedor_nombre}`:''}</span>
          <small>{n.anulado?'Anulada · no suma':!n.pagado?'Registrada · por pagar':n.cuenta_dinero_clave==='caja'?'Registrada · pagada de caja':'Registrada · pagada fuera de caja'} · {n.tiene_comprobante===true?'Con comprobante':n.tiene_comprobante===false?'Sin comprobante':'Comprobante por confirmar'}{n.referencia?` · Ref. ${n.referencia}`:''} · Capturó: {n.usuario_nombre||'Sin identificar'}</small>
          {n.nota&&<small>{n.nota}</small>}
        </div>)}
      </section>
      {data.guardado?<section className="corte-panel"><h3>Entrega registrada</h3><p>Entregó: <b>{data.entrega}</b> · Recibió: <b>{data.recibe}</b></p>
        <dl className="corte-importes"><dt>Efectivo recibido</dt><dd>{money(data.importes.entregado)}</dd><dt>Fondo que quedó en caja</dt><dd>{money(data.importes.fondoRetenido)}</dd><dt>Transferencias verificadas</dt><dd>{money(data.importes.transferencias)}</dd><dt>Tarjeta verificada</dt><dd>{money(data.importes.tarjeta)}</dd><dt>Diferencia de efectivo</dt><dd>{importe(diferencia)}</dd><dt>Diferencia bancaria total</dt><dd>{importe(data.importes.diferenciaBanco)}</dd>{r.mixtoBanco===0&&r.sinDesglose===0&&<><dt>Diferencia de transferencias</dt><dd>{importe(data.importes.diferenciaTransferencias)}</dd><dt>Diferencia de tarjeta</dt><dd>{importe(data.importes.diferenciaTarjeta)}</dd></>}<dt>Notas pendientes de revisar</dt><dd>{data.pendientesRevision}</dd></dl>
        {data.observaciones&&<p className="corte-aviso">{data.observaciones}</p>}
      </section>:<form className="corte-panel" ref={formRef} noValidate onSubmit={save} aria-busy={busy}><h3>Dinero y comprobantes que recibes</h3><p className="field-hint">Captura lo que verificaste. Si no hubo movimientos de un tipo, escribe 0. Las notas ya están descontadas arriba: no las sumes al efectivo entregado.</p>
        <fieldset disabled={formDisabled} className="corte-campos">{closingFields.map(([key,label])=><label key={key}>{label}<input name={key} aria-invalid={feedback?.field===key||undefined} required type="number" min="0" max="99999999.99" step="0.01" inputMode="decimal" className="text-input" value={form[key]??''} onChange={e=>change(key,e.target.value)} placeholder="0.00"/>{key==='efectivoEntregado'&&<small className="field-hint">Solo el dinero que te entregan. No incluyas el fondo que se queda en caja.</small>}</label>)}
          <label>Quién entrega<input name="entrega" aria-invalid={feedback?.field==='entrega'||undefined} required maxLength={100} className="text-input" value={form.entrega||''} onChange={e=>change('entrega',e.target.value)}/></label><label>Quién recibe<input name="recibe" aria-invalid={feedback?.field==='recibe'||undefined} required maxLength={100} className="text-input" value={form.recibe||''} onChange={e=>change('recibe',e.target.value)} placeholder="Nombre de quien recibe"/></label>
        </fieldset>
        <p className={`corte-diferencia ${diferencia!==null&&diferencia!==0?'pendiente':''}`}>Diferencia de efectivo: <b>{diferencia===null?'Por calcular':money(diferencia)}</b><small>{diferencia<0?'Falta efectivo.':diferencia>0?'Sobra efectivo.':'Efectivo recibido + fondo que queda − efectivo esperado.'}</small></p>
        {review.bank!==null&&<p className="corte-formula">Diferencia bancaria total: <b>{money(review.bank)}</b>{r.mixtoBanco===0&&<><br/>Transferencias: {money(review.transfers)} · Tarjeta: {money(review.card)}</>}</p>}
        {review.reasons.length>0&&<div className="corte-aviso" id="corte-pendientes"><strong>Para guardar, explica estos puntos en Observaciones:</strong><ul>{review.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul><span>Puedes corregir los importes o guardar las diferencias con su explicación.</span></div>}
        <label>Observaciones{review.reasons.length>0?' (obligatorias)':' (opcionales)'}<textarea name="observaciones" required={review.reasons.length>0} aria-invalid={feedback?.field==='observaciones'||undefined} aria-describedby={review.reasons.length?'corte-pendientes':undefined} className="text-input" maxLength={1000} value={form.observaciones||''} disabled={formDisabled} onChange={e=>change('observaciones',e.target.value)} placeholder="Explica diferencias, notas sin revisar o importes por aclarar."/></label>
        <p className="field-hint">Quedará registrado con tu usuario: {currentUser?.nombre||currentUser?.name||'usuario actual'}. Los nombres de entrega y recepción son los que capturas aquí.</p>
        {feedback&&feedback.kind!=='saved'&&<div className={`corte-feedback ${feedback.kind}`} role="alert" tabIndex={-1} ref={feedbackRef}><strong>{feedback.kind==='unknown'?'Guardado pendiente de confirmar':'El corte no se guardó'}</strong><p>{feedback.message}</p>{feedback.kind==='error'&&<small>Los datos capturados se conservan. Revisa lo indicado antes de volver a guardar.</small>}</div>}
        {busy&&<p className="corte-aviso" role="status">Guardando el corte y confirmando el cierre… Espera un momento; no necesitas pulsar otra vez.</p>}
        <div className="corte-acciones"><button className="btn-primary" disabled={busy||loading}>{busy?'Guardando…':pendingRequest?'Reintentar el mismo corte':data.turno.cerrado_en?'Guardar corte del turno':'Guardar corte y cerrar turno'}</button>{(pendingRequest||feedback?.kind==='error')&&<button type="button" className="btn-secondary" disabled={busy||loading} onClick={refresh}>{pendingRequest?'Comprobar guardado':'Actualizar corte'}</button>}</div>
      </form>}
    </>}
  </div>;
}
