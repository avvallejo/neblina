import React, { useEffect, useState } from 'react';
import * as api from '../api/client.js';
import { Sheet, FormError, useAccionUnica } from './ui.jsx';
export default function SessionGuard({ user, onRestored, onExit }) {
  const [required,setRequired]=useState(false),[pin,setPin]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const expired=()=>setRequired(true);window.addEventListener('cafeteria:session-required',expired);return()=>window.removeEventListener('cafeteria:session-required',expired);},[]);
  const [busy,restore]=useAccionUnica(async()=>{setError('');try{const u=await api.reauthenticate(pin,user.id);setRequired(false);setPin('');onRestored(u);}catch(e){setError(e.message);}});
  if(!required)return null;
  return <Sheet title="Confirma tu sesión para continuar" closable={false}><p>Tu captura sigue aquí. Ingresa el PIN de {user.nombre}; al continuar, revisa el ticket y vuelve a realizar la acción pendiente.</p><form onSubmit={e=>{e.preventDefault();restore();}}><label className="option-label">Tu PIN<input className="text-input" autoFocus type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/></label><FormError>{error}</FormError><button className="btn-primary" disabled={busy||pin.length!==4}>{busy?'Validando…':'Continuar con mi captura'}</button>{onExit && <button type="button" className="btn-ghost" disabled={busy} onClick={()=>{if(window.confirm("¿Salir al inicio? Se perderá lo que aún no hayas enviado. Los tickets guardados se conservan."))onExit();}}>Salir al inicio</button>}</form></Sheet>;
}
