import React, { useEffect, useState } from 'react';
import * as api from '../api/client.js';
import { Sheet, useAccionUnica, StatusChip } from '../components/ui.jsx';
import { money } from '../lib/helpers.js';

export default function OpenTicketSheet({ order, onClose, onAdd, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [correction, setCorrection] = useState(null);
  const [reason, setReason] = useState('');
  const [returned, setReturned] = useState(false);
  const load = async () => { const next = await api.getPedido(order.id); setData(next); return next; };
  useEffect(() => {
    let alive = true;
    const refresh = () => api.getPedido(order.id).then(d => { if (alive) setData(d); }).catch(e => { if (alive) setError(e.message); });
    refresh();
    const timer = setInterval(refresh, 3500);
    return () => { alive = false; clearInterval(timer); };
  }, [order.id]);
  const [busy, change] = useAccionUnica(async (item, cantidad, details = {}) => {
    setError('');
    try {
      await api.cambiarCantidadPedido(order.id, item.id, cantidad, Number(item.cantidad), details);
      setCorrection(null); setReason(''); setReturned(false);
      await load();
      await onChanged();
    } catch (e) {
      setError(e.message);
      try { await load(); } catch { /* mostrar el error original */ }
    }
  });
  const beginChange = (item, cantidad) => {
    if (item.estacion === 'caja' && item.estado === 'terminado') {setCorrection({item,cantidad});setReason('');setReturned(false);setError('');}
    else change(item,cantidad);
  };
  const editable = data && !data.cobrado && !data.cancelado && !data.no_show && data.cancelacion_estado !== 'pendiente' && !data.es_regalo_fidelidad && !data.registro_manual;
  return <Sheet title={`Ticket ${order.folio} · Por cobrar`} onClose={() => { if (!busy) onClose(); }}>
    <p>Agrega productos al mismo ticket. Puedes cambiar productos pendientes de preparación y corregir los entregados en caja antes del cobro.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {correction && <fieldset disabled={busy} style={{padding:16,margin:'12px 0',border:'1px solid var(--brand)',borderRadius:12}}>
      <legend>Corregir {correction.item.producto_nombre}</legend>
      <p>{correction.cantidad === 0 ? 'Retirar del ticket' : `Cambiar de ${correction.item.cantidad} a ${correction.cantidad}`}. Se ajustarán el total y las existencias.</p>
      <label>Motivo<input className="text-input" maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ej. Cambió refresco por jamaica"/></label>
      {correction.cantidad < Number(correction.item.cantidad) && <label style={{display:'block',marginTop:12}}><input type="checkbox" checked={returned} onChange={e=>setReturned(e.target.checked)}/> No se entregó o fue devuelto sin consumir, en condiciones de venderse de nuevo.</label>}
      <div className="sheet-footer"><button className="btn-secondary" onClick={()=>setCorrection(null)}>Volver</button><button className="btn-primary" disabled={reason.trim().length<3 || (correction.cantidad<Number(correction.item.cantidad) && !returned)} onClick={()=>change(correction.item,correction.cantidad,{motivo:reason,devuelto:returned})}>Confirmar corrección</button></div>
    </fieldset>}
    {!data && !error && <p>Cargando ticket…</p>}
    {data?.items.map(item => <div className="cart-item" key={item.id}>
      <div className="cart-item-info">
        <strong>{item.producto_nombre}</strong>
        <div className="cart-item-sub">{[item.tamano_etiqueta, item.leche_etiqueta, item.cafe_etiqueta, ...(item.extras || [])].filter(Boolean).join(' · ')}</div>
        {item.notas && <div>{item.notas}</div>}
        {item.estado === 'cancelado' ? <small>Retirado del ticket · no se cobra</small> : <StatusChip status={item.estado}/>}
        {item.estado === 'terminado' && item.estacion === 'caja' && <small> Entregado en caja. Puedes corregirlo con motivo; si retiras unidades, deben estar disponibles para volver al inventario.</small>}
        {item.estado !== 'pendiente' && item.estado !== 'cancelado' && item.estacion !== 'caja' && <small> Ya está en preparación o entregado; no se modifica desde aquí.</small>}
      </div>
      <div className="cart-item-controls">
        <span>{item.cantidad} × {money(item.precio_unitario)}</span>
        {editable && (item.estado === 'pendiente' || (item.estacion === 'caja' && item.estado === 'terminado')) && <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <button className="btn-secondary small" disabled={busy || !!correction || Number(item.cantidad) <= 1} onClick={() => beginChange(item, Number(item.cantidad)-1)} aria-label={`Restar uno a ${item.producto_nombre}`}>−</button>
          <button className="btn-secondary small" disabled={busy || !!correction || Number(item.cantidad) >= 50} onClick={() => beginChange(item, Number(item.cantidad)+1)} aria-label={`Agregar uno a ${item.producto_nombre}`}>+</button>
          <button className="link-danger" disabled={busy || !!correction} onClick={() => { if (window.confirm(`¿Quitar ${item.producto_nombre} de la comanda?`)) beginChange(item,0); }}>Quitar</button>
        </div>}
      </div>
    </div>)}
    {data && <div className="summary-row total"><span>Total por cobrar</span><span>{money(data.total)}</span></div>}
    {Number(data?.descuento_porcentaje) > 0 && <p>Descuento del ticket: {data.descuento_porcentaje}%.</p>}
    {data && !editable && <p>Este ticket ya no admite cambios. Cierra el detalle y actualiza la lista.</p>}
    <div className="sheet-footer">
      <button className="btn-secondary" disabled={busy} onClick={onClose}>Cerrar</button>
      <button className="btn-primary" disabled={!editable || busy || !!correction} onClick={() => onAdd(data)}>Agregar productos</button>
    </div>
  </Sheet>;
}
