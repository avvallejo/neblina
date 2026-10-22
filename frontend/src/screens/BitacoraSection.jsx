// BITÁCORA (Admin): quién hizo qué, cuándo y con qué resultado.
//   * Acciones: cada escritura del personal (alta, edición, ajuste, anulación, pago…), también las rechazadas.
//   * Cambios: el detalle antes → después de lo importante (insumos, compras, ajustes, egresos…).
//   * Inventario: cada entrada/salida de existencias con su usuario.
//   * Compras y altas: lo que se capturó, quién y cuándo; permite ANULAR una compra capturada por error
//     (revierte el ajuste que la "compensó" para que el estado de resultados no cargue una pérdida falsa).
// Solo lectura, salvo la anulación (que exige motivo y queda registrada).
import './BitacoraSection.css';
import React, { useEffect, useState } from 'react';
import { ScrollText, Ban } from 'lucide-react';
import * as api from '../api/client.js';
import { money } from '../lib/helpers.js';
import { Sheet, EmptyState, FormError, useAccionUnica } from '../components/ui.jsx';
import { etiquetaAccion, etiquetaCambio, resumenCambio, esRechazada, ETIQUETAS_TIPO_MOVIMIENTO } from '../lib/bitacora.js';

const POR_PAGINA = 50;
const cuando = iso => (iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const cantidad = n => Number(n).toLocaleString('es-MX', { maximumFractionDigits: 3 });

/* ---------- Anular una compra capturada por error ---------- */
function AnularSheet({ compra, onClose, onDone, addToast }) {
  const [vista, setVista] = useState(null);
  const [cargaError, setCargaError] = useState('');
  const [elegidos, setElegidos] = useState(new Set());
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);
  useEffect(() => {
    let activo = true;
    api.getAnulacionCompra(compra.id).then(v => {
      if (!activo) return;
      setVista(v);
      // Lo normal: el ajuste que bajó las existencias para "compensar" el error.
      setElegidos(new Set(v.ajustes.filter(a => a.diferencia < 0).map(a => a.id)));
    }).catch(e => { if (activo) setCargaError(e.message); });
    return () => { activo = false; };
  }, [compra.id]);
  const alternar = id => setElegidos(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const impacto = vista ? vista.ajustes.filter(a => elegidos.has(a.id)).reduce((s, a) => s + a.costo, 0) : 0;
  const [busy, anular] = useAccionUnica(async () => {
    setError('');
    if (motivo.trim().length < 5) { setError('Explica con unas palabras por qué anulas esta compra.'); return; }
    try {
      const out = await api.anularCompra(compra.id, { ajusteIds: [...elegidos], motivo: motivo.trim() });
      setResultado(out); addToast('Compra anulada', 'success'); await onDone();
    } catch (e) { setError(e.message); }
  });
  const l = vista?.lote;
  return (
    <Sheet title="Anular compra capturada por error" onClose={onClose}>
      {cargaError && <FormError>{cargaError}</FormError>}
      {!vista && !cargaError && <p className="field-hint">Cargando…</p>}
      {vista && resultado && (
        <div className="anular-ok">
          Listo. Existencias de {resultado.insumo}: {cantidad(resultado.stockAntes)} → {cantidad(resultado.stockDespues)}.
          {resultado.impactoResultados > 0 && <> Se quitaron {money(resultado.impactoResultados)} que el ajuste había cargado al estado de resultados.</>}
          {resultado.egresosAnulados.length > 0 && <> Se anuló el egreso de la compra ({money(resultado.egresosAnulados.reduce((s, e) => s + e.monto, 0))}).</>}
          {resultado.costoReferencia.antes !== resultado.costoReferencia.despues && <> El costo de referencia volvió de {money(resultado.costoReferencia.antes)} a {money(resultado.costoReferencia.despues)}.</>}
          {resultado.costoReferencia.revisar && <> Revisa el costo unitario del insumo: no hay otra compra anterior para tomarlo.</>}
          <div className="sheet-footer"><span /><button className="btn-primary" onClick={onClose}>Cerrar</button></div>
        </div>
      )}
      {vista && !resultado && (<>
        <div className="anular-resumen">
          <strong>{l.insumo}</strong>: {cantidad(l.cantidad_comprada)} {l.unidad} por {money(l.costo_total)}<br />
          Registrada por <strong>{l.registrado_por || 'desconocido'}</strong> el {cuando(l.creado_en)}.<br />
          Existencias hoy: {cantidad(l.stock_actual)} {l.unidad_insumo}.
          {vista.egresos.map(e => <div key={e.id}>Egreso: {e.concepto} · {money(e.monto)} · {e.anulado ? 'anulado' : e.pagado ? `pagado (${e.cuenta_dinero || 'caja/banco'})` : 'por pagar'}</div>)}
        </div>
        {vista.bloqueo && <div className="anular-aviso">{vista.bloqueo}</div>}
        {vista.puedeAnular && (<>
          <div className="option-label">¿Algún ajuste se hizo para compensar este error?</div>
          <p className="field-hint">Si alguien bajó las existencias con un ajuste para "arreglar" la captura, márcalo: se revierte para que ese faltante deje de contarse como pérdida.</p>
          {vista.ajustes.length === 0 && <p className="field-hint">No hay ajustes de este insumo posteriores a la compra.</p>}
          {vista.ajustes.map(a => (
            <label className="anular-ajuste" key={a.id}>
              <input type="checkbox" checked={elegidos.has(a.id)} onChange={() => alternar(a.id)} />
              <span>
                <strong>{a.diferencia > 0 ? '+' : ''}{cantidad(a.diferencia)} {l.unidad_insumo}</strong> · {a.usuario || 'desconocido'} · {cuando(a.creado_en)}<br />
                {a.motivo} — {a.costo > 0 ? `suma ${money(a.costo)} al costo de ventas` : a.costo < 0 ? `resta ${money(-a.costo)} al costo de ventas` : 'sin efecto en costos'}
              </span>
            </label>
          ))}
          {impacto !== 0 && <div className="anular-aviso">Al revertir los ajustes marcados, el costo de ventas baja {money(impacto)}.</div>}
          <div className="option-group"><div className="option-label">Motivo de la anulación</div>
            <input className="text-input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej. Alta de 200 kg capturada por error" /></div>
          <FormError>{error}</FormError>
          <div className="sheet-footer"><span />
            <button className="btn-danger" disabled={busy} onClick={anular}>{busy ? 'Anulando…' : 'Anular compra'}</button></div>
        </>)}
      </>)}
    </Sheet>
  );
}

/* ---------- Listados ---------- */
function Filtros({ f, set, children }) {
  return (
    <div className="bitacora-filtros">
      <label>Desde<input type="date" className="text-input" value={f.desde} onChange={e => set({ ...f, desde: e.target.value, offset: 0 })} /></label>
      <label>Hasta<input type="date" className="text-input" value={f.hasta} onChange={e => set({ ...f, hasta: e.target.value, offset: 0 })} /></label>
      <label>Buscar<input className="text-input" placeholder="Persona, insumo, motivo…" value={f.q} onChange={e => set({ ...f, q: e.target.value, offset: 0 })} /></label>
      {children}
    </div>
  );
}
function Pie({ total, offset, set, f }) {
  const desde = total ? offset + 1 : 0;
  const hasta = Math.min(offset + POR_PAGINA, total);
  return (
    <div className="bitacora-pie">
      <span>{desde}–{hasta} de {total}</span>
      <div>
        <button className="btn-secondary" disabled={offset === 0} onClick={() => set({ ...f, offset: Math.max(0, offset - POR_PAGINA) })}>Anteriores</button>
        <button className="btn-secondary" disabled={offset + POR_PAGINA >= total} onClick={() => set({ ...f, offset: offset + POR_PAGINA })}>Siguientes</button>
      </div>
    </div>
  );
}

function useListado(cargar, filtros, extra = 0) {
  const [datos, setDatos] = useState({ total: 0, filas: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let activo = true;
    setCargando(true); setError('');
    const t = setTimeout(() => {
      cargar({ ...filtros, limite: POR_PAGINA }).then(d => { if (activo) setDatos(d); })
        .catch(e => { if (activo) setError(e.message); })
        .finally(() => { if (activo) setCargando(false); });
    }, 250);
    return () => { activo = false; clearTimeout(t); };
  }, [JSON.stringify(filtros), extra]); // eslint-disable-line react-hooks/exhaustive-deps
  return { datos, cargando, error };
}

const FILTROS_BASE = { desde: '', hasta: '', q: '', offset: 0 };

function Acciones() {
  const [f, setF] = useState({ ...FILTROS_BASE, resultado: '' });
  const { datos, cargando, error } = useListado(api.getBitacoraAcciones, f);
  return (<>
    <Filtros f={f} set={setF}>
      <label>Resultado<select className="text-input" value={f.resultado} onChange={e => setF({ ...f, resultado: e.target.value, offset: 0 })}>
        <option value="">Todas</option><option value="ok">Se hicieron</option><option value="fallida">Rechazadas o con error</option></select></label>
    </Filtros>
    <FormError>{error}</FormError>
    {!cargando && datos.filas.length === 0 ? <EmptyState icon={ScrollText} title="Sin acciones en este filtro" subtitle="Las acciones se registran desde que se activó la bitácora." /> : (
      <div className="bitacora-scroll"><table className="bitacora-table">
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué hizo</th><th>Resultado</th></tr></thead>
        <tbody>{datos.filas.map(a => (
          <tr key={a.id}>
            <td className="cuando">{cuando(a.creado_en)}</td>
            <td>{a.usuario || 'Sin identificar'}{a.rol ? <div className="bitacora-detalle">{a.rol}</div> : null}</td>
            <td>{etiquetaAccion(a.entidad, a.accion, a.ruta)}<div className="bitacora-detalle">{a.metodo} {a.ruta}{a.ip ? ` · ${a.ip}` : ''}</div></td>
            <td><span className={`bitacora-etiqueta ${esRechazada(a.estado_http) ? 'mala' : ''}`}>{esRechazada(a.estado_http) ? `Rechazada (${a.estado_http})` : 'Hecha'}</span></td>
          </tr>))}</tbody>
      </table></div>)}
    <Pie total={datos.total} offset={f.offset} set={setF} f={f} />
  </>);
}

function Cambios() {
  const [f, setF] = useState({ ...FILTROS_BASE });
  const { datos, cargando, error } = useListado(api.getBitacoraCambios, f);
  return (<>
    <Filtros f={f} set={setF} />
    <FormError>{error}</FormError>
    {!cargando && datos.filas.length === 0 ? <EmptyState icon={ScrollText} title="Sin cambios en este filtro" /> : (
      <div className="bitacora-scroll"><table className="bitacora-table">
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Cambio</th></tr></thead>
        <tbody>{datos.filas.map(c => (
          <tr key={c.id}>
            <td className="cuando">{cuando(c.creado_en)}</td>
            <td>{c.usuario || 'Sistema'}</td>
            <td><strong>{etiquetaCambio(c.entidad, c.accion)}</strong>{c.referencia ? ` · ${c.referencia}` : ''}
              {resumenCambio(c.valor_anterior, c.valor_nuevo).slice(0, 12).map((linea, i) => <div className="bitacora-detalle" key={i}>{linea}</div>)}
              {c.motivo && <div className="bitacora-detalle">Motivo: {c.motivo}</div>}</td>
          </tr>))}</tbody>
      </table></div>)}
    <Pie total={datos.total} offset={f.offset} set={setF} f={f} />
  </>);
}

function Inventario() {
  const [f, setF] = useState({ ...FILTROS_BASE, tipo: '', incluirVentas: '' });
  const { datos, cargando, error } = useListado(api.getBitacoraMovimientos, f);
  return (<>
    <Filtros f={f} set={setF}>
      <label>Tipo<select className="text-input" value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value, offset: 0 })}>
        <option value="">Todos</option>{Object.entries(ETIQUETAS_TIPO_MOVIMIENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label><span>Consumo por ventas</span><select className="text-input" value={f.incluirVentas} onChange={e => setF({ ...f, incluirVentas: e.target.value, offset: 0 })}>
        <option value="">Ocultar</option><option value="true">Mostrar</option></select></label>
    </Filtros>
    <FormError>{error}</FormError>
    {!cargando && datos.filas.length === 0 ? <EmptyState icon={ScrollText} title="Sin movimientos en este filtro" /> : (
      <div className="bitacora-scroll"><table className="bitacora-table">
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Insumo</th><th>Tipo</th><th className="num">Cantidad</th><th className="num">Valor</th></tr></thead>
        <tbody>{datos.filas.map(m => (
          <tr key={m.id}>
            <td className="cuando">{cuando(m.creado_en)}</td>
            <td>{m.usuario || '—'}</td>
            <td>{m.insumo}{m.motivo ? <div className="bitacora-detalle">{m.motivo}</div> : null}</td>
            <td><span className={`bitacora-etiqueta ${m.tipo === 'anulacion_compra' ? 'anulada' : ''}`}>{ETIQUETAS_TIPO_MOVIMIENTO[m.tipo] || m.tipo}{m.revierte_movimiento_id ? ' (reversa)' : ''}</span></td>
            <td className="num">{Number(m.cantidad) > 0 ? '+' : ''}{cantidad(m.cantidad)} {m.unidad}</td>
            <td className="num">{money(m.valor)}</td>
          </tr>))}</tbody>
      </table></div>)}
    <Pie total={datos.total} offset={f.offset} set={setF} f={f} />
  </>);
}

