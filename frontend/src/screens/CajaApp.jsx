// PUNTO DE VENTA (Caja). En escritorio: menú + carrito lado a lado; en móvil:
// pestañas Menú / Carrito / Turno en la navegación inferior.
import React, { useState } from 'react';
import { Coffee, ShoppingCart, Receipt, AlertTriangle, Droplets } from 'lucide-react';
import * as api from '../api/client.js';
import { getProduct, NO_SHOW_WARNING_MS } from '../lib/catalog.js';
import { money } from '../lib/helpers.js';
import { AppShell } from '../components/layout.jsx';
import { StatusChip, ConfirmDialog, EmptyState } from '../components/ui.jsx';
import { CategoryTabs, ProductGrid, CustomizeSheet, CartView, CheckoutView } from '../components/menu.jsx';

function ConfirmedView({ order, onNewSale }) {
  React.useEffect(() => {
    const t = setTimeout(onNewSale, 5000);
    return () => clearTimeout(t);
  }, [onNewSale]);
  return (
    <div className="confirm-screen">
      <div className="confirm-check"><span style={{ fontSize: 34 }}>✓</span></div>
      <div className="confirm-order-id">{order.folio || order.id}</div>
      <p style={{ fontWeight: 600, color: 'var(--ink-soft)' }}>Pedido enviado a la barra de preparación</p>
      <div className="confirm-total">{money(order.total)}</div>
      <button className="btn-primary" onClick={onNewSale}>Nueva venta</button>
    </div>
  );
}

