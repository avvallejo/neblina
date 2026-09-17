import { jsPDF } from 'jspdf';
import { categoryOf, categoryOptions } from './tvMenu.js';
import { menuIllustration } from './menuImages.js';

const money = n => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 });
// Standard PDF fonts support Spanish; remove unsupported symbols, never prices.
const clean = s => String(s || '').replace(/[\u2010-\u2015]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '').trim();
export function menuSections(products, categories, options) {
  const visible = products.filter(p => p.activo !== false && categories.includes(categoryOf(p)));
  const sections = categories.map(title => ({ title, rows: visible.filter(p => categoryOf(p) === title).map(p => {
    const deltas = p.sizes ? (options.tamanos || []).map(t => Number(t.delta) || 0) : [];
    return { id: p.id, name: p.name, detail: p.descripcion || (p.sizes ? 'Elige tu tamaño' : ''),
      price: `${deltas.length > 1 ? 'Desde ' : ''}${money(Number(p.price) + (deltas.length ? Math.min(...deltas) : 0))}` };
  }) })).filter(s => s.rows.length);
  const extras = categoryOptions(visible, options);
  if (visible.some(p => p.sizes)) extras.push(...(options.tamanos || []).map(o => ({ ...o, group: 'Tamaños', key: `size-${o.id}` })));
  for (const title of [...new Set(extras.map(o => o.group))]) {
    sections.push({ title, extra: true, rows: extras.filter(o => o.group === title).map(o => ({ name: o.label,
      price: Number(o.delta) === 0 ? 'Incluido' : `${Number(o.delta) > 0 ? '+' : ''}${money(o.delta)}`,
      detail: o.maxDelta > o.delta ? `Hasta +${money(o.maxDelta)} según producto` : '' })) });
  }
  return sections;
}

export async function menuPhotos(products, logo) {
  const cache = new Map();
  const load = src => {
    if (!cache.has(src)) cache.set(src, new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => reject(new Error('La imagen tardó demasiado')), 12000);
      img.onload = () => { clearTimeout(timeout); resolve(img); };
      img.onerror = () => { clearTimeout(timeout); reject(new Error('No se pudo cargar la imagen')); };
      img.src = src;
    }));
    return cache.get(src);
  };
  const images = {}; const failed = [];
  await Promise.all([...products.map(p => ({ id: p.id, src: p.imagen, asset: !p.imagen && menuIllustration(p) })), ...(logo ? [{ id: 'logo', src: logo }] : [])].map(async p => {
    if (!p.src && !p.asset) return;
    try {
      const img = await load(p.src || p.asset.src);
      const frame = p.asset ? p.asset.viewBox.split(' ').map(Number) : [0, 0, img.naturalWidth, img.naturalHeight];
      const [x,y,w,h] = frame;
      const canvas = document.createElement('canvas'); const scale = Math.min(1, 360 / Math.max(w,h));
      canvas.width = Math.max(1, Math.round(w*scale)); canvas.height = Math.max(1, Math.round(h*scale));
      canvas.getContext('2d').drawImage(img,x,y,w,h,0,0,canvas.width,canvas.height);
      images[p.id] = { data: canvas.toDataURL('image/png'), ratio: w/h };
    } catch { failed.push(p.id); }
  }));
  return { images, failed };
}

