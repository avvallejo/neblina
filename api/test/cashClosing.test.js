const test=require('node:test');
const assert=require('node:assert/strict');
const {closingAmounts}=require('../src/services/cashClosing');
const resumen={esperado:1440,transferencias:300,tarjeta:200,mixtoBanco:60,sinDesglose:0};
const body={efectivoEntregado:940,fondoRetenido:500,transferenciasVerificadas:360,tarjetaVerificada:200};
test('corte suma recibido y fondo retenido sin sumar las notas otra vez',()=>{
  const a=closingAmounts(resumen,body);
  assert.equal(a.contado,1440);assert.equal(a.diferenciaEfectivo,0);assert.equal(a.diferenciaBanco,0);
});
test('faltantes y sobrantes conservan su signo y centavos',()=>{
  assert.equal(closingAmounts(resumen,{...body,efectivoEntregado:900.25}).diferenciaEfectivo,-39.75);
  assert.equal(closingAmounts(resumen,{...body,efectivoEntregado:941}).diferenciaEfectivo,1);
});
test('sin datos suficientes no inventa una diferencia',()=>{
  const a=closingAmounts({...resumen,esperado:null,sinDesglose:1},body);
  assert.equal(a.diferenciaEfectivo,null);assert.equal(a.diferenciaBanco,null);
});
test('campos vacíos, negativos y no numéricos no equivalen a cero',()=>{
  for(const v of ['',null,-1,'abc',true,Infinity])assert.throws(()=>closingAmounts(resumen,{...body,efectivoEntregado:v}));
});
test('un faltante de transferencias no se oculta con sobrante de tarjeta',()=>{
  const a=closingAmounts({...resumen,mixtoBanco:0},{...body,transferenciasVerificadas:290,tarjetaVerificada:210});
  assert.equal(a.diferenciaBanco,0);assert.equal(a.diferenciaTransferencias,-10);assert.equal(a.diferenciaTarjeta,10);
});
