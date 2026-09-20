import React,{useEffect,useRef,useState} from 'react';
import * as api from '../api/client';
import {money} from '../lib/helpers';
import './cajaGastos.css';
export default function CajaGastos({turnoId,onChanged,addToast}){
 const [rows,setRows]=useState([]),[accounts,setAccounts]=useState([]),[suppliers,setSuppliers]=useState([]),[pending,setPending]=useState([]),[materials,setMaterials]=useState([]);
 const [mode,setMode]=useState(''),[form,setForm]=useState({}),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const request=useRef(null),locked=useRef(false);
 async function load(){
  const [a,b,c,d,f]=await Promise.all([api.getSalidasTurno(),api.getCuentasSalidaTurno(),api.getProveedoresSalidaTurno(),api.getComprasPendientesCaja(),api.getInsumosCompraCaja()]);
  setRows(a);setAccounts(b);setSuppliers(c);setPending(d);setMaterials(f);setLoading(false);
 }
 useEffect(()=>{let alive=true;setLoading(true);setError('');Promise.all([api.getSalidasTurno(),api.getCuentasSalidaTurno(),api.getProveedoresSalidaTurno(),api.getComprasPendientesCaja(),api.getInsumosCompraCaja()]).then(([a,b,c,d,f])=>{if(alive){setRows(a);setAccounts(b);setSuppliers(c);setPending(d);setMaterials(f);setLoading(false);}}).catch(e=>{if(alive){setError(e.message);setLoading(false);}});return()=>{alive=false};},[turnoId]);
 function start(next){setMode(next);setForm({pagado:true});setError('');request.current=null;}
 function change(key,value){setForm(f=>({...f,[key]:value}));}
 const material=materials.find(m=>m.id===form.materiaId);
 const selected=pending.find(p=>p.id===form.purchaseId);
 async function save(e){
  e.preventDefault();if(locked.current)return;
  if(!form.referencia?.trim()&&!form.nota?.trim()){setError('Escribe el folio o el motivo por el que no tienes comprobante.');return;}
  if(mode==='proveedor'&&!selected){setError('Selecciona una compra pendiente.');return;}
  if(mode==='compra'&&!material){setError('Selecciona qué compraste.');return;}
  locked.current=true;setBusy(true);setError('');
  try{
   const body={referencia:form.referencia?.trim()||null,nota:form.nota?.trim()||null,monto:mode==='proveedor'?Number(selected.monto):Number(form.monto)};
   if(mode==='gasto')Object.assign(body,{concepto:form.concepto?.trim(),cuentaContableId:form.cuenta?Number(form.cuenta):undefined,proveedorId:form.proveedorId||null});
   if(mode==='compra')Object.assign(body,{materiaId:material.id,costoTotal:Number(form.costoTotal),pagado:form.pagado!==false,proveedorId:form.proveedorId||null,numeroLote:form.numeroLote||null,fechaCaducidad:form.fechaCaducidad||null,...(form.porPaquetes?{paquetes:Number(form.cantidad)}:{cantidadComprada:Number(form.cantidad),unidad:form.unidad||material.unidad})});
   if(mode==='compra')delete body.monto;
   // Keep exactly the same request after an uncertain network result.
   const payload={body,purchaseId:mode==='proveedor'?selected.id:null};
   if(request.current&&JSON.stringify(request.current.payload)!==JSON.stringify(payload))throw new Error('Primero reintenta el registro anterior sin cambiar los datos, o actualiza la lista para comprobar si se guardó.');
   if(!request.current)request.current={id:crypto.randomUUID(),payload};
   const send={...body,solicitudId:request.current.id};
   if(mode==='compra')await api.registrarCompraCaja(send);else if(mode==='proveedor')await api.pagarCompraCaja(selected.id,send);else await api.registrarSalidaTurno(send);
   setMode('');request.current=null;setForm({});addToast(mode==='compra'?(body.pagado?'Compra agregada al inventario y descontada de caja':'Compra agregada al inventario; queda por pagar'):'Pago registrado y descontado del efectivo de caja','success');
   await Promise.all([load(),onChanged()]);
  }catch(e){if(e.status>=400&&e.status<500)request.current=null;setError(e.message);}finally{locked.current=false;setBusy(false);}
 }
 return <section className="salidas-caja">
  <div className="section-title">Compras, gastos y pagos</div><p className="field-hint">Las compras aumentan el inventario. Solo lo pagado en efectivo se descuenta de caja.</p>
  <div className="option-row" style={{margin:'12px 0',flexWrap:'wrap'}}><button className="btn-primary" disabled={busy||loading} onClick={()=>start('compra')}>Registrar compra de Inventario</button><button className="btn-secondary" disabled={busy||loading} onClick={()=>start('gasto')}>Registrar gasto pequeño</button><button className="btn-secondary" disabled={busy||loading} onClick={()=>start('proveedor')}>Pagar proveedor ({pending.length})</button></div>
  {loading&&<p role="status">Cargando movimientos…</p>}
  {mode&&<form className="salida-form" onSubmit={save}>
   <h3>{mode==='compra'?'Recibir compra en Inventario':mode==='gasto'?'Gasto pequeño':'Pagar compra de Inventario'}</h3>
   {mode==='compra'?<>
    <label className="option-label">Insumo o producto comprado hecho<select required className="text-input" value={form.materiaId||''} onChange={e=>{const m=materials.find(x=>x.id===e.target.value);setForm(f=>({...f,materiaId:e.target.value,unidad:m?.unidad,cantidad:'',porPaquetes:false}));}}><option value="">Selecciona qué recibiste</option>{materials.map(m=><option key={m.id} value={m.id}>{m.nombre}{m.productos_comprados?` · Comprado hecho: ${m.productos_comprados}`:''}</option>)}</select></label>
    <p className="field-hint">Incluye galletas, postres, refrescos y otros productos comprados hechos que ya están vinculados a Inventario. Si no aparece, Administración debe darlo de alta primero.</p>
    {material&&<>
     <p>Existencias: {Number(material.stock_actual)} {material.unidad}</p>
     {Number(material.presentacion_cantidad)>0&&<label className="option-label"><input type="checkbox" checked={!!form.porPaquetes} onChange={e=>setForm(f=>({...f,porPaquetes:e.target.checked,cantidad:''}))}/> Capturar por {material.presentacion_nombre||'paquete'} ({Number(material.presentacion_cantidad)} {material.presentacion_unidad})</label>}
     <label className="option-label">{form.porPaquetes?'¿Cuántos paquetes recibiste?':'¿Cuánto compraste?'}<input required className="text-input" type="number" min="0.001" step="0.001" value={form.cantidad||''} onChange={e=>change('cantidad',e.target.value)}/></label>
     {!form.porPaquetes&&<label className="option-label">Unidad<select className="text-input" value={form.unidad||material.unidad} onChange={e=>change('unidad',e.target.value)}>{(material.unidad==='pieza'?['pieza']:['g','kg'].includes(material.unidad)?['g','kg']:['ml','l']).map(u=><option key={u}>{u}</option>)}</select></label>}
     <label className="option-label">¿Cuánto costó toda la compra?<input required className="text-input" type="number" min="0.01" step="0.01" value={form.costoTotal||''} onChange={e=>change('costoTotal',e.target.value)} placeholder="Costo total, no precio por pieza"/></label>
     <label className="option-label">Pago<select className="text-input" value={form.pagado===false?'pendiente':'efectivo'} onChange={e=>change('pagado',e.target.value==='efectivo')}><option value="efectivo">Pagado con efectivo de esta caja</option><option value="pendiente">Queda por pagar al proveedor</option></select></label>
     <p className="field-hint">{form.pagado===false?'Aumenta el inventario y queda pendiente. No descuenta dinero del turno.':`Aumenta el inventario y descuenta ${money(form.costoTotal||0)} del efectivo de este turno.`}</p>
     <label className="option-label">Proveedor (opcional)<select className="text-input" value={form.proveedorId||''} onChange={e=>change('proveedorId',e.target.value)}><option value="">Sin proveedor registrado</option>{suppliers.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
     <label className="option-label">Lote (opcional)<input className="text-input" maxLength={120} value={form.numeroLote||''} onChange={e=>change('numeroLote',e.target.value)}/></label>
     <label className="option-label">Caducidad (opcional)<input className="text-input" type="date" value={form.fechaCaducidad||''} onChange={e=>change('fechaCaducidad',e.target.value)}/></label>
    </>}
   </>:mode==='gasto'?<>
    <label className="option-label">¿Qué compraste?<input required maxLength={160} className="text-input" value={form.concepto||''} onChange={e=>change('concepto',e.target.value)} placeholder="Ej. jabón para lavar utensilios"/></label>
    <label className="option-label">Importe pagado en efectivo<input required className="text-input" type="number" min="0.01" step="0.01" value={form.monto||''} onChange={e=>change('monto',e.target.value)}/></label>
    <label className="option-label">Tipo de gasto<select className="text-input" value={form.cuenta||''} onChange={e=>change('cuenta',e.target.value)}><option value="">Otros gastos de operación</option>{accounts.filter(a=>a.clave!=='otros_gastos').map(a=><option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
    <p className="field-hint">Jabón y material para operar: gasto de operación. Ingredientes ya consumidos: costo de ventas. Para ingredientes o productos que recibes ahora usa Registrar compra de Inventario. Si ya se registraron, usa Pagar proveedor para no duplicarlos.</p>
    <label className="option-label">Proveedor (opcional)<select className="text-input" value={form.proveedorId||''} onChange={e=>change('proveedorId',e.target.value)}><option value="">Compra en tienda / sin proveedor</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
   </>:<>
    <p className="field-hint">Selecciona una compra ya ingresada al inventario. Aquí se liquida el importe completo; no se registra una segunda compra.</p>
    <label className="option-label">Compra pendiente<select required className="text-input" value={form.purchaseId||''} onChange={e=>change('purchaseId',e.target.value)}><option value="">Selecciona una compra</option>{pending.map(p=><option key={p.id} value={p.id}>{p.proveedor_nombre||'Sin proveedor'} · {p.concepto} · {money(p.monto)} · {p.fecha}</option>)}</select></label>
    {!pending.length&&<p>No hay compras pendientes. Si el proveedor acaba de entregar, usa Registrar compra de Inventario.</p>}
    {selected&&<p><strong>Se descontarán {money(selected.monto)} del efectivo de caja.</strong>{selected.referencia&&<small> · Folio de compra: {selected.referencia}</small>}</p>}
   </>}
   <label className="option-label">Folio de nota, remisión o comprobante<input className="text-input" maxLength={80} value={form.referencia||''} onChange={e=>change('referencia',e.target.value)} placeholder="Ej. remisión 125"/></label>
   <label className="option-label">Notas / motivo si no tienes comprobante<textarea className="text-input" maxLength={300} value={form.nota||''} onChange={e=>change('nota',e.target.value)} placeholder="Qué se compró, dónde y por qué no hay comprobante"/></label>
   <div className="option-row"><button type="submit" className="btn-primary" disabled={busy||loading||(mode==='proveedor'&&!selected)||(mode==='compra'&&!material)}>{busy?'Registrando…':mode==='compra'?'Registrar compra':'Registrar pago en efectivo'}</button><button type="button" className="btn-ghost" disabled={busy} onClick={()=>start('')}>Cancelar</button></div>
  </form>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  <button className="btn-ghost" disabled={busy} onClick={()=>load().then(()=>setError('')).catch(e=>setError(e.message))}>Actualizar movimientos</button>
  {!loading&&!rows.length&&<p className="field-hint">Sin salidas registradas en este turno.</p>}
  {rows.map(r=><details key={r.id} style={{padding:'12px 0',borderBottom:'1px solid var(--line)'}}><summary>{r.concepto} · <strong>− {money(r.monto)}</strong></summary><p>{r.lote_id?'Pago de Inventario':'Gasto'} · {r.cuenta_nombre}</p><p>Registró el pago: {r.usuario_nombre||'Sin identificar'}</p>{r.proveedor_nombre&&<p>Proveedor: {r.proveedor_nombre}</p>}<p>Folio: {r.referencia||'Sin comprobante'}</p>{r.nota&&<p>{r.nota}</p>}</details>)}
 </section>;
}
