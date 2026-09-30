import React, { useRef, useState } from 'react';
import * as api from '../api/client.js';
import { Sheet, FormError, useAccionUnica } from './ui.jsx';
import { money } from '../lib/helpers.js';
export default function SplitAccountSheet({order,onClose,onSeparated}) {
  const lines=order.items.filter(i=>i.estado!=='cancelado');
  const [quantities,setQuantities]=useState({}),[name,setName]=useState(''),[error,setError]=useState(''),[result,setResult]=useState(null);
  const attempt=useRef({key:'',id:crypto.randomUUID()});
  const units=Object.values(quantities).reduce((s,n)=>s+Number(n||0),0);
  const all=lines.reduce((s,l)=>s+Number(l.cantidad),0);
  const base=lines.reduce((s,l)=>s+(l.es_cortesia?0:Number(l.precio_unitario)*Number(quantities[l.id]||0)),0);
  const chargeable=Number(order.subtotal)-Number(order.cortesia_valor);
  const total=chargeable>0?Math.round(Number(order.total)*base/chargeable*100)/100:0;
  const [busy,submit]=useAccionUnica(async()=>{
    setError('');
    try {
      const body={nombre:name.trim(),totalEsperado:Number(order.total),items:lines.filter(l=>Number(quantities[l.id])>0).map(l=>({id:l.id,cantidad:Number(quantities[l.id]),cantidadEsperada:Number(l.cantidad)}))};
      const key=JSON.stringify(body);if(attempt.current.key!==key)attempt.current={key,id:crypto.randomUUID()};
      const r=await api.separarCuenta(order.id,{...body,clientUuid:attempt.current.id});
      setResult(r.cuenta);await onSeparated();
    } catch(e){setError(e.message);}
  });
  return <Sheet title={result?'Cuenta separada':'Separar cuenta'} onClose={busy?()=>{}:onClose}>
    {result?<div role="status"><h3>{result.folio} · {result.nombre_ticket}</h3><p>Nueva cuenta por cobrar: <strong>{money(result.total)}</strong>. La cuenta {order.folio} conserva los demás productos.</p><p>Ambas aparecen en Ventas del turno. Puedes cobrar cada una con su propio medio de pago.</p><button className="btn-primary" onClick={onClose}>Listo</button></div>:<fieldset disabled={busy} style={{border:0,padding:0}}><p>Elige cuántos productos pasan a la nueva cuenta. Conservan su preparación, cortesías y descuento. Puedes repetirlo para crear más cuentas.</p><label className="option-label">Nombre de la nueva cuenta<input className="text-input" maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="Ej. Ana"/></label>{lines.map(l=><label className="cart-item" key={l.id}><span className="cart-item-info"><strong>{l.producto_nombre}</strong><small>{[l.tamano_etiqueta,l.leche_etiqueta,l.cafe_etiqueta,...(l.extras||[])].filter(Boolean).join(" · ")}{l.notas?` · ${l.notas}`:""}</small><small> {l.cantidad} en el ticket · {l.estado==='terminado'?'Listo':l.estado==='en_preparacion'?'En preparación':'Pendiente'}{l.es_cortesia?' · Cortesía':''}</small></span><input className="text-input" style={{width:90}} aria-label={`Cantidad para la nueva cuenta: ${l.producto_nombre}`} type="number" min="0" max={l.cantidad} step="1" value={quantities[l.id]||0} onChange={e=>setQuantities(q=>({...q,[l.id]:e.target.value}))}/></label>)}<div className="promo-summary-card"><p>Nueva cuenta: <strong>{money(total)}</strong> · {units} producto(s)</p><p>Queda en {order.folio}: <strong>{money(Number(order.total)-total)}</strong> · {all-units} producto(s)</p></div><FormError>{error}</FormError><button className="btn-primary" disabled={!name.trim()||units<1||units>=all} onClick={submit}>{busy?'Separando…':'Crear cuenta separada'}</button></fieldset>}
  </Sheet>;
}
