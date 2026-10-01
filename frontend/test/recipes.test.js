import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecipe } from '../src/lib/recipes.js';
import { SIZE_OPTIONS,EXTRA_OPTIONS,replaceArray,extrasPara } from '../src/lib/catalog.js';
replaceArray(SIZE_OPTIONS,[{id:'12',lecheMl:280},{id:'16',lecheMl:360}]);
replaceArray(EXTRA_OPTIONS,[{id:'doble',label:'Shot extra',esShot:true}]);
const latte={tipo:'bebida',name:'Latte',leche:true,coffeeType:true,sizes:true};
test('La receta muestra café y leche base sin ingredientes adicionales',()=>{
  const r=buildRecipe(latte,{size:'12',extras:[]},{insumosFijos:[],gramajePorShot:18});
  assert.ok(r.ingredientes.some(i=>i.label==='Café tradicional' && i.cantidad==='18 g'));
  assert.ok(r.ingredientes.some(i=>i.label==='Leche entera' && i.cantidad==='280 ml'));
});
test('Respeta la leche propia y no cuenta dos veces el shot adicional',()=>{
  const r=buildRecipe(latte,{size:'16',extras:['doble']},{insumosFijos:[],gramajePorShot:20,lecheMl:{16:240}});
  assert.deepEqual(r.ingredientes.filter(i=>i.label.toLowerCase().includes('café')),[{label:'Café tradicional',cantidad:'40 g'}]);
  assert.equal(r.ingredientes.find(i=>i.label==='Leche entera').cantidad,'240 ml');
});
test('Una bebida sin café base no inventa café, gramaje ni pasos de espresso',()=>{
  const r=buildRecipe({...latte,name:'Chocolate',coffeeType:false},{extras:[]},{insumosFijos:[{label:'Chocolate',cantidad:20,unidad:'g'}]});
  assert.ok(!r.ingredientes.some(i=>i.label.toLowerCase().includes('café')));
  assert.ok(!r.params.fields.some(i=>i.label==='Gramaje'));
  assert.ok(!r.pasos.some(i=>i.includes('espresso')));
});
test('Parrilla descuenta sus ingredientes fijos y no hereda leche ni café',()=>{
  const r=buildRecipe({tipo:'alimento',name:'Hamburguesa'},{extras:[]},{insumosFijos:[{label:'Pan',cantidad:1,unidad:'pieza'}]});
  assert.deepEqual(r.ingredientes,[{label:'Pan',cantidad:'1 pieza'}]);
});
test('Solo ofrece shot extra a bebidas que tienen café base',()=>{
  assert.equal(extrasPara(latte).some(e=>e.esShot),true);
  assert.equal(extrasPara({...latte,coffeeType:false}).some(e=>e.esShot),false);
});
test('Frappé sin café no indica agregar café en sus pasos',()=>{
  const r=buildRecipe({...latte,tipo:'frappe',name:'Fresa',coffeeType:false},{extras:[]},{insumosFijos:[]});
  assert.ok(!r.pasos.some(i=>i.toLowerCase().includes('café')));
  assert.ok(!r.ingredientes.some(i=>i.label.toLowerCase().includes('café')));
});
