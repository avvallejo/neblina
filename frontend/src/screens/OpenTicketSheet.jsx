import React, { useEffect, useState } from 'react';
import * as api from '../api/client.js';
import { Sheet, useAccionUnica, StatusChip } from '../components/ui.jsx';
import { money } from '../lib/helpers.js';

export default function OpenTicketSheet({ order, onClose, onAdd, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = async () => { const next = await api.getPedido(order.id); setData(next); return next; };
  useEffect(() => {
    let alive = true;
    const refresh = () => api.getPedido(order.id).then(d => { if (alive) setData(d); }).catch(e => { if (alive) setError(e.message); });
    refresh();
    const timer = setInterval(refresh, 3500);
    return () => { alive = false; clearInterval(timer); };
  }, [order.id]);
  const [busy, change] = useAccionUnica(async (item, cantidad) => {
    setError('');
    try {
      await api.cambiarCantidadPedido(order.id, item.id, cantidad, Number(item.cantidad));
      await load();
      await onChanged();
    } catch (e) {
      setError(e.message);
      try { await load(); } catch { /* mostrar el error original */ }
    }
  });
  const editable = data && !data.cobrado && !data.cancelado && !data.no_show && data.cancelacion_estado !== 'pendiente' && !data.es_regalo_fidelidad && !data.registro_manual;
  return <Sheet title={`Ticket ${order.folio} · Por cobrar`} onClose={() => { if (!busy) onClose(); }}>
    <p>Agrega productos al mismo ticket. Puedes cambiar o quitar una línea mientras siga pendiente de preparación.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {!data && !error && <p>Cargando ticket…</p>}
    {data?.items.map(item => <div className="cart-item" key={item.id}>
      <div className="cart-item-info">
        <strong>{item.producto_nombre}</strong>
        <div className="cart-item-sub">{[item.tamano_etiqueta, item.leche_etiqueta, item.cafe_etiqueta, ...(item.extras || [])].filter(Boolean).join(' · ')}</div>
        {item.notas && <div>{item.notas}</div>}
        <StatusChip status={item.estado}/>
        {item.estado !== 'pendiente' && <small>{item.estacion === 'caja' ? ' Registrado como entregado en caja: ya descontó inventario. Para corregirlo, solicita la cancelación del ticket con motivo y autorización.' : ' Ya está en preparación o entregado; no se modifica desde aquí.'}</small>}
      </div>
      <div className="cart-item-controls">
        <span>{item.cantidad} × {money(item.precio_unitario)}</span>
        {editable && item.estado === 'pendiente' && <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <button className="btn-secondary small" disabled={busy || Number(item.cantidad) <= 1} onClick={() => change(item, Number(item.cantidad)-1)} aria-label={`Restar uno a ${item.producto_nombre}`}>−</button>
          <button className="btn-secondary small" disabled={busy || Number(item.cantidad) >= 50} onClick={() => change(item, Number(item.cantidad)+1)} aria-label={`Agregar uno a ${item.producto_nombre}`}>+</button>
          <button className="link-danger" disabled={busy} onClick={() => { if (window.confirm(`¿Quitar ${item.producto_nombre} de la comanda?`)) change(item,0); }}>Quitar</button>
        </div>}
      </div>
    </div>)}
    {data && <div className="summary-row total"><span>Total por cobrar</span><span>{money(data.total)}</span></div>}
    {Number(data?.descuento_porcentaje) > 0 && <p>Descuento del ticket: {data.descuento_porcentaje}%.</p>}
    {data && !editable && <p>Este ticket ya no admite cambios. Cierra el detalle y actualiza la lista.</p>}
    <div className="sheet-footer">
      <button className="btn-secondary" disabled={busy} onClick={onClose}>Cerrar</button>
      <button className="btn-primary" disabled={!editable || busy} onClick={() => onAdd(data)}>Agregar productos</button>
    </div>
  </Sheet>;
}
