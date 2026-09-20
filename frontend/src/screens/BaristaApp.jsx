import { groupPreparationOrders } from '../lib/preparationOrders.js';
import CoffeeGuide from '../components/CoffeeGuide.jsx';
import ProductImage from '../components/ProductImage.jsx';
import React, { useRef, useState } from 'react';
import { Coffee, Clock, ClipboardList, AlertCircle, Sparkles, ShoppingCart, Flame, MapPin, ShoppingBag, Check } from 'lucide-react';
import { getProduct, customizationSummary, destinoLabel, rolEtiqueta } from '../lib/catalog.js';
import { fmtHora } from '../lib/helpers.js';
import { AppShell } from '../components/layout.jsx';
import { Gauge, EmptyState, CancelacionSheet } from '../components/ui.jsx';
import { RecipeModal, MermaModal } from '../components/recipe.jsx';

const statusLabel = { pendiente: 'Pendiente', en_preparacion: 'En preparación', terminado: 'Terminado' };
function DestinoBadge({ ticket }) {
  const texto = destinoLabel(ticket);
  if (!texto) return null;
  const clase = ticket.destino || (ticket.origen === 'app' ? 'app' : '');
  const Icon = ticket.destino === 'llevar' ? ShoppingBag : ticket.destino === 'mesa' ? MapPin : ticket.destino === 'barra' ? Coffee : Sparkles;
  return <div className={`ticket-destino ${clase}`}><Icon size={14} /> {texto}</div>;
}

function TicketCard({ ticket, now, onVerReceta, onTerminar, onMerma, busy }) {
  const product = getProduct(ticket.productId);
  const done = ticket.status === 'terminado';
  const elapsedSec = (now - (ticket.startedAt || ticket.createdAt)) / 1000;
  return <div className={`preparation-item status-border-${ticket.status}`}>
    <div className="ticket-product">
      <span className="ticket-product-icon"><ProductImage product={product}/></span>
      <div>
        <div className="ticket-product-name">{ticket.qty} × {product?.name || 'Producto'}</div>
        <div className="ticket-product-sub">{customizationSummary(ticket) || 'Sin personalización'}</div>
        {ticket.notas && <div className="order-notes">{ticket.notas}</div>}
        {ticket.horaRecogida && <span className="tag-scheduled"><Clock size={11} /> Recoge {fmtHora(ticket.horaRecogida)}</span>}
        {ticket.isReward && <span className="tag-reward"><Sparkles size={11} /> Regalo de fidelidad</span>}
      </div>
    </div>
    <div className={`preparation-item-status ${done ? 'is-done' : ''}`}>
      {done ? <Check size={22} /> : <Gauge seconds={elapsedSec} size={46} />}
      <span>{statusLabel[ticket.status]}{done && ticket.finishedAt ? ` · ${fmtHora(ticket.finishedAt)}` : ''}{done && <small className="prepared-by">Terminó: {ticket.terminadoPor || 'Sin registro histórico'}</small>}</span>
    </div>
    <div className="ticket-actions">
      <button className="btn-secondary" onClick={onVerReceta}><ClipboardList size={15} /> Receta</button>
      {!done && <button className="btn-primary" disabled={busy} onClick={onTerminar}>Terminar</button>}
      {!done && <button className="icon-btn small" disabled={busy} onClick={onMerma} aria-label="Registrar merma"><AlertCircle size={16} /></button>}
    </div>
  </div>;
}

