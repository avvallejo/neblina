import React from 'react';
import { CalendarDays, RotateCcw } from 'lucide-react';

export default function SalesDateFilter({ value, reportDate, onChange }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date());
  const selected = value || reportDate || today;
  const label = new Intl.DateTimeFormat('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${selected}T12:00:00Z`));

  return <section className="sales-date-filter" aria-label="Fecha del resumen de ventas">
    <div className="sales-date-main">
      <div className="sales-date-heading">
        <span className="sales-date-icon" aria-hidden="true"><CalendarDays size={22}/></span>
        <div className="sales-date-copy">
          <label htmlFor="admin-sales-date">Fecha de ventas</label>
          <strong>{label}</strong>
          <span>Hora de Ciudad de México</span>
        </div>
      </div>
      <div className="sales-date-controls">
        <input id="admin-sales-date" className="text-input sales-date-input" type="date" value={selected}
          aria-describedby="sales-date-hint" onChange={e=>onChange(e.target.value)}/>
        <button type="button" className={`sales-date-today${selected===today?' active':''}`} aria-pressed={selected===today} onClick={()=>onChange('')}>
          <RotateCcw size={15} aria-hidden="true"/> Hoy
        </button>
      </div>
    </div>
    <p id="sales-date-hint" className="sales-date-hint">Pedidos registrados en esta fecha. Solo las ventas cobradas se suman; no hace falta cerrar turno.</p>
  </section>;
}
