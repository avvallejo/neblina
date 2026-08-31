// APP DEL CLIENTE — registro/verificación, menú, pedido, seguimiento en vivo,
// tarjeta de fidelidad y cuenta. Adaptable: en pantallas grandes el contenido
// se centra en columnas cómodas; en el teléfono se navega con la barra inferior.
import React, { useState, useEffect } from 'react';
import { Coffee, ShoppingCart, Clock, Lock, History, User, Sparkles, AlertCircle, Check } from 'lucide-react';
import * as api from '../api/client.js';
import { getProduct } from '../lib/catalog.js';
import { adaptCliente, adaptPedido, estadoPedidoCliente } from '../lib/adapters.js';
import { money, fmtHora, validPhone } from '../lib/helpers.js';
import { AppShell } from '../components/layout.jsx';
import { StatusChip, ConfirmDialog, EmptyState, FormError } from '../components/ui.jsx';
import { CategoryTabs, ProductGrid, CustomizeSheet, CartView } from '../components/menu.jsx';
import { RecipeModal } from '../components/recipe.jsx';

function LoyaltyCard({ count, cada, premioLabel, pending, onClaim }) {
  const progreso = pending ? cada : count % cada;
  const faltan = cada - progreso;
  const cups = Array.from({ length: cada }, (_, i) => i < progreso);
  return (
    <div className={`loyalty-card ${pending ? 'ready' : ''}`}>
      <div className="loyalty-head">
        <span>Tarjeta de fidelidad</span>
        <span className="loyalty-count">{progreso}/{cada}</span>
      </div>
      <div className="loyalty-cups">
        {cups.map((filled, i) => (
          <span key={i} className={`loyalty-cup ${filled ? 'filled' : ''} ${!filled && i === progreso ? 'next' : ''}`}>
            <Coffee size={14} />
          </span>
        ))}
      </div>
      {pending ? (
        <button className="loyalty-claim-btn" onClick={onClaim}><Sparkles size={14} /> Reclamar mi regalo: {premioLabel}</button>
      ) : (
        <div className="loyalty-footer">Faltan {faltan} pedido(s) por la app para: {premioLabel}</div>
      )}
    </div>
  );
}

function RegistroCliente({ form, setForm, error, onSubmit, sending, sedeNombre }) {
  return (
    <div className="registro-card">
      <div className="registro-icon"><Coffee size={26} /></div>
      <h2>Crea tu cuenta exprés</h2>
      <p className="registro-sub">Solo necesitamos esto para tu pedido y tu tarjeta de fidelidad{sedeNombre ? ` en ${sedeNombre}` : ''}.</p>
      <div className="option-group">
        <div className="option-label">Nombre</div>
        <input className="text-input" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. María" />
      </div>
      <div className="option-group">
        <div className="option-label">Apellido</div>
        <input className="text-input" value={form.apellido} onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} placeholder="Ej. González" />
      </div>
      <div className="option-group">
        <div className="option-label">Teléfono (10 dígitos)</div>
        <input className="text-input" inputMode="numeric" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="Ej. 9611234567" />
      </div>
      <FormError>{error}</FormError>
      <button className="btn-primary full" disabled={sending} onClick={onSubmit}>{sending ? 'Enviando…' : 'Continuar'}</button>
    </div>
  );
}

function PickupModeSelect({ onAhora, onDespues, title }) {
  return (
    <div className="pickup-select">
      <h2 className="pickup-title">{title || '¿Cómo quieres tu pedido?'}</h2>
      <button className="pickup-option" onClick={onAhora}>
        <span className="pickup-option-icon"><Coffee size={22} /></span>
        <span className="pickup-option-text"><strong>Pasarlo a recoger ahora</strong><span>Ya estoy en la cafetería</span></span>
      </button>
      <button className="pickup-option" onClick={onDespues}>
        <span className="pickup-option-icon"><Clock size={22} /></span>
        <span className="pickup-option-text"><strong>Pasar a recoger después</strong><span>Elige a qué hora llegas</span></span>
      </button>
    </div>
  );
}

