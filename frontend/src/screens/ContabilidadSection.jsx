// CONTABILIDAD Y MAYORDOMÍA (Admin). Cuatro pestañas:
//   * Estado de resultados: ventas − costo de ventas − gastos = utilidad neta,
//     diezmo y ofrenda del mes, flujo de dinero por cuenta y cierre del mes.
//   * Egresos: todo lo que sale de dinero (gastos fijos del mes, por pagar,
//     movimientos, traspasos caja ↔ banco).
//   * Mayordomía: el año completo — utilidad, diezmo/ofrenda calculados,
//     entregados y pendientes; registro de cada entrega.
//   * Cuentas: catálogo de cuentas, saldos de Caja/Banco y porcentajes.
import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Receipt, HeartHandshake, Landmark, Plus, Pencil, Lock, LockOpen, ArrowRightLeft,
  Check, AlertTriangle, Trash2, ChevronLeft, ChevronRight, HandCoins, Wallet,
} from 'lucide-react';
import * as api from '../api/client.js';
import { money, unidadDisplay } from '../lib/helpers.js';
import { Sheet, EmptyState, FormError } from '../components/ui.jsx';

const GRUPO_LABELS = {
  costo_ventas: 'Costo de ventas', gasto_operacion: 'Gastos de operación', gasto_financiero: 'Gastos financieros',
  impuesto: 'Impuestos', inventario: 'Compra de insumos (inventario)', inversion: 'Inversiones en equipo',
  retiro: 'Retiros del dueño', diezmo_ofrenda: 'Diezmos y ofrendas',
};
const GRUPOS_ORDEN = ['gasto_operacion', 'gasto_financiero', 'impuesto', 'costo_ventas', 'inventario', 'inversion', 'retiro', 'diezmo_ofrenda'];
const AFECTA = new Set(['costo_ventas', 'gasto_operacion', 'gasto_financiero', 'impuesto']);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const hoyMx = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
const nombreMes = p => { const [a, m] = p.split('-'); return `${MESES[Number(m) - 1]} ${a}`; };
const mesSiguiente = (p, d) => { const [a, m] = p.split('-').map(Number); const x = new Date(Date.UTC(a, m - 1 + d, 1)); return x.toISOString().slice(0, 7); };
const fmtFecha = f => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '');
const signo = n => (Number(n) < 0 ? `−${money(Math.abs(n))}` : money(n));

/* ---------- Selector de mes ---------- */
export function MesPicker({ value, onChange, max }) {
  return (
    <div className="mes-picker">
      <button type="button" className="icon-btn small" aria-label="Mes anterior" onClick={() => onChange(mesSiguiente(value, -1))}><ChevronLeft size={16} /></button>
      <input type="month" className="text-input" value={value} max={max} onChange={e => e.target.value && onChange(e.target.value)} />
      <button type="button" className="icon-btn small" aria-label="Mes siguiente" disabled={max ? value >= max : false} onClick={() => onChange(mesSiguiente(value, 1))}><ChevronRight size={16} /></button>
    </div>
  );
}

