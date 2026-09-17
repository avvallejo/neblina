import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuSections, createMenuPdf } from '../src/lib/printMenu.js';
const options={tamanos:[{id:'12',label:'12 oz',delta:0},{id:'16',label:'16 oz',delta:8}],extras:[]};
const product={id:'1',name:'Café de prueba',cat:'Calientes',price:35,sizes:true,activo:true};
test('Precio actual, tamaño desde e inactivos excluidos',()=>{
 let sections=menuSections([product,{...product,id:'2',activo:false}],['Calientes'],options);
 assert.equal(sections[0].rows.length,1); assert.equal(sections[0].rows[0].price,'Desde $35');
 assert.equal(sections[1].title,'Tamaños');
 sections=menuSections([{...product,price:42}],['Calientes'],options);
 assert.equal(sections[0].rows[0].price,'Desde $42');
 assert.equal(menuSections([product],['Parrilla'],options).filter(s=>!s.extra).length,0);
});
test('Catálogo grande se pagina en ambos formatos y diseños',()=>{
 for(const paper of ['letter','a4']) for(const theme of ['claro','oscuro']) {
 const products=Array.from({length:100},(_,i)=>({...product,id:String(i),name:`Café especial ${i}`,descripcion:'Preparado al momento con leche y café.'}));
 const pdf=createMenuPdf({brand:{nombre:'NEBLINA'},sede:'Principal',products,categories:['Calientes'],options,paper,theme});
 assert(pdf.getNumberOfPages()>1); assert(pdf.output('arraybuffer').byteLength>1000);
 }
});
