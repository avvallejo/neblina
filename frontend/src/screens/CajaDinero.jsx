import React,{useEffect,useState} from 'react';
import {Sheet} from '../components/ui';
import {Wallet, Receipt, CalendarDays, ArrowDownLeft, Gift} from 'lucide-react';
import {money} from '../lib/helpers';
import * as api from '../api/client';
export default function CajaDinero({open,onOpen,onClose,turnoAbierto,onToggleTurno,addToast}){
 const [data,setData]=useState(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[fund,setFund]=useState(''),[busy,setBusy]=useState(false);
 const [plan,setPlan]=useState(null); // cupo de cortesías del mes (compartido por la sucursal)
 // Salidas de caja del turno (pagar al proveedor, hielo, un mandado): bajan el
 // efectivo esperado y quedan como egreso real en Contabilidad.
 const [salidas,setSalidas]=useState([]),[cuentasSalida,setCuentasSalida]=useState([]),[nuevaSalida,setNuevaSalida]=useState(false);
 const [sConcepto,setSConcepto]=useState(''),[sMonto,setSMonto]=useState(''),[sCuenta,setSCuenta]=useState(''),[sError,setSError]=useState(''),[sBusy,setSBusy]=useState(false);
 useEffect(()=>{if(!open||!data)return undefined;let alive=true;api.getSalidasTurno().then(r=>{if(alive)setSalidas(r);}).catch(()=>{});api.getCuentasSalidaTurno().then(r=>{if(alive)setCuentasSalida(r);}).catch(()=>{});return()=>{alive=false;};},[open,data?.num_salidas_turno,data?.id]);
 async function registrarSalida(){const m=Number(sMonto);if(!sConcepto.trim()){setSError('Escribe qué se pagó.');return;}if(!Number.isFinite(m)||m<=0){setSError('Indica el monto.');return;}setSBusy(true);setSError('');try{await api.registrarSalidaTurno({concepto:sConcepto.trim(),monto:Math.round(m*100)/100,cuentaContableId:sCuenta?Number(sCuenta):undefined});addToast('Salida de caja registrada','success');setSConcepto('');setSMonto('');setNuevaSalida(false);await refresh();setSalidas(await api.getSalidasTurno());}catch(e){setSError(e.message);}finally{setSBusy(false);}}
 async function refresh(){const r=await api.getCajaTurno();setData(r);setLoaded(true);setError('');}
 useEffect(()=>{let alive=true;const load=()=>api.getCajaTurno().then(r=>{if(alive){setData(r);setLoaded(true);setError('');}}).catch(e=>{if(alive)setError(e.message);});load();const t=setInterval(load,5000);return()=>{alive=false;clearInterval(t);};},[turnoAbierto,open]);
 useEffect(()=>{if(!open)return undefined;let alive=true;api.getPlanCortesias().then(p=>{if(alive)setPlan(p);}).catch(()=>{if(alive)setPlan(null);});return()=>{alive=false;};},[open,data?.cortesias_turno]);
 const missing=data?.fondo_inicial===null;
 const unknown=Number(data?.pagos_sin_desglose||0)>0;
 const expected=data&&!missing&&!unknown?Number(data.fondo_inicial)+Number(data.ventas_efectivo)-Number(data.salidas_turno||0):null;
 const abiertoTexto=data&&new Date(data.abierto_en).toLocaleString('es-MX',{timeZone:'America/Mexico_City',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit'});
 const salidas_=Number(data?.salidas_turno||0), cortesias_=Number(data?.cortesias_turno||0);
 // Resumen del turno: primero el dato que el cajero necesita (cuánto efectivo
 // debe haber en el cajón) y con qué cuentas sale; lo demás, en fichas.
 const metrics=data?<section className="caja-resumen">
  <header className="caja-resumen-head">
   <span className="caja-estado abierto"><span className="caja-estado-punto"/>Turno abierto</span>
   <span className="field-hint">Desde el {abiertoTexto}</span>
  </header>
  <div className="caja-hero">
   <span className="caja-hero-icono"><Wallet size={19}/></span>
   <div>
    <span className="footer-label">Efectivo esperado en caja</span>
    <strong className="caja-hero-monto">{expected===null?'Pendiente':money(expected)}</strong>
    <span className="caja-hero-cuenta">
     {missing?'Falta registrar el fondo inicial de este turno.'
      :unknown?`${data.pagos_sin_desglose} pago(s) mixto(s) sin desglose: el cálculo queda pendiente.`
      :`Fondo ${money(data.fondo_inicial)} + efectivo ${money(data.ventas_efectivo)}${salidas_>0?` − salidas ${money(salidas_)}`:''}`}
    </span>
   </div>
  </div>
  <div className="caja-fichas">
   <div className="caja-ficha">
    <span className="caja-ficha-icono"><Receipt size={15}/></span>
    <span className="footer-label">Ventas del turno</span>
    <strong>{money(data.ventas_turno)}</strong>
    <span className="field-hint">Efectivo {money(data.ventas_efectivo)} · otros {money(data.ventas_no_efectivo)}</span>
   </div>
   <div className="caja-ficha">
    <span className="caja-ficha-icono"><CalendarDays size={15}/></span>
    <span className="footer-label">Ventas del día</span>
    <strong>{money(data.ventas_dia)}</strong>
    <span className="field-hint">Todos los medios del día</span>
   </div>
   <div className="caja-ficha">
    <span className="caja-ficha-icono"><ArrowDownLeft size={15}/></span>
    <span className="footer-label">Salidas de caja</span>
    <strong className={salidas_>0?'caja-ficha-resta':''}>{salidas_>0?`− ${money(salidas_)}`:money(0)}</strong>
    <span className="field-hint">{Number(data.num_salidas_turno||0)>0?`${data.num_salidas_turno} salida(s) del turno`:'Sin salidas en este turno'}</span>
   </div>
   <div className="caja-ficha">
    <span className="caja-ficha-icono"><Gift size={15}/></span>
    <span className="footer-label">Cortesías</span>
    <strong>{cortesias_} · {money(data.cortesias_valor_turno||0)}</strong>
    {Number(data.cortesias_pendientes_turno||0)>0
     ?<span className="field-hint caja-ficha-alerta">{data.cortesias_pendientes_turno} pendiente(s) de autorización</span>
     :<span className="field-hint">No suman a las ventas</span>}
   </div>
  </div>
 </section>:null;
 // Sin turno abierto no hay efectivo que arquear: en vez de no mostrar nada,
 // se dice por qué y se ofrece abrirlo.
 const resumenCerrado=!data&&loaded&&<section className="caja-resumen cerrado">
  <div className="caja-resumen-head">
   <span className="caja-estado"><span className="caja-estado-punto"/>Turno cerrado</span>
   <span className="field-hint">El resumen del efectivo aparece cuando hay un turno abierto. Ábrelo para registrar el fondo inicial y empezar a cobrar.</span>
  </div>
  {onOpen&&<button className="btn-secondary" onClick={onOpen}>Abrir turno</button>}
 </section>;
 const planCortesias=plan&&<p className="field-hint">Cortesías de {plan.mesNombre} (cupo de la sucursal): {plan.usadas} de {plan.limite} usadas{plan.restantes>0?` · quedan ${plan.restantes}`:' · cupo agotado: las siguientes requieren autorización'}{plan.pendientes>0?` · ${plan.pendientes} pendiente(s) de autorizar`:''}.</p>;
 async function save(){setBusy(true);setError('');try{
  if(data){await api.registrarFondoTurno(data.id,Number(fund));addToast('Fondo inicial registrado, separado de las ventas','success');}
  else if(await onToggleTurno({fondoInicial:Number(fund)})===false)return;
  await refresh();setFund('');onClose();
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 async function closeShift(){if(!window.confirm('¿Cerrar este turno? El fondo inicial y sus ventas quedarán guardados.'))return;setBusy(true);try{if(await onToggleTurno()!==false){await refresh();onClose();}}finally{setBusy(false);}}
 return <>
 {!open&&(metrics||resumenCerrado)}
 {error&&!open&&<p role="alert" className="form-error">No se pudo actualizar Caja: {error}</p>}
 {open&&<Sheet title={data?'Caja del turno':'Abrir turno'} onClose={onClose}>
  {metrics}
  {data&&<p className="field-hint">Turno abierto el {new Date(data.abierto_en).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}. Ventas totales del turno: {money(data.ventas_turno)} (las cortesías no suman).</p>}
  {planCortesias}
  {(!data||missing)&&<><label className="option-label" htmlFor="opening-fund">¿Con cuánto efectivo comenzó la caja?</label><input id="opening-fund" className="text-input" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Ej. 500.00" value={fund} onChange={e=>setFund(e.target.value)}/><p className="field-hint">Es el dinero para cambio al iniciar, sin incluir ventas. Si comenzaste sin fondo, escribe 0.{missing?' El turno sigue abierto y sus ventas se conservan.':''}</p><button className="btn-primary" disabled={!loaded||busy||fund.trim()===''||!Number.isFinite(Number(fund))||Number(fund)<0} onClick={save}>{busy?'Guardando…':data?'Registrar fondo inicial':'Abrir turno con este fondo'}</button></>}
  {unknown&&<p role="alert">Hay {data.pagos_sin_desglose} pago(s) mixto(s) antiguos sin desglose. El efectivo esperado queda pendiente para no sumar un monto incorrecto.</p>}
  {data&&!missing&&<div className="salidas-caja">
   <div className="option-label">Salidas de caja del turno</div>
   {salidas.length===0&&<p className="field-hint">Ninguna. Si pagas algo con el efectivo de la caja (proveedor, hielo, un mandado), regístralo aquí para que el arqueo cuadre y quede en Contabilidad.</p>}
   {salidas.map(s=><div key={s.id} className="salida-row"><span>{s.concepto}<small> · {s.cuenta_nombre}{s.usuario_nombre?` · ${s.usuario_nombre}`:''}</small></span><strong>− {money(s.monto)}</strong></div>)}
   {!nuevaSalida?<button className="btn-secondary" onClick={()=>setNuevaSalida(true)}>Registrar salida de caja</button>:<div className="salida-form">
    <input className="text-input" placeholder="¿Qué se pagó? Ej. hielo, pan del proveedor" value={sConcepto} onChange={e=>setSConcepto(e.target.value)} autoFocus/>
    <div className="option-group two-col" style={{marginTop:8}}>
     <input className="text-input" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Monto" value={sMonto} onChange={e=>setSMonto(e.target.value)}/>
     <select className="text-input" value={sCuenta} onChange={e=>setSCuenta(e.target.value)}><option value="">Otros gastos de operación</option>{cuentasSalida.filter(c=>c.clave!=='otros_gastos').map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
    </div>
    {sError&&<p role="alert">{sError}</p>}
    <div className="option-row" style={{marginTop:8}}><button className="btn-primary" disabled={sBusy} onClick={registrarSalida}>{sBusy?'Guardando…':'Registrar'}</button><button className="btn-ghost" onClick={()=>{setNuevaSalida(false);setSError('');}}>Cancelar</button></div>
   </div>}
  </div>}
  {data&&<><p className="field-hint">Efectivo esperado = fondo inicial + ventas cobradas en efectivo − salidas de caja registradas.</p><button className="btn-ghost" disabled={busy} onClick={closeShift}>Cerrar turno</button></>}
  {error&&<p role="alert">{error}</p>}
 </Sheet>}
 </>;
}
