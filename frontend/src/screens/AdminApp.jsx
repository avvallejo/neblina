// PANEL ADMINISTRATIVO. Barra lateral con secciones; el ADMIN GENERAL además
// tiene el switcher de sucursal, la administración de sucursales y el
// comparativo entre sedes.
import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Lock, Droplets, Package, Coffee, ClipboardList, Receipt,
  Settings, Building2, BarChart3, Plus, Pencil, UserPlus, Sparkles, AlertTriangle,
  TrendingDown, Wallet, AlertCircle, MapPin, Monitor, DollarSign, Percent, Scale, SlidersHorizontal,
} from 'lucide-react';
import * as api from '../api/client.js';
import { CATEGORIES, PRODUCTS, ROLE_LABELS, PAY_METHOD_LABELS, MATERIA_CATEGORIAS, getProduct, precioDesde } from '../lib/catalog.js';
import { money, unidadDisplay, stockPct, convertirCantidad } from '../lib/helpers.js';
import { AppShell } from '../components/layout.jsx';
import { ConfirmDialog, EmptyState, FormError } from '../components/ui.jsx';
import { RecipeModal } from '../components/recipe.jsx';
import {
  PromoConfigSheet, UsuarioFormSheet, ProveedorFormSheet, MateriaFormSheet,
  ProductoFormSheet, RecetaFormSheet, BrandingEditor, PrecioCostoSheet, CompraSheet, AjusteStockSheet,
  GastoFijoFormSheet, MargenConfigSheet, GASTO_CATEGORIAS, OpcionFormSheet, PantallaConfigEditor,
} from './adminForms.jsx';
import { Sheet } from '../components/ui.jsx';

/* ---------- Secciones de listado ---------- */

