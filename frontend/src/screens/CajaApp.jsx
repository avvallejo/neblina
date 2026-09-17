import CoffeeGuide from '../components/CoffeeGuide.jsx';
// PUNTO DE VENTA (Caja). En escritorio: menú + carrito lado a lado; en móvil:
// pestañas Menú / Carrito / Turno en la navegación inferior.
import React, { useState } from 'react';
import VentaDirecta from './VentaDirecta';
import CajaDinero from './CajaDinero';
import OpenTicketSheet from './OpenTicketSheet.jsx';
import { adaptPedido } from '../lib/adapters';
import { Coffee, ShoppingCart, Receipt, AlertTriangle, Droplets, Gift, Ban, ChevronLeft, ChevronRight } from 'lucide-react';
import * as api from '../api/client.js';
import { getProduct, NO_SHOW_WARNING_MS, CORTESIA_ESTADO_LABELS, CANCELACION_ESTADO_LABELS, destinoLabel } from '../lib/catalog.js';
import { money, fmtHora } from '../lib/helpers.js';
import { AppShell } from '../components/layout.jsx';
import { StatusChip, ConfirmDialog, EmptyState, Sheet, CancelacionSheet, useAccionUnica } from '../components/ui.jsx';
import { CategoryTabs, ProductGrid, CustomizeSheet, CartView, CheckoutView } from '../components/menu.jsx';

// Leyenda de una cortesía recién registrada. Cuando excedió el cupo del mes
// NO se cierra sola: la Caja debe leer que un administrador la autorizará.
function CortesiaAviso({ cortesia }) {
  if (!cortesia) return null;
  return (
    <div className={`cortesia-plan ${cortesia.excedida ? 'warn' : 'ok'}`} role={cortesia.excedida ? 'alert' : 'status'} style={{ maxWidth: 520 }}>
      <strong><Gift size={14} /> {cortesia.excedida ? 'Cortesía fuera del plan mensual' : 'Cortesía registrada'}</strong>
      <span>{cortesia.leyenda}</span>
    </div>
  );
}

function ConfirmedView({ order, onNewSale }) {
  const esperar = !!(order.cortesia && order.cortesia.excedida);
  React.useEffect(() => {
    if (esperar) return undefined;
    const t = setTimeout(onNewSale, 5000);
    return () => clearTimeout(t);
  }, [onNewSale, esperar]);
  return (
    <div className="confirm-screen">
      <div className="confirm-check"><span style={{ fontSize: 34 }}>✓</span></div>
      <div className="confirm-order-id">{order.folio || order.id}</div>
      <p style={{ fontWeight: 600, color: 'var(--ink-soft)' }}>Pedido enviado a preparación{destinoLabel(order) ? ` · ${destinoLabel(order)}` : ''}</p>
      {!order.cobrado && <p><strong>Pendiente de pago.</strong> En Ventas puedes agregar productos o cobrar este mismo ticket.</p>}
      <div className="confirm-total">{order.esCortesia ? 'Cortesía · $0.00' : money(order.total)}</div>
      <CortesiaAviso cortesia={order.cortesia} />
      <button className="btn-primary" onClick={onNewSale}>{esperar ? 'Entendido, nueva venta' : 'Nueva venta'}</button>
    </div>
  );
}

function DetalleVenta({id}) {
  const [data,setData]=useState(null),[error,setError]=useState('');
  return <details style={{marginTop:8}} onToggle={e=>{if(e.currentTarget.open&&!data)api.getPedido(id).then(setData).catch(e=>setError(e.message));}}><summary style={{cursor:'pointer'}}>Ver detalle</summary>
    {error&&<p>{error}</p>}{data&&<div style={{paddingTop:8,fontSize:13}}>
      {data.registro_manual&&<p>Captura directa · {data.motivo_registro}<br/>Ingresada al sistema: {new Date(data.registrado_en).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}</p>}
      {data.metodo_pago==='cortesia'&&<p>Cortesía · {CORTESIA_ESTADO_LABELS[data.cortesia_estado]||data.cortesia_estado} · valor {money(data.subtotal)}{data.cortesia_motivo&&<><br/>Motivo: {data.cortesia_motivo}</>}{data.cortesia_nota&&<><br/>Nota del administrador: {data.cortesia_nota}</>}</p>}
      {data.items.map(i=><p key={i.id}>{i.estado === 'cancelado' && 'Retirado · no se cobra · '}{i.cantidad} × {i.producto_nombre} · {money(i.precio_unitario)} c/u{i.motivo_precio&&<><br/>Motivo: {i.motivo_precio} {i.precio_catalogo!==null&&`(catálogo: ${money(i.precio_catalogo)})`}</>}</p>)}
    </div>}
  </details>;
}