function TurnoView({ orders, now, onCancel, onCobrar, onNoShow }) {
  const total = orders.filter(o => o.cobrado && !o.noShow).reduce((s, o) => s + o.total, 0);

  if (orders.length === 0) {
    return <EmptyState icon={Receipt} title="Aún no hay ventas en este turno" />;
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="turno-total"><span>Total del turno</span><span className="price-total">{money(total)}</span></div>
      {orders.map(o => {
        const status = o.estado;
        const vencido = status === 'listo' && o.horaRecogida && now - o.horaRecogida > NO_SHOW_WARNING_MS;
        return (
          <div key={o.id} className="turno-row">
            <div>
              <div className="turno-id">{o.folio}</div>
              <div className="turno-sub">
                {new Date(o.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} • {o.numItems} producto(s) • {o.payMethod}
                {o.origen === 'app' && o.cliente && ` • 🌐 En línea — ${o.cliente.nombre} ${o.cliente.apellido}`}
              </div>
              {vencido && <div className="vencido-warning"><AlertTriangle size={11} /> Pasada la hora de recogida sin cobrarse</div>}
            </div>
            <div className="turno-right">
              <div className="turno-amount">{money(o.total)}</div>
              <StatusChip status={status} />
              {status === 'pendiente' && (
                <button className="link-danger" onClick={() => onCancel(o.id)}>Cancelar</button>
              )}
              {status === 'listo' && (
                <div className="turno-actions">
                  <button className="btn-primary small" onClick={() => onCobrar(o)}>
                    {o.total > 0 ? `Cobrar ${money(o.total)}` : 'Confirmar entrega'}
                  </button>
                  <button className="link-danger" onClick={() => onNoShow(o.id)}>No recogido</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// mostrador: { irA, pendientes } cuando la misma persona también es barista
// (rol "mostrador"): agrega el acceso "Barra" a la navegación.
export default function CajaApp({ brand, sedeNombre, orders, createOrder, cancelOrderFn, confirmarEntrega, marcarNoShow, addToast, onLogout, turnoAbierto, onToggleTurno, currentUser, now, mostrador = null }) {
  const [screen, setScreen] = useState('menu');
  const [activeCat, setActiveCat] = useState('Calientes');
  const [customizing, setCustomizing] = useState(null);
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(null);
  const [amounts, setAmounts] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [noShowTarget, setNoShowTarget] = useState(null);
  const [chargingOrder, setChargingOrder] = useState(null);

  const authorizeDiscount = async (porcentaje, pin) => {
    if (!porcentaje) { setDiscount(null); return; }
    const approval = await api.crearAprobacionDescuento({ pin, descuentoPorcentaje: porcentaje });
    setDiscount({ porcentaje, autorizacion: approval.token });
  };

  const quickAdd = product => {
    setCart(c => [...c, { uid: `${product.id}-${Date.now()}`, productId: product.id, qty: 1, unitPrice: product.price, extras: [] }]);
    addToast(`Agregado: ${product.name}`, 'success');
  };

  const backFromCheckout = () => {
    if (chargingOrder) { setChargingOrder(null); setScreen('turno'); }
    else { setScreen('menu'); }
  };

  const handleConfirmPay = async payInfo => {
    if (chargingOrder) {
      await confirmarEntrega(chargingOrder.id, { metodoPago: payInfo.method, montoRecibido: payInfo.cashGiven });
      setChargingOrder(null);
      setAmounts(null);
      setScreen('turno');
      return;
    }
    try {
      const order = await createOrder({
        cart,
        descuentoPorcentaje: discount?.porcentaje,
        autorizacionDescuento: discount?.autorizacion,
        pago: { metodoPago: payInfo.method, montoRecibido: payInfo.cashGiven },
      });
      setLastOrder(order);
      setCart([]);
      setDiscount(null);
      setScreen('confirmed');
    } catch (e) {
      addToast('No se pudo crear el pedido: ' + e.message, 'warn');
    }
  };

  const handleCobrarClick = order => {
    if (order.total > 0) {
      setChargingOrder(order);
      setAmounts({ subtotal: order.total, discountAmt: 0, total: order.total });
      setScreen('checkout');
    } else {
      confirmarEntrega(order.id);
    }
  };

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const navItems = [
    { id: 'menu', label: 'Menú', Icon: Coffee },
    { id: 'cart', label: 'Carrito', Icon: ShoppingCart, badge: cartCount },
    { id: 'turno', label: 'Turno', Icon: Receipt },
    ...(mostrador ? [{ id: 'barra', label: 'Barra', Icon: Droplets, badge: mostrador.pendientes }] : []),
  ];

  const TITLES = {
    menu: ['Punto de venta', activeCat],
    cart: ['Carrito', `${cartCount} producto(s)`],
    checkout: ['Cobro', chargingOrder ? `Pedido ${chargingOrder.folio}` : 'Venta de mostrador'],
    confirmed: ['Venta registrada', ''],
    turno: ['Turno', 'Ventas y pedidos en curso'],
  };
  const [title, subtitle] = TITLES[screen] || TITLES.menu;

  const cartPanel = (
    <CartView
      cart={cart} setCart={setCart} discount={discount}
      onAuthorizeDiscount={authorizeDiscount}
      onCheckout={amts => { setAmounts(amts); setScreen('checkout'); }}
    />
  );

  return (
    <AppShell
      brand={brand}
      items={navItems}
      active={screen === 'checkout' || screen === 'confirmed' ? 'menu' : screen}
      onSelect={id => (id === 'barra' && mostrador ? mostrador.irA() : setScreen(id))}
      user={{ ...currentUser, rol: mostrador ? 'mostrador' : 'cajero' }}
      roleLabel={mostrador ? 'Caja + barra' : 'Caja'}
      sedeNombre={sedeNombre}
      onLogout={onLogout}
      title={title}
      subtitle={subtitle}
      wide
      topRight={
        <button className={`turno-pill ${turnoAbierto ? 'open' : 'closed'}`} onClick={onToggleTurno}>
          {turnoAbierto ? '● Turno abierto' : 'Abrir turno'}
        </button>
      }
    >
      {screen === 'menu' && (
        <div className="pos-layout">
          <div>
            <CategoryTabs active={activeCat} onSelect={setActiveCat} />
            <ProductGrid activeCat={activeCat} onTap={p => (p.tipo === 'snack' ? quickAdd(p) : setCustomizing(p))} />
          </div>
          {/* Carrito siempre visible junto al menú en pantallas grandes */}
          <div className="pos-cart-panel hide-mobile">{cartPanel}</div>
        </div>
      )}
      {screen === 'cart' && <div style={{ maxWidth: 640 }}>{cartPanel}</div>}
      {screen === 'checkout' && <CheckoutView amounts={amounts} onBack={backFromCheckout} onConfirm={handleConfirmPay} />}
      {screen === 'confirmed' && lastOrder && <ConfirmedView order={lastOrder} onNewSale={() => setScreen('menu')} />}
      {screen === 'turno' && (
        <TurnoView
          orders={orders} now={now}
          onCancel={id => setCancelTarget(id)}
          onCobrar={handleCobrarClick}
          onNoShow={id => setNoShowTarget(id)}
        />
      )}

      {customizing && (
        <CustomizeSheet
          product={customizing}
          onClose={() => setCustomizing(null)}
          onAdd={item => { setCart(c => [...c, item]); addToast(`Agregado: ${getProduct(item.productId).name}`, 'success'); }}
        />
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancelar pedido"
        message="¿Seguro que quieres cancelar este pedido? Esta acción notificará a la barra de preparación."
        confirmLabel="Sí, cancelar"
        danger
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => { cancelOrderFn(cancelTarget); setCancelTarget(null); }}
      />

      <ConfirmDialog
        open={!!noShowTarget}
        title="Marcar como no recogido"
        message="¿Confirmas que el cliente no pasó por este pedido? Se registrará la merma de lo ya preparado y se restará un punto de su tarjeta de fidelidad."
        confirmLabel="Sí, marcar"
        danger
        onCancel={() => setNoShowTarget(null)}
        onConfirm={() => { marcarNoShow(noShowTarget); setNoShowTarget(null); }}
      />
    </AppShell>
  );
}
