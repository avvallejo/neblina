// RAÍZ DE LA APLICACIÓN — multi-sucursal y adaptable a cualquier pantalla.
//
// Flujo: elegir sucursal -> Landing (cliente u PIN de personal) -> app del
// rol (Cliente / Caja / Barista / Admin). El estado compartido con la API
// (catálogo, turno, pedidos, cola, datos de admin) vive aquí y se pasa a
// cada pantalla, igual que en la versión anterior pero por módulos.
import React, { useState, useEffect } from 'react';
import { Coffee } from 'lucide-react';
import * as api from './api/client.js';
import {
  CATEGORIES, PRODUCTS, SIZE_OPTIONS, MILK_OPTIONS, COFFEE_OPTIONS, EXTRA_OPTIONS,
  replaceArray, ICON_BY_CAT, getProduct,
} from './lib/catalog.js';
import { adaptPedido, adaptTicket, adaptMateria, adaptReceta } from './lib/adapters.js';
import { ToastHost } from './components/ui.jsx';
import Landing from './screens/Landing.jsx';
import ClienteApp from './screens/ClienteApp.jsx';
import CajaApp from './screens/CajaApp.jsx';
import BaristaApp from './screens/BaristaApp.jsx';
import AdminApp from './screens/AdminApp.jsx';

