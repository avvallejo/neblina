// Átomos de interfaz compartidos por todas las pantallas.
import React from 'react';
import {
  X, Check, Clock, AlertTriangle, AlertCircle, Minus, Plus, Droplets,
  Banknote, Sparkles, User,
} from 'lucide-react';
import { mmss, money } from '../lib/helpers.js';

// ACCIONES DE UNA SOLA VEZ (cobrar, confirmar pago, vender).
// En una conexión lenta el botón se queda ahí mientras la petición viaja y un
// segundo toque creaba OTRO ticket: así se duplicaron ventas. Este enganche
// bloquea la acción hasta que la primera termina (la traba es un ref, no un
// estado, para que dos toques en el mismo instante no se cuelen), y la libera
// si falla para poder reintentar. Devuelve [enCurso, ejecutar].
export function useAccionUnica(accion) {
  const [enCurso, setEnCurso] = React.useState(false);
  const corriendo = React.useRef(false);
  const montado = React.useRef(true);
  // Se marca montado en CADA pase del efecto: en desarrollo StrictMode monta,
  // desmonta y vuelve a montar, y si solo se apagara en la limpieza el
  // componente quedaría "desmontado" para siempre y el botón nunca se
  // reactivaría (la hoja del ticket abierto se quedaba trabada).
  React.useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  const ejecutar = React.useCallback(async (...args) => {
    if (corriendo.current) return undefined;
    corriendo.current = true;
    setEnCurso(true);
    try {
      return await accion(...args);
    } finally {
      corriendo.current = false;
      if (montado.current) setEnCurso(false);
    }
  }, [accion]);
  return [enCurso, ejecutar];
}

export function StatusChip({ status }) {
  const map = {
    pendiente: { label: 'Pendiente', cls: 'status-pendiente', Icon: Clock },
    en_preparacion: { label: 'En preparación', cls: 'status-en_preparacion', Icon: Droplets },
    listo: { label: 'Listo — falta cobrar', cls: 'status-listo', Icon: Banknote },
    terminado: { label: 'Terminado', cls: 'status-terminado', Icon: Check },
    cancelado: { label: 'Cancelado', cls: 'status-cancelado', Icon: X },
    no_show: { label: 'No recogido', cls: 'status-cancelado', Icon: AlertCircle },
  };
  const m = map[status] || map.pendiente;
  const { Icon } = m;
  return <span className={`status-chip ${m.cls}`}><Icon size={12} />{m.label}</span>;
}

export function UserChip({ user }) {
  if (!user) return null;
  return <span className="user-chip"><User size={12} /> {user.nombre}</span>;
}

export function Stepper({ value, min = 1, max = 99, onChange }) {
  return (
    <div className="stepper">
      <button className="stepper-btn" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Disminuir"><Minus size={15} /></button>
      <span className="stepper-value">{value}</span>
      <button className="stepper-btn" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Aumentar"><Plus size={15} /></button>
    </div>
  );
}

