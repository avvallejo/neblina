// PUNTO DE VENTA (Caja). En escritorio: menú + carrito lado a lado; en móvil:
// pestañas Menú / Carrito / Turno en la navegación inferior.
import React, { useState } from 'react';
import VentaDirecta from './VentaDirecta';
import CajaDinero from './CajaDinero';
import { adaptPedido } from '../lib/adapters';
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

function DetalleVenta({id}) {
  const [data,setData]=useState(null),[error,setError]=useState('');
  return <details style={{marginTop:8}} onToggle={e=>{if(e.currentTarget.open&&!data)api.getPedido(id).then(setData).catch(e=>setError(e.message));}}><summary style={{cursor:'pointer'}}>Ver detalle</summary>
    {error&&<p>{error}</p>}{data&&<div style={{paddingTop:8,fontSize:13}}>
      {data.registro_manual&&<p>Captura directa · {data.motivo_registro}<br/>Ingresada al sistema: {new Date(data.registrado_en).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}</p>}
      {data.items.map(i=><p key={i.id}>{i.cantidad} × {i.producto_nombre} · {money(i.precio_unitario)} c/u{i.motivo_precio&&<><br/>Motivo: {i.motivo_precio} {i.precio_catalogo!==null&&`(catálogo: ${money(i.precio_catalogo)})`}</>}</p>)}
    </div>}
  </details>;
}

function TurnoView({ orders: liveOrders, now, onCancel, onCobrar, onNoShow }) {
  const [fecha,setFecha]=useState(()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Mexico_City'}).format(new Date()));
  const [orders,setOrders]=useState([]),[error,setError]=useState('');
  React.useEffect(()=>{let alive=true;setOrders([]);setError('');api.getPedidos(fecha).then(rows=>{if(alive)setOrders(rows.map(adaptPedido));}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[fecha,liveOrders]);
  const total = orders.filter(o => o.cobrado && !o.noShow && o.estado!=='cancelado').reduce((s, o) => s + o.total, 0);

  return (
    <div style={{ maxWidth: 760 }}>
      <label className="option-label">Consultar ventas del día<input className="text-input" type="date" value={fecha} onChange={e=>setFecha(e.target.value)}/></label>
      {error&&<p role="alert">{error}</p>}
      <div className="turno-total"><span>Total del día</span><span className="price-total">{money(total)}</span></div>
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
              <DetalleVenta id={o.id}/>
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
  const [drawerOpen,setDrawerOpen]=useState(false);
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
      await confirmarEntrega(chargingOrder.id, { metodoPago: payInfo.method, montoRecibido: payInfo.cashGiven, importeEfectivo:payInfo.importeEfectivo });
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
        pago: { metodoPago: payInfo.method, montoRecibido: payInfo.cashGiven, importeEfectivo:payInfo.importeEfectivo },
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
    { id: 'turno', label: 'Ventas', Icon: Receipt },
    ...(mostrador ? [{ id: 'barra', label: 'Barra', Icon: Droplets, badge: mostrador.pendientes }] : []),
  ];

  const TITLES = {
    menu: ['Punto de venta', activeCat],
    cart: ['Carrito', `${cartCount} producto(s)`],
    checkout: ['Cobro', chargingOrder ? `Pedido ${chargingOrder.folio}` : 'Venta de mostrador'],
    confirmed: ['Venta registrada', ''],
    turno: ['Ventas', 'Consulta por fecha y pedidos en curso'],
    directa: ['Venta directa o atrasada', 'Precio real y salida de inventario'],
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
        <button className={`turno-pill ${turnoAbierto ? 'open' : 'closed'}`} onClick={()=>setDrawerOpen(true)}>
          {turnoAbierto ? '● Turno abierto' : 'Abrir turno'}
        </button>
      }
    >
      <CajaDinero open={drawerOpen} onClose={()=>setDrawerOpen(false)} turnoAbierto={turnoAbierto} onToggleTurno={onToggleTurno} addToast={addToast}/>
      {screen === 'menu' && (
        <div className="pos-layout">
          <div>
            <button className="btn-ghost" style={{marginBottom:16}} onClick={()=>setScreen('directa')}>Registrar venta atrasada / precio especial / venta libre</button>
            <CategoryTabs active={activeCat} onSelect={setActiveCat} />
            <ProductGrid activeCat={activeCat} onTap={p => (p.tipo === 'snack' ? quickAdd(p) : setCustomizing(p))} />
          </div>
          {/* Carrito siempre visible junto al menú en pantallas grandes */}
          <div className="pos-cart-panel hide-mobile">{cartPanel}</div>
        </div>
      )}
      {screen === 'directa' && <VentaDirecta onBack={()=>setScreen('menu')} addToast={addToast}/>}
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
