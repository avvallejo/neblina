import test from 'node:test';
import assert from 'node:assert/strict';
import {newerSameSession} from '../src/api/session.js';
const jwt=(extra={})=>`header.${Buffer.from(JSON.stringify({tipo:'staff',id:'u1',suc:'s1',ver:0,exp:100,...extra})).toString('base64url')}.signature`;
test('sincroniza solo credenciales más recientes del mismo usuario, sede y versión',()=>{
  const current=jwt();assert.equal(newerSameSession(current,jwt({exp:200})),true);
  for(const candidate of [jwt({exp:99}),jwt({exp:200,id:'otro'}),jwt({exp:200,suc:'otra'}),jwt({exp:200,ver:1}),jwt({exp:200,tipo:'cliente'}),'invalid',null]) assert.equal(newerSameSession(current,candidate),false);
});
test('cliente renueva sin recargar y conserva la captura sin repetir escrituras ante sesión vencida',async()=>{
  const storage=()=>{const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
  globalThis.localStorage=storage();globalThis.sessionStorage=storage();globalThis.window=new EventTarget();
  const api=await import('../src/api/client.js');api.setBaseUrl('http://test/api');api.setToken(jwt());
  let calls=[],renewed=jwt({exp:200}),expire=false,required=0;
  window.addEventListener('cafeteria:session-required',()=>required++);
  globalThis.fetch=async(url,opts)=>{calls.push({url,...opts});return new Response(JSON.stringify(expire?{error:'Confirma tu sesión',details:{codigo:'sesion_requerida'}}:{ok:true}),{status:expire?401:200,headers:renewed?{'X-Session-Token':renewed}:{}});};
  await api.getYo();assert.equal(api.getToken(),renewed);assert.equal(sessionStorage.getItem('cafeteria_token'),renewed);
  renewed=null;
  localStorage.setItem('cafeteria_token',jwt({exp:300}));await api.getYo();assert.equal(calls.at(-1).headers.Authorization,`Bearer ${jwt({exp:300})}`);
  localStorage.setItem('cafeteria_token',jwt({id:'otro',exp:400}));await api.getYo();assert.equal(calls.at(-1).headers.Authorization,`Bearer ${jwt({exp:300})}`);
  const before=calls.length;expire=true;
  await assert.rejects(api.solicitarDescuento({motivo:'Mi captura'}),e=>e.status===401);
  assert.equal(calls.length,before+1);assert.equal(required,1);assert.equal(api.getToken(),jwt({exp:300}));
});
