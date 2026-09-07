// Docker local, migración 20 instalada. Todo se revierte.
const assert=require('node:assert/strict');
const {pool}=require('./src/db');
const {calcularPrecioItem}=require('./src/utils/pricing');
(async()=>{
  assert.equal(process.env.NODE_ENV,'development');
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const {rows:[base]}=await c.query("SELECT * FROM opciones_cafe WHERE codigo='tradicional' AND materia_prima_id IS NOT NULL LIMIT 1");
    const {rows:[other]}=await c.query("SELECT * FROM opciones_cafe WHERE sucursal_id=$1 AND codigo<>'tradicional' AND materia_prima_id IS NOT NULL LIMIT 1",[base.sucursal_id]);
    await c.query('UPDATE opciones_cafe SET precio_automatico=true,activo=true WHERE id=ANY($1::int[])',[[base.id,other.id]]);
    await c.query("UPDATE materias_primas SET unidad='kg',costo_unitario=254 WHERE id=$1",[base.materia_prima_id]);
    await c.query("UPDATE materias_primas SET unidad='g',costo_unitario=.284 WHERE id=$1",[other.materia_prima_id]);
    await c.query('UPDATE configuracion_margen SET porcentaje_ganancia_normal=80,redondeo=1 WHERE sucursal_id=$1',[base.sucursal_id]);
    const price=async g=>Number((await c.query('SELECT fn_recargo_cafe($1,$2) AS precio',[other.id,g])).rows[0].precio);
    assert.equal(await price(18),1);assert.equal(await price(36),2);
    const {rows:[cat]}=await c.query('SELECT id FROM categorias_producto WHERE sucursal_id=$1 LIMIT 1',[base.sucursal_id]);
    const {rows:[p]}=await c.query(`INSERT INTO productos (nombre,categoria_id,sucursal_id,tipo,precio_base,permite_tipo_cafe,permite_tamanos,permite_leche,permite_extras)
      VALUES ('QA precio por gramos',$1,$2,'frappe',50,true,false,false,false) RETURNING id`,[cat.id,base.sucursal_id]);
    await c.query("INSERT INTO recetas (producto_id,pasos,gramaje_por_shot) VALUES ($1,'[\"Licuar\"]',18) ON CONFLICT(producto_id) DO UPDATE SET gramaje_por_shot=18",[p.id]);
    const charge=()=>calcularPrecioItem({productoId:p.id,cafeId:other.id,sucursalId:base.sucursal_id},c.query.bind(c));
    assert.equal(await charge(),51);
    await c.query('UPDATE materias_primas SET costo_unitario=.335 WHERE id=$1',[other.materia_prima_id]);
    assert.equal(await price(18),3);assert.equal(await charge(),53);
    await c.query('UPDATE recetas SET gramaje_por_shot=36 WHERE producto_id=$1',[p.id]);
    assert.equal(await charge(),56);
    await c.query('UPDATE opciones_cafe SET precio_automatico=false,delta_precio=7 WHERE id=$1',[other.id]);
    assert.equal(await charge(),57);
    console.log('PASS: conversión g/kg, margen, redondeo, cambios de costo y gramaje, precio cobrado y modo manual.');
  } finally {await c.query('ROLLBACK');c.release();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
