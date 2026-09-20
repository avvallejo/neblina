import CajaComandas from './CajaComandas.jsx';
import ProductImage from '../components/ProductImage.jsx';
// PANEL ADMINISTRATIVO. Barra lateral con secciones; el ADMIN GENERAL además
// tiene el switcher de sucursal, la administración de sucursales y el
// comparativo entre sedes.
import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Lock, Droplets, Package, Coffee, ClipboardList, Receipt,
  Settings, Building2, BarChart3, Plus, Pencil, UserPlus, Sparkles, AlertTriangle,
  TrendingDown, Wallet, AlertCircle, MapPin, Monitor, DollarSign, Percent, Scale, SlidersHorizontal,
  Gift, BadgeCheck, BookOpen, Ban, Search, X,
} from 'lucide-react';
import ContabilidadSection from './ContabilidadSection.jsx';
import * as api from '../api/client.js';
import { CATEGORIES, PRODUCTS, ROLE_LABELS, PAY_METHOD_LABELS, CORTESIA_ESTADO_LABELS, CANCELACION_ESTADO_LABELS, ESTACION_LABELS, TIPO_PRODUCTO_LABELS, rolEtiqueta, MATERIA_CATEGORIAS, getProduct, precioDesde } from '../lib/catalog.js';
import { money, unidadDisplay, stockPct, convertirCantidad, formatNumeroInput as formatNumero } from '../lib/helpers.js';
import { AppShell } from '../components/layout.jsx';
import { ConfirmDialog, EmptyState, FormError } from '../components/ui.jsx';
import { RecipeModal } from '../components/recipe.jsx';
import {
  PromoConfigSheet, UsuarioFormSheet, ProveedorFormSheet, MateriaFormSheet,
  ProductoFormSheet, RecetaFormSheet, BrandingEditor, PrecioCostoSheet, CompraSheet, AjusteStockSheet,
  GastoFijoFormSheet, MargenConfigSheet, GASTO_CATEGORIAS, OpcionFormSheet, PantallaConfigEditor, CortesiasConfigEditor, MesasConfigEditor, CategoriasEditor,
} from './adminForms.jsx';
import { Sheet } from '../components/ui.jsx';

/* ---------- Secciones de listado ---------- */

// INVENTARIO EN LISTA. Antes era una retícula de tarjetas a dos columnas y el
// botón de agregar quedaba hasta abajo, después de recorrer todo el catálogo.
// Ahora: una fila por insumo (se escanea de un vistazo), el botón arriba —que
// es donde se busca cuando llega mercancía nueva— y un buscador al lado de las
// categorías, porque con decenas de insumos el filtro por categoría no basta.

