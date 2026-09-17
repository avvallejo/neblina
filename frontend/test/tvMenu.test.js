import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryOptions, categoryPages, categoryOf } from '../src/lib/tvMenu.js';
import { menuIllustration } from '../src/lib/menuImages.js';
const products = [{ id:1, name:'Latte',cat:'Calientes',tipo:'bebida',sizes:true,coffeeType:true,leche:true,extras:true }, { id:2,name:'Hamburguesa',cat:'Parrilla',tipo:'alimento',extras:true }];
const options = { tamanos:[{id:'12oz',delta:0}], cafes:[{id:'gourmet',label:'Gourmet',delta:3}],leches:[{id:'entera',delta:0}],extras:[{id:'shot',delta:12},{id:'queso',delta:10,aplicaA:'alimentos'}] };
const layout = { products:4, extras:6 };
test('TV omits sizes and keeps extras in their food or beverage category',()=>{
  const hot=categoryOptions([products[0]],options);
  assert.deepEqual(hot.map(o=>o.id),['gourmet','entera','shot']);
  assert.deepEqual(categoryOptions([products[1]],options).map(o=>o.id),['queso']);
});
test('selection hides individual options or a whole category without changing sale options',()=>{
  const cfg={Calientes:{ocultas:['Café-gourmet']},Parrilla:{visible:false}};
  const pages=categoryPages(['Calientes','Parrilla'],products,categoryOf,options,layout,cfg);
  assert.deepEqual(pages[0].extras.map(o=>o.id),['entera','shot']);
  assert.deepEqual(pages[1].extras,[]);
  assert.equal(options.cafes.length,1);
  assert.equal(options.extras.length,2);
});
test('every product and every selected option remains reachable with pagination',()=>{
  const many=Array.from({length:19},(_,id)=>({...products[0],id}));
  const pages=categoryPages(['Calientes'],many,categoryOf,options,{products:4,extras:1});
  assert.equal(new Set(pages.flatMap(p=>p.items.map(i=>i.id))).size,19);
  assert.equal(new Set(pages.flatMap(p=>p.extras.map(i=>i.id))).size,3);
  assert(pages.every(p=>p.items.length<=4&&p.extras.length<=1));
});
test('coffee surcharges preserve product-specific pricing ranges',()=>{
  const hot=categoryOptions([products[0],{...products[0],coffeePrices:{gourmet:7}}],options);
  assert.equal(hot[0].delta,3);assert.equal(hot[0].maxDelta,7);
});
test('all pictured menu products have individual illustrations including strawberry frappe',()=>{
  const names=['Americano','Capuchino','Cortado','Espresso','Latte','Té','Chocomilk','Esquimo de fresa','Latte Helado','Horchata','Jamaica','Refresco','Frappé de Fresa','Frappe Moka','Frappé Café','Frappé Oreo','Hamburguesa Clasica','Hamburguesa Hawaiana','Papas','Quesaburger','Torta','Brownies','Conchas','Galleta Chispas','Galleta NY','Muffins','Orejas','Tarta de Fruta'];
  names.forEach(name=>assert(menuIllustration({name}),name));
  assert.notDeepEqual(menuIllustration({name:'Frappé de Fresa'}),menuIllustration({name:'Frappé Café'}));
  assert.equal(menuIllustration({name:'Nuevo producto'}),null);
});
