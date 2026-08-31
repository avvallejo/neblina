// Entrada de la app: elegir sucursal -> ordenar como cliente o entrar como
// personal (PIN). En pantallas grandes es una tarjeta centrada; en el
// teléfono ocupa la pantalla completa.
import React, { useState, useEffect } from 'react';
import { Coffee, Lock, ChevronLeft, ChevronRight, MapPin, AlertTriangle } from 'lucide-react';
import * as api from '../api/client.js';
import { FormError } from '../components/ui.jsx';

function PinGate({ onSuccess, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const press = digit => {
    if (pin.length >= 4 || error || loading) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      setLoading(true);
      api.login(next)
        .then(u => onSuccess(u))
        .catch(err => {
          setError(true);
          setErrorMsg(err.status === 401 ? 'PIN incorrecto, intenta otra vez.' : err.message);
          setLoading(false);
          setTimeout(() => { setError(false); setErrorMsg(''); setPin(''); }, 900);
        });
    }
  };
  const del = () => setPin(p => p.slice(0, -1));

  // En computadora el PIN también se escribe con el teclado físico:
  // dígitos (incluido el teclado numérico), retroceso para borrar y
  // Escape para volver.
  useEffect(() => {
    const onKeyDown = e => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); del(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div className="card pad pin-gate" style={{ position: 'relative' }}>
      <button className="icon-btn" style={{ position: 'absolute', left: 14, top: 14 }} onClick={onCancel} aria-label="Volver"><ChevronLeft size={20} /></button>
      <div className="registro-icon" style={{ margin: '0 auto 10px' }}><Lock size={24} /></div>
      <h2 style={{ fontSize: 19 }}>Acceso del personal</h2>
      <p className="registro-sub" style={{ textAlign: 'center' }}>
        {api.getSucursal() ? `Sucursal ${api.getSucursal().nombre} — ` : ''}ingresa tu PIN de 4 dígitos
      </p>
      <div className={`pin-dots ${error ? 'error' : ''}`}>
        {[0, 1, 2, 3].map(i => <span key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />)}
      </div>
      {errorMsg && <FormError>{errorMsg}</FormError>}
      <div className="pin-keypad">
        {keys.map((k, i) => (
          k === '' ? <span key={i} /> :
          k === 'del' ? (
            <button key={i} className="pin-key" onClick={del} aria-label="Borrar"><ChevronLeft size={18} /></button>
          ) : (
            <button key={i} className="pin-key" onClick={() => press(k)}>{k}</button>
          )
        ))}
      </div>
    </div>
  );
}

function SedePicker({ sedes, onPick, subtitle }) {
  return (
    <>
      <p className="registro-sub" style={{ textAlign: 'center', marginBottom: 4 }}>{subtitle || '¿En qué sucursal estás?'}</p>
      <div className="sede-select-list">
        {sedes.map(s => (
          <button key={s.id} className="sede-option" onClick={() => onPick(s)}>
            <span className="sede-icon"><MapPin size={20} /></span>
            <span style={{ flex: 1 }}>{s.nombre}</span>
            <ChevronRight size={18} style={{ color: 'var(--ink-faint)' }} />
          </button>
        ))}
      </div>
    </>
  );
}

export default function Landing({ sedes, sede, onPickSede, onSelectCliente, onStaffLogin, nombreNegocio, logo }) {
  const [showPin, setShowPin] = useState(false);
  const necesitaSede = !sede;

  return (
    <div className="landing">
      <div className="landing-card">
        <div className="landing-head">
          <span className={`brand-mark${logo ? ' has-logo' : ''}`}>{logo ? <img src={logo} alt="" /> : <Coffee size={30} />}</span>
          <h1>{nombreNegocio || 'Mi Cafetería'}</h1>
          <p>Especialidad sobre ruedas</p>
          {sede && !showPin && (
            <button className="sede-pill" style={{ marginTop: 10 }} onClick={() => onPickSede(null)}>
              <MapPin size={13} /> {sede.nombre} — cambiar
            </button>
          )}
        </div>

        {necesitaSede ? (
          sedes.length === 0 ? (
            <div className="card pad" style={{ textAlign: 'center', color: 'var(--ink-faint)', fontWeight: 600 }}>
              <AlertTriangle size={18} style={{ marginBottom: 6 }} /><br />
              No hay sucursales activas configuradas.
            </div>
          ) : (
            <SedePicker sedes={sedes} onPick={onPickSede} />
          )
        ) : showPin ? (
          <PinGate onSuccess={onStaffLogin} onCancel={() => setShowPin(false)} />
        ) : (
          <>
            <button className="client-cta" onClick={onSelectCliente}>
              <span className="client-cta-icon"><Coffee size={26} /></span>
              <span style={{ flex: 1 }}>
                <span className="client-cta-title">Ordenar mi café</span>
                <span className="client-cta-sub">Regístrate, mira el menú y levanta tu pedido</span>
              </span>
              <ChevronRight size={18} />
            </button>
            <button className="staff-link" onClick={() => setShowPin(true)}>
              <Lock size={14} /> Acceso del personal
            </button>
          </>
        )}
      </div>
    </div>
  );
}