function PickupTimePicker({ onConfirm, onBack, title }) {
  const [customTime, setCustomTime] = useState('');
  const quick = [15, 30, 45, 60];
  const confirmCustom = () => {
    const [h, m] = customTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    onConfirm(d.getTime());
  };
  return (
    <div className="pickup-select">
      <h2 className="pickup-title">{title || '¿A qué hora pasas?'}</h2>
      <div className="option-row" style={{ marginBottom: 14, justifyContent: 'center' }}>
        {quick.map(min => (
          <button key={min} className="option-chip" onClick={() => onConfirm(Date.now() + min * 60000)}>en {min} min</button>
        ))}
      </div>
      <div className="option-label">Elegir hora exacta</div>
      <input className="text-input" type="time" value={customTime} onChange={e => setCustomTime(e.target.value)} />
      <button className="btn-primary full" style={{ marginTop: 10 }} disabled={!customTime} onClick={confirmCustom}>Confirmar hora</button>
      <button className="btn-ghost" onClick={onBack}>Volver</button>
    </div>
  );
}

function ClienteConfirmado({ order, modo, horaRecogida, reward, onVerEstado }) {
  return (
    <div className="confirm-screen">
      <div className="confirm-check"><Check size={40} /></div>
      <div className="confirm-order-id">{order.folio || order.id}</div>
      <p style={{ fontWeight: 600, color: 'var(--ink-soft)' }}>{modo === 'programado' ? `Tu pedido estará listo cerca de las ${fmtHora(horaRecogida)}` : 'Tu pedido ya entró a preparación'}</p>
      {order.total > 0 && <div className="confirm-total">{money(order.total)}</div>}
      {reward && <div className="reward-banner"><Sparkles size={16} /> ¡Incluye tu regalo de fidelidad: {reward.name}!</div>}
      <button className="btn-primary" onClick={onVerEstado}><Clock size={16} /> Ver estado de mi pedido</button>
    </div>
  );
}

function ClienteSeguimiento({ order, onNuevoPedido, onCancelar }) {
  const [confirmar, setConfirmar] = useState(false);
  const items = order.items || [];
  const steps = ['pendiente', 'en_preparacion', 'terminado'];
  const allDone = items.length > 0 && items.every(t => t.estado === 'terminado' || t.estado === 'cancelado');
  const entregado = allDone && order.cobrado;
  const cancelable = !!onCancelar && estadoPedidoCliente(order) === 'pendiente';
  return (
    <div className="seguimiento">
      <div className="seguimiento-head">
        <div className="confirm-order-id">{order.folio || order.id}</div>
        <div className="footer-label">
          {order.cancelado ? 'Pedido cancelado' : order.no_show ? 'No recogido' : entregado ? '¡Entregado!' : allDone ? '¡Listo para recoger!' : 'Preparando tu pedido...'}
        </div>
      </div>
      {order.cancelado ? (
        <div className="noshow-banner"><AlertCircle size={20} /> Este pedido fue cancelado.</div>
      ) : order.no_show ? (
        <div className="noshow-banner">
          <AlertCircle size={20} /> Lamentamos que no pudiste pasar por este pedido. Por políticas de merma, se restó 1 punto de tu tarjeta de fidelidad.
        </div>
      ) : entregado ? (
        <div className="ready-banner"><Check size={20} /> Pedido entregado. ¡Gracias por tu visita!</div>
      ) : allDone && (
        <div className="ready-banner"><Check size={20} /> ¡Tu pedido está listo! Pasa al mostrador.</div>
      )}
      <div className="seguimiento-list">
        {items.map(t => {
          const icon = (getProduct(t.producto_id) || {}).icon || '☕';
          const stepIndex = t.estado === 'cancelado' ? -1 : steps.indexOf(t.estado);
          return (
            <div key={t.id} className="seguimiento-item">
              <span className="ticket-product-icon">{icon}</span>
              <div style={{ flex: 1 }}>
                <div className="ticket-product-name">{t.producto}{t.es_regalo ? ' 🎁' : ''}</div>
                <div className="progress-track">
                  {steps.map((s, i) => <span key={s} className={`progress-dot ${i <= stepIndex ? 'done' : ''}`} />)}
                </div>
              </div>
              <StatusChip status={t.estado} />
            </div>
          );
        })}
      </div>
      {cancelable && (
        <button className="link-danger full-cancel" onClick={() => setConfirmar(true)}>Cancelar mi pedido</button>
      )}
      <button className="btn-secondary full" onClick={onNuevoPedido}>Hacer otro pedido</button>
      <ConfirmDialog
        open={confirmar}
        title="Cancelar pedido"
        message="¿Seguro que quieres cancelar tu pedido? Solo se puede mientras no empiece a prepararse."
        confirmLabel="Sí, cancelar"
        danger
        onConfirm={() => { setConfirmar(false); onCancelar(order.id); }}
        onCancel={() => setConfirmar(false)}
      />
    </div>
  );
}

