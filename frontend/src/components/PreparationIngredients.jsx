import React, { useEffect, useState } from 'react';
import { CheckCircle2, ArrowRightLeft, PackageCheck, Info } from 'lucide-react';
import * as api from '../api/client.js';
import { formatCantidad } from '../lib/recipes.js';
import { Sheet, FormError, useAccionUnica } from './ui.jsx';
import './PreparationIngredients.css';

export function IngredientAlternatives({ materias, onClose }) {
  const [id,setId]=useState('');
  const [data,setData]=useState(null);
  const [ids,setIds]=useState([]);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  useEffect(()=>{
    let alive=true;setData(null);setError('');setSaved(false);
    if(id) api.getAlternativasInsumo(id).then(r=>{if(alive){setData(r);setIds(r.alternativas.filter(m=>m.autorizada).map(m=>m.id));}}).catch(e=>{if(alive)setError(e.message);});
    return ()=>{alive=false;};
  },[id]);
  const [busy,save]=useAccionUnica(async()=>{
    setError('');
    try { await api.guardarAlternativasInsumo(id,ids);setSaved(true); } catch(e){setError(e.message);}
  });
  return <Sheet title="Alternativas de preparación" className="prep-ingredients-sheet" onClose={onClose} closable={!busy}>
    <div className="prep-intro"><ArrowRightLeft size={24}/><p>Autoriza qué insumos pueden usarse en lugar de otro. Barra y parrilla elegirán el que realmente utilicen, antes de terminar la comanda.</p></div>
    <label className="prep-field">Insumo de la receta<select value={id} disabled={busy} onChange={e=>setId(e.target.value)}><option value="">Seleccionar insumo…</option>{materias.filter(m=>m.activo).map(m=><option key={m.id} value={m.id}>{m.nombre}</option>)}</select></label>
    {id && !data && !error && <p role="status">Cargando alternativas…</p>}
    {data && <>
      <div className="prep-notice"><Info size={18}/><p>Elige equivalentes con la misma dosificación y que respeten lo pedido por el cliente. Por ejemplo, dos marcas de leche deslactosada. Un cambio de tipo de leche se registra en Caja.</p></div>
      <p className="prep-section-label">En lugar de {data.base.nombre} se permite usar:</p>
      <div className="prep-alternatives">{data.alternativas.filter(m=>m.activo).map(m=><label key={m.id}><input type="checkbox" checked={ids.includes(m.id)} disabled={busy} onChange={e=>{setSaved(false);setIds(v=>e.target.checked?[...v,m.id]:v.filter(id=>id!==m.id));}}/><span>{m.nombre}<small>Controlado en {m.unidad}</small></span></label>)}</div>
      {!data.alternativas.some(m=>m.activo) && <p>No hay otros insumos activos con unidades compatibles.</p>}
      <p className="prep-footnote">Esta autorización aplica donde la receta use este insumo. No cambia precios ni existencias. Para permitir el cambio en sentido inverso, configúralo también en el otro insumo.</p>
      {saved && <div className="prep-success" role="status"><CheckCircle2 size={20}/> Alternativas guardadas</div>}
      <button className="btn-primary full" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar alternativas'}</button>
    </>}
    <FormError>{error}</FormError>
  </Sheet>;
}

function convert(q,from,to) {
  if(from===to)return Number(q);
  return Number(q)*({'kg>g':1000,'g>kg':0.001,'l>ml':1000,'ml>l':0.001}[`${from}>${to}`] || 1);
}
export default function PreparationIngredients({ ticket, onClose }) {
  const [data,setData]=useState(null);
  const [selected,setSelected]=useState({});
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  const apply=r=>{setData(r);setSelected(Object.fromEntries(r.insumos.map(m=>[m.origen_id,m.elegido_id])));};
  useEffect(()=>{
    let alive=true;
    api.getInsumosPreparacion(ticket.id).then(r=>{if(alive)apply(r);}).catch(e=>{if(alive)setError(e.message);});
    return ()=>{alive=false;};
  },[ticket.id]);
  const [busy,save]=useAccionUnica(async()=>{
    setError('');
    try {apply(await api.guardarInsumosPreparacion(ticket.id,{huella:data.huella,insumos:data.insumos.map(m=>({origenId:m.origen_id,elegidoId:selected[m.origen_id]}))}));setSaved(true);}
    catch(e){setError(e.message);}
  });
  const dirty=data && !data.registrado && data.insumos.some(m=>selected[m.origen_id]!==m.elegido_id);
  return <Sheet title={data?.registrado?'Insumos registrados':'Insumos de preparación'} className="prep-ingredients-sheet" onClose={onClose} closable={!busy}>
    {data ? <>
      <div className="prep-heading"><span>{ticket.folio || 'Comanda'}</span><h3>{data.unidades} × {data.producto}</h3><p>{data.registrado?'Consumos registrados al terminar la preparación.':'Estas son las cantidades totales que se descontarán al terminar.'}</p></div>
      {data.alertas.map((a,i)=><div className="prep-notice warning" key={i}><Info size={18}/><p>{a}</p></div>)}
      <div className="prep-ingredient-list">{data.insumos.map((m,i)=>{
        const choices=data.registrado?[]:[{id:m.origen_id,nombre:m.origen,unidad:m.unidad_origen},...m.alternativas];
        const chosen=choices.find(o=>o.id===selected[m.origen_id]);
        const amount=chosen?convert(m.cantidad_origen,m.unidad_origen,chosen.unidad):m.cantidad;
        return <article key={m.origen_id || `${m.elegido_id}-${i}`}>
          <div className="prep-ingredient-title"><PackageCheck size={18}/><strong>{data.registrado?m.elegido:m.origen}</strong><b>{formatCantidad(amount,chosen?.unidad || m.unidad)}</b></div>
          {(choices.length>1 || (!data.registrado && selected[m.origen_id]!==m.origen_id)) ? <label className="prep-field">Insumo que vas a utilizar<select disabled={busy} value={selected[m.origen_id]} onChange={e=>{setSelected(v=>({...v,[m.origen_id]:e.target.value}));setSaved(false);}}>{choices.map(o=><option key={o.id} value={o.id}>{o.nombre}{o.id===m.origen_id?' · receta':''}</option>)}</select></label> : !data.registrado && <small className="prep-footnote">Se utilizará {m.elegido}</small>}
          {!data.registrado && !chosen && <FormError>La alternativa guardada ya no está autorizada. Selecciona un insumo vigente.</FormError>}
        </article>;
      })}</div>
      {!data.insumos.length && <div className="prep-notice warning">No hay consumos {data.registrado?'registrados':'configurados'}. Revisa la receta y sus opciones con el administrador.</div>}
      {!data.registrado && <>
        <p className="prep-footnote">La elección aplica a las {data.unidades} unidad(es) de esta línea. Solo se descuenta el insumo elegido. El tipo pedido por el cliente y el precio permanecen iguales.</p>
        {saved && <div className="prep-success" role="status"><CheckCircle2 size={20}/><span>Selección guardada. Se descontará cuando termines la preparación.</span></div>}
        <button className="btn-primary full" disabled={busy || !dirty} onClick={save}>{busy?'Guardando…':'Guardar insumos a utilizar'}</button>
      </>}
    </> : !error && <p role="status">Consultando insumos…</p>}
    <FormError>{error}</FormError>
  </Sheet>;
}
