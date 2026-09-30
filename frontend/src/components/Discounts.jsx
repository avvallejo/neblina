import { UserRound, Percent, ShieldCheck, KeyRound, LockKeyhole, Send, Clock3, Check } from 'lucide-react';
import './Discounts.css';
import React, { useEffect, useRef, useState } from 'react';
import * as api from '../api/client.js';
import { Sheet, FormError, useAccionUnica } from './ui.jsx';
import { money } from '../lib/helpers.js';

export function DiscountSheet({ onClose, onApply, current, pedidoId, baseAmount }) {
  const [policy, setPolicy] = useState(null);
  const [admin, setAdmin] = useState(false);
  const [tipo, setTipo] = useState(current?.tipo || (current?.porcentaje && current.porcentaje !== 50 ? 'promocion' : 'empleado'));
  const [pct, setPct] = useState(current?.porcentaje || 10);
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [authorization, setAuthorization] = useState('pin');
  const [request, setRequest] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const [pinError, setPinError] = useState(false);
  const identity = useRef({ key: '', id: crypto.randomUUID() });
  const percentage = tipo === 'empleado' ? 50 : Number(pct);
  const sucursalId = api.getSucursalId();

  useEffect(() => {
    let alive = true;
    setPolicy(null);
    Promise.all([api.getDescuentosConfig(), api.getYo()]).then(([p, u]) => {
      if (alive) { setPolicy(p); setAdmin(u.rol === 'admin'); }
    }).catch(e => { if (alive) setError(e.message); });
    const refresh = () => api.getDescuentos().then(rows => {
      if (alive) setRequests(rows);
    }).catch(e => { if (alive) setError(e.message); });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [pedidoId, sucursalId]);

  const allowed = policy && (admin || (tipo === 'empleado' ? policy.empleado : policy.porcentajes.includes(percentage)));
  const hasAmount = Number.isFinite(baseAmount);
  const percentageValid = percentage > 0 && percentage < 100 && Math.abs(Math.round(percentage * 100) - percentage * 100) < 0.000001;
  const valid = policy && (!hasAmount || baseAmount > 0) && motivo.trim().length >= 3 && percentageValid;
  const netAmount = hasAmount && percentageValid ? Math.round(baseAmount * (1 - percentage / 100) * 100) / 100 : null;
  const availableRequests = requests.filter(r => !r.usada_en && !r.expirada && r.estado !== 'rechazada' && (r.pedido_id || null) === (pedidoId || null));
  const sentRequest = availableRequests.find(r => r.id === request?.id) || request;
  const pending = sentRequest?.estado === 'pendiente';

  const [busy, perform] = useAccionUnica(async mode => {
    setError(''); setPinError(false);
    try {
      if (mode === 'remove') { await onApply(null); onClose(); return; }
      let approval = mode?.id ? mode : null;
      if (!approval) {
        const payload = {
          tipo, descuentoPorcentaje: percentage, motivo: motivo.trim(), pedidoId,
          medioAutorizacion: mode === 'pin' ? 'pin' : mode === 'request' ? 'modulo' : 'directo',
          ...(mode === 'pin' ? { pin } : {}),
        };
        const key = JSON.stringify(payload);
        if (identity.current.key !== key) identity.current = { key, id: crypto.randomUUID() };
        approval = await api.solicitarDescuento({ ...payload, clientUuid: identity.current.id });
        setRequest(approval);
      }
      if (approval.estado === 'autorizada') {
        await onApply({ porcentaje: Number(approval.porcentaje), tipo: approval.tipo, autorizacion: approval.id });
        onClose();
      } else {
        setRequests(await api.getDescuentos());
      }
    } catch (e) {
      setError(e.message);
      if (e.details?.codigo === 'pin_administrador_invalido') { setPinError(true); setPin(''); }
    }
  });

  const selectType = value => { setTipo(value); setPin(''); setPinError(false); setError(''); };
  const selectAuthorization = value => { setAuthorization(value); setPin(''); setPinError(false); setError(''); };
  const submitMode = allowed ? 'direct' : authorization === 'pin' ? 'pin' : 'request';
  const samePending = availableRequests.some(r => r.estado === 'pendiente' && r.tipo === tipo && Number(r.porcentaje) === percentage && r.motivo === motivo.trim());
  const requestAlreadySent = !allowed && authorization === 'modulo' && samePending;
  const submitDisabled = !valid || requestAlreadySent || (!allowed && authorization === 'pin' && pin.length !== 4);

  return <Sheet title="Descuento del ticket" className="discount-sheet" closable={!busy} onClose={onClose}>
    <p className="discount-intro">Elige el beneficio y revisa cuánto queda por cobrar.</p>
    <fieldset className="discount-form" disabled={busy} aria-busy={busy}>
      <div className="discount-types" role="group" aria-label="Tipo de descuento">
        <button type="button" className={`discount-type ${tipo === 'empleado' ? 'is-selected' : ''}`} aria-pressed={tipo === 'empleado'} onClick={() => selectType('empleado')}>
          <UserRound size={20} aria-hidden="true"/><span><strong>Empleado</strong><small>Beneficio del personal</small></span><b>50%</b>
        </button>
        <button type="button" className={`discount-type ${tipo === 'promocion' ? 'is-selected' : ''}`} aria-pressed={tipo === 'promocion'} onClick={() => selectType('promocion')}>
          <Percent size={20} aria-hidden="true"/><span><strong>Otro descuento</strong><small>Elige el porcentaje</small></span>
        </button>
      </div>

      <div className="discount-details">
      {tipo === 'promocion' && <div className="discount-field">
        <label htmlFor="discount-percentage">Porcentaje de descuento</label>
        <div className="discount-percentage"><input id="discount-percentage" className="text-input" type="number" inputMode="decimal" min="0.01" max="99.99" step="0.01" value={pct} onChange={e => setPct(e.target.value)}/><span>%</span></div>
        <div className="discount-presets" role="group" aria-label="Porcentajes sugeridos">
          {[...new Set([5, 10, 15, 20, ...(policy?.porcentajes || [])])].sort((a,b) => a-b).map(p => <button type="button" key={p} className={percentage === p ? 'is-selected' : ''} aria-pressed={percentage === p} onClick={() => setPct(p)}>{p}%</button>)}
        </div>
      </div>}

      <div className="discount-field">
        <label htmlFor="discount-reason">{tipo === 'empleado' ? 'Nombre del empleado' : 'Motivo del descuento'}</label>
        <input id="discount-reason" className="text-input" maxLength={300} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder={tipo === 'empleado' ? 'Ej. Lupita' : 'Ej. promoción de apertura'}/>
      </div>

      {netAmount !== null && <div className="discount-receipt" aria-label="Resumen del descuento">
        <div><span>Importe antes del descuento</span><span>{money(baseAmount)}</span></div>
        <div className="discount-receipt-saving"><span>Descuento · {percentage}%</span><strong>−{money(baseAmount - netAmount)}</strong></div>
        <div className="discount-receipt-total"><span>Total a cobrar</span><strong>{money(netAmount)}</strong></div>
      </div>}

      </div>
      {!policy ? <p className="discount-help discount-loading" role="status">Consultando permisos de la sucursal…</p> : allowed ?
        <div className="discount-permission"><ShieldCheck size={20} aria-hidden="true"/><div><strong>{admin ? 'Autorizas como administrador' : 'Permitido en Caja'}</strong><p>{admin ? 'Se registrará con tu usuario.' : 'Este descuento está habilitado sin PIN.'}</p></div></div> :
        <section className="discount-authorization" aria-labelledby="discount-auth-heading">
          <div className="discount-auth-heading"><span className="discount-auth-icon"><ShieldCheck size={19} aria-hidden="true"/></span><div><h4 id="discount-auth-heading">Autorización de administrador</h4><p>Elige cómo solicitarla.</p></div></div>
          <div className="discount-auth-switch" role="group" aria-label="Forma de autorización">
            <button type="button" aria-pressed={authorization === 'pin'} className={authorization === 'pin' ? 'is-selected' : ''} onClick={() => selectAuthorization('pin')}><KeyRound size={16} aria-hidden="true"/>Con PIN</button>
            <button type="button" aria-pressed={authorization === 'modulo'} className={authorization === 'modulo' ? 'is-selected' : ''} onClick={() => selectAuthorization('modulo')}><Send size={16} aria-hidden="true"/>Desde Autorizaciones</button>
          </div>
          {authorization === 'pin' ? <div className="discount-field discount-pin-field">
            <label htmlFor="discount-admin-pin">PIN del administrador</label>
            <div className="discount-pin-input"><LockKeyhole size={18} aria-hidden="true"/><input id="discount-admin-pin" className="text-input" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" value={pin} placeholder="••••" aria-invalid={pinError} aria-describedby="discount-pin-help" onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setPinError(false); }}/></div>
            <p id="discount-pin-help" className="discount-help">Debe ser de un administrador activo de esta sucursal o general.</p>
          </div> : <p className="discount-module-help">La solicitud aparecerá en <strong>Autorizaciones → Descuentos</strong>. Podrás aplicarla cuando el administrador la apruebe.</p>}
        </section>}

      {hasAmount && baseAmount <= 0 && <FormError>Quita las marcas de cortesía para aplicar un descuento y cobrar la diferencia.</FormError>}
      {error && <div role="alert" className="discount-error"><FormError>{error}</FormError></div>}
      {pending && <div className="discount-pending" role="status"><Clock3 size={18} aria-hidden="true"/><div><strong>Solicitud enviada</strong><p>Esperando autorización. El descuento todavía no se aplica.</p></div></div>}
      <div className="discount-actions">
        <button type="button" className="btn-primary" disabled={submitDisabled} onClick={() => perform(submitMode)}>
          {busy ? 'Procesando…' : requestAlreadySent ? <><Check size={17} aria-hidden="true"/>Solicitud enviada</> : allowed ? `Aplicar ${percentage}% de descuento` : authorization === 'pin' ? <><ShieldCheck size={17} aria-hidden="true"/>Validar PIN y aplicar</> : <><Send size={17} aria-hidden="true"/>Enviar solicitud</>}
        </button>
        <p className="discount-help">Quedará registrado en el historial de Autorizaciones.</p>
        {current && <button type="button" className="btn-ghost" onClick={() => perform('remove')}>Quitar descuento actual</button>}
      </div>

      {availableRequests.length > 0 && <section className="discount-requests" aria-label="Solicitudes disponibles"><h4>Mis solicitudes</h4>{availableRequests.map(r => <div className={`discount-request ${r.estado === 'autorizada' ? 'is-approved' : ''}`} key={r.id}>
        <div><strong>{r.tipo === 'empleado' ? 'Empleado' : 'Descuento'} · {Number(r.porcentaje)}%</strong><p>{r.motivo}</p><small>{r.estado === 'autorizada' ? 'Autorizado' : 'Pendiente de autorización'}{r.autorizador_nombre ? ` · ${r.autorizador_nombre}` : ''}</small></div>
        {r.estado === 'autorizada' && <button type="button" className="btn-secondary small" disabled={hasAmount && baseAmount <= 0} onClick={() => perform(r)}><Check size={15} aria-hidden="true"/>Aplicar autorizado</button>}
      </div>)}</section>}
    </fieldset>
  </Sheet>;
}

export function DiscountsConfig() {
  const sucursalId=api.getSucursalId();
  const [employee,setEmployee]=useState(false),[percentages,setPercentages]=useState(''),[ready,setReady]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let alive=true;setReady(false);setMessage('');api.getDescuentosConfig().then(p=>{if(alive){setEmployee(p.empleado);setPercentages(p.porcentajes.join(', '));setReady(true);}}).catch(e=>{if(alive)setMessage(e.message);});return()=>{alive=false;};},[sucursalId]);
  const [busy,save]=useAccionUnica(async()=>{try{await api.guardarDescuentosConfig({empleado:employee,porcentajes:percentages.trim()?percentages.split(',').map(p=>Number(p.trim())):[]});setMessage('Permisos de descuentos guardados.');}catch(e){setMessage(e.message);}});
  return <div className="promo-summary-card"><h3>Descuentos sin autorización en Caja</h3><p>Todo descuento no habilitado aquí requiere PIN de administrador o aprobación en Autorizaciones.</p><label><input type="checkbox" disabled={!ready||busy} checked={employee} onChange={e=>setEmployee(e.target.checked)}/> Empleado · 50%</label><label className="option-label">Otros porcentajes permitidos (separados por comas)<input className="text-input" disabled={!ready||busy} value={percentages} onChange={e=>setPercentages(e.target.value)} placeholder="Ej. 5, 10, 15"/></label><button className="btn-primary" disabled={!ready||busy} onClick={save}>{busy?'Guardando…':'Guardar permisos'}</button>{message&&<p role="status">{message}</p>}</div>;
}