function Compras({ addToast, onChanged }) {
  const [f, setF] = useState({ ...FILTROS_BASE, estado: '' });
  const [revision, setRevision] = useState(0);
  const [anular, setAnular] = useState(null);
  const { datos, cargando, error } = useListado(api.getCompras, f, revision);
  return (<>
    <p className="field-hint" style={{ marginBottom: 10 }}>Aquí ves quién dio de alta cada compra o insumo. Si fue un error, anúlala: no se borra, queda registrada como anulada.</p>
    <Filtros f={f} set={setF}>
      <label>Estado<select className="text-input" value={f.estado} onChange={e => setF({ ...f, estado: e.target.value, offset: 0 })}>
        <option value="">Todas</option><option value="vigentes">Vigentes</option><option value="anuladas">Anuladas</option></select></label>
    </Filtros>
    <FormError>{error}</FormError>
    {!cargando && datos.filas.length === 0 ? <EmptyState icon={ScrollText} title="Sin compras en este filtro" /> : (
      <div className="bitacora-scroll"><table className="bitacora-table">
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Insumo</th><th className="num">Cantidad</th><th className="num">Costo</th><th /></tr></thead>
        <tbody>{datos.filas.map(c => (
          <tr key={c.id}>
            <td className="cuando">{cuando(c.creado_en)}</td>
            <td>{c.registrado_por || '—'}</td>
            <td>{c.insumo}{c.proveedor ? <div className="bitacora-detalle">{c.proveedor}</div> : null}
              {c.anulado_en && <div className="bitacora-detalle">Anulada por {c.anulado_por} el {cuando(c.anulado_en)}: {c.motivo_anulacion}</div>}</td>
            <td className="num">{cantidad(c.cantidad_comprada)} {c.unidad}</td>
            <td className="num">{money(c.costo_total)}</td>
            <td>{c.anulado_en ? <span className="bitacora-etiqueta anulada">Anulada</span>
              : <button className="btn-secondary" onClick={() => setAnular(c)}><Ban size={13} /> Anular</button>}</td>
          </tr>))}</tbody>
      </table></div>)}
    <Pie total={datos.total} offset={f.offset} set={setF} f={f} />
    {anular && <AnularSheet compra={anular} addToast={addToast} onClose={() => setAnular(null)}
      onDone={async () => { setRevision(r => r + 1); if (onChanged) await onChanged(); }} />}
  </>);
}

const TABS = [['acciones', 'Quién hizo qué'], ['cambios', 'Cambios (antes y después)'], ['inventario', 'Movimientos de inventario'], ['compras', 'Compras y altas']];

export default function BitacoraSection({ addToast, onChanged }) {
  const [tab, setTab] = useState('acciones');
  return (<>
    <div className="bitacora-tabs">
      {TABS.map(([id, nombre]) => <button key={id} className={`option-chip ${tab === id ? 'selected' : ''}`} onClick={() => setTab(id)}>{nombre}</button>)}
    </div>
    {tab === 'acciones' && <Acciones />}
    {tab === 'cambios' && <Cambios />}
    {tab === 'inventario' && <Inventario />}
    {tab === 'compras' && <Compras addToast={addToast} onChanged={onChanged} />}
  </>);
}
