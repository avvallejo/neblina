// BARRA DE PREPARACIÓN (Barista). Los tickets se muestran en una cuadrícula
// que aprovecha pantallas grandes (varias columnas) y una columna en móvil.
import React, { useState } from 'react';
import { Coffee, Clock, Droplets, ClipboardList, AlertCircle, Sparkles, AlertTriangle, ShoppingCart, Flame, MapPin, ShoppingBag } from 'lucide-react';
import { getProduct, customizationSummary, destinoLabel, rolEtiqueta } from '../lib/catalog.js';
import { fmtHora } from '../lib/helpers.js';
import { AppShell } from '../components/layout.jsx';
import { Gauge, EmptyState, CancelacionSheet } from '../components/ui.jsx';
import { RecipeModal, MermaModal } from '../components/recipe.jsx';

// A dónde va lo que se prepara: MESA n, BARRA, PARA LLEVAR o pedido en línea.
function DestinoBadge({ ticket }) {
  const texto = destinoLabel(ticket);
  if (!texto) return null;
  const clase = ticket.destino || (ticket.origen === 'app' ? 'app' : '');
  const Icon = ticket.destino === 'llevar' ? ShoppingBag : ticket.destino === 'mesa' ? MapPin : ticket.destino === 'barra' ? Coffee : Sparkles;
  return <div className={`ticket-destino ${clase}`}><Icon size={14} /> {texto}</div>;
}

function TicketCard({ ticket, now, onVerReceta, onIniciar, onTerminar, onMerma, onCancelar, mostrarEstacion }) {
  const product = getProduct(ticket.productId);
  const elapsedSec = (now - (ticket.status === 'pendiente' ? ticket.createdAt : ticket.startedAt || ticket.createdAt)) / 1000;
  return (
    <div className={`ticket-card status-border-${ticket.status}`}>
      <div className="ticket-head">
        <div>
          <div className="ticket-id">{ticket.folio || ticket.id}</div>
          <div className="ticket-time">{fmtHora(ticket.createdAt)}</div>
        </div>
        <Gauge seconds={elapsedSec} size={68} />
      </div>
      <DestinoBadge ticket={ticket} />
      {mostrarEstacion && (
        <span className={`tag-estacion ${ticket.estacion}`}>{ticket.estacion === 'parrilla' ? <Flame size={11} /> : <Coffee size={11} />} {ticket.estacion === 'parrilla' ? 'Parrilla' : 'Barra'}</span>
      )}

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

  const llegada = (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  const pendientes = tickets.filter(t => t.status === 'pendiente').sort(llegada);
  const enPrep = tickets.filter(t => t.status === 'en_preparacion').sort(llegada);
  const visible = tab === 'pendientes' ? pendientes : enPrep;

  const handleFinish = ticket => {
    finishTicket(ticket);
    if (recipeTicket && recipeTicket.id === ticket.id) setRecipeTicket(null);
  };

  // Estaciones que atiende esta persona: barra, parrilla o ambas (ve todo).
  const estaciones = Array.isArray(currentUser?.estaciones) && currentUser.estaciones.length ? currentUser.estaciones : ['barra', 'parrilla'];
  const soloParrilla = estaciones.length === 1 && estaciones[0] === 'parrilla';
  const ambas = estaciones.includes('barra') && estaciones.includes('parrilla');
  const titulo = ambas ? 'Barra y parrilla' : soloParrilla ? 'Parrilla' : 'Barra de preparación';

  const navItems = [
    { id: 'pendientes', label: 'Pendientes', Icon: Clock, badge: pendientes.length },
    { id: 'preparacion', label: 'En preparación', Icon: soloParrilla ? Flame : Droplets, badge: enPrep.length },
    ...(mostrador ? [{ id: 'caja', label: 'Caja', Icon: ShoppingCart, badge: mostrador.porCobrar }] : []),
  ];

  return (
    <AppShell
      brand={brand}
      items={navItems}
      active={tab}
      onSelect={id => (id === 'caja' && mostrador ? mostrador.irA() : setTab(id))}
      user={{ ...currentUser, rol: mostrador ? 'mostrador' : 'barista' }}
      roleLabel={rolEtiqueta({ rol: mostrador ? 'mostrador' : 'barista', estaciones })}
      sedeNombre={sedeNombre}
      onLogout={onLogout}
      title={titulo}
      subtitle={`${pendientes.length} pendientes • ${enPrep.length} en preparación · Orden de llegada`}
      wide
    >
      {visible.length === 0 ? (
        <EmptyState icon={soloParrilla ? Flame : Coffee} title={tab === 'pendientes' ? 'Sin pedidos pendientes' : 'Nada en preparación'} subtitle="¡Buen trabajo!" />
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
              mostrarEstacion={ambas}
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
      {cancelTarget && (
        <CancelacionSheet
          folio={cancelTarget.folio || cancelTarget.orderId}
          fecha={cancelTarget.createdAt}
          inmediata={cancelTarget.status === 'pendiente'}
          onClose={() => setCancelTarget(null)}
          onSubmit={async motivo => { await onCancelar(cancelTarget.orderId, motivo); setCancelTarget(null); }}
        />
      )}
    </AppShell>
  );
}