function MateriasSection({ materias, proveedores, onEdit, onAdd, onToggleActivo, onDelete, onCompra, onAjuste }) {
  const [filtro, setFiltro] = useState('Todas');
  const categorias = ['Todas', ...MATERIA_CATEGORIAS];
  const lista = filtro === 'Todas' ? materias : materias.filter(m => m.categoria === filtro);
  return (
    <>
      <div className="cat-tabs">
        {categorias.map(c => (
          <button key={c} className={`cat-tab ${filtro === c ? 'active' : ''}`} onClick={() => setFiltro(c)}>{c}</button>
        ))}
      </div>
      <div className="rows-grid two">
        {lista.map(m => {
          const proveedor = proveedores.find(p => p.id === m.proveedorId);
          const pct = stockPct(m.stockActual, m.stockMinimo);
          const bajo = m.stockActual < m.stockMinimo;
          return (
            <div key={m.id} className="list-row">
              <div className="list-row-main" style={{ display: 'block', flex: 1 }}>
                <div className="list-row-title">{m.nombre}{!m.activo ? ' • Inactivo' : ''}</div>
                <div className="list-row-sub">{m.categoria} • {proveedor ? proveedor.nombre : 'Sin proveedor'} • {money(m.costoUnitario)}/{unidadDisplay(m.unidad)}</div>
                <div className="stock-bar"><div className={`stock-bar-fill ${bajo ? '' : 'ok'}`} style={{ width: `${pct}%` }} /></div>
                <div className="materia-stock-label">
                  {m.stockActual} / {m.stockMinimo} {unidadDisplay(m.unidad)}
                  {bajo && <span className="bajo-tag"><AlertTriangle size={11} /> Bajo</span>}
                </div>
              </div>
              <div className="list-row-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
                <button className="icon-btn small" onClick={() => onEdit(m)} aria-label="Editar"><Pencil size={14} /></button>
                <button className="link-toggle" onClick={() => onCompra(m)}>Registrar compra</button>
                {!m.requiereLote && <button className="link-toggle" onClick={() => onAjuste(m)}>Ajustar stock</button>}
                <button className="link-toggle" onClick={() => onToggleActivo(m.id, m.activo)}>{m.activo ? 'Desactivar' : 'Activar'}</button>
                <button className="link-danger" onClick={() => onDelete(m)}>Eliminar</button>
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn-secondary" style={{ marginTop: 8 }} onClick={onAdd}><Plus size={15} /> Agregar materia prima</button>
    </>
  );
}

function ProveedoresSection({ proveedores, materias, onEdit, onAdd, onToggleActivo, onDelete }) {
  return (
    <>
      <div className="rows-grid two">
        {proveedores.map(p => {
          const nInsumos = materias.filter(m => m.proveedorId === p.id).length;
          return (
            <div key={p.id} className="list-row">
              <div className="list-row-main">
                <span className="usuario-avatar role-admin">{p.nombre.charAt(0).toUpperCase()}</span>
                <div>
                  <div className="list-row-title">{p.nombre}{!p.activo ? ' • Inactivo' : ''}</div>
                  <div className="list-row-sub">{(Array.isArray(p.categorias) && p.categorias.length ? p.categorias : [p.categoria]).filter(Boolean).join(' · ')} • {p.contacto || 'Sin contacto'}{p.telefono ? ` • ${p.telefono}` : ''}</div>
                  <div className="list-row-sub">{nInsumos} insumo(s) registrados</div>
                </div>
              </div>
              <div className="list-row-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
                <button className="icon-btn small" onClick={() => onEdit(p)} aria-label="Editar"><Pencil size={14} /></button>
                <button className="link-toggle" onClick={() => onToggleActivo(p.id, p.activo)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                <button className="link-danger" onClick={() => onDelete(p)}>Eliminar</button>
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn-secondary" style={{ marginTop: 8 }} onClick={onAdd}><Plus size={15} /> Agregar proveedor</button>
    </>
  );
}

function ProductosSection({ productos, onEdit, onAdd, onToggleActivo, onDelete, revisiones, onCosto, onAplicarSugerido }) {
  const [filtro, setFiltro] = useState('Todas');
  const categorias = ['Todas', ...CATEGORIES.map(c => c.id)];
  const lista = filtro === 'Todas' ? productos : productos.filter(p => p.cat === filtro);
  return (
    <>
      {revisiones && revisiones.length > 0 && (
        <div className="reprecio-banner">
          <div className="reprecio-head"><AlertTriangle size={15} /> {revisiones.length} precio(s) por revisar</div>
          <div className="reprecio-sub">El costo de estos productos cambió (insumos, receta o gastos fijos) y su precio de menú ya no corresponde a su margen. El precio no cambia solo: aplícalo con un clic o ajústalo en "Costo y precio".</div>
          {revisiones.map(r => (
            <div key={r.id} className="reprecio-row">
              <span>{r.icono} {r.nombre}</span>
              <span className="reprecio-detalle">costo ${Number(r.costo_total).toFixed(2)} · margen {Number(r.margen_aplicado)}% · ${Number(r.precio_base).toFixed(2)} → ${Number(r.precio_sugerido).toFixed(2)}</span>
              <button className="btn-primary small" onClick={() => onAplicarSugerido(r)}>Aplicar ${Number(r.precio_sugerido).toFixed(2)}</button>
            </div>
          ))}
        </div>
      )}
      <div className="cat-tabs">
        {categorias.map(c => (
          <button key={c} className={`cat-tab ${filtro === c ? 'active' : ''}`} onClick={() => setFiltro(c)}>{c}</button>
        ))}
      </div>
      <div className="rows-grid two">
        {lista.map(p => (
          <div key={p.id} className="list-row">
            <div className="list-row-main" style={{ display: 'block', flex: 1 }}>
              <div className="list-row-title">{p.icon} {p.name}{p.activo === false ? ' • Inactivo' : ''}</div>
              <div className="list-row-sub">{p.cat} • {p.sizes ? `desde ${money(precioDesde(p))}` : money(p.price)}</div>
            </div>
            <div className="list-row-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
              <button className="icon-btn small" onClick={() => onEdit(p)} aria-label="Editar"><Pencil size={14} /></button>
              {p.tipo !== 'snack' && <button className="link-toggle" onClick={() => onCosto(p)}>Costo y precio</button>}
              <button className="link-toggle" onClick={() => onToggleActivo(p.id, p.activo !== false)}>{p.activo === false ? 'Activar' : 'Desactivar'}</button>
              <button className="link-danger" onClick={() => onDelete(p)}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>
      <button className="btn-secondary" style={{ marginTop: 8 }} onClick={onAdd}><Plus size={15} /> Agregar producto</button>
    </>
  );
}

function RecetasSection({ onView, recetaOverrides }) {
  return (
    <>
      <p className="promo-summary-card">Toca una bebida para ver su receta (12 oz, leche entera, café tradicional) y desde ahí editarla: ingredientes base (café por shot y leche por tamaño), ingredientes fijos del inventario, pasos y parámetros de extracción. El vaso/tapa y los extras se resuelven solos según lo que el cliente elija.</p>
      <div className="product-grid">
        {PRODUCTS.filter(p => p.tipo !== 'snack' && p.activo !== false).map(p => (
          <button key={p.id} className="product-card" onClick={() => onView(p)}>
            {recetaOverrides[p.id] && recetaOverrides[p.id].esPersonalizada && <span className="custom-badge"><Pencil size={11} /></span>}
            <span className="product-icon">{p.icon}</span>
            <span className="product-name">{p.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ReportesSection({ data, consolidado }) {
  if (!data) return <EmptyState icon={Receipt} title="Cargando reportes…" />;
  const { ventasPorMetodo = [], masVendidos = [], cancelaciones = {}, mermasPorMotivo = [] } = data;
  const cancelRows = Array.isArray(cancelaciones) ? cancelaciones : [cancelaciones];

  return (
    <div className="admin-columns">
      <div>
        <div className="section-title"><Wallet size={15} /> Ventas por forma de pago</div>
        {ventasPorMetodo.length === 0 ? (
          <EmptyState icon={Wallet} title="Sin ventas cobradas todavía" />
        ) : (
          ventasPorMetodo.map((r, i) => (
            <div key={i} className="reporte-row">
              <span>{consolidado && <span className="sede-name">{r.sucursal} — </span>}{PAY_METHOD_LABELS[r.metodo_pago] || r.metodo_pago}</span>
              <span className="turno-amount">{money(r.total)}</span>
            </div>
          ))
        )}

        <div className="section-title"><Coffee size={15} /> Productos más vendidos</div>
        {masVendidos.length === 0 ? (
          <EmptyState icon={Coffee} title="Aún no hay ventas registradas" />
        ) : (
          masVendidos.map((r, i) => (
            <div key={`${r.producto_id}-${i}`} className="reporte-row">
              <span>{i + 1}. {r.nombre}{consolidado && <span className="sede-name"> · {r.sucursal}</span>}</span>
              <span className="turno-amount">{r.unidades_vendidas} und.</span>
            </div>
          ))
        )}
      </div>
      <div>
        <div className="section-title"><AlertCircle size={15} /> Cancelaciones y no recogidos</div>
        {cancelRows.map((c, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            {consolidado && <div className="list-row-sub" style={{ marginBottom: 6 }}>{c.sucursal}</div>}
            <div className="kpi-grid">
              <div className="kpi-card"><span className="kpi-label">Cancelados</span><span className="kpi-value">{Number(c.cancelados || 0)}</span></div>
              <div className="kpi-card"><span className="kpi-label">No recogidos</span><span className="kpi-value">{Number(c.no_recogidos || 0)}</span></div>
            </div>
          </div>
        ))}

        <div className="section-title"><AlertTriangle size={15} /> Mermas por motivo</div>
        {mermasPorMotivo.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Sin mermas registradas" />
        ) : (
          mermasPorMotivo.map((r, i) => (
            <div key={i} className="reporte-row">
              <span>{r.motivo}{consolidado && <span className="sede-name"> · {r.sucursal}</span>}</span>
              <span className="turno-amount">{r.num_mermas}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ---------- Opciones de personalización: tamaños, cafés, leches, extras ---------- */

// Cada opción tiene un "ajuste de precio" (lo que el cliente ve como +6) que
// el servidor suma al cobrar. La API calcula cuánto CUESTA cada opción según
// el inventario y sugiere el ajuste con el margen de la sede; el admin decide.
function OpcionesSection({ addToast, onOpcionesChanged }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // { tipo, opcion }

  const cargar = React.useCallback(async () => {
    try { setData(await api.getOpcionesAdmin()); } catch (e) { addToast(e.message, 'warn'); }
  }, [addToast]);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (tipo, id, body) => {
    try {
      if (id) await api.actualizarOpcion(tipo, id, body); else await api.crearOpcion(tipo, body);
      await cargar(); if (onOpcionesChanged) await onOpcionesChanged();
      addToast(id ? 'Opción actualizada; ya aplica en app, caja y pantalla' : 'Opción creada', 'success');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const toggle = async (tipo, o) => {
    try {
      await api.actualizarOpcion(tipo, o.id, { activo: !o.activo });
      await cargar(); if (onOpcionesChanged) await onOpcionesChanged();
      addToast(o.activo ? 'Opción desactivada (deja de ofrecerse)' : 'Opción activada', 'success');
    } catch (e) { addToast(e.message, 'warn'); }
  };

  if (!data) return <EmptyState icon={SlidersHorizontal} title="Cargando opciones…" />;

  const materiaDe = id => data.materias.find(m => m.id === id);
  const costoInsumo = (m, cantidad, unidad) => {
    if (!m || !Number.isFinite(cantidad)) return null;
    const conv = convertirCantidad(cantidad, unidad, m.unidad);
    return conv === null ? null : conv * Number(m.costo_unitario || 0);
  };
  const entera = data.leches.find(l => l.codigo === 'entera') || data.leches[0];
  const trad = data.cafes.find(c => c.codigo === 'tradicional') || data.cafes[0];
  const mEntera = entera ? materiaDe(entera.materia_prima_id) : null;
  const mTrad = trad ? materiaDe(trad.materia_prima_id) : null;
  // Mismo criterio que la API, pero en vivo mientras se edita.
  const calcularCosto = (tipo, { materiaPrimaId, cantidad, unidad }) => {
    if (tipo === 'shot') return mTrad ? costoInsumo(mTrad, 18, 'g') : null;
    const m = materiaDe(materiaPrimaId);
    if (!m) return null;
    if (tipo === 'leches') return mEntera ? (costoInsumo(m, data.leche_ml_base, 'ml') ?? 0) - (costoInsumo(mEntera, data.leche_ml_base, 'ml') ?? 0) : null;
    if (tipo === 'cafes') return mTrad ? (costoInsumo(m, 18, 'g') ?? 0) - (costoInsumo(mTrad, 18, 'g') ?? 0) : null;
    if (tipo === 'extras') return cantidad > 0 ? costoInsumo(m, cantidad, unidad) : null;
    return null;
  };

  const fmtDelta = v => { const n = Number(v); return n === 0 ? 'incluido' : `${n > 0 ? '+' : '−'}$${Math.abs(n).toFixed(Number.isInteger(n) ? 0 : 2)}`; };
  const Fila = ({ tipo, o, extraSub }) => {
    const costo = o.costo_extra === null || o.costo_extra === undefined ? null : Number(o.costo_extra);
    const sug = o.precio_sugerido === null || o.precio_sugerido === undefined ? null : Number(o.precio_sugerido);
    const delta = Number(o.delta_precio);
    const bajo = sug !== null && costo !== null && costo > 0 && delta < sug;
    return (
      <div className={`opcion-row${o.activo === false ? ' inactiva' : ''}`}>
        <div className="opcion-main">
          <div className="opcion-nombre">{o.etiqueta}{o.activo === false ? ' • Inactiva' : ''}</div>
          <div className="opcion-sub">
            {extraSub ? `${extraSub} · ` : ''}
            {costo === null ? 'costo no calculable' : `costo ≈ ${costo < 0 ? '−' : ''}${money(Math.abs(costo))}`}
            {sug !== null && <> · sugerido {fmtDelta(sug)}{bajo && <span className="warn"> · por debajo del costo + margen</span>}</>}
          </div>
        </div>
        <span className={`opcion-delta${delta === 0 ? ' neutro' : ''}`}>{fmtDelta(delta)}</span>
        <div className="list-row-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
          <button className="icon-btn small" onClick={() => setEditing({ tipo, opcion: o })} aria-label="Editar"><Pencil size={14} /></button>
          {tipo !== 'tamanos' && !['entera', 'tradicional'].includes(o.codigo) && (
            <button className="link-toggle" onClick={() => toggle(tipo, o)}>{o.activo === false ? 'Activar' : 'Desactivar'}</button>
          )}
        </div>
      </div>
    );
  };
  const porcion = e => (e.es_shot_adicional ? 'un shot más de café' : (e.cantidad ? `${Number(e.cantidad) < 1 && e.unidad === 'l' ? `${Number(e.cantidad) * 1000} ml` : Number(e.cantidad) < 1 && e.unidad === 'kg' ? `${Number(e.cantidad) * 1000} g` : `${Number(e.cantidad)} ${unidadDisplay(e.unidad)}`} de ${(materiaDe(e.materia_prima_id) || {}).nombre || 'insumo'}` : 'sin insumo'));

  return (
    <>
      <div className="promo-summary-card">
        Estos ajustes se suman al precio del producto cuando el cliente personaliza su bebida: aparecen en la app y en caja como "(+6)", y en la pantalla del negocio como referencia. El costo estimado sale de tu inventario (leche entera y café tradicional son la base, por eso van "incluidos"); el sugerido aplica el margen general de la sucursal ({Number(data.margen)}%). Cambia el margen en Costos.
      </div>
      <div className="admin-columns">
        <div>
          <div className="section-title"><SlidersHorizontal size={15} /> Tamaños</div>
          {data.tamanos.map(t => <Fila key={t.id} tipo="tamanos" o={t} extraSub={t.leche_ml !== null && t.leche_ml !== undefined ? `${Number(t.leche_ml)} ml de leche` : null} />)}
          <div className="field-hint">El costo de un tamaño es la diferencia de leche y vaso/tapa frente al de {data.tamano_base} oz.</div>

          <div className="section-title"><Coffee size={15} /> Tipos de café</div>
          {data.cafes.map(c => <Fila key={c.id} tipo="cafes" o={c} extraSub={(materiaDe(c.materia_prima_id) || {}).nombre} />)}
          <button className="btn-secondary" style={{ marginTop: 4 }} onClick={() => setEditing({ tipo: 'cafes', opcion: null })}><Plus size={15} /> Nuevo tipo de café</button>

          <div className="section-title"><Droplets size={15} /> Tipos de leche</div>
          {data.leches.map(l => <Fila key={l.id} tipo="leches" o={l} extraSub={(materiaDe(l.materia_prima_id) || {}).nombre} />)}
          <button className="btn-secondary" style={{ marginTop: 4 }} onClick={() => setEditing({ tipo: 'leches', opcion: null })}><Plus size={15} /> Nuevo tipo de leche</button>
        </div>
        <div>
          <div className="section-title"><Sparkles size={15} /> Extras</div>
          {data.extras.map(e => <Fila key={e.id} tipo="extras" o={e} extraSub={porcion(e)} />)}
          <button className="btn-secondary" style={{ marginTop: 4 }} onClick={() => setEditing({ tipo: 'extras', opcion: null })}><Plus size={15} /> Nuevo extra</button>
        </div>
      </div>

      {editing && (
        <OpcionFormSheet
          tipo={editing.tipo}
          opcion={editing.opcion}
          materias={data.materias}
          margen={data.margen}
          redondeo={data.redondeo}
          calcularCosto={calcularCosto}
          onClose={() => setEditing(null)}
          onSave={guardar}
        />
      )}
    </>
  );
}

/* ---------- Costos indirectos: gastos fijos + margen y volumen ---------- */

// Los gastos fijos de la sede (renta, sueldos, luz…) se reparten entre las
// unidades estimadas al mes: ese cociente es el "costo indirecto" que aparece
// en "Costo y precio" de cada producto. Cualquier cambio aquí mueve el costo
// total de TODO el catálogo, por eso al guardar se recargan los "precios por
// revisar" (onCostosChanged).
function CostosSection({ addToast, onCostosChanged, sedeNombre }) {
  const [gastos, setGastos] = useState(null);
  const [margen, setMargen] = useState(null);
  const [equilibrio, setEquilibrio] = useState(null);
  const [editingGasto, setEditingGasto] = useState(null);
  const [margenOpen, setMargenOpen] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);

  const cargar = React.useCallback(async () => {
    try {
      const [g, m, e] = await Promise.all([api.getGastosFijos(), api.getMargen(), api.getPuntoEquilibrio()]);
      setGastos(g); setMargen(m); setEquilibrio(e);
    } catch (e) { addToast(e.message, 'warn'); }
  }, [addToast]);
  useEffect(() => { cargar(); }, [cargar]);

  const despuesDeCambiar = async msg => {
    await cargar();
    if (onCostosChanged) await onCostosChanged();
    addToast(msg, 'success');
  };

  const guardarGasto = async payload => {
    try {
      if (payload.id) await api.actualizarGastoFijo(payload.id, { concepto: payload.concepto, categoria: payload.categoria, montoMensual: payload.montoMensual });
      else await api.crearGastoFijo(payload);
      await despuesDeCambiar(payload.id ? 'Gasto actualizado; revisa los precios sugeridos' : 'Gasto agregado; revisa los precios sugeridos');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const toggleGasto = async g => {
    try {
      await api.actualizarGastoFijo(g.id, { activo: !g.activo });
      await despuesDeCambiar(g.activo ? 'Gasto en pausa (no se prorratea mientras tanto)' : 'Gasto reactivado');
    } catch (e) { addToast(e.message, 'warn'); }
  };
  const eliminarGasto = async g => {
    if (!window.confirm(`¿Eliminar "${g.concepto}" (${money(g.monto_mensual)} al mes)? Se quita definitivamente del cálculo de costos.`)) return;
    try {
      await api.eliminarGastoFijo(g.id);
      await despuesDeCambiar('Gasto eliminado; revisa los precios sugeridos');
    } catch (e) { addToast(e.message, 'warn'); }
  };
  const guardarMargen = async payload => {
    try {
      await api.guardarMargen(payload);
      await despuesDeCambiar('Margen y volumen guardados');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };

  if (!gastos || !margen) return <EmptyState icon={DollarSign} title="Cargando costos…" />;

  const activos = gastos.filter(g => g.activo);
  const inactivos = gastos.filter(g => !g.activo);
  const totalMes = activos.reduce((acc, g) => acc + Number(g.monto_mensual || 0), 0);
  const unidades = margen.unidades_estimadas_mes ? Number(margen.unidades_estimadas_mes) : null;
  const indirecto = unidades ? totalMes / unidades : null;
  const real = margen.ventas_reales_promedio_mes;
  const porCategoria = GASTO_CATEGORIAS
    .map(c => ({ categoria: c, items: activos.filter(g => g.categoria === c) }))
    .filter(x => x.items.length > 0);

  return (
    <>
      <div className="promo-summary-card">
        <strong>Así se calcula el costo indirecto de cada bebida{sedeNombre ? ` en ${sedeNombre}` : ''}:</strong> gastos fijos del mes ÷ unidades que esperas vender al mes.
        {' '}Hoy: {money(totalMes)} ÷ {unidades ? `${unidades} unidades` : '— (sin definir)'} = <strong>{indirecto === null ? 'sin prorratear' : `${money(indirecto)} por unidad`}</strong>.
        Ese monto se suma al costo de la receta en "Costo y precio" de cada producto.
      </div>

      <div className="kpi-grid">
        <div className="kpi-card"><span className="kpi-label">Gastos fijos al mes</span><span className="kpi-value">{money(totalMes)}</span></div>
        <div className="kpi-card"><span className="kpi-label">Unidades estimadas / mes</span><span className="kpi-value">{unidades ?? '—'}</span></div>
        <div className="kpi-card"><span className="kpi-label">Costo indirecto por unidad</span><span className="kpi-value brand">{indirecto === null ? '—' : money(indirecto)}</span></div>
        <div className="kpi-card">
          <span className="kpi-label">Punto de equilibrio</span>
          <span className="kpi-value">{equilibrio && equilibrio.unidades_punto_equilibrio_dia ? `${Number(equilibrio.unidades_punto_equilibrio_dia)}/día` : '—'}</span>
          {equilibrio && equilibrio.unidades_punto_equilibrio_mes && <span className="kpi-label" style={{ marginTop: 6, marginBottom: 0, textTransform: 'none', letterSpacing: 0 }}>{Number(equilibrio.unidades_punto_equilibrio_mes)} bebidas al mes para cubrir gastos</span>}
        </div>
      </div>

      {!unidades && (
        <div className="reprecio-banner">
          <div className="reprecio-head"><AlertTriangle size={15} /> Falta el volumen estimado</div>
          <div className="reprecio-sub">Sin "unidades estimadas al mes" los gastos fijos no se reparten y el precio sugerido solo cubre los insumos. Defínelo en "Margen y volumen".</div>
        </div>
      )}

      <div className="admin-columns">
        <div>
          <div className="section-title"><Percent size={15} /> Margen y volumen</div>
          <div className="spec-table" style={{ marginBottom: 10 }}>
            <div className="spec-row"><span className="spec-label">Margen general de la sucursal</span><span className="spec-value">{Number(margen.porcentaje_ganancia_normal ?? 60)}%</span></div>
            <div className="spec-row"><span className="spec-label">Redondeo de precios</span><span className="spec-value">${Number(margen.redondeo ?? 1)}</span></div>
            <div className="spec-row"><span className="spec-label">Unidades estimadas al mes</span><span className="spec-value">{unidades ?? '—'}</span></div>
            <div className="spec-row"><span className="spec-label">Venta real promedio al mes</span><span className="spec-value">{real && Number(real.unidades_promedio_mes) > 0 ? `${Number(real.unidades_promedio_mes)} (${real.meses_de_historia} mes(es))` : 'Sin historial aún'}</span></div>
          </div>
          <button className="btn-secondary full" onClick={() => setMargenOpen(true)}><Pencil size={15} /> Editar margen y volumen</button>

          {equilibrio && equilibrio.margen_contribucion_promedio !== null && equilibrio.margen_contribucion_promedio !== undefined && (
            <>
              <div className="section-title"><Scale size={15} /> Punto de equilibrio</div>
              <div className="promo-summary-card">
                Cada bebida deja en promedio <strong>{money(equilibrio.margen_contribucion_promedio)}</strong> después de pagar sus insumos.
                {equilibrio.unidades_punto_equilibrio_mes
                  ? <> Para cubrir {money(equilibrio.gastos_fijos_mes)} de gastos fijos necesitas vender <strong>{Number(equilibrio.unidades_punto_equilibrio_mes)} bebidas al mes</strong> (≈ {Number(equilibrio.unidades_punto_equilibrio_dia)} al día). A partir de ahí, todo es utilidad.</>
                  : <> Con los precios actuales el catálogo no deja margen sobre los insumos: revisa los precios antes de confiar en el punto de equilibrio.</>}
              </div>
            </>
          )}
        </div>

        <div>
          <div className="section-title"><Wallet size={15} /> Gastos fijos mensuales</div>
          {activos.length === 0 && <EmptyState icon={Wallet} title="Sin gastos fijos registrados" subtitle="Agrega renta, sueldos, servicios… para que el precio sugerido los cubra." />}
          {porCategoria.map(grupo => (
            <div key={grupo.categoria} style={{ marginBottom: 6 }}>
              <div className="list-row-sub" style={{ margin: '8px 0 6px', fontWeight: 800 }}>{grupo.categoria} · {money(grupo.items.reduce((a, g) => a + Number(g.monto_mensual || 0), 0))}</div>
              {grupo.items.map(g => (
                <div key={g.id} className="list-row">
                  <div className="list-row-main" style={{ display: 'block', flex: 1 }}>
                    <div className="list-row-title">{g.concepto}</div>
                    <div className="list-row-sub">{money(g.monto_mensual)} al mes{unidades ? ` · ${money(Number(g.monto_mensual) / unidades)} por unidad` : ''}</div>
                  </div>
                  <div className="list-row-actions">
                    <button className="icon-btn small" onClick={() => setEditingGasto(g)} aria-label="Editar gasto"><Pencil size={14} /></button>
                    <button className="link-toggle" onClick={() => toggleGasto(g)}>Pausar</button>
                    <button className="link-danger" onClick={() => eliminarGasto(g)}>Eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setEditingGasto({})}><Plus size={15} /> Agregar gasto fijo</button>

          {inactivos.length > 0 && (
            <>
              <button className="link-toggle" style={{ display: 'block', marginTop: 14 }} onClick={() => setVerInactivos(v => !v)}>
                {verInactivos ? 'Ocultar' : 'Ver'} {inactivos.length} gasto(s) en pausa
              </button>
              {verInactivos && inactivos.map(g => (
                <div key={g.id} className="list-row" style={{ opacity: .7 }}>
                  <div className="list-row-main" style={{ display: 'block', flex: 1 }}>
                    <div className="list-row-title">{g.concepto} • En pausa</div>
                    <div className="list-row-sub">{g.categoria} · {money(g.monto_mensual)} al mes (no se prorratea)</div>
                  </div>
                  <div className="list-row-actions">
                    <button className="icon-btn small" onClick={() => setEditingGasto(g)} aria-label="Editar gasto"><Pencil size={14} /></button>
                    <button className="link-toggle" onClick={() => toggleGasto(g)}>Reactivar</button>
                    <button className="link-danger" onClick={() => eliminarGasto(g)}>Eliminar</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {editingGasto && (
        <GastoFijoFormSheet gasto={editingGasto.id ? editingGasto : null} onClose={() => setEditingGasto(null)} onSave={guardarGasto} />
      )}
      {margenOpen && (
        <MargenConfigSheet config={margen} onClose={() => setMargenOpen(false)} onSave={guardarMargen} />
      )}
    </>
  );
}

/* ---------- Sucursales (solo admin general) ---------- */

function SucursalFormSheet({ sucursal, onClose, onSave }) {
  const isNew = !sucursal || !sucursal.id;
  const [nombre, setNombre] = useState(sucursal ? sucursal.nombre || '' : '');
  const [prefijo, setPrefijo] = useState(sucursal ? sucursal.prefijo_folio || '' : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!nombre.trim()) { setError('Ingresa el nombre de la sucursal.'); return; }
    if (isNew && !/^[A-Za-z0-9]{1,6}$/.test(prefijo.trim())) { setError('El prefijo de folio debe tener 1 a 6 letras o números (ej. S2).'); return; }
    setError('');
    setSaving(true);
    const ok = await onSave(isNew
      ? { nombre: nombre.trim(), prefijoFolio: prefijo.trim().toUpperCase() }
      : { id: sucursal.id, nombre: nombre.trim() });
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Sheet title={isNew ? 'Nueva sucursal' : 'Editar sucursal'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre</div>
        <input className="text-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Centro" />
      </div>
      {isNew ? (
        <div className="option-group">
          <div className="option-label">Prefijo de folios (no se puede cambiar después)</div>
          <input className="text-input" value={prefijo} maxLength={6} onChange={e => setPrefijo(e.target.value.toUpperCase())} placeholder="Ej. S2" />
          <div className="field-hint">Los pedidos de esta sede se foliarán como {prefijo || 'S2'}-P-1, {prefijo || 'S2'}-P-2…</div>
        </div>
      ) : (
        <p className="promo-summary-card">Prefijo de folios: <strong>{sucursal.prefijo_folio}</strong> (fijo, para no romper la numeración ya emitida).</p>
      )}
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : (isNew ? 'Crear sucursal' : 'Guardar cambios')}</button>
      </div>
    </Sheet>
  );
}

function SucursalesSection({ addToast, onSedesChanged }) {
  const [sedes, setSedes] = useState(null);
  const [editing, setEditing] = useState(null);

  const cargar = React.useCallback(async () => {
    try { setSedes(await api.getSucursalesTodas()); } catch (e) { addToast(e.message, 'warn'); }
  }, [addToast]);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async payload => {
    try {
      if (payload.id) await api.actualizarSucursal(payload.id, { nombre: payload.nombre });
      else await api.crearSucursal(payload);
      await cargar();
      onSedesChanged();
      addToast(payload.id ? 'Sucursal actualizada' : 'Sucursal creada con su configuración inicial', 'success');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };

  const toggleActiva = async s => {
    try {
      await api.actualizarSucursal(s.id, { activo: !s.activo });
      await cargar();
      onSedesChanged();
      addToast(s.activo ? 'Sucursal desactivada' : 'Sucursal activada', 'success');
    } catch (e) { addToast(e.message, 'warn'); }
  };

  if (!sedes) return <EmptyState icon={Building2} title="Cargando sucursales…" />;

  return (
    <>
      <p className="promo-summary-card">Cada sucursal tiene su propio catálogo, inventario, clientes, personal y configuración. Crear una sede nueva siembra su configuración inicial (margen, SMS en modo seguro y su identidad).</p>
      <div className="rows-grid two">
        {sedes.map(s => (
          <div key={s.id} className="list-row">
            <div className="list-row-main">
              <span className="sede-icon" style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><MapPin size={18} /></span>
              <div>
                <div className="list-row-title">{s.nombre}{!s.activo ? ' • Inactiva' : ''}</div>
                <div className="list-row-sub">Folios {s.prefijo_folio}-P-… • creada el {new Date(s.creado_en).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
              </div>
            </div>
            <div className="list-row-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
              <button className="icon-btn small" onClick={() => setEditing(s)} aria-label="Editar"><Pencil size={14} /></button>
              <button className="link-toggle" onClick={() => toggleActiva(s)}>{s.activo ? 'Desactivar' : 'Activar'}</button>
            </div>
          </div>
        ))}
      </div>
      <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setEditing({})}><Plus size={15} /> Nueva sucursal</button>

      {editing && (
        <SucursalFormSheet
          sucursal={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSave={guardar}
        />
      )}
    </>
  );
}

function ComparativoSection({ addToast }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.getReportesConsolidados().then(setData).catch(e => addToast(e.message, 'warn'));
  }, [addToast]);
  return (
    <>
      <p className="promo-summary-card">Vista consolidada de TODAS las sucursales — cada fila indica su sede. Solo el administrador general puede verla.</p>
      <ReportesSection data={data} consolidado />
    </>
  );
}

/* ---------- Panel principal ---------- */

export default function AdminApp(props) {
  const {
    brand, sedeNombre, esGeneral, sedes, sedeActivaId, onChangeSede,
    kpis, fechaVentas, setFechaVentas, ventasError, reportes, addToast, smsActivo, onToggleSms,
    nombreNegocio, logo, pantallaCfg, onSaveBranding, onLogout, turnoAbierto,
    promoConfig, setPromoConfig, usuarios, addUsuario, updateUsuario, currentUser,
    materias, addMateria, updateMateria, deleteMateria,
    proveedores, addProveedor, updateProveedor, deleteProveedor,
    productosAdmin, recetaOverrides, setRecetaOverride,
    recargarCatalogo, recargarAdmin, onSedesChanged, preciosPorRevisar,
  } = props;

  const [screen, setScreen] = useState('dashboard');
  const [promoOpen, setPromoOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editingMateria, setEditingMateria] = useState(null);
  const [editingProveedor, setEditingProveedor] = useState(null);
  const [editingProducto, setEditingProducto] = useState(null);
  const [recipeProduct, setRecipeProduct] = useState(null);
  const [editingRecetaProduct, setEditingRecetaProduct] = useState(null);
  const [precioProducto, setPrecioProducto] = useState(null);
  const [compraMateria, setCompraMateria] = useState(null);
  const [ajusteMateria, setAjusteMateria] = useState(null);
  const [, bump] = useState(0);

  const addProducto = async p => {
    try {
      const creado = await api.crearProducto(p);
      await recargarCatalogo(); await recargarAdmin(); bump(v => v + 1);
      if (p.tipo !== 'snack') {
        // El flujo continúa solo: producto nuevo → definir su receta (de ahí
        // sale el costo) → panel de costo y margen → precio al menú.
        addToast('Producto agregado — define su receta para calcular el costo', 'success');
        setEditingRecetaProduct({ id: creado.id, name: p.name, tipo: p.tipo, frio: p.frio, leche: p.leche });
      } else {
        addToast('Producto agregado', 'success');
      }
      return true;
    }
    catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const updateProducto = async (id, patch) => {
    try { await api.actualizarProducto(id, patch); await recargarCatalogo(); await recargarAdmin(); bump(v => v + 1); addToast('Producto actualizado', 'success'); return true; }
    catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const deleteProducto = async producto => {
    if (!window.confirm(`¿Eliminar "${producto.name}" del catálogo? Si ya tiene ventas, se desactivará para conservar el historial.`)) return;
    try {
      const r = await api.eliminarProducto(producto.id);
      await recargarCatalogo(); await recargarAdmin(); bump(v => v + 1);
      addToast(r.modo_eliminacion === 'definitivo' ? 'Producto eliminado' : 'Producto desactivado por historial', 'success');
    } catch (e) { addToast(e.message, 'warn'); }
  };

  const registrarCompra = async (materia, compra) => {
    try {
      await api.registrarCompra(materia.id, compra);
      await recargarAdmin(); await recargarCatalogo();
      addToast(`Compra registrada: +${compra.cantidadComprada} ${compra.unidad} de ${materia.nombre}`, 'success');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const ajustarStock = async (materia, ajuste) => {
    try {
      await api.ajustarStock(materia.id, ajuste);
      await recargarAdmin();
      addToast(`Stock de ${materia.nombre} ajustado a ${ajuste.nuevaCantidad}`, 'success');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };

  const aplicarPrecio = async (productoId, { price, margenPorcentaje }) => {
    try {
      await api.actualizarProducto(productoId, { price, margenPorcentaje });
      await recargarCatalogo(); await recargarAdmin(); bump(v => v + 1);
      addToast(`Precio aplicado al menú: $${Number(price).toFixed(2)}`, 'success');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };

  const pedidosHoy = kpis ? Number(kpis.pedidos || 0) : 0;
  const ventasHoy = kpis ? Number(kpis.ventas || 0) : 0;
  const ticketProm = kpis ? Number(kpis.ticket_promedio || 0) : 0;
  const premioActual = getProduct(promoConfig.premioId);
  const materiasBajas = materias.filter(m => m.stockActual < m.stockMinimo);

  const navItems = [
    { id: 'dashboard', label: 'Resumen', Icon: LayoutDashboard },
    { id: 'productos', label: 'Productos', Icon: Coffee, badge: (preciosPorRevisar || []).length },
    { id: 'opciones', label: 'Opciones', Icon: SlidersHorizontal },
    { id: 'materias', label: 'Inventario', Icon: Droplets, badge: materiasBajas.length },
    { id: 'recetas', label: 'Recetas', Icon: ClipboardList },
    { id: 'costos', label: 'Costos', Icon: DollarSign },
    { id: 'proveedores', label: 'Proveedores', Icon: Package },
    { id: 'usuarios', label: 'Personal', Icon: Lock },
    { id: 'reportes', label: 'Reportes', Icon: Receipt },
    ...(esGeneral ? [
      { id: 'comparativo', label: 'Comparativo', Icon: BarChart3 },
      { id: 'sucursales', label: 'Sucursales', Icon: Building2 },
    ] : []),
    { id: 'config', label: 'Configuración', Icon: Settings },
  ];

  const TITLES = {
    dashboard: ['Panel administrativo', sedeNombre ? `Resumen de ${sedeNombre}` : 'Resumen del día'],
    usuarios: ['Personal y accesos', `${usuarios.length} cuenta(s)`],
    materias: ['Inventario', `${materias.length} insumo(s)`],
    proveedores: ['Proveedores', `${proveedores.length} proveedor(es)`],
    productos: ['Catálogo de productos', `${productosAdmin.length} producto(s)`],
    recetas: ['Recetas', 'Vista estándar por producto'],
    costos: ['Costos indirectos', 'Gastos fijos, margen y punto de equilibrio'],
    opciones: ['Opciones y extras', 'Tamaños, tipos de café, leches y extras con su precio'],
    reportes: ['Reportes', sedeNombre ? `Histórico acumulado de ${sedeNombre}` : 'Histórico acumulado'],
    comparativo: ['Comparativo de sucursales', 'Todas las sedes'],
    sucursales: ['Sucursales', 'Administración del negocio completo'],
    config: ['Configuración', sedeNombre ? `De ${sedeNombre}` : 'De la sucursal'],
  };
  const [title, subtitle] = TITLES[screen] || TITLES.dashboard;

  return (
    <AppShell
      brand={brand}
      items={navItems}
      active={screen}
      onSelect={setScreen}
      user={{ ...currentUser, rol: 'admin' }}
      roleLabel={esGeneral ? 'Administrador general' : 'Administración'}
      sedeNombre={esGeneral ? 'Todas las sedes' : sedeNombre}
      sedes={esGeneral ? sedes : null}
      sedeActiva={sedeActivaId}
      onChangeSede={onChangeSede}
      onLogout={onLogout}
      title={title}
      subtitle={subtitle}
      wide={['reportes', 'comparativo', 'materias', 'productos', 'proveedores', 'costos', 'opciones'].includes(screen)}
      topRight={esGeneral ? <span className="sede-pill"><Building2 size={13} /> {sedeNombre || 'Elige sucursal'}</span> : null}
    >
      {screen === 'dashboard' && (
        <div className="admin-columns">
          <div>
            <div className="turno-status-card">
              <span>Estado del turno{sedeNombre ? ` — ${sedeNombre}` : ''}</span>
              <span className={turnoAbierto ? 'status-open-text' : 'status-closed-text'}>{turnoAbierto ? 'Abierto' : 'Cerrado'}</span>
            </div>
            <label>Fecha de ventas (hora de Ciudad de México)
              <input type="date" value={fechaVentas} onChange={e => setFechaVentas(e.target.value)} />
            </label>
            <button className="link-toggle" onClick={() => setFechaVentas('')}>Hoy</button>
            <p>Pedidos registrados el {kpis?.fecha || fechaVentas || 'día de hoy'}. Solo las ventas cobradas se suman; no hace falta cerrar turno.</p>
            {ventasError && <p role="alert">{ventasError}</p>}
            {!kpis && !ventasError && <p role="status">Cargando ventas…</p>}
            <div className="kpi-grid">
              <div className="kpi-card"><span className="kpi-label">Ventas del día</span><span className="kpi-value brand">{kpis ? money(ventasHoy) : '—'}</span></div>
              <div className="kpi-card"><span className="kpi-label">Pedidos del día</span><span className="kpi-value">{kpis ? pedidosHoy : '—'}</span></div>
              <div className="kpi-card"><span className="kpi-label">Ticket promedio</span><span className="kpi-value">{kpis ? money(ticketProm) : '—'}</span></div>
              <div className="kpi-card"><span className="kpi-label">Mermas del día</span><span className="kpi-value">{kpis ? Number(kpis.mermas || 0) : '—'}</span></div>
            </div>

            {materiasBajas.length > 0 && (
              <>
                <div className="section-title"><TrendingDown size={15} /> Stock bajo</div>
                {materiasBajas.map(m => {
                  const proveedor = proveedores.find(p => p.id === m.proveedorId);
                  const pct = stockPct(m.stockActual, m.stockMinimo);
                  return (
                    <div key={m.id} className="stock-alert-card">
                      <div className="stock-row"><strong>{m.nombre}</strong><span>{m.stockActual} / {m.stockMinimo} {unidadDisplay(m.unidad)}</span></div>
                      <div className="stock-bar"><div className="stock-bar-fill" style={{ width: `${pct}%` }} /></div>
                      <div className="stock-meta">
                        <span>{m.categoria}</span>
                        <span>{proveedor ? proveedor.nombre : 'Sin proveedor'}</span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <div>
            <div className="section-title"><Sparkles size={15} /> Fidelidad de clientes</div>
            <div className="promo-summary-card">
              {promoConfig.activo && premioActual
                ? `Activa: cada ${promoConfig.cada} pedidos por la app, el cliente recibe ${premioActual.name} gratis.`
                : 'La promoción de fidelidad está inactiva o sin premio configurado.'}
            </div>
            <button className="btn-secondary full" onClick={() => setPromoOpen(true)}><Sparkles size={15} /> Configurar promoción</button>

            <div className="section-title"><Lock size={15} /> Acceso de clientes</div>
            <div className="turno-status-card">
              <span>Verificación por SMS</span>
              <button className={`turno-pill ${smsActivo ? 'open' : 'closed'}`} onClick={() => onToggleSms(!smsActivo)}>
                {smsActivo ? '● Activada' : 'Desactivada'}
              </button>
            </div>
            <div className="promo-summary-card">
              {smsActivo
                ? 'Los clientes verifican su teléfono con un código por SMS antes de pedir.'
                : 'Los clientes se registran solo con nombre y teléfono (sin código).'}
            </div>
          </div>
        </div>
      )}

      {screen === 'usuarios' && (
        <>
          <div className="rows-grid two">
            {usuarios.map(u => (
              <div key={u.id} className="list-row">
                <div className="list-row-main">
                  <span className={`usuario-avatar role-${u.rol}`}>{u.nombre.charAt(0).toUpperCase()}</span>
                  <div>
                    <div className="list-row-title">
                      {u.nombre}{currentUser && currentUser.id === u.id ? ' (tú)' : ''}{' '}
                      {u.rol === 'admin' && u.sucursal_id === null && <span className="general-tag">General</span>}
                    </div>
                    <div className="list-row-sub">
                      {ROLE_LABELS[u.rol]}
                      {u.sucursal_id && sedes ? ` • ${(sedes.find(s => s.id === u.sucursal_id) || {}).nombre || 'Sucursal'}` : ''}
                      {!u.activo && ' • Inactivo'}
                    </div>
                  </div>
                </div>
                <div className="list-row-actions">
                  <button className="icon-btn small" onClick={() => setEditingUser(u)} aria-label="Editar usuario"><Pencil size={14} /></button>
                  {!(currentUser && currentUser.id === u.id) && (
                    <button className="link-toggle" onClick={() => updateUsuario(u.id, { activo: !u.activo })}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setEditingUser({})}><UserPlus size={15} /> Agregar usuario</button>
        </>
      )}

      {screen === 'materias' && (
        <MateriasSection
          materias={materias} proveedores={proveedores} onEdit={setEditingMateria} onAdd={() => setEditingMateria({})}
          onToggleActivo={(id, activo) => updateMateria(id, { activo: !activo })}
          onDelete={deleteMateria}
          onCompra={setCompraMateria}
          onAjuste={setAjusteMateria}
        />
      )}

      {screen === 'proveedores' && (
        <ProveedoresSection
          proveedores={proveedores} materias={materias} onEdit={setEditingProveedor} onAdd={() => setEditingProveedor({})}
          onToggleActivo={(id, activo) => updateProveedor(id, { activo: !activo })}
          onDelete={deleteProveedor}
        />
      )}

      {screen === 'productos' && (
        <ProductosSection
          productos={productosAdmin} onEdit={setEditingProducto} onAdd={() => setEditingProducto({})}
          onToggleActivo={(id, activo) => updateProducto(id, { activo: !activo })}
          onDelete={deleteProducto}
          revisiones={preciosPorRevisar || []}
          onCosto={p => setPrecioProducto(p)}
          onAplicarSugerido={r => aplicarPrecio(r.id, { price: Number(r.precio_sugerido), margenPorcentaje: r.margen_propio ? Number(r.margen_aplicado) : null })}
        />
      )}

      {screen === 'recetas' && <RecetasSection onView={setRecipeProduct} recetaOverrides={recetaOverrides} />}
      {screen === 'opciones' && <OpcionesSection addToast={addToast} onOpcionesChanged={recargarCatalogo} />}
      {screen === 'costos' && <CostosSection addToast={addToast} sedeNombre={sedeNombre} onCostosChanged={recargarAdmin} />}
      {screen === 'reportes' && <ReportesSection data={reportes} />}
      {screen === 'comparativo' && esGeneral && <ComparativoSection addToast={addToast} />}
      {screen === 'sucursales' && esGeneral && <SucursalesSection addToast={addToast} onSedesChanged={onSedesChanged} />}

      {screen === 'config' && (
        <div className="admin-columns">
          <div>
            <div className="section-title">Identidad del negocio (por sucursal)</div>
            <BrandingEditor nombreNegocio={nombreNegocio} logo={logo} lema={pantallaCfg ? pantallaCfg.lema : ''} onSave={onSaveBranding} />
          </div>
          <div>
            <div className="section-title"><Monitor size={15} /> Pantalla del negocio (menú para TV)</div>
            <div className="promo-summary-card">
              Deja esta dirección abierta en la TV del local: muestra el menú de esta sucursal con precios y se actualiza sola cada minuto.
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-deep)', padding: '6px 10px', borderRadius: 8, wordBreak: 'break-all' }}>
                  {`${window.location.origin}/?pantalla=menu&sucursal=${sedeActivaId || ''}`}
                </code>
                <button className="btn-secondary" onClick={() => {
                  navigator.clipboard?.writeText(`${window.location.origin}/?pantalla=menu&sucursal=${sedeActivaId || ''}`)
                    .then(() => addToast('Dirección copiada', 'success'))
                    .catch(() => addToast('No se pudo copiar; selecciónala manualmente', 'warn'));
                }}>Copiar</button>
                <a className="btn-secondary" style={{ textDecoration: 'none' }} href={`/?pantalla=menu&sucursal=${sedeActivaId || ''}`} target="_blank" rel="noreferrer">Abrir</a>
              </div>
            </div>
            <PantallaConfigEditor cfg={pantallaCfg} onSave={onSaveBranding} />

            <div className="section-title">Acceso de clientes</div>
            <div className="turno-status-card">
              <span>Verificación por SMS</span>
              <button className={`turno-pill ${smsActivo ? 'open' : 'closed'}`} onClick={() => onToggleSms(!smsActivo)}>
                {smsActivo ? '● Activada' : 'Desactivada'}
              </button>
            </div>
            <div className="section-title">Fidelidad</div>
            <div className="promo-summary-card">
              {promoConfig.activo && premioActual
                ? `Cada ${promoConfig.cada} pedidos: ${premioActual.name} gratis.`
                : 'Promoción inactiva.'}
            </div>
            <button className="btn-secondary full" onClick={() => setPromoOpen(true)}><Sparkles size={15} /> Configurar promoción</button>
          </div>
        </div>
      )}

      {promoOpen && <PromoConfigSheet config={promoConfig} onClose={() => setPromoOpen(false)} onSave={setPromoConfig} />}

      {editingUser && (
        <UsuarioFormSheet
          user={editingUser.id ? editingUser : null}
          esGeneral={esGeneral}
          sedes={sedes}
          sedeActivaId={sedeActivaId}
          onClose={() => setEditingUser(null)}
          onSave={u => (u.id ? updateUsuario(u.id, u) : addUsuario(u))}
        />
      )}

      {editingMateria && (
        <MateriaFormSheet
          item={editingMateria.id ? editingMateria : null}
          proveedores={proveedores}
          onClose={() => setEditingMateria(null)}
          onSave={m => (m.id ? updateMateria(m.id, m) : addMateria(m))}
        />
      )}

      {editingProveedor && (
        <ProveedorFormSheet
          proveedor={editingProveedor.id ? editingProveedor : null}
          onClose={() => setEditingProveedor(null)}
          onSave={p => (p.id ? updateProveedor(p.id, p) : addProveedor(p))}
        />
      )}

      {editingProducto && (
        <ProductoFormSheet
          producto={editingProducto.id ? editingProducto : null}
          onClose={() => setEditingProducto(null)}
          onSave={p => (p.id ? updateProducto(p.id, p) : addProducto(p))}
        />
      )}

      {recipeProduct && (
        <RecipeModal
          ticket={{ productId: recipeProduct.id, size: '12', milk: 'entera', coffeeType: 'tradicional', extras: [] }}
          override={recetaOverrides[recipeProduct.id]}
          readOnly
          onClose={() => setRecipeProduct(null)}
          onEdit={() => { setEditingRecetaProduct(recipeProduct); setRecipeProduct(null); }}
        />
      )}

      {compraMateria && (
        <CompraSheet
          materia={compraMateria}
          proveedores={proveedores.filter(p => p.activo !== false)}
          onClose={() => setCompraMateria(null)}
          onSave={registrarCompra}
        />
      )}

      {ajusteMateria && (
        <AjusteStockSheet
          materia={ajusteMateria}
          onClose={() => setAjusteMateria(null)}
          onSave={ajustarStock}
        />
      )}

      {precioProducto && (
        <PrecioCostoSheet
          producto={precioProducto}
          onClose={() => setPrecioProducto(null)}
          onAplicar={aplicarPrecio}
        />
      )}

      {editingRecetaProduct && (
        <RecetaFormSheet
          product={editingRecetaProduct}
          receta={recetaOverrides[editingRecetaProduct.id]}
          onClose={() => setEditingRecetaProduct(null)}
          onSave={(productId, override) => setRecetaOverride(productId, override)}
        />
      )}
    </AppShell>
  );
}
