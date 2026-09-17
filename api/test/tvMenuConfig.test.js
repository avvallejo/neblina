const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizarPantallaPersonalizacion: normalize} = require('../src/services/tvMenuConfig');
test('TV configuration round-trips selected visibility per category',()=>{
  const input={Calientes:{visible:true,ocultas:['Café-gourmet']},Parrilla:{visible:false,ocultas:[]}};
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(input))),input);
});
test('invalid TV visibility values are normalized and bounded',()=>{
  assert.deepEqual(normalize(null),{});assert.deepEqual(normalize([]),{});
  assert.deepEqual(normalize({Calientes:{ocultas:['shot','shot',null,{},'x'.repeat(201)]}}),{Calientes:{visible:true,ocultas:['shot']}});
  assert.equal(Object.keys(normalize(Object.fromEntries(Array.from({length:150},(_,i)=>['cat'+i,{}])))).length,100);
});
