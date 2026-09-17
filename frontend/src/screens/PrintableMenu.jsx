import React, { useEffect, useRef, useState } from 'react';
import * as api from '../api/client.js';
import { categoryOf } from '../lib/tvMenu.js';
import './printableMenu.css';

export default function PrintableMenu({ sucursalId }) {
  const [theme,setTheme]=useState('claro'),[paper,setPaper]=useState('letter');
  const [categories,setCategories]=useState([]),[selected,setSelected]=useState(null);
  const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [name,setName]=useState('Menú para imprimir');
  const lock=useRef(false),blobUrl=useRef('');
  const generate=async(download=false)=>{
    if(lock.current)return; lock.current=true;setBusy(true);setError('');setNotice('');
    try {
      const sedes=await api.getSucursales();
      const sede=sedes.find(s=>s.id===(sucursalId || api.getSucursal()?.id)) || (!sucursalId && sedes[0]);
      if(!sede)throw new Error('No se encontró la sucursal. Abre esta opción desde Administración.');
      api.setSucursal(sede);
      const [cfg,cats,all,options,module]=await Promise.all([api.getConfig(),api.getCategorias(),api.getProductos(),api.getOpciones(),import('../lib/printMenu.js')]);
      const available=[...new Set([...cats.map(c=>c.nombre),...all.map(categoryOf)])].filter(c=>all.some(p=>p.activo!==false && categoryOf(p)===c));
      setCategories(available);setName(cfg.nombreNegocio || sede.nombre);
      const chosen=selected===null?available:available.filter(c=>selected.includes(c));
      const products=all.filter(p=>p.activo!==false && chosen.includes(categoryOf(p)));
      if(!products.length)throw new Error('Selecciona al menos una categoría con productos activos.');
      const {images,failed}=await module.menuPhotos(products,cfg.logo);
      const doc=module.createMenuPdf({brand:{nombre:cfg.nombreNegocio,logo:cfg.logo},sede:sede.nombre,products,categories:chosen,options,images,theme,paper});
      const next=URL.createObjectURL(doc.output('blob'));
      if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);
      blobUrl.current=next;setUrl(next);
      setNotice(`Precios consultados ahora · ${doc.getNumberOfPages()} página(s).${failed.length?' Algunas imágenes no pudieron cargarse; puedes volver a generar el menú.':''}`);
      if(download)doc.save(`menu-${(cfg.nombreNegocio || sede.nombre).replace(/[^a-z0-9áéíóúñ-]/gi,'-')}-${new Date().toISOString().slice(0,10)}.pdf`);
    }catch(e){setError(e.message);setUrl('');}finally{lock.current=false;setBusy(false);}
  };
  useEffect(()=>{generate();return()=>{if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);};},[]);
  return <main className="print-menu-page">
    <header><span className="print-kicker">DE LA PANTALLA A TU MESA</span><h1>{name}</h1><p>Tu carta lista para imprimir, con fotos y precios actuales.</p></header>
    <section className="print-menu-controls">
      <label>Diseño<select value={theme} disabled={busy} onChange={e=>setTheme(e.target.value)}><option value="claro">Papel claro · ahorra tinta</option><option value="oscuro">Neblina oscuro · estilo pizarra</option></select></label>
      <label>Papel<select value={paper} disabled={busy} onChange={e=>setPaper(e.target.value)}><option value="letter">Carta horizontal</option><option value="a4">A4 horizontal</option></select></label>
      <fieldset disabled={busy}><legend>Categorías del menú</legend>{categories.map(c=><label key={c}><input type="checkbox" checked={selected===null || selected.includes(c)} onChange={()=>setSelected(prev=>{const old=prev===null?categories:prev;return old.includes(c)?old.filter(x=>x!==c):[...old,c];})}/>{c}</label>)}</fieldset>
      <div className="print-menu-actions"><button className="btn-secondary" disabled={busy} onClick={()=>generate()}>Actualizar vista previa</button><button className="btn-primary" disabled={busy} onClick={()=>generate(true)}>{busy?'Preparando menú…':'Descargar PDF actualizado'}</button></div>
      <p>Cada descarga consulta nuevamente los precios. El PDF ya descargado no cambia: genera otro después de modificar el menú. Para imprimir, abre el PDF y elige tamaño real o ajustar a página.</p>
      {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
    </section>
    {url&&<iframe title="Vista previa del menú PDF" src={url} className="print-menu-preview"/>}
  </main>;
}