export function createMenuPdf({ brand, sede, products, categories, options, images = {}, theme = 'claro', paper = 'letter', generatedAt = new Date() }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: paper, compress: true });
  const dark = theme === 'oscuro';
  const bg = dark ? '#19140F' : '#FFFEFB'; const ink = dark ? '#FFF3DC' : '#30251B';
  const muted = dark ? '#C5B79F' : '#746453'; const gold = dark ? '#E5B45F' : '#946018';
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
  const margin = 12, gap = 8, cw = (w - 2*margin - 2*gap)/3, top = 47, bottom = h-16;
  const date = generatedAt.toLocaleString('es-MX', { timeZone:'America/Mexico_City', dateStyle:'medium', timeStyle:'short' });
  const text = (s,x,y,size=10,font='normal',color=ink,opts={}) => {
    doc.setFont('helvetica',font); doc.setFontSize(size); doc.setTextColor(color); doc.text(clean(s),x,y,opts);
  };
  const drawImage = (image,x,y,maxW,maxH) => {
    const iw = Math.min(maxW,maxH*image.ratio), ih=iw/image.ratio;
    doc.addImage(image.data,'PNG',x+(maxW-iw)/2,y+(maxH-ih)/2,iw,ih);
  };
  const base = () => {
    doc.setFillColor(bg); doc.rect(0,0,w,h,'F');
    if (images.logo) drawImage(images.logo,margin,10,62,25);
    else {
      doc.setDrawColor(gold); doc.setLineWidth(0.7); doc.roundedRect(margin,15,10,9,2,2); doc.ellipse(margin+11,18,2,3);
      for(let i=0;i<3;i++) doc.line(margin+2+i*3,10,margin+2+i*3,12);
      doc.setFont('times','bold'); doc.setFontSize(27); doc.setTextColor(ink);
      const title = doc.splitTextToSize(clean(brand.nombre || 'Nuestro café'),130);
      doc.text(title.slice(0,2),margin+18,23);
    }
    text(sede,margin,37,9,'normal',muted);
    doc.setFont('times','bolditalic'); doc.setFontSize(17); doc.setTextColor(gold);
    doc.text('Una pausa. Un buen café.',w-margin,20,{align:'right'});
    text('MENÚ  /  PRECIOS EN MXN',w-margin,29,9,'bold',muted,{align:'right'});
    doc.setDrawColor(gold); doc.setLineWidth(0.25); doc.line(margin,41,w-margin,41);
  };
  base();
  let col=0,y=top;
  const advance=()=>{ col++; y=top; if(col===3){doc.addPage();base();col=0;} };
  const heading=(section, continued=false)=>{
    const x=margin+col*(cw+gap);
    if(section.extra){text(section.title,x,y+4,13,'bold',gold);y+=9;return;}
    text('HECHO AL MOMENTO',x,y,7,'bold',muted);
    doc.setFont('times','bold');doc.setFontSize(20);doc.setTextColor(gold);
    const lines=doc.splitTextToSize(clean(section.title)+(continued?' (cont.)':''),cw);
    doc.text(lines,x,y+8); y+=10+lines.length*7;
  };
  for(const section of menuSections(products,categories,options)) {
    const estimate = section.extra ? 9+section.rows.length*7+3 : 17+section.rows.reduce((sum,row)=>{
      doc.setFont('helvetica','bold');doc.setFontSize(10.5);
      const n=doc.splitTextToSize(clean(row.name),cw-(images[row.id]?17:0)-23).length;
      doc.setFont('helvetica','normal');doc.setFontSize(8);
      const d=row.detail?doc.splitTextToSize(clean(row.detail),cw-(images[row.id]?17:0)-2).length:0;
      return sum+Math.max(images[row.id]?17:12,n*4.4+d*3.3+6);
    },0)+7;
    if(y+(section.extra?18:35)>bottom || (estimate<=bottom-top && y+estimate>bottom)) advance();
    heading(section);
    for(const row of section.rows) {
      const image=images[row.id]; const iw=image?17:0; const nameW=cw-iw-23;
      doc.setFont('helvetica','bold');doc.setFontSize(10.5);
      const names=doc.splitTextToSize(clean(row.name),nameW);
      doc.setFont('helvetica','normal');doc.setFontSize(8);
      const details=row.detail?doc.splitTextToSize(clean(row.detail),cw-iw-2):[];
      const rh=section.extra ? Math.max(7,names.length*4+details.length*3+2) : Math.max(image?17:12,names.length*4.4+details.length*3.3+6);
      if(y+rh>bottom){advance();heading(section,true);}
      const x=margin+col*(cw+gap);
      if(image) drawImage(image,x,y,14,15);
      text(names.join('\n'),x+iw,y+4,10.5,'bold');
      text(row.price,x+cw,y+4,9,'bold',gold,{align:'right'});
      if(details.length) text(details.join('\n'),x+iw,y+5+names.length*4.4,8,'normal',muted);
      y+=rh; doc.setDrawColor(dark?'#493A26':'#DED4C4');doc.setLineWidth(0.15);doc.line(x,y-2,x+cw,y-2);
    }
    y+=section.extra?3:7;
  }
  const count=doc.getNumberOfPages();
  for(let i=1;i<=count;i++) {
    doc.setPage(i);
    text('Gracias por hacer una pausa con nosotros.',margin,h-8,8,'normal',muted);
    text(`${date}  |  ${i} / ${count}`,w-margin,h-8,8,'normal',muted,{align:'right'});
  }
  doc.setProperties({title:`Menú ${brand.nombre || sede}`,subject:'Precios vigentes al generar este menú',creator:'Neblina'});
  return doc;
}