export default function BaristaApp({ brand, sedeNombre, tickets, prepareTicket, finishTicket, addMerma, onCancelar, onLogout, now, currentUser, recetaOverrides, mostrador = null }) {
  const [recipeTicket, setRecipeTicket] = useState(null);
  const [mermaTicket, setMermaTicket] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const run = async action => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e.message || 'No se pudo actualizar la comanda.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const handleFinish = ticket => run(async () => {
    await finishTicket(ticket);
    if (recipeTicket?.id === ticket.id) setRecipeTicket(null);
  });
  const groups = groupPreparationOrders(tickets);
  const active = groups.filter(g => g.status !== 'terminado');
  const completed = groups.filter(g => g.status === 'terminado').sort((a, b) =>
    Math.max(...b.items.map(t => t.finishedAt || 0)) - Math.max(...a.items.map(t => t.finishedAt || 0)));
  const estaciones = Array.isArray(currentUser?.estaciones) && currentUser.estaciones.length ? currentUser.estaciones : ['barra', 'parrilla'];
  const soloParrilla = estaciones.length === 1 && estaciones[0] === 'parrilla';
  const ambas = estaciones.includes('barra') && estaciones.includes('parrilla');
  const titulo = ambas ? 'Barra y parrilla' : soloParrilla ? 'Parrilla' : 'Barra de preparación';
  const navItems = [
    { id: 'comandas', label: 'Comandas', Icon: ClipboardList, badge: active.length },
    ...(mostrador ? [{ id: 'caja', label: 'Caja', Icon: ShoppingCart, badge: mostrador.porCobrar }] : []),
  ];
  const renderOrder = group => {
    const first = group.items[0];
    const doneCount = group.items.filter(t => t.status === 'terminado').reduce((sum, t) => sum + Number(t.qty), 0);
    const totalCount = group.items.reduce((sum, t) => sum + Number(t.qty), 0);
    return <section key={group.id} className={`preparation-order horizontal-order ${group.status === 'terminado' ? 'order-done' : ''}`} aria-label={`Ticket ${first.folio || group.id}`}>
      <header className="preparation-order-header">
        <div className="ticket-id">Ticket {first.folio || group.id}</div>
        <h2>{first.nombreTicket || 'Sin nombre registrado'}</h2>
        <div>Levantó: <strong>{first.levantadoPor || (first.origen === 'app' ? 'Cliente · pedido en línea' : 'Sin registro')}</strong></div>
        <DestinoBadge ticket={first} />
        <strong className={`preparation-order-status ${group.status}`}>
          {group.status === 'terminado' ? '✓ Listo en esta estación' : statusLabel[group.status]}
        </strong>
        <div className="ticket-time">{doneCount} de {totalCount} terminados · {fmtHora(group.createdAt)}</div>
        {onCancelar && group.status !== 'terminado' && <button disabled={busy} className="link-danger ticket-cancelar" onClick={() => setCancelTarget({ ...first, status: group.status })}>Cancelar pedido completo</button>}
      </header>
      <div className="preparation-order-body">
        {['barra', 'parrilla'].map(estacion => {
          const items = group.items.filter(t => t.estacion === estacion);
          if (!items.length) return null;
          const pending = items.filter(t => t.status === 'pendiente');
          const unfinished = items.filter(t => t.status !== 'terminado');
          return <div className="preparation-station" key={estacion}>
            <div className="preparation-station-head">
              <strong>{estacion === 'parrilla' ? <Flame size={16}/> : <Coffee size={16}/>} {estacion === 'parrilla' ? 'Parrilla' : 'Barra'}</strong>
              <div className="preparation-batch-actions">
                {pending.length > 0 && <button className="btn-secondary" disabled={busy} onClick={() => run(() => prepareTicket(group.id, 'iniciar', estacion, pending.map(t => t.id)))}>Iniciar preparación</button>}
                {unfinished.length > 0 && <button className="btn-primary" disabled={busy} onClick={() => run(() => prepareTicket(group.id, 'terminar', estacion, unfinished.map(t => t.id)))}>Terminar todo{ambas ? ` · ${estacion === 'parrilla' ? 'Parrilla' : 'Barra'}` : ''}</button>}
                {unfinished.length === 0 && <span className="preparation-item-status is-done"><Check size={18}/> Todo terminado</span>}
              </div>
            </div>
            <div className="preparation-order-items">
              {items.map(t => <TicketCard key={t.id} ticket={t} now={now} busy={busy}
                onVerReceta={() => setRecipeTicket(t)} onTerminar={() => handleFinish(t)} onMerma={() => setMermaTicket(t)} />)}
            </div>
          </div>;
        })}
      </div>
    </section>;
  };
  return <AppShell brand={brand} items={navItems} active="comandas"
    onSelect={id => { if (id === 'caja' && mostrador) mostrador.irA(); }}
    user={{ ...currentUser, rol: mostrador ? 'mostrador' : 'barista' }}
    roleLabel={rolEtiqueta({ rol: mostrador ? 'mostrador' : 'barista', estaciones })}
    sedeNombre={sedeNombre} onLogout={onLogout} topRight={<CoffeeGuide />} title={titulo}
    subtitle={`${active.length} tickets en curso · ${completed.length} listos · Orden de llegada`} wide>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="preparation-board" aria-busy={busy}>
      {active.length ? active.map(renderOrder) : <EmptyState icon={soloParrilla ? Flame : Coffee} title="Sin pedidos en curso" subtitle="Los nuevos tickets aparecerán aquí." />}
    </div>
    {completed.length > 0 && <section className="preparation-completed">
      <h2><Check size={22}/> Listos en esta estación · {completed.length}</h2>
      <p>Preparados hoy. Los productos de otras estaciones conservan su propio estado.</p>
      <div className="preparation-board">{completed.map(renderOrder)}</div>
    </section>}
    {recipeTicket && <RecipeModal ticket={tickets.find(t => t.id === recipeTicket.id) || recipeTicket}
      override={recetaOverrides[recipeTicket.productId]} onClose={() => setRecipeTicket(null)} onFinish={() => handleFinish(recipeTicket)} />}
    {mermaTicket && <MermaModal ticket={mermaTicket} onClose={() => setMermaTicket(null)} onSave={addMerma} />}
    {cancelTarget && <CancelacionSheet folio={cancelTarget.folio || cancelTarget.orderId} fecha={cancelTarget.createdAt}
      inmediata={cancelTarget.status === 'pendiente'} onClose={() => setCancelTarget(null)}
      onSubmit={async motivo => { await onCancelar(cancelTarget.orderId, motivo); setCancelTarget(null); }} />}
  </AppShell>;
}