// Hoja inferior en móvil, modal centrado en pantallas grandes (vía CSS).
export function Sheet({ title, onClose, children }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

// CANCELAR UN TICKET (Caja y Barra). El motivo es obligatorio: es lo que lee
// el administrador en Autorizaciones para decidir. Nadie baja las ventas del
// día por su cuenta: si el ticket ya se cobró o ya se empezó a preparar, esto
// solo deja la solicitud registrada y el ticket sigue contando hasta que el
// administrador la autorice. `onSubmit(motivo)` hace la llamada.
export function CancelacionSheet({ folio, importe = null, fecha = null, inmediata = false, onClose, onSubmit }) {
  const [motivo, setMotivo] = React.useState('');
  const [error, setError] = React.useState('');
  const [enviando, enviar] = useAccionUnica(async () => {
    setError('');
    try { await onSubmit(motivo.trim()); }
    catch (e) { setError(e.message); }
  });
  return (
    <Sheet title={`Cancelar ticket ${folio || ''}`.trim()} onClose={onClose}>
      {(importe !== null || fecha) && (
        <div className="cortesia-total">
          <span className="footer-label">Importe del ticket</span>
          <span className="price-total big">{importe === null ? 'Cortesía' : money(importe)}</span>
          {fecha && <span className="field-hint">{new Date(fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</span>}
        </div>
      )}
      <div className={`cortesia-plan ${inmediata ? 'ok' : 'warn'}`} role={inmediata ? 'status' : 'alert'}>
        <strong>{inmediata ? 'Se cancela al momento' : 'Necesita autorización del administrador'}</strong>
        <span>
          {inmediata
            ? 'Este ticket no se cobró ni se empezó a preparar, así que no cambia el corte del día.'
            : 'El ticket sigue contando en las ventas del día hasta que un administrador autorice la cancelación en Autorizaciones. Al autorizarla, los insumos regresan al inventario.'}
        </span>
      </div>
      <div className="option-group">
        <label className="option-label" htmlFor="cancelacion-motivo">Motivo de la cancelación</label>
        <input
          id="cancelacion-motivo" className="text-input" maxLength={300} autoFocus
          placeholder="Ej. ticket duplicado / el cliente se arrepintió / cobro equivocado"
          value={motivo} onChange={e => setMotivo(e.target.value)}
        />
        <span className="field-hint">Escribe qué pasó: el administrador lo leerá para autorizar.</span>
        <FormError>{error}</FormError>
      </div>
      <div className="sheet-footer">
        <button className="btn-ghost" onClick={onClose} disabled={enviando}>Volver</button>
        <button className="btn-danger" disabled={enviando || motivo.trim().length < 3} onClick={enviar}>
          {enviando ? 'Enviando…' : inmediata ? 'Cancelar ticket' : 'Pedir cancelación'}
        </button>
      </div>
    </Sheet>
  );
}

export function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmLabel = 'Confirmar', danger }) {
  if (!open) return null;
  return (
    <div className="overlay overlay-center" onClick={onCancel}>
      <div className="confirm-card" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function ToastHost({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.tone === 'success' ? <Check size={16} /> : t.tone === 'warn' ? <AlertTriangle size={16} /> : <Sparkles size={16} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={28} /></div>
      <p className="empty-title">{title}</p>
      {subtitle && <p className="empty-subtitle">{subtitle}</p>}
    </div>
  );
}

export function FormError({ children }) {
  if (!children) return null;
  return <div className="form-error"><AlertTriangle size={13} /> {children}</div>;
}

/* Manómetro de tiempo del barista (elemento distintivo conservado del diseño
   original, re-entonado a la paleta nueva). */
export function Gauge({ seconds = 0, size = 84 }) {
  const value = Math.min(9, seconds / 60);
  const cx = 50, cy = 50, r = 36;
  const angleFor = v => -135 + (v / 9) * 270;
  const needleAngle = angleFor(value);
  const ticks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(v => {
    const a = (angleFor(v) * Math.PI) / 180;
    const major = v % 3 === 0;
    const rIn = major ? r - 9 : r - 5;
    return {
      v, major,
      x1: cx + rIn * Math.sin(a), y1: cy - rIn * Math.cos(a),
      x2: cx + r * Math.sin(a), y2: cy - r * Math.cos(a),
    };
  });
  const zoneColor = value < 5 ? '#3E7C4F' : value < 7.5 ? '#A66D0B' : '#C0392B';

  return (
    <div className="gauge-wrap" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx={cx} cy={cy} r={r + 7} className="gauge-face" />
        <circle cx={cx} cy={cy} r={r} className="gauge-inner" />
        {ticks.map(t => (
          <line key={t.v} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.major ? 'tick-major' : 'tick-minor'} />
        ))}
        <line x1={cx} y1={cy} x2={cx} y2={cy - r + 13} className="needle" style={{ stroke: zoneColor }} transform={`rotate(${needleAngle} ${cx} ${cy})`} />
        <line x1={cx} y1={cy} x2={cx} y2={cy + 9} className="needle-tail" style={{ stroke: zoneColor }} transform={`rotate(${needleAngle} ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r="4.2" style={{ fill: zoneColor }} />
      </svg>
      <div className="gauge-readout" style={{ color: zoneColor }}>{mmss(seconds)}</div>
    </div>
  );
}
