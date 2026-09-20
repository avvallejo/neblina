import React, {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import * as api from '../api/client.js';
import {tableMenuUrl} from '../lib/tableMenu.js';
import './tableMenu.css';
export default function TableQr({sucursalId}) {
 const [cards,setCards]=useState(null),[name,setName]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  let live=true;
  (async()=>{
   const sedes=await api.getSucursales();
   const sede=sedes.find(s=>s.id===sucursalId);
   if(!sede)throw new Error('Abre los códigos QR desde Configuración de la sucursal.');
   api.setSucursal(sede);
   const cfg=await api.getConfig();
   const count=Number(cfg.mesas ?? 4);
   if(!Number.isInteger(count)||count<0||count>200)throw new Error('Revisa la cantidad de mesas en Configuración.');
   const generated=await Promise.all(Array.from({length:count},async(_,i)=>{
    const url=tableMenuUrl(window.location.origin,sede.id,i+1);
    return {mesa:i+1,url,image:await QRCode.toDataURL(url,{width:600,margin:4,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#ffffff'}})};
   }));
   if(live){setName(cfg.nombreNegocio||sede.nombre);setCards(generated);}
  })().catch(e=>{if(live)setError(e.message)});
  return()=>{live=false};
 },[sucursalId]);
 return <main className="table-qr"><header className="table-qr-controls"><h1>QR para las mesas</h1><p>Imprime las tarjetas y coloca cada una en su mesa. Abren el menú completo, sin registro.</p><p>Puedes guardar como PDF desde la ventana de impresión. Los cambios de precios no requieren imprimir otro QR.</p><button className="btn-primary" disabled={!cards?.length} onClick={()=>window.print()}>Imprimir tarjetas / Guardar PDF</button></header>{error && <p role="alert">{error}</p>}{!cards&&!error&&<p role="status">Preparando códigos…</p>}{cards?.length===0&&<p>Configura al menos una mesa en Administración → Configuración.</p>}<div className="table-qr-grid">{cards?.map(card=><article className="table-qr-card" key={card.mesa}><h2>{name}</h2><h3>Mesa {card.mesa}</h3><img width="240" height="240" src={card.image} alt={`Código QR del menú para mesa ${card.mesa}`}/><p>Escanea para ver el menú</p><small>Apunta con la cámara de tu celular</small><a href={card.url} target="_blank" rel="noreferrer">Abrir menú de mesa {card.mesa}</a></article>)}</div></main>;
}
