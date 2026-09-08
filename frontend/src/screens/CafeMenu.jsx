import React from 'react';
import { Coffee, Sparkles } from 'lucide-react';
import './cafeMenu.css';

const dinero = n => `$${Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
const recargo = n => Number(n) === 0 ? 'Incluido' : `${n > 0 ? '+' : '−'}${dinero(Math.abs(n))}`;
function foto(p) {
  const name = p.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (name.includes('chocomilk') || name.includes('esquimo')) return null;
  if (p.tipo === 'frappe') return name.includes('oreo') ? 7 : name.includes('moka') || name.includes('mocha') ? 8 : 6;
  if (p.frio) return name.includes('latte') ? 5 : null;
  if (name.includes('espresso')) return 0;
  if (name.includes('americano')) return 1;
  if (name.includes('cortado')) return 2;
  if (name.includes('capuch') || name.includes('cappuc')) return 3;
  if (name.includes('latte')) return 4;
  return null;
}
function FotoBebida({ p, grande=false }) {
  if(p.imagen)return <img className={`cm-photo cm-uploaded ${grande?'large':''}`} src={p.imagen} alt={p.name}/>;
  const n=foto(p);
  const icon=/chocomilk/i.test(p.name)?'🍫':/esquimo/i.test(p.name)?'🍓':p.icon;
  return n === null ? <span className="cm-drink-icon">{icon}</span> : <span className={`cm-photo ${grande?'large':''}`} role="img" aria-label={p.name}
    style={{backgroundPosition:`${(n%3)*50}% ${Math.floor(n/3)*50}%`}} />;
}
function Bebida({ p }) {
  return <article className="cm-drink">
    <FotoBebida p={p}/>
    <div className="cm-drink-copy"><h3>{p.name}</h3>{p.descripcion && <p>{p.descripcion}</p>}
      <small>{p.sizes ? p.sizeLabel || 'Tamaño disponible' : 'Presentación de la casa'}</small>
    </div>
    <div className="cm-price">{p.precioBase > p.price && <del>{dinero(p.precioBase)}</del>}<strong>{dinero(p.price)}</strong></div>
  </article>;
}
function Columna({ titulo, subtitulo, productos, tono='' }) {
  return <section className={`cm-column ${tono}`} style={{'--count':Math.max(1,productos.length)}}>
    <header className="cm-section-head"><span>{subtitulo}</span><h2>{titulo}</h2></header>
    <div className="cm-drink-list">{productos.map(p=><Bebida key={p.id} p={p}/>)}</div>
  </section>;
}
export default function CafeMenu({ brand,sedeNombre,productos,opciones,cfg,abierto,desactualizado }) {
  const size=opciones?.tamanos?.find(o=>Number(o.delta)===0)||opciones?.tamanos?.[0];
  productos=productos.map(p=>p.sizes&&size?{...p,price:p.price+Number(size.delta),precioBase:p.precioBase+Number(size.delta),sizeLabel:`${size.label} · tamaño disponible`}:p);
  const categoria=p=>p.cat || (p.tipo==='snack'?'Snacks':p.tipo==='frappe'?'Frappés':p.frio?'Fríos':'Calientes');
  const calientes=productos.filter(p=>categoria(p)==='Calientes');
  const frappes=productos.filter(p=>categoria(p)==='Frappés');
  const frios=productos.filter(p=>categoria(p)==='Fríos');
  const snacks=productos.filter(p=>categoria(p)==='Snacks');
  const groups=opciones ? [
    {title:'Elige tu café',hint:'Recargo por shot de 18 g',items:opciones.cafes},
    {title:'Tu leche favorita',hint:'Para bebidas con leche',items:opciones.leches},
    {title:'Dale un extra',hint:'Añádelo a tu bebida',items:opciones.extras},
    {title:'A tu medida',hint:'En bebidas con tamaño a elegir',items:opciones.tamanos},
  ] : [];
  return <div className="cafe-menu">
    <header className="cm-header">
      <div className="cm-brand">{brand.logo ? <img src={brand.logo} alt=""/> : <Coffee/>}<div><h1>{brand.nombre}</h1><span>{sedeNombre} · CAFÉ HECHO AL MOMENTO</span></div></div>
      <div className="cm-header-message"><span>Una pausa. Un buen café.</span><small>{cfg.lema || 'Encuentra tu favorito'}</small></div>
      <div className="cm-status"><span className={abierto?'open':''}>{abierto?'● Abierto':'Menú de la casa'}</span><small>PRECIOS EN MXN</small></div>
    </header>
    <main className={`cm-main ${frios.length>1?'cm-many-cold':''}`}>
      <Columna titulo="Calientes" subtitulo="Clásicos que reconfortan" productos={calientes}/>
      <div className="cm-center">
        {frios.length>1 ? <Columna titulo="Fríos" subtitulo="Tu pausa más fresca" productos={frios} tono="cool"/> : <section className="cm-cold"><div className="cm-section-head"><span>Tu pausa más fresca</span><h2>Fríos</h2></div>
          {frios.map(p=><article key={p.id} className="cm-cold-item"><FotoBebida p={p} grande/><div><h3>{p.name}</h3><strong>{dinero(p.price)}</strong></div><small>{p.sizes?p.sizeLabel || 'Tamaño disponible':'Presentación de la casa'}</small></article>)}
          {!frios.length && <div className="cm-center-note"><Coffee/><p>Café a tu gusto</p></div>}
        </section>}
        {frios.length<=1&&<div className="cm-seal"><Sparkles/><span>TU CAFÉ,<br/>A TU MANERA</span><small>Elige café, leche y extras</small></div>}
        {snacks.map(p=><div key={p.id} className="cm-snack"><span>{p.icon} {p.name}</span><b>{dinero(p.price)}</b></div>)}
      </div>
      <Columna titulo="Frappés" subtitulo="Cremosos, frescos, irresistibles" productos={frappes} tono="cool"/>
    </main>
    <section className="cm-customize"><div className="cm-customize-title"><span>HAZLO TUYO</span><h2>Personaliza tu bebida</h2></div>
      <div className="cm-options">{groups.filter(g=>g.items?.length).map(g=><section key={g.title}><h3>{g.title}</h3><small>{g.hint}</small>{g.items.map(o=><div className="cm-option" key={o.id}><span>{o.label}</span><b className={o.delta===0?'included':''}>{recargo(o.delta)}</b></div>)}</section>)}</div>
    </section>
    <footer className="cm-footer"><span>{cfg.piePantalla || 'Gracias por hacer una pausa con nosotros'}</span><small>{desactualizado?'Reconectando · última información disponible':'Imágenes ilustrativas · Precios actualizados automáticamente'}</small></footer>
  </div>;
}
