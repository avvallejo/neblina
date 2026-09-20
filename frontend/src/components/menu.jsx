import ProductImage from './ProductImage.jsx';
// Piezas del menú/POS compartidas por Caja y Cliente.
import React, { useState } from 'react';
import { Coffee, ShoppingCart, Snowflake, Trash2, ClipboardList, AlertTriangle, Banknote, CreditCard, ArrowLeftRight, Wallet, Gift } from 'lucide-react';
import * as api from '../api/client.js';
import { CATEGORIES, PRODUCTS, SIZE_OPTIONS, MILK_OPTIONS, COFFEE_OPTIONS, getProduct, defaultSize, calcUnitPrice, customizationSummary, precioDesde, extrasPara, esAlimento } from '../lib/catalog.js';
import { money } from '../lib/helpers.js';
import { Sheet, Stepper, EmptyState, FormError, useAccionUnica } from './ui.jsx';

export function CategoryTabs({ active, onSelect }) {
  return (
    <div className="cat-tabs">
      {CATEGORIES.map(c => {
        const Icon = c.icon;
        return (
          <button key={c.id} className={`cat-tab ${active === c.id ? 'active' : ''}`} onClick={() => onSelect(c.id)}>
            <Icon size={16} /> {c.id}
          </button>
        );
      })}
    </div>
  );
}

// bloquearAgotados: en la app del cliente un snack sin existencias no se puede
// pedir; en Caja sigue vendiéndose (el inventario puede no estar al día).
export function ProductGrid({ activeCat, onTap, bloquearAgotados = false }) {
  const list = PRODUCTS.filter(p => p.cat === activeCat && p.activo !== false);
  return (
    <div className="product-grid">
      {list.length === 0 ? (
        <EmptyState icon={Coffee} title="Sin productos disponibles en esta categoría" />
      ) : (
        list.map(p => (
          <button key={p.id} className={`product-card ${p.agotado ? 'agotado' : ''}`} disabled={bloquearAgotados && p.agotado} onClick={() => onTap(p)}>
            {p.agotado && <span className="agotado-tag">Agotado</span>}
            {p.frio && <span className="frio-tag"><Snowflake size={12} /></span>}
            <span className="product-icon"><ProductImage product={p} size={64}/></span>
            <span className="product-name">{p.name}</span>
            <span className="product-price">{p.sizes ? `desde ${money(precioDesde(p))}` : money(p.price)}</span>
          </button>
        ))
      )}
    </div>
  );
}

