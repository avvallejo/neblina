import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Search, X } from 'lucide-react';
import { coffeeSections, coffeeSources, findCoffeeArticles } from '../lib/coffeeGuide.js';
import './CoffeeGuide.css';

function GuideDialog({ onClose }) {
  const dialog = useRef(null);
  const [section, setSection] = useState(coffeeSections[0]);
  const [query, setQuery] = useState('');
  const articles = findCoffeeArticles(query, section);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog.current.showModal();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return createPortal(
    <dialog ref={dialog} className="coffee-guide" aria-labelledby="coffee-guide-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="coffee-guide-inner">
        <header className="coffee-guide-heading">
          <div><span className="coffee-guide-eyebrow">APRENDER · PREPARAR · COMPARTIR</span><h2 id="coffee-guide-title">Guía de café</h2><p>Una buena taza empieza por conocerla.</p></div>
          <button type="button" className="icon-btn" aria-label="Cerrar guía de café" onClick={onClose}><X size={22} /></button>
        </header>
        <div className="coffee-guide-tools">
          <label className="coffee-guide-search"><Search size={18} /><input autoFocus aria-label="Buscar en la guía de café" placeholder="Busca: latte, tostado, origen…" value={query} onChange={e => setQuery(e.target.value)} type="search" /></label>
          <div className="coffee-guide-sections" aria-label="Temas de la guía">{coffeeSections.map(name => <button key={name} type="button" aria-pressed={!query && section === name} onClick={() => { setSection(name); setQuery(''); }}>{name}</button>)}</div>
        </div>
        <div className="coffee-guide-content">
          <p className="coffee-guide-note">Antes de responder, confirma qué café está en uso. Para cantidades y preparación de un pedido, consulta su receta.</p>
          {query && <p role="status">{articles.length} resultado{articles.length === 1 ? '' : 's'} en todos los temas</p>}
          {!articles.length && <p>No encontramos ese tema. Prueba con “leche”, “Chiapas” o “capuchino”.</p>}
          {articles.map(article => <details className="coffee-guide-card" key={`${section}-${query}-${article.id}`} open={query.trim() ? true : undefined}>
            <summary>{article.title}</summary>
            <div className="coffee-guide-answer"><span>PARA CONTÁRSELO AL CLIENTE</span><p>{article.answer}</p></div>
            {article.facts && <dl>{article.facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
            <p className="coffee-guide-detail">{article.detail}</p>
            {article.image && <details className="coffee-guide-photo"><summary>Ver ficha original del proveedor</summary><img src={article.image} alt={`Ficha del proveedor: ${article.title}`} loading="lazy" /></details>}
            {article.source && <a className="coffee-guide-source" href={coffeeSources[article.source][1]} target="_blank" rel="noreferrer">{coffeeSources[article.source][0]} ↗</a>}
          </details>)}
          <p className="coffee-guide-foot">Información de Rilly de Liévano y fichas compartidas por el negocio. Material de consulta del personal · revisado en septiembre de 2026.</p>
        </div>
      </div>
    </dialog>, document.body);
}

export default function CoffeeGuide() {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="coffee-guide-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog"><BookOpen size={17} /><span>Guía de café</span></button>{open && <GuideDialog onClose={() => setOpen(false)} />}</>;
}
