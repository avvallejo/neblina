import React, { useEffect, useRef, useState } from 'react';
import { Check, ClipboardList } from 'lucide-react';
import * as api from '../api/client.js';
import { fmtHora, TZ_NEGOCIO } from '../lib/helpers.js';
import { destinoLabel } from '../lib/catalog.js';
import { deliveryLabel, groupCashCommands, readyUnits } from '../lib/preparationTracking.js';
import { useAccionUnica } from '../components/ui.jsx';

export default function CajaComandas({ initialHistory = false, readOnly = false }) {
  const [view, setView] = useState(initialHistory ? 'preparados' : 'pendientes');
  const history = view !== 'pendientes';
  const deliveries = view === 'entregas';
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: TZ_NEGOCIO, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date()));
  const [employee, setEmployee] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const requestSeq = useRef(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setRows([]);
    const load = async () => {
      const id = ++requestSeq.current;
      try {
        const data = await api.getComandasCaja({ historial: deliveries ? 'entregas' : history, fecha: history ? date : undefined });
        if (alive && id === requestSeq.current) { setRows(data); setError(''); setLoading(false); }
      } catch (e) { if (alive && id === requestSeq.current) { setError(e.message); setLoading(false); } }
    };
    load();
    const timer = setInterval(load, 3500);
    return () => { alive = false; clearInterval(timer); };
  }, [view, date, revision]);
  const [busy, deliver] = useAccionUnica(async (item, quantity) => {
    try {
      await api.entregarProducto(item.pedido_id, item.id, quantity, Number(item.cantidad_entregada || 0));
      // Actualiza esta línea sin ocultar ni recrear el resto de la comanda.
      const id = ++requestSeq.current;
      const data = await api.getComandasCaja();
      if (id === requestSeq.current) { setRows(data); setError(''); }
    } catch (e) { setError(e.message); }
  });
  const employeeId = item => (deliveries ? item.entregado_por : item.terminado_por) || 'unknown';
  const employees = [...new Map(rows.map(item => [employeeId(item), (deliveries ? item.entregado_por_nombre : item.terminado_por_nombre) || 'Sin registro histórico'])).entries()];
  const visible = history && employee ? rows.filter(item => employeeId(item) === employee) : rows;
  const groups = groupCashCommands(visible);
  return <div className="cash-commands">
    <div className="cash-command-tools">
      <button className={`btn-${history ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => { setView('pendientes'); setEmployee(''); }}>Por entregar</button>
      <button className={`btn-${view === 'preparados' ? 'primary' : 'secondary'}`} disabled={busy} onClick={() => { setView('preparados'); setEmployee(''); }}>Preparados por empleado</button>
      <button className={`btn-${deliveries ? 'primary' : 'secondary'}`} disabled={busy} onClick={() => { setView('entregas'); setEmployee(''); }}>Entregas por empleado</button>
      {history && <>
        <label>{deliveries ? 'Fecha de entrega' : 'Fecha de preparación'}<input className="text-input" type="date" value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setEmployee(''); } }}/></label>
        <label>Empleado<select aria-label="Empleado" className="text-input" value={employee} onChange={e => setEmployee(e.target.value)}>
          <option value="">Todos</option>
          {employees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
      </>}
      <button className="btn-secondary" disabled={busy} onClick={() => setRevision(n=>n+1)}>Actualizar</button>
    </div>
    <p className="field-hint">{deliveries ? 'Cada entrega conserva la persona, fecha y cantidad. Incluye productos sin preparación y entregas parciales.' : history ? 'Consulta lo preparado aunque ya se haya cobrado o entregado. Los registros anteriores pueden no indicar quién pulsó Terminar.' : 'Se actualiza automáticamente. Preparado no significa entregado: registra la entrega cuando el cliente reciba el producto. Cobrar no cambia esta lista.'}</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {loading ? <p role="status">Cargando comandas…</p> : <>
      <p className="cash-command-summary">{history
        ? `${visible.reduce((sum, item) => sum + Number(deliveries ? item.unidades_entregadas_evento : item.cantidad), 0)} unidades ${deliveries ? 'entregadas' : 'preparadas'} · ${groups.length} ticket${groups.length === 1 ? '' : 's'}`
        : `${readyUnits(rows)} productos listos para entregar · ${groups.length} ticket${groups.length === 1 ? '' : 's'} en curso`}</p>
      {!groups.length && <p>{history ? 'No hay registros para esta fecha y empleado.' : 'No hay productos pendientes de preparar o entregar.'}</p>}
      <div className="preparation-board">
        {groups.map(group => <section key={group.pedido_id} className="preparation-order horizontal-order">
          <header className="preparation-order-header">
            <div className="ticket-id">Ticket {group.folio}</div>
            <h2>{group.nombre_ticket || group.cliente_nombre || 'Sin nombre registrado'}</h2>
            <div>Levantó: <strong>{group.levantado_por_nombre || 'Pedido en línea'}</strong></div>
            <p>{destinoLabel({destino:group.destino,mesaNumero:group.mesa_numero,origen:group.origen})}</p>
            <small>{group.cobrado ? 'Cobrado' : 'Por cobrar'}</small>
            {group.cancelado || group.no_show ? <p>Ticket {group.cancelado ? 'cancelado' : 'no recogido'}</p> : group.cancelacion_estado === 'pendiente' ? <p>Cancelación pendiente · entrega bloqueada</p> : null}
            {!history && <p><strong>{readyUnits(group.items)} listos para entregar</strong></p>}
          </header>
          <div className="preparation-order-body cash-command-items">
            {group.items.map(item => {
              const remaining = Math.max(0, Number(item.cantidad) - Number(item.cantidad_entregada || 0));
              const canDeliver = !readOnly && !history && item.estado === 'terminado' && remaining > 0 && !group.cancelado && !group.no_show && group.cancelacion_estado !== 'pendiente';
              return <div key={item.entrega_id || item.id} className={`cash-command-item ${item.estado === 'terminado' ? 'ready' : ''}`}>
                <div>
                  <strong>{deliveries ? item.unidades_entregadas_evento : item.cantidad} × {item.producto_nombre}</strong>
                  <div className="ticket-product-sub">{item.estacion === 'caja' ? 'Caja · Sin preparación' : item.estacion === 'parrilla' ? 'Parrilla' : 'Barra'} · {[item.tamano,item.leche,item.cafe,...(item.extras||[])].filter(Boolean).join(' · ')}</div>
                  {item.notas && <div className="order-notes">{item.notas}</div>}
                  <div className="cash-preparation-status">{item.estado === 'terminado' ? <Check size={15}/> : <ClipboardList size={15}/>} {deliveries ? 'Entrega registrada' : deliveryLabel(item)}</div>
                  {!deliveries && item.estacion !== 'caja' && item.terminado_en && <small className="prepared-by">Terminó: {item.terminado_por_nombre || 'Sin registro histórico'} · {fmtHora(item.terminado_en)}</small>}
                  {!deliveries && item.estacion !== 'caja' && !item.terminado_por && item.iniciado_por_nombre && <small className="prepared-by">Inició: {item.iniciado_por_nombre}</small>}
                  {deliveries && <small className="prepared-by">Entregó: {item.entregado_por_nombre || 'Sin registro'} · {fmtHora(item.entregado_en)}</small>}
                  {!deliveries && Number(item.cantidad_entregada) > 0 && <small className="prepared-by">Entregados: {item.cantidad_entregada} de {item.cantidad} · Última entrega: {item.entregado_por_nombre || 'Sin registro'}{item.entregado_en ? ` · ${fmtHora(item.entregado_en)}` : ''}</small>}
                </div>
                {canDeliver && <div className="cash-delivery-actions">
                  {remaining > 1 && <button className="btn-secondary" disabled={busy} onClick={() => deliver(item,1)}>Entregar 1</button>}
                  <button className="btn-primary" disabled={busy} onClick={() => deliver(item,remaining)}>{remaining > 1 ? `Entregar ${remaining}` : 'Marcar entregado'}</button>
                </div>}
              </div>;
            })}
          </div>
        </section>)}
      </div>
    </>}
  </div>;
}
