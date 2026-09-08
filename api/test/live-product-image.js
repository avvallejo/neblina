// Local only. Creates a temporary product and removes it after checking HTTP persistence.
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const {pool}=require('./src/db');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
(async()=>{
 assert.equal(process.env.NODE_ENV,'development');let id;
 try{
 const {rows:[u]}=await pool.query("SELECT * FROM usuarios WHERE rol='admin' AND activo LIMIT 1");
 const {rows:[cat]}=await pool.query('SELECT * FROM categorias_producto LIMIT 1');
 const token=jwt.sign({tipo:'staff',id:u.id,ver:u.token_version},process.env.JWT_SECRET,{expiresIn:'5m'});
 const request=async(path,method='GET',body,auth=true)=>fetch('http://127.0.0.1:3000/api'+path,{method,headers:{'Content-Type':'application/json','X-Sucursal-Id':cat.sucursal_id,...(auth?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 let r=await request('/productos','POST',{nombre:'Prueba temporal de imagen',categoriaId:cat.id,tipo:'bebida',precioBase:50,imagen:png});assert.equal(r.status,201,await r.clone().text());id=(await r.json()).id;
 const listed=async()=>{const r=await request('/productos?sucursal='+cat.sucursal_id);assert.equal(r.status,200);return (await r.json()).find(p=>p.id===id);};
 let p=await listed();assert.ok(p.imagen_url);assert.equal(p.imagen,undefined);
 r=await fetch('http://127.0.0.1:3000'+p.imagen_url);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/image\/png/);assert.equal(Buffer.from(await r.arrayBuffer()).toString('base64'),png.split(',')[1]);
 r=await request('/productos/'+id,'PATCH',{descripcion:'Otra edición'});assert.equal(r.status,200);assert.equal((await listed()).imagen_url,p.imagen_url);
 r=await request('/productos/'+id,'PATCH',{imagen:'data:image/svg+xml;base64,PHN2Zz4='});assert.equal(r.status,400);
 r=await request('/productos/'+id,'PATCH',{imagen:null},false);assert.equal(r.status,401);
 r=await request('/productos/'+id,'PATCH',{imagen:null});assert.equal(r.status,200);assert.equal((await listed()).imagen_url,null);
 console.log('PASS: create photo, reload catalog, serve bytes, preserve on other edits, reject invalid/unauthorized uploads, remove photo.');
 }finally{if(id)await pool.query('DELETE FROM productos WHERE id=$1',[id]);await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
