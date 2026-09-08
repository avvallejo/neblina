// Piezas del menú/POS compartidas por Caja y Cliente.
import React, { useState } from 'react';
import { Coffee, ShoppingCart, Snowflake, Trash2, ClipboardList, AlertTriangle, Banknote, CreditCard, ArrowLeftRight, Wallet } from 'lucide-react';
import { CATEGORIES, PRODUCTS, SIZE_OPTIONS, MILK_OPTIONS, COFFEE_OPTIONS, EXTRA_OPTIONS, getProduct, defaultSize, calcUnitPrice, customizationSummary, precioDesde } from '../lib/catalog.js';
import { money } from '../lib/helpers.js';
import { Sheet, Stepper, EmptyState, FormError } from './ui.jsx';

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

export function ProductGrid({ activeCat, onTap }) {
  const list = PRODUCTS.filter(p => p.cat === activeCat && p.activo !== false);
  return (
    <div className="product-grid">
      {list.length === 0 ? (
        <EmptyState icon={Coffee} title="Sin productos disponibles en esta categoría" />
      ) : (
        list.map(p => (
          <button key={p.id} className="product-card" onClick={() => onTap(p)}>
            {p.frio && <span className="frio-tag"><Snowflake size={12} /></span>}
            <span className="product-icon">{p.icon}</span>
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
          <ClipboardList size={14} /> Ver receta de esta bebida
        </button>
      )}
      {product.sizes && optionBlock('Tamaño', SIZE_OPTIONS, sel.size, id => setSel(s => ({ ...s, size: id })))}
      {product.leche && optionBlock('Leche', MILK_OPTIONS, sel.milk, id => setSel(s => ({ ...s, milk: id })))}
      {product.coffeeType && optionBlock('Café', COFFEE_OPTIONS.map(o => ({...o, delta:Number(product.coffeePrices?.[o.id] ?? o.delta)})), sel.coffeeType, id => setSel(s => ({ ...s, coffeeType: id })))}
      {product.extras && (
        <div className="option-group">
          <div className="option-label">Extras</div>
          <div className="option-row">
            {EXTRA_OPTIONS.map(o => (
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
        <div className="option-label">Notas para el barista</div>
        <textarea className="notes-input" rows={2} placeholder="Ej. sin azúcar, bien caliente..." value={sel.notas} onChange={e => setSel(s => ({ ...s, notas: e.target.value }))} />
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

export function CartView({ cart, setCart, discount, onAuthorizeDiscount, onCheckout, allowDiscount = true, ctaLabel, footerExtra, compact }) {
  const [discountOpen, setDiscountOpen] = useState(false);
  const updateQty = (uid, qty) => {
    if (qty <= 0) { setCart(c => c.filter(i => i.uid !== uid)); return; }
    setCart(c => c.map(i => (i.uid === uid ? { ...i, qty } : i)));
  };
  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const discountPct = discount?.porcentaje || 0;
  const discountAmt = discountPct ? subtotal * (discountPct / 100) : 0;
  const total = subtotal - discountAmt;

  if (cart.length === 0) {
    return <EmptyState icon={ShoppingCart} title="El carrito está vacío" subtitle="Toca un producto en el menú para comenzar" />;
  }

  return (
    <div className="cart-view">
      <div className="cart-list">
        {cart.map(item => {
          const product = getProduct(item.productId);
          return (
            <div key={item.uid} className="cart-item">
              <span className="cart-item-icon">{product?.icon || '☕'}</span>
              <div className="cart-item-info">
                <div className="cart-item-name">{product?.name}{item.isReward ? ' 🎁' : ''}</div>
                <div className="cart-item-sub">{customizationSummary(item) || 'Sin personalización'}</div>
                {item.notas && <div className="cart-item-notes">"{item.notas}"</div>}
              </div>
              <div className="cart-item-controls">
                <Stepper value={item.qty} onChange={v => updateQty(item.uid, v)} />
                <div className="cart-item-price">{money(item.unitPrice * item.qty)}</div>
                <button className="icon-btn small" onClick={() => setCart(c => c.filter(i => i.uid !== item.uid))} aria-label="Quitar"><Trash2 size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cart-summary">
        {allowDiscount && (
          <button className="discount-link" onClick={() => setDiscountOpen(true)}>
            {discount ? `Descuento aplicado: ${discountPct}% — editar` : '+ Aplicar descuento (requiere autorización)'}
          </button>
        )}
        {footerExtra}
        <div className="summary-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {discount && <div className="summary-row discount-row"><span>Descuento ({discountPct}%)</span><span>-{money(discountAmt)}</span></div>}
        <div className="summary-row total"><span>Total</span><span>{money(total)}</span></div>
        <button className="btn-primary full" style={{ marginTop: 10 }} onClick={() => onCheckout({ subtotal, discountAmt, total })}>{ctaLabel || `Cobrar ${money(total)}`}</button>
      </div>

      {allowDiscount && discountOpen && <DiscountSheet current={discount} onClose={() => setDiscountOpen(false)} onApply={onAuthorizeDiscount} />}
    </div>
  );
}

export function CheckoutView({ amounts, onConfirm, onBack }) {
  const { total } = amounts;
  const [method, setMethod] = useState('efectivo');
  const [cash, setCash] = useState('');
  const [mixCash, setMixCash] = useState('');
  const [mixCard, setMixCard] = useState('');

  const cashGiven = parseFloat(cash) || 0;
  const change = cashGiven - total;
  const mixSum = (parseFloat(mixCash) || 0) + (parseFloat(mixCard) || 0);

  const canConfirm =
    method === 'tarjeta' || method === 'transferencia'
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
        <span className="footer-label" style={{ color: '#C9BCA8' }}>Total a cobrar</span>
        <span className="price-total big">{money(total)}</span>
      </div>

      <div className="option-label">Forma de pago</div>
      <div className="pay-methods">
        {methods.map(m => (
          <button key={m.id} className={`pay-method-btn ${method === m.id ? 'selected' : ''}`} onClick={() => setMethod(m.id)}>
            <m.Icon size={20} /><span>{m.label}</span>
          </button>
        ))}
      </div>

      {method === 'efectivo' && (
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

      {method === 'mixto' && (
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

      <div className="sheet-footer" style={{ marginTop: 16 }}>
        <button className="btn-ghost" onClick={onBack}>Volver</button>
        <button
          className="btn-primary"
          disabled={!canConfirm}
          onClick={() => onConfirm({ method, importeEfectivo:method==='mixto'?Number(mixCash):undefined, cashGiven: method === 'efectivo' ? cashGiven : null, change: method === 'efectivo' ? change : null })}
        >
          Confirmar pago
        </button>
      </div>
    </div>
  );
}
