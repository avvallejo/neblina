import React,{useEffect,useState} from 'react';
import {Sheet} from '../components/ui';
import {money} from '../lib/helpers';
import * as api from '../api/client';
export default function CajaDinero({open,onClose,turnoAbierto,onToggleTurno,addToast}){
 const [data,setData]=useState(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[fund,setFund]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){const r=await api.getCajaTurno();setData(r);setLoaded(true);setError('');}
 useEffect(()=>{let alive=true;const load=()=>api.getCajaTurno().then(r=>{if(alive){setData(r);setLoaded(true);setError('');}}).catch(e=>{if(alive)setError(e.message);});load();const t=setInterval(load,5000);return()=>{alive=false;clearInterval(t);};},[turnoAbierto,open]);
 const missing=data?.fondo_inicial===null;
 const unknown=Number(data?.pagos_sin_desglose||0)>0;
 const expected=data&&!missing&&!unknown?Number(data.fondo_inicial)+Number(data.ventas_efectivo):null;
 const metrics=data&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:16,padding:16,border:'1px solid var(--border)',borderRadius:14,background:'var(--surface,#fff)',marginBottom:16}}>
  <div><div className="footer-label">Ventas del día · todos los medios</div><strong>{money(data.ventas_dia)}</strong></div>
  <div><div className="footer-label">Fondo inicial</div><strong>{missing?'Por registrar':money(data.fondo_inicial)}</strong></div>
  <div><div className="footer-label">Ventas en efectivo del turno</div><strong>{money(data.ventas_efectivo)}</strong></div>
  <div><div className="footer-label">Otros medios del turno</div><strong>{money(data.ventas_no_efectivo)}</strong></div>
  <div><div className="footer-label">Efectivo esperado en caja</div><strong style={{color:'var(--brand)',fontSize:22}}>{expected===null?'Pendiente':money(expected)}</strong></div>
 </div>;
 async function save(){setBusy(true);setError('');try{
  if(data){await api.registrarFondoTurno(data.id,Number(fund));addToast('Fondo inicial registrado, separado de las ventas','success');}
  else if(await onToggleTurno({fondoInicial:Number(fund)})===false)return;
  await refresh();setFund('');onClose();
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 async function closeShift(){if(!window.confirm('¿Cerrar este turno? El fondo inicial y sus ventas quedarán guardados.'))return;setBusy(true);try{if(await onToggleTurno()!==false){await refresh();onClose();}}finally{setBusy(false);}}
 return <>
 {metrics}
 {error&&!open&&<p role="alert">No se pudo actualizar Caja: {error}</p>}
 {open&&<Sheet title={data?'Caja del turno':'Abrir turno'} onClose={onClose}>
  {metrics}
  {data&&<p className="field-hint">Turno abierto el {new Date(data.abierto_en).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}. Ventas totales del turno: {money(data.ventas_turno)}.</p>}
  {(!data||missing)&&<><label className="option-label" htmlFor="opening-fund">¿Con cuánto efectivo comenzó la caja?</label><input id="opening-fund" className="text-input" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Ej. 500.00" value={fund} onChange={e=>setFund(e.target.value)}/><p className="field-hint">Es el dinero para cambio al iniciar, sin incluir ventas. Si comenzaste sin fondo, escribe 0.{missing?' El turno sigue abierto y sus ventas se conservan.':''}</p><button className="btn-primary" disabled={!loaded||busy||fund.trim()===''||!Number.isFinite(Number(fund))||Number(fund)<0} onClick={save}>{busy?'Guardando…':data?'Registrar fondo inicial':'Abrir turno con este fondo'}</button></>}
  {unknown&&<p role="alert">Hay {data.pagos_sin_desglose} pago(s) mixto(s) antiguos sin desglose. El efectivo esperado queda pendiente para no sumar un monto incorrecto.</p>}
  {data&&<><p className="field-hint">Efectivo esperado = fondo inicial + ventas cobradas en efectivo. No incluye retiros ni gastos pagados fuera del sistema.</p><button className="btn-ghost" disabled={busy} onClick={closeShift}>Cerrar turno</button></>}
  {error&&<p role="alert">{error}</p>}
 </Sheet>}
 </>;
}
