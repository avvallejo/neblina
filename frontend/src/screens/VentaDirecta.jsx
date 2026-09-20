import { productEmoji } from '../lib/productEmojis.js';
import React,{useEffect,useState} from 'react';
import { PRODUCTS,getProduct } from '../lib/catalog';
import { money } from '../lib/helpers';
import { CustomizeSheet } from '../components/menu';
import * as api from '../api/client';
import './ventaDirecta.css';
function fechaLocal(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function horaLocal(){return new Intl.DateTimeFormat('en-GB',{timeZone:'America/Mexico_City',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());}
export default function VentaDirecta({onBack,addToast}){
 const [fecha,setFecha]=useState(fechaLocal),[hora,setHora]=useState(horaLocal),[motivo,setMotivo]=useState('Venta pendiente de capturar');
 const [items,setItems]=useState([]),[custom,setCustom]=useState(null),[materias,setMaterias]=useState([]),[error,setError]=useState('');
 const [metodo,setMetodo]=useState('efectivo'),[busy,setBusy]=useState(false),[review,setReview]=useState(false),[done,setDone]=useState(null);
 const [cashPart,setCashPart]=useState('');
 const [key,setKey]=useState(()=>crypto.randomUUID());
 useEffect(()=>{api.getInsumosVenta().then(setMaterias).catch(e=>setError(e.message));},[]);
 const edit=(uid,field,value)=>{setReview(false);setItems(xs=>xs.map(x=>x.uid===uid?{...x,[field]:value}:x));};
 const add=item=>{setItems(xs=>[...xs,{motivoPrecio:'',...item,uid:crypto.randomUUID()}]);setReview(false);};
 const netUnit=x=>x.cortesia?0:Math.round(Number(x.unitPrice||0)*(1-Number(x.descuentoPorcentaje||0)/100)*100)/100;
 const subtotal=Math.round(items.reduce((s,x)=>s+Number(x.unitPrice||0)*Number(x.qty||0),0)*100)/100;
 const total=Math.round(items.reduce((s,x)=>s+netUnit(x)*Number(x.qty||0),0)*100)/100;
 const courtesyValue=Math.round(items.filter(x=>x.cortesia).reduce((s,x)=>s+Number(x.unitPrice||0)*Number(x.qty||0),0)*100)/100;
 const allCourtesy=items.length>0&&items.every(x=>x.cortesia);
 const saleMethod=allCourtesy?'cortesia':metodo;
 const valid=(saleMethod!=='mixto'||(cashPart.trim()!==''&&Number.isFinite(Number(cashPart))&&Number(cashPart)>=0&&Number(cashPart)<=total))&&items.length>0&&motivo.trim().length>=3&&fecha&&hora&&items.every(x=>Number(x.qty)>=1&&Number.isInteger(Number(x.qty))&&x.unitPrice!==''&&Number(x.unitPrice)>=0&&(x.productId||(x.concepto?.trim().length>=3&&x.inventarioElegido))&&((x.productId&&Number(x.unitPrice)===x.originalPrice)||x.motivoPrecio?.trim().length>=3)&&Number.isFinite(Number(x.descuentoPorcentaje||0))&&Number(x.descuentoPorcentaje||0)>=0&&Number(x.descuentoPorcentaje||0)<100&&(!(x.cortesia||Number(x.descuentoPorcentaje)>0)||x.motivoBeneficio?.trim().length>=3)&&(!x.insumoId||Number(x.cantidadInsumo)>0));
 async function save(){
  if(busy)return;setBusy(true);setError('');
  try{const r=await api.registrarVentaDirecta({cart:items,fecha,hora,motivo,metodoPago:saleMethod,importeEfectivo:saleMethod==='mixto'?Number(cashPart):undefined,montoRecibido:total,claveRegistro:key});setDone({...r.pedido,leyendaCortesia:r.cortesia?.leyenda});addToast('Venta registrada e inventario descontado','success');}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 if(done)return <div className="direct-sale"><h2>Venta registrada · {done.folio}</h2><p>{fecha} a las {hora} · {money(done.total)}</p><p>Ya entregada. Los insumos vinculados se descontaron del inventario.</p>{done.leyendaCortesia&&<p role="status">{done.leyendaCortesia}</p>}<button className="btn-primary" onClick={()=>{setDone(null);setItems([]);setKey(crypto.randomUUID());setReview(false);}}>Capturar otra venta</button><button className="btn-ghost" onClick={onBack}>Volver a Caja</button></div>;
 return <div className="direct-sale">
  <button className="btn-ghost" onClick={onBack} disabled={busy}>← Volver a Caja</button>
  <h2>Venta directa o atrasada</h2><p>Registra lo que ya vendiste y entregaste, con el precio realmente cobrado. No se enviará a preparación.</p>
  <div className="direct-grid"><label>Fecha de venta<input type="date" className="text-input" max={fechaLocal()} value={fecha} onChange={e=>{setFecha(e.target.value);setReview(false);}}/></label><label>Hora de venta<input type="time" className="text-input" value={hora} onChange={e=>{setHora(e.target.value);setReview(false);}}/></label></div>
  <label>Motivo de la captura<input className="text-input" maxLength={300} value={motivo} onChange={e=>{setMotivo(e.target.value);setReview(false);}} placeholder="Venta de ayer que no se registró"/></label>
  <div className="direct-grid"><label>Agregar del catálogo<select className="text-input" value="" onChange={e=>{const p=getProduct(e.target.value);if(p){if(p.tipo==='snack')add({productId:p.id,qty:1,unitPrice:p.price,originalPrice:p.price,extras:[]});else setCustom(p);}}}><option value="">Elige un producto…</option>{PRODUCTS.filter(p=>p.activo!==false).map(p=><option key={p.id} value={p.id}>{productEmoji(p)} {p.name}</option>)}</select></label><button className="btn-ghost" onClick={()=>add({concepto:'',qty:1,unitPrice:'',extras:[],sinInsumo:true})}>+ Venta fuera del catálogo</button></div>
  {items.map(x=><article className="direct-item" key={x.uid}>
   <div className="direct-item-head"><h3>{x.productId && <span aria-hidden="true">{productEmoji(getProduct(x.productId))} </span>}{x.productId?getProduct(x.productId)?.name:'Concepto libre'}</h3><button className="link-danger" onClick={()=>{setItems(xs=>xs.filter(i=>i.uid!==x.uid));setReview(false);}}>Quitar</button></div>
   {!x.productId&&<label>¿Qué vendiste?<input className="text-input" maxLength={300} placeholder="Café molido 250 g / vaso extra" value={x.concepto} onChange={e=>edit(x.uid,'concepto',e.target.value)}/></label>}
   <div className="direct-grid"><label>Cantidad vendida<input className="text-input" type="number" min="1" max="50" step="1" value={x.qty} onChange={e=>edit(x.uid,'qty',e.target.value)}/></label><label>Precio por unidad antes del descuento<input className="text-input" type="number" min="0" max="100000" step="0.01" value={x.unitPrice} onChange={e=>edit(x.uid,'unitPrice',e.target.value)}/></label></div>
   {x.productId&&<small>Precio actual con personalización: {money(x.originalPrice)}. El precio del catálogo se conserva.</small>}
   {(!x.productId||Number(x.unitPrice)!==x.originalPrice)&&<label>Motivo del precio<input className="text-input" maxLength={300} placeholder="Precio de apertura / precio acordado / venta libre" value={x.motivoPrecio} onChange={e=>edit(x.uid,'motivoPrecio',e.target.value)}/></label>}
   <label>Descuento o cortesía de este producto<select className="text-input" value={x.cortesia?'cortesia':x.beneficio==='descuento'?'descuento':'normal'} onChange={e=>{const value=e.target.value;setItems(xs=>xs.map(i=>i.uid===x.uid?{...i,beneficio:value,cortesia:value==='cortesia',descuentoPorcentaje:0,motivoBeneficio:''}:i));setReview(false);}}><option value="normal">Sin descuento ni cortesía</option><option value="descuento">Aplicar descuento (%)</option><option value="cortesia">Cortesía · no se cobró</option></select></label>
   {x.beneficio==='descuento'&&!x.cortesia&&<label>Descuento por unidad (%)<input className="text-input" type="number" min="0" max="99.99" step="0.01" value={x.descuentoPorcentaje??0} onChange={e=>edit(x.uid,'descuentoPorcentaje',e.target.value)}/><small>Se cobrarán {money(netUnit(x))} por unidad.</small></label>}
   {(x.cortesia||x.beneficio==='descuento')&&<label>Motivo del descuento o cortesía<input className="text-input" maxLength={200} value={x.motivoBeneficio||''} onChange={e=>edit(x.uid,'motivoBeneficio',e.target.value)} placeholder="Ej. promoción aplicada / cortesía por atención"/></label>}
   {x.cortesia&&<p className="direct-note">Se regalan las {x.qty} unidad(es) de esta línea. Si solo regalaste una, agrégala en una línea separada. Cuenta para el cupo del mes de la venta; si lo excede quedará pendiente de autorización.</p>}
   {x.productId?<p className="direct-note">Descuenta la receta actual y la personalización elegida.</p>:<><label>Insumo que sale del inventario<select className="text-input" value={x.inventarioElegido?(x.insumoId||'__none'):''} onChange={e=>{const m=materias.find(m=>m.id===e.target.value);setItems(xs=>xs.map(i=>i.uid===x.uid?{...i,inventarioElegido:true,insumoId:m?.id||'',unidadInsumo:m?.unidad||'',cantidadInsumo:''}:i));setReview(false);}}><option value="" disabled>Elige un insumo o indica que no aplica…</option><option value="__none">Sin insumo vinculado — solo registrar ingreso</option>{materias.map(m=><option key={m.id} value={m.id}>{m.nombre} ({m.unidad})</option>)}</select></label>{x.insumoId&&<div className="direct-grid"><label>Consumo por unidad vendida<input className="text-input" type="number" min="0.001" step="0.001" value={x.cantidadInsumo||''} onChange={e=>edit(x.uid,'cantidadInsumo',e.target.value)}/></label><label>Unidad<select className="text-input" value={x.unidadInsumo} onChange={e=>edit(x.uid,'unidadInsumo',e.target.value)}>{['g','kg','ml','l','pieza'].map(u=><option key={u}>{u}</option>)}</select></label></div>}<small>{x.insumoId?'Ejemplo: 250 g por bolsa o 1 pieza por vaso. Se multiplica por la cantidad vendida.':'Este concepto no descontará inventario. Vincula un insumo si vendiste café o un vaso.'}</small></>}
   <strong>{x.cortesia?'Cortesía · ':''}{money(Number(x.qty)*netUnit(x))}</strong>
  </article>)}
  {allCourtesy?<p className="direct-note">Todo el ticket es cortesía: total $0, sin ingreso de efectivo.</p>:<label>Forma de pago ya recibida<select className="text-input" value={metodo} onChange={e=>{setMetodo(e.target.value);setReview(false);}}><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="transferencia">Transferencia</option><option value="mixto">Mixto</option></select></label>}
  {saleMethod==='mixto'&&<label>Parte cobrada en efectivo<input className="text-input" type="number" min="0" max={total} step="0.01" value={cashPart} onChange={e=>{setCashPart(e.target.value);setReview(false);}}/><small>El resto ({money(total-Number(cashPart||0))}) corresponde a tarjeta o transferencia.</small></label>}
  <div className="direct-summary"><span>Subtotal antes de beneficios</span><strong>{money(subtotal)}</strong></div>
  {courtesyValue>0&&<div className="direct-summary"><span>Cortesías</span><strong>− {money(courtesyValue)}</strong></div>}
  {subtotal-courtesyValue-total>0.005&&<div className="direct-summary"><span>Descuentos por producto</span><strong>− {money(subtotal-courtesyValue-total)}</strong></div>}
  <div className="direct-summary"><span>Total de la venta</span><strong>{money(total)}</strong></div>
  {error&&<p role="alert" className="direct-error">{error}</p>}
  {review?<div className="direct-review"><h3>Confirma esta captura</h3><p>{fecha} · {hora} · {items.reduce((n,x)=>n+Number(x.qty),0)} unidad(es) · {money(total)} · {saleMethod}</p><p>Se registrará como pagada y entregada. Se descontarán las recetas e insumos vinculados.</p><button className="btn-primary" disabled={busy||!valid} onClick={save}>{busy?'Guardando…':'Registrar venta y descontar inventario'}</button><button className="btn-ghost" disabled={busy} onClick={()=>setReview(false)}>Seguir editando</button></div>:<button className="btn-primary" disabled={!valid} onClick={()=>setReview(true)}>Revisar venta</button>}
  {custom&&<CustomizeSheet allowPriceOverride product={custom} onClose={()=>setCustom(null)} onAdd={add}/>}
 </div>;
}