// FECHAS DEL DÍA DE NEGOCIO (America/Mexico_City), en texto YYYY-MM-DD. La
// aritmética se hace en UTC a propósito: así el huso del navegador nunca mueve
// el día que el cajero está consultando.
const diaMx = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumarDias = (f, n) => { const [y, m, d] = f.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const fechaEnPalabras = (f, opciones) => { const [y, m, d] = f.split('-').map(Number); return new Intl.DateTimeFormat('es-MX', { ...opciones, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))); };
const capitalizar = t => t.charAt(0).toUpperCase() + t.slice(1);

// `recargar` es un contador: cambia cuando la Caja cancela un ticket, para
// volver a pedir las ventas del día que se está consultando.
function TurnoView({ orders: liveOrders, now, onCancel, onCobrar, onEdit, onNoShow, recargar = 0 }) {
  const [fecha,setFecha]=useState(diaMx);
  const [sales,setSales]=useState({fecha:null,orders:[]}),[error,setError]=useState('');
  React.useEffect(()=>{
    let alive=true;
    setError('');
    // Keep the current day's rows mounted while polling, including open details.
    api.getPedidos(fecha).then(rows=>{
      if(alive)setSales({fecha,orders:rows.map(adaptPedido)});
    }).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;};
  },[fecha,liveOrders,recargar]);
  const loading=sales.fecha!==fecha;
  const orders=loading?[]:sales.orders;
  const total = orders.filter(o => o.cobrado && !o.noShow && o.estado!=='cancelado').reduce((s, o) => s + o.total, 0);

  const hoy = diaMx(), ayer = sumarDias(hoy, -1);
  const esHoy = fecha === hoy, esAyer = fecha === ayer;
  const tituloDia = esHoy ? 'Hoy' : esAyer ? 'Ayer' : capitalizar(fechaEnPalabras(fecha, { weekday: 'long' }));
  const cobrados = orders.filter(o => o.cobrado && !o.noShow && o.estado !== 'cancelado').length;
  const porCobrar = orders.filter(o => !o.cobrado && !o.cancelado && !o.noShow).length;

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="ventas-fecha">
        <div className="ventas-fecha-dia">
          <button className="icon-btn small" aria-label="Día anterior" onClick={() => setFecha(f => sumarDias(f, -1))}><ChevronLeft size={17}/></button>
          <div className="ventas-fecha-texto">
            <strong>{tituloDia}</strong>
            <span className="field-hint">{fechaEnPalabras(fecha, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
          <button className="icon-btn small" aria-label="Día siguiente" disabled={fecha >= hoy} onClick={() => setFecha(f => sumarDias(f, 1))}><ChevronRight size={17}/></button>
        </div>
        <div className="ventas-fecha-atajos">
          <button className={`option-chip ${esHoy ? 'selected' : ''}`} onClick={() => setFecha(hoy)}>Hoy</button>
          <button className={`option-chip ${esAyer ? 'selected' : ''}`} onClick={() => setFecha(ayer)}>Ayer</button>
          <input className="text-input ventas-fecha-input" type="date" max={hoy} value={fecha}
                 aria-label="Consultar otra fecha" onChange={e => { if (e.target.value) setFecha(e.target.value); }}/>
        </div>
      </div>
      {error&&<p role="alert">{error}</p>}
      <div className="turno-total">
        <div className="turno-total-label">
          <span>{esHoy ? 'Total de hoy' : 'Total del día'}</span>
          <span className="field-hint">{loading ? 'Cargando…' : `${cobrados} cobrado(s)${porCobrar ? ` · ${porCobrar} por cobrar` : ''}`}</span>
        </div>
        <span className="price-total">{loading?'—':money(total)}</span>
      </div>
      {loading&&!error&&<p role="status">Cargando ventas…</p>}
      {orders.map(o => {
        const status = o.estado;
        const vencido = status === 'listo' && o.horaRecogida && now - o.horaRecogida > NO_SHOW_WARNING_MS;
        return (
          <div key={o.id} className="turno-row">
            <div>
              <div className="turno-id">{o.folio}</div>
              <div className="turno-sub">
                {fmtHora(o.createdAt)} • {o.numItems} producto(s) • {o.payMethod}
                {o.destino && ` • ${destinoLabel(o)}`}
                {o.origen === 'app' && o.cliente && ` • 🌐 En línea — ${o.cliente.nombre} ${o.cliente.apellido}`}
              </div>
              <DetalleVenta key={`${o.id}-${recargar}-${o.total}-${o.numItems}`} id={o.id}/>
              {vencido && <div className="vencido-warning"><AlertTriangle size={11} /> Pasada la hora de recogida sin cobrarse</div>}
            </div>
            <div className="turno-right">
              <div className="turno-amount">{o.esCortesia ? 'Cortesía' : money(o.total)}</div>
              <span className="field-hint">{o.cancelado ? 'Ticket cancelado' : o.cobrado ? 'Pago: cobrado' : 'Pago: pendiente'}</span>
              <span className="field-hint">Preparación</span><StatusChip status={status} />
              {o.esCortesia && o.cortesiaEstado && <span className={`cortesia-tag ${o.cortesiaEstado}`}><Gift size={11} /> {CORTESIA_ESTADO_LABELS[o.cortesiaEstado] || o.cortesiaEstado}</span>}
              {/* Ya cancelado lo dice la etiqueta de estado; aquí solo lo que
                  falta saber: que hay una solicitud esperando o que se rechazó. */}
              {o.cancelacionEstado && !o.cancelado && (
                <span className={`cancelacion-tag ${o.cancelacionEstado}`} title={o.cancelacionMotivo}>
                  <Ban size={11} /> {CANCELACION_ESTADO_LABELS[o.cancelacionEstado] || o.cancelacionEstado}
                </span>
              )}
              {!o.cobrado && !o.cancelado && !o.noShow && o.cancelacionEstado !== 'pendiente' && (
                <div className="turno-actions">
                  <button className="btn-primary small" onClick={() => onCobrar(o)}>
                    {o.total > 0 ? `Cobrar ${money(o.total)}` : 'Confirmar entrega'}
                  </button>
                  {status === 'listo' && <button className="link-danger" onClick={() => onNoShow(o.id)}>No recogido</button>}
                </div>
              )}
              {!o.cobrado && !o.cancelado && !o.noShow && !o.esRecompensaPura && o.cancelacionEstado !== 'pendiente' && (
                <button className="btn-secondary small" onClick={() => onEdit(o)}>Agregar / editar</button>
              )}
              {/* Cualquier ticket se puede cancelar (con motivo), de cualquier
                  fecha: los duplicados también se cobran y se preparan. */}
              {!o.cancelado && o.cancelacionEstado !== 'pendiente' && status !== 'no_show' && (
                <button className="link-danger" onClick={() => onCancel(o)}>Cancelar ticket</button>
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
export default function CajaApp({ brand, sedeNombre, orders, createOrder, onOrderChanged, cancelOrderFn, confirmarEntrega, marcarNoShow, addToast, onLogout, turnoAbierto, onToggleTurno, currentUser, now, mostrador = null, mesas = 4 }) {
  const [screen, setScreen] = useState('menu');
  const [destino, setDestino] = useState(null); // { destino: 'mesa'|'barra'|'llevar', mesa }
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [activeCat, setActiveCat] = useState('Calientes');
  const [customizing, setCustomizing] = useState(null);
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(null);
  const [amounts, setAmounts] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [recargarVentas, setRecargarVentas] = useState(0);
  const [noShowTarget, setNoShowTarget] = useState(null);
  const [chargingOrder, setChargingOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [addingToOrder, setAddingToOrder] = useState(null);

  const authorizeDiscount = async (porcentaje, pin) => {
    if (!porcentaje) { setDiscount(null); return; }
    const approval = await api.crearAprobacionDescuento({ pin, descuentoPorcentaje: porcentaje });
    setDiscount({ porcentaje, autorizacion: approval.token });
  };

  const quickAdd = product => {
    if (enviando) return;
    setCart(c => [...c, { uid: `${product.id}-${Date.now()}`, productId: product.id, qty: 1, unitPrice: product.price, extras: [] }]);
    if (product.agotado) addToast(`${product.name}: sin existencias registradas. Se agrega de todos modos; registra la compra en Inventario.`, 'warn');
    else addToast(`Agregado: ${product.name}`, 'success');
  };

  const backFromCheckout = () => {
    if (chargingOrder) { setChargingOrder(null); setScreen('turno'); }
    else { setScreen('menu'); }
  };

  const [cortesiaAviso, setCortesiaAviso] = useState(null);
  const handleConfirmPay = async payInfo => {
    if (chargingOrder) {
      const r = await confirmarEntrega(chargingOrder.id, { metodoPago: payInfo.method, montoRecibido: payInfo.cashGiven, importeEfectivo:payInfo.importeEfectivo, motivoCortesia: payInfo.motivoCortesia, totalEsperado: chargingOrder.total });
      setChargingOrder(null);
      setAmounts(null);
      setScreen('turno');
      // Pedido en línea entregado como cortesía: si excedió el cupo, la
      // leyenda se muestra en un aviso que la Caja debe cerrar.
      if (r && r.cortesia) { if (r.cortesia.excedida) setCortesiaAviso(r.cortesia); else addToast(r.cortesia.leyenda, 'success'); }
      return;
    }
    // El modal de cortesía espera el error para mostrarlo; el resto de los
    // métodos siguen avisando con un toast.
    const esCortesia = payInfo.method === 'cortesia';
    try {
      const order = await createOrder({
        cart,
        descuentoPorcentaje: discount?.porcentaje,
        autorizacionDescuento: discount?.autorizacion,
        pago: { metodoPago: payInfo.method, montoRecibido: payInfo.cashGiven, importeEfectivo:payInfo.importeEfectivo, motivoCortesia: payInfo.motivoCortesia },
        destino: destino?.destino,
        mesa: destino?.mesa ?? undefined,
      });
      setLastOrder(order);
      setCart([]);
      setDiscount(null);
      setDestino(null);
      setScreen('confirmed');
    } catch (e) {
      if (esCortesia) throw e;
      addToast('No se pudo crear el pedido: ' + e.message, 'warn');
    }
  };

  const pedidoActualizado = async () => {
    setRecargarVentas(n => n + 1);
    await onOrderChanged();
  };
  const [enviando, enviarComanda] = useAccionUnica(async () => {
    try {
      if (addingToOrder) {
        await api.agregarItemsPedido(addingToOrder.id, cart);
        setCart([]); setDiscount(null); setAddingToOrder(null);
        setScreen('turno');
        await pedidoActualizado();
        addToast(`Productos agregados a ${addingToOrder.folio}; sigue pendiente de pago`, 'success');
      } else {
        const order = await createOrder({ cart, descuentoPorcentaje: discount?.porcentaje,
          autorizacionDescuento: discount?.autorizacion, destino: destino?.destino, mesa: destino?.mesa ?? undefined });
        setCart([]); setDiscount(null); setDestino(null);
        setLastOrder(order); setScreen('confirmed');
      }
    } catch (e) { addToast(e.message, 'warn'); }
  });
  const agregarAlTicket = data => {
    if (cart.length) { addToast('Primero envía o vacía el carrito actual para agregar productos a otro ticket.', 'warn'); return; }
    setAddingToOrder(data); setEditingOrder(null); setDiscount(null); setScreen('menu');
  };
  const cancelarAgregado = () => {
    if (cart.length && !window.confirm('¿Descartar estos productos que todavía no se enviaron?')) return;
    setCart([]); setAddingToOrder(null); setDiscount(null); setScreen('turno');
  };

  const [entregando, entregar] = useAccionUnica(confirmarEntrega);
  const handleCobrarClick = async previous => {
    if (addingToOrder?.id === previous.id && cart.length) {
      addToast('Primero envía los productos pendientes al ticket o cancela esa selección.', 'warn'); return;
    }
    let order;
    try { order = adaptPedido(await api.getPedido(previous.id)); }
    catch (e) { addToast(e.message, 'warn'); return; }
    if (order.cobrado || order.cancelado || order.noShow || order.cancelacionEstado === 'pendiente') { addToast('El ticket ya no está disponible para cobro.', 'warn'); return; }
    if (order.total > 0) {
      setChargingOrder(order);
      setAmounts({ subtotal: order.total, discountAmt: 0, total: order.total });
      setScreen('checkout');
    } else {
      // Entrega sin cobro: también un solo toque (ver useAccionUnica).
      if (!entregando) { try { await entregar(order.id, { totalEsperado: 0 }); } catch (e) { addToast(e.message, 'warn'); } }
    }
  };

  // Cancelación con motivo. La leyenda que vuelve del servidor dice si el
  // ticket ya salió de las ventas o si espera al administrador.
  const pedirCancelacion = async (orderId, motivo) => {
    const r = await cancelOrderFn(orderId, motivo);
    setCancelTarget(null);
    setRecargarVentas(n => n + 1);
    if (r && r.leyenda) addToast(r.leyenda, r.cancelacion_estado === 'pendiente' ? 'warn' : 'success');
    return r;
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
    confirmed: ['Pedido registrado', ''],
    turno: ['Ventas', 'Consulta por fecha y pedidos en curso'],
    directa: ['Venta directa o atrasada', 'Precio real y salida de inventario'],
  };
  const [title, subtitle] = TITLES[screen] || TITLES.menu;

  const cartPanel = (
    <CartView
      busy={enviando}
      cart={cart} setCart={setCart} discount={addingToOrder ? { porcentaje: Number(addingToOrder.descuento_porcentaje) } : discount}
      allowDiscount={!addingToOrder}
      ctaLabel={enviando ? 'Enviando…' : addingToOrder ? `Agregar a ${addingToOrder.folio}` : 'Enviar a comanda · cobrar después'}
      footerExtra={addingToOrder ? <p>Estos productos se sumarán al ticket, que actualmente tiene {money(addingToOrder.total)} por cobrar.</p> : <button className="btn-secondary full" disabled={!destino || enviando} onClick={() => {
        const subtotal = cart.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
        const discountAmt = subtotal * (discount?.porcentaje || 0) / 100;
        setAmounts({subtotal, discountAmt, total:subtotal-discountAmt}); setScreen('checkout');
      }}>Cobrar ahora</button>}
      onAuthorizeDiscount={authorizeDiscount}
      destino={destino} onDestino={addingToOrder ? undefined : setDestino} mesas={mesas}
      onCheckout={enviarComanda}
    />
  );
  const destinoTexto = chargingOrder ? destinoLabel(chargingOrder) : destinoLabel(destino ? { destino: destino.destino, mesaNumero: destino.mesa } : {});

  return (
    <AppShell
      brand={brand}
      items={navItems}
      active={screen === 'checkout' || screen === 'confirmed' ? 'menu' : screen}
      onSelect={id => { if (!enviando) { if (id === 'barra' && mostrador) mostrador.irA(); else setScreen(id); } }}
      user={{ ...currentUser, rol: mostrador ? 'mostrador' : 'cajero' }}
      roleLabel={mostrador ? 'Caja + barra' : 'Caja'}
      sedeNombre={sedeNombre}
      onLogout={onLogout}
      title={title}
      subtitle={subtitle}
      wide
      topRight={<>
        <CoffeeGuide />
        <button className={`turno-pill ${turnoAbierto ? 'open' : 'closed'}`} onClick={()=>setDrawerOpen(true)}>
          {turnoAbierto ? '● Turno abierto' : 'Abrir turno'}
        </button>
      </>}
    >
      {addingToOrder && <div className="promo-summary-card">
        Agregando productos al ticket <strong>{addingToOrder.folio}</strong> · {destinoLabel(adaptPedido(addingToOrder))}.
        <button className="link-toggle" disabled={enviando} onClick={cancelarAgregado}>Cancelar selección</button>
      </div>}
      <CajaDinero open={drawerOpen} onOpen={()=>setDrawerOpen(true)} onClose={()=>setDrawerOpen(false)} turnoAbierto={turnoAbierto} onToggleTurno={onToggleTurno} addToast={addToast}/>
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
      {screen === 'checkout' && <CheckoutView amounts={amounts} onBack={backFromCheckout} onConfirm={handleConfirmPay} allowCortesia destinoTexto={destinoTexto} />}
      {cortesiaAviso && (
        <Sheet title="Cortesía fuera del plan" onClose={() => setCortesiaAviso(null)}>
          <CortesiaAviso cortesia={cortesiaAviso} />
          <div className="sheet-footer"><span /><button className="btn-primary" onClick={() => setCortesiaAviso(null)}>Entendido</button></div>
        </Sheet>
      )}
      {screen === 'confirmed' && lastOrder && <ConfirmedView order={lastOrder} onNewSale={() => setScreen('menu')} />}
      {screen === 'turno' && (
        <TurnoView
          orders={orders} now={now} recargar={recargarVentas}
          onCancel={order => setCancelTarget(order)}
          onEdit={order => setEditingOrder(order)}
          onCobrar={handleCobrarClick}
          onNoShow={id => setNoShowTarget(id)}
        />
      )}

      {editingOrder && <OpenTicketSheet order={editingOrder} onClose={() => setEditingOrder(null)} onAdd={agregarAlTicket} onChanged={pedidoActualizado} />}
      {customizing && (
        <CustomizeSheet
          product={customizing}
          onClose={() => setCustomizing(null)}
          onAdd={item => { if (enviando) return; setCart(c => [...c, item]); addToast(`Agregado: ${getProduct(item.productId).name}`, 'success'); }}
        />
      )}

      {cancelTarget && (
        <CancelacionSheet
          folio={cancelTarget.folio}
          importe={cancelTarget.esCortesia ? null : cancelTarget.total}
          fecha={cancelTarget.createdAt}
          inmediata={!cancelTarget.cobrado && cancelTarget.estado === 'pendiente'}
          onClose={() => setCancelTarget(null)}
          onSubmit={motivo => pedirCancelacion(cancelTarget.id, motivo)}
        />
      )}

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
