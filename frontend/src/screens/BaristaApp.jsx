// BARRA DE PREPARACIÓN (Barista). Los tickets se muestran en una cuadrícula
// que aprovecha pantallas grandes (varias columnas) y una columna en móvil.
import React, { useState } from 'react';
import { Coffee, Clock, Droplets, ClipboardList, AlertCircle, Sparkles, AlertTriangle, ShoppingCart } from 'lucide-react';
import { getProduct, customizationSummary } from '../lib/catalog.js';
import { fmtHora } from '../lib/helpers.js';
import { AppShell } from '../components/layout.jsx';
import { Gauge, ConfirmDialog, EmptyState } from '../components/ui.jsx';
import { RecipeModal, MermaModal } from '../components/recipe.jsx';

function TicketCard({ ticket, now, onVerReceta, onIniciar, onTerminar, onMerma, onCancelar }) {
  const product = getProduct(ticket.productId);
  const elapsedSec = (now - (ticket.status === 'pendiente' ? ticket.createdAt : ticket.startedAt || ticket.createdAt)) / 1000;
  return (
    <div className={`ticket-card status-border-${ticket.status}`}>
      <div className="ticket-head">
        <div>
          <div className="ticket-id">{ticket.folio || ticket.id}</div>
          <div className="ticket-time">{new Date(ticket.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <Gauge seconds={elapsedSec} size={68} />
      </div>

      <div className="ticket-product">
        <span className="ticket-product-icon">{product?.icon || '☕'}</span>
        <div>
          <div className="ticket-product-name">{product?.name} {ticket.qty > 1 && `x${ticket.qty}`}</div>
          <div className="ticket-product-sub">{customizationSummary(ticket) || 'Sin personalización'}</div>
        </div>
      </div>

      {(ticket.origen === 'app' || ticket.isReward) && (
        <div className="ticket-tags">
          {ticket.origen === 'app' && (
            <span className="tag-online"><Sparkles size={11} /> En línea{ticket.cliente ? ` — ${ticket.cliente.nombre}` : ''}</span>
          )}
          {ticket.horaRecogida && <span className="tag-scheduled"><Clock size={11} /> Recoge {fmtHora(ticket.horaRecogida)}</span>}
          {ticket.isReward && <span className="tag-reward"><Sparkles size={11} /> Regalo de fidelidad</span>}
        </div>
      )}

      {ticket.notas && <div className="order-notes">"{ticket.notas}"</div>}

      <div className="ticket-actions">
        <button className="btn-secondary" onClick={onVerReceta}><ClipboardList size={15} /> Ver receta</button>
        {ticket.status === 'pendiente' && <button className="btn-primary" onClick={onIniciar}>Iniciar</button>}
        {ticket.status === 'en_preparacion' && <button className="btn-primary" onClick={onTerminar}>Terminar</button>}
        <button className="icon-btn small" onClick={onMerma} aria-label="Registrar merma"><AlertCircle size={16} /></button>
      </div>
      {ticket.status === 'pendiente' && onCancelar && (
        <button className="link-danger ticket-cancelar" onClick={onCancelar}>Cancelar pedido</button>
      )}
    </div>
  );
}

// mostrador: { irA, porCobrar } cuando la misma persona también cobra (rol
// "mostrador"): agrega el acceso "Caja" a la navegación.
export default function BaristaApp({ brand, sedeNombre, tickets, startTicket, finishTicket, addMerma, onCancelar, onLogout, now, currentUser, recetaOverrides, mostrador = null }) {
  const [tab, setTab] = useState('pendientes');
  const [recipeTicket, setRecipeTicket] = useState(null);
  const [mermaTicket, setMermaTicket] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const dueKey = t => t.horaRecogida || t.createdAt;
  const pendientes = tickets.filter(t => t.status === 'pendiente').sort((a, b) => dueKey(a) - dueKey(b));
  const enPrep = tickets.filter(t => t.status === 'en_preparacion').sort((a, b) => dueKey(a) - dueKey(b));
  const visible = tab === 'pendientes' ? pendientes : enPrep;

  const handleFinish = ticket => {
    finishTicket(ticket);
    if (recipeTicket && recipeTicket.id === ticket.id) setRecipeTicket(null);
  };

  const navItems = [
    { id: 'pendientes', label: 'Pendientes', Icon: Clock, badge: pendientes.length },
    { id: 'preparacion', label: 'En preparación', Icon: Droplets, badge: enPrep.length },
    ...(mostrador ? [{ id: 'caja', label: 'Caja', Icon: ShoppingCart, badge: mostrador.porCobrar }] : []),
  ];

  return (
    <AppShell
      brand={brand}
      items={navItems}
      active={tab}
      onSelect={id => (id === 'caja' && mostrador ? mostrador.irA() : setTab(id))}
      user={{ ...currentUser, rol: mostrador ? 'mostrador' : 'barista' }}
      roleLabel={mostrador ? 'Caja + barra' : 'Barra'}
      sedeNombre={sedeNombre}
      onLogout={onLogout}
      title="Barra de preparación"
      subtitle={`${pendientes.length} pendientes • ${enPrep.length} en preparación`}
      wide
    >
      {visible.length === 0 ? (
        <EmptyState icon={Coffee} title={tab === 'pendientes' ? 'Sin pedidos pendientes' : 'Nada en preparación'} subtitle="¡Buen trabajo!" />
      ) : (
        <div className="tickets-grid">
          {visible.map(t => (
            <TicketCard
              key={t.id}
              ticket={t}
              now={now}
              onVerReceta={() => setRecipeTicket(t)}
              onIniciar={() => startTicket(t.id)}
              onTerminar={() => handleFinish(t)}
              onMerma={() => setMermaTicket(t)}
              onCancelar={() => setCancelTarget(t)}
            />
          ))}
        </div>
      )}

      {recipeTicket && (
        <RecipeModal
          ticket={tickets.find(t => t.id === recipeTicket.id) || recipeTicket}
          override={recetaOverrides[recipeTicket.productId]}
          onClose={() => setRecipeTicket(null)}
          onFinish={() => handleFinish(recipeTicket)}
        />
      )}
      {mermaTicket && <MermaModal ticket={mermaTicket} onClose={() => setMermaTicket(null)} onSave={addMerma} />}
      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancelar pedido"
        message={cancelTarget ? `¿Cancelar el pedido ${cancelTarget.folio || cancelTarget.orderId}? Solo se puede mientras no inicie su preparación.` : ''}
        confirmLabel="Sí, cancelar"
        danger
        onConfirm={() => { onCancelar(cancelTarget.orderId); setCancelTarget(null); }}
        onCancel={() => setCancelTarget(null)}
      />
    </AppShell>
  );
}
