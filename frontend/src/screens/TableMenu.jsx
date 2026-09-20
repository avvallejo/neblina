import React, { useState } from 'react';
import { Coffee, Snowflake, Flame, Cookie, Sparkles, Search, MapPin, Utensils, ArrowUpRight, ChevronDown } from 'lucide-react';
import { categoryOf, categoryOptions } from '../lib/tvMenu.js';
import { FotoBebida } from './CafeMenu.jsx';
import { tableNumber } from '../lib/tableMenu.js';
import './tableMenu.css';
const money = n => `$${Number(n).toLocaleString('es-MX', {maximumFractionDigits:2})}`;
const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const categoryIcon = c => /frio|frap/.test(normalize(c)) ? Snowflake : /parrilla|alimento|cocina/.test(normalize(c)) ? Flame : /snack|postre|pan/.test(normalize(c)) ? Cookie : Coffee;
const categoryNote = c => /frio|frap/.test(normalize(c)) ? 'Un antojo refrescante' : /parrilla|alimento|cocina/.test(normalize(c)) ? 'Para disfrutar cada bocado' : /snack|postre|pan/.test(normalize(c)) ? 'Algo dulce para acompañar' : 'Tu pausa empieza aquí';
export default function TableMenu({brand, sedeNombre, productos, categorias, opciones, cfg, mesa, desactualizado}) {
  const [search, setSearch] = useState('');
  const categories = [...new Set([...categorias, ...productos.map(categoryOf)])].filter(c => productos.some(p => categoryOf(p) === c));
  const number = tableNumber(mesa, cfg.mesas ?? 4);
  const query = normalize(search.trim());
  const visible = productos.filter(p => normalize(`${p.name} ${p.descripcion || ''} ${categoryOf(p)}`).includes(query));
  const heroProduct = productos.find(p => /latte|capuch/i.test(p.name)) || productos[0];
  return <main className="table-menu" id="menu-inicio">
    <header className="table-menu-header">
      <div className="tm-topline"><a className="tm-brand" href="#menu-inicio">{brand.logo ? <img src={brand.logo} alt={brand.nombre}/> : <><Coffee size={23}/><span>{brand.nombre}</span></>}</a><span className="tm-table"><Utensils size={13}/>{number ? `Mesa ${number}` : 'Bienvenido'}</span></div>
      <div className="tm-hero"><div className="tm-hero-copy"><span className="tm-eyebrow">HECHO PARA DISFRUTAR</span><h1>Una pausa.<br/>Un buen <em>café.</em></h1><p>{cfg.lema || 'Encuentra tu favorito y disfruta el momento.'}</p><a href="#menu-categorias">Explora el menú <ArrowUpRight size={16}/></a></div>{heroProduct && <div className="tm-hero-art" aria-hidden="true"><div className="tm-orbit"/><FotoBebida p={heroProduct}/><span>Tu momento favorito</span></div>}</div>
      <div className="tm-location"><span><MapPin size={13}/>{sedeNombre}</span><span>Precios en MXN</span></div>
    </header>
    {desactualizado && <p className="tm-offline" role="status">Reconectando. Estos son los últimos precios disponibles.</p>}
    <div className="tm-browse" id="menu-categorias"><div className="tm-menu-title"><div><span className="tm-eyebrow">DESCUBRE Y DISFRUTA</span><h2>Nuestro menú</h2></div><span>{productos.length} opciones</span></div><label className="tm-search"><Search size={18}/><input type="search" placeholder="¿Qué se te antoja hoy?" aria-label="Buscar en el menú" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
    <nav aria-label="Categorías" className="table-menu-nav">{categories.map((c,i)=>{const Icon=categoryIcon(c);return <a key={c} href={`#categoria-${i}`} onClick={()=>setSearch('')}><Icon size={16}/>{c}</a>;})}</nav>
    <div className="tm-content">
    {!visible.length && <div className="tm-empty"><Coffee size={30}/><h2>{query ? 'No encontramos ese antojo' : 'El menú está por llegar'}</h2><p>{query ? 'Prueba con otro nombre o explora las categorías.' : 'Pronto encontrarás aquí nuestros productos.'}</p>{query && <button onClick={()=>setSearch('')}>Ver todo el menú</button>}</div>}
    {categories.map((c,i)=>{
      const products=visible.filter(p=>categoryOf(p)===c);
      if(!products.length)return null;
      const Icon=categoryIcon(c);
      const extras=categoryOptions(products,opciones || {});
      const sizes=products.some(p=>p.sizes) ? opciones?.tamanos || [] : [];
      return <section key={c} id={`categoria-${i}`} className="table-menu-section"><header className="tm-section-heading"><div className="tm-category-icon"><Icon size={21}/></div><div><h2>{c}</h2><p>{categoryNote(c)}</p></div><span>{products.length.toString().padStart(2,'0')}</span></header><div className="table-menu-products">{products.map(p=>{
        const delta=p.sizes && sizes.length ? Math.min(...sizes.map(s=>Number(s.delta)||0)) : 0;
        const offer=p.precioBase>p.price;
        return <article key={p.id}><div className="table-menu-photo"><FotoBebida p={p}/></div><div className="tm-product-copy">{offer && <span className="tm-offer">Precio especial</span>}<h3>{p.name}</h3>{p.descripcion && <p>{p.descripcion}</p>}<div className="tm-product-price"><strong>{p.sizes && sizes.length>1 && <small>Desde </small>}{money(Number(p.price)+delta)}</strong>{offer && <del>{money(Number(p.precioBase)+delta)}</del>}</div></div></article>;
      })}</div>{(sizes.length>0 || extras.length>0) && <details><summary><Sparkles size={18}/><span>Hazlo a tu gusto<small>Tamaños y opciones</small></span><ChevronDown size={17}/></summary><div className="tm-options">{[...sizes.map(s=>({...s,group:'Tamaños',key:`size-${s.id}`})),...extras].map(o=><p key={o.key}><span><small>{o.group}</small>{o.label}</span><b>{Number(o.delta)===0?'Incluido':`${Number(o.delta)>0?'+':''}${money(o.delta)}`}{o.maxDelta>o.delta?` a +${money(o.maxDelta)}`:''}</b></p>)}<small>Disponibles según el producto. Los extras se suman al precio.</small></div></details>}</section>;
    })}
    <footer className="tm-footer"><Coffee size={25}/><h2>Disfruta tu pausa.</h2><p>Cuando estés listo, pide con nuestro personal.</p><span>{brand.nombre} · {sedeNombre}</span><small>Precios en MXN · Imágenes ilustrativas</small><a href="#menu-inicio">Volver al inicio ↑</a></footer>
    </div>
  </main>;
}
