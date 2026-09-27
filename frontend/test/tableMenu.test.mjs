import {test} from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {publicMenuUrl,tableMenuUrl,tableNumber} from '../src/lib/tableMenu.js';
test('QR de pantalla abre la carta de la sucursal sin asignar mesa ni conservar controles de TV', async()=>{
 const url=publicMenuUrl('https://neblinacafe.com/?pantalla=menu&mesa=9&diseno=ilustrado','sucursal-prueba');
 const parsed=new URL(url);
 assert.equal(parsed.pathname,'/');
 assert.deepEqual([...parsed.searchParams], [['pantalla','carta'],['sucursal','sucursal-prueba']]);
 assert.notEqual(url,publicMenuUrl(parsed.origin,'otra-sucursal'));
 assert.throws(()=>publicMenuUrl(parsed.origin,''));
 assert.match(await QRCode.toDataURL(url,{margin:4,errorCorrectionLevel:'M'}),/^data:image\/png;base64,/);
});
test('QR por mesa conserva sucursal y destino público, sin sesión',async()=>{
 const url=tableMenuUrl('https://neblinacafe.com','sucursal-prueba',3);
 const parsed=new URL(url);
 assert.equal(parsed.searchParams.get('pantalla'),'carta');
 assert.equal(parsed.searchParams.get('sucursal'),'sucursal-prueba');
 assert.equal(parsed.searchParams.get('mesa'),'3');
 assert.notEqual(url,tableMenuUrl(parsed.origin,'sucursal-prueba',4));
 const qr=QRCode.create(url,{errorCorrectionLevel:'M'});
 assert.equal(qr.segments.map(s=>typeof s.data==='string'?s.data:new TextDecoder().decode(s.data)).join(''),url);
 assert.match(await QRCode.toDataURL(url),/^data:image\/png;base64,/);
});
test('Mesas inválidas o retiradas no se presentan como mesa válida',()=>{
 for(const value of ['0','-1','3.5','999','hola',null]) assert.equal(tableNumber(value,4),null);
 assert.equal(tableNumber('4',4),4);
 assert.throws(()=>tableMenuUrl('https://neblinacafe.com','',1));
 assert.throws(()=>tableMenuUrl('https://neblinacafe.com','sede',201));
});
