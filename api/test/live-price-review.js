// Solo desarrollo, tras aplicar db/19: prueba de persistencia con rollback.
const assert = require('node:assert/strict');
const { pool } = require('./src/db');
const { mantenerPrecio, preciosPorRevisar } = require('./src/services/priceReview');
(async () => {
  assert.equal(process.env.NODE_ENV,'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const {rows:[cat]} = await c.query('SELECT id,sucursal_id FROM categorias_producto LIMIT 1');
    const {rows:[matCat]} = await c.query('SELECT id FROM categorias_materia_prima WHERE sucursal_id=$1 LIMIT 1',[cat.sucursal_id]);
    const {rows:[m]} = await c.query(`INSERT INTO materias_primas (nombre,categoria_id,sucursal_id,unidad,costo_unitario)
      VALUES ('QA precio', $1,$2,'g',2) RETURNING id`,[matCat.id,cat.sucursal_id]);
    const {rows:[p]} = await c.query(`INSERT INTO productos (nombre,categoria_id,sucursal_id,tipo,precio_base)
      VALUES ('QA mantener precio',$1,$2,'bebida',9999) RETURNING id`,[cat.id,cat.sucursal_id]);
    await c.query(`INSERT INTO recetas (producto_id,pasos) VALUES ($1,'["Preparar"]') ON CONFLICT (producto_id) DO NOTHING`,[p.id]);
    await c.query("INSERT INTO receta_insumos_fijos (producto_id,materia_prima_id,cantidad,unidad) VALUES ($1,$2,1,'g')",[p.id,m.id]);
    const current = async () => (await preciosPorRevisar(c,cat.sucursal_id)).find(r=>r.id===p.id);
    const keep = revision => mantenerPrecio(c,{id:p.id,sucursalId:cat.sucursal_id,revision});
    let row = await current(); assert.ok(row);
    const initial = row.revision;
    await keep(initial);
    assert.equal(await current(),undefined);
    // Repetir consultas representa cerrar/abrir y otra sesión: decisión en DB.
    assert.equal(await current(),undefined);
    assert.equal(Number((await c.query('SELECT precio_base FROM productos WHERE id=$1',[p.id])).rows[0].precio_base),9999);
    await c.query('UPDATE materias_primas SET stock_actual=12 WHERE id=$1',[m.id]);
    await c.query('UPDATE productos SET margen_porcentaje=90 WHERE id=$1',[p.id]);
    assert.equal(await current(),undefined);
    await c.query("SET LOCAL TIME ZONE 'America/Mexico_City'");
    assert.equal(await current(),undefined);
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    assert.equal(await current(),undefined);
    await c.query('UPDATE recetas SET actualizado_en=clock_timestamp() WHERE producto_id=$1',[p.id]);
    assert.equal(await current(),undefined);
    await c.query(`INSERT INTO opciones_cafe (codigo,etiqueta,sucursal_id,materia_prima_id,delta_precio) VALUES ('qa_opcional','QA café alternativo',$1,$2,5)`,[cat.sucursal_id,m.id]);
    await c.query(`INSERT INTO opciones_leche (codigo,etiqueta,sucursal_id,materia_prima_id,delta_precio) VALUES ('qa_opcional','QA leche alternativa',$1,$2,5)`,[cat.sucursal_id,m.id]);
    assert.equal(await current(),undefined);
    await c.query('UPDATE materias_primas SET costo_unitario=3 WHERE id=$1',[m.id]);
    row = await current(); assert.ok(row); assert.notEqual(row.revision,initial);
    await assert.rejects(()=>keep(initial),e=>e.status===409);
    await assert.rejects(()=>mantenerPrecio(c,{id:p.id,sucursalId:'00000000-0000-4000-8000-000000000000',revision:row.revision}),e=>e.status===409);
    await keep(row.revision);
    await c.query(`UPDATE recetas SET pasos='["Preparar distinto"]',actualizado_en=clock_timestamp() WHERE producto_id=$1`,[p.id]);
    row = await current(); assert.ok(row); await keep(row.revision);
    await c.query('UPDATE receta_insumos_fijos SET cantidad=2 WHERE producto_id=$1',[p.id]);
    row=await current(); assert.ok(row); await keep(row.revision);
    await c.query(`INSERT INTO materias_primas (nombre,categoria_id,sucursal_id,unidad,costo_unitario)
      VALUES ('QA ajeno',$1,$2,'g',8)`,[matCat.id,cat.sucursal_id]);
    assert.equal(await current(),undefined);
    console.log('PASS: conserva precio, persiste, reaparece por receta/ingrediente/costo, ignora stock/margen/insumos ajenos, rechaza revisiones obsoletas y otra sucursal.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