function BootScreen({ state, onRetry }) {
  return (
    <div className="landing">
      <div className="boot-screen">
        <span className="brand-mark"><Coffee size={26} /></span>
        {state === 'loading' ? (
          <p>Cargando…</p>
        ) : (
          <>
            <p style={{ color: 'var(--danger)', fontWeight: 800 }}>No se pudo conectar con la API.</p>
            <p style={{ fontSize: 13 }}>¿Está corriendo el backend?</p>
            <button className="btn-primary" onClick={onRetry}>Reintentar</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [turnoAbierto, setTurnoAbierto] = useState(false);
  const [promoConfig, setPromoConfig] = useState({ activo: true, cada: 10, premioId: null });
  const [usuarios, setUsuarios] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [materias, setMaterias] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [productosAdmin, setProductosAdmin] = useState([]);
  const [reportes, setReportes] = useState(null);
  const [preciosPorRevisar, setPreciosPorRevisar] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [fechaVentas, setFechaVentas] = useState('');
  const [ventasError, setVentasError] = useState('');
  const [smsActivo, setSmsActivo] = useState(true); // falla cerrado hasta poder leer la configuración
  const [nombreNegocio, setNombreNegocio] = useState('');
  const [logo, setLogo] = useState('');
  const [pantallaCfg, setPantallaCfg] = useState({ lema: '', piePantalla: '', pantallaEstilo: 'pizarra' });
  const [recetaOverrides, setRecetaOverrides] = useState({});
  // Rol "mostrador" (caja + barra en la misma persona): qué pantalla ve ahora.
  const [modoMostrador, setModoMostrador] = useState('caja');
  const [bootState, setBootState] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [pedidos, setPedidos] = useState([]);
  const [cola, setCola] = useState([]);

  // Multi-sucursal
  const [sedes, setSedes] = useState([]);           // sedes activas (público)
  const [sede, setSede] = useState(api.getSucursal()); // sede activa { id, nombre }
  const [catalogVersion, setCatalogVersion] = useState(0); // fuerza repintado al cambiar catálogo

  const esGeneral = !!(currentUser && currentUser.rol === 'admin' && currentUser.sucursalId === null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { document.title = nombreNegocio || 'Mi Cafetería'; }, [nombreNegocio]);

  const addToast = React.useCallback((msg, tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3400);
  }, []);

  // ---- Sucursales ----
  const cargarSedes = React.useCallback(async () => {
    const rows = await api.getSucursales();
    setSedes(rows);
    return rows;
  }, []);

  const elegirSede = React.useCallback(s => {
    api.setSucursal(s);
    setSede(s);
    if (!s) { setBootState('ready'); }
  }, []);

  // ---- Catálogo de la sede activa ----
  const cargarCatalogo = React.useCallback(async () => {
    if (!api.getSucursalId()) return;
    try {
      const [cats, prods, ops] = await Promise.all([api.getCategorias(), api.getProductos(), api.getOpciones()]);
      replaceArray(CATEGORIES, cats.map(c => ({ id: c.nombre, icon: ICON_BY_CAT[c.nombre] || Coffee })));
      replaceArray(PRODUCTS, prods);
      replaceArray(SIZE_OPTIONS, ops.tamanos);
      replaceArray(MILK_OPTIONS, ops.leches);
      replaceArray(COFFEE_OPTIONS, ops.cafes);
      replaceArray(EXTRA_OPTIONS, ops.extras);
      try {
        const fid = await api.getFidelidad();
        if (fid && fid.producto_premio_id) setPromoConfig({ activo: fid.activo, cada: fid.cada_n_pedidos, premioId: fid.producto_premio_id });
        else { const premio = prods.find(p => p.name === 'Americano') || prods[0]; setPromoConfig(pc => ({ ...pc, premioId: premio ? premio.id : null })); }
      } catch {
        const premio = prods.find(p => p.name === 'Americano') || prods[0];
        setPromoConfig(pc => ({ ...pc, premioId: premio ? premio.id : null }));
      }
      try {
        const cfg = await api.getConfig();
        setSmsActivo(!!cfg.smsVerificacion);
        setNombreNegocio(cfg.nombreNegocio || '');
        setLogo(cfg.logo || '');
        setPantallaCfg({ lema: cfg.lema || '', piePantalla: cfg.piePantalla || '', pantallaEstilo: cfg.pantallaEstilo || 'pizarra' });
      } catch { /* conserva el modo seguro */ }
      setCatalogVersion(v => v + 1);
    } catch (e) {
      throw e;
    }
  }, []);

  // Arranque: lista de sedes -> (auto)selección -> RESTAURAR la sesión
  // guardada (el celular descarta la página al bloquearse; los tokens viven
  // en el dispositivo) -> catálogo. Así, desbloquear el teléfono regresa a
  // la pantalla donde estabas, sin pedir el PIN otra vez.
  const boot = React.useCallback(async () => {
    setBootState('loading');
    try {
      const rows = await cargarSedes();
      let activa = api.getSucursal();
      // Valida que la sede guardada siga existiendo/activa.
      if (activa && !rows.some(s => s.id === activa.id)) { activa = null; api.setSucursal(null); }
      if (!activa && rows.length === 1) { activa = rows[0]; api.setSucursal(activa); }

      // Sesión de PERSONAL guardada: se revalida contra la API (una sesión
      // revocada o vencida se descarta en silencio y vuelve al inicio).
      let usuario = null;
      if (api.getToken()) {
        try { usuario = await api.getYo(); }
        catch { api.setToken(null); }
      }
      // El personal con sede fija siempre opera SU sede.
      if (usuario && usuario.sucursalId) {
        const suya = rows.find(s => s.id === usuario.sucursalId);
        if (suya) activa = suya;
      }
      if (activa) api.setSucursal(activa);

      setSede(activa);
      if (activa) await cargarCatalogo();

      if (usuario && usuario.tipo === 'staff') {
        setCurrentUser({ id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, sucursalId: usuario.sucursalId });
        setRole(usuario.rol);
      } else if (api.getTokenCliente() && activa) {
        // Cliente con sesión guardada: directo a su app (ella misma
        // restaura su cuenta e historial desde su token).
        setRole('cliente');
      }
      setBootState('ready');
    } catch {
      setBootState('error');
    }
  }, [cargarSedes, cargarCatalogo]);

  useEffect(() => { boot(); }, [boot]);

  // Cambio de sede (desde el Landing o el switcher del admin general).
  const cambiarSede = React.useCallback(async (s) => {
    api.setSucursal(s);
    setSede(s);
    if (s) {
      try { await cargarCatalogo(); } catch { addToast('No se pudo cargar el catálogo de la sucursal.', 'warn'); }
    }
  }, [cargarCatalogo, addToast]);

  // ---- Turno / pedidos / cola ----
  const refrescarPedidos = React.useCallback(async () => {
    try { const rows = await api.getPedidos(); setPedidos(rows.map(adaptPedido)); } catch { /* conserva lo último */ }
  }, []);
  const refrescarCola = React.useCallback(async () => {
    try { const rows = await api.getColaBarista(); setCola(rows.map(adaptTicket)); } catch { /* conserva lo último */ }
  }, []);
  const refrescarTurno = React.useCallback(async () => {
    try { const e = await api.getTurnoEstado(); setTurnoAbierto(!!e.abierto); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!['cajero', 'barista', 'mostrador', 'admin'].includes(role)) {
      if (role === 'cliente') { refrescarTurno(); const t = setInterval(refrescarTurno, 5000); return () => clearInterval(t); }
      return undefined;
    }
    refrescarTurno(); refrescarPedidos(); refrescarCola();
    const t = setInterval(() => { refrescarPedidos(); refrescarCola(); refrescarTurno(); }, 3500);
    return () => clearInterval(t);
  }, [role, sede, refrescarPedidos, refrescarCola, refrescarTurno]);

  const crearPedidoCaja = async ({ cart, descuentoPorcentaje, pago, autorizacionDescuento, clienteTelefono }) => {
    const r = await api.crearPedido({ cart, pago, descuentoPorcentaje, autorizacionDescuento, clienteTelefono });
    await refrescarPedidos(); await refrescarCola();
    addToast(`Pedido ${r.pedido.folio} enviado a preparación`, 'success');
    return adaptPedido(r.pedido);
  };
  const cobrarPedidoApi = async (orderId, payInfo = null) => {
    await api.cobrarPedido(orderId, payInfo ? { metodoPago: payInfo.metodoPago, montoRecibido: payInfo.montoRecibido } : {});
    await refrescarPedidos(); await refrescarCola();
    addToast('Cobro confirmado', 'success');
  };
  const cancelarPedidoApi = async (orderId) => {
    try { await api.cancelarPedido(orderId); await refrescarPedidos(); await refrescarCola(); addToast('Pedido cancelado', 'warn'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const noShowPedidoApi = async (orderId) => {
    try { await api.noShowPedido(orderId); await refrescarPedidos(); await refrescarCola(); addToast('Marcado como no recogido', 'warn'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const iniciarTicketApi = async (id) => {
    try { await api.iniciarItem(id); await refrescarCola(); } catch (e) { addToast(e.message, 'warn'); }
  };
  const terminarTicketApi = async (ticket) => {
    try {
      await api.terminarItem(ticket.id);
      await refrescarCola(); await refrescarPedidos();
      const p = getProduct(ticket.productId);
      addToast(`${p ? p.name : 'Bebida'} terminada — inventario actualizado`, 'success');
      if (ticket.origen === 'app' && ticket.cliente) addToast(`📲 Aviso a ${ticket.cliente.nombre}: ¡tu pedido está listo!`, 'success');
    } catch (e) { addToast(e.message, 'warn'); }
  };
  const crearMermaApi = async (body) => {
    try { await api.crearMerma(body); await refrescarCola(); addToast('Merma registrada — inventario descontado', 'warn'); }
    catch (e) { addToast(e.message, 'warn'); }
  };

  const toggleTurno = async () => {
    try {
      if (turnoAbierto) { await api.cerrarTurno(); addToast('Turno cerrado', 'warn'); }
      else { await api.abrirTurno(); addToast('Turno abierto — ¡a vender!', 'success'); }
      await refrescarTurno();
      await refrescarPedidos();
    } catch (e) { addToast(e.message, 'warn'); }
  };

  // ---- Datos de administración ----
  const recargarAdmin = React.useCallback(async () => {
    await Promise.allSettled([
      api.getUsuarios().then(setUsuarios),
      api.getProveedores().then(setProveedores),
      api.getMaterias().then(rows => setMaterias(rows.map(adaptMateria))),
      api.getProductosAdmin().then(setProductosAdmin),
      api.getMateriasCategorias(), api.getCategoriasProducto(),
      api.getFidelidad().then(fid => {
        if (fid) setPromoConfig({ activo: fid.activo, cada: fid.cada_n_pedidos, premioId: fid.producto_premio_id });
      }),
      api.getReportes().then(setReportes).catch(() => setReportes(null)),
      api.getPreciosPorRevisar().then(setPreciosPorRevisar),
    ]);
  }, []);

  useEffect(() => {
    if (role !== 'admin') return undefined;
    recargarAdmin();
    const t = setInterval(recargarAdmin, 5000);
    return () => clearInterval(t);
  }, [role, sede, recargarAdmin]);

  useEffect(() => {
    if (role !== 'admin') return undefined;
    let vigente = true;
    let consultando = false;
    setKpis(null);
    setVentasError('');
    const actualizar = async () => {
      if (consultando) return;
      consultando = true;
      try {
        const datos = await api.getKpisDia(fechaVentas);
        if (vigente) { setKpis(datos); setVentasError(''); }
      } catch (error) {
        if (vigente) { setKpis(null); setVentasError(`No se pudieron actualizar las ventas: ${error.message}`); }
      } finally { consultando = false; }
    };
    actualizar();
    const intervalo = setInterval(actualizar, 5000);
    return () => { vigente = false; clearInterval(intervalo); };
  }, [role, sede, fechaVentas]);

  const recargarRecetas = React.useCallback(async () => {
    try {
      const rows = await api.getRecetas();
      const map = {};
      rows.forEach(r => { map[r.producto_id] = adaptReceta(r); }); // todas: aunque no estén personalizadas traen sus ingredientes fijos
      setRecetaOverrides(map);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!['cajero', 'barista', 'mostrador', 'admin'].includes(role)) return undefined;
    recargarRecetas();
    return undefined;
  }, [role, sede, recargarRecetas]);

  const logout = () => {
    api.setToken(null); // cierra sesión del PERSONAL; la del cliente se conserva
    setRole(null);
    setCurrentUser(null);
  };

  const addUsuario = async u => {
    try { await api.crearUsuario({ nombre: u.nombre, rol: u.rol, pin: u.pin, esAdminGeneral: u.esAdminGeneral }); await recargarAdmin(); addToast('Usuario agregado', 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };
  const updateUsuario = async (id, patch) => {
    try {
      const body = {};
      ['nombre', 'rol', 'activo'].forEach(k => { if (patch[k] !== undefined) body[k] = patch[k]; });
      if (patch.pin) body.pin = patch.pin;
      if (patch.sucursalId !== undefined) body.sucursalId = patch.sucursalId;
      await api.actualizarUsuario(id, body); await recargarAdmin();
    } catch (e) { addToast(e.message, 'warn'); }
  };

  const addMateria = async m => {
    try { await api.crearMateria(m); await recargarAdmin(); addToast('Materia prima agregada', 'success'); return true; }
    catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const updateMateria = async (id, patch) => {
    try { await api.actualizarMateria(id, patch); await recargarAdmin(); addToast('Materia prima actualizada', 'success'); return true; }
    catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const deleteMateria = async materia => {
    if (!window.confirm(`¿Eliminar definitivamente "${materia.nombre}"? Si tiene historial, se conservará y te mostraremos el motivo.`)) return;
    try {
      let resultado;
      try { resultado = await api.eliminarMateria(materia.id); }
      catch (e) {
        if (e.details?.codigo !== 'CONFIRMAR_DESVINCULACION') throw e;
        const d = e.details;
        const aviso = [
          `"${materia.nombre}" no tiene historial. Para borrarlo:`,
          d.opciones.length ? `Se desvincularán y desactivarán estas opciones: ${d.opciones.join(', ')}.` : '',
          d.recetas ? `Se retirará de ${d.recetas} receta(s).` : '',
          d.empaques ? `Se retirarán ${d.empaques} configuración(es) de vaso/tapa.` : '',
          d.productos.length ? `Estos productos se desactivarán hasta que completes sus ingredientes o empaques: ${d.productos.join(', ')}.` : '',
          '¿Confirmas la eliminación y estos cambios en el menú?',
        ].filter(Boolean).join('\n\n');
        if (!window.confirm(aviso)) return;
        resultado = await api.eliminarMateria(materia.id, true);
      }
      await recargarAdmin();
      await cargarCatalogo();
      await recargarRecetas();
      addToast(resultado.productos_desactivados?.length ? 'Insumo eliminado; revisa los productos desactivados antes de volver a venderlos' : 'Insumo eliminado definitivamente', 'success');
    } catch (e) { window.alert(e.message); }
  };

  const addProveedor = async p => {
    try { await api.crearProveedor(p); await recargarAdmin(); addToast('Proveedor agregado', 'success'); return true; }
    catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const updateProveedor = async (id, patch) => {
    try { await api.actualizarProveedor(id, patch); await recargarAdmin(); addToast('Proveedor actualizado', 'success'); return true; }
    catch (e) { addToast(e.message, 'warn'); return false; }
  };
  const deleteProveedor = async proveedor => {
    if (!window.confirm(`¿Eliminar "${proveedor.nombre}"? Si tiene insumos o lotes, se desactivará para conservar el historial.`)) return;
    try {
      const r = await api.eliminarProveedor(proveedor.id);
      await recargarAdmin();
      addToast(r.modo_eliminacion === 'definitivo' ? 'Proveedor eliminado' : 'Proveedor desactivado por historial', 'success');
    } catch (e) { addToast(e.message, 'warn'); }
  };

  const guardarPromo = async cfg => {
    try { await api.guardarFidelidad(cfg); setPromoConfig(cfg); await recargarAdmin(); addToast('Promoción guardada', 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };

  const guardarSmsConfig = async val => {
    try { await api.setConfig({ smsVerificacion: val }); setSmsActivo(val); addToast(val ? 'Verificación por SMS activada' : 'Verificación por SMS desactivada', 'success'); }
    catch (e) { addToast(e.message, 'warn'); }
  };

  const guardarBranding = async cambios => {
    try {
      const cfg = await api.setConfig(cambios);
      setNombreNegocio(cfg.nombreNegocio || '');
      setLogo(cfg.logo || '');
      setPantallaCfg({ lema: cfg.lema || '', piePantalla: cfg.piePantalla || '', pantallaEstilo: cfg.pantallaEstilo || 'pizarra' });
      addToast('Configuración guardada', 'success');
    } catch (e) { addToast(e.message, 'warn'); }
  };

  const setRecetaOverride = async (productId, override) => {
    try {
      if (override === null) { await api.restaurarReceta(productId); addToast('Receta restaurada a su versión predeterminada', 'success'); }
      else { await api.guardarReceta(productId, override); addToast('Receta actualizada', 'success'); }
      await recargarRecetas();
    } catch (e) { addToast(e.message, 'warn'); }
  };

  // Switcher de sede del ADMIN GENERAL: cambia la sede activa y recarga todo.
  const cambiarSedeAdmin = async sedeId => {
    const s = sedes.find(x => x.id === sedeId);
    if (!s) return;
    await cambiarSede(s);
    await recargarAdmin();
    await refrescarTurno(); await refrescarPedidos(); await refrescarCola();
    addToast(`Ahora administras: ${s.nombre}`, 'success');
  };

  const brand = { nombre: nombreNegocio || (sede ? sede.nombre : 'Mi Cafetería'), logo };

  if (bootState !== 'ready') return <BootScreen state={bootState} onRetry={boot} />;

  if (!role) {
    return (
      <>
        <Landing
          sedes={sedes}
          sede={sede}
          onPickSede={s => cambiarSede(s)}
          onSelectCliente={() => setRole('cliente')}
          onStaffLogin={u => {
            setCurrentUser(u);
            setRole(u.rol);
            // Si el usuario tiene sede fija distinta a la elegida, la app se
            // alinea a la del usuario (el backend manda).
            if (u.sucursalId && sede && u.sucursalId !== sede.id) {
              const suya = sedes.find(s => s.id === u.sucursalId);
              if (suya) cambiarSede(suya);
            }
          }}
          nombreNegocio={nombreNegocio}
          logo={logo}
        />
        <ToastHost toasts={toasts} />
      </>
    );
  }

  return (
    <>
      {role === 'cliente' && (
        <ClienteApp
          key={`cliente-${catalogVersion > 0 ? sede?.id : 'x'}`}
          brand={brand}
          sede={sede}
          turnoAbierto={turnoAbierto}
          promoConfig={promoConfig}
          smsActivo={smsActivo}
          addToast={addToast}
          onExit={() => setRole(null)}
          recetaOverrides={recetaOverrides}
        />
      )}
      {(role === 'cajero' || (role === 'mostrador' && modoMostrador === 'caja')) && (
        <CajaApp
          brand={brand}
          sedeNombre={sede ? sede.nombre : ''}
          orders={pedidos} createOrder={crearPedidoCaja} cancelOrderFn={cancelarPedidoApi}
          confirmarEntrega={cobrarPedidoApi} marcarNoShow={noShowPedidoApi} addToast={addToast}
          onLogout={logout} turnoAbierto={turnoAbierto} onToggleTurno={toggleTurno} currentUser={currentUser} now={now}
          mostrador={role === 'mostrador' ? { irA: () => setModoMostrador('barra'), pendientes: cola.filter(t => t.status !== 'terminado').length } : null}
        />
      )}
      {(role === 'barista' || (role === 'mostrador' && modoMostrador === 'barra')) && (
        <BaristaApp
          brand={brand}
          sedeNombre={sede ? sede.nombre : ''}
          tickets={cola} startTicket={iniciarTicketApi} finishTicket={terminarTicketApi} addMerma={crearMermaApi}
          onCancelar={cancelarPedidoApi}
          onLogout={logout} now={now} currentUser={currentUser} recetaOverrides={recetaOverrides}
          mostrador={role === 'mostrador' ? { irA: () => setModoMostrador('caja'), porCobrar: pedidos.filter(o => !o.cobrado && !o.cancelado && !o.noShow).length } : null}
        />
      )}
      {role === 'admin' && (
        <AdminApp
          brand={brand}
          sedeNombre={sede ? sede.nombre : ''}
          esGeneral={esGeneral}
          sedes={sedes}
          sedeActivaId={sede ? sede.id : null}
          onChangeSede={cambiarSedeAdmin}
          onSedesChanged={cargarSedes}
          kpis={kpis} fechaVentas={fechaVentas} setFechaVentas={setFechaVentas} ventasError={ventasError} reportes={reportes} recargarCatalogo={cargarCatalogo} recargarAdmin={recargarAdmin} addToast={addToast}
          smsActivo={smsActivo} onToggleSms={guardarSmsConfig}
          nombreNegocio={nombreNegocio} logo={logo} pantallaCfg={pantallaCfg} onSaveBranding={guardarBranding}
          onLogout={logout} turnoAbierto={turnoAbierto} promoConfig={promoConfig} setPromoConfig={guardarPromo}
          usuarios={usuarios} addUsuario={addUsuario} updateUsuario={updateUsuario} currentUser={currentUser}
          materias={materias} addMateria={addMateria} updateMateria={updateMateria} deleteMateria={deleteMateria}
          proveedores={proveedores} addProveedor={addProveedor} updateProveedor={updateProveedor} deleteProveedor={deleteProveedor}
          productosAdmin={productosAdmin}
          preciosPorRevisar={preciosPorRevisar}
          recetaOverrides={recetaOverrides} setRecetaOverride={setRecetaOverride}
        />
      )}
      <ToastHost toasts={toasts} />
    </>
  );
}