function CuentaCliente({ client, misPedidos, promoConfig, onBack, onClaimReward, onLogout }) {
  const premio = getProduct(promoConfig.premioId);
  const pedidos = misPedidos || [];
  const regalosObtenidos = pedidos.filter(p => (p.items || []).some(i => i.es_regalo) && p.cobrado).length;

  return (
    <div className="cuenta-view">
      <div className="cuenta-head">
        <span className="cuenta-avatar"><User size={20} /></span>
        <div>
          <div className="cuenta-name">{client.nombre} {client.apellido}</div>
          <div className="cuenta-phone">{client.telefono}</div>
        </div>
      </div>

      <div className="section-title"><Sparkles size={15} /> Tus recompensas</div>
      <LoyaltyCard
        count={client.pedidosApp}
        cada={promoConfig.cada}
        premioLabel={premio ? premio.name : '—'}
        pending={client.recompensaPendiente}
        onClaim={onClaimReward}
      />
      <div className="rewards-summary-card">
        <span>Regalos obtenidos hasta hoy</span>
        <span className="kpi-value-sm">{regalosObtenidos}</span>
      </div>

      <div className="section-title"><History size={15} /> Tu historial de pedidos</div>
      {pedidos.length === 0 ? (
        <EmptyState icon={History} title="Aún no tienes pedidos" subtitle="Cuando ordenes desde la app, los verás aquí" />
      ) : (
        pedidos.map(p => (
          <div key={p.id} className="historial-row">
            <div>
              <div className="turno-id">{p.folio || ''}</div>
              <div className="turno-sub">
                {new Date(p.creado_en).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })} {fmtHora(p.creado_en)} • {(p.items || []).length} producto(s)
                {(p.items || []).some(i => i.es_regalo) ? ' • 🎁 incluyó regalo' : ''}
              </div>
            </div>
            <div className="turno-right">
              <div className="turno-amount">{money(p.total)}</div>
              <StatusChip status={estadoPedidoCliente(p)} />
            </div>
          </div>
        ))
      )}

      <button className="btn-secondary full" style={{ marginTop: 10 }} onClick={onBack}>Volver al menú</button>
      <button className="btn-ghost" style={{ width: '100%', marginTop: 6 }} onClick={onLogout}>Cerrar sesión</button>
    </div>
  );
}

