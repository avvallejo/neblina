import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewClosing } from '../src/lib/cashClosing.js';

const data = { resumen: { esperado:952, transferencias:0, tarjeta:116, mixtoBanco:0, sinDesglose:0 }, notas:[] };
const form = { efectivoEntregado:'752', fondoRetenido:'200', transferenciasVerificadas:'0', tarjetaVerificada:'116', entrega:'Caja 1', recibe:'Administradora', observaciones:'' };

test('captura con sobrantes explica por qué falta la observación antes de guardar',()=>{
  const review=reviewClosing(data,{...form,efectivoEntregado:'952',transferenciasVerificadas:'10'},[]);
  assert.equal(review.cash,200);assert.equal(review.bank,10);
  assert.deepEqual(review.reasons,['Efectivo: sobran $200.00.','Transferencias: sobran $10.00.']);
  assert.equal(review.errors[0].field,'observaciones');
});
test('entrega sin el fondo retenido cuadra, y permite guardar diferencias explicadas',()=>{
  assert.deepEqual(reviewClosing(data,form,[]).errors,[]);
  assert.deepEqual(reviewClosing(data,form,[]).reasons,[]);
  assert.deepEqual(reviewClosing(data,{...form,efectivoEntregado:'952',observaciones:'Se recibió efectivo adicional documentado.'},[]).errors,[]);
});
test('transferencia faltante y tarjeta sobrante requieren explicación aunque el total cuadre',()=>{
  const review=reviewClosing({...data,resumen:{...data.resumen,transferencias:10,tarjeta:106}},form,[]);
  assert.equal(review.bank,0);assert.equal(review.errors[0].field,'observaciones');
  assert.deepEqual(review.reasons,['Transferencias: faltan $10.00.','Tarjeta: sobran $10.00.']);
});
test('mixtos comparan la suma bancaria sin inventar el desglose de tarjeta y transferencia',()=>{
  const review=reviewClosing({...data,resumen:{...data.resumen,tarjeta:100,mixtoBanco:16}},form,[]);
  assert.equal(review.bank,0);assert.equal(review.transfers,null);assert.equal(review.card,null);
  assert.deepEqual(review.errors,[]);
});
test('notas sin revisar e importes desconocidos requieren explicación, notas anuladas no',()=>{
  const withNotes={...data,notas:[{id:'a'},{id:'b',anulado:true}]};
  assert.deepEqual(reviewClosing(withNotes,form,[]).reasons,['1 nota(s) pendiente(s) de revisar.']);
  assert.deepEqual(reviewClosing(withNotes,form,['a']).errors,[]);
  const unknown=reviewClosing({...data,resumen:{...data.resumen,esperado:null,sinDesglose:1}},form,[]);
  assert.equal(unknown.cash,null);assert.equal(unknown.bank,null);assert.equal(unknown.errors[0].field,'observaciones');
});
test('campos vacíos no pasan como cero; texto en blanco no explica una diferencia',()=>{
  for(const value of ['', ' ', null, undefined, 'abc', -1, Infinity, 100000000]){
    assert.equal(reviewClosing(data,{...form,efectivoEntregado:value},[]).errors[0].field,'efectivoEntregado');
  }
  assert.equal(reviewClosing(data,{...form,recibe:' '},[]).errors[0].field,'recibe');
  assert.equal(reviewClosing(data,{...form,efectivoEntregado:952,observaciones:'   '},[]).errors[0].field,'observaciones');
});