// Para buscar "cafe" y que encuentre "Café": sin acentos y sin mayúsculas.
const sinAcentos = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function MateriasSection({ materias, proveedores, onEdit, onAdd, onToggleActivo, onDelete, onCompra, onAjuste }) {
  const [filtro, setFiltro] = useState('Todas');
  const [busqueda, setBusqueda] = useState('');
  const [sinUso, setSinUso] = useState(false);
  const categorias = ['Todas', ...new Set([...MATERIA_CATEGORIAS, ...materias.map(m => m.categoria).filter(Boolean)])];

  // Se busca por nombre, categoría y proveedor: así "Leo" trae todo lo de ese
  // proveedor y "vaso" todos los vasos, sin importar en qué categoría estén.
  const q = sinAcentos(busqueda.trim());
  const coincide = m => {
    if (!q) return true;
    const prov = proveedores.find(p => p.id === m.proveedorId);
    return sinAcentos(`${m.nombre} ${m.categoria} ${prov ? prov.nombre : ''}`).includes(q);
  };
  const enCategoria = m => filtro === 'Todas' || m.categoria === filtro;
  const lista = materias.filter(m => enCategoria(m) && coincide(m) && (!sinUso || (m.activo && !m.categoriasUso?.length)));
  // Si no hay nada aquí pero sí en otras categorías, se ofrece ampliar la búsqueda.
  const enOtras = q && lista.length === 0 ? materias.filter(coincide).length : 0;
  const bajos = lista.filter(m => m.activo && m.stockActual < m.stockMinimo).length;
  const filtrando = q || filtro !== 'Todas' || sinUso;

  return (
    <>
      <div className="inv-toolbar">
        <button className="btn-primary" onClick={onAdd}><Plus size={15} /> Agregar insumo</button>
        <span className="inv-conteo">
          {filtrando ? `${lista.length} de ${materias.length} insumo(s)` : `${materias.length} insumo(s)`}
          {bajos > 0 && <span className="bajo-tag" style={{ marginLeft: 8 }}><AlertTriangle size={11} /> {bajos} bajo(s)</span>}
        </span>
      </div>

      <label className="field-hint" style={{display:'block',marginBottom:12}}><input type="checkbox" checked={sinUso} onChange={e=>setSinUso(e.target.checked)}/> Solo activos sin “Se utiliza en” ({materias.filter(m=>m.activo && !m.categoriasUso?.length).length})</label>
      {sinUso && <p className="field-hint">Edita cada insumo para asignarle sus usos. Los ingredientes base y empaques tienen su configuración propia; no los agregues de nuevo como ingredientes fijos.</p>}
      <div className="inv-filtros">
        <div className="cat-tabs">
          {categorias.map(c => (
            <button key={c} className={`cat-tab ${filtro === c ? 'active' : ''}`} onClick={() => setFiltro(c)}>{c}</button>
          ))}
        </div>
        <div className="inv-buscador">
          <Search size={15} className="inv-lupa" aria-hidden="true" />
          <input
            className="text-input" type="search" placeholder="Buscar insumo, proveedor…"
            aria-label="Buscar en el inventario" value={busqueda} onChange={e => setBusqueda(e.target.value)}
          />
          {busqueda && (
            <button className="inv-limpiar" onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda"><X size={14} /></button>
          )}
        </div>
      </div>

      {lista.length === 0
        ? (
          <EmptyState
            icon={Droplets}
            title={q ? `Sin resultados para "${busqueda.trim()}"` : 'Sin insumos en esta categoría'}
            subtitle={enOtras > 0
              ? `Hay ${enOtras} coincidencia(s) en otras categorías`
              : 'Agrega uno con el botón de arriba'}
          />
        )
        : (
          <div className="inv-list">
            {lista.map(m => {
              const proveedor = proveedores.find(p => p.id === m.proveedorId);
              const pct = stockPct(m.stockActual, m.stockMinimo);
              const bajo = m.stockActual < m.stockMinimo;
              return (
                <div key={m.id} className={`inv-row ${m.activo ? '' : 'inactivo'}`}>
                  <div className="inv-datos">
                    <div className="inv-nombre">{m.nombre}{!m.activo ? ' • Inactivo' : ''}</div>
                    <div className="inv-sub">
                      {m.categoria} • {proveedor ? proveedor.nombre : 'Sin proveedor'} • {money(m.costoUnitario)}/{unidadDisplay(m.unidad)}
                      {m.presentacion ? ` • ${m.presentacion.nombre} de ${formatNumero(m.presentacion.cantidad)} ${unidadDisplay(m.presentacion.unidad)}` : ''}
                    </div>
                  </div>
                  <div className="inv-stock">
                    <div className="inv-stock-cifra">
                      {m.stockActual} / {m.stockMinimo} {unidadDisplay(m.unidad)}
                      {bajo && <span className="bajo-tag"><AlertTriangle size={11} /> Bajo</span>}
                    </div>
                    <div className="stock-bar"><div className={`stock-bar-fill ${bajo ? '' : 'ok'}`} style={{ width: `${pct}%` }} /></div>
                  </div>
                  <div className="inv-acciones">
                    <button className="icon-btn small" onClick={() => onEdit(m)} aria-label={`Editar ${m.nombre}`}><Pencil size={14} /></button>
                    <button className="link-toggle" onClick={() => onCompra(m)}>Compra</button>
                    <button className="link-toggle" onClick={() => onAjuste(m)}>Ajustar</button>
                    <button className="link-toggle" onClick={() => onToggleActivo(m.id, m.activo)}>{m.activo ? 'Desactivar' : 'Activar'}</button>
                    <button className="link-danger" onClick={() => onDelete(m)}>Eliminar</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      {enOtras > 0 && (
        <button className="btn-secondary full" style={{ marginTop: 10 }} onClick={() => setFiltro('Todas')}>
          Buscar "{busqueda.trim()}" en todas las categorías ({enOtras})
        </button>
      )}
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

function ProductosSection({ productos, onEdit, onAdd, onToggleActivo, onDelete, revisiones, onCosto, onAplicarSugerido, onMantenerPrecio }) {
  const [filtro, setFiltro] = useState('Todas');
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);
  const decidirPrecio = async (r, action) => {
    if (guardandoPrecio) return;
    setGuardandoPrecio(true);
    try { await action(r); } finally { setGuardandoPrecio(false); }
  };
  const categorias = ['Todas', ...CATEGORIES.map(c => c.id)];
  const lista = filtro === 'Todas' ? productos : productos.filter(p => p.cat === filtro);
  return (
    <>
      {revisiones && revisiones.length > 0 && (
        <div className="reprecio-banner">
          <div className="reprecio-head"><AlertTriangle size={15} /> {revisiones.length} precio(s) por revisar</div>
          <div className="reprecio-sub">El sugerido sale del margen de contribución que aplica a cada producto (propio, de su categoría o el general). Revísalo o conserva el actual con "Mantener precio": el aviso se oculta hasta que cambie la receta, el costo de sus insumos o ese margen.</div>
          {revisiones.map(r => (
            <div key={r.id} className="reprecio-row">
              <span>{r.icono} {r.nombre}</span>
              <span className="reprecio-detalle">
                insumo ${Number(r.costo_directo).toFixed(2)} · margen {Number(r.margen_aplicado)}%
                {r.margen_origen === 'producto' ? ' (propio)' : r.margen_origen === 'categoria' ? ` (${r.categoria_nombre})` : ' (sede)'}
                {r.piso_manda ? ' · manda el piso' : ''} · ${Number(r.precio_base).toFixed(2)} → ${Number(r.precio_sugerido).toFixed(2)}
              </span>
              <div className="reprecio-actions">
                <button className="btn-secondary small" disabled={guardandoPrecio} onClick={() => decidirPrecio(r, onMantenerPrecio)}>Mantener precio</button>
                <button className="btn-primary small" disabled={guardandoPrecio} onClick={() => decidirPrecio(r, onAplicarSugerido)}>Aplicar ${Number(r.precio_sugerido).toFixed(2)}</button>
              </div>
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
              <div className="list-row-title"><ProductImage product={p} size={32}/> {p.name}{p.activo === false ? ' • Inactivo' : ''}</div>
              <div className="list-row-sub">{p.cat} • {p.sizes ? `desde ${money(precioDesde(p))}` : money(p.price)} <span className={`estacion-tag ${p.estacion || 'barra'}`}>{ESTACION_LABELS[p.estacion || 'barra']}</span>{(p.tipo === 'alimento' || p.tipo === 'snack') && <span className="tipo-tag">{TIPO_PRODUCTO_LABELS[p.tipo]}</span>}
                {p.reventa && (
                  <span className={`existencias-tag ${p.agotado ? 'agotado' : p.reventa.stock < p.reventa.stockMinimo ? 'bajo' : ''}`}>
                    {p.agotado ? 'Agotado' : `Quedan ${formatNumero(p.reventa.stock)} pzas`}{p.reventa.aPedir > 0 ? ` · pedir ${formatNumero(p.reventa.aPedir)}` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="list-row-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
              <button className="icon-btn small" onClick={() => onEdit(p)} aria-label="Editar"><Pencil size={14} /></button>
              {(p.tipo !== 'snack' || p.reventa) && <button className="link-toggle" onClick={() => onCosto(p)}>Costo y precio</button>}
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

function RecetasSection({ productos, onView, recetaOverrides }) {
  return (
    <>
      <p className="promo-summary-card">Toca un producto para ver su receta y desde ahí editarla. Bebidas: ingredientes base (café por shot y leche por tamaño), ingredientes fijos del inventario, pasos y parámetros de extracción; el vaso/tapa y los extras se resuelven solos según lo que el cliente elija. Alimentos de parrilla/cocina: sus ingredientes del inventario, pasos, tiempo y término.</p>
      <p className="field-hint">También puedes editar las recetas de bebidas inactivas. Para ponerlas a la venta, revisa sus insumos y empaques y actívalas en Catálogo de productos.</p>
      <div className="product-grid">
        {productos.filter(p => p.tipo !== 'snack').map(p => (
          <button key={p.id} className="product-card" onClick={() => onView(p)}>
            {recetaOverrides[p.id] && recetaOverrides[p.id].esPersonalizada && <span className="custom-badge"><Pencil size={11} /></span>}
            <span className="product-icon"><ProductImage product={p}/></span>
            <span className="product-name">{p.name}</span>
            {p.activo === false && <span className="field-hint">Inactivo</span>}
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
            r.metodo_pago === 'cortesia' ? (
              // Cortesías: no entró dinero (total $0); se muestra lo regalado a precio de menú.
              <div key={i} className="reporte-row">
                <span>{consolidado && <span className="sede-name">{r.sucursal} — </span>}<Gift size={13} style={{ verticalAlign: -2 }} /> Cortesías <span className="sede-name">· {Number(r.unidades_cortesia || 0)} producto(s) en {Number(r.num_pedidos || 0)} ticket(s), valor regalado</span></span>
                <span className="turno-amount">{money(r.valor_cortesias || 0)}</span>
              </div>
            ) : (
              <div key={i} className="reporte-row">
                <span>{consolidado && <span className="sede-name">{r.sucursal} — </span>}{PAY_METHOD_LABELS[r.metodo_pago] || r.metodo_pago}</span>
                <span className="turno-amount">{money(r.total)}</span>
              </div>
            )
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

/* ---------- Autorizaciones: cortesías fuera de cupo y cancelaciones de tickets ---------- */

// Las pendientes llegan desde App (se refrescan cada 5 s con el resto de
// admin); el historial se consulta aquí al entrar y tras cada decisión.
function CortesiasPanel({ pendientes, addToast, onResolved }) {
  const [historial, setHistorial] = useState(null);
  const [notas, setNotas] = useState({});
  const [busyId, setBusyId] = useState(null);
  const cargarHistorial = React.useCallback(() => {
    api.getCortesias().then(rows => setHistorial(rows.filter(r => r.cortesia_estado !== 'pendiente'))).catch(e => addToast(e.message, 'warn'));
  }, [addToast]);
  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);

  const resolver = async (row, decision) => {
    setBusyId(row.id);
    try {
      const nota = (notas[row.id] || '').trim();
      if (decision === 'autorizada') await api.autorizarCortesia(row.id, nota || undefined);
      else await api.rechazarCortesia(row.id, nota || undefined);
      addToast(decision === 'autorizada' ? `Cortesía ${row.folio} autorizada` : `Cortesía ${row.folio} rechazada`, decision === 'autorizada' ? 'success' : 'warn');
      setNotas(n => ({ ...n, [row.id]: '' }));
      await onResolved();
      cargarHistorial();
    } catch (e) { addToast(e.message, 'warn'); }
    finally { setBusyId(null); }
  };

  const fecha = iso => new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
  // Función de render (no componente anidado): así el input de la nota no se
  // remonta ni pierde el foco en cada tecla o refresco de pendientes.
  const tarjeta = r => (
    <div key={r.id} className={`autorizacion-card ${r.cortesia_estado}`}>
      <div>
        <div className="folio">{r.folio} <span className={`cortesia-tag ${r.cortesia_estado}`}>{CORTESIA_ESTADO_LABELS[r.cortesia_estado] || r.cortesia_estado}</span></div>
        <div className="meta">
          {fecha(r.creado_en)} · Caja: {r.cajero_nombre || '—'}{r.origen === 'app' && r.cliente_nombre ? ` · pedido en línea de ${r.cliente_nombre} ${r.cliente_apellido || ''}` : ''}{r.cancelado ? ' · pedido cancelado' : ''}
          {r.cortesia_motivo && <><br />Motivo de la Caja: {r.cortesia_motivo}</>}
          {r.cortesia_estado !== 'pendiente' && r.cortesia_estado !== 'dentro_plan' && <><br />{r.cortesia_estado === 'autorizada' ? 'Autorizada' : 'Rechazada'} por {r.resuelta_por_nombre || 'administración'}{r.cortesia_resuelta_en ? ` el ${fecha(r.cortesia_resuelta_en)}` : ''}{r.cortesia_nota ? ` — "${r.cortesia_nota}"` : ''}</>}
        </div>
        {r.detalle && <div className="detalle">{r.detalle}</div>}
      </div>
      <div className="valor">{money(r.cortesia_valor ?? r.subtotal)}<span className="field-hint" style={{ display: 'block', fontWeight: 500 }}>{r.cortesia_unidades} producto(s){r.metodo_pago !== 'cortesia' && Number(r.total) > 0 ? ` · cobró ${money(r.total)}` : ''}</span></div>
      {r.cortesia_estado === 'pendiente' && (
        <div className="acciones">
          <input className="text-input" maxLength={300} placeholder="Nota para la Caja (opcional)" value={notas[r.id] || ''} onChange={e => setNotas(n => ({ ...n, [r.id]: e.target.value }))} />
          <button className="btn-primary small" disabled={busyId === r.id} onClick={() => resolver(r, 'autorizada')}><BadgeCheck size={14} /> Autorizar</button>
          <button className="btn-ghost small" disabled={busyId === r.id} onClick={() => resolver(r, 'rechazada')}>Rechazar</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="admin-columns">
      <div>
        <div className="section-title"><AlertTriangle size={15} /> Pendientes de autorizar</div>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          Cortesías que la Caja dio después de agotar el cupo del mes. La venta ya se procesó en $0; aquí decides si la apruebas o la rechazas.
          Una cortesía rechazada solo queda marcada (con tu nota) para resolverse fuera del sistema.
        </p>
        {(pendientes || []).length === 0
          ? <EmptyState icon={BadgeCheck} title="Sin cortesías pendientes" subtitle="Cuando la Caja exceda el cupo del mes, aparecerán aquí" />
          : pendientes.map(tarjeta)}
      </div>
      <div>
        <div className="section-title"><Gift size={15} /> Historial de cortesías</div>
        {historial === null ? <EmptyState icon={Gift} title="Cargando…" />
          : historial.length === 0 ? <EmptyState icon={Gift} title="Aún no hay cortesías registradas" />
          : historial.map(tarjeta)}
      </div>
    </div>
  );
}


// Cancelaciones de tickets pedidas por la Caja. Mientras están pendientes el
// ticket SIGUE contando en las ventas del día: solo al autorizar se cancela,
// baja del corte y los insumos regresan al inventario.
function CancelacionesPanel({ pendientes, addToast, onResolved }) {
  const [historial, setHistorial] = useState(null);
  const [notas, setNotas] = useState({});
  const [busyId, setBusyId] = useState(null);
  const cargarHistorial = React.useCallback(() => {
    api.getCancelaciones().then(rows => setHistorial(rows.filter(r => r.cancelacion_estado !== 'pendiente'))).catch(e => addToast(e.message, 'warn'));
  }, [addToast]);
  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);

  const resolver = async (row, decision) => {
    setBusyId(row.id);
    try {
      const nota = (notas[row.id] || '').trim();
      const r = decision === 'autorizada'
        ? await api.autorizarCancelacion(row.id, nota || undefined)
        : await api.rechazarCancelacion(row.id, nota || undefined);
      addToast(
        decision === 'autorizada'
          ? `Ticket ${row.folio} cancelado: sale de las ventas${r && r.insumosDevueltos ? ` y regresaron ${r.insumosDevueltos} insumo(s) al inventario` : ''}.`
          : `Cancelación de ${row.folio} rechazada: el ticket sigue contando.`,
        decision === 'autorizada' ? 'success' : 'warn');
      setNotas(n => ({ ...n, [row.id]: '' }));
      await onResolved();
      cargarHistorial();
    } catch (e) { addToast(e.message, 'warn'); }
    finally { setBusyId(null); }
  };

  const fecha = iso => new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
  const tarjeta = r => (
    <div key={r.id} className={`autorizacion-card ${r.cancelacion_estado}`}>
      <div>
        <div className="folio">{r.folio} <span className={`cancelacion-tag ${r.cancelacion_estado}`}>{CANCELACION_ESTADO_LABELS[r.cancelacion_estado] || r.cancelacion_estado}</span></div>
        <div className="meta">
          Ticket del {fecha(r.creado_en)} · Caja: {r.cajero_nombre || '—'}{r.cobrado ? ` · cobrado (${r.metodo_pago || 'sin método'})` : ' · sin cobrar'}
          {r.origen === 'app' && r.cliente_nombre ? ` · pedido en línea de ${r.cliente_nombre} ${r.cliente_apellido || ''}` : ''}
          <br />Motivo de la Caja: {r.cancelacion_motivo || '—'} <span className="field-hint">({r.solicitada_por_nombre || 'personal'}, {fecha(r.cancelacion_solicitada_en)})</span>
          {r.cancelacion_estado !== 'pendiente' && (
            <><br />{r.cancelacion_estado === 'autorizada' ? 'Autorizada' : 'Rechazada'} por {r.resuelta_por_nombre || 'administración'}{r.cancelacion_resuelta_en ? ` el ${fecha(r.cancelacion_resuelta_en)}` : ''}{r.cancelacion_nota ? ` — "${r.cancelacion_nota}"` : ''}</>
          )}
        </div>
        {r.detalle && <div className="detalle">{r.detalle}</div>}
        {r.cancelacion_estado === 'pendiente' && Number(r.insumos_por_devolver) > 0 && (
          <div className="detalle">Al autorizar regresarán {r.insumos_por_devolver} movimiento(s) de insumo al inventario.</div>
        )}
      </div>
      <div className="valor">{money(r.total)}</div>
      {r.cancelacion_estado === 'pendiente' && (
        <div className="acciones">
          <input className="text-input" maxLength={300} placeholder="Nota para la Caja (opcional)" value={notas[r.id] || ''} onChange={e => setNotas(n => ({ ...n, [r.id]: e.target.value }))} />
          <button className="btn-danger small" disabled={busyId === r.id} onClick={() => resolver(r, 'autorizada')}><Ban size={14} /> Autorizar cancelación</button>
          <button className="btn-ghost small" disabled={busyId === r.id} onClick={() => resolver(r, 'rechazada')}>Rechazar</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="admin-columns">
      <div>
        <div className="section-title"><AlertTriangle size={15} /> Cancelaciones por autorizar</div>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          Tickets que la Caja pidió cancelar (duplicados, cobros equivocados…). Hasta que autorices, el ticket sigue contando
          en las ventas del día. Al autorizar: sale del corte y del estado de resultados, y los insumos que se hubieran
          consumido regresan al inventario. Si rechazas, todo queda como estaba.
        </p>
        {(pendientes || []).length === 0
          ? <EmptyState icon={Ban} title="Sin cancelaciones pendientes" subtitle="Cuando la Caja pida cancelar un ticket, aparecerá aquí" />
          : pendientes.map(tarjeta)}
      </div>
      <div>
        <div className="section-title"><Ban size={15} /> Historial de cancelaciones</div>
        {historial === null ? <EmptyState icon={Ban} title="Cargando…" />
          : historial.length === 0 ? <EmptyState icon={Ban} title="Aún no hay cancelaciones resueltas" />
          : historial.map(tarjeta)}
      </div>
    </div>
  );
}

// Dos colas con el mismo peso: cortesías fuera de cupo y cancelaciones de
// tickets. La pestaña trae su propio contador de pendientes.
function AutorizacionesSection({ cortesias, cancelaciones, addToast, onResolved }) {
  const [tab, setTab] = useState(() => ((cancelaciones || []).length && !(cortesias || []).length ? 'cancelaciones' : 'cortesias'));
  const tabs = [
    { id: 'cortesias', label: 'Cortesías', Icon: Gift, n: (cortesias || []).length },
    { id: 'cancelaciones', label: 'Cancelaciones', Icon: Ban, n: (cancelaciones || []).length },
  ];
  return (
    <div>
      <div className="cat-tabs conta-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`cat-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <t.Icon size={15} /> {t.label}{t.n > 0 ? ` (${t.n})` : ''}
          </button>
        ))}
      </div>
      {tab === 'cortesias'
        ? <CortesiasPanel pendientes={cortesias} addToast={addToast} onResolved={onResolved} />
        : <CancelacionesPanel pendientes={cancelaciones} addToast={addToast} onResolved={onResolved} />}
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

  const eliminar = async (tipo, o) => {
    if (!window.confirm(`¿Eliminar "${o.etiqueta}" de la lista? Dejará de ofrecerse. Las ventas anteriores se conservan. Para ocultarlo temporalmente, usa Desactivar.`)) return;
    try {
      await api.eliminarOpcion(tipo, o.id);
      await cargar(); if (onOpcionesChanged) await onOpcionesChanged();
      addToast('Opción eliminada de la lista; historial conservado', 'success');
    } catch(e) { addToast(e.message, 'warn'); }
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
          <div className="opcion-nombre">{o.etiqueta}{o.activo === false ? ' • Inactiva' : ''}{o.precio_automatico ? ' • Precio automático' : ''}</div>
          <div className="opcion-sub">
            {extraSub ? `${extraSub} · ` : ''}
            {costo === null ? 'costo no calculable' : `costo ≈ ${costo < 0 ? '−' : ''}${money(Math.abs(costo))}`}
            {sug !== null && <> · sugerido {fmtDelta(sug)}{bajo && <span className="warn"> · por debajo del costo + margen</span>}</>}
          </div>
        </div>
        <span className={`opcion-delta${delta === 0 ? ' neutro' : ''}`}>{fmtDelta(delta)}</span>
        <div className="list-row-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
          <button className="icon-btn small" onClick={() => setEditing({ tipo, opcion: o })} aria-label="Editar"><Pencil size={14} /></button>
          {!['entera', 'tradicional'].includes(o.codigo) && (
            <><button className="link-toggle" onClick={() => toggle(tipo, o)}>{o.activo === false ? 'Activar' : 'Desactivar'}</button><button className="link-danger" onClick={() => eliminar(tipo,o)}>Eliminar de la lista</button></>
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
          {data.extras.map(e => <Fila key={e.id} tipo="extras" o={e} extraSub={`${e.aplica_a === 'alimentos' ? 'parrilla/cocina' : 'bebidas'} · ${porcion(e)}`} />)}
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

/* ---------- Costos y precios: margen de contribución, gastos fijos, pesos ---------- */

// El precio sugerido sale del MARGEN DE CONTRIBUCIÓN (producto → categoría →
// sede): precio = insumo / (1 - margen). Los gastos fijos que son costo de
// operar se reparten por peso de estación solo para marcar el PISO de cada
// precio, y se cubren con la contribución del mes (punto de equilibrio).
// Cualquier cambio aquí mueve los "precios por revisar" (onCostosChanged).
function CostosSection({ addToast, onCostosChanged, sedeNombre }) {
  const [gastos, setGastos] = useState(null);
  const [margen, setMargen] = useState(null);
  const [equilibrio, setEquilibrio] = useState(null);
  const [categorias, setCategorias] = useState(null);
  const [pesos, setPesos] = useState(null);
  const [cuentas, setCuentas] = useState(null);
  const [editingGasto, setEditingGasto] = useState(null);
  const [margenOpen, setMargenOpen] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);

  const cargar = React.useCallback(async () => {
    try {
      const [g, m, e, cats, pe, cc] = await Promise.all([
        api.getGastosFijos(), api.getMargen(), api.getPuntoEquilibrio(),
        api.getCategoriasProducto(), api.getPesosEstacion(), api.getCuentasContables(),
      ]);
      setGastos(g); setMargen(m); setEquilibrio(e); setCategorias(cats); setPesos(pe); setCuentas(cc);
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
      if (payload.id) await api.actualizarGastoFijo(payload.id, { concepto: payload.concepto, categoria: payload.categoria, montoMensual: payload.montoMensual, cuentaContableId: payload.cuentaContableId, cuentaDineroId: payload.cuentaDineroId, diaPago: payload.diaPago });
      else await api.crearGastoFijo(payload);
      await despuesDeCambiar(payload.id ? 'Gasto actualizado' : 'Gasto agregado');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const toggleGasto = async g => {
    try {
      await api.actualizarGastoFijo(g.id, { activo: !g.activo });
      await despuesDeCambiar(g.activo ? 'Gasto en pausa' : 'Gasto reactivado');
    } catch (e) { addToast(e.message, 'warn'); }
  };
  const eliminarGasto = async g => {
    if (!window.confirm(`¿Eliminar "${g.concepto}" (${money(g.monto_mensual)} al mes)? Se quita definitivamente del cálculo de costos.`)) return;
    try {
      await api.eliminarGastoFijo(g.id);
      await despuesDeCambiar('Gasto eliminado');
    } catch (e) { addToast(e.message, 'warn'); }
  };
  const guardarMargen = async payload => {
    try {
      await api.guardarMargen(payload);
      await despuesDeCambiar('Margen general guardado; revisa los precios sugeridos');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const guardarMargenCategoria = async (cat, valor) => {
    try {
      await api.actualizarMargenCategoria(cat.id, valor === '' || valor === null ? null : Number(valor));
      await despuesDeCambiar(`Margen de ${cat.nombre} guardado; revisa los precios sugeridos`);
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const guardarPesos = async lista => {
    try {
      await api.guardarPesosEstacion(lista);
      await despuesDeCambiar('Pesos por estación guardados');
      return true;
    } catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const toggleCuentaCosto = async c => {
    try {
      await api.actualizarCuentaContable(c.id, { entraAlCosto: !c.entra_al_costo });
      await despuesDeCambiar(`${c.nombre}: ${c.entra_al_costo ? 'fuera del' : 'dentro del'} costo de los productos`);
    } catch (e) { addToast(e.message, 'warn'); }
  };

  if (!gastos || !margen || !pesos) return <EmptyState icon={DollarSign} title="Cargando costos…" />;

  const activos = gastos.filter(g => g.activo);
  const inactivos = gastos.filter(g => !g.activo);
  const totalMes = activos.reduce((acc, g) => acc + Number(g.monto_mensual || 0), 0);
  const costeables = Number(pesos.gastosFijosCosteablesMes || 0);
  const fueraDelCosto = totalMes - costeables;
  const margenSede = Number(margen.porcentaje_ganancia_normal ?? 60);
  const real = margen.ventas_reales_promedio_mes;
  const porCategoria = GASTO_CATEGORIAS
    .map(c => ({ categoria: c, items: activos.filter(g => g.categoria === c) }))
    .filter(x => x.items.length > 0);
  // Cuentas que pueden ser costo de operar: las de gasto. El resto (préstamo,
  // impuestos, inversión, retiros, diezmo) nunca entra al precio.
  const cuentasCosteables = (cuentas || []).filter(c => c.grupo === 'gasto_operacion' || c.grupo === 'gasto_financiero');
  const margenReal = equilibrio && equilibrio.margen_contribucion_real !== null && equilibrio.margen_contribucion_real !== undefined
    ? Number(equilibrio.margen_contribucion_real) : null;

  return (
    <>
      <div className="promo-summary-card">
        <strong>Así se fija el precio{sedeNombre ? ` en ${sedeNombre}` : ''}:</strong> cada producto tiene un <strong>margen de contribución</strong> —
        de cada peso vendido, cuánto queda después de pagar sus insumos— y de ahí sale el precio sugerido:
        {' '}<code>precio = insumo ÷ (1 − margen)</code>. Los gastos fijos ya no se le suman a cada producto con margen encima;
        sirven de <strong>piso</strong> (nunca sugerir por debajo del costo con su parte de gastos) y se cubren con la contribución de todo el mes.
      </div>

      <div className="kpi-grid">
        <div className="kpi-card"><span className="kpi-label">Gastos fijos al mes</span><span className="kpi-value">{money(totalMes)}</span></div>
        <div className="kpi-card">
          <span className="kpi-label">De ellos, costo del producto</span>
          <span className="kpi-value brand">{money(costeables)}</span>
          {fueraDelCosto > 0 && <span className="kpi-label" style={{ marginTop: 6, marginBottom: 0, textTransform: 'none', letterSpacing: 0 }}>{money(fueraDelCosto)} se pagan con la utilidad</span>}
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Margen de contribución real</span>
          <span className="kpi-value">{margenReal === null ? '—' : `${margenReal}%`}</span>
          <span className="kpi-label" style={{ marginTop: 6, marginBottom: 0, textTransform: 'none', letterSpacing: 0 }}>últimos 30 días</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Venta para cubrir los fijos</span>
          <span className="kpi-value">{equilibrio && equilibrio.venta_equilibrio_mes ? money(equilibrio.venta_equilibrio_mes) : '—'}</span>
          {equilibrio && equilibrio.venta_30_dias !== undefined && <span className="kpi-label" style={{ marginTop: 6, marginBottom: 0, textTransform: 'none', letterSpacing: 0 }}>vendiste {money(equilibrio.venta_30_dias)}</span>}
        </div>
      </div>

      {equilibrio && equilibrio.venta_equilibrio_mes && Number(equilibrio.utilidad_estimada_mes) < 0 && (
        <div className="reprecio-banner">
          <div className="reprecio-head"><AlertTriangle size={15} /> Con esta venta no alcanzas a cubrir los gastos fijos</div>
          <div className="reprecio-sub">
            En 30 días vendiste {money(equilibrio.venta_30_dias)} y tu contribución fue {money(equilibrio.contribucion_30_dias)},
            contra {money(equilibrio.gastos_fijos_mes)} de gastos fijos. Necesitas vender {money(equilibrio.venta_equilibrio_mes)} al mes
            (o subir márgenes, o bajar gastos) para quedar en cero.
          </div>
        </div>
      )}

      <div className="admin-columns">
        <div>
          <div className="section-title"><Percent size={15} /> Margen de contribución por categoría</div>
          <p className="field-hint" style={{ marginBottom: 10 }}>
            Es el que heredan los productos de esa categoría cuando no tienen uno propio. Un producto con margen propio no se mueve de aquí.
          </p>
          <div className="spec-table" style={{ marginBottom: 10 }}>
            {(categorias || []).map(c => (
              <div className="spec-row" key={c.id}>
                <span className="spec-label">{c.nombre}</span>
                <span className="spec-value">
                  <input
                    className="text-input inline-number" type="number" min="1" max="99" step="0.5"
                    aria-label={`Margen de ${c.nombre}`}
                    defaultValue={c.margen_contribucion === null || c.margen_contribucion === undefined ? '' : Number(c.margen_contribucion)}
                    placeholder={`${margenSede} (sede)`}
                    onBlur={e => {
                      const anterior = c.margen_contribucion === null || c.margen_contribucion === undefined ? '' : String(Number(c.margen_contribucion));
                      if (String(e.target.value) !== anterior) guardarMargenCategoria(c, e.target.value);
                    }}
                  /> %
                </span>
              </div>
            ))}
            <div className="spec-row"><span className="spec-label">Margen general de la sede</span><span className="spec-value">{margenSede}%</span></div>
            <div className="spec-row"><span className="spec-label">Redondeo de precios</span><span className="spec-value">${Number(margen.redondeo ?? 1)}</span></div>
            <div className="spec-row"><span className="spec-label">Venta real promedio al mes</span><span className="spec-value">{real && Number(real.unidades_promedio_mes) > 0 ? `${Number(real.unidades_promedio_mes)} unidades (${real.meses_de_historia} mes(es))` : 'Sin historial aún'}</span></div>
          </div>
          <button className="btn-secondary full" onClick={() => setMargenOpen(true)}><Pencil size={15} /> Editar margen general y redondeo</button>

          <div className="section-title"><Scale size={15} /> Qué gastos entran al precio</div>
          <p className="field-hint" style={{ marginBottom: 10 }}>
            Solo mueve el <strong>piso</strong> de los precios. Lo que dejes fuera se sigue pagando y sigue bajando la utilidad y el diezmo:
            simplemente no se le cobra al cliente con margen encima.
          </p>
          {cuentasCosteables.map(c => (
            <div key={c.id} className="list-row">
              <div className="list-row-main" style={{ display: 'block', flex: 1 }}>
                <div className="list-row-title">{c.nombre}</div>
                <div className="list-row-sub">
                  {Number(c.gasto_fijo_mes) > 0 ? `${money(c.gasto_fijo_mes)} al mes en gastos fijos` : 'Sin gasto fijo ligado'}
                  {' · '}{c.entra_al_costo ? 'es costo del producto' : 'se paga con la utilidad'}
                </div>
              </div>
              <div className="list-row-actions">
                <button className={c.entra_al_costo ? 'link-toggle' : 'btn-secondary small'} onClick={() => toggleCuentaCosto(c)}>
                  {c.entra_al_costo ? 'Sacar del costo' : 'Meter al costo'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="section-title"><Wallet size={15} /> Gastos fijos mensuales</div>
          {activos.length === 0 && <EmptyState icon={Wallet} title="Sin gastos fijos registrados" subtitle="Agrega renta, sueldos, servicios… para saber cuánto tienes que vender." />}
          {porCategoria.map(grupo => (
            <div key={grupo.categoria} style={{ marginBottom: 6 }}>
              <div className="list-row-sub" style={{ margin: '8px 0 6px', fontWeight: 800 }}>{grupo.categoria} · {money(grupo.items.reduce((a, g) => a + Number(g.monto_mensual || 0), 0))}</div>
              {grupo.items.map(g => (
                <div key={g.id} className="list-row">
                  <div className="list-row-main" style={{ display: 'block', flex: 1 }}>
                    <div className="list-row-title">{g.concepto}</div>
                    <div className="list-row-sub">{money(g.monto_mensual)} al mes{g.cuenta_nombre ? ` · ${g.cuenta_nombre}` : ''}</div>
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
                    <div className="list-row-sub">{g.categoria} · {money(g.monto_mensual)} al mes (no cuenta)</div>
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

          <div className="section-title"><SlidersHorizontal size={15} /> Peso de cada estación</div>
          <p className="field-hint" style={{ marginBottom: 10 }}>
            Cuánto del local y del tiempo consume un producto según dónde se prepara. Reparte los {money(costeables)} costeables
            para calcular el piso de cada precio: una bebida embotellada que sale del refrigerador no puede cargar lo mismo que una hamburguesa.
          </p>
          <div className="spec-table">
            {(pesos.pesos || []).map(p => (
              <div className="spec-row" key={p.estacion}>
                <span className="spec-label">{ESTACION_LABELS[p.estacion] || p.estacion} · {p.productos} producto(s)</span>
                <span className="spec-value">
                  <input
                    className="text-input inline-number" type="number" min="0" max="20" step="0.05"
                    aria-label={`Peso de ${p.estacion}`} defaultValue={Number(p.peso)}
                    onBlur={e => { if (Number(e.target.value) !== Number(p.peso)) guardarPesos([{ estacion: p.estacion, peso: Number(e.target.value) }]); }}
                  />
                </span>
              </div>
            ))}
          </div>
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
    cortesiasMes = 0, cortesiasPendientes = [], cancelacionesPendientes = [], mesas = 4,
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
      addToast(compra.paquetes
        ? `Compra registrada: ${compra.paquetes} ${materia.presentacion ? materia.presentacion.nombre : 'paquete'}(s) de ${materia.nombre} (+${formatNumero(compra.cantidadComprada)} ${unidadDisplay(compra.unidad)})`
        : `Compra registrada: +${compra.cantidadComprada} ${compra.unidad} de ${materia.nombre}`, 'success');
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

  const mantenerPrecio = async r => {
    try {
      await api.mantenerPrecio(r.id, r.revision);
      await recargarAdmin();
      addToast(`Precio conservado: $${Number(r.precio_base).toFixed(2)}`, 'success');
    } catch (e) {
      addToast(e.message, 'warn');
      await recargarAdmin();
    }
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
    { id: 'contabilidad', label: 'Contabilidad', Icon: BookOpen },
    { id: 'proveedores', label: 'Proveedores', Icon: Package },
    { id: 'usuarios', label: 'Personal', Icon: Lock },
    { id: 'reportes', label: 'Reportes', Icon: Receipt },
    { id: 'comandas', label: 'Comandas / personal', Icon: ClipboardList },
    { id: 'autorizaciones', label: 'Autorizaciones', Icon: BadgeCheck, badge: (cortesiasPendientes || []).length + (cancelacionesPendientes || []).length },
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
    costos: ['Costos y precios', 'Margen de contribución, gastos fijos y punto de equilibrio'],
    contabilidad: ['Contabilidad', 'Egresos, estado de resultados, mayordomía y cuentas'],
    opciones: ['Opciones y extras', 'Tamaños, tipos de café, leches y extras con su precio'],
    reportes: ['Reportes', sedeNombre ? `Histórico acumulado de ${sedeNombre}` : 'Histórico acumulado'],
    comandas: ['Preparación por empleado', 'Historial de productos preparados y seguimiento de entregas'],
    autorizaciones: ['Autorizaciones', `${(cortesiasPendientes || []).length} cortesía(s) y ${(cancelacionesPendientes || []).length} cancelación(es) por resolver`],
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
      wide={['comandas', 'reportes', 'comparativo', 'materias', 'productos', 'proveedores', 'costos', 'opciones', 'autorizaciones', 'contabilidad'].includes(screen)}
      topRight={esGeneral ? <span className="sede-pill"><Building2 size={13} /> {sedeNombre || 'Elige sucursal'}</span> : null}
    >
      {screen === 'comandas' && <CajaComandas key={sedeActivaId || sedeNombre} initialHistory readOnly />}
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
              <div className="kpi-card"><span className="kpi-label">Cortesías del día</span><span className="kpi-value">{kpis ? Number(kpis.cortesias || 0) : '—'}</span>{kpis && Number(kpis.valor_cortesias || 0) > 0 && <span className="kpi-label">valor {money(kpis.valor_cortesias)}</span>}</div>
            </div>

            {materiasBajas.length > 0 && (
              <>
                <div className="section-title"><TrendingDown size={15} /> Stock bajo</div>
                {materiasBajas.map(m => {
                  const proveedor = proveedores.find(p => p.id === m.proveedorId);
                  const pct = stockPct(m.stockActual, m.stockMinimo);
                  return (
                    <div key={m.id} className="stock-alert-card">
                      <div className="stock-row"><strong>{m.nombre}</strong><span>{m.stockActual} / {m.stockMinimo} {unidadDisplay(m.unidad)}{(() => { const pedir = Math.max(0, (m.stockMaximo ?? m.stockMinimo) - m.stockActual); return pedir > 0 ? <strong className="stock-pedir"> · pedir {formatNumero(pedir)}</strong> : null; })()}</span></div>
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
                      {rolEtiqueta(u)}
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
          onMantenerPrecio={mantenerPrecio}
          onAplicarSugerido={r => aplicarPrecio(r.id, { price: Number(r.precio_sugerido), margenPorcentaje: r.margen_propio ? Number(r.margen_aplicado) : null })}
        />
      )}

      {screen === 'recetas' && <RecetasSection productos={productosAdmin} onView={setRecipeProduct} recetaOverrides={recetaOverrides} />}
      {screen === 'opciones' && <OpcionesSection addToast={addToast} onOpcionesChanged={recargarCatalogo} />}
      {screen === 'costos' && <CostosSection addToast={addToast} sedeNombre={sedeNombre} onCostosChanged={recargarAdmin} />}
      {screen === 'contabilidad' && <ContabilidadSection addToast={addToast} esGeneral={esGeneral} sedeNombre={sedeNombre} proveedores={proveedores} />}
      {screen === 'reportes' && <ReportesSection data={reportes} />}
      {screen === 'autorizaciones' && <AutorizacionesSection cortesias={cortesiasPendientes} cancelaciones={cancelacionesPendientes} addToast={addToast} onResolved={recargarAdmin} />}
      {screen === 'comparativo' && esGeneral && <ComparativoSection addToast={addToast} />}
      {screen === 'sucursales' && esGeneral && <SucursalesSection addToast={addToast} onSedesChanged={onSedesChanged} />}

      {screen === 'config' && (
        <div className="admin-columns">
          <div>
            <div className="section-title">Identidad del negocio (por sucursal)</div>
            <BrandingEditor nombreNegocio={nombreNegocio} logo={logo} lema={pantallaCfg ? pantallaCfg.lema : ''} onSave={onSaveBranding} />
            <div className="section-title" style={{ marginTop: 18 }}><SlidersHorizontal size={15} /> Categorías</div>
            <CategoriasEditor productos={productosAdmin} materias={materias} addToast={addToast} onChanged={async () => { await recargarCatalogo(); await recargarAdmin(); }} />
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
            <div className="promo-summary-card" style={{marginTop:16}}>
              <div className="section-title">Menú para imprimir o compartir</div>
              <p>Descarga una carta en PDF con los precios vigentes, fotos y opciones de personalización. Elige papel claro o estilo Neblina.</p>
              <a className="btn-primary" href={`/?pantalla=imprimir&sucursal=${sedeActivaId || ''}`} target="_blank" rel="noreferrer">Crear menú PDF</a>
            </div>
            <div className="promo-summary-card" style={{marginTop:16}}>
              <div className="section-title">Menú con QR para las mesas</div>
              <p>Tarjetas con el número de cada mesa. Tus clientes ven el menú completo con imágenes y precios, sin iniciar sesión.</p>
              <a className="btn-primary" href={`/?pantalla=qr-mesas&sucursal=${sedeActivaId || ''}`} target="_blank" rel="noreferrer">Imprimir QR de las mesas</a>
            </div>
            <PantallaConfigEditor cfg={pantallaCfg} onSave={onSaveBranding} />

            <div className="section-title">Acceso de clientes</div>
            <div className="turno-status-card">
              <span>Verificación por SMS</span>
              <button className={`turno-pill ${smsActivo ? 'open' : 'closed'}`} onClick={() => onToggleSms(!smsActivo)}>
                {smsActivo ? '● Activada' : 'Desactivada'}
              </button>
            </div>
            <div className="section-title"><MapPin size={15} /> Mesas y destino del pedido</div>
            <div className="promo-summary-card">
              {mesas > 0 ? `La Caja elige Mesa 1 a ${mesas}, Barra o Para llevar antes de cobrar; la comanda lo muestra en grande.` : 'Sin mesas: la Caja elige Barra o Para llevar antes de cobrar.'}
            </div>
            <MesasConfigEditor mesas={mesas} onSave={onSaveBranding} />
            <div className="section-title"><Gift size={15} /> Cortesías</div>
            <div className="promo-summary-card">
              {cortesiasMes > 0
                ? `La Caja puede regalar ${cortesiasMes} producto(s) al mes sin autorización (se marcan en el mismo ticket); un ticket cuyos productos ya no caben queda pendiente en Autorizaciones.`
                : 'Sin cupo: toda cortesía que dé la Caja queda pendiente de autorización.'}
            </div>
            <CortesiasConfigEditor cupo={cortesiasMes} onSave={onSaveBranding} />
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
          materias={materias}
          onClose={() => setEditingProducto(null)}
          onSave={p => (p.id ? updateProducto(p.id, p) : addProducto(p))}
        />
      )}

      {recipeProduct && (
        <RecipeModal
          product={recipeProduct}
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
