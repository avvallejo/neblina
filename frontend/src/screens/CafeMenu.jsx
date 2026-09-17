import React, { useEffect, useState, useId } from 'react';
import { Coffee, Snowflake, Sparkles, Flame, Cookie, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { menuIllustration } from '../lib/menuImages.js';
import { categoryPages, categoryOf } from '../lib/tvMenu.js';
import { CATEGORIES } from '../lib/catalog.js';
import './cafeMenu.css';

const dinero = n => `$${Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
const recargo = n => Number(n) === 0 ? 'Incluido' : `${n > 0 ? '+' : '−'}${dinero(Math.abs(n))}`;
function FotoBebida({ p }) {
  const clipId = useId();
  const asset = menuIllustration(p);
  if (!asset) return p.imagen ? <img className="cm-photo cm-uploaded" src={p.imagen} alt={p.name}/> : <span className="cm-drink-icon">{p.icon || '☕'}</span>;
  const [x, y, width, height] = asset.viewBox.split(' ').map(Number);
  return <svg className="cm-photo" role="img" aria-label={p.name} viewBox={asset.viewBox} preserveAspectRatio="xMidYMid meet">
    <defs><clipPath id={clipId}><rect x={x} y={y} width={width} height={height}/></clipPath></defs>
    <image href={asset.src} width={asset.width} height={asset.height} clipPath={`url(#${clipId})`}/>
  </svg>;
}
function Bebida({ p, index }) {
  return <article className={`cm-drink ${p.precioBase > p.price ? 'cm-special' : ''}`} style={{ '--item-index': index }}>
    <div className={`cm-illustration ${p.imagen ? 'uploaded' : ''}`}><FotoBebida p={p}/></div>
    <div className="cm-drink-copy"><h3>{p.name}</h3>{p.descripcion && <p>{p.descripcion}</p>}
    </div>
    <div className="cm-price">{p.precioBase > p.price && <del>{dinero(p.precioBase)}</del>}<strong>{dinero(p.price)}</strong></div>
  </article>;
}
// El número de filas depende de la altura disponible, incluida la barra del navegador.
function capacidad() {
  const { innerWidth: width, innerHeight: height } = window;
  const narrow = width < 700;
  const rows = Math.max(1, Math.min(4, Math.floor((height - 260) / Math.max(100, width * .085))));
  return { products: narrow ? Math.max(1, Math.floor((height - 340) / 115)) : rows * 2,
    extras: narrow ? 3 : Math.max(2, Math.floor((height - 270) / Math.max(43, width * .031))) };
}
function iconoCategoria(title) {
  return /frío/i.test(title) ? Snowflake : /frapp|extra|leche|tamaño/i.test(title) ? Sparkles : /parrilla|cocina/i.test(title) ? Flame : /snack|postre/i.test(title) ? Cookie : Coffee;
}
const fraseCategoria = title => /frío/i.test(title) ? 'Una pausa refrescante' : /frapp/i.test(title) ? 'Cremosos e irresistibles' : /parrilla|cocina/i.test(title) ? 'Para un antojo de verdad' : /snack|postre/i.test(title) ? 'El acompañamiento perfecto' : 'Tu momento de café';
export default function CafeMenu({ brand, sedeNombre, productos, opciones, cfg, abierto, desactualizado }) {
  const [layout, setLayout] = useState(capacidad);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const resize = () => setLayout(capacidad());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const size = opciones?.tamanos?.find(o => Number(o.delta) === 0) || opciones?.tamanos?.[0];
  const lista = productos.map(p => p.sizes && size ? { ...p,
    price: p.price + Number(size.delta), precioBase: p.precioBase + Number(size.delta), sizeLabel: size.label } : p);
  const categoria = categoryOf;
  const orden = ['Calientes', 'Fríos', 'Frappés', 'Parrilla', ...CATEGORIES.map(c => c.id), 'Snacks'];
  const categorias = [...new Set(lista.map(categoria))].sort((a, b) => {
    const index = c => orden.includes(c) ? orden.indexOf(c) : orden.length;
    return index(a) - index(b);
  });
  const pages = categoryPages(categorias, lista, categoria, opciones || {}, layout, cfg.pantallaPersonalizacion || {});
  const total = Math.max(1, pages.length);
  const current = page % total;
  useEffect(() => {
    if (paused || total <= 1) return;
    const timer = setInterval(() => setPage(p => (p + 1) % total), 15000);
    return () => clearInterval(timer);
  }, [paused, total, current]);
  const changePage = delta => setPage(p => ((p % total) + delta + total) % total);
  const active = pages[current];
  const isNeblina = /neblina/i.test(brand.nombre);
  const logo = brand.logo || '';
  const CategoryIcon = iconoCategoria(active?.title || '');
  const tone = /frío|frapp/i.test(active?.title) ? 'cool' : /parrilla|cocina/i.test(active?.title) ? 'warm' : '';
  useEffect(() => {
    const onKey = event => {
      if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        setPage(p => ((p % total) + (event.key === 'ArrowRight' ? 1 : -1) + total) % total);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);
  return <div className={`cafe-menu cm-tv cm-showcase ${tone}`}>
    {isNeblina && <div className="cm-mountain-art" aria-hidden="true"><img src="/images/neblina-logo-original.png" alt=""/></div>}
    <div className="cm-mist" aria-hidden="true"/>
    <header className="cm-header">
      <div className="cm-brand">
        {logo ? <img className="cm-brand-logo" src={logo} alt={brand.nombre}/> : <>
          <Coffee aria-hidden="true"/>
          <div><h1>{brand.nombre}</h1><span>{isNeblina ? 'ENTRE MONTAÑAS Y CAFÉ' : sedeNombre + ' · CAFÉ HECHO AL MOMENTO'}</span></div>
        </>}
      </div>
      <div className="cm-header-message"><span>Una pausa. Un buen café.</span><small>{cfg.lema || 'Hecho al momento, para disfrutar sin prisa'}</small></div>
      <div className="cm-status"><span className={abierto ? 'open' : ''}>{abierto ? '● Abierto' : 'Menú de la casa'}</span><small>PRECIOS EN MXN</small></div>
    </header>
    <nav className="cm-category-nav" aria-label="Categorías del menú">
      {categorias.map(title => {
        const target = pages.findIndex(p => p.title === title);
        const Icon = iconoCategoria(title);
        return <button key={title} aria-current={active?.title === title ? 'page' : undefined} onClick={() => setPage(target)}><Icon aria-hidden="true"/><span>{title}</span></button>;
      })}
    </nav>
    <main key={`${current}-${active?.title}`} className={`cm-showcase-stage ${active?.extras.length ? 'has-extras' : ''}`}>
      {active ? <>
        <header className="cm-category-heading">
          <div><span className="cm-eyebrow"><i/> {fraseCategoria(active.title)}</span><h2>{active.title}<CategoryIcon aria-hidden="true"/></h2></div>
          <span className="cm-category-part">{active.count > 1 ? `${active.part} / ${active.count}` : 'HECHO A TU GUSTO'}</span>
        </header>
        <section className="cm-product-cards" aria-label={`Productos de ${active.title}`} style={{ '--product-rows': Math.ceil(active.items.length / (window.innerWidth < 700 ? 1 : 2)) }}>
          {active.items.map((item, index) => <Bebida key={item.id} p={item} index={index}/>)}
        </section>
        {active.extras.length > 0 && <aside className="cm-pairings" aria-label={`Personaliza ${active.title}`}>
          <header><span><Sparkles aria-hidden="true"/> HAZLO TUYO</span><h3>{tone === 'warm' ? 'Dale un extra' : 'Tu toque favorito'}</h3><p>Un detalle que lo hace tuyo</p></header>
          <div className="cm-pairing-ornament" aria-hidden="true">◆</div>
          <div className="cm-pairing-list">{active.extras.map(o => <div className="cm-pairing" key={o.key}>
            <div><small>{o.group}</small><span>{o.label}</span></div>
            <b>{o.maxDelta > o.delta ? `${recargo(o.delta)} a ${recargo(o.maxDelta)}` : recargo(o.delta)}</b>
          </div>)}</div>
          {active.extraCount > 1 && <small className="cm-pairing-more">Opciones {active.extraPart} de {active.extraCount} · continúa en la siguiente pantalla</small>}
          <div className="cm-pairing-note">Disponibles según el producto</div>
        </aside>}
      </> : <p>Pronto encontrarás aquí nuestro menú.</p>}
    </main>
    <footer className="cm-footer">
      <span>{desactualizado ? 'Reconectando · última información disponible' : cfg.piePantalla || 'Una pausa entre montañas y café · Imágenes ilustrativas'}</span>
      <nav className="cm-pagination" aria-label="Páginas del menú">
        <button onClick={() => changePage(-1)} aria-label="Página anterior"><ChevronLeft/></button>
        <span className="cm-page-count">{String(current + 1).padStart(2, '0')} <small>/ {String(total).padStart(2, '0')}</small></span>
        <button onClick={() => changePage(1)} aria-label="Página siguiente"><ChevronRight/></button>
        <button onClick={() => setPaused(p => !p)} aria-label={paused ? 'Reanudar menú' : 'Pausar menú'}>{paused ? <Play/> : <Pause/>}</button>
      </nav>
      <div className="cm-slide-track" aria-hidden="true"><div key={`${current}-${total}-${paused}`} style={{ animationPlayState: paused || total <= 1 ? 'paused' : 'running' }}/></div>
    </footer>
  </div>;
}