export default function ClienteApp({ brand, sede, turnoAbierto, promoConfig, smsActivo, addToast, onExit, recetaOverrides }) {
  const [cliente, setCliente] = useState(null);
  const [form, setForm] = useState({ nombre: '', apellido: '', telefono: '' });
  const [codigo, setCodigo] = useState('');
  const [formError, setFormError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [screen, setScreen] = useState('registro');
  const [modo, setModo] = useState(null);
  const [horaRecogida, setHoraRecogida] = useState(null);
  const [claimingReward, setClaimingReward] = useState(false);
  const [activeCat, setActiveCat] = useState('Calientes');
  const [customizing, setCustomizing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cart, setCart] = useState([]);
  const [lastOrder, setLastOrder] = useState(null);
  const [misPedidos, setMisPedidos] = useState([]);
  const [rewardInfo, setRewardInfo] = useState(null);

  const client = cliente;
  const mustShowClosed = cliente && !turnoAbierto && !['seguimiento', 'confirmado', 'cuenta'].includes(screen);

  const refrescarCuenta = React.useCallback(async () => {
    try {
      const [c, ped] = await Promise.all([api.getMiCuenta(), api.getMisPedidos()]);
      setCliente(adaptCliente(c));
      setMisPedidos(ped);
    } catch { /* ignore */ }
  }, []);

  const cancelarMiPedidoApp = React.useCallback(async (orderId) => {
    try {
      await api.cancelarMiPedido(orderId);
      await refrescarCuenta();
      addToast('Tu pedido fue cancelado', 'warn');
    } catch (e) { addToast(e.message, 'warn'); }
  }, [refrescarCuenta, addToast]);

  // Restaura la sesión del cliente desde el token guardado.
  useEffect(() => {
    if (!api.getTokenCliente()) return;
    api.getMiCuenta()
      .then(c => { setCliente(adaptCliente(c)); setScreen(s => (s === 'registro' ? 'modo' : s)); })
      .catch(() => { api.setTokenCliente(null); });
  }, []);

  // Refresca fidelidad e historial mientras ve su seguimiento o su cuenta.
  useEffect(() => {
    if (!['seguimiento', 'cuenta'].includes(screen) || !api.getTokenCliente()) return undefined;
    refrescarCuenta();
    const t = setInterval(refrescarCuenta, 4000);
    return () => clearInterval(t);
  }, [screen, refrescarCuenta]);

  const solicitarCodigo = async () => {
    const tel = form.telefono.replace(/\D/g, '');
    if (!form.nombre.trim() || !form.apellido.trim()) { setFormError('Completa tu nombre y apellido.'); return; }
    if (!validPhone(tel)) { setFormError('Ingresa un teléfono válido de 10 dígitos.'); return; }
    setFormError(''); setEnviando(true);
    try {
      if (smsActivo) {
        await api.clienteSolicitarCodigo(tel);
        setCodigo('');
        setScreen('codigo');
        addToast('Te enviamos un código por SMS.', 'success');
      } else {
        const c = await api.clienteRegistroDirecto({ telefono: tel, nombre: form.nombre.trim(), apellido: form.apellido.trim() });
        setCliente(adaptCliente(c));
        setScreen('modo');
      }
    } catch (e) { setFormError(e.message); }
    finally { setEnviando(false); }
  };

  const verificarCodigo = async () => {
    const tel = form.telefono.replace(/\D/g, '');
    if (!/^\d{6}$/.test(codigo)) { setFormError('El código es de 6 dígitos.'); return; }
    setFormError(''); setEnviando(true);
    try {
      const c = await api.clienteVerificarCodigo({ telefono: tel, codigo, nombre: form.nombre.trim(), apellido: form.apellido.trim() });
      setCliente(adaptCliente(c));
      setScreen('modo');
    } catch (e) { setFormError(e.message); }
    finally { setEnviando(false); }
  };

  const quickAddClient = product => {
    setCart(c => [...c, { uid: `${product.id}-${Date.now()}`, productId: product.id, qty: 1, unitPrice: product.price, extras: [] }]);
    addToast(`Agregado: ${product.name}`, 'success');
  };

  const handleConfirmarPedido = async () => {
    try {
      const r = await api.crearPedido({ cart, horaRecogida, comoCliente: true });
      setLastOrder(adaptPedido(r.pedido));
      setRewardInfo(null);
      setCart([]);
      setScreen('confirmado');
    } catch (e) { addToast('No se pudo enviar el pedido: ' + e.message, 'warn'); }
  };

  const startClaimReward = () => { setClaimingReward(true); setScreen('modo'); };

  const handleClaimReward = async hr => {
    const premio = getProduct(promoConfig.premioId);
    if (!premio) { addToast('No hay premio configurado.', 'warn'); return; }
    const rewardCart = [{
      uid: `reward-${Date.now()}`, productId: premio.id, qty: 1, unitPrice: 0,
      size: premio.sizes ? '12' : null,
      milk: premio.leche ? 'entera' : null,
      coffeeType: premio.coffeeType ? 'tradicional' : null,
      extras: [], notas: 'Regalo de fidelidad', isReward: true,
    }];
    try {
      const r = await api.crearPedido({ cart: rewardCart, horaRecogida: hr, comoCliente: true });
      setClaimingReward(false);
      setModo(hr ? 'programado' : 'ahora');
      setHoraRecogida(hr);
      setLastOrder(adaptPedido(r.pedido));
      setRewardInfo(premio);
      setScreen('confirmado');
      refrescarCuenta();
    } catch (e) { addToast('No se pudo reclamar el regalo: ' + e.message, 'warn'); }
  };

  const cerrarSesionCliente = () => {
    api.setTokenCliente(null);
    setCliente(null);
    setMisPedidos([]);
    setLastOrder(null);
    setForm({ nombre: '', apellido: '', telefono: '' });
    setScreen('registro');
  };

  const seguimientoOrder = lastOrder ? (misPedidos.find(p => p.id === lastOrder.id) || null) : null;
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  const navItems = [
    { id: 'menu', label: 'Menú', Icon: Coffee },
    { id: 'cart', label: 'Carrito', Icon: ShoppingCart, badge: cartCount },
    ...(lastOrder ? [{ id: 'seguimiento', label: 'Mi pedido', Icon: Clock }] : []),
    ...(client ? [{ id: 'cuenta', label: 'Mi cuenta', Icon: User }] : []),
  ];

  const goNav = id => {
    if (!client) return; // aún registrándose
    if (id === 'menu' && !modo && !claimingReward) { setScreen('modo'); return; }
    setScreen(id);
  };

  return (
    <AppShell
      brand={brand}
      items={navItems}
      active={screen}
      onSelect={goNav}
      user={client ? { nombre: `${client.nombre}`, rol: 'cliente' } : null}
      roleLabel="Cliente"
      sedeNombre={sede ? sede.nombre : ''}
      onLogout={onExit}
      title={screen === 'cuenta' ? 'Mi cuenta' : brand?.nombre || 'Mi pedido'}
      subtitle={sede ? `Sucursal ${sede.nombre}` : ''}
      topRight={client && screen !== 'cuenta' ? (
        <button className="icon-btn" onClick={() => setScreen('cuenta')} aria-label="Mi cuenta"><History size={18} /></button>
      ) : null}
    >
      {screen === 'registro' && (
        <RegistroCliente form={form} setForm={setForm} error={formError} sending={enviando} onSubmit={solicitarCodigo} sedeNombre={sede?.nombre} />
      )}

      {screen === 'codigo' && (
        <div className="registro-card">
          <div className="registro-icon"><Lock size={26} /></div>
          <h2>Verifica tu teléfono</h2>
          <p className="registro-sub">Te enviamos un código de 6 dígitos por SMS al {form.telefono}.</p>
          <div className="option-group">
            <div className="option-label">Código de verificación</div>
            <input className="text-input" inputMode="numeric" maxLength={6} value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 dígitos" />
          </div>
          <FormError>{formError}</FormError>
          <button className="btn-primary full" disabled={enviando} onClick={verificarCodigo}>Verificar y entrar</button>
          <button className="btn-ghost" style={{ width: '100%' }} onClick={() => { setScreen('registro'); setCodigo(''); setFormError(''); }}>Volver</button>
        </div>
      )}

      {screen !== 'registro' && screen !== 'codigo' && mustShowClosed && (
        <EmptyState icon={Clock} title="Estamos cerrados por ahora" subtitle="Esta pantalla se actualizará sola cuando abramos el turno. ¡Te esperamos!" />
      )}

      {screen !== 'registro' && screen !== 'codigo' && !mustShowClosed && (
        <>
          {screen === 'modo' && (
            <PickupModeSelect
              title={claimingReward ? '¿Cómo quieres tu regalo?' : undefined}
              onAhora={() => {
                if (claimingReward) { handleClaimReward(null); }
                else { setModo('ahora'); setHoraRecogida(null); setScreen('menu'); }
              }}
              onDespues={() => setScreen('hora')}
            />
          )}
          {screen === 'hora' && (
            <PickupTimePicker
              title={claimingReward ? '¿A qué hora pasas por tu regalo?' : undefined}
              onBack={() => setScreen('modo')}
              onConfirm={ts => {
                if (claimingReward) { handleClaimReward(ts); }
                else { setModo('programado'); setHoraRecogida(ts); setScreen('menu'); }
              }}
            />
          )}
          {screen === 'menu' && (
            <div style={{ maxWidth: 980 }}>
              {client && client.recompensaPendiente && (
                <button className="reward-ready-banner" onClick={startClaimReward}>
                  <Sparkles size={18} /> ¡Tienes un regalo listo para reclamar!
                </button>
              )}
              <CategoryTabs active={activeCat} onSelect={setActiveCat} />
              <ProductGrid activeCat={activeCat} onTap={p => (p.tipo === 'snack' ? quickAddClient(p) : setCustomizing(p))} />
            </div>
          )}
          {screen === 'cart' && (
            <div style={{ maxWidth: 640 }}>
              <CartView
                cart={cart} setCart={setCart} discount={null}
                allowDiscount={false}
                ctaLabel="Confirmar pedido"
                footerExtra={client && getProduct(promoConfig.premioId) && (
                  <LoyaltyCard
                    count={client.pedidosApp} cada={promoConfig.cada} premioLabel={getProduct(promoConfig.premioId).name}
                    pending={client.recompensaPendiente} onClaim={startClaimReward}
                  />
                )}
                onCheckout={handleConfirmarPedido}
              />
            </div>
          )}
          {screen === 'confirmado' && lastOrder && (
            <ClienteConfirmado order={lastOrder} modo={modo} horaRecogida={horaRecogida} reward={rewardInfo} onVerEstado={() => setScreen('seguimiento')} />
          )}
          {screen === 'cuenta' && client && (
            <CuentaCliente client={client} misPedidos={misPedidos} promoConfig={promoConfig} onBack={() => setScreen('menu')} onClaimReward={startClaimReward} onLogout={cerrarSesionCliente} />
          )}
          {screen === 'seguimiento' && lastOrder && (
            <ClienteSeguimiento
              order={seguimientoOrder || lastOrder}
              onNuevoPedido={() => { setScreen('menu'); setLastOrder(null); setMisPedidos([]); }}
              onCancelar={cancelarMiPedidoApp}
            />
          )}
        </>
      )}

      {customizing && (
        <CustomizeSheet
          product={customizing}
          onClose={() => setCustomizing(null)}
          onAdd={item => { setCart(c => [...c, item]); addToast(`Agregado: ${getProduct(item.productId).name}`, 'success'); }}
          onPreviewRecipe={sel => setPreview({ productId: customizing.id, ...sel })}
        />
      )}
      {preview && <RecipeModal ticket={preview} override={recetaOverrides[preview.productId]} readOnly onClose={() => setPreview(null)} />}
    </AppShell>
  );
}