/* ---------- ¿Con qué se pagó? (caja / banco / por pagar) ---------- */
export function PagoPicker({ cuentas, value, onChange, permitirPorPagar = true, hint }) {
  // value: { cuentaDineroId: number|null, pagado: boolean }
  return (
    <div className="option-group">
      <div className="option-label">¿Con qué se pagó?</div>
      <div className="option-row">
        {cuentas.map(c => (
          <button key={c.id} type="button" className={`option-chip ${value.pagado && value.cuentaDineroId === c.id ? 'selected' : ''}`} onClick={() => onChange({ cuentaDineroId: c.id, pagado: true })}>
            {c.tipo === 'efectivo' ? '💵' : '🏦'} {c.nombre}
          </button>
        ))}
        {permitirPorPagar && (
          <button type="button" className={`option-chip ${!value.pagado ? 'selected' : ''}`} onClick={() => onChange({ cuentaDineroId: null, pagado: false })}>Queda por pagar</button>
        )}
      </div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function SelectCuenta({ cuentas, value, onChange, soloUtilidad = false, excluir = [] }) {
  const grupos = GRUPOS_ORDEN.filter(g => !excluir.includes(g) && (!soloUtilidad || AFECTA.has(g)));
  return (
    <select className="text-input" value={value || ''} onChange={e => onChange(Number(e.target.value))}>
      <option value="">Elige la cuenta…</option>
      {grupos.map(g => {
        const lista = cuentas.filter(c => c.grupo === g && c.activo !== false);
        if (!lista.length) return null;
        return <optgroup key={g} label={`${GRUPO_LABELS[g]}${AFECTA.has(g) ? '' : ' · no baja la utilidad'}`}>{lista.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</optgroup>;
      })}
    </select>
  );
}

/* ================================================================
   SECCIÓN PRINCIPAL
   ================================================================ */
export default function ContabilidadSection({ addToast, esGeneral, sedeNombre, proveedores = [] }) {
  const hoy = hoyMx();
  const [tab, setTab] = useState('resultados');
  const [periodo, setPeriodo] = useState(hoy.slice(0, 7));
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)));
  const [cuentas, setCuentas] = useState([]);
  const [dinero, setDinero] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [version, setVersion] = useState(0);
  const recargarBase = useCallback(async () => {
    try {
      const [c, d, k] = await Promise.all([api.getCuentasContables(), api.getCuentasDinero(), api.getContabilidadConfig()]);
      setCuentas(c); setDinero(d); setCfg(k);
    } catch (e) { addToast(e.message, 'warn'); }
  }, [addToast]);
  useEffect(() => { recargarBase(); }, [recargarBase]);
  const cambio = useCallback(async () => { setVersion(v => v + 1); await recargarBase(); }, [recargarBase]);

  const tabs = [
    { id: 'resultados', label: 'Estado de resultados', Icon: BookOpen },
    { id: 'egresos', label: 'Egresos', Icon: Receipt },
    { id: 'mayordomia', label: 'Mayordomía', Icon: HeartHandshake },
    { id: 'cuentas', label: 'Cuentas', Icon: Landmark },
  ];
  return (
    <div>
      <div className="conta-head">
        <div className="cat-tabs conta-tabs">
          {tabs.map(t => <button key={t.id} className={`cat-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}><t.Icon size={15} /> {t.label}</button>)}
        </div>
        {(tab === 'resultados' || tab === 'egresos') && <MesPicker value={periodo} onChange={setPeriodo} max={hoy.slice(0, 7)} />}
        {tab === 'mayordomia' && (
          <div className="mes-picker">
            <button type="button" className="icon-btn small" aria-label="Año anterior" onClick={() => setAnio(a => a - 1)}><ChevronLeft size={16} /></button>
            <strong style={{ minWidth: 48, textAlign: 'center' }}>{anio}</strong>
            <button type="button" className="icon-btn small" aria-label="Año siguiente" disabled={anio >= Number(hoy.slice(0, 4))} onClick={() => setAnio(a => a + 1)}><ChevronRight size={16} /></button>
          </div>
        )}
      </div>
      {cfg && !cfg.contabilidadInicio && (
        <div className="promo-summary-card" style={{ borderColor: 'var(--warn)' }}>
          <AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Define en <strong>Cuentas</strong> desde qué fecha cuenta la contabilidad y el saldo inicial de Caja y Banco; sin eso los saldos arrancan en cero.
        </div>
      )}
      {tab === 'resultados' && <ResultadosTab periodo={periodo} version={version} esGeneral={esGeneral} sedeNombre={sedeNombre} addToast={addToast} onChanged={cambio} />}
      {tab === 'egresos' && <EgresosTab periodo={periodo} version={version} cuentas={cuentas} dinero={dinero} proveedores={proveedores} addToast={addToast} onChanged={cambio} />}
      {tab === 'mayordomia' && <MayordomiaTab anio={anio} version={version} cuentas={cuentas} dinero={dinero} cfg={cfg} addToast={addToast} onChanged={cambio} />}
      {tab === 'cuentas' && <CuentasTab cuentas={cuentas} dinero={dinero} cfg={cfg} addToast={addToast} onChanged={cambio} />}
    </div>
  );
}

/* ================================================================
   ESTADO DE RESULTADOS
   ================================================================ */
function Fila({ label, value, sub, total, neta, negativo, detalle }) {
  const n = Number(value);
  return (
    <div className={`er-row ${sub ? 'sub' : ''} ${total ? 'total' : ''} ${neta ? 'neta' : ''}`}>
      <span className="er-label">{label}{detalle && <span className="er-detalle"> {detalle}</span>}</span>
      <span className={`er-value ${n < 0 ? 'rojo' : ''}`}>{negativo && n > 0 ? `− ${money(n)}` : signo(n)}</span>
    </div>
  );
}

function ResultadosTab({ periodo, version, esGeneral, sedeNombre, addToast, onChanged }) {
  const [er, setEr] = useState(null);
  const [flujo, setFlujo] = useState(null);
  const [consolidado, setConsolidado] = useState(false);
  const [cons, setCons] = useState(null);
  const [verGastos, setVerGastos] = useState(false);
  const [verCosto, setVerCosto] = useState(false);
  // Desglose de egresos del mes (se carga al abrir el primero): de dónde sale cada cantidad.
  const [egMes, setEgMes] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const abrir = async grupo => {
    setAbierto(a => (a === grupo ? null : grupo));
    if (egMes === null) { try { setEgMes(await api.getEgresos({ periodo })); } catch (e) { setEgMes([]); } }
  };
  useEffect(() => { setEgMes(null); setAbierto(null); }, [periodo, version]);
  const [busy, setBusy] = useState(false);
  const [reabrir, setReabrir] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try {
      if (consolidado) { setCons(await api.getEstadoConsolidado(periodo)); return; }
      const [e, f] = await Promise.all([api.getEstadoResultados(periodo), api.getFlujoDinero(periodo)]);
      setEr(e); setFlujo(f);
    } catch (e) { setError(e.message); }
  }, [periodo, consolidado]);
  useEffect(() => { cargar(); }, [cargar, version]);

  const cerrar = async () => {
    if (!window.confirm(`¿Cerrar ${nombreMes(periodo)}? Ya no se podrán registrar ni cambiar egresos de ese mes (podrás reabrirlo con un motivo).`)) return;
    setBusy(true);
    try { await api.cerrarMes(periodo); addToast(`${nombreMes(periodo)} cerrado`, 'success'); await onChanged(); }
    catch (e) { addToast(e.message, 'warn'); } finally { setBusy(false); }
  };
  const confirmarReabrir = async () => {
    if (motivo.trim().length < 3) { setError('Escribe el motivo de la reapertura.'); return; }
    setBusy(true);
    try { await api.reabrirMes(periodo, motivo.trim()); addToast(`${nombreMes(periodo)} reabierto`, 'success'); setReabrir(false); setMotivo(''); await onChanged(); }
    catch (e) { addToast(e.message, 'warn'); } finally { setBusy(false); }
  };

  if (error) return <EmptyState icon={AlertTriangle} title="No se pudo cargar el estado de resultados" subtitle={error} />;

  if (consolidado) {
    return (
      <div>
        {esGeneral && <button className="link-toggle" onClick={() => setConsolidado(false)}>Ver solo {sedeNombre || 'la sede activa'}</button>}
        {!cons ? <EmptyState icon={BookOpen} title="Cargando consolidado…" /> : (
          <div className="admin-columns">
            <div>
              <div className="section-title"><BookOpen size={15} /> Todas las sedes · {nombreMes(periodo)}</div>
              <div className="er-table">
                <Fila label="Ventas" value={cons.ventas} />
                <Fila label="Costo de ventas" value={cons.costoVentas} negativo />
                <Fila label="Utilidad bruta" value={cons.utilidadBruta} total />
                <Fila label="Gastos de operación" value={cons.gastosOperacion} negativo />
                <Fila label="Gastos financieros" value={cons.gastosFinancieros} negativo />
                <Fila label="Impuestos" value={cons.impuestos} negativo />
                <Fila label="Utilidad neta" value={cons.utilidadNeta} neta />
                <Fila label="Diezmo calculado" value={cons.mayordomia.diezmo} sub />
                <Fila label="Ofrenda calculada" value={cons.mayordomia.ofrenda} sub />
              </div>
            </div>
            <div>
              <div className="section-title">Por sede</div>
              {cons.sedes.map(s => (
                <div key={s.sucursalId} className="reporte-row"><span>{s.sucursal}{s.cerrado ? ' · cerrado' : ''}</span><span className={`turno-amount ${s.utilidadNeta < 0 ? 'rojo' : ''}`}>{signo(s.utilidadNeta)}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
  if (!er || !flujo) return <EmptyState icon={BookOpen} title="Cargando estado de resultados…" />;
  const m = er.mayordomia;
  const gastosDetalle = er.cuentas.filter(c => c.grupo === 'gasto_operacion');
  return (
    <div className="admin-columns">
      <div>
        <div className="section-title"><BookOpen size={15} /> Estado de resultados · {er.nombre}{er.cerrado && <span className="pill-cerrado"><Lock size={11} /> Mes cerrado</span>}</div>
        {esGeneral && <button className="link-toggle" style={{ marginBottom: 8 }} onClick={() => setConsolidado(true)}>Ver consolidado de todas las sedes</button>}
        <div className="er-table">
          <Fila label="Ventas cobradas" value={er.ventas.total} detalle={`· ${er.ventas.pedidos} pedido(s)`} />
          <Fila label="En efectivo" value={er.ventas.efectivo} sub />
          <Fila label="Tarjeta y transferencia" value={er.ventas.banco} sub />
          {er.ventas.cortesiasValor > 0 && <div className="er-row sub"><span className="er-label">Cortesías regaladas (no suman)</span><span className="er-value faint">{money(er.ventas.cortesiasValor)}</span></div>}
          <div className="er-row">
            <span className="er-label">Costo de ventas <span className="er-detalle">· insumos consumidos</span> <button type="button" className="link-toggle" onClick={() => setVerCosto(v => !v)}>{verCosto ? 'ocultar' : 'ver detalle'}</button></span>
            <span className="er-value">− {money(er.costoVentas.total)}</span>
          </div>
          {verCosto ? <CostoVentasDetalle cv={er.costoVentas} /> : (
            <>
              {(er.costoVentas.consumoInterno || 0) !== 0 && <Fila label="de los cuales consumibles de mesa y uso interno" value={er.costoVentas.consumoInterno} sub />}
              {er.costoVentas.mermas !== 0 && <Fila label="de los cuales mermas" value={er.costoVentas.mermas} sub />}
              {(er.costoVentas.ajustesConteo ?? er.costoVentas.ajustes) !== 0 && <Fila label="de los cuales ajustes de inventario (conteo físico)" value={er.costoVentas.ajustesConteo ?? er.costoVentas.ajustes} sub />}
            </>
          )}
          <Fila label="Utilidad bruta" value={er.utilidadBruta} total />
          <div className="er-row">
            <span className="er-label">Gastos de operación {gastosDetalle.length > 0 && <button type="button" className="link-toggle" onClick={() => setVerGastos(v => !v)}>{verGastos ? 'ocultar' : 'ver detalle'}</button>}</span>
            <span className="er-value">− {money(er.gastosOperacion)}</span>
          </div>
          {verGastos && gastosDetalle.map(c => <Fila key={c.id} label={c.nombre} value={c.monto} sub detalle={c.porPagar > 0 ? `· ${money(c.porPagar)} por pagar` : ''} />)}
          {verGastos && (
            <div className="er-row sub"><span className="er-label"><button type="button" className="link-toggle" onClick={() => abrir('gasto_operacion')}>{abierto === 'gasto_operacion' ? 'ocultar cada egreso' : 'ver cada egreso'}</button></span><span /></div>
          )}
          {verGastos && abierto === 'gasto_operacion' && <DetalleEgresos egresos={egMes} grupo="gasto_operacion" total={er.gastosOperacion} periodo={periodo} titulo="Gastos de operación" />}
          <Fila label="Utilidad de operación" value={er.utilidadOperacion} total />
          <Fila label="Gastos financieros (préstamo, intereses)" value={er.gastosFinancieros} negativo />
          <Fila label="Impuestos" value={er.impuestos} negativo />
          <Fila label="Utilidad neta" value={er.utilidadNeta} neta detalle={er.utilidadNeta >= 0 && er.margenNeto !== null ? `· ${er.margenNeto}% de las ventas` : (er.utilidadNeta < 0 ? '· el mes cerró con pérdida' : '')} />
        </div>
        <VentasSinCosto cv={er.costoVentas} />

        <div className="section-title"><HeartHandshake size={15} /> Mayordomía de {er.nombre}</div>
        <div className="mayordomia-card">
          <div><span className="kpi-label">Base (utilidad neta)</span><strong>{money(m.base)}</strong>{er.utilidadNeta < 0 && <span className="field-hint">Mes con pérdida: no hay aumento que diezmar.</span>}</div>
          <div><span className="kpi-label">Diezmo ({m.diezmoPorcentaje}%)</span><strong className="brand">{money(m.diezmo)}</strong><span className="field-hint">entregado {money(m.diezmoEntregado)}{m.diezmoPendiente > 0 ? ` · faltan ${money(m.diezmoPendiente)}` : m.diezmoPendiente < 0 ? ` · ${money(-m.diezmoPendiente)} de más` : ' · al corriente'}</span></div>
          <div><span className="kpi-label">Ofrenda ({m.ofrendaPorcentaje}%)</span><strong className="brand">{money(m.ofrenda)}</strong><span className="field-hint">entregada {money(m.ofrendaEntregada)}{m.ofrendaPendiente > 0 ? ` · faltan ${money(m.ofrendaPendiente)}` : m.ofrendaPendiente < 0 ? ` · ${money(-m.ofrendaPendiente)} de más` : ' · al corriente'}</span></div>
          <div><span className="kpi-label">Queda para el negocio</span><strong>{signo(m.utilidadDespues)}</strong><span className="field-hint">utilidad neta menos diezmo y ofrenda</span></div>
        </div>

        <div className="section-title"><Wallet size={15} /> Otras salidas del mes (no bajan la utilidad)</div>
        <div className="er-table">
          {[['inventario', 'Compra de insumos (entra al inventario)', er.otrasSalidas.inventario],
            ['inversion', 'Inversiones en equipo', er.otrasSalidas.inversion],
            ['retiro', 'Retiros del dueño', er.otrasSalidas.retiros],
            ['diezmo_ofrenda', 'Diezmos y ofrendas entregados', er.otrasSalidas.diezmoOfrenda]].map(([grupo, label, valor]) => (
            <React.Fragment key={grupo}>
              <div className="er-row">
                <span className="er-label">{label} {valor > 0 && <button type="button" className="link-toggle" onClick={() => abrir(grupo)}>{abierto === grupo ? 'ocultar' : 'ver detalle'}</button>}</span>
                <span className="er-value">{signo(valor)}</span>
              </div>
              {abierto === grupo && <DetalleEgresos egresos={egMes} grupo={grupo} total={valor} periodo={periodo} titulo={label} porInsumo={grupo === 'inventario'} />}
            </React.Fragment>
          ))}
        </div>
        {er.otrasSalidas.inventario > 0 && (
          <div className="promo-summary-card">
            <strong>¿Dónde quedó lo que compraste?</strong>
            <div className="flujo-grid" style={{ marginTop: 6 }}>
              <span>Compraste de insumos en {er.nombre}</span><span>{money(er.otrasSalidas.inventario)}</span>
              <span>− Salió del almacén (costo de ventas)</span><span>{money(er.costoVentas.total)}</span>
              <span><strong>{er.otrasSalidas.inventario - er.costoVentas.total >= 0 ? '= Se quedó de más en el almacén' : '= Se usó de lo que ya había'}</strong></span><span><strong>{money(Math.abs(er.otrasSalidas.inventario - er.costoVentas.total))}</strong></span>
            </div>
            <div className="field-hint" style={{ marginTop: 6 }}>
              {er.otrasSalidas.inventario - er.costoVentas.total >= 0
                ? 'Compraste más de lo que se consumió: la diferencia no se perdió, es mercancía que sigue en tu almacén (el siguiente mes se consume y ya no habrá que comprarla).'
                : 'Se consumió más de lo que compraste: se usó inventario que ya tenías de antes.'}
              {' '}Valor de todo tu inventario hoy, a su costo: <strong>{money(er.inventarioHoy?.valor || 0)}</strong> ({er.inventarioHoy?.insumos || 0} insumos con existencia). Compáralo con un conteo físico.
            </div>
          </div>
        )}
      </div>
      <div>
        <div className="section-title"><Landmark size={15} /> Flujo de dinero · {flujo.nombre}</div>
        {flujo.cuentas.map(c => (
          <div key={c.id} className="flujo-card">
            <div className="flujo-head"><span>{c.tipo === 'efectivo' ? '💵' : '🏦'} {c.nombre}</span><strong className={c.saldoFinMes < 0 ? 'rojo' : ''}>{signo(c.saldoFinMes)}</strong></div>
            <div className="flujo-grid">
              <span>Saldo al inicio del mes</span><span>{signo(c.saldoInicioMes)}</span>
              <span>+ Ventas cobradas</span><span>{money(c.ventas)}</span>
              {c.traspasosEntrada > 0 && <><span>+ Traspasos recibidos</span><span>{money(c.traspasosEntrada)}</span></>}
              <span>− Egresos pagados</span><span>{money(c.egresos)}</span>
              {c.traspasosSalida > 0 && <><span>− Traspasos enviados</span><span>{money(c.traspasosSalida)}</span></>}
            </div>
            {!c.fechaSaldoInicial && <div className="field-hint">Sin fecha de saldo inicial: los movimientos anteriores no cuentan. Defínela en Cuentas.</div>}
          </div>
        ))}
        {flujo.porPagar.n > 0 && <div className="promo-summary-card">Por pagar (todas las fechas): <strong>{money(flujo.porPagar.monto)}</strong> en {flujo.porPagar.n} egreso(s). Se registran como gasto del mes al que pertenecen y salen del dinero cuando los marques pagados.</div>}
        {flujo.pagadosSinCuenta.n > 0 && <div className="promo-summary-card" style={{ borderColor: 'var(--warn)' }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {flujo.pagadosSinCuenta.n} egreso(s) pagados por {money(flujo.pagadosSinCuenta.monto)} sin cuenta de dinero: edítalos en Egresos para que Caja/Banco cuadren.</div>}
        {er.ventas.pagosSinDesglose > 0 && <div className="field-hint">{er.ventas.pagosSinDesglose} pago(s) mixto(s) antiguos sin desglose se tomaron como banco.</div>}

        <div className="section-title"><Lock size={15} /> Cierre del mes</div>
        {er.cerrado ? (
          <div className="promo-summary-card">
            {nombreMes(periodo)} está cerrado: sus números quedaron congelados y no se admiten cambios.
            {!reabrir ? <div style={{ marginTop: 8 }}><button className="btn-secondary" onClick={() => setReabrir(true)}><LockOpen size={14} /> Reabrir mes</button></div> : (
              <div style={{ marginTop: 8 }}>
                <input className="text-input" placeholder="Motivo de la reapertura" value={motivo} onChange={e => setMotivo(e.target.value)} />
                <FormError>{error}</FormError>
                <div className="option-row" style={{ marginTop: 8 }}>
                  <button className="btn-primary" disabled={busy} onClick={confirmarReabrir}>Confirmar reapertura</button>
                  <button className="btn-ghost" onClick={() => { setReabrir(false); setMotivo(''); }}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="promo-summary-card">
            Cuando ya registraste todos los gastos y compras de {nombreMes(periodo)}, ciérralo: el estado de resultados y el diezmo quedan fijos y nadie puede mover un egreso de ese mes sin reabrirlo con motivo.
            <div style={{ marginTop: 8 }}><button className="btn-primary" disabled={busy} onClick={cerrar}><Lock size={14} /> Cerrar {nombreMes(periodo)}</button></div>
            {periodo === hoyMx().slice(0, 7) && <div className="field-hint">Este mes todavía está en curso: conviene cerrarlo cuando termine.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Cada egreso detrás de una cifra del estado de resultados ----------
   Suma exactamente lo mismo que la línea (mismo mes por fecha del egreso, sin
   anulados). Para compras de insumos agrupa por insumo y permite bajar CSV. */
const fmtCant = (n, u) => `${Number(Number(n).toFixed(3)).toLocaleString('es-MX')} ${unidadDisplay(u)}`;
function descargarCsv(nombre, filas) {
  const esc = v => { const t = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = '\uFEFF' + filas.map(f => f.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function DetalleEgresos({ egresos, grupo, total, periodo, titulo, porInsumo = false }) {
  const [verCada, setVerCada] = useState(!porInsumo);
  if (egresos === null) return <div className="er-row sub"><span className="er-label">Cargando…</span><span /></div>;
  const lista = egresos.filter(e => e.grupo === grupo);
  const suma = Math.round(lista.reduce((t, e) => t + Number(e.monto), 0) * 100) / 100;
  const cuadra = Math.abs(suma - Number(total)) < 0.005;
  const pago = e => (e.pagado ? (e.cuenta_dinero_nombre || 'pagado sin cuenta') : 'por pagar');
  const grupos = porInsumo ? Object.values(lista.reduce((acc, e) => {
    const k = e.lote_materia_id || `c:${e.concepto}`;
    const g = acc[k] || (acc[k] = { nombre: e.lote_insumo || e.concepto, unidad: e.lote_unidad, cantidad: 0, monto: 0, compras: 0, porPagar: 0 });
    g.cantidad += Number(e.lote_cantidad || 0); g.monto += Number(e.monto); g.compras += 1; if (!e.pagado) g.porPagar += Number(e.monto);
    return acc;
  }, {})).sort((a, b) => b.monto - a.monto) : [];
  const csv = () => descargarCsv(`${grupo}-${periodo}.csv`, [
    ['Fecha', 'Concepto', 'Insumo', 'Cantidad', 'Unidad', 'Proveedor', 'Cuenta', 'Pago', 'Referencia', 'Monto'],
    ...lista.map(e => [e.fecha, e.concepto, e.lote_insumo || '', e.lote_cantidad ? Number(Number(e.lote_cantidad).toFixed(3)) : '', e.lote_unidad || '', e.proveedor_nombre || '', e.cuenta_nombre, pago(e), e.referencia || '', Number(e.monto).toFixed(2)]),
    ['', 'TOTAL', '', '', '', '', '', '', '', suma.toFixed(2)],
  ]);
  return (
    <div className="er-detalle-box">
      {porInsumo && (
        <>
          <div className="er-detalle-head"><span>Por insumo · {grupos.length} insumo(s), {lista.length} compra(s)</span><span /></div>
          {grupos.map(g => (
            <div key={g.nombre} className="er-row sub">
              <span className="er-label">{g.nombre}<span className="er-detalle"> · {g.cantidad > 0 && g.unidad ? `${fmtCant(g.cantidad, g.unidad)} · ` : ''}{g.compras} compra(s){g.porPagar > 0 ? ` · ${money(g.porPagar)} por pagar` : ''}</span></span>
              <span className="er-value">{money(g.monto)}</span>
            </div>
          ))}
          <div className="er-row sub"><span className="er-label"><button type="button" className="link-toggle" onClick={() => setVerCada(v => !v)}>{verCada ? 'ocultar cada compra' : 'ver cada compra (fecha, proveedor, pago)'}</button></span><span /></div>
        </>
      )}
      {verCada && lista.map(e => (
        <div key={e.id} className="er-row sub">
          <span className="er-label">{fmtFecha(e.fecha)} · {e.concepto}<span className="er-detalle">{e.proveedor_nombre ? ` · ${e.proveedor_nombre}` : ''} · {pago(e)}{e.referencia ? ` · ref. ${e.referencia}` : ''}</span></span>
          <span className="er-value">{money(e.monto)}</span>
        </div>
      ))}
      <div className="er-row sub er-detalle-total">
        <span className="er-label"><span className={cuadra ? 'ok' : 'warn'}>{cuadra ? <Check size={12} style={{ verticalAlign: -1 }} /> : <AlertTriangle size={12} style={{ verticalAlign: -1 }} />} {cuadra ? `Suman ${lista.length} egreso(s) = la cifra de “${titulo}”` : `Suman ${money(suma)}; la cifra dice ${money(total)}`}</span> <button type="button" className="link-toggle" onClick={csv}>descargar CSV</button></span>
        <span className="er-value">{money(suma)}</span>
      </div>
    </div>
  );
}

/* ---------- De dónde sale el costo de ventas ----------
   Todo es inventario que salió del almacén este mes, valuado a lo que costó. */
function CostoVentasDetalle({ cv }) {
  const lineas = [
    { label: 'Insumos de lo vendido', value: cv.consumoVentas ?? cv.consumo,
      hint: 'Lo que marcan las recetas de cada producto terminado (menos lo que regresó al almacén por tickets cancelados o devueltos).' },
    { label: 'Consumibles de mesa y uso interno', value: cv.consumoInterno || 0,
      hint: 'Azúcar, salsas, servilletas… lo que surtes en mesas, más consumo del personal. Se registra en Inventario → “Surtir” cada vez que rellenas.' },
    { label: 'Mermas', value: cv.mermas, hint: 'Desperdicio que sí se anotó: se cayó, se echó a perder, salió mal y se tiró.' },
    { label: 'Ajustes de inventario (conteo físico)', value: cv.ajustesConteo ?? cv.ajustes,
      hint: 'La diferencia cuando cuentas lo que hay y no coincide con el sistema. Positivo = faltó producto (salió sin registrarse); negativo = sobró.' },
    ...(cv.manual ? [{ label: 'Capturado como egreso de costo de ventas', value: cv.manual, hint: 'Egresos registrados directamente en una cuenta de costo de ventas.' }] : []),
  ];
  return (
    <>
      {lineas.map(l => (
        <div key={l.label} className="er-row sub">
          <span className="er-label">{l.label}<span className="field-hint" style={{ display: 'block', fontWeight: 500 }}>{l.hint}</span></span>
          <span className="er-value">{signo(l.value)}</span>
        </div>
      ))}
      <div className="er-row sub costo-explica">
        <span className="er-label">
          <strong>¿Qué significa un ajuste?</strong> El sistema sabe cuánto debería quedar de cada insumo (compras − recetas − mermas − surtidos).
          Cuando cuentas y hay <em>menos</em>, esa diferencia es producto que salió sin quedar registrado y su costo entra aquí como ajuste.
          Causas comunes: consumibles de mesa que no se registraron, recetas que usan menos de lo que realmente se sirve, desperdicio no anotado, o faltantes.
          Un ajuste pequeño es normal; si crece mes con mes, revisa recetas y registra los surtidos y mermas.
          <span className="field-hint" style={{ display: 'block', fontWeight: 500, marginTop: 4 }}>No mueve el dinero de Caja ni de Banco: ese dinero salió cuando compraste el insumo. Lo que cambia es la utilidad (y el diezmo) y el valor del inventario.</span>
        </span>
      </div>
    </>
  );
}

/* ---------- Ventas cobradas que todavía no traen su costo ----------
   El inventario (y con él el costo de ventas) se descuenta cuando la línea
   pasa a "Terminado". Si se cobró pero sigue pendiente, la venta ya suma y el
   costo todavía no; si se terminó sin receta, el costo nunca llegará. */
function VentasSinCosto({ cv }) {
  const [ver, setVer] = useState(null);
  const bloques = [
    { id: 'sinTerminar', d: cv.sinTerminar, titulo: 'cobrados que siguen pendientes o en preparación',
      texto: 'Ya suman en ventas, pero su costo entra hasta que barra o parrilla los marca “Terminado”. Si ya se entregaron, termínalos en la comanda para que el costo y el inventario cuadren.' },
    { id: 'sinReceta', d: cv.sinReceta, titulo: 'terminados sin costo de insumos',
      texto: 'Productos sin receta, con insumos a $0 o conceptos libres sin insumo: su costo nunca se registrará y la utilidad sale más alta de lo real. Agrega la receta o el costo en Productos / Inventario.' },
  ].filter(b => b.d && b.d.lineas > 0);
  if (!bloques.length) return null;
  return bloques.map(b => (
    <div key={b.id} className="promo-summary-card" style={{ borderColor: 'var(--warn)' }}>
      <AlertTriangle size={13} style={{ verticalAlign: -2, color: 'var(--warn)' }} /> <strong>{money(b.d.venta)}</strong> de ventas sin costo: {b.d.unidades} producto(s) {b.titulo}.
      <div className="field-hint">{b.texto}</div>
      <button type="button" className="link-toggle" onClick={() => setVer(v => (v === b.id ? null : b.id))}>{ver === b.id ? 'ocultar' : 'ver cuáles'}</button>
      {ver === b.id && (
        <div className="er-table" style={{ marginTop: 6 }}>
          {b.d.productos.map(x => (
            <div key={x.producto} className="er-row sub"><span className="er-label">{x.producto} · {x.unidades} u. en {x.pedidos} pedido(s) · desde {fmtFecha(x.desde)}</span><span className="er-value">{money(x.venta)}</span></div>
          ))}
          {b.d.lineas > b.d.productos.length && <div className="er-row sub"><span className="er-label">… y {b.d.lineas - b.d.productos.length} producto(s) más</span><span /></div>}
        </div>
      )}
    </div>
  ));
}

/* ================================================================
   EGRESOS
   ================================================================ */
function EgresosTab({ periodo, version, cuentas, dinero, proveedores, addToast, onChanged }) {
  const [egresos, setEgresos] = useState(null);
  const [recurrentes, setRecurrentes] = useState([]);
  const [porPagar, setPorPagar] = useState([]);
  const [traspasos, setTraspasos] = useState([]);
  const [sheet, setSheet] = useState(null); // { tipo: 'egreso'|'recurrente'|'pagar'|'traspaso', item }
  const [filtro, setFiltro] = useState('todos');
  // ¿De dónde salió el dinero? 'todos' | id de cuenta de dinero | 'por_pagar' | 'sin_cuenta'
  const [origen, setOrigen] = useState('todos');
  const [pagadosMes, setPagadosMes] = useState([]);
  const [flujo, setFlujo] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const [e, r, p, t, pm, f] = await Promise.all([api.getEgresos({ periodo }), api.getRecurrentes(periodo), api.getEgresos({ pendientes: true }), api.getTraspasos(periodo), api.getEgresos({ pagadoPeriodo: periodo }), api.getFlujoDinero(periodo)]);
      setEgresos(e); setRecurrentes(r); setPorPagar(p); setTraspasos(t); setPagadosMes(pm); setFlujo(f);
    } catch (e) { addToast(e.message, 'warn'); }
  }, [periodo, addToast]);
  useEffect(() => { cargar(); }, [cargar, version]);

  const guardar = async (fn, msg) => {
    try { await fn(); addToast(msg, 'success'); await cargar(); await onChanged(); return true; }
    catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const anular = async e => {
    const motivo = window.prompt(`¿Anular "${e.concepto}" por ${money(e.monto)}? Escribe el motivo:`);
    if (motivo === null) return;
    await guardar(() => api.anularEgreso(e.id, motivo), 'Egreso anulado');
  };
  const pendientes = recurrentes.filter(r => !r.registrado);
  const suma = arr => Math.round(arr.reduce((s, e) => s + Number(e.monto), 0) * 100) / 100;
  const cuentasDinero = dinero.filter(d => d.activo !== false);
  const sinCuenta = pagadosMes.filter(e => !e.cuenta_dinero_id);
  const origenes = [
    { id: 'todos', label: 'Todos', icono: '', lista: egresos || [] },
    ...cuentasDinero.map(d => ({ id: d.id, label: d.nombre.replace(/\s*\(.*\)\s*$/, '') || d.nombre, icono: d.tipo === 'efectivo' ? '💵 ' : '🏦 ', cuenta: d, lista: pagadosMes.filter(e => e.cuenta_dinero_id === d.id) })),
    { id: 'por_pagar', label: 'Por pagar', icono: '⏳ ', lista: porPagar },
    ...(sinCuenta.length ? [{ id: 'sin_cuenta', label: 'Pagados sin cuenta', icono: '⚠️ ', lista: sinCuenta }] : []),
  ];
  const origenSel = origenes.find(o => o.id === origen) || origenes[0];
  const lista = origenSel.lista.filter(e => filtro === 'todos' || (filtro === 'utilidad' ? e.afecta_utilidad : e.grupo === filtro));
  const totalLista = suma(lista);
  const totalMes = suma(egresos || []);
  const totalUtilidad = suma((egresos || []).filter(e => e.afecta_utilidad));
  // Contra qué número del estado de resultados debe cuadrar el filtro elegido.
  const referencia = (() => {
    if (!flujo || filtro !== 'todos') return null;
    if (origenSel.cuenta) {
      const c = flujo.cuentas.find(x => x.id === origenSel.cuenta.id);
      return c ? { monto: c.egresos, texto: `“− Egresos pagados” de ${c.nombre} en el Flujo de dinero` } : null;
    }
    if (origen === 'por_pagar') return { monto: flujo.porPagar.monto, texto: '“Por pagar (todas las fechas)” del Flujo de dinero' };
    if (origen === 'sin_cuenta') return { monto: flujo.pagadosSinCuenta.monto, texto: 'el aviso de pagados sin cuenta del Flujo de dinero' };
    return null;
  })();
  const descripcionOrigen = origenSel.cuenta
    ? `Pagados desde ${origenSel.cuenta.nombre} en ${nombreMes(periodo)} (por fecha de pago, aunque el gasto sea de otro mes).`
    : origen === 'por_pagar' ? 'Todo lo que falta pagar, de cualquier mes. Todavía no sale de Caja ni de Banco.'
      : origen === 'sin_cuenta' ? `Pagados en ${nombreMes(periodo)} sin decir de qué cuenta salió el dinero: edítalos para que Caja/Banco cuadren.`
        : `Registrados en ${nombreMes(periodo)} (por fecha del gasto), pagados o no.`;

  return (
    <div className="admin-columns">
      <div>
        <div className="section-title"><Receipt size={15} /> Egresos de {nombreMes(periodo)}</div>
        <div className="option-row" style={{ marginBottom: 10 }}>
          <button className="btn-primary" onClick={() => setSheet({ tipo: 'egreso', item: null })}><Plus size={15} /> Nuevo egreso</button>
          <button className="btn-secondary" onClick={() => setSheet({ tipo: 'traspaso' })}><ArrowRightLeft size={15} /> Traspaso caja ↔ banco</button>
        </div>
        <div className="promo-summary-card">Total del mes: <strong>{money(totalMes)}</strong> · de ellos bajan la utilidad: <strong>{money(totalUtilidad)}</strong>. Las compras de insumos, el equipo, los retiros y el diezmo salen del dinero pero no son gasto.</div>
        <div className="kpi-label" style={{ margin: '4px 0 6px' }}>¿De dónde salió el dinero?</div>
        <div className="cat-tabs" style={{ marginBottom: 6 }}>
          {origenes.map(o => (
            <button key={o.id} className={`cat-tab ${origen === o.id ? 'active' : ''}`} onClick={() => setOrigen(o.id)}>{o.icono}{o.label} · {money(suma(o.lista))}</button>
          ))}
        </div>
        <div className="field-hint" style={{ marginBottom: 8 }}>{descripcionOrigen}</div>
        <div className="kpi-label" style={{ margin: '4px 0 6px' }}>Tipo de egreso</div>
        <div className="cat-tabs" style={{ marginBottom: 8 }}>
          {[['todos', 'Todos'], ['utilidad', 'Bajan la utilidad'], ['gasto_operacion', 'Operación'], ['gasto_financiero', 'Financieros'], ['inventario', 'Compras de insumos'], ['inversion', 'Equipo'], ['diezmo_ofrenda', 'Diezmo y ofrenda']].map(([id, label]) => (
            <button key={id} className={`cat-tab ${filtro === id ? 'active' : ''}`} onClick={() => setFiltro(id)}>{label}</button>
          ))}
        </div>
        {egresos === null ? <EmptyState icon={Receipt} title="Cargando…" /> : lista.length === 0 ? <EmptyState icon={Receipt} title="Sin egresos con este filtro" subtitle="Registra gastos con “Nuevo egreso”; las compras de insumos llegan solas desde Inventario." /> : lista.map(e => (
          <div key={e.id} className={`egreso-row ${e.pagado ? '' : 'por-pagar'}`}>
            <div className="egreso-main">
              <div className="list-row-title">{e.concepto}</div>
              <div className="list-row-sub">
                {fmtFecha(e.fecha)} · <span className={`egreso-tag ${e.afecta_utilidad ? 'gasto' : 'otro'}`}>{e.cuenta_nombre}</span>
                {e.proveedor_nombre ? ` · ${e.proveedor_nombre}` : ''}{e.turno_id ? ' · salida de caja' : ''}{e.lote_id ? ' · compra' : ''}{e.periodo && e.grupo === 'diezmo_ofrenda' ? ` · aplica a ${nombreMes(e.periodo)}` : ''}
                {e.pagado ? (e.cuenta_dinero_nombre ? ` · ${e.cuenta_dinero_nombre}` : <span className="warn"> · sin cuenta de dinero</span>) : <span className="warn"> · por pagar</span>}
                {e.referencia ? ` · ref. ${e.referencia}` : ''}
                {e.pagado_caja_por && <div>Pagó en caja: {e.pagado_caja_por} · {fmtFecha(e.pagado_en)}{e.pago_caja_referencia ? ` · comprobante ${e.pago_caja_referencia}` : ' · sin comprobante'}{e.pago_caja_nota && <div>{e.pago_caja_nota}</div>}</div>}
              </div>
            </div>
            <strong className="egreso-monto">{money(e.monto)}</strong>
            <div className="list-row-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
              <button className="icon-btn small" onClick={() => setSheet({ tipo: 'egreso', item: e })} aria-label="Editar"><Pencil size={14} /></button>
              {!e.pagado && <button className="link-toggle" onClick={() => setSheet({ tipo: 'pagar', item: e })}>Marcar pagado</button>}
              <button className="link-danger" onClick={() => anular(e)}>Anular</button>
            </div>
          </div>
        ))}
        {egresos !== null && lista.length > 0 && (
          <div className="egresos-total">
            <div className="egresos-total-fila"><span>Total · {lista.length} egreso(s){origen !== 'todos' ? ` · ${origenSel.cuenta ? origenSel.cuenta.nombre : origenSel.label}` : ''}{filtro !== 'todos' ? ' · con el tipo elegido' : ''}</span><strong>{money(totalLista)}</strong></div>
            {referencia && (Math.abs(referencia.monto - totalLista) < 0.005
              ? <div className="egresos-cuadre ok"><Check size={13} /> Cuadra con {referencia.texto}: {money(referencia.monto)}</div>
              : <div className="egresos-cuadre warn"><AlertTriangle size={13} /> No cuadra con {referencia.texto} ({money(referencia.monto)}): diferencia de {money(Math.abs(referencia.monto - totalLista))}. Revisa la fecha de saldo inicial de la cuenta en Cuentas.</div>)}
          </div>
        )}
        {traspasos.length > 0 && (
          <>
            <div className="section-title"><ArrowRightLeft size={15} /> Traspasos del mes</div>
            {traspasos.map(t => (
              <div key={t.id} className="egreso-row">
                <div className="egreso-main"><div className="list-row-title">{t.de_nombre} → {t.a_nombre}</div><div className="list-row-sub">{fmtFecha(t.fecha)}{t.nota ? ` · ${t.nota}` : ''}</div></div>
                <strong className="egreso-monto">{money(t.monto)}</strong>
                <div className="list-row-actions"><button className="link-danger" onClick={() => window.confirm('¿Anular este traspaso?') && guardar(() => api.anularTraspaso(t.id), 'Traspaso anulado')}>Anular</button></div>
              </div>
            ))}
          </>
        )}
      </div>
      <div>
        <div className="section-title"><Check size={15} /> Gastos fijos de {nombreMes(periodo)}</div>
        {recurrentes.length === 0 ? <div className="field-hint">No hay gastos fijos activos. Se configuran en Costos (renta, sueldos, préstamo…); cada mes se proponen aquí para confirmar el pago real.</div> : (
          <>
            {pendientes.length === 0 && <div className="promo-summary-card">✅ Todos los gastos fijos del mes están registrados.</div>}
            {pendientes.map(r => (
              <div key={r.id} className="egreso-row pendiente">
                <div className="egreso-main"><div className="list-row-title">{r.concepto}</div><div className="list-row-sub">{r.cuenta_nombre || 'Sin cuenta'} · día {r.dia_pago} · presupuesto {money(r.monto_mensual)}</div></div>
                <button className="btn-secondary" onClick={() => setSheet({ tipo: 'recurrente', item: r })}>Registrar</button>
              </div>
            ))}
            {recurrentes.filter(r => r.registrado).map(r => (
              <div key={r.id} className="egreso-row registrado">
                <div className="egreso-main"><div className="list-row-title">{r.concepto}</div><div className="list-row-sub">registrado el {fmtFecha(r.egreso_fecha)} · {money(r.egreso_monto)}{r.egreso_pagado ? '' : ' · por pagar'}</div></div>
                <Check size={16} className="ok" />
              </div>
            ))}
          </>
        )}
        <div className="section-title"><AlertTriangle size={15} /> Por pagar</div>
        {porPagar.length === 0 ? <div className="field-hint">Nada pendiente de pago.</div> : porPagar.map(e => (
          <div key={e.id} className="egreso-row por-pagar">
            <div className="egreso-main"><div className="list-row-title">{e.concepto}</div><div className="list-row-sub">{fmtFecha(e.fecha)} · {e.cuenta_nombre}{e.proveedor_nombre ? ` · ${e.proveedor_nombre}` : ''}</div></div>
            <strong className="egreso-monto">{money(e.monto)}</strong>
            <button className="btn-secondary" onClick={() => setSheet({ tipo: 'pagar', item: e })}>Pagar</button>
          </div>
        ))}
      </div>

      {sheet && sheet.tipo === 'egreso' && (
        <EgresoSheet egreso={sheet.item} cuentas={cuentas} dinero={dinero} proveedores={proveedores} periodo={periodo} onClose={() => setSheet(null)}
          onSave={body => guardar(() => (sheet.item ? api.actualizarEgreso(sheet.item.id, body) : api.crearEgreso(body)), sheet.item ? 'Egreso actualizado' : 'Egreso registrado')} />
      )}
      {sheet && sheet.tipo === 'recurrente' && (
        <RecurrenteSheet item={sheet.item} periodo={periodo} dinero={dinero} onClose={() => setSheet(null)}
          onSave={body => guardar(() => api.registrarRecurrente(sheet.item.id, { periodo, ...body }), `${sheet.item.concepto} registrado`)} />
      )}
      {sheet && sheet.tipo === 'pagar' && (
        <PagarSheet egreso={sheet.item} dinero={dinero} onClose={() => setSheet(null)}
          onSave={body => guardar(() => api.actualizarEgreso(sheet.item.id, { pagado: true, ...body }), 'Pago registrado')} />
      )}
      {sheet && sheet.tipo === 'traspaso' && (
        <TraspasoSheet dinero={dinero} onClose={() => setSheet(null)} onSave={body => guardar(() => api.crearTraspaso(body), 'Traspaso registrado')} />
      )}
    </div>
  );
}

function EgresoSheet({ egreso, cuentas, dinero, proveedores, periodo, onClose, onSave, cuentaFija = null, titulo, montoInicial = '', conceptoInicial = '' }) {
  const isNew = !egreso;
  const hoy = hoyMx();
  const defaultFecha = periodo === hoy.slice(0, 7) ? hoy : `${periodo}-01`;
  const [fecha, setFecha] = useState(egreso ? egreso.fecha : defaultFecha);
  const [cuentaId, setCuentaId] = useState(egreso ? egreso.cuenta_contable_id : (cuentaFija ? cuentaFija.id : ''));
  const [concepto, setConcepto] = useState(egreso ? egreso.concepto : conceptoInicial);
  const [monto, setMonto] = useState(egreso ? String(Number(egreso.monto)) : (montoInicial ? String(montoInicial) : ''));
  const [pago, setPago] = useState({ cuentaDineroId: egreso ? egreso.cuenta_dinero_id : (dinero[0] ? dinero[0].id : null), pagado: egreso ? !!egreso.pagado : true });
  const [pagadoEn, setPagadoEn] = useState(egreso && egreso.pagado_en ? egreso.pagado_en : defaultFecha);
  const [proveedorId, setProveedorId] = useState(egreso ? egreso.proveedor_id || '' : '');
  const [aplicaA, setAplicaA] = useState(egreso && egreso.periodo ? egreso.periodo : periodo);
  const [referencia, setReferencia] = useState(egreso ? egreso.referencia || '' : '');
  const [nota, setNota] = useState(egreso ? egreso.nota || '' : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const cuenta = cuentas.find(c => c.id === Number(cuentaId));
  const esDiezmo = cuenta && cuenta.grupo === 'diezmo_ofrenda';

  const submit = async () => {
    const m = Number(monto);
    if (!cuentaId) { setError('Elige la cuenta contable.'); return; }
    if (!concepto.trim()) { setError('Describe el egreso.'); return; }
    if (!Number.isFinite(m) || m <= 0) { setError('Indica el monto (mayor a cero).'); return; }
    if (pago.pagado && !pago.cuentaDineroId) { setError('Indica con qué cuenta se pagó.'); return; }
    setError(''); setSaving(true);
    const body = {
      fecha, cuentaContableId: Number(cuentaId), concepto: concepto.trim(), monto: Math.round(m * 100) / 100,
      pagado: pago.pagado, cuentaDineroId: pago.pagado ? pago.cuentaDineroId : null, pagadoEn: pago.pagado ? pagadoEn : undefined,
      proveedorId: proveedorId || null, periodo: esDiezmo ? aplicaA : (egreso && egreso.periodo ? egreso.periodo : null),
      referencia: referencia.trim() || null, nota: nota.trim() || null,
    };
    const ok = await onSave(body);
    setSaving(false);
    if (ok !== false) onClose();
  };
  return (
    <Sheet title={titulo || (isNew ? 'Nuevo egreso' : 'Editar egreso')} onClose={onClose}>
      <div className="option-group two-col">
        <div><div className="option-label">Fecha del gasto</div><input className="text-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
        <div><div className="option-label">Monto ($)</div><input className="text-input" type="number" min="0" step="0.01" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" autoFocus={!!cuentaFija} /></div>
      </div>
      {!cuentaFija && (
        <div className="option-group">
          <div className="option-label">Cuenta contable</div>
          <SelectCuenta cuentas={cuentas} value={cuentaId} onChange={setCuentaId} />
          {cuenta && <div className="field-hint">{AFECTA.has(cuenta.grupo) ? 'Baja la utilidad del mes (y la base del diezmo).' : 'Sale del dinero pero NO baja la utilidad ni la base del diezmo.'}</div>}
        </div>
      )}
      <div className="option-group">
        <div className="option-label">Concepto</div>
        <input className="text-input" value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej. Recibo de luz septiembre" autoFocus={!cuentaFija} />
      </div>
      {esDiezmo && (
        <div className="option-group">
          <div className="option-label">Mes al que corresponde</div>
          <input className="text-input" type="month" value={aplicaA} onChange={e => e.target.value && setAplicaA(e.target.value)} />
          <div className="field-hint">Así la entrega se descuenta del diezmo/ofrenda calculado de ese mes.</div>
        </div>
      )}
      <PagoPicker cuentas={dinero} value={pago} onChange={setPago} hint={pago.pagado ? undefined : 'Cuenta como gasto del mes desde ahora; saldrá del dinero cuando lo marques pagado.'} />
      {pago.pagado && fecha !== pagadoEn && <div className="option-group"><div className="option-label">Fecha de pago</div><input className="text-input" type="date" value={pagadoEn} onChange={e => setPagadoEn(e.target.value)} /></div>}
      {pago.pagado && fecha === pagadoEn && <button type="button" className="link-toggle" style={{ marginTop: -6, marginBottom: 10 }} onClick={() => setPagadoEn(hoy)}>Se pagó otro día</button>}
      <div className="option-group two-col">
        <div>
          <div className="option-label">Proveedor (opcional)</div>
          <select className="text-input" value={proveedorId} onChange={e => setProveedorId(e.target.value)}>
            <option value="">—</option>
            {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div><div className="option-label">Referencia (folio, recibo)</div><input className="text-input" value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Opcional" /></div>
      </div>
      <div className="option-group"><div className="option-label">Nota</div><input className="text-input" value={nota} onChange={e => setNota(e.target.value)} placeholder="Opcional" /></div>
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : (isNew ? 'Registrar egreso' : 'Guardar cambios')}</button>
      </div>
    </Sheet>
  );
}

function RecurrenteSheet({ item, periodo, dinero, onClose, onSave }) {
  const hoy = hoyMx();
  const dia = String(Math.min(item.dia_pago || 1, 28)).padStart(2, '0');
  // Fecha propuesta: el día de pago del mes; si aún no llega, hoy.
  const [fecha, setFecha] = useState(`${periodo}-${dia}` <= hoy ? `${periodo}-${dia}` : hoy);
  const [monto, setMonto] = useState(String(Number(item.monto_mensual)));
  const [pago, setPago] = useState({ cuentaDineroId: item.cuenta_dinero_id || (dinero[0] ? dinero[0].id : null), pagado: true });
  const [referencia, setReferencia] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const m = Number(monto);
    if (!Number.isFinite(m) || m <= 0) { setError('Indica el monto pagado.'); return; }
    if (pago.pagado && !pago.cuentaDineroId) { setError('Indica con qué cuenta se pagó.'); return; }
    setError(''); setSaving(true);
    const ok = await onSave({ fecha, monto: Math.round(m * 100) / 100, pagado: pago.pagado, cuentaDineroId: pago.pagado ? pago.cuentaDineroId : null, pagadoEn: pago.pagado ? fecha : undefined, referencia: referencia.trim() || null });
    setSaving(false);
    if (ok !== false) onClose();
  };
  return (
    <Sheet title={`${item.concepto} · ${nombreMes(periodo)}`} onClose={onClose}>
      <div className="field-hint" style={{ marginBottom: 12 }}>Cuenta: <strong>{item.cuenta_nombre || 'Otros gastos de operación'}</strong>. Presupuesto mensual {money(item.monto_mensual)}; escribe lo que realmente pagaste.</div>
      <div className="option-group two-col">
        <div><div className="option-label">Fecha</div><input className="text-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
        <div><div className="option-label">Monto pagado ($)</div><input className="text-input" type="number" min="0" step="0.01" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} autoFocus /></div>
      </div>
      <PagoPicker cuentas={dinero} value={pago} onChange={setPago} />
      <div className="option-group"><div className="option-label">Referencia (opcional)</div><input className="text-input" value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Folio, recibo…" /></div>
      <FormError>{error}</FormError>
      <div className="sheet-footer"><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : 'Registrar'}</button></div>
    </Sheet>
  );
}

function PagarSheet({ egreso, dinero, onClose, onSave }) {
  const [fecha, setFecha] = useState(hoyMx());
  const [cuentaDineroId, setCuentaDineroId] = useState(dinero[0] ? dinero[0].id : null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!cuentaDineroId) { setError('Indica con qué cuenta se pagó.'); return; }
    setSaving(true);
    const ok = await onSave({ cuentaDineroId, pagadoEn: fecha });
    setSaving(false);
    if (ok !== false) onClose();
  };
  return (
    <Sheet title={`Pagar: ${egreso.concepto}`} onClose={onClose}>
      <div className="field-hint" style={{ marginBottom: 12 }}>{money(egreso.monto)} · {egreso.cuenta_nombre} · gasto del {fmtFecha(egreso.fecha)}.</div>
      <div className="option-group"><div className="option-label">Fecha de pago</div><input className="text-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
      <PagoPicker cuentas={dinero} value={{ cuentaDineroId, pagado: true }} onChange={v => setCuentaDineroId(v.cuentaDineroId)} permitirPorPagar={false} />
      <FormError>{error}</FormError>
      <div className="sheet-footer"><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : 'Marcar pagado'}</button></div>
    </Sheet>
  );
}

function TraspasoSheet({ dinero, onClose, onSave }) {
  const [fecha, setFecha] = useState(hoyMx());
  const [de, setDe] = useState(dinero.find(d => d.clave === 'caja')?.id || (dinero[0] && dinero[0].id));
  const [a, setA] = useState(dinero.find(d => d.clave === 'banco')?.id || (dinero[1] && dinero[1].id));
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const m = Number(monto);
    if (!de || !a || de === a) { setError('Elige dos cuentas distintas.'); return; }
    if (!Number.isFinite(m) || m <= 0) { setError('Indica el monto.'); return; }
    setSaving(true);
    const ok = await onSave({ fecha, deCuentaId: de, aCuentaId: a, monto: Math.round(m * 100) / 100, nota: nota.trim() || null });
    setSaving(false);
    if (ok !== false) onClose();
  };
  const sel = (v, set) => <select className="text-input" value={v || ''} onChange={e => set(Number(e.target.value))}>{dinero.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}</select>;
  return (
    <Sheet title="Traspaso entre cuentas" onClose={onClose}>
      <div className="field-hint" style={{ marginBottom: 12 }}>Para registrar un depósito del efectivo de caja al banco, o dinero del banco que llevas a la caja. No es gasto: solo cambia de lugar.</div>
      <div className="option-group two-col"><div><div className="option-label">De</div>{sel(de, setDe)}</div><div><div className="option-label">A</div>{sel(a, setA)}</div></div>
      <div className="option-group two-col">
        <div><div className="option-label">Fecha</div><input className="text-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
        <div><div className="option-label">Monto ($)</div><input className="text-input" type="number" min="0" step="0.01" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} autoFocus /></div>
      </div>
      <div className="option-group"><div className="option-label">Nota</div><input className="text-input" value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej. depósito del sábado" /></div>
      <FormError>{error}</FormError>
      <div className="sheet-footer"><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : 'Registrar traspaso'}</button></div>
    </Sheet>
  );
}

/* ================================================================
   MAYORDOMÍA (año)
   ================================================================ */
function MayordomiaTab({ anio, version, cuentas, dinero, cfg, addToast, onChanged }) {
  const [data, setData] = useState(null);
  const [entrega, setEntrega] = useState(null); // { tipo: 'diezmo'|'ofrenda', periodo, monto }
  const cargar = useCallback(async () => {
    try { setData(await api.getMayordomia(anio)); } catch (e) { addToast(e.message, 'warn'); }
  }, [anio, addToast]);
  useEffect(() => { cargar(); }, [cargar, version]);
  if (!data) return <EmptyState icon={HeartHandshake} title="Cargando mayordomía…" />;
  const t = data.totales;
  const cuentaDe = tipo => cuentas.find(c => c.clave === tipo);
  const registrar = async body => {
    try { await api.crearEgreso(body); addToast(`${entrega.tipo === 'diezmo' ? 'Diezmo' : 'Ofrenda'} registrado`, 'success'); await cargar(); await onChanged(); return true; }
    catch (e) { addToast(e.message, 'warn'); return false; }
  };
  return (
    <div>
      <div className="promo-summary-card">
        <strong>Diezmo {data.diezmoPorcentaje}% y ofrenda {data.ofrendaPorcentaje}% sobre la utilidad neta de cada mes</strong> (ventas menos costo de ventas, gastos de operación, financieros e impuestos). Un mes con pérdida no genera diezmo. Cada entrega se registra aquí y se descuenta del mes al que la aplicas; ajusta los porcentajes en Cuentas.
        {' '}Si el negocio te paga un sueldo, ese sueldo lo diezmas aparte como tu ingreso personal: aquí solo está el diezmo del negocio.
      </div>
      <div className="mayordomia-card totales">
        <div><span className="kpi-label">Utilidad neta {anio}</span><strong className={t.utilidadNeta < 0 ? 'rojo' : ''}>{signo(t.utilidadNeta)}</strong></div>
        <div><span className="kpi-label">Diezmo del año</span><strong className="brand">{money(t.diezmo)}</strong><span className="field-hint">entregado {money(t.diezmoEntregado)}</span></div>
        <div><span className="kpi-label">Ofrenda del año</span><strong className="brand">{money(t.ofrenda)}</strong><span className="field-hint">entregada {money(t.ofrendaEntregada)}</span></div>
        <div><span className="kpi-label">Pendiente por devolver</span><strong className={t.diezmoPendiente + t.ofrendaPendiente > 0 ? 'rojo' : 'ok'}>{signo(t.diezmoPendiente + t.ofrendaPendiente)}</strong><span className="field-hint">{t.diezmoPendiente + t.ofrendaPendiente > 0 ? 'diezmo + ofrenda por entregar' : 'al corriente'}</span></div>
      </div>
      {data.meses.length === 0 ? <EmptyState icon={HeartHandshake} title={`Sin meses contables en ${anio}`} subtitle={`La contabilidad cuenta desde ${data.inicio}.`} /> : (
        <div className="mayordomia-table">
          <div className="mayordomia-row head"><span>Mes</span><span>Ventas</span><span>Utilidad neta</span><span>Diezmo</span><span>Ofrenda</span><span>Entregado</span><span>Pendiente</span><span /></div>
          {data.meses.map(m => {
            const pend = Math.round((m.diezmoPendiente + m.ofrendaPendiente) * 100) / 100;
            return (
              <div key={m.periodo} className="mayordomia-row">
                <span>{m.nombre}{m.cerrado ? <Lock size={11} style={{ marginLeft: 4, verticalAlign: -1 }} /> : ''}</span>
                <span>{money(m.ventas)}</span>
                <span className={m.utilidadNeta < 0 ? 'rojo' : ''}>{signo(m.utilidadNeta)}</span>
                <span>{money(m.diezmo)}</span>
                <span>{money(m.ofrenda)}</span>
                <span>{money(m.diezmoEntregado + m.ofrendaEntregada)}</span>
                <span className={pend > 0 ? 'rojo' : pend < 0 ? 'faint' : 'ok'}>{pend > 0 ? money(pend) : pend < 0 ? `+${money(-pend)}` : '✓'}</span>
                <span className="option-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                  {m.diezmoPendiente > 0 && <button className="btn-secondary small" onClick={() => setEntrega({ tipo: 'diezmo', periodo: m.periodo, monto: m.diezmoPendiente })}>Diezmo</button>}
                  {m.ofrendaPendiente > 0 && <button className="btn-secondary small" onClick={() => setEntrega({ tipo: 'ofrenda', periodo: m.periodo, monto: m.ofrendaPendiente })}>Ofrenda</button>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="option-row" style={{ marginTop: 10 }}>
        <button className="btn-primary" onClick={() => setEntrega({ tipo: 'diezmo', periodo: hoyMx().slice(0, 7), monto: '' })}><HandCoins size={15} /> Registrar diezmo entregado</button>
        <button className="btn-secondary" onClick={() => setEntrega({ tipo: 'ofrenda', periodo: hoyMx().slice(0, 7), monto: '' })}>Registrar ofrenda</button>
      </div>
      {entrega && cuentaDe(entrega.tipo) && (
        <EgresoSheet
          titulo={entrega.tipo === 'diezmo' ? 'Diezmo entregado' : 'Ofrenda entregada'}
          egreso={null} cuentas={cuentas} dinero={dinero} proveedores={[]} periodo={entrega.periodo}
          cuentaFija={cuentaDe(entrega.tipo)}
          montoInicial={entrega.monto}
          conceptoInicial={`${entrega.tipo === 'diezmo' ? 'Diezmo' : 'Ofrenda'} de ${nombreMes(entrega.periodo)}`}
          onClose={() => setEntrega(null)}
          onSave={body => registrar({ ...body, cuentaContableId: cuentaDe(entrega.tipo).id, periodo: body.periodo || entrega.periodo })}
        />
      )}
    </div>
  );
}

/* ================================================================
   CUENTAS: catálogo, dinero y porcentajes
   ================================================================ */
function CuentasTab({ cuentas, dinero, cfg, addToast, onChanged }) {
  const [diezmo, setDiezmo] = useState(cfg ? String(cfg.diezmoPorcentaje) : '10');
  const [ofrenda, setOfrenda] = useState(cfg ? String(cfg.ofrendaPorcentaje) : '5');
  const [inicio, setInicio] = useState(cfg && cfg.contabilidadInicio ? cfg.contabilidadInicio : '');
  useEffect(() => { if (cfg) { setDiezmo(String(cfg.diezmoPorcentaje)); setOfrenda(String(cfg.ofrendaPorcentaje)); setInicio(cfg.contabilidadInicio || ''); } }, [cfg]);
  const [editDinero, setEditDinero] = useState(null);
  const [nueva, setNueva] = useState(null); // { nombre, grupo }
  const [renombrar, setRenombrar] = useState(null); // { id, nombre }
  const run = async (fn, msg) => { try { await fn(); if (msg) addToast(msg, 'success'); await onChanged(); return true; } catch (e) { addToast(e.message, 'warn'); return false; } };

  return (
    <div className="admin-columns">
      <div>
        <div className="section-title"><HeartHandshake size={15} /> Porcentajes y arranque</div>
        <div className="promo-summary-card">
          <div className="option-group two-col">
            <div><div className="option-label">Diezmo (% de la utilidad neta)</div><input className="text-input" type="number" min="0" max="100" step="0.5" value={diezmo} onChange={e => setDiezmo(e.target.value)} /></div>
            <div><div className="option-label">Ofrenda (% de la utilidad neta)</div><input className="text-input" type="number" min="0" max="100" step="0.5" value={ofrenda} onChange={e => setOfrenda(e.target.value)} /></div>
          </div>
          <div className="option-group">
            <div className="option-label">La contabilidad cuenta desde</div>
            <input className="text-input" type="date" value={inicio} onChange={e => setInicio(e.target.value)} />
            <div className="field-hint">Ventas, compras y consumos anteriores a esta fecha no entran a Caja/Banco ni a la mayordomía.</div>
          </div>
          <button className="btn-primary" onClick={() => run(() => api.guardarContabilidadConfig({ diezmoPorcentaje: Number(diezmo), ofrendaPorcentaje: Number(ofrenda), ...(inicio ? { contabilidadInicio: inicio } : {}) }), 'Configuración guardada')}>Guardar</button>
        </div>

        <div className="section-title"><Landmark size={15} /> Cuentas de dinero</div>
        {dinero.map(d => (
          <div key={d.id} className="egreso-row">
            <div className="egreso-main">
              <div className="list-row-title">{d.tipo === 'efectivo' ? '💵' : '🏦'} {d.nombre}</div>
              <div className="list-row-sub">Saldo inicial {money(d.saldoInicial)}{d.fechaSaldoInicial ? ` al ${d.fechaSaldoInicial}` : ' (sin fecha)'}</div>
            </div>
            <strong className={`egreso-monto ${d.saldo < 0 ? 'rojo' : ''}`}>{signo(d.saldo)}</strong>
            <div className="list-row-actions"><button className="icon-btn small" aria-label="Editar" onClick={() => setEditDinero(d)}><Pencil size={14} /></button></div>
          </div>
        ))}
        <div className="field-hint">Las ventas en efectivo entran a Caja; tarjeta y transferencia a Banco. Un saldo negativo indica que faltan movimientos por registrar (saldo inicial, depósitos, egresos).</div>
      </div>
      <div>
        <div className="section-title"><BookOpen size={15} /> Catálogo de cuentas</div>
        <button className="btn-secondary" style={{ marginBottom: 10 }} onClick={() => setNueva({ nombre: '', grupo: 'gasto_operacion' })}><Plus size={15} /> Nueva cuenta</button>
        {GRUPOS_ORDEN.map(g => {
          const lista = cuentas.filter(c => c.grupo === g);
          if (!lista.length) return null;
          return (
            <div key={g}>
              <div className="option-label" style={{ marginTop: 10 }}>{GRUPO_LABELS[g]} <span className="faint">{AFECTA.has(g) ? '· baja la utilidad' : '· no baja la utilidad'}</span></div>
              {lista.map(c => (
                <div key={c.id} className={`opcion-row ${c.activo === false ? 'inactiva' : ''}`}>
                  <div className="opcion-main">
                    {renombrar && renombrar.id === c.id ? (
                      <div className="option-row">
                        <input className="text-input" value={renombrar.nombre} onChange={e => setRenombrar({ ...renombrar, nombre: e.target.value })} autoFocus />
                        <button className="btn-primary" onClick={async () => { if (await run(() => api.actualizarCuentaContable(c.id, { nombre: renombrar.nombre }), 'Cuenta renombrada')) setRenombrar(null); }}>Guardar</button>
                        <button className="btn-ghost" onClick={() => setRenombrar(null)}>Cancelar</button>
                      </div>
                    ) : (
                      <><div className="opcion-nombre">{c.nombre}{c.activo === false ? ' • Inactiva' : ''}</div><div className="opcion-sub">{Number(c.movimientos)} movimiento(s){c.clave ? ' · del sistema' : ''}</div></>
                    )}
                  </div>
                  <div className="list-row-actions">
                    <button className="icon-btn small" aria-label="Renombrar" onClick={() => setRenombrar({ id: c.id, nombre: c.nombre })}><Pencil size={14} /></button>
                    <button className="link-toggle" onClick={() => run(() => api.actualizarCuentaContable(c.id, { activo: c.activo === false }), c.activo === false ? 'Cuenta activada' : 'Cuenta desactivada')}>{c.activo === false ? 'Activar' : 'Desactivar'}</button>
                    {!c.clave && Number(c.movimientos) === 0 && <button className="link-danger" onClick={() => window.confirm(`¿Borrar la cuenta "${c.nombre}"?`) && run(() => api.eliminarCuentaContable(c.id), 'Cuenta borrada')}><Trash2 size={13} /></button>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {editDinero && (
        <CuentaDineroSheet cuenta={editDinero} onClose={() => setEditDinero(null)} onSave={body => run(() => api.actualizarCuentaDinero(editDinero.id, body), 'Cuenta de dinero actualizada')} />
      )}
      {nueva && (
        <Sheet title="Nueva cuenta contable" onClose={() => setNueva(null)}>
          <div className="option-group"><div className="option-label">Nombre</div><input className="text-input" value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Ej. Uniformes" autoFocus /></div>
          <div className="option-group">
            <div className="option-label">Grupo</div>
            <div className="option-row">
              {GRUPOS_ORDEN.map(g => <button key={g} type="button" className={`option-chip ${nueva.grupo === g ? 'selected' : ''}`} onClick={() => setNueva({ ...nueva, grupo: g })}>{GRUPO_LABELS[g]}</button>)}
            </div>
            <div className="field-hint">{AFECTA.has(nueva.grupo) ? 'Los egresos de esta cuenta bajan la utilidad y la base del diezmo.' : 'Los egresos de esta cuenta salen del dinero pero no bajan la utilidad.'}</div>
          </div>
          <div className="sheet-footer"><button className="btn-ghost" onClick={() => setNueva(null)}>Cancelar</button><button className="btn-primary" onClick={async () => { if (await run(() => api.crearCuentaContable(nueva), 'Cuenta creada')) setNueva(null); }}>Crear cuenta</button></div>
        </Sheet>
      )}
    </div>
  );
}

function CuentaDineroSheet({ cuenta, onClose, onSave }) {
  const [nombre, setNombre] = useState(cuenta.nombre);
  const [saldo, setSaldo] = useState(String(cuenta.saldoInicial));
  const [fecha, setFecha] = useState(cuenta.fechaSaldoInicial || '');
  const [error, setError] = useState('');
  const submit = async () => {
    if (!nombre.trim()) { setError('Escribe el nombre.'); return; }
    if (!Number.isFinite(Number(saldo))) { setError('Indica el saldo inicial (puede ser 0).'); return; }
    if (!fecha) { setError('Indica a qué fecha corresponde ese saldo.'); return; }
    const ok = await onSave({ nombre: nombre.trim(), saldoInicial: Number(saldo), fechaSaldoInicial: fecha });
    if (ok !== false) onClose();
  };
  return (
    <Sheet title={`Cuenta: ${cuenta.nombre}`} onClose={onClose}>
      <div className="option-group"><div className="option-label">Nombre</div><input className="text-input" value={nombre} onChange={e => setNombre(e.target.value)} /></div>
      <div className="option-group two-col">
        <div><div className="option-label">Saldo inicial ($)</div><input className="text-input" type="number" step="0.01" inputMode="decimal" value={saldo} onChange={e => setSaldo(e.target.value)} /></div>
        <div><div className="option-label">A la fecha</div><input className="text-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
      </div>
      <div className="field-hint">Cuánto había en esta cuenta al empezar ese día. A partir de ahí el sistema suma ventas y traspasos y resta egresos pagados.</div>
      <FormError>{error}</FormError>
      <div className="sheet-footer"><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={submit}>Guardar</button></div>
    </Sheet>
  );
}
