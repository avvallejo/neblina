// PANTALLA DEL NEGOCIO — menú para una TV o monitor en el local.
// Se abre con una URL fija (ej. http://<host>:5175/?pantalla=menu&sucursal=<id>)
// y se actualiza sola cada 10 segundos: al cambiar un precio o activar/desactivar
// un producto en el panel, la pantalla lo refleja sin tocarla.
import React, { useState, useEffect } from 'react';
import { Coffee } from 'lucide-react';
import CafeMenu from './CafeMenu.jsx';
import * as api from '../api/client.js';

export default function MenuBoard({ sucursalId }) {
  const [estado, setEstado] = useState('cargando'); // cargando | listo | error
  const [brand, setBrand] = useState({ nombre: '', logo: '' });
  const [sedeNombre, setSedeNombre] = useState('');
  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [promo, setPromo] = useState(null);
  const [opciones, setOpciones] = useState(null); // tamaños/cafés/leches/extras con su ajuste de precio
  const [cfg, setCfg] = useState({});
  const [promoApertura, setPromoApertura] = useState(null);
  const [desactualizado, setDesactualizado] = useState(false);
  const [hora, setHora] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let vivo = true;
    let cargando = false;

    const cargar = async () => {
      if (cargando) return;
      cargando = true;
      try {
        const sedes = await api.getSucursales();
        const sede = (sucursalId && sedes.find(s => s.id === sucursalId)) || api.getSucursal() && sedes.find(s => s.id === api.getSucursal().id) || sedes[0];
        if (!sede) { if (vivo) setEstado('error'); return; }
        api.setSucursal(sede);
        if (vivo) setSedeNombre(sede.nombre);

        const [cfg, cats, prods, turno, fid, ops, aperturas] = await Promise.all([
          api.getConfig(),
          api.getCategorias(),
          api.getProductos(),
          api.getTurnoEstado().catch(() => ({ abierto: false })),
          api.getFidelidad().catch(() => null),
          api.getOpciones(),
          api.getPromocionesApertura().catch(() => []),
        ]);
        if (!vivo) return;
        setBrand({ nombre: cfg.nombreNegocio || sede.nombre, logo: cfg.logo || '' });
        setCfg(cfg);
        const hoy = new Date().toISOString().slice(0, 10);
        setPromoApertura((aperturas || []).find(a => a.activo && String(a.fecha_inicio).slice(0, 10) <= hoy && String(a.fecha_fin).slice(0, 10) >= hoy) || null);
        setCategorias(cats.map(c => c.nombre));
        setProductos(prods.filter(p => p.activo !== false));
        setAbierto(!!turno.abierto);
        setPromo(fid && fid.activo ? fid : null);
        setOpciones(ops);
        setEstado('listo');
        setDesactualizado(false);
      } catch {
        if (vivo) { setDesactualizado(true); setEstado(previous => previous === 'listo' ? previous : 'error'); }
      } finally { cargando = false; }
    };

    cargar();
    const t = setInterval(cargar, 10000);
    const visible = () => { if (!document.hidden) cargar(); };
    window.addEventListener('focus', cargar);
    window.addEventListener('online', cargar);
    document.addEventListener('visibilitychange', visible);
    return () => { vivo = false; clearInterval(t); window.removeEventListener('focus', cargar); window.removeEventListener('online', cargar); document.removeEventListener('visibilitychange', visible); };
  }, [sucursalId]);

  if (estado !== 'listo') {
    return (
      <div className="menuboard">
        <div className="menuboard-vacio">
          <Coffee size={48} />
          <p>{estado === 'cargando' ? 'Cargando el menú…' : 'No se pudo cargar el menú. Verifica la API y la sucursal.'}</p>
        </div>
      </div>
    );
  }

  if (new URLSearchParams(window.location.search).get('diseno') === 'ilustrado' || !cfg.pantallaEstilo || cfg.pantallaEstilo === 'ilustrado') {
    return <CafeMenu brand={brand} sedeNombre={sedeNombre} productos={productos} opciones={opciones} cfg={cfg} abierto={abierto} desactualizado={desactualizado}/>;
  }

  if ((cfg.pantallaEstilo || 'pizarra') === 'pizarra') {
    return (
      <Pizarra brand={brand} sedeNombre={sedeNombre} cfg={cfg} categorias={categorias} productos={productos}
               abierto={abierto} hora={hora} opciones={opciones} promoApertura={promoApertura} promoFidelidad={promo} />
    );
  }

  const fmtDelta = d => (d > 0 ? `+$${d.toFixed(0)}` : d < 0 ? `−$${Math.abs(d).toFixed(0)}` : 'incluido');
  const minDelta = opciones && opciones.tamanos.length ? Math.min(...opciones.tamanos.map(t => t.delta)) : -6;
  const grupos = opciones ? [
    { titulo: 'Tamaños', items: opciones.tamanos },
    { titulo: 'Café', items: opciones.cafes },
    { titulo: 'Leche', items: opciones.leches },
    { titulo: 'Extras', items: opciones.extras },
  ].filter(g => g.items.length > 0) : [];

  return (
    <div className="menuboard">
      <header className="menuboard-head">
        <div className="menuboard-brand">
          <span className={`brand-mark${brand.logo ? ' has-logo' : ''}`}>
            {brand.logo ? <img src={brand.logo} alt="" /> : <Coffee size={26} />}
          </span>
          <div>
            <h1>{brand.nombre}</h1>
            <span className="menuboard-sede">{sedeNombre}</span>
          </div>
        </div>
        <div className="menuboard-meta">
          <span className={`menuboard-estado ${abierto ? 'abierto' : 'cerrado'}`}>{abierto ? '● Abierto' : 'Cerrado por ahora'}</span>
          <span className="menuboard-hora">{hora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </header>

      <main className="menuboard-grid">
        {categorias.map(cat => {
          const lista = productos.filter(p => p.cat === cat);
          if (lista.length === 0) return null;
          return (
            <section key={cat} className="menuboard-col">
              <h2>{cat}</h2>
              {lista.map(p => (
                <div key={p.id} className="menuboard-item">
                  <span className="menuboard-item-icon">{p.icon}</span>
                  <span className="menuboard-item-name">{p.name}</span>
                  <span className="menuboard-dots" />
                  <span className="menuboard-item-price">{p.sizes ? `desde $${(p.price + minDelta).toFixed(0)}` : `$${p.price.toFixed(0)}`}</span>
                </div>
              ))}
            </section>
          );
        })}
      </main>

      {grupos.length > 0 && (
        <section className="menuboard-opciones">
          <h3>Personaliza tu bebida</h3>
          <div className="menuboard-opciones-grid">
            {grupos.map(g => (
              <div key={g.titulo} className="menuboard-opciones-col">
                <h4>{g.titulo}</h4>
                {g.items.map(o => (
                  <div key={o.id} className="menuboard-opcion">
                    <span>{o.label}</span>
                    <span className={`menuboard-opcion-delta${o.delta === 0 ? ' neutro' : ''}`}>{fmtDelta(o.delta)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {promo && (
        <footer className="menuboard-foot">
          ★ Tarjeta de fidelidad: en tu pedido número {promo.cada_n_pedidos} por la app, {promo.premio_nombre} va por nuestra cuenta.
        </footer>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// ESTILO "PIZARRA": réplica del menú impreso (fondo oscuro, dorado, columnas
// por categoría con descripción, precio normal tachado cuando hay promoción,
// columna de extras). Sin tamaños: el precio es el de la bebida estándar.
// ----------------------------------------------------------------------------
const fmt$ = n => `$${Number(n).toFixed(Number.isInteger(Number(n)) ? 0 : 2)}`;

function Pizarra({ brand, sedeNombre, cfg, categorias, productos, abierto, hora, opciones, promoApertura, promoFidelidad }) {
  const enPromo = productos.some(p => p.precioBase > p.price);
  const tituloPromo = promoApertura ? promoApertura.nombre : (enPromo ? 'Promoción' : null);
  const columnas = categorias.map(cat => ({ cat, items: productos.filter(p => p.cat === cat) })).filter(c => c.items.length > 0);
  const extras = opciones ? [
    ...opciones.extras,
    ...opciones.leches.filter(o => o.delta > 0),
    ...opciones.cafes.filter(o => o.delta > 0),
  ] : [];
  const pie = (cfg.piePantalla || '').split('•').map(t => t.trim()).filter(Boolean);
  // Una categoría con muchas bebidas ocupa dos columnas (los ítems fluyen en
  // dos); y si aun así hay muchas filas, toda la parrilla se reduce un poco
  // para que quepa en la TV sin desplazarse.
  const esAncha = items => items.length > 6;
  const colCount = columnas.reduce((n, c) => n + (esAncha(c.items) ? 2 : 1), 0) + (extras.length ? 1 : 0);
  // Ajuste automático: si el contenido no cabe en la pantalla, la parrilla se
  // reduce lo justo (se mide después de pintar; se recalcula al cambiar datos
  // o el tamaño de la ventana).
  const [escala, setEscala] = useState(1);
  const firma = `${productos.length}|${extras.length}|${columnas.map(c => c.items.length).join(',')}`;
  useEffect(() => {
    let raf = 0; let vivo = true;
    // 1) mide con escala 1 y propone un factor; 2) comprueba (hasta 4 veces)
    // que de verdad quepa y corrige, porque las columnas dobles no escalan
    // de forma perfectamente lineal.
    const medir = () => {
      setEscala(1);
      raf = requestAnimationFrame(() => {
        const grid = document.querySelector('.pz-grid');
        if (!grid || !vivo) return;
        const visible = window.innerHeight;
        const libre = visible - (document.documentElement.scrollHeight - grid.offsetHeight); // tras cabecera y pie
        const contenido = Math.max(1, ...Array.from(grid.children).map(c => c.offsetHeight)); // columna más alta
        let factor = Math.min(1.3, Math.max(0.5, Math.floor((libre / contenido) * 0.97 * 100) / 100));
        let intentos = 0;
        const ajustar = () => {
          setEscala(factor);
          raf = requestAnimationFrame(() => {
            if (!vivo) return;
            const alto = document.documentElement.scrollHeight;
            // Alguna línea nombre…precio que no quepa a lo ancho también obliga a reducir.
            const apretado = Array.from(document.querySelectorAll('.pz-item-line')).some(l => l.scrollWidth > l.clientWidth + 1);
            if ((alto > visible || apretado) && intentos < 6) {
              intentos += 1;
              const porAlto = alto > visible ? (visible / alto) * 0.985 : 1;
              factor = Math.max(0.5, Math.floor(factor * Math.min(porAlto, apretado ? 0.95 : 1) * 100) / 100);
              ajustar();
            }
          });
        };
        ajustar();
      });
    };
    medir();
    window.addEventListener('resize', medir);
    return () => { vivo = false; window.removeEventListener('resize', medir); cancelAnimationFrame(raf); };
  }, [firma]);

  return (
    <div className="pizarra">
      <header className="pz-head">
        <div className="pz-brand">
          <span className={`pz-logo${brand.logo ? ' has-logo' : ''}`}>{brand.logo ? <img src={brand.logo} alt="" /> : <Coffee size={30} />}</span>
          <h1>{brand.nombre}</h1>
          {cfg.lema && <div className="pz-lema">{cfg.lema}</div>}
        </div>
        <div className="pz-center">
          {tituloPromo ? (
            <>
              <span className="pz-kicker">¡Solo por</span>
              <span className="pz-brush">{tituloPromo}!</span>
              <span className="pz-under">Precios especiales por tiempo limitado</span>
            </>
          ) : (
            <>
              <span className="pz-kicker">Bienvenidos a</span>
              <span className="pz-brush">{sedeNombre}</span>
              <span className="pz-under">Café molido al momento</span>
            </>
          )}
        </div>
        <div className="pz-badge">
          <span className={`pz-dot ${abierto ? 'on' : 'off'}`} />
          <span className="pz-badge-txt">{abierto ? 'Abierto' : 'Cerrado por ahora'}</span>
          <span className="pz-hora">{hora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </header>

      <main className="pz-grid" style={{ '--pz-cols': colCount, zoom: escala }}>
        {columnas.map(({ cat, items }) => (
          <section key={cat} className={`pz-col${esAncha(items) ? ' wide' : ''}`}>
            <h2 className="pz-cat">{cat}</h2>
            <div className="pz-items">
            {items.map(p => {
              const promo = p.precioBase > p.price;
              return (
                <div key={p.id} className="pz-item">
                  <span className="pz-icon">{p.icon}</span>
                  <div className="pz-item-body">
                    <div className="pz-item-line">
                      <span className="pz-item-name">{p.name}</span>
                      <span className="pz-dots" />
                      <span className="pz-price-wrap">
                        {promo && <span className="pz-price-old">{fmt$(p.precioBase)}</span>}
                        <span className={`pz-price${promo ? ' promo' : ''}`}>{fmt$(p.price)}</span>
                      </span>
                    </div>
                    {p.descripcion && <div className="pz-item-desc">{p.descripcion}</div>}
                  </div>
                </div>
              );
            })}
            </div>
          </section>
        ))}
        {extras.length > 0 && (
          <section className="pz-col pz-extras">
            <h2 className="pz-cat">Extras</h2>
            {extras.map(o => (
              <div key={`${o.codigo}-${o.label}`} className="pz-item small">
                <div className="pz-item-body">
                  <div className="pz-item-line">
                    <span className="pz-item-name">{o.label}</span>
                    <span className="pz-dots" />
                    <span className="pz-price">{o.delta > 0 ? `+${fmt$(o.delta)}` : 'incluido'}</span>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}
      </main>

      <footer className="pz-foot">
        {promoFidelidad && <div className="pz-fidelidad">★ Tarjeta de fidelidad: en tu pedido número {promoFidelidad.cada_n_pedidos} por la app, {promoFidelidad.premio_nombre} va por nuestra cuenta.</div>}
        {pie.length > 0 && <div className="pz-pie">{pie.map((t, i) => <span key={i}>{i > 0 && <em> • </em>}{t}</span>)}</div>}
      </footer>
    </div>
  );
}
