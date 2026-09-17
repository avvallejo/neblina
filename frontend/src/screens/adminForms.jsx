// Formularios del panel administrativo (hoja en móvil, modal en escritorio).
import React, { useState, useEffect, useRef } from 'react';
import { Coffee, Plus, Trash2 } from 'lucide-react';
import TvPersonalizationEditor from './TvPersonalizationEditor.jsx';
import * as api from '../api/client.js';
import {
  CATEGORIES, PRODUCTS, ROLE_LABELS, MATERIA_CATEGORIAS, PROVEEDOR_CATEGORIAS, SIZE_OPTIONS, MILK_OPTIONS, COFFEE_OPTIONS, EXTRA_OPTIONS, ESTACION_LABELS,
} from '../lib/catalog.js';
import {
  normalizeUnidad, unidadDisplay, unidadFamilia, convertirCantidad, convertirCostoUnitario,
  formatNumeroInput, unidadStep, UNIDADES, redimensionarImagen, money,
} from '../lib/helpers.js';
import { buildRecipe } from '../lib/recipes.js';
import { Sheet, Stepper, FormError } from '../components/ui.jsx';

export function PromoConfigSheet({ config, onClose, onSave }) {
  const [activo, setActivo] = useState(config.activo);
  const [cada, setCada] = useState(config.cada);
  const [premioId, setPremioId] = useState(config.premioId);
  return (
    <Sheet title="Promoción de fidelidad" onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Estado de la promoción</div>
        <div className="option-row">
          <button className={`option-chip ${activo ? 'selected' : ''}`} onClick={() => setActivo(true)}>Activa</button>
          <button className={`option-chip ${!activo ? 'selected' : ''}`} onClick={() => setActivo(false)}>Inactiva</button>
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Cada cuántos pedidos por la app</div>
        <Stepper value={cada} min={2} max={50} onChange={setCada} />
      </div>
      <div className="option-group">
        <div className="option-label">Premio</div>
        <div className="option-row">
          {PRODUCTS.filter(p => p.activo !== false).map(p => (
            <button key={p.id} className={`option-chip ${premioId === p.id ? 'selected' : ''}`} onClick={() => setPremioId(p.id)}>
              {p.icon} {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" onClick={() => { onSave({ activo, cada, premioId }); onClose(); }}>Guardar promoción</button>
      </div>
    </Sheet>
  );
}

// esGeneral: el usuario con sesión es admin general (puede crear admins
// generales y elegir a qué sede pertenece cada cuenta nueva).
export function UsuarioFormSheet({ user, onClose, onSave, esGeneral, sedes, sedeActivaId }) {
  const isNew = !user || !user.id;
  const [nombre, setNombre] = useState(user ? user.nombre || '' : '');
  const [rol, setRol] = useState(user ? user.rol || 'cajero' : 'cajero');
  const [pin, setPin] = useState('');
  const [general, setGeneral] = useState(user ? user.sucursal_id === null && user.rol === 'admin' && !isNew : false);
  const [sucursalId, setSucursalId] = useState(user && user.sucursal_id ? user.sucursal_id : (sedeActivaId || ''));
  // Comanda que ve (barista / mostrador): barra, parrilla o ambas.
  const [estaciones, setEstaciones] = useState(user && Array.isArray(user.estaciones) && user.estaciones.length ? user.estaciones : (isNew ? ['barra'] : ['barra', 'parrilla']));
  const [error, setError] = useState('');
  const prepara = rol === 'barista' || rol === 'mostrador';

  const submit = () => {
    if (!nombre.trim()) { setError('Ingresa un nombre.'); return; }
    if (isNew && !/^\d{4}$/.test(pin)) { setError('El PIN debe tener exactamente 4 dígitos.'); return; }
    if (!isNew && pin && !/^\d{4}$/.test(pin)) { setError('Si cambias el PIN, debe tener 4 dígitos.'); return; }
    if (prepara && estaciones.length === 0) { setError('Elige al menos una estación: barra, parrilla o ambas.'); return; }
    setError('');
    const payload = { id: isNew ? undefined : user.id, nombre: nombre.trim(), rol, pin: pin || undefined };
    if (prepara) payload.estaciones = ['barra', 'parrilla'].filter(e => estaciones.includes(e));
    if (esGeneral) {
      if (general && rol === 'admin') payload.esAdminGeneral = true;
      else if (isNew) payload.esAdminGeneral = false;
      // Reasignación de sede (solo admin general y solo al editar):
      if (!isNew && !general && sucursalId && sucursalId !== user.sucursal_id) payload.sucursalId = sucursalId;
      if (!isNew && general && user.sucursal_id !== null) payload.sucursalId = null;
    }
    onSave(payload);
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Agregar usuario' : 'Editar usuario'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre</div>
        <input className="text-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Ana López" />
      </div>
      <div className="option-group">
        <div className="option-label">Rol</div>
        <div className="option-row">
          {['cajero', 'barista', 'mostrador', 'admin'].map(r => (
            <button key={r} className={`option-chip ${rol === r ? 'selected' : ''}`} onClick={() => { setRol(r); if (r !== 'admin') setGeneral(false); }}>{r === 'barista' ? 'Preparación (barista / parrillero)' : ROLE_LABELS[r]}</button>
          ))}
        </div>
        {rol === 'mostrador' && <div className="field-hint">Para sedes donde la misma persona levanta el pedido, cobra y prepara: entra con Caja y Barra en la misma sesión y puede cambiar entre ambas con un toque.</div>}
      </div>
      {prepara && (
        <div className="option-group">
          <div className="option-label">¿Qué prepara esta persona?</div>
          <div className="option-row">
            {[
              { label: 'Barista', value: ['barra'] },
              { label: 'Parrillero', value: ['parrilla'] },
              { label: 'Ambos', value: ['barra', 'parrilla'] },
            ].map(option => (
              <button key={option.label} type="button" aria-pressed={option.value.length === estaciones.length && option.value.every(e => estaciones.includes(e))} className={`option-chip ${option.value.length === estaciones.length && option.value.every(e => estaciones.includes(e)) ? 'selected' : ''}`} onClick={() => setEstaciones(option.value)}>{option.label}</button>
            ))}
          </div>
          <div className="field-hint">
            Barista ve los productos asignados a Barra. Parrillero ve los asignados a Parrilla. Ambos ve las dos estaciones, en orden de llegada.
            Lo que se marca como "se entrega en caja" no pasa por ninguna comanda.
          </div>
        </div>
      )}
      {esGeneral && rol === 'admin' && (
        <div className="option-group">
          <div className="option-label">Alcance del administrador</div>
          <div className="option-row">
            <button className={`option-chip ${!general ? 'selected' : ''}`} onClick={() => setGeneral(false)}>Admin de sucursal</button>
            <button className={`option-chip ${general ? 'selected' : ''}`} onClick={() => setGeneral(true)}>Admin general (todas las sedes)</button>
          </div>
        </div>
      )}
      {esGeneral && !general && sedes && sedes.length > 0 && (
        <div className="option-group">
          <div className="option-label">Sucursal</div>
          <select className="text-input" value={sucursalId} onChange={e => setSucursalId(e.target.value)}>
            {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      )}
      <div className="option-group">
        <div className="option-label">PIN de acceso (4 dígitos){!isNew ? ' — déjalo vacío para no cambiarlo' : ''}</div>
        <input className="text-input" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Ej. 5831" />
      </div>
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" onClick={submit}>{isNew ? 'Agregar usuario' : 'Guardar cambios'}</button>
      </div>
    </Sheet>
  );
}

export function ProveedorFormSheet({ proveedor, onClose, onSave }) {
  const isNew = !proveedor || !proveedor.id;
  const [nombre, setNombre] = useState(proveedor ? proveedor.nombre || '' : '');
  const [categorias, setCategorias] = useState(() => {
    if (!proveedor) return [PROVEEDOR_CATEGORIAS[0]];
    if (Array.isArray(proveedor.categorias) && proveedor.categorias.length) return proveedor.categorias;
    return proveedor.categoria ? [proveedor.categoria] : [PROVEEDOR_CATEGORIAS[0]];
  });
  const toggleCategoria = c => setCategorias(cs => (cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]));
  // Categoría libre (fuera de la lista sugerida): se guarda tal cual en el proveedor.
  const [otraAbierta, setOtraAbierta] = useState(false);
  const [otra, setOtra] = useState('');
  const agregarOtra = () => {
    const n = otra.trim();
    if (n.length < 2) return;
    setCategorias(prev => (prev.includes(n) ? prev : [...prev, n]));
    setOtra(''); setOtraAbierta(false);
  };
  const [contacto, setContacto] = useState(proveedor ? proveedor.contacto || '' : '');
  const [telefono, setTelefono] = useState(proveedor ? proveedor.telefono || '' : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!nombre.trim()) { setError('Ingresa el nombre del proveedor.'); return; }
    if (categorias.length === 0) { setError('Elige al menos una categoría de insumos.'); return; }
    setError('');
    setSaving(true);
    const ok = await onSave({
      id: isNew ? undefined : proveedor.id, nombre: nombre.trim(), categorias,
      contacto: contacto.trim(), telefono: telefono.replace(/\D/g, '').slice(0, 10),
      activo: isNew ? true : proveedor.activo,
    });
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Sheet title={isNew ? 'Agregar proveedor' : 'Editar proveedor'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre del proveedor</div>
        <input className="text-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Tueste Local" />
      </div>
      <div className="option-group">
        <div className="option-label">Categorías de insumos que surte (elige una o varias)</div>
        <div className="option-row">
          {[...PROVEEDOR_CATEGORIAS, ...categorias.filter(c => !PROVEEDOR_CATEGORIAS.includes(c))].map(c => (
            <button key={c} className={`option-chip ${categorias.includes(c) ? 'selected' : ''}`} onClick={() => toggleCategoria(c)}>{c}</button>
          ))}
          <button type="button" className={`option-chip chip-nueva ${otraAbierta ? 'selected' : ''}`} onClick={() => setOtraAbierta(v => !v)}>+ Otra</button>
        </div>
        {otraAbierta && (
          <div className="categoria-nueva">
            <input className="text-input" value={otra} maxLength={40} placeholder="Ej. Panadería" autoFocus onChange={e => setOtra(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarOtra(); } }} />
            <button type="button" className="btn-secondary" onClick={agregarOtra}>Agregar</button>
          </div>
        )}
      </div>
      <div className="option-group two-col">
        <div>
          <div className="option-label">Persona de contacto</div>
          <input className="text-input" value={contacto} onChange={e => setContacto(e.target.value)} placeholder="Ej. Mario Pérez" />
        </div>
        <div>
          <div className="option-label">Teléfono</div>
          <input className="text-input" inputMode="numeric" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="Ej. 9611234567" />
        </div>
      </div>
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : (isNew ? 'Agregar proveedor' : 'Guardar cambios')}</button>
      </div>
    </Sheet>
  );
}

// Presentación de compra ("bolsa de 900 g", "caja de 12 l", "paquete de 50 piezas").
function PresentacionEditor({ unidadControl, value, onChange }) {
  const activa = !!value;
  const unidades = unidadesCompatibles(unidadControl);
  return (
    <div className="option-group">
      <div className="option-label">¿Cómo lo compras? (presentación, opcional)</div>
      <div className="option-row">
        <button type="button" className={`option-chip ${!activa ? 'selected' : ''}`} onClick={() => onChange(null)}>Suelto, por cantidad</button>
        <button type="button" className={`option-chip ${activa ? 'selected' : ''}`} onClick={() => !activa && onChange({ nombre: 'paquete', cantidad: '', unidad: unidades.includes(unidadControl) ? unidadControl : unidades[0] })}>En paquetes</button>
      </div>
      {activa && (
        <div className="presentacion-row">
          <select className="text-input" value={value.nombre} onChange={e => onChange({ ...value, nombre: e.target.value })}>
            {['paquete', 'bolsa', 'caja', 'garrafón', 'lata', 'botella', 'costal', 'rollo'].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="presentacion-de">de</span>
          <input className="text-input" type="number" min="0" step={unidadStep(value.unidad)} value={value.cantidad} onChange={e => onChange({ ...value, cantidad: e.target.value })} placeholder="Ej. 900" />
          <select className="text-input" value={value.unidad} onChange={e => onChange({ ...value, unidad: e.target.value })}>
            {unidades.map(u => <option key={u} value={u}>{unidadDisplay(u)}</option>)}
          </select>
        </div>
      )}
      <div className="field-hint">Con presentación, las compras se capturan como "N paquetes por $X" y el sistema convierte a {unidadDisplay(unidadControl)}.</div>
    </div>
  );
}

function presentacionValida(p) {
  if (!p) return null;
  const n = parseFloat(p.cantidad);
  if (!Number.isFinite(n) || n <= 0) return 'Indica cuánto contiene cada paquete de la presentación.';
  return null;
}

// Chips de categoría con alta inline: "+ Nueva" abre un campo, `onCrear`
// la guarda en la API y devuelve el nombre ya creado, que queda seleccionado.
export function CategoriaChips({ opciones, value, onChange, onCrear, placeholder = 'Nombre de la categoría' }) {
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const crear = async () => {
    const n = nombre.trim();
    if (n.length < 2) { setError('Escribe un nombre de al menos 2 letras.'); return; }
    setBusy(true); setError('');
    try { const creado = await onCrear(n); onChange(creado); setCreando(false); setNombre(''); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div className="option-row">
        {opciones.map(c => (
          <button key={c} type="button" className={`option-chip ${value === c ? 'selected' : ''}`} onClick={() => onChange(c)}>{c}</button>
        ))}
        <button type="button" className={`option-chip chip-nueva ${creando ? 'selected' : ''}`} onClick={() => setCreando(v => !v)}>+ Nueva</button>
      </div>
      {creando && (
        <div className="categoria-nueva">
          <input className="text-input" value={nombre} maxLength={40} placeholder={placeholder} autoFocus onChange={e => setNombre(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); crear(); } }} />
          <button type="button" className="btn-secondary" disabled={busy} onClick={crear}>{busy ? 'Creando…' : 'Crear'}</button>
          {error && <FormError>{error}</FormError>}
        </div>
      )}
    </>
  );
}

export function MateriaFormSheet({ item, proveedores, onClose, onSave }) {
  const isNew = !item || !item.id;
  const [nombre, setNombre] = useState(item ? item.nombre || '' : '');
  const [categoria, setCategoria] = useState(item ? item.categoria || MATERIA_CATEGORIAS[0] : MATERIA_CATEGORIAS[0]);
  const [categoriasUso, setCategoriasUso] = useState(item?.categoriasUso || []);
  const [categoriasMenu, setCategoriasMenu] = useState([]);
  const [errorCategorias, setErrorCategorias] = useState('');
  useEffect(() => {
    let alive = true;
    api.getCategoriasProducto().then(rows => { if (alive) setCategoriasMenu(rows); })
      .catch(e => { if (alive) setErrorCategorias(e.message); });
    return () => { alive = false; };
  }, []);
  const [catsInsumo, setCatsInsumo] = useState([...MATERIA_CATEGORIAS]);
  const crearCategoriaInsumo = async n => {
    const c = await api.crearCategoriaMateria(n);
    const rows = await api.getMateriasCategorias(); // refresca el mapa nombre → id
    setCatsInsumo(rows.map(r => r.nombre));
    return c.nombre;
  };
  const [unidad, setUnidad] = useState(item ? normalizeUnidad(item.unidad || 'kg') : 'kg');
  const [stockActual, setStockActual] = useState(item ? String(item.stockActual ?? '') : '');
  const [stockMinimo, setStockMinimo] = useState(item ? String(item.stockMinimo ?? '') : '');
  const [stockMaximo, setStockMaximo] = useState(item && item.stockMaximo !== null && item.stockMaximo !== undefined ? String(item.stockMaximo) : '');
  const [costoUnitario, setCostoUnitario] = useState(item ? String(item.costoUnitario ?? '') : '');
  const [proveedorId, setProveedorId] = useState(item ? item.proveedorId || '' : (proveedores[0] ? proveedores[0].id : ''));
  const [presentacion, setPresentacion] = useState(item && item.presentacion ? { nombre: item.presentacion.nombre, cantidad: String(item.presentacion.cantidad), unidad: normalizeUnidad(item.presentacion.unidad) } : null);
  // Alta: lo normal es registrar la primera compra (el costo se deriva); "a mano"
  // solo para existencias que ya tienes sin ticket.
  const [modoInicial, setModoInicial] = useState('compra'); // 'compra' | 'manual'
  const [paquetes, setPaquetes] = useState('');
  const [cantidadCompra, setCantidadCompra] = useState('');
  const [unidadCompra, setUnidadCompra] = useState(item ? normalizeUnidad(item.unidad || 'kg') : 'kg');
  const [totalPagado, setTotalPagado] = useState('');
  const [pagoCompra, setPagoCompra] = useState({ cuentaDineroId: null, pagado: true }); // Contabilidad: con qué se pagó la primera compra
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const presOk = presentacion && !presentacionValida(presentacion) ? presentacion : null;
  const usaPaquetes = isNew && modoInicial === 'compra' && !!presOk;
  // Cantidad comprada expresada en la unidad de control (para mostrar el resultado).
  const cantidadCompraControl = (() => {
    if (usaPaquetes) {
      const n = parseFloat(paquetes); if (!Number.isFinite(n) || n <= 0) return null;
      return convertirCantidad(n * parseFloat(presOk.cantidad), presOk.unidad, unidad);
    }
    const n = parseFloat(cantidadCompra); if (!Number.isFinite(n) || n <= 0) return null;
    return convertirCantidad(n, unidadCompra, unidad);
  })();
  const totalNum = parseFloat(totalPagado);
  const costoDerivado = cantidadCompraControl && Number.isFinite(totalNum) && totalNum > 0 ? totalNum / cantidadCompraControl : null;

  const cambiarUnidad = nextUnidad => {
    const next = normalizeUnidad(nextUnidad);
    const current = normalizeUnidad(unidad);
    if (next === current) return;
    if (unidadFamilia(next) !== unidadFamilia(current)) {
      const tieneValores = !isNew && (stockActual !== '' || stockMinimo !== '' || costoUnitario !== '');
      if (tieneValores) {
        setError('Para cambiar entre peso, volumen y piezas, primero deja stock/costo en cero o crea un insumo nuevo.');
        return;
      }
      setUnidad(next); setUnidadCompra(next); setStockMinimo(''); setStockMaximo(''); setPresentacion(null);
      return;
    }
    const nuevoStock = convertirCantidad(stockActual, current, next);
    const nuevoMinimo = convertirCantidad(stockMinimo, current, next);
    const nuevoMaximo = convertirCantidad(stockMaximo, current, next);
    const nuevoCosto = convertirCostoUnitario(costoUnitario, current, next);
    if (nuevoStock === null || nuevoMinimo === null || nuevoCosto === null || nuevoMaximo === null) {
      setError('No se puede convertir automáticamente entre esas unidades.');
      return;
    }
    const dec = next === 'g' || next === 'ml' || next === 'pieza' ? 0 : 3;
    setStockActual(formatNumeroInput(nuevoStock, dec));
    setStockMinimo(formatNumeroInput(nuevoMinimo, dec));
    setStockMaximo(formatNumeroInput(nuevoMaximo, dec));
    setCostoUnitario(formatNumeroInput(nuevoCosto, 4));
    setUnidad(next);
    if (!unidadesCompatibles(next).includes(unidadCompra)) setUnidadCompra(next);
    setError('');
  };

  const submit = async () => {
    if (!nombre.trim()) { setError('Ingresa un nombre.'); return; }
    if (stockMinimo === '') { setError('Indica el stock mínimo (avísame cuando quede menos de…).'); return; }
    const minimoNum = parseFloat(stockMinimo);
    if (!Number.isFinite(minimoNum) || minimoNum < 0) { setError('El stock mínimo debe ser un número positivo o cero.'); return; }
    const maximoNum = stockMaximo === '' ? null : parseFloat(stockMaximo);
    if (maximoNum !== null && (!Number.isFinite(maximoNum) || maximoNum < minimoNum)) { setError('"Reabastecer hasta" debe ser un número mayor o igual al stock mínimo (o déjalo vacío).'); return; }
    const errPres = presentacionValida(presentacion);
    if (errPres) { setError(errPres); return; }
    const presPayload = presentacion ? { nombre: presentacion.nombre, cantidad: parseFloat(presentacion.cantidad), unidad: presentacion.unidad } : null;

    const payload = {
      id: isNew ? undefined : item.id, nombre: nombre.trim(), categoria, categoriasUso, unidad,
      stockMinimo: minimoNum, stockMaximo: maximoNum, proveedorId: proveedorId || null,
      presentacion: presPayload,
      activo: isNew ? true : item.activo,
    };
    if (isNew && modoInicial === 'compra') {
      // Primera compra: el costo unitario lo calcula el servidor (total ÷ cantidad convertida).
      if (usaPaquetes) {
        const n = parseFloat(paquetes);
        if (!Number.isFinite(n) || n <= 0) { setError(`Indica cuántos ${presOk.nombre}s compraste.`); return; }
        payload.primeraCompra = { paquetes: n, costoTotal: totalNum };
      } else {
        const n = parseFloat(cantidadCompra);
        if (!Number.isFinite(n) || n <= 0) { setError('Indica cuánto compraste.'); return; }
        payload.primeraCompra = { cantidadComprada: n, unidad: unidadCompra, costoTotal: totalNum };
      }
      if (!Number.isFinite(totalNum) || totalNum < 0) { setError('Indica cuánto pagaste en total (puede ser 0 si fue regalo).'); return; }
      payload.primeraCompra.cuentaDineroId = pagoCompra.pagado ? pagoCompra.cuentaDineroId : null;
      payload.primeraCompra.pagado = pagoCompra.pagado;
    } else {
      if (stockActual === '' || costoUnitario === '') { setError(isNew ? 'Indica las existencias que tienes y su costo estimado.' : 'Completa stock actual y costo.'); return; }
      const stockNum = parseFloat(stockActual);
      const costoNum = parseFloat(costoUnitario);
      if ([stockNum, costoNum].some(n => !Number.isFinite(n) || n < 0)) { setError('Stock y costo deben ser números positivos o cero.'); return; }
      // No reenviar existencias al editar datos: los lotes rechazan el stock
      // manual y un valor sin cambios podría sobrescribir movimientos recientes.
      if (isNew || (!item.requiereLote && (stockNum !== Number(item.stockActual) || unidad !== normalizeUnidad(item.unidad)))) payload.stockActual = stockNum;
      payload.costoUnitario = costoNum;
    }
    setError('');
    setSaving(true);
    const ok = await onSave(payload);
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Sheet title={isNew ? 'Agregar materia prima' : 'Editar materia prima'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre</div>
        <input className="text-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Leche entera" />
      </div>
      <div className="option-group">
        <div className="option-label">Categoría</div>
        <CategoriaChips opciones={catsInsumo} value={categoria} onChange={setCategoria} onCrear={crearCategoriaInsumo} placeholder="Ej. Panadería, Limpieza…" />
      </div>
      <div className="option-group">
        <div className="option-label">Se utiliza en (elige una o varias)</div>
        {errorCategorias && <FormError>{errorCategorias}</FormError>}
        <div className="option-row">
          {categoriasMenu.map(c => <button key={c.id} type="button" aria-pressed={categoriasUso.includes(c.id)} className={`option-chip ${categoriasUso.includes(c.id) ? 'selected' : ''}`} onClick={() => setCategoriasUso(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}>{c.nombre}</button>)}
        </div>
        <div className="field-hint">Aparecerá al agregar ingredientes a recetas de estas categorías. Sin selección, no aparecerá como ingrediente nuevo. Mantiene una sola existencia compartida.</div>
      </div>
      <div className="option-group">
        <div className="option-label">¿En qué unidad lo cuentas?</div>
        <div className="option-row">
          {UNIDADES.map(u => (
            <button key={u} className={`option-chip ${unidad === u ? 'selected' : ''}`} onClick={() => cambiarUnidad(u)}>{unidadDisplay(u)}</button>
          ))}
        </div>
        <div className="field-hint">Es la unidad del stock, del mínimo y de las recetas. Las compras las capturas en la unidad en que vengan (g, kg, ml, l…) y se convierten solas.</div>
      </div>
      <PresentacionEditor unidadControl={unidad} value={presentacion} onChange={setPresentacion} />
      <div className="option-group two-col">
        <div>
          <div className="option-label">Avísame cuando quede menos de ({unidadDisplay(unidad)})</div>
          <input className="text-input" type="number" step={unidadStep(unidad)} value={stockMinimo} onChange={e => setStockMinimo(e.target.value)} placeholder={unidad === 'kg' || unidad === 'l' ? '0.000' : '0'} />
        </div>
        <div>
          <div className="option-label">Reabastecer hasta ({unidadDisplay(unidad)}, opcional)</div>
          <input className="text-input" type="number" step={unidadStep(unidad)} value={stockMaximo} onChange={e => setStockMaximo(e.target.value)} placeholder="Vacío = solo avisar" />
        </div>
      </div>
      {isNew ? (
        <div className="option-group compra-block">
          <div className="option-label">Existencias iniciales</div>
          <div className="option-row">
            <button type="button" className={`option-chip ${modoInicial === 'compra' ? 'selected' : ''}`} onClick={() => setModoInicial('compra')}>Registrar la primera compra</button>
            <button type="button" className={`option-chip ${modoInicial === 'manual' ? 'selected' : ''}`} onClick={() => setModoInicial('manual')}>Ya tengo existencias (capturar a mano)</button>
          </div>
          {modoInicial === 'compra' ? (
            <>
              <div className="option-group two-col" style={{ marginTop: 10 }}>
                {usaPaquetes ? (
                  <div>
                    <div className="option-label">¿Cuántos {presOk.nombre}s compraste?</div>
                    <input className="text-input" type="number" min="0" step="1" value={paquetes} onChange={e => setPaquetes(e.target.value)} placeholder="Ej. 3" />
                    <div className="field-hint">Cada {presOk.nombre} = {formatNumeroInput(presOk.cantidad)} {unidadDisplay(presOk.unidad)}.</div>
                  </div>
                ) : (
                  <div>
                    <div className="option-label">¿Cuánto compraste?</div>
                    <div className="presentacion-row compact">
                      <input className="text-input" type="number" min="0" step={unidadStep(unidadCompra)} value={cantidadCompra} onChange={e => setCantidadCompra(e.target.value)} placeholder="Ej. 900" />
                      <select className="text-input" value={unidadCompra} onChange={e => setUnidadCompra(e.target.value)}>
                        {unidadesCompatibles(unidad).map(u => <option key={u} value={u}>{unidadDisplay(u)}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                <div>
                  <div className="option-label">¿Cuánto pagaste en total? ($)</div>
                  <input className="text-input" type="number" min="0" step="0.01" value={totalPagado} onChange={e => setTotalPagado(e.target.value)} placeholder="0.00" />
                </div>
              </div>
              <div className={`compra-resultado ${costoDerivado !== null ? 'ok' : ''}`}>
                {cantidadCompraControl !== null && costoDerivado !== null
                  ? <>Existencia inicial: <strong>{formatNumeroInput(cantidadCompraControl)} {unidadDisplay(unidad)}</strong> · costo de referencia: <strong>${costoDerivado.toFixed(4)} por {unidadDisplay(unidad)}</strong></>
                  : 'El costo por unidad se calcula solo con lo que compraste y lo que pagaste.'}
              </div>
              <PagoCuentaPicker value={pagoCompra} onChange={setPagoCompra} hint="Contabilidad: la compra sale de esta cuenta (o queda por pagar) y entra al inventario." />
            </>
          ) : (
            <div className="option-group two-col" style={{ marginTop: 10 }}>
              <div>
                <div className="option-label">Existencias que tienes ({unidadDisplay(unidad)})</div>
                <input className="text-input" type="number" min="0" step={unidadStep(unidad)} value={stockActual} onChange={e => setStockActual(e.target.value)} placeholder="0" />
              </div>
              <div>
                <div className="option-label">Costo estimado ($ por {unidadDisplay(unidad)})</div>
                <input className="text-input" type="number" min="0" step="0.01" value={costoUnitario} onChange={e => setCostoUnitario(e.target.value)} placeholder="0.00" />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="option-group two-col">
          <div>
            <div className="option-label">Stock actual ({unidadDisplay(unidad)})</div>
            <input className="text-input" type="number" step={unidadStep(unidad)} value={stockActual}
                   disabled={item?.requiereLote}
                   onChange={e => setStockActual(e.target.value)} placeholder={unidad === 'kg' || unidad === 'l' ? '0.000' : '0'} />
            {item?.requiereLote && <div className="field-hint">Este insumo se controla por lote: corrige existencias con "Ajustar stock" y registra entradas con "Registrar compra".</div>}
          </div>
          <div>
            <div className="option-label">Costo de referencia ($ por {unidadDisplay(unidad)})</div>
            <input className="text-input" type="number" step="0.01" value={costoUnitario} onChange={e => setCostoUnitario(e.target.value)} placeholder="0.00" />
            <div className="field-hint">Se actualiza solo con cada compra registrada; edítalo únicamente para corregir.</div>
          </div>
        </div>
      )}
      {proveedores.length > 0 && (
        <div className="option-group">
          <div className="option-label">Proveedor</div>
          <div className="option-row">
            <button className={`option-chip ${!proveedorId ? 'selected' : ''}`} onClick={() => setProveedorId('')}>Sin proveedor</button>
            {proveedores.map(p => (
              <button key={p.id} className={`option-chip ${proveedorId === p.id ? 'selected' : ''}`} onClick={() => setProveedorId(p.id)}>{p.nombre}</button>
            ))}
          </div>
        </div>
      )}
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : (isNew ? 'Agregar' : 'Guardar cambios')}</button>
      </div>
    </Sheet>
  );
}

export function ProductoFormSheet({ producto, onClose, onSave, materias = [] }) {
  const isNew = !producto || !producto.id;
  const [name, setName] = useState(producto ? producto.name || '' : '');
  const [cat, setCat] = useState(producto ? producto.cat || (CATEGORIES[0] && CATEGORIES[0].id) : (CATEGORIES[0] && CATEGORIES[0].id));
  const [catsMenu, setCatsMenu] = useState(CATEGORIES.map(c => c.id));
  const crearCategoriaMenu = async n => {
    const c = await api.crearCategoriaProducto(n);
    const rows = await api.getCategoriasProducto(); // refresca el mapa nombre → id
    setCatsMenu(rows.map(r => r.nombre));
    return c.nombre;
  };
  const [icon, setIcon] = useState(producto ? producto.icon || '☕' : '☕');
  const [tipo, setTipo] = useState(producto ? producto.tipo || 'bebida' : 'bebida');
  const [price, setPrice] = useState(producto ? String(producto.precioBase ?? producto.price ?? '') : '');
  const [promo, setPromo] = useState(producto && producto.precioPromocional !== null && producto.precioPromocional !== undefined ? String(producto.precioPromocional) : '');
  const [descripcion, setDescripcion] = useState(producto ? producto.descripcion || '' : '');
  const [sizes, setSizes] = useState(producto ? !!producto.sizes : true);
  const [leche, setLeche] = useState(producto ? !!producto.leche : false);
  const [coffeeType, setCoffeeType] = useState(producto ? !!producto.coffeeType : true);
  const [extras, setExtras] = useState(producto ? producto.extras !== false : true);
  const [frio, setFrio] = useState(producto ? !!producto.frio : false);
  // Quién lo prepara: barra (barista), parrilla (parrillero) o nadie (se entrega en caja).
  const [estacion, setEstacion] = useState(producto ? producto.estacion || (['snack', 'alimento'].includes(producto.tipo) ? 'parrilla' : 'barra') : 'barra');
  const conEstacion = tipo === 'snack' || tipo === 'alimento'; // quién lo prepara se elige por producto
  // Snack de reventa (comprado hecho): insumo del inventario que se descuenta
  // por venta. 'nuevo' = crear el insumo con el nombre del producto al guardar.
  const reventaActual = producto && producto.reventa ? producto.reventa : null;
  const [controlar, setControlar] = useState(!!reventaActual);
  const [insumoSel, setInsumoSel] = useState(reventaActual ? reventaActual.insumoId : 'nuevo');
  const [piezasVenta, setPiezasVenta] = useState(reventaActual ? String(reventaActual.cantidad) : '1');
  const [nvExistencia, setNvExistencia] = useState('');
  const [nvCosto, setNvCosto] = useState('');
  const [nvMinimo, setNvMinimo] = useState(reventaActual ? String(reventaActual.stockMinimo ?? '') : '');
  const [nvMaximo, setNvMaximo] = useState(reventaActual && reventaActual.stockMaximo !== null ? String(reventaActual.stockMaximo) : '');
  const insumosPieza = materias.filter(m => m.activo !== false && normalizeUnidad(m.unidad) === 'pieza');
  const insumoElegido = insumoSel !== 'nuevo' ? insumosPieza.find(m => m.id === insumoSel) || (reventaActual && reventaActual.insumoId === insumoSel ? { id: insumoSel, nombre: reventaActual.nombre, stockActual: reventaActual.stock, stockMinimo: reventaActual.stockMinimo, stockMaximo: reventaActual.stockMaximo, costoUnitario: reventaActual.costoUnitario } : null) : null;
  const elegirInsumo = id => {
    setInsumoSel(id);
    const m = insumosPieza.find(x => x.id === id);
    if (m) { setNvMinimo(String(m.stockMinimo ?? '')); setNvMaximo(m.stockMaximo !== null && m.stockMaximo !== undefined ? String(m.stockMaximo) : ''); }
    else if (id === 'nuevo') { setNvMinimo(''); setNvMaximo(''); }
  };
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [imagen,setImagen]=useState(producto?.imagen||'');
  const [imagenCambiada,setImagenCambiada]=useState(false);
  const [leyendoImagen,setLeyendoImagen]=useState(false);
  const imagenRef=useRef(null);
  const subirImagen=async e=>{
    const file=e.target.files?.[0]; e.target.value='';
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15000000){setError('Elige una imagen JPG, PNG o WebP de hasta 15 MB.');return;}
    setLeyendoImagen(true);setError('');
    try{const data=await redimensionarImagen(file,512);if(data.length>1400000)throw new Error();setImagen(data);setImagenCambiada(true);}
    catch{setError('No se pudo leer la imagen. Prueba con otro archivo.');}
    finally{setLeyendoImagen(false);}
  };

  const submit = async () => {
    if (!name.trim()) { setError('Ingresa un nombre.'); return; }
    const precioNum = parseFloat(price);
    if (price === '' || isNaN(precioNum) || precioNum < 0) { setError('Ingresa un precio válido.'); return; }
    const promoNum = promo === '' ? null : parseFloat(promo);
    if (promoNum !== null && (isNaN(promoNum) || promoNum < 0)) { setError('El precio promocional debe ser un número (o déjalo vacío).'); return; }
    if (promoNum !== null && promoNum >= precioNum) { setError('El precio promocional debe ser menor al precio normal.'); return; }
    // Existencias del snack de reventa: validar antes de tocar nada.
    let reventa;
    if (tipo === 'snack') {
      if (!controlar) reventa = reventaActual ? null : undefined;
      else {
        const piezas = parseFloat(piezasVenta);
        if (!Number.isFinite(piezas) || piezas <= 0) { setError('Indica cuántas piezas se descuentan por venta (normalmente 1).'); return; }
        const minimo = nvMinimo === '' ? null : parseFloat(nvMinimo);
        const maximo = nvMaximo === '' ? null : parseFloat(nvMaximo);
        if (minimo !== null && (!Number.isFinite(minimo) || minimo < 0)) { setError('El mínimo debe ser un número positivo o cero.'); return; }
        if (maximo !== null && (!Number.isFinite(maximo) || maximo < 0)) { setError('"Reabastecer hasta" debe ser un número positivo.'); return; }
        if (maximo !== null && minimo !== null && maximo < minimo) { setError('"Reabastecer hasta" debe ser mayor o igual al mínimo.'); return; }
        if (insumoSel === 'nuevo') {
          const existencia = nvExistencia === '' ? 0 : parseFloat(nvExistencia);
          const costo = nvCosto === '' ? 0 : parseFloat(nvCosto);
          if (!Number.isFinite(existencia) || existencia < 0 || !Number.isFinite(costo) || costo < 0) { setError('Existencia inicial y costo por pieza deben ser números positivos o cero.'); return; }
          reventa = { nuevo: { nombre: name.trim(), stockActual: existencia, costoUnitario: costo, stockMinimo: minimo ?? 0, stockMaximo: maximo }, cantidad: piezas };
        } else {
          reventa = { insumoId: insumoSel, cantidad: piezas, niveles: { stockMinimo: minimo, stockMaximo: maximo } };
        }
      }
    }
    setError('');
    const base = { ...(imagenCambiada?{imagen:imagen||null}:{}), name: name.trim(), cat, icon: icon.trim() || '☕', tipo, price: precioNum, precioPromocional: promoNum, descripcion: descripcion.trim(), estacion: conEstacion ? estacion : 'barra' };
    setSaving(true);
    // El insumo nuevo se crea primero (con el nombre del producto, en piezas);
    // los niveles de un insumo existente se actualizan antes de guardar.
    if (reventa && reventa.nuevo) {
      try {
        const cats = await api.getMateriasCategorias();
        const catNombre = (cats.find(c => /otros|snacks|reventa/i.test(c.nombre)) || cats[0] || {}).nombre;
        if (!catNombre) throw new Error('No hay categorías de insumos en esta sucursal.');
        const m = await api.crearMateria({ ...reventa.nuevo, categoria: catNombre, unidad: 'pieza', proveedorId: null });
        reventa = { insumoId: m.id, cantidad: reventa.cantidad };
      } catch (e) { setError(`No se pudo crear el insumo: ${e.message}`); setSaving(false); return; }
    } else if (reventa && reventa.niveles) {
      const { niveles, ...resto } = reventa;
      const patch = {};
      if (niveles.stockMinimo !== null && niveles.stockMinimo !== Number(insumoElegido && insumoElegido.stockMinimo)) patch.stockMinimo = niveles.stockMinimo;
      const maxActual = insumoElegido && insumoElegido.stockMaximo !== undefined ? insumoElegido.stockMaximo : null;
      if ((niveles.stockMaximo ?? null) !== (maxActual ?? null)) patch.stockMaximo = niveles.stockMaximo;
      if (Object.keys(patch).length) {
        try { await api.actualizarMateria(resto.insumoId, patch); }
        catch (e) { setError(`No se pudieron guardar los niveles del insumo: ${e.message}`); setSaving(false); return; }
      }
      reventa = resto;
    }
    const activo = isNew ? true : producto.activo !== false;
    const ok = await onSave(
      tipo === 'snack'
        ? { id: isNew ? undefined : producto.id, ...base, reventa, sizes: false, leche: false, coffeeType: false, extras: false, frio: false, activo }
        : tipo === 'alimento'
          ? { id: isNew ? undefined : producto.id, ...base, sizes: false, leche: false, coffeeType: false, extras, frio: false, activo }
          : { id: isNew ? undefined : producto.id, ...base, sizes, leche, coffeeType: tipo === 'bebida' ? coffeeType : false, extras, frio, activo }
    );
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Sheet title={isNew ? 'Agregar producto' : 'Editar producto'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre</div>
        <input className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Chai Latte" />
      </div>
      <div className="option-group">
        <div className="option-label">Imagen del producto</div>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          {imagen?<img src={imagen} alt="Vista previa del producto" style={{width:110,height:110,objectFit:'contain',borderRadius:12,background:'#f3eee5'}}/>:<span style={{fontSize:48}}>{icon}</span>}
          <div>
            <button className="btn-secondary" disabled={leyendoImagen||saving} onClick={()=>imagenRef.current?.click()}>{leyendoImagen?'Preparando imagen…':imagen?'Cambiar imagen':'Subir imagen'}</button>
            {imagen&&<button className="link-danger" disabled={leyendoImagen||saving} onClick={()=>{setImagen('');setImagenCambiada(true);}}>Quitar imagen</button>}
          </div>
        </div>
        <input ref={imagenRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Seleccionar imagen del producto" hidden onChange={subirImagen}/>
        <div className="field-hint">JPG, PNG o WebP. La imagen se ajusta automáticamente y aparece en el menú al guardar.</div>
      </div>
      <div className="option-group two-col">
        <div>
          <div className="option-label">Ícono (emoji)</div>
          <input className="text-input" value={icon} onChange={e => setIcon(e.target.value)} placeholder="☕" maxLength={4} />
        </div>
        <div>
          <div className="option-label">Precio normal ($)</div>
          <input className="text-input" type="number" step="0.5" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div className="option-group two-col">
        <div>
          <div className="option-label">Precio promocional ($, opcional)</div>
          <input className="text-input" type="number" step="0.5" value={promo} onChange={e => setPromo(e.target.value)} placeholder="Vacío = sin promoción" />
        </div>
        <div>
          <div className="option-label">Descripción corta</div>
          <input className="text-input" value={descripcion} maxLength={140} onChange={e => setDescripcion(e.target.value)} placeholder="Ej. Espresso con leche espumada" />
        </div>
      </div>
      {promo !== '' && <div className="field-hint" style={{ marginTop: -6, marginBottom: 12 }}>Mientras tenga precio promocional, se cobra ese precio y la pantalla del negocio muestra el normal tachado. Bórralo para volver al precio normal.</div>}
      <div className="option-group">
        <div className="option-label">Categoría del menú</div>
        <CategoriaChips opciones={catsMenu} value={cat} onChange={setCat} onCrear={crearCategoriaMenu} placeholder="Ej. Tés, Postres, Desayunos…" />
        <div className="field-hint">Las categorías nuevas aparecen en Caja, en la app del cliente y en la pantalla del negocio; el orden se ajusta en Configuración → Categorías.</div>
      </div>
      <div className="option-group">
        <div className="option-label">Tipo de preparación</div>
        <div className="option-row">
          <button className={`option-chip ${tipo === 'bebida' ? 'selected' : ''}`} onClick={() => setTipo('bebida')}>Bebida (espresso)</button>
          <button className={`option-chip ${tipo === 'frappe' ? 'selected' : ''}`} onClick={() => setTipo('frappe')}>Frappé</button>
          <button className={`option-chip ${tipo === 'alimento' ? 'selected' : ''}`} onClick={() => { setTipo('alimento'); if (estacion === 'barra' || estacion === 'caja') setEstacion('parrilla'); }}>Parrilla / cocina</button>
          <button className={`option-chip ${tipo === 'snack' ? 'selected' : ''}`} onClick={() => { setTipo('snack'); if (estacion === 'barra') setEstacion('parrilla'); }}>Comprado hecho</button>
        </div>
        <div className="field-hint">
          {tipo === 'alimento'
            ? 'Hamburguesas, tortas, platillos: llevan una receta con varios ingredientes del inventario; cada venta los descuenta y su costo es la suma. Los ingredientes se capturan en Recetas al guardar.'
            : tipo === 'snack'
              ? 'Galletas, refrescos, aguas embotelladas, pan empacado: no se prepara, se compra hecho y se controla por piezas.'
              : 'Se prepara en barra con café, leche y vaso según lo que elija el cliente.'}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">¿Quién lo prepara? (comanda)</div>
        {conEstacion ? (
          <div className="option-row">
            {(tipo === 'alimento' ? ['parrilla', 'barra'] : ['parrilla', 'barra', 'caja']).map(e => (
              <button key={e} type="button" className={`option-chip ${estacion === e ? 'selected' : ''}`} onClick={() => setEstacion(e)}>{ESTACION_LABELS[e]}</button>
            ))}
          </div>
        ) : (
          <div className="option-row"><button type="button" className="option-chip selected" disabled>Barra</button></div>
        )}
        <div className="field-hint">
          {!conEstacion
            ? 'Las bebidas y frappés siempre van a la comanda de la barra (barista).'
            : estacion === 'caja'
              ? 'No pasa por ninguna comanda: es un producto empacado que la Caja entrega al momento (galletas, botellas…).'
              : estacion === 'parrilla'
                ? 'Aparece en la comanda del parrillero.'
                : 'Aparece en la comanda del barista.'}
        </div>
      </div>
      {tipo === 'snack' && (
        <div className="option-group reventa-block">
          <div className="option-label">Existencias (lo compramos hecho)</div>
          <div className="option-row">
            <button type="button" className={`option-chip ${!controlar ? 'selected' : ''}`} onClick={() => setControlar(false)}>Sin control</button>
            <button type="button" className={`option-chip ${controlar ? 'selected' : ''}`} onClick={() => setControlar(true)}>Controlar existencias</button>
          </div>
          {!controlar && <div className="field-hint">Sin control no sabrás cuántos quedan ni cuándo pedir; el costo se estima como 40 % del precio.</div>}
          {controlar && (
            <>
              <label className="option-label" htmlFor="reventa-insumo" style={{ marginTop: 12 }}>Insumo del inventario que se descuenta</label>
              <select id="reventa-insumo" className="text-input" value={insumoSel} onChange={e => elegirInsumo(e.target.value)}>
                <option value="nuevo">➕ Crear insumo nuevo: «{name.trim() || 'nombre del producto'}» (piezas)</option>
                {insumosPieza.map(m => <option key={m.id} value={m.id}>{m.nombre} — quedan {formatNumeroInput(m.stockActual)} pzas</option>)}
                {reventaActual && !insumosPieza.some(m => m.id === reventaActual.insumoId) && <option value={reventaActual.insumoId}>{reventaActual.nombre}</option>}
              </select>
              <div className="option-group two-col" style={{ marginTop: 10 }}>
                <div>
                  <div className="option-label">Piezas por venta</div>
                  <input className="text-input" type="number" min="0.001" step="1" value={piezasVenta} onChange={e => setPiezasVenta(e.target.value)} />
                </div>
                {insumoSel === 'nuevo' ? (
                  <div>
                    <div className="option-label">Existencia inicial (pzas)</div>
                    <input className="text-input" type="number" min="0" step="1" value={nvExistencia} onChange={e => setNvExistencia(e.target.value)} placeholder="0" />
                  </div>
                ) : (
                  <div>
                    <div className="option-label">Quedan</div>
                    <div className="reventa-stock">{insumoElegido ? `${formatNumeroInput(insumoElegido.stockActual)} pzas · costo ${money(insumoElegido.costoUnitario)} c/u` : '—'}</div>
                  </div>
                )}
              </div>
              <div className="option-group two-col">
                {insumoSel === 'nuevo' && (
                  <div>
                    <div className="option-label">Costo por pieza ($)</div>
                    <input className="text-input" type="number" min="0" step="0.01" value={nvCosto} onChange={e => setNvCosto(e.target.value)} placeholder="0.00" />
                  </div>
                )}
                <div>
                  <div className="option-label">Avísame cuando queden menos de</div>
                  <input className="text-input" type="number" min="0" step="1" value={nvMinimo} onChange={e => setNvMinimo(e.target.value)} placeholder="Ej. 5" />
                </div>
                <div>
                  <div className="option-label">Reabastecer hasta (opcional)</div>
                  <input className="text-input" type="number" min="0" step="1" value={nvMaximo} onChange={e => setNvMaximo(e.target.value)} placeholder="Ej. 30" />
                </div>
              </div>
              <div className="field-hint">
                Cada venta descuenta las piezas del inventario y el costo del snack será lo que pagaste por pieza. Las compras siguientes se registran en
                <strong> Inventario → Registrar compra</strong>. Al bajar del mínimo aparece en "Stock bajo" con la cantidad a pedir; en 0 el menú lo marca "Agotado".
              </div>
            </>
          )}
        </div>
      )}
      {tipo === 'alimento' && (
        <div className="option-group">
          <div className="option-label">Personalización que permite</div>
          <div className="option-row">
            <button className={`option-chip ${extras ? 'selected' : ''}`} onClick={() => setExtras(v => !v)}>Extras (tocino, queso extra…)</button>
          </div>
          <div className="field-hint">Los extras de parrilla/cocina se configuran en Opciones → Extras con "Aplica a: alimentos"; solo esos se ofrecen en este producto.</div>
        </div>
      )}
      {tipo !== 'snack' && tipo !== 'alimento' && (
        <div className="option-group">
          <div className="option-label">Personalización que permite</div>
          <div className="option-row">
            <button className={`option-chip ${sizes ? 'selected' : ''}`} onClick={() => setSizes(v => !v)}>Tamaños</button>
            <button className={`option-chip ${leche ? 'selected' : ''}`} onClick={() => setLeche(v => !v)}>Leche</button>
            {tipo === 'bebida' && <button className={`option-chip ${coffeeType ? 'selected' : ''}`} onClick={() => setCoffeeType(v => !v)}>Tipo de café</button>}
            <button className={`option-chip ${extras ? 'selected' : ''}`} onClick={() => setExtras(v => !v)}>Extras</button>
            <button className={`option-chip ${frio ? 'selected' : ''}`} onClick={() => setFrio(v => !v)}>Bebida fría</button>
          </div>
        </div>
      )}
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" disabled={saving||leyendoImagen} onClick={submit}>{saving ? 'Guardando…' : (isNew ? 'Agregar producto' : 'Guardar cambios')}</button>
      </div>
    </Sheet>
  );
}

// Unidades compatibles con la unidad base de una materia prima.
function unidadesCompatibles(unidadMateria) {
  const fam = unidadFamilia(unidadMateria);
  if (fam === 'peso') return ['g', 'kg'];
  if (fam === 'volumen') return ['ml', 'l'];
  return ['pieza'];
}

// Al capturar una receta lo natural son gramos y mililitros; la unidad
// grande (kg/l) queda disponible en el selector para quien la prefiera.
function unidadRecetaDefault(unidadMateria) {
  const fam = unidadFamilia(unidadMateria);
  if (fam === 'peso') return 'g';
  if (fam === 'volumen') return 'ml';
  return 'pieza';
}

export function RecetaFormSheet({ product, receta, onClose, onSave }) {
  const isFrappe = product.tipo === 'frappe';
  // Alimento (parrilla/cocina): solo ingredientes del inventario, pasos,
  // tiempo de preparación y temperatura/término; sin café, leche ni molino.
  const isAlimento = product.tipo === 'alimento';
  const defaults = buildRecipe(product, { size: '12', milk: 'entera', coffeeType: 'tradicional', extras: [] }, null);
  const [pasos, setPasos] = useState((receta && receta.pasos && receta.pasos.length ? receta.pasos : defaults.pasos).join('\n'));
  const [gramaje, setGramaje] = useState(String((receta && receta.gramajePorShot) || 18));
  const [molienda, setMolienda] = useState((receta && receta.molienda) || (isFrappe ? 'Gruesa' : 'Media-fina'));
  const [moliendaEspecial, setMoliendaEspecial] = useState((receta && receta.moliendaEspecial) || 'Media (origen)');
  const [ajusteMolino, setAjusteMolino] = useState((receta && receta.ajusteMolino) || '3.5');
  const [ajusteMolinoEspecial, setAjusteMolinoEspecial] = useState((receta && receta.ajusteMolinoEspecial) || '4.2');
  const [tiempoExtraccion, setTiempoExtraccion] = useState((receta && (receta.tiempoExtraccion || receta.tiempoLicuado)) || (isAlimento ? '' : isFrappe ? '25-30 s' : '26-30 s'));
  const [tiempoExtraccionEspecial, setTiempoExtraccionEspecial] = useState((receta && (receta.tiempoExtraccionEspecial || receta.tiempoExtraccion)) || '26-30 s');
  const [temperatura, setTemperatura] = useState((receta && receta.temperatura) || (isAlimento ? '' : isFrappe ? 'Frío / con hielo' : (product.frio ? '92°C / servir frío' : '92°C')));
  const [texturaLeche, setTexturaLeche] = useState((receta && receta.texturaLeche) || 'Microespuma suave y sedosa');
  const [error, setError] = useState('');

  // ---- Ingredientes base: leche por tamaño ----
  // El café se dosifica por shot (gramaje) y la leche por tamaño. Por defecto
  // la leche es la de la sucursal (igual para todas las bebidas); aquí se puede
  // fijar una cantidad propia para ESTE producto.
  const tamanos = (product.sizes ? SIZE_OPTIONS : SIZE_OPTIONS.filter(t => t.id === '12')).length
    ? (product.sizes ? SIZE_OPTIONS : SIZE_OPTIONS.filter(t => t.id === '12'))
    : [{ id: '12', label: '12 oz' }];
  const lecheSede = Object.fromEntries(tamanos.map(t => [t.id, t.lecheMl !== undefined ? t.lecheMl : ({ 8: 180, 12: 280, 16: 360 }[t.id] || 280)]));
  const [lechePropia, setLechePropia] = useState(!!(receta && receta.lecheMl));
  const [lecheMl, setLecheMl] = useState(() => Object.fromEntries(tamanos.map(t => [
    t.id, String((receta && receta.lecheMl && receta.lecheMl[t.id] !== undefined) ? receta.lecheMl[t.id] : lecheSede[t.id]),
  ])));

  // ---- Ingredientes de la receta (insumos del inventario) ----
  // De aquí sale el costo directo del producto: cada ingrediente descuenta
  // inventario al preparar y suma su costo al precio sugerido.
  const [materias, setMaterias] = useState([]);
  const [insumos, setInsumos] = useState(null); // null = cargando
  const [categoriaReceta, setCategoriaReceta] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');

  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.getMaterias(),
      api.getReceta(product.id),
      api.getCategoriasProducto(),
    ]).then(([mats, det, categorias]) => {
      if (!vivo) return;
      setCategoriaReceta(categorias.find(c => c.nombre === product.cat)?.id || null);
      setMaterias(mats.map(m => ({
        activo: m.activo !== false,
        categoriasUso: m.categorias_uso || [],
        id: m.id,
        nombre: m.nombre,
        unidad: normalizeUnidad(m.unidad),
        costoUnitario: Number(m.costo_unitario || 0),
      })));
      setInsumos((det && det.insumos_fijos ? det.insumos_fijos : []).map(f => ({
        materiaPrimaId: f.materia_prima_id,
        cantidad: String(Number(f.cantidad)),
        unidad: normalizeUnidad(f.unidad),
      })));
    }).catch(e => { if (vivo) setErrorCarga(e.message); });
    return () => { vivo = false; };
  }, [product.id]);

  const disponibles = materias.filter(m => m.activo && m.categoriasUso.includes(categoriaReceta));
  const materiaDe = id => materias.find(m => m.id === id);
  const agregarInsumo = () => {
    const libre = disponibles.find(m => !(insumos || []).some(i => i.materiaPrimaId === m.id));
    if (!libre) return;
    setInsumos(ins => [...(ins || []), { materiaPrimaId: libre.id, cantidad: '', unidad: unidadRecetaDefault(libre.unidad) }]);
  };
  const cambiarInsumo = (idx, patch) => setInsumos(ins => ins.map((i, n) => {
    if (n !== idx) return i;
    const next = { ...i, ...patch };
    if (patch.materiaPrimaId) {
      const m = materiaDe(patch.materiaPrimaId);
      if (m) next.unidad = unidadRecetaDefault(m.unidad);
    }
    return next;
  }));
  const quitarInsumo = idx => setInsumos(ins => ins.filter((_, n) => n !== idx));

  // Costo en vivo de los ingredientes capturados (convertidos a la unidad de
  // cada materia prima). El costo total del producto además incluye café,
  // leche y empaque según las opciones elegidas en cada venta.
  const costoInsumos = (insumos || []).reduce((sum, i) => {
    const m = materiaDe(i.materiaPrimaId);
    const cantidad = Number(i.cantidad);
    if (!m || !Number.isFinite(cantidad) || cantidad <= 0) return sum;
    const convertida = convertirCantidad(cantidad, i.unidad, m.unidad);
    return convertida === null ? sum : sum + convertida * Number(m.costoUnitario || 0);
  }, 0);

  const submit = () => {
    const pasosArr = pasos.split('\n').map(s => s.trim()).filter(Boolean);
    if (pasosArr.length === 0) { setError('Agrega al menos un paso.'); return; }
    for (const i of (insumos || [])) {
      const n = Number(i.cantidad);
      if (!Number.isFinite(n) || n <= 0) { setError('Cada ingrediente necesita una cantidad mayor a 0.'); return; }
    }
    let lecheMlPorTamano = null;
    if (product.leche && lechePropia) {
      lecheMlPorTamano = {};
      for (const t of tamanos) {
        const n = Number(lecheMl[t.id]);
        if (!Number.isFinite(n) || n < 0) { setError(`Indica los ml de leche para ${t.label}.`); return; }
        lecheMlPorTamano[t.id] = n;
      }
    }
    if (!isAlimento && (!isFrappe || product.coffeeType)) {
      const g = Number(gramaje);
      if (!Number.isFinite(g) || g <= 0) { setError('El gramaje de café por shot debe ser mayor a 0.'); return; }
    }
    if (isAlimento && (insumos || []).length === 0) { setError('Agrega al menos un ingrediente del inventario: de ahí salen el costo y el descuento de inventario.'); return; }
    setError('');
    const insumosFijos = (insumos || []).map(i => ({ materiaPrimaId: i.materiaPrimaId, cantidad: Number(i.cantidad), unidad: i.unidad }));
    onSave(product.id, isAlimento
      ? { pasos: pasosArr, tiempoExtraccion: tiempoExtraccion.trim() || undefined, temperatura: temperatura.trim() || undefined, insumosFijos }
      : isFrappe
        ? { pasos: pasosArr, gramajePorShot: product.coffeeType ? Number(gramaje) : undefined, molienda, tiempoLicuado: tiempoExtraccion, temperatura, insumosFijos, lecheMlPorTamano }
        : { pasos: pasosArr, gramajePorShot: Number(gramaje) || 18, molienda, moliendaEspecial, ajusteMolino, ajusteMolinoEspecial, tiempoExtraccion, tiempoExtraccionEspecial, temperatura, texturaLeche, insumosFijos, lecheMlPorTamano }
    );
    onClose();
  };

  return (
    <Sheet title={`Editar receta: ${product.name}`} onClose={onClose}>
      {!isAlimento && <div className="option-group">
        <div className="option-label">Ingredientes base (se ajustan al tamaño y opciones que elija el cliente)</div>
        <div className="spec-table">
          {(!isFrappe || product.coffeeType) && (
            <div className="spec-row base-ing-row">
              <span className="spec-label">☕ Café <small>(el tipo lo elige el cliente)</small></span>
              <span className="base-ing-inputs">
                <input className="text-input" type="number" min="1" step="0.5" inputMode="decimal" value={gramaje} onChange={e => setGramaje(e.target.value)} />
                <span className="base-ing-unit">g por shot</span>
              </span>
            </div>
          )}
          {product.leche && (
            <div className="spec-row base-ing-row column">
              <div className="base-ing-head">
                <span className="spec-label">🥛 Leche <small>(el tipo lo elige el cliente)</small></span>
                <span className="option-row">
                  <button type="button" className={`option-chip small ${!lechePropia ? 'selected' : ''}`} onClick={() => { setLechePropia(false); setLecheMl(Object.fromEntries(tamanos.map(t => [t.id, String(lecheSede[t.id])]))); }}>De la sucursal</button>
                  <button type="button" className={`option-chip small ${lechePropia ? 'selected' : ''}`} onClick={() => setLechePropia(true)}>Propia del producto</button>
                </span>
              </div>
              <div className="base-ing-sizes">
                {tamanos.map(t => (
                  <label key={t.id} className="base-ing-size">
                    <span>{t.label}</span>
                    <input className="text-input" type="number" min="0" step="10" inputMode="numeric" disabled={!lechePropia}
                           value={lecheMl[t.id] ?? ''} onChange={e => setLecheMl(v => ({ ...v, [t.id]: e.target.value }))} />
                    <span className="base-ing-unit">ml</span>
                  </label>
                ))}
              </div>
              {lechePropia && <div className="field-hint">Predeterminado de la sucursal: {tamanos.map(t => `${t.label} ${lecheSede[t.id]} ml`).join(' · ')}.</div>}
            </div>
          )}
          <div className="spec-row base-ing-row">
            <span className="spec-label">🥤 Vaso y tapa <small>(según tamaño y si es fría/caliente/frappé)</small></span>
            <span className="spec-value">1 pieza c/u</span>
          </div>
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>El café se elige al vender y su recargo se configura en Opciones → Cafés. No lo agregues otra vez como ingrediente fijo. Los ingredientes base se descuentan del inventario con la materia prima que corresponda a lo que el cliente pida (tipo de café, tipo de leche, tamaño). El vaso y la tapa de cada tamaño son los mismos para todas las bebidas de la sucursal.</div>
      </div>}

      <div className="option-group">
        <div className="option-label">{isAlimento ? 'Ingredientes de la receta (del inventario)' : 'Ingredientes fijos de este producto (del inventario)'}</div>
        <div className="field-hint">Ingredientes para {product.cat}. Para habilitar un insumo, marca esta categoría en Inventario → Se utiliza en.</div>
        {errorCarga && <FormError>{errorCarga}</FormError>}
        {insumos !== null && !disponibles.length && <p>No hay insumos clasificados para {product.cat}. Los ingredientes existentes se conservan.</p>}
        {insumos === null ? (
          <div className="field-hint">Cargando ingredientes…</div>
        ) : (
          <>
            {insumos.length === 0 && <div className="field-hint" style={{ marginBottom: 8 }}>{isAlimento ? 'Sin ingredientes todavía. Agrega todo lo que lleva una porción: pan, carne, queso, verduras, salsas, empaque…' : 'Sin ingredientes fijos todavía. Agrega los insumos que lleva esta bebida (jarabes, chocolate, toppings…).'}</div>}
            {insumos.map((i, idx) => {
              const m = materiaDe(i.materiaPrimaId);
              return (
                <div key={idx} className="insumo-row">
                  <select className="text-input" value={i.materiaPrimaId} onChange={e => cambiarInsumo(idx, { materiaPrimaId: e.target.value })}>
                    {materias.filter(mp => mp.id === i.materiaPrimaId || disponibles.some(d => d.id === mp.id)).map(mp => <option key={mp.id} value={mp.id}>{mp.nombre}{!disponibles.some(d => d.id === mp.id) ? " (ya incluido en la receta)" : ""}</option>)}
                  </select>
                  <input className="text-input" type="number" min="0" step={unidadStep(i.unidad)} placeholder="Cant."
                         value={i.cantidad} onChange={e => cambiarInsumo(idx, { cantidad: e.target.value })} />
                  <select className="text-input" value={i.unidad} onChange={e => cambiarInsumo(idx, { unidad: e.target.value })}>
                    {(m ? unidadesCompatibles(m.unidad) : [i.unidad]).map(u => <option key={u} value={u}>{unidadDisplay(u)}</option>)}
                  </select>
                  <button className="icon-btn small" onClick={() => quitarInsumo(idx)} aria-label="Quitar ingrediente"><Trash2 size={14} /></button>
                </div>
              );
            })}
            <div className="insumo-foot">
              <button className="btn-secondary" onClick={agregarInsumo} disabled={!disponibles.some(m => !(insumos || []).some(i => i.materiaPrimaId === m.id))}><Plus size={14} /> Agregar ingrediente</button>
              {insumos.length > 0 && <span className="insumo-costo">Costo de estos ingredientes: <strong>${costoInsumos.toFixed(2)}</strong></span>}
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>{isAlimento ? 'Cada venta descuenta estas cantidades del inventario (más los extras que elija el cliente). Al guardar, el costo del producto y su precio sugerido se actualizan solos.' : 'Jarabes, chocolate, toppings… todo lo que lleva esta bebida además de los ingredientes base. Al guardar, el costo del producto y su precio sugerido se actualizan solos.'}</div>
          </>
        )}
      </div>
      <div className="option-group">
        <div className="option-label">Pasos de preparación (uno por línea)</div>
        <textarea className="notes-input" rows={6} value={pasos} onChange={e => setPasos(e.target.value)} />
      </div>
      {isAlimento && (
        <div className="option-group two-col">
          <div>
            <div className="option-label">Tiempo de preparación (opcional)</div>
            <input className="text-input" value={tiempoExtraccion} onChange={e => setTiempoExtraccion(e.target.value)} placeholder="Ej. 8-10 min" />
          </div>
          <div>
            <div className="option-label">Temperatura / término (opcional)</div>
            <input className="text-input" value={temperatura} onChange={e => setTemperatura(e.target.value)} placeholder="Ej. plancha a fuego medio, término medio" />
          </div>
        </div>
      )}
      {!isFrappe && !isAlimento && (
        <div className="option-group">
          <div className="option-label">Tiempo extracción (tradicional)</div>
          <input className="text-input" value={tiempoExtraccion} onChange={e => setTiempoExtraccion(e.target.value)} placeholder="26-30 s" />
        </div>
      )}
      {isFrappe && (
        <div className="option-group">
          <div className="option-label">Tiempo de licuado</div>
          <input className="text-input" value={tiempoExtraccion} onChange={e => setTiempoExtraccion(e.target.value)} placeholder="25-30 s" />
        </div>
      )}
      {!isAlimento && <div className="option-group two-col">
        <div>
          <div className="option-label">Molienda{!isFrappe ? ' (tradicional)' : ''}</div>
          <input className="text-input" value={molienda} onChange={e => setMolienda(e.target.value)} />
        </div>
        {!isFrappe && (
          <div>
            <div className="option-label">Ajuste molino (tradicional)</div>
            <input className="text-input" value={ajusteMolino} onChange={e => setAjusteMolino(e.target.value)} />
          </div>
        )}
      </div>}
      {!isFrappe && !isAlimento && (
        <div className="option-group two-col">
          <div>
            <div className="option-label">Molienda (origen especial)</div>
            <input className="text-input" value={moliendaEspecial} onChange={e => setMoliendaEspecial(e.target.value)} />
          </div>
          <div>
            <div className="option-label">Ajuste molino (especial)</div>
            <input className="text-input" value={ajusteMolinoEspecial} onChange={e => setAjusteMolinoEspecial(e.target.value)} />
          </div>
        </div>
      )}
      {!isFrappe && !isAlimento && (
        <div className="option-group">
          <div className="option-label">Tiempo extracción (origen especial)</div>
          <input className="text-input" value={tiempoExtraccionEspecial} onChange={e => setTiempoExtraccionEspecial(e.target.value)} placeholder="26-30 s" />
        </div>
      )}
      {!isAlimento && <div className="option-group">
        <div className="option-label">Temperatura de servicio</div>
        <input className="text-input" value={temperatura} onChange={e => setTemperatura(e.target.value)} />
      </div>}
      {product.leche && !isFrappe && (
        <div className="option-group">
          <div className="option-label">Textura de la leche</div>
          <input className="text-input" value={texturaLeche} onChange={e => setTexturaLeche(e.target.value)} placeholder="Microespuma suave y sedosa" />
        </div>
      )}
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <button className="btn-ghost" onClick={() => { onSave(product.id, null); onClose(); }}>Restaurar predeterminada</button>
        <button className="btn-primary" disabled={insumos === null || !!errorCarga} onClick={submit}>Guardar receta</button>
      </div>
    </Sheet>
  );
}

// Identidad del negocio (por sucursal): nombre + logo.
export function BrandingEditor({ nombreNegocio, logo, lema: lemaProp, onSave }) {
  const [nombre, setNombre] = useState(nombreNegocio || '');
  const [lema, setLema] = useState(lemaProp || '');
  useEffect(() => { setLema(lemaProp || ''); }, [lemaProp]);
  const [logoLocal, setLogoLocal] = useState(logo || '');
  const [guardando, setGuardando] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { setNombre(nombreNegocio || ''); }, [nombreNegocio]);
  useEffect(() => { setLogoLocal(logo || ''); }, [logo]);

  const elegirLogo = async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try { setLogoLocal(await redimensionarImagen(file, 256)); } catch { /* imagen inválida */ }
  };

  const cambiado = nombre.trim() !== (nombreNegocio || '') || logoLocal !== (logo || '') || lema.trim() !== (lemaProp || '');
  const guardar = async () => { setGuardando(true); await onSave({ nombreNegocio: nombre.trim(), logo: logoLocal, lema: lema.trim() }); setGuardando(false); };

  return (
    <div className="branding-editor">
      <div className="option-label">Nombre del negocio (esta sucursal)</div>
      <input className="text-input" value={nombre} maxLength={60} placeholder="Mi Cafetería"
             onChange={e => setNombre(e.target.value)} />
      <div className="option-label" style={{ marginTop: 12 }}>Lema (va bajo el nombre en la pantalla del negocio)</div>
      <input className="text-input" value={lema} maxLength={80} placeholder="Ej. Entre montañas y café" onChange={e => setLema(e.target.value)} />
      <div className="branding-logo-row">
        <div className="branding-logo-preview">{logoLocal ? <img src={logoLocal} alt="logo" /> : <Coffee size={28} />}</div>
        <div className="branding-logo-actions">
          <button className="btn-secondary" onClick={() => fileRef.current && fileRef.current.click()}>Subir logo</button>
          {logoLocal && <button className="link-toggle" onClick={() => setLogoLocal('')}>Quitar logo</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={elegirLogo} />
        </div>
      </div>
      <div className="branding-hint">El logo se ajusta solo a 256 px. En el menú de TV reemplaza al ícono y al nombre para no repetirlos. Si quitas el logo, vuelve la taza de café con el nombre del negocio.</div>
      <button className="btn-primary full" style={{ marginTop: 12 }} disabled={!cambiado || guardando} onClick={guardar}>
        {guardando ? 'Guardando…' : 'Guardar identidad'}
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// COSTO Y PRECIO: el corazón del flujo inventario → receta → precio. Muestra
// el costo calculado por el sistema (directo según la receta + prorrateo de
// gastos fijos) y deja al administrador UNA sola decisión: el margen. El
// precio sugerido se calcula en vivo y se aplica al menú con un clic.
// ----------------------------------------------------------------------------
export function PrecioCostoSheet({ producto, onClose, onAplicar }) {
  const [data, setData] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [margen, setMargen] = useState('');
  const [margenPropio, setMargenPropio] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.getPrecioSugerido(producto.id)
      .then(d => {
        if (!vivo) return;
        setData(d);
        const propio = d.margen_producto !== null && d.margen_producto !== undefined;
        setMargenPropio(propio);
        setMargen(String(Number(propio ? d.margen_producto : (d.margen_aplicado ?? d.margen_sucursal ?? 60))));
      })
      .catch(e => vivo && setErrorCarga(e.message));
    return () => { vivo = false; };
  }, [producto.id]);

  if (errorCarga) {
    return (
      <Sheet title={`Costo y precio: ${producto.name}`} onClose={onClose}>
        <FormError>{errorCarga}</FormError>
      </Sheet>
    );
  }
  if (!data) {
    return (
      <Sheet title={`Costo y precio: ${producto.name}`} onClose={onClose}>
        <div className="field-hint">Calculando costos según la receta…</div>
      </Sheet>
    );
  }

  // Margen de CONTRIBUCIÓN: precio = insumo / (1 - margen), nunca por debajo
  // del piso (insumo + su parte de gastos fijos costeables).
  const costoDirecto = Number(data.costo_directo || 0);
  const costoTotal = Number(data.costo_total || 0);
  const redondeo = Number(data.redondeo || 1);
  const margenNum = Number(margen);
  const margenValido = Number.isFinite(margenNum) && margenNum > 0 && margenNum < 100;
  const precioPorMargen = margenValido ? costoDirecto / (1 - margenNum / 100) : null;
  const precioCalc = precioPorMargen === null ? null : Math.ceil(Math.max(precioPorMargen, costoTotal) / redondeo) * redondeo;
  const pisoManda = precioPorMargen !== null && costoTotal > precioPorMargen;
  const sinIndirecto = data.costo_indirecto_unitario === null || data.costo_indirecto_unitario === undefined;
  const ORIGEN = { producto: 'propio de este producto', categoria: `de la categoría ${data.categoria_nombre || ''}`.trim(), sede: 'general de la sede' };

  const filas = [
    ['Costo de los insumos', data.costo_directo],
    ['Su parte de los gastos fijos', sinIndirecto ? null : data.costo_indirecto_unitario],
    ['Piso: por debajo de esto, pierdes', data.precio_punto_equilibrio],
    ['Precio actual en el menú', data.precio_base],
    ['Margen que deja hoy ese precio', data.margen_actual === null || data.margen_actual === undefined ? null : `${Number(data.margen_actual).toFixed(1)}%`, 'texto'],
  ];

  const aplicar = async () => {
    setAplicando(true);
    const ok = await onAplicar(producto.id, {
      price: precioCalc,
      margenPorcentaje: margenPropio ? margenNum : null,
    });
    setAplicando(false);
    if (ok !== false) onClose();
  };

  return (
    <Sheet title={`Costo y precio: ${producto.name}`} onClose={onClose}>
      <div className="spec-table" style={{ marginBottom: 16 }}>
        {filas.map(([etiqueta, valor, formato]) => (
          <div key={etiqueta} className="spec-row">
            <span className="spec-label">{etiqueta}</span>
            <span className="spec-value">{valor === null || valor === undefined ? '—' : formato === 'texto' ? valor : `$${Number(valor).toFixed(2)}`}</span>
          </div>
        ))}
      </div>
      {sinIndirecto && (
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Todavía no se puede calcular el piso: hacen falta ventas de los últimos 30 días o las "unidades estimadas al mes" en Costos.
        </div>
      )}

      <div className="option-group">
        <div className="option-label">Margen de contribución</div>
        <div className="field-hint" style={{ marginBottom: 8 }}>
          De cada peso vendido, cuánto queda después de pagar los insumos. Ahora mismo se aplica el {ORIGEN[data.margen_origen] || 'general'}.
        </div>
        <div className="option-row" style={{ marginBottom: 8 }}>
          <button className={`option-chip ${!margenPropio ? 'selected' : ''}`}
                  onClick={() => { setMargenPropio(false); setMargen(String(Number(data.margen_categoria ?? data.margen_sucursal ?? 60))); }}>
            {data.margen_categoria !== null && data.margen_categoria !== undefined
              ? `De ${data.categoria_nombre || 'su categoría'} (${Number(data.margen_categoria)}%)`
              : `De la sucursal (${Number(data.margen_sucursal ?? 60)}%)`}
          </button>
          <button className={`option-chip ${margenPropio ? 'selected' : ''}`} onClick={() => setMargenPropio(true)}>
            Propio de este producto
          </button>
        </div>
        <input className="text-input" type="number" min="1" max="99" step="1" value={margen}
               disabled={!margenPropio}
               onChange={e => setMargen(e.target.value)} placeholder="%" />
        {!margenValido && margen !== '' && <FormError>El margen de contribución debe ser mayor que 0 y menor que 100.</FormError>}
      </div>

      <div className="precio-sugerido-card">
        <span className="footer-label">
          {pisoManda
            ? 'Precio sugerido (manda el piso: con ese margen no pagas tus gastos fijos)'
            : `Precio sugerido = ${money(costoDirecto)} ÷ (1 − ${margenValido ? margenNum : '—'}%)`}
        </span>
        <span className="price-total big">{precioCalc === null ? '—' : `$${precioCalc.toFixed(2)}`}</span>
      </div>

      <div className="sheet-footer">
        <button className="btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn-primary" disabled={!margenValido || aplicando} onClick={aplicar}>
          {aplicando ? 'Aplicando…' : `Aplicar al menú${precioCalc !== null ? ` ($${precioCalc.toFixed(2)})` : ''}`}
        </button>
      </div>
    </Sheet>
  );
}

// ----------------------------------------------------------------------------
// REGISTRAR COMPRA: el insumo se da de alta UNA vez; cada compra es un LOTE
// de ese mismo insumo (cantidad, costo, caducidad). El sistema descuenta por
// PEPS (primero el lote más viejo) y el costo de esta compra pasa a ser el
// costo de referencia — si el proveedor subió el precio, "precios por
// revisar" avisará qué productos repreciar.
// ----------------------------------------------------------------------------
export function CompraSheet({ materia, proveedores, onClose, onSave }) {
  const unidadMateria = normalizeUnidad(materia.unidad);
  const pres = materia.presentacion || null;
  const [porPaquetes, setPorPaquetes] = useState(!!pres);
  const [paquetes, setPaquetes] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [unidad, setUnidad] = useState(unidadMateria);
  const [costoTotal, setCostoTotal] = useState('');
  const [proveedorId, setProveedorId] = useState(materia.proveedorId || '');
  const [numeroLote, setNumeroLote] = useState('');
  const [fechaCaducidad, setFechaCaducidad] = useState('');
  const [pago, setPago] = useState({ cuentaDineroId: null, pagado: true }); // Contabilidad: con qué se pagó
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const paquetesNum = Number(paquetes);
  const cantidadNum = Number(cantidad);
  const costoNum = Number(costoTotal);
  // Cantidad comprada en la unidad de control, para mostrar existencias y costo resultantes.
  const cantidadControl = porPaquetes && pres
    ? (Number.isFinite(paquetesNum) && paquetesNum > 0 ? convertirCantidad(paquetesNum * Number(pres.cantidad), pres.unidad, unidadMateria) : null)
    : (Number.isFinite(cantidadNum) && cantidadNum > 0 ? convertirCantidad(cantidadNum, unidad, unidadMateria) : null);
  const unitario = cantidadControl && Number.isFinite(costoNum) && costoNum > 0 ? costoNum / cantidadControl : null;

  const submit = async () => {
    if (porPaquetes && pres) {
      if (!Number.isFinite(paquetesNum) || paquetesNum <= 0) { setError(`Indica cuántos ${pres.nombre}s compraste.`); return; }
    } else if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) { setError('Indica la cantidad comprada.'); return; }
    if (!Number.isFinite(costoNum) || costoNum <= 0) { setError('Indica cuánto pagaste en total por esta compra.'); return; }
    setError('');
    setSaving(true);
    const ok = await onSave(materia, {
      ...(porPaquetes && pres ? { paquetes: paquetesNum, cantidadComprada: cantidadControl, unidad: unidadMateria } : { cantidadComprada: cantidadNum, unidad }),
      costoTotal: costoNum,
      proveedorId: proveedorId || null,
      numeroLote: numeroLote.trim() || undefined,
      fechaCaducidad: fechaCaducidad || undefined,
      cuentaDineroId: pago.pagado ? pago.cuentaDineroId : null,
      pagado: pago.pagado,
    });
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Sheet title={`Registrar compra: ${materia.nombre}`} onClose={onClose}>
      <div className="field-hint" style={{ marginBottom: 14 }}>
        Stock actual: <strong>{materia.stockActual} {unidadDisplay(unidadMateria)}</strong>. La compra se suma como un lote de este mismo insumo (no se crea un insumo nuevo) y queda registrada en el historial de inventario.
      </div>
      {pres && (
        <div className="option-group">
          <div className="option-row">
            <button type="button" className={`option-chip ${porPaquetes ? 'selected' : ''}`} onClick={() => setPorPaquetes(true)}>Por {pres.nombre}s ({formatNumeroInput(pres.cantidad)} {unidadDisplay(pres.unidad)} c/u)</button>
            <button type="button" className={`option-chip ${!porPaquetes ? 'selected' : ''}`} onClick={() => setPorPaquetes(false)}>Por cantidad suelta</button>
          </div>
        </div>
      )}
      {porPaquetes && pres ? (
        <div className="option-group">
          <div className="option-label">¿Cuántos {pres.nombre}s compraste?</div>
          <input className="text-input" type="number" min="0" step="1" value={paquetes} onChange={e => setPaquetes(e.target.value)} placeholder="Ej. 3" />
          {cantidadControl !== null && <div className="field-hint">= {formatNumeroInput(cantidadControl)} {unidadDisplay(unidadMateria)} que se suman al inventario.</div>}
        </div>
      ) : (
        <div className="option-group two-col">
          <div>
            <div className="option-label">Cantidad comprada</div>
            <input className="text-input" type="number" min="0" step={unidadStep(unidad)} value={cantidad} onChange={e => setCantidad(e.target.value)} placeholder="0" />
          </div>
          <div>
            <div className="option-label">Unidad</div>
            <select className="text-input" value={unidad} onChange={e => setUnidad(e.target.value)}>
              {unidadesCompatibles(unidadMateria).map(u => <option key={u} value={u}>{unidadDisplay(u)}</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="option-group">
        <div className="option-label">Costo total de la compra ($)</div>
        <input className="text-input" type="number" min="0" step="0.01" value={costoTotal} onChange={e => setCostoTotal(e.target.value)} placeholder="0.00" />
        {unitario !== null && (
          <div className="field-hint">Sale a <strong>${unitario.toFixed(4)}</strong> por {unidadDisplay(unidadMateria)} — este pasa a ser el costo de referencia del insumo (si cambió, el panel de Productos te avisará qué precios revisar).</div>
        )}
      </div>
      {proveedores.length > 0 && (
        <div className="option-group">
          <div className="option-label">Proveedor de esta compra</div>
          <div className="option-row">
            <button className={`option-chip ${!proveedorId ? 'selected' : ''}`} onClick={() => setProveedorId('')}>Sin proveedor</button>
            {proveedores.map(p => (
              <button key={p.id} className={`option-chip ${proveedorId === p.id ? 'selected' : ''}`} onClick={() => setProveedorId(p.id)}>{p.nombre}</button>
            ))}
          </div>
        </div>
      )}
      <div className="option-group two-col">
        <div>
          <div className="option-label">Número de lote (opcional)</div>
          <input className="text-input" value={numeroLote} onChange={e => setNumeroLote(e.target.value)} placeholder="Ej. L-2024-08" />
        </div>
        <div>
          <div className="option-label">Caducidad (opcional)</div>
          <input className="text-input" type="date" value={fechaCaducidad} onChange={e => setFechaCaducidad(e.target.value)} />
        </div>
      </div>
      <PagoCuentaPicker value={pago} onChange={setPago} hint={pago.pagado ? "La compra sale de esta cuenta y entra al inventario (no es gasto: se reconoce al consumir)." : "Queda como cuenta por pagar en Contabilidad; márcala pagada cuando liquides al proveedor."} />
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Registrando…' : 'Registrar compra'}</button>
      </div>
    </Sheet>
  );
}

// AJUSTAR STOCK: para correcciones de conteo físico (se contó de más o de
// menos). Deja rastro en el historial y mantiene el saldo de los lotes.
export function AjusteStockSheet({ materia, onClose, onSave }) {
  const unidadMateria = normalizeUnidad(materia.unidad);
  const [nuevaCantidad, setNuevaCantidad] = useState(String(materia.stockActual ?? ''));
  const [motivo, setMotivo] = useState('');
  const [fechaCaducidad, setFechaCaducidad] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const nuevaNum = Number(nuevaCantidad);
  const diferencia = Number.isFinite(nuevaNum) ? nuevaNum - Number(materia.stockActual || 0) : null;

  const submit = async () => {
    if (!nuevaCantidad.trim() || !Number.isFinite(nuevaNum) || nuevaNum < 0) { setError('Indica la cantidad contada (0 o más).'); return; }
    if (materia.requiereLote && !motivo.trim()) { setError('Indica el motivo de la corrección.'); return; }
    setError('');
    setSaving(true);
    const ok = await onSave(materia, { nuevaCantidad: nuevaNum, motivo: motivo.trim() || undefined, stockEsperado: Number(materia.stockActual), fechaCaducidad: fechaCaducidad || undefined });
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Sheet title={`Ajustar stock: ${materia.nombre}`} onClose={onClose}>
      <div className="field-hint" style={{ marginBottom: 14 }}>
        En el sistema hay <strong>{materia.stockActual} {unidadDisplay(unidadMateria)}</strong>. Escribe lo que contaste físicamente; la diferencia queda registrada como ajuste. Para compras usa "Registrar compra" y para pérdidas usa una merma — así el historial explica cada cambio.
      </div>
      {materia.requiereLote && <div className="field-hint" style={{ marginBottom: 14 }}>
        Si reduces la cantidad, se descontará de los lotes más antiguos. Si la aumentas, se creará un lote identificado como ajuste, sin registrar un gasto de compra. Los costos del insumo se conservan.
      </div>}
      {materia.requiereLote && diferencia > 0 && <div className="option-group">
        <div className="option-label">Caducidad de las existencias encontradas (si aplica)</div>
        <input className="text-input" type="date" value={fechaCaducidad} onChange={e => setFechaCaducidad(e.target.value)} />
      </div>}
      <div className="option-group">
        <div className="option-label">Cantidad contada ({unidadDisplay(unidadMateria)})</div>
        <input className="text-input" type="number" min="0" step={unidadStep(unidadMateria)} value={nuevaCantidad} onChange={e => setNuevaCantidad(e.target.value)} />
        {diferencia !== null && diferencia !== 0 && (
          <div className="field-hint">Diferencia contra el sistema: <strong>{diferencia > 0 ? '+' : ''}{Number(diferencia.toFixed(3))} {unidadDisplay(unidadMateria)}</strong></div>
        )}
      </div>
      <div className="option-group">
        <div className="option-label">Motivo {materia.requiereLote ? '(obligatorio)' : '(opcional)'}</div>
        <input className="text-input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej. Corrección de cantidad al dar de alta" />
      </div>
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <span />
        <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Ajustando…' : 'Guardar ajuste'}</button>
      </div>
    </Sheet>
  );
}

// ----------------------------------------------------------------------------
// COSTOS INDIRECTOS. Un gasto fijo existe aunque no se venda nada (renta,
// sueldos, gasolina, luz…). La suma mensual de la sede se divide entre las
// unidades que se espera vender al mes y eso es el "costo indirecto" que se
// suma al costo de receta de CADA bebida.
// ----------------------------------------------------------------------------
export const GASTO_CATEGORIAS = ['Renta', 'Personal', 'Servicios', 'Transporte', 'Seguros', 'Mantenimiento', 'Financiero', 'Impuestos', 'Otro'];

// Chips "¿con qué se pagó?" (Caja / Banco / queda por pagar). Carga las cuentas
// de dinero de la sede si no se le pasan. value = { cuentaDineroId, pagado }.
export function PagoCuentaPicker({ value, onChange, cuentas: cuentasProp, permitirPorPagar = true, label = '¿Con qué se pagó?', hint }) {
  const [cuentas, setCuentas] = useState(cuentasProp || []);
  useEffect(() => {
    if (cuentasProp) { setCuentas(cuentasProp); return undefined; }
    let vivo = true;
    api.getCuentasDinero().then(rows => { if (!vivo) return; setCuentas(rows); if (value.pagado && !value.cuentaDineroId && rows[0]) onChange({ cuentaDineroId: rows[0].id, pagado: true }); }).catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuentasProp]);
  if (!cuentas.length) return null;
  return (
    <div className="option-group">
      <div className="option-label">{label}</div>
      <div className="option-row">
        {cuentas.map(c => (
          <button key={c.id} type="button" className={`option-chip ${value.pagado && value.cuentaDineroId === c.id ? 'selected' : ''}`} onClick={() => onChange({ cuentaDineroId: c.id, pagado: true })}>{c.tipo === 'efectivo' ? '💵' : '🏦'} {c.nombre}</button>
        ))}
        {permitirPorPagar && <button type="button" className={`option-chip ${!value.pagado ? 'selected' : ''}`} onClick={() => onChange({ cuentaDineroId: null, pagado: false })}>Queda por pagar</button>}
      </div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function GastoFijoFormSheet({ gasto, onClose, onSave }) {
  const isNew = !gasto || !gasto.id;
  const [concepto, setConcepto] = useState(gasto ? gasto.concepto || '' : '');
  const [categoria, setCategoria] = useState(gasto ? gasto.categoria || 'Otro' : 'Renta');
  const [monto, setMonto] = useState(gasto && gasto.monto_mensual !== undefined ? String(Number(gasto.monto_mensual)) : '');
  // Contabilidad: a qué cuenta va cada pago real, con qué se paga y qué día.
  const [cuentas, setCuentas] = useState([]);
  const [cuentaContableId, setCuentaContableId] = useState(gasto ? gasto.cuenta_contable_id || '' : '');
  const [pago, setPago] = useState({ cuentaDineroId: gasto ? gasto.cuenta_dinero_id || null : null, pagado: true });
  const [diaPago, setDiaPago] = useState(gasto && gasto.dia_pago ? String(gasto.dia_pago) : '1');
  useEffect(() => { let vivo = true; api.getCuentasContables().then(r => { if (vivo) setCuentas(r.filter(c => c.activo !== false)); }).catch(() => {}); return () => { vivo = false; }; }, []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const montoNum = Number(monto);
    if (!concepto.trim()) { setError('Describe el gasto (ej. "Renta del local").'); return; }
    if (!Number.isFinite(montoNum) || montoNum < 0) { setError('Indica el monto mensual (puede ser 0).'); return; }
    const dia = Number(diaPago);
    if (!Number.isInteger(dia) || dia < 1 || dia > 28) { setError('El día de pago debe estar entre 1 y 28.'); return; }
    setError('');
    setSaving(true);
    const ok = await onSave({ id: isNew ? null : gasto.id, concepto: concepto.trim(), categoria, montoMensual: Math.round(montoNum * 100) / 100, cuentaContableId: cuentaContableId ? Number(cuentaContableId) : undefined, cuentaDineroId: pago.cuentaDineroId || null, diaPago: dia });
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Sheet title={isNew ? 'Nuevo gasto fijo' : 'Editar gasto fijo'} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Concepto</div>
        <input className="text-input" value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej. Renta del local" autoFocus />
      </div>
      <div className="option-group">
        <div className="option-label">Categoría</div>
        <div className="option-row">
          {GASTO_CATEGORIAS.map(c => (
            <button key={c} type="button" className={`option-chip ${categoria === c ? 'selected' : ''}`} onClick={() => setCategoria(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Monto mensual ($)</div>
        <input className="text-input" type="number" min="0" step="0.01" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} placeholder="Ej. 3500" />
        <div className="field-hint">Si el gasto no es mensual (ej. un seguro anual), divídelo: $5,400 al año = $450 al mes.</div>
      </div>
      {cuentas.length > 0 && (
        <div className="option-group">
          <div className="option-label">Cuenta contable (Contabilidad)</div>
          <select className="text-input" value={cuentaContableId} onChange={e => setCuentaContableId(e.target.value)}>
            <option value="">Según la categoría</option>
            {['gasto_operacion', 'gasto_financiero', 'impuesto'].map(g => (
              <optgroup key={g} label={{ gasto_operacion: 'Gastos de operación', gasto_financiero: 'Gastos financieros', impuesto: 'Impuestos' }[g]}>
                {cuentas.filter(c => c.grupo === g).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </optgroup>
            ))}
          </select>
          <div className="field-hint">Cada mes, Contabilidad → Egresos te propone este gasto para confirmar el pago real en esta cuenta.</div>
        </div>
      )}
      <div className="option-group two-col">
        <div>
          <div className="option-label">Día de pago (1-28)</div>
          <input className="text-input" type="number" min="1" max="28" step="1" value={diaPago} onChange={e => setDiaPago(e.target.value)} />
        </div>
      </div>
      <PagoCuentaPicker value={pago} onChange={setPago} permitirPorPagar={false} label="Normalmente se paga con" />
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : (isNew ? 'Agregar gasto' : 'Guardar cambios')}</button>
      </div>
    </Sheet>
  );
}

export function MargenConfigSheet({ config, onClose, onSave }) {
  const [margen, setMargen] = useState(config && config.porcentaje_ganancia_normal !== undefined ? String(Number(config.porcentaje_ganancia_normal)) : '60');
  const [redondeo, setRedondeo] = useState(config && config.redondeo !== undefined ? String(Number(config.redondeo)) : '1');
  const [unidades, setUnidades] = useState(config && config.unidades_estimadas_mes ? String(Number(config.unidades_estimadas_mes)) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const real = config && config.ventas_reales_promedio_mes;

  const submit = async () => {
    const m = Number(margen); const r = Number(redondeo); const u = unidades === '' ? null : Number(unidades);
    if (!Number.isFinite(m) || m <= 0 || m >= 100) { setError('El margen de contribución debe ser mayor que 0 y menor que 100.'); return; }
    if (![0.5, 1, 5, 10].includes(r)) { setError('Elige un redondeo.'); return; }
    if (u !== null && (!Number.isInteger(u) || u < 1)) { setError('Las unidades estimadas al mes deben ser un número entero mayor a 0 (o déjalo vacío).'); return; }
    setError('');
    setSaving(true);
    const ok = await onSave({ porcentajeGananciaNormal: m, redondeo: r, unidadesEstimadasMes: u });
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Sheet title="Margen general y redondeo" onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Margen de contribución general (%)</div>
        <input className="text-input" type="number" min="1" max="99" step="1" inputMode="numeric" value={margen} onChange={e => setMargen(e.target.value)} />
        <div className="field-hint">
          De cada peso vendido, cuánto queda después de pagar los insumos: <code>precio = insumo ÷ (1 − margen)</code>.
          Con 60 %, un producto de $10 de insumo se sugiere en $25. Solo se usa cuando el producto y su categoría no tienen margen propio.
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Redondear precios a</div>
        <div className="option-row">
          {[['0.5', '$0.50'], ['1', '$1'], ['5', '$5'], ['10', '$10']].map(([v, l]) => (
            <button key={v} type="button" className={`option-chip ${Number(redondeo) === Number(v) ? 'selected' : ''}`} onClick={() => setRedondeo(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Unidades que esperas vender al mes</div>
        <input className="text-input" type="number" min="1" step="1" inputMode="numeric" value={unidades} onChange={e => setUnidades(e.target.value)} placeholder="Ej. 1200" />
        <div className="field-hint">
          Solo se usa mientras la sede no tiene 30 días de ventas: sirve para estimar el piso de los precios. En cuanto haya historia, el reparto se hace con lo que realmente vendiste.
          {real && Number(real.unidades_promedio_mes) > 0 && (
            <> Tu venta real promedio es de <strong>{Number(real.unidades_promedio_mes)} unidades/mes</strong> ({real.meses_de_historia} mes(es) de historia).</>
          )}
        </div>
        {real && Number(real.unidades_promedio_mes) > 0 && (
          <button type="button" className="link-toggle" style={{ marginTop: 6 }} onClick={() => setUnidades(String(Number(real.unidades_promedio_mes)))}>Usar mi venta real ({Number(real.unidades_promedio_mes)})</button>
        )}
      </div>
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </Sheet>
  );
}

// ----------------------------------------------------------------------------
// OPCIONES DE PERSONALIZACIÓN (tamaños, tipos de café, leches, extras).
// El "ajuste de precio" es lo que el cliente ve como (+6) al personalizar y
// lo que el servidor suma al cobrar. `calcularCosto` (lo pasa la sección) da
// el costo estimado de la opción según el inventario, para sugerir el ajuste.
// ----------------------------------------------------------------------------
export const OPCION_TIPO_LABEL = { tamanos: 'tamaño', leches: 'tipo de leche', cafes: 'tipo de café', extras: 'extra' };

export function OpcionFormSheet({ tipo, opcion, materias, margen, redondeo, calcularCosto, onClose, onSave }) {
  const isNew = !opcion || !opcion.id;
  const esShot = !!(opcion && opcion.es_shot_adicional);
  const [etiqueta, setEtiqueta] = useState(opcion ? opcion.etiqueta || '' : '');
  const [automatico, setAutomatico] = useState(!!opcion?.precio_automatico);
  const [delta, setDelta] = useState(opcion && opcion.delta_precio !== undefined ? String(Number(opcion.delta_precio)) : '');
  const [materiaId, setMateriaId] = useState((opcion && opcion.materia_prima_id) || (tipo !== 'tamanos' && !esShot && materias[0] ? materias[0].id : ''));
  const [descuenta, setDescuenta] = useState(tipo !== 'extras' || esShot || !!(opcion ? opcion.materia_prima_id : true));
  // Extras: a qué productos se ofrecen (bebidas | alimentos de parrilla/cocina).
  const [aplicaA, setAplicaA] = useState((opcion && opcion.aplica_a) || 'bebidas');
  const materia = materias.find(m => m.id === materiaId);
  // La porción se muestra en la unidad chica de su familia (0.015 l -> 15 ml).
  const porcionInicial = (() => {
    if (!opcion || !opcion.cantidad) return { cantidad: '', unidad: materia ? unidadRecetaDefault(materia.unidad) : 'g' };
    const u = normalizeUnidad(opcion.unidad); const chica = unidadRecetaDefault(u);
    const conv = convertirCantidad(Number(opcion.cantidad), u, chica);
    return conv === null ? { cantidad: String(Number(opcion.cantidad)), unidad: u } : { cantidad: String(Math.round(conv * 1000) / 1000), unidad: chica };
  })();
  const [cantidad, setCantidad] = useState(porcionInicial.cantidad);
  const [unidad, setUnidad] = useState(porcionInicial.unidad);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const cambiarMateria = id => {
    setMateriaId(id);
    const m = materias.find(x => x.id === id);
    if (m) setUnidad(unidadRecetaDefault(m.unidad));
  };

  const usaInsumo = tipo !== 'tamanos' && !esShot && (tipo !== 'extras' || descuenta);
  const costo = esShot
    ? calcularCosto('shot', {})
    : (tipo === 'tamanos' ? (opcion ? Number(opcion.costo_extra) : null)
      : (usaInsumo && materia ? calcularCosto(tipo, { materiaPrimaId: materiaId, cantidad: Number(cantidad), unidad }) : null));
  const sugerido = (() => {
    if (costo === null || costo === undefined || !Number.isFinite(costo)) return null;
    if (Math.abs(costo) < 0.005) return 0;
    const r = Number(redondeo) > 0 ? Number(redondeo) : 1;
    return Math.sign(costo) * Math.ceil((Math.abs(costo) * (1 + Number(margen) / 100)) / r - 1e-9) * r;
  })();

  const submit = async () => {
    const d = Number(delta);
    if (!etiqueta.trim()) { setError('Ingresa el nombre.'); return; }
    if (!Number.isFinite(d)) { setError('Indica el ajuste de precio (puede ser 0 o negativo).'); return; }
    if (usaInsumo && !materiaId) { setError('Elige la materia prima que descuenta esta opción.'); return; }
    if (tipo === 'extras' && usaInsumo && (!Number.isFinite(Number(cantidad)) || Number(cantidad) <= 0)) { setError('Indica la porción del extra (mayor a 0).'); return; }
    setError('');
    const body = { etiqueta: etiqueta.trim(), deltaPrecio: Math.round(d * 100) / 100 };
    if (tipo === 'cafes') body.precioAutomatico = automatico;
    if (tipo === 'leches' || tipo === 'cafes') body.materiaPrimaId = materiaId;
    if (tipo === 'extras' && !esShot) {
      body.materiaPrimaId = usaInsumo ? materiaId : null;
      body.cantidad = usaInsumo ? Number(cantidad) : null;
      body.unidad = usaInsumo ? unidad : null;
      body.aplicaA = aplicaA;
    }
    setSaving(true);
    const ok = await onSave(tipo, isNew ? null : opcion.id, body);
    setSaving(false);
    if (ok !== false) onClose();
  };

  const nombreTipo = OPCION_TIPO_LABEL[tipo] || 'opción';
  return (
    <Sheet title={isNew ? `Nuevo ${nombreTipo}` : `Editar ${nombreTipo}: ${opcion.etiqueta}`} onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Nombre que ve el cliente</div>
        <input className="text-input" value={etiqueta} onChange={e => setEtiqueta(e.target.value)} placeholder={tipo === 'extras' ? 'Ej. Canela' : 'Ej. Leche de coco'} disabled={tipo === 'tamanos'} />
      </div>

      {tipo === 'extras' && !esShot && (
        <div className="option-group">
          <div className="option-label">Aplica a</div>
          <div className="option-row">
            <button type="button" className={`option-chip ${aplicaA === 'bebidas' ? 'selected' : ''}`} onClick={() => setAplicaA('bebidas')}>Bebidas</button>
            <button type="button" className={`option-chip ${aplicaA === 'alimentos' ? 'selected' : ''}`} onClick={() => setAplicaA('alimentos')}>Parrilla / cocina</button>
          </div>
          <div className="field-hint">{aplicaA === 'alimentos' ? 'Se ofrece en hamburguesas, tortas y demás alimentos (tocino, queso extra, doble carne…).' : 'Se ofrece en bebidas y frappés (jarabes, crema, shot extra…).'}</div>
        </div>
      )}
      {tipo === 'extras' && !esShot && (
        <div className="option-group">
          <div className="option-label">Inventario</div>
          <div className="option-row">
            <button type="button" className={`option-chip ${descuenta ? 'selected' : ''}`} onClick={() => setDescuenta(true)}>Descuenta un insumo</button>
            <button type="button" className={`option-chip ${!descuenta ? 'selected' : ''}`} onClick={() => setDescuenta(false)}>Sin insumo (solo cobro)</button>
          </div>
        </div>
      )}
      {esShot && <div className="field-hint" style={{ marginBottom: 12 }}>El shot extra suma un shot más de café (gramaje de la receta) del tipo que el cliente haya elegido.</div>}

      {usaInsumo && (
        <div className="option-group">
          <div className="option-label">{tipo === 'extras' ? 'Insumo y porción por venta' : 'Materia prima que descuenta'}</div>
          {tipo === 'extras' ? (
            <div className="insumo-row">
              <select className="text-input" value={materiaId} onChange={e => cambiarMateria(e.target.value)}>
                {materias.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              <input className="text-input" type="number" min="0" step={unidadStep(unidad)} placeholder="Cant." value={cantidad} onChange={e => setCantidad(e.target.value)} />
              <select className="text-input" value={unidad} onChange={e => setUnidad(e.target.value)}>
                {(materia ? unidadesCompatibles(materia.unidad) : [unidad]).map(u => <option key={u} value={u}>{unidadDisplay(u)}</option>)}
              </select>
              <span />
            </div>
          ) : (
            <select className="text-input" value={materiaId} onChange={e => cambiarMateria(e.target.value)}>
              {materias.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          )}
          {tipo === 'leches' && <div className="field-hint">Se descuenta la misma cantidad de ml que la leche entera según el tamaño de la bebida.</div>}
          {tipo === 'cafes' && <div className="field-hint">Se descuenta el gramaje por shot de cada receta, igual que el café tradicional.</div>}
        </div>
      )}

      <div className="option-group">
        {tipo === 'cafes' && <label className="field-hint"><input type="checkbox" checked={automatico} onChange={e => setAutomatico(e.target.checked)} /> Calcular automáticamente con costo por gramo, gramaje de la receta, margen y redondeo del negocio</label>}
        <div className="option-label">Ajuste al precio ($, puede ser negativo)</div>
        <input className="text-input" type="number" step="0.5" inputMode="decimal" disabled={tipo === 'cafes' && automatico} value={tipo === 'cafes' && automatico ? sugerido ?? delta : delta} onChange={e => setDelta(e.target.value)} placeholder="0" />
        <div className="opcion-costo-card">
          <div>
            <div className="opcion-costo-label">Costo estimado de esta opción</div>
            <div className="opcion-costo-value">{costo === null || costo === undefined || !Number.isFinite(costo) ? '—' : `$${Number(costo).toFixed(2)}`}</div>
          </div>
          <div>
            <div className="opcion-costo-label">Sugerido (costo + {Number(margen)}%)</div>
            <div className="opcion-costo-value brand">{sugerido === null ? '—' : `$${sugerido.toFixed(2)}`}</div>
          </div>
          {sugerido !== null && !automatico && <button type="button" className="btn-secondary" onClick={() => setDelta(String(sugerido))}>Usar sugerido</button>}
        </div>
        <div className="field-hint">Este ajuste se suma al precio del producto cuando el cliente elige la opción; aparece como "(+{delta || 0})" en la app, en caja y como referencia en la pantalla del negocio.</div>
      </div>
      <FormError>{error}</FormError>
      <div className="sheet-footer">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Guardando…' : (isNew ? 'Crear' : 'Guardar cambios')}</button>
      </div>
    </Sheet>
  );
}

// Pantalla del negocio (TV): estilo y pie de página. Los precios y productos
// salen del catálogo; aquí solo se elige cómo se ve.
export function PantallaConfigEditor({ cfg, onSave }) {
  const [personalizacion, setPersonalizacion] = useState(cfg?.pantallaPersonalizacion || {});
  const [estilo, setEstilo] = useState((cfg && cfg.pantallaEstilo) || 'pizarra');
  const [pie, setPie] = useState((cfg && cfg.piePantalla) || '');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setPersonalizacion(cfg?.pantallaPersonalizacion || {}); setEstilo((cfg && cfg.pantallaEstilo) || 'pizarra'); setPie((cfg && cfg.piePantalla) || ''); }, [cfg]);
  const cambiado = JSON.stringify(personalizacion) !== JSON.stringify(cfg?.pantallaPersonalizacion || {}) || estilo !== ((cfg && cfg.pantallaEstilo) || 'pizarra') || pie.trim() !== ((cfg && cfg.piePantalla) || '');
  return (
    <div className="branding-editor" style={{ marginTop: 12 }}>
      <div className="option-label">Estilo de la pantalla</div>
      <div className="option-row">
        <button type="button" className={`option-chip ${estilo === 'ilustrado' ? 'selected' : ''}`} onClick={() => setEstilo('ilustrado')}>Menú con imágenes</button>
        <button type="button" className={`option-chip ${estilo === 'pizarra' ? 'selected' : ''}`} onClick={() => setEstilo('pizarra')}>Pizarra (oscuro, como el menú impreso)</button>
        <button type="button" className={`option-chip ${estilo === 'clasico' ? 'selected' : ''}`} onClick={() => setEstilo('clasico')}>Clásico</button>
      </div>
      {estilo === 'ilustrado' && <TvPersonalizationEditor value={personalizacion} onChange={setPersonalizacion} products={PRODUCTS} options={{ cafes: COFFEE_OPTIONS, leches: MILK_OPTIONS, extras: EXTRA_OPTIONS }}/>}
      <div className="option-label" style={{ marginTop: 12 }}>Pie de la pantalla (frases separadas por •)</div>
      <input className="text-input" value={pie} maxLength={120} placeholder="Ej. Café de Chiapas • Hecho al momento • Con pasión" onChange={e => setPie(e.target.value)} />
      <div className="branding-hint">La pizarra muestra la descripción corta de cada producto (se captura al editar el producto) y tacha el precio normal cuando hay precio promocional. No muestra tamaños: el precio es el de la bebida estándar.</div>
      <button className="btn-primary full" style={{ marginTop: 12 }} disabled={!cambiado || guardando}
              onClick={async () => { setGuardando(true); try { await onSave({ pantallaEstilo: estilo, piePantalla: pie.trim(), pantallaPersonalizacion: personalizacion }); } finally { setGuardando(false); } }}>
        {guardando ? 'Guardando…' : 'Guardar pantalla'}
      </button>
    </div>
  );
}

// Cortesías: cupo mensual de la sucursal para el rol cajero (todos los cajeros
// lo comparten). Con 0, cada cortesía pasa directo a Autorizaciones.
export function CortesiasConfigEditor({ cupo, onSave }) {
  const [valor, setValor] = useState(String(cupo ?? 0));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setValor(String(cupo ?? 0)); }, [cupo]);
  const n = Number(valor);
  const valido = valor.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 999;
  const cambiado = valido && n !== Number(cupo ?? 0);
  return (
    <div className="branding-editor" style={{ marginTop: 12 }}>
      <label className="option-label" htmlFor="cortesias-mes">Productos de cortesía permitidos por mes (rol cajero)</label>
      <input id="cortesias-mes" className="text-input" type="number" inputMode="numeric" min="0" max="999" step="1" value={valor} onChange={e => setValor(e.target.value)} />
      <div className="branding-hint">
        Es un cupo compartido por todos los cajeros de esta sucursal; se reinicia cada mes (hora de Ciudad de México). Cada cortesía deja el ticket completo en $0.
        Al agotarse, la Caja puede seguir dando cortesías, pero cada una queda pendiente en <strong>Autorizaciones</strong> hasta que un administrador la apruebe o rechace.
      </div>
      {!valido && <FormError>Escribe un número entero entre 0 y 999.</FormError>}
      <button className="btn-primary full" style={{ marginTop: 12 }} disabled={!cambiado || guardando}
              onClick={async () => { setGuardando(true); await onSave({ cortesiasMesCajero: n }); setGuardando(false); }}>
        {guardando ? 'Guardando…' : 'Guardar cupo de cortesías'}
      </button>
    </div>
  );
}

// Mesas de la sucursal: la Caja elige "Mesa 1..N", "Barra" o "Para llevar"
// antes de cobrar y la comanda lo muestra en grande.
export function MesasConfigEditor({ mesas, onSave }) {
  const [valor, setValor] = useState(String(mesas ?? 4));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setValor(String(mesas ?? 4)); }, [mesas]);
  const n = Number(valor);
  const valido = valor.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 200;
  const cambiado = valido && n !== Number(mesas ?? 4);
  return (
    <div className="branding-editor" style={{ marginTop: 12 }}>
      <label className="option-label" htmlFor="mesas-sede">Cantidad de mesas</label>
      <input id="mesas-sede" className="text-input" type="number" inputMode="numeric" min="0" max="200" step="1" value={valor} onChange={e => setValor(e.target.value)} />
      <div className="branding-hint">Se numeran solas (Mesa 1, Mesa 2…). "Barra" y "Para llevar" siempre están disponibles. Con 0, la Caja solo elige entre Barra y Para llevar.</div>
      {!valido && <FormError>Escribe un número entero entre 0 y 200.</FormError>}
      <button className="btn-primary full" style={{ marginTop: 12 }} disabled={!cambiado || guardando}
              onClick={async () => { setGuardando(true); await onSave({ mesas: n }); setGuardando(false); }}>
        {guardando ? 'Guardando…' : 'Guardar mesas'}
      </button>
    </div>
  );
}

// Configuración → Categorías: renombrar, reordenar (menú) y borrar categorías
// del menú y de insumos. Borrar solo se permite si nada las usa (la API avisa).
function CategoriaFila({ c, onRename, onDelete, onUp, onDown, primera, ultima }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(c.nombre);
  const [busy, setBusy] = useState(false);
  const guardar = async () => {
    const n = nombre.trim();
    if (n.length < 2 || n === c.nombre) { setEditando(false); setNombre(c.nombre); return; }
    setBusy(true);
    try { await onRename(c, n); setEditando(false); } finally { setBusy(false); }
  };
  return (
    <div className="categoria-fila">
      {editando ? (
        <input className="text-input" value={nombre} maxLength={40} autoFocus onChange={e => setNombre(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } if (e.key === 'Escape') { setEditando(false); setNombre(c.nombre); } }} />
      ) : (
        <span className="categoria-nombre">{c.nombre}{c.uso !== undefined && <span className="categoria-uso"> · {c.uso} {c.usoLabel}</span>}</span>
      )}
      <div className="categoria-acciones">
        {onUp && <button type="button" className="icon-btn small" disabled={primera} aria-label="Subir" onClick={() => onUp(c)}>↑</button>}
        {onDown && <button type="button" className="icon-btn small" disabled={ultima} aria-label="Bajar" onClick={() => onDown(c)}>↓</button>}
        {editando
          ? <button type="button" className="link-toggle" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button>
          : <button type="button" className="link-toggle" onClick={() => setEditando(true)}>Renombrar</button>}
        <button type="button" className="link-danger" onClick={() => onDelete(c)}>Borrar</button>
      </div>
    </div>
  );
}

export function CategoriasEditor({ productos = [], materias = [], addToast, onChanged }) {
  const [menu, setMenu] = useState(null);
  const [insumos, setInsumos] = useState(null);
  const [nuevoMenu, setNuevoMenu] = useState('');
  const [nuevoInsumo, setNuevoInsumo] = useState('');
  const cargar = React.useCallback(async () => {
    const [m, i] = await Promise.all([api.getCategoriasProducto(), api.getMateriasCategorias()]);
    setMenu(m); setInsumos(i);
  }, []);
  useEffect(() => { cargar().catch(e => addToast(e.message, 'warn')); }, [cargar, addToast]);
  const usoMenu = c => productos.filter(p => p.cat === c.nombre).length;
  const usoInsumo = c => materias.filter(m => m.categoria === c.nombre).length;
  const run = async (fn, okMsg) => {
    try { await fn(); await cargar(); await onChanged(); if (okMsg) addToast(okMsg, 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const mover = async (c, dir) => {
    const ids = menu.map(x => x.id);
    const i = ids.indexOf(c.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await run(() => api.ordenarCategoriasProducto(ids));
  };
  const confirmarBorrado = (c, uso, que) => {
    if (uso > 0) { addToast(`No se puede borrar "${c.nombre}": ${uso} ${que} la usan. Cámbialos de categoría primero.`, 'warn'); return false; }
    return window.confirm(`¿Borrar la categoría "${c.nombre}"?`);
  };
  return (
    <div className="categorias-editor">
      <div>
        <div className="section-title">Categorías del menú</div>
        <div className="field-hint" style={{ marginBottom: 8 }}>Son las pestañas de Caja, la app del cliente y la pantalla del negocio, en este orden.</div>
        {menu === null ? <p className="field-hint">Cargando…</p> : menu.map((c, idx) => (
          <CategoriaFila key={c.id} c={{ ...c, uso: usoMenu(c), usoLabel: 'producto(s)' }} primera={idx === 0} ultima={idx === menu.length - 1}
            onUp={x => mover(x, -1)} onDown={x => mover(x, 1)}
            onRename={(x, n) => run(() => api.actualizarCategoriaProducto(x.id, n), 'Categoría renombrada')}
            onDelete={x => confirmarBorrado(x, usoMenu(x), 'producto(s)') && run(() => api.eliminarCategoriaProducto(x.id), 'Categoría borrada')} />
        ))}
        <div className="categoria-nueva">
          <input className="text-input" value={nuevoMenu} maxLength={40} placeholder="Nueva categoría del menú (Ej. Tés)" onChange={e => setNuevoMenu(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter' && nuevoMenu.trim().length >= 2) { e.preventDefault(); run(() => api.crearCategoriaProducto(nuevoMenu.trim()), 'Categoría creada').then(() => setNuevoMenu('')); } }} />
          <button type="button" className="btn-secondary" disabled={nuevoMenu.trim().length < 2} onClick={() => run(() => api.crearCategoriaProducto(nuevoMenu.trim()), 'Categoría creada').then(() => setNuevoMenu(''))}>Agregar</button>
        </div>
      </div>
      <div>
        <div className="section-title">Categorías de insumos</div>
        <div className="field-hint" style={{ marginBottom: 8 }}>Agrupan el inventario (pestañas de Inventario y alta de materia prima).</div>
        {insumos === null ? <p className="field-hint">Cargando…</p> : insumos.map(c => (
          <CategoriaFila key={c.id} c={{ ...c, uso: usoInsumo(c), usoLabel: 'insumo(s)' }}
            onRename={(x, n) => run(() => api.actualizarCategoriaMateria(x.id, n), 'Categoría renombrada')}
            onDelete={x => confirmarBorrado(x, usoInsumo(x), 'insumo(s)') && run(() => api.eliminarCategoriaMateria(x.id), 'Categoría borrada')} />
        ))}
        <div className="categoria-nueva">
          <input className="text-input" value={nuevoInsumo} maxLength={40} placeholder="Nueva categoría de insumos (Ej. Panadería)" onChange={e => setNuevoInsumo(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter' && nuevoInsumo.trim().length >= 2) { e.preventDefault(); run(() => api.crearCategoriaMateria(nuevoInsumo.trim()), 'Categoría creada').then(() => setNuevoInsumo('')); } }} />
          <button type="button" className="btn-secondary" disabled={nuevoInsumo.trim().length < 2} onClick={() => run(() => api.crearCategoriaMateria(nuevoInsumo.trim()), 'Categoría creada').then(() => setNuevoInsumo(''))}>Agregar</button>
        </div>
      </div>
    </div>
  );
}
