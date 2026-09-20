import React from 'react';
import { categoryOf, categoryOptions } from '../lib/tvMenu.js';
import { FotoBebida } from './CafeMenu.jsx';
import { tableNumber } from '../lib/tableMenu.js';
import './tableMenu.css';
const money = n => `$${Number(n).toLocaleString('es-MX', {maximumFractionDigits:2})}`;
export default function TableMenu({brand, sedeNombre, productos, categorias, opciones, cfg, mesa, desactualizado}) {
  const categories = [...new Set([...categorias, ...productos.map(categoryOf)])].filter(c => productos.some(p => categoryOf(p) === c));
  const number = tableNumber(mesa, cfg.mesas ?? 4);
  return <main className="table-menu">
    <header className="table-menu-header">{brand.logo && <img src={brand.logo} alt=""/>}<h1>{brand.nombre}</h1><p>{sedeNombre}{number ? ` · Mesa ${number}` : ''}</p><h2>Nuestro menú</h2><p>Elige a tu gusto y pide con nuestro personal.</p><small>Precios en MXN · Imágenes ilustrativas</small></header>
    {desactualizado && <p role="status">Reconectando. Estos son los últimos precios disponibles.</p>}
    <nav aria-label="Categorías" className="table-menu-nav">{categories.map((c,i)=><a key={c} href={`#categoria-${i}`}>{c}</a>)}</nav>
    {!productos.length && <p>Pronto encontrarás aquí nuestro menú.</p>}
    {categories.map((c,i)=>{
      const products=productos.filter(p=>categoryOf(p)===c);
      const extras=categoryOptions(products,opciones || {});
      const sizes=products.some(p=>p.sizes) ? opciones?.tamanos || [] : [];
      return <section key={c} id={`categoria-${i}`} className="table-menu-section"><h2>{c}</h2><div className="table-menu-products">{products.map(p=>{
        const delta=p.sizes && sizes.length ? Math.min(...sizes.map(s=>Number(s.delta)||0)) : 0;
        return <article key={p.id}><div className="table-menu-photo"><FotoBebida p={p}/></div><div><h3>{p.name}</h3>{p.descripcion && <p>{p.descripcion}</p>}<strong>{p.sizes && sizes.length>1 ? 'Desde ' : ''}{money(Number(p.price)+delta)}</strong>{p.precioBase>p.price && <del>{money(Number(p.precioBase)+delta)}</del>}</div></article>;
      })}</div>{(sizes.length>0 || extras.length>0) && <details><summary>Tamaños y opciones</summary>{[...sizes.map(s=>({...s,group:'Tamaños',key:`size-${s.id}`})),...extras].map(o=><p key={o.key}><span>{o.group} · {o.label}</span><b>{Number(o.delta)===0?'Incluido':`${Number(o.delta)>0?'+':''}${money(o.delta)}`}{o.maxDelta>o.delta?` a +${money(o.maxDelta)}`:''}</b></p>)}<small>Disponibles según el producto. Los extras se suman al precio.</small></details>}</section>;
    })}
  </main>;
}