export function DiscountsPanel({ onResolved }) {
  const sucursalId=api.getSucursalId();
  const [rows,setRows]=useState([]),[error,setError]=useState('');
  const load=()=>api.getDescuentos().then(setRows).catch(e=>setError(e.message));
  useEffect(()=>{let alive=true;setRows([]);setError('');const refresh=()=>api.getDescuentos().then(r=>{if(alive)setRows(r);}).catch(e=>{if(alive)setError(e.message);});refresh();const t=setInterval(refresh,5000);return()=>{alive=false;clearInterval(t);};},[sucursalId]);
  const [busy,resolve]=useAccionUnica(async(id,decision)=>{try{await api.resolverDescuento(id,decision);await load();onResolved?.();}catch(e){setError(e.message);}});
  return <div><h3>Descuentos: solicitudes e historial</h3><p>Incluye los autorizados con PIN, desde este módulo y los permitidos por configuración.</p><FormError>{error}</FormError>{!rows.length&&<p>No hay descuentos registrados.</p>}{rows.map(r=><div className={`autorizacion-card ${r.estado}`} key={r.id}><strong>{r.tipo==='empleado'?'Empleado':'Descuento'} · {r.porcentaje}% · {r.folio||'Ticket por crear'}</strong><p>{r.motivo} · Solicitó: {r.solicitante_nombre}</p><p>{new Date(r.creado_en).toLocaleString('es-MX')} · {r.usada_en?'Aplicado':r.expirada?'Expirado':r.estado} · {({pin:'PIN de administrador',modulo:'Módulo de autorizaciones',configuracion:'Permitido por configuración',administrador:'Administrador'})[r.via]}{r.autorizador_nombre?` · ${r.autorizador_nombre}`:''}</p>{r.estado==='pendiente'&&!r.expirada&&<div className="option-row"><button disabled={busy} className="btn-primary" onClick={()=>resolve(r.id,'autorizar')}>Autorizar</button><button disabled={busy} className="btn-secondary" onClick={()=>resolve(r.id,'rechazar')}>Rechazar</button></div>}</div>)}</div>;
}