export function CustomizeSheet({ product, onClose, onAdd, onPreviewRecipe, allowPriceOverride = false }) {
  const [sel, setSel] = useState({
    size: product.sizes ? defaultSize() : null,
    milk: product.leche ? 'entera' : null,
    coffeeType: product.coffeeType ? 'tradicional' : null,
    extras: [],
    notas: '',
    qty: 1,
  });

  const toggleExtra = id => {
    setSel(s => ({ ...s, extras: s.extras.includes(id) ? s.extras.filter(e => e !== id) : [...s.extras, id] }));
  };

  const alimento = esAlimento(product);
  const extrasDisponibles = product.extras ? extrasPara(product) : [];
  const catalogPrice = calcUnitPrice(product, sel);
  const [enteredPrice, setEnteredPrice] = useState(null);
  const [priceReason, setPriceReason] = useState('');
  const priceValid = enteredPrice === null || (enteredPrice.trim() !== '' && Number.isFinite(Number(enteredPrice)) && Number(enteredPrice) >= 0 && Number(enteredPrice) <= 100000);
  const unitPrice = allowPriceOverride && enteredPrice !== null && priceValid ? Math.round(Number(enteredPrice) * 100) / 100 : catalogPrice;
  const changedPrice = allowPriceOverride && unitPrice !== catalogPrice;
  const canAdd = !allowPriceOverride || (priceValid && (!changedPrice || priceReason.trim().length >= 3));
  const lineTotal = unitPrice * sel.qty;

  const optionBlock = (label, options, selectedId, onPick) => (
    <div className="option-group">
      <div className="option-label">{label}</div>
      <div className="option-row">
        {options.map(o => (
          <button key={o.id} className={`option-chip ${selectedId === o.id ? 'selected' : ''}`} onClick={() => onPick(o.id)}>
            {o.label}{o.delta ? ` (${o.delta > 0 ? '+' : ''}${o.delta})` : ''}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Sheet title={product.name} onClose={onClose}>
      {onPreviewRecipe && (
        <button className="recipe-preview-link" onClick={() => onPreviewRecipe(sel)}>
          <ClipboardList size={14} /> {alimento ? 'Ver receta' : 'Ver receta de esta bebida'}
        </button>
      )}
      {product.sizes && optionBlock('Tamaño', SIZE_OPTIONS, sel.size, id => setSel(s => ({ ...s, size: id })))}
      {product.leche && optionBlock('Leche', MILK_OPTIONS, sel.milk, id => setSel(s => ({ ...s, milk: id })))}
      {product.coffeeType && optionBlock('Café', COFFEE_OPTIONS.map(o => ({...o, delta:Number(product.coffeePrices?.[o.id] ?? o.delta)})), sel.coffeeType, id => setSel(s => ({ ...s, coffeeType: id })))}
      {extrasDisponibles.length > 0 && (
        <div className="option-group">
          <div className="option-label">Extras</div>
          <div className="option-row">
            {extrasDisponibles.map(o => (
              <button key={o.id} className={`option-chip ${sel.extras.includes(o.id) ? 'selected' : ''}`} onClick={() => toggleExtra(o.id)}>
                {o.label} (+{o.delta})
              </button>
            ))}
          </div>
        </div>
      )}
      {allowPriceOverride && <div className="option-group" style={{padding:16,background:'#f5eee3',borderRadius:12}}>
        <label className="option-label" htmlFor="sale-unit-price">Precio cobrado por unidad ($)</label>
        <input id="sale-unit-price" className="text-input" type="number" inputMode="decimal" min="0" max="100000" step="0.01" value={enteredPrice ?? catalogPrice} onChange={e=>setEnteredPrice(e.target.value)} />
        <div className="field-hint">Catálogo con esta personalización: {money(catalogPrice)}. Escribe el precio final que cobraste, incluidos los extras. Se descontarán los insumos de la receta y las opciones elegidas.</div>
        {enteredPrice !== null && <button type="button" className="link-toggle" onClick={()=>{setEnteredPrice(null);setPriceReason('');}}>Usar precio del catálogo</button>}
        {changedPrice && <><label className="option-label" htmlFor="sale-price-reason" style={{marginTop:12}}>Motivo del precio</label><input id="sale-price-reason" className="text-input" maxLength={300} placeholder="Ej. promoción de apertura / precio acordado" value={priceReason} onChange={e=>setPriceReason(e.target.value)}/></>}
        {!priceValid && <FormError>Indica un precio válido entre $0 y $100,000.</FormError>}
      </div>}
      <div className="option-group">
        <div className="option-label">Cantidad</div>
        <Stepper value={sel.qty} onChange={v => setSel(s => ({ ...s, qty: v }))} />
      </div>
      <div className="option-group">
        <div className="option-label">{alimento ? 'Notas para la cocina' : 'Notas para el barista'}</div>
        <textarea className="notes-input" rows={2} placeholder={alimento ? 'Ej. sin cebolla, término medio...' : 'Ej. sin azúcar, bien caliente...'} value={sel.notas} onChange={e => setSel(s => ({ ...s, notas: e.target.value }))} />
      </div>
      <div className="sheet-footer">
        <div>
          <div className="footer-label">Total</div>
          <div className="price-total">{money(lineTotal)}</div>
        </div>
        <button className="btn-primary" disabled={!canAdd} onClick={() => { onAdd({ uid: `${product.id}-${Date.now()}`, productId: product.id, ...sel, unitPrice, ...(allowPriceOverride ? {originalPrice:catalogPrice,motivoPrecio:changedPrice ? priceReason.trim() : ''} : {}) }); onClose(); }}>
          {allowPriceOverride ? `Agregar a la venta · ${money(lineTotal)}` : 'Agregar al carrito'}
        </button>
      </div>
    </Sheet>
  );
}

function DiscountSheet({ onClose, onApply, current }) {
  const [pct, setPct] = useState(current?.porcentaje || 10);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const apply = async () => {
    setLoading(true); setError('');
    try { await onApply(pct, code); onClose(); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  return (
    <Sheet title="Aplicar descuento" onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Porcentaje</div>
        <div className="option-row">
          {[5, 10, 15, 20].map(p => (
            <button key={p} className={`option-chip ${pct === p ? 'selected' : ''}`} onClick={() => setPct(p)}>{p}%</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">PIN de autorización (administrador de esta sucursal)</div>
        <input className="text-input" placeholder="Ej. 1234" value={code} onChange={e => setCode(e.target.value)} />
        <FormError>{error}</FormError>
      </div>
      <div className="sheet-footer">
        {current ? <button className="btn-ghost" onClick={() => { onApply(null); onClose(); }}>Quitar descuento</button> : <span />}
        <button className="btn-primary" disabled={!/^\d{4}$/.test(code) || loading} onClick={apply}>{loading ? 'Autorizando…' : `Aplicar ${pct}%`}</button>
      </div>
    </Sheet>
  );
}

// Destino del pedido (solo Caja): Mesa 1..N, Barra o Para llevar. Es
// obligatorio antes de cobrar para que la comanda siempre sepa a dónde va.
export function DestinoPicker({ mesas = 4, value, onChange }) {
  const opciones = [
    ...Array.from({ length: Math.max(0, Number(mesas) || 0) }, (_, i) => ({ id: `mesa-${i + 1}`, destino: 'mesa', mesa: i + 1, label: `Mesa ${i + 1}` })),
    { id: 'barra', destino: 'barra', mesa: null, label: 'Barra' },
    { id: 'llevar', destino: 'llevar', mesa: null, label: 'Para llevar' },
  ];
  const activo = value ? (value.destino === 'mesa' ? `mesa-${value.mesa}` : value.destino) : null;
  return (
    <div className="destino-picker">
      <div className="option-label">¿A dónde va el pedido?</div>
      <div className="option-row">
        {opciones.map(o => (
          <button key={o.id} type="button" className={`option-chip destino-chip ${activo === o.id ? 'selected' : ''}`} onClick={() => onChange({ destino: o.destino, mesa: o.mesa })}>
            {o.label}
          </button>
        ))}
      </div>
      {!value && <div className="field-hint">Elige mesa, barra o para llevar para enviar el pedido.</div>}
    </div>
  );
}

// Importes del carrito con cortesías por línea: lo regalado sale del subtotal
// y el descuento (si hay) aplica solo sobre lo que sí se cobra — mismo
// cálculo que hace el servidor.
export function calcCartAmounts(cart, discountPct = 0) {
  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const cortesiaAmt = cart.filter(i => i.cortesia).reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const cortesiaUnits = cart.filter(i => i.cortesia).reduce((s, i) => s + i.qty, 0);
  const cobrable = subtotal - cortesiaAmt;
  const discountAmt = discountPct ? cobrable * (discountPct / 100) : 0;
  const total = Math.round((cobrable - discountAmt) * 100) / 100;
  return { subtotal, cortesiaAmt, cortesiaUnits, discountPct, discountAmt, total };
}

// allowCortesia (solo Caja): cada línea tiene un botón de regalo para marcarla
// como cortesía dentro del mismo ticket; el resto se cobra normal.
export function CartView({ busy = false, cart, setCart, discount, onAuthorizeDiscount, onCheckout, allowDiscount = true, allowCortesia = false, ctaLabel, footerExtra, compact, destino, onDestino, mesas, nombreTicket, onNombreTicket }) {
  const [discountOpen, setDiscountOpen] = useState(false);
  const updateQty = (uid, qty) => {
    if (qty <= 0) { setCart(c => c.filter(i => i.uid !== uid)); return; }
    setCart(c => c.map(i => (i.uid === uid ? { ...i, qty } : i)));
  };
  const toggleCortesia = uid => setCart(c => c.map(i => (i.uid === uid ? { ...i, cortesia: !i.cortesia } : i)));
  const discountPct = discount?.porcentaje || 0;
  const { subtotal, cortesiaAmt, cortesiaUnits, discountAmt, total } = calcCartAmounts(cart, discountPct);
  const todasCortesia = cart.length > 0 && cart.every(i => i.cortesia || i.isReward);

  if (cart.length === 0) {
    return <EmptyState icon={ShoppingCart} title="El carrito está vacío" subtitle="Toca un producto en el menú para comenzar" />;
  }

  return (
    <fieldset className="cart-view" disabled={busy} style={{border:0, padding:0, margin:0, minWidth:0}}>
      <div className="cart-list">
        {cart.map(item => {
          const product = getProduct(item.productId);
          return (
            <div key={item.uid} className="cart-item">
              <span className="cart-item-icon"><ProductImage product={product}/></span>
              <div className="cart-item-info">
                <div className="cart-item-name">{product?.name}{item.isReward ? ' 🎁' : ''}{item.cortesia && <span className="cortesia-tag" style={{ marginLeft: 6 }}><Gift size={10} /> Cortesía</span>}</div>
                <div className="cart-item-sub">{customizationSummary(item) || 'Sin personalización'}</div>
                {item.notas && <div className="cart-item-notes">"{item.notas}"</div>}
              </div>
              <div className="cart-item-controls">
                <Stepper value={item.qty} onChange={v => updateQty(item.uid, v)} />
                <div className={`cart-item-price ${item.cortesia ? 'cortesia' : ''}`}>{item.cortesia ? <><s>{money(item.unitPrice * item.qty)}</s> $0.00</> : money(item.unitPrice * item.qty)}</div>
                {allowCortesia && !item.isReward && (
                  <button type="button" className={`icon-btn small cortesia-toggle ${item.cortesia ? 'active' : ''}`} onClick={() => toggleCortesia(item.uid)}
                    aria-pressed={!!item.cortesia} aria-label={item.cortesia ? `Cobrar ${product?.name || 'producto'}` : `Marcar ${product?.name || 'producto'} como cortesía`} title={item.cortesia ? 'Quitar cortesía' : 'Cortesía (sale en $0)'}>
                    <Gift size={15} />
                  </button>
                )}
                <button className="icon-btn small" onClick={() => setCart(c => c.filter(i => i.uid !== item.uid))} aria-label="Quitar"><Trash2 size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cart-summary">
        {onNombreTicket && <label className="ticket-name-field">¿A nombre de quién?
          <input className="text-input" value={nombreTicket} onChange={e => onNombreTicket(e.target.value)} maxLength={80} placeholder="Nombre del cliente" required />
        </label>}
        {onDestino && <DestinoPicker mesas={mesas} value={destino} onChange={onDestino} />}
        {allowDiscount && (
          <button className="discount-link" onClick={() => setDiscountOpen(true)}>
            {discount ? `Descuento aplicado: ${discountPct}% — editar` : '+ Aplicar descuento (requiere autorización)'}
          </button>
        )}
        {allowCortesia && (
          <button type="button" className="discount-link" onClick={() => setCart(c => c.map(i => (i.isReward ? i : { ...i, cortesia: !todasCortesia })))}>
            <Gift size={13} style={{ verticalAlign: -2 }} /> {todasCortesia ? 'Quitar cortesías: cobrar todo el ticket' : cortesiaUnits > 0 ? 'Marcar todo el ticket como cortesía' : 'Todo el ticket de cortesía (o toca el regalo de cada producto)'}
          </button>
        )}
        {footerExtra}
        <div className="summary-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {cortesiaUnits > 0 && <div className="summary-row discount-row"><span><Gift size={12} style={{ verticalAlign: -2 }} /> Cortesía ({cortesiaUnits} producto{cortesiaUnits === 1 ? '' : 's'})</span><span>-{money(cortesiaAmt)}</span></div>}
        {discount && <div className="summary-row discount-row"><span>Descuento ({discountPct}%)</span><span>-{money(discountAmt)}</span></div>}
        <div className="summary-row total"><span>Total</span><span>{money(total)}</span></div>
        <button className="btn-primary full" style={{ marginTop: 10 }} disabled={(!!onDestino && !destino) || (!!onNombreTicket && !nombreTicket?.trim())} onClick={() => onCheckout({ subtotal, cortesiaAmt, cortesiaUnits, discountPct, discountAmt, total })}>{ctaLabel || (total === 0 && cortesiaUnits > 0 ? 'Registrar cortesía' : `Cobrar ${money(total)}`)}</button>
      </div>

      {allowDiscount && discountOpen && <DiscountSheet current={discount} onClose={() => setDiscountOpen(false)} onApply={onAuthorizeDiscount} />}
    </fieldset>
  );
}

// Cortesía dentro del cobro: con `unidades` productos marcados, la Caja ve
// cómo va el cupo mensual de la sucursal (se consume por producto). Si no
// caben, la venta se procesa igual pero el ticket queda pendiente de que un
// administrador lo autorice. `motivo`/`onMotivo` es el motivo opcional.
export function CortesiaPanel({ unidades, valor, motivo, onMotivo }) {
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState('');
  React.useEffect(() => {
    let alive = true;
    api.getPlanCortesias().then(p => { if (alive) setPlan(p); }).catch(e => { if (alive) setPlanError(e.message); });
    return () => { alive = false; };
  }, []);
  const caben = plan && plan.restantes >= unidades;
  const productos = `${unidades} producto${unidades === 1 ? '' : 's'}`;
  const estos = unidades === 1 ? 'Este producto entra' : `Estos ${productos} entran`;
  const noEntran = unidades === 1 ? 'Este producto ya no entra' : `Estos ${productos} ya no entran`;
  return (
    <div className="cortesia-panel">
      <div className="cortesia-plan neutral">
        <strong><Gift size={14} /> Cortesía de {productos} · {money(valor)} a precio de menú</strong>
        <span>Esos productos salen en $0; el resto del ticket se cobra normal.</span>
      </div>
      {!plan && !planError && <p role="status" className="field-hint">Consultando el plan de cortesías del mes…</p>}
      {planError && <FormError>No se pudo consultar el cupo del mes ({planError}). Puedes registrar la cortesía de todos modos: el sistema decidirá si entra en el plan.</FormError>}
      {plan && caben && (
        <div className="cortesia-plan ok">
          <strong>Cortesías de {plan.mesNombre}: {plan.usadas} de {plan.limite} usadas.</strong>
          <span>{estos} en el plan mensual. {plan.restantes - unidades === 0 ? 'Con esto se agota el plan.' : `Después quedarán ${plan.restantes - unidades}.`}</span>
        </div>
      )}
      {plan && !caben && (
        <div className="cortesia-plan warn" role="alert">
          <strong><AlertTriangle size={14} /> {plan.restantes > 0 ? `Solo quedan ${plan.restantes} de las ${plan.limite} cortesías de ${plan.mesNombre}.` : `Ya se agotaron las ${plan.limite} cortesías permitidas de ${plan.mesNombre}.`}</strong>
          <span>{noEntran} en tu plan mensual: un administrador debe autorizar el ticket. La venta se procesará de todos modos y quedará pendiente en Autorizaciones.</span>
          {plan.pendientes > 0 && <span>Ya hay {plan.pendientes} ticket(s) de este mes esperando autorización.</span>}
        </div>
      )}
      <div className="option-group">
        <label className="option-label" htmlFor="cortesia-motivo">Motivo de la cortesía (opcional)</label>
        <input id="cortesia-motivo" className="text-input" maxLength={200} placeholder="Ej. cliente frecuente / bebida mal preparada / invitación" value={motivo} onChange={e => onMotivo(e.target.value)} />
      </div>
    </div>
  );
}

// amounts: { subtotal, cortesiaAmt, cortesiaUnits, discountPct, total } (del
// carrito). Para cobrar un ticket ya abierto o un pedido en línea llega
// `items` (líneas del pedido): la Caja puede marcar ahí cuáles son cortesía y
// el total se recalcula igual que en el servidor.
export function CheckoutView({ amounts, items = null, onConfirm, onBack, allowCortesia = false, destinoTexto = '' }) {
  // Un solo cobro por más veces que se toque el botón (ver useAccionUnica).
  const [cobrando, cobrar] = useAccionUnica(onConfirm);
  const [method, setMethod] = useState('efectivo');
  const [cash, setCash] = useState('');
  const [mixCash, setMixCash] = useState('');
  const [mixCard, setMixCard] = useState('');
  const [motivoCortesia, setMotivoCortesia] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const lineas = (items || []).filter(i => i.estado !== 'cancelado');
  const [cortesiaIds, setCortesiaIds] = useState(() => new Set(lineas.filter(i => i.es_cortesia).map(i => i.id)));
  const toggleLinea = id => setCortesiaIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const discountPct = Number(amounts.discountPct || 0);
  const calc = items
    ? calcCartAmounts(lineas.map(i => ({ unitPrice: Number(i.precio_unitario), qty: Number(i.cantidad), cortesia: cortesiaIds.has(i.id), isReward: i.es_regalo })), discountPct)
    : { subtotal: amounts.subtotal, cortesiaAmt: amounts.cortesiaAmt || 0, cortesiaUnits: amounts.cortesiaUnits || 0, discountAmt: amounts.discountAmt || 0, total: amounts.total };
  const { total, cortesiaAmt, cortesiaUnits } = calc;
  const soloCortesia = total === 0 && cortesiaUnits > 0;

  const cashGiven = parseFloat(cash) || 0;
  const change = cashGiven - total;
  const mixSum = (parseFloat(mixCash) || 0) + (parseFloat(mixCard) || 0);

  const canConfirm = soloCortesia ? true
    : method === 'tarjeta' || method === 'transferencia'
      ? true
      : method === 'efectivo'
      ? cashGiven >= total
      : Math.abs(mixSum - total) < 0.01;

  const methods = [
    { id: 'efectivo', label: 'Efectivo', Icon: Banknote },
    { id: 'tarjeta', label: 'Tarjeta', Icon: CreditCard },
    { id: 'transferencia', label: 'Transferencia', Icon: ArrowLeftRight },
    { id: 'mixto', label: 'Mixto', Icon: Wallet },
  ];

  return (
    <div className="checkout-view">
      <div className="checkout-total-card">
        <span className="footer-label" style={{ color: '#C9BCA8' }}>{soloCortesia ? 'Todo el ticket es cortesía' : 'Total a cobrar'}</span>
        <span className="price-total big">{money(total)}</span>
        {cortesiaUnits > 0 && <span className="field-hint checkout-cortesia-hint">Incluye cortesía de {cortesiaUnits} producto{cortesiaUnits === 1 ? '' : 's'} por {money(cortesiaAmt)}{calc.discountAmt > 0 ? ` y descuento de ${money(calc.discountAmt)}` : ''}</span>}
        {destinoTexto && <span className="checkout-destino">{destinoTexto}</span>}
      </div>

      {allowCortesia && items && lineas.length > 0 && (
        <div className="option-group checkout-lineas">
          <div className="option-label">Productos del ticket · toca el regalo para dar uno de cortesía</div>
          {lineas.map(i => {
            const esCortesia = cortesiaIds.has(i.id);
            return (
              <div key={i.id} className={`cart-item compact ${esCortesia ? 'cortesia' : ''}`}>
                <div className="cart-item-info">
                  <div className="cart-item-name">{i.cantidad} × {i.producto_nombre}{esCortesia && <span className="cortesia-tag" style={{ marginLeft: 6 }}><Gift size={10} /> Cortesía</span>}</div>
                  <div className="cart-item-sub">{[i.tamano_etiqueta, i.leche_etiqueta, i.cafe_etiqueta, ...(i.extras || [])].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="cart-item-controls">
                  <div className={`cart-item-price ${esCortesia ? 'cortesia' : ''}`}>{esCortesia ? <><s>{money(Number(i.precio_unitario) * Number(i.cantidad))}</s> $0.00</> : money(Number(i.precio_unitario) * Number(i.cantidad))}</div>
                  {!i.es_regalo && (
                    <button type="button" className={`icon-btn small cortesia-toggle ${esCortesia ? 'active' : ''}`} onClick={() => toggleLinea(i.id)} disabled={cobrando}
                      aria-pressed={esCortesia} aria-label={esCortesia ? `Cobrar ${i.producto_nombre}` : `Marcar ${i.producto_nombre} como cortesía`} title={esCortesia ? 'Quitar cortesía' : 'Cortesía (sale en $0)'}>
                      <Gift size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cortesiaUnits > 0 && <CortesiaPanel unidades={cortesiaUnits} valor={cortesiaAmt} motivo={motivoCortesia} onMotivo={setMotivoCortesia} />}

      {!soloCortesia && <>
      <div className="option-label">Forma de pago</div>
      <div className="pay-methods">
        {methods.map(m => (
          <button key={m.id} className={`pay-method-btn ${method === m.id ? 'selected' : ''}`} onClick={() => setMethod(m.id)}>
            <m.Icon size={20} /><span>{m.label}</span>
          </button>
        ))}
      </div>
      </>}

      {!soloCortesia && method === 'efectivo' && (
        <div className="option-group" style={{ marginTop: 12 }}>
          <div className="option-label">Monto recibido</div>
          <div className="option-row">
            {[total, Math.ceil(total / 50) * 50, 200, 500].filter((v, i, a) => a.indexOf(v) === i).map(v => (
              <button key={v} className="option-chip" onClick={() => setCash(String(v))}>{money(v)}</button>
            ))}
          </div>
          <input className="text-input" type="number" placeholder="Otro monto..." style={{ marginTop: 8 }} value={cash} onChange={e => setCash(e.target.value)} />
          <div className={`change-display ${change < 0 ? 'warn' : ''}`}>
            <span className="footer-label">{change < 0 ? 'Falta' : 'Cambio a entregar'}</span>
            <span className="change-amount">{money(Math.abs(change || 0))}</span>
          </div>
        </div>
      )}

      {!soloCortesia && method === 'mixto' && (
        <div className="option-group" style={{ marginTop: 12 }}>
          <div className="option-label">Efectivo</div>
          <input className="text-input" type="number" placeholder="$0.00" value={mixCash} onChange={e => setMixCash(e.target.value)} />
          <div className="option-label" style={{ marginTop: 10 }}>Tarjeta / transferencia</div>
          <input className="text-input" type="number" placeholder="$0.00" value={mixCard} onChange={e => setMixCard(e.target.value)} />
          <div className={`change-display ${Math.abs(mixSum - total) > 0.01 ? 'warn' : ''}`}>
            <span className="footer-label">Diferencia con el total</span>
            <span className="change-amount">{money(total - mixSum)}</span>
          </div>
        </div>
      )}

      <FormError>{paymentError}</FormError>
      <div className="sheet-footer" style={{ marginTop: 16 }}>
        <button className="btn-ghost" onClick={onBack} disabled={cobrando}>Volver</button>
        <button
          className="btn-primary"
          disabled={!canConfirm || cobrando}
          onClick={async () => {
            setPaymentError('');
            try {
              await cobrar({
                method: soloCortesia ? 'cortesia' : method,
                importeEfectivo: !soloCortesia && method === 'mixto' ? Number(mixCash) : undefined,
                cashGiven: !soloCortesia && method === 'efectivo' ? cashGiven : null,
                change: !soloCortesia && method === 'efectivo' ? change : null,
                motivoCortesia: cortesiaUnits > 0 && motivoCortesia.trim() ? motivoCortesia.trim() : undefined,
                itemsCortesia: items ? [...cortesiaIds] : undefined,
                cortesiaUnits,
              });
            }
            catch (e) { setPaymentError(e.message); }
          }}
        >
          {cobrando ? (soloCortesia ? 'Registrando…' : 'Cobrando…') : soloCortesia ? 'Registrar cortesía' : cortesiaUnits > 0 ? 'Confirmar pago y cortesía' : 'Confirmar pago'}
        </button>
      </div>
    </div>
  );
}
