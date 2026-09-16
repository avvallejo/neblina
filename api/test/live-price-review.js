// Solo desarrollo, tras aplicar db/19: prueba de persistencia con rollback.
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const { mantenerPrecio, preciosPorRevisar } = require('../src/services/priceReview');
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
    assert.equal(await current(),undefined,'las existencias no tienen que ver con el precio');
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
    // Costos del negocio (mig 34): el sugerido lo fija el margen de
    // contribución (producto → categoría → sede) y el redondeo; los gastos
    // fijos costeables y el peso de la estación mueven el PISO.
    const cfgActual = async () => (await c.query('SELECT porcentaje_ganancia_normal,redondeo,unidades_estimadas_mes FROM configuracion_margen WHERE sucursal_id=$1 ORDER BY actualizado_en DESC LIMIT 1',[cat.sucursal_id])).rows[0] || { porcentaje_ganancia_normal: 60, redondeo: 1, unidades_estimadas_mes: null };
    const setCfg = async patch => { const a = await cfgActual(); await c.query('INSERT INTO configuracion_margen (porcentaje_ganancia_normal,redondeo,unidades_estimadas_mes,sucursal_id,actualizado_en) VALUES ($1,$2,$3,$4,clock_timestamp())',[patch.margen ?? a.porcentaje_ganancia_normal, patch.redondeo ?? a.redondeo, patch.unidades === undefined ? a.unidades_estimadas_mes : patch.unidades, cat.sucursal_id]); };
    await c.query("INSERT INTO gastos_fijos (concepto,categoria,monto_mensual,sucursal_id) VALUES ('QA renta',$1,12000,$2)",['Renta',cat.sucursal_id]);
    row=await current(); assert.ok(row,'gasto fijo nuevo: mueve el piso, debe reaparecer'); await keep(row.revision);
    await c.query("INSERT INTO gastos_fijos (concepto,categoria,monto_mensual,sucursal_id) VALUES ('QA luz',$1,1500,$2)",['Servicios',cat.sucursal_id]);
    row=await current(); assert.ok(row,'otro gasto fijo: debe reaparecer'); await keep(row.revision);
    await c.query("UPDATE gastos_fijos SET activo=false WHERE concepto='QA luz' AND sucursal_id=$1",[cat.sucursal_id]);
    row=await current(); assert.ok(row,'gasto en pausa: debe reaparecer'); await keep(row.revision);
    // Sacar un gasto del costo del producto también mueve el piso.
    const {rows:[cuentaRenta]} = await c.query("SELECT id FROM cuentas_contables WHERE sucursal_id=$1 AND clave='renta'",[cat.sucursal_id]);
    await c.query("UPDATE gastos_fijos SET cuenta_contable_id=$1 WHERE concepto='QA renta' AND sucursal_id=$2",[cuentaRenta.id,cat.sucursal_id]);
    await c.query('UPDATE cuentas_contables SET entra_al_costo=false WHERE id=$1',[cuentaRenta.id]);
    row=await current(); assert.ok(row,'la renta salió del costo: debe reaparecer'); await keep(row.revision);
    await c.query('UPDATE cuentas_contables SET entra_al_costo=true WHERE id=$1',[cuentaRenta.id]);
    row=await current(); assert.ok(row,'y al regresarla también'); await keep(row.revision);
    // Unidades estimadas: ya NO mueven el sugerido cuando hay ventas que medir.
    await setCfg({ unidades: 500 });
    assert.equal(await current(),undefined,'las unidades estimadas ya no fijan el reparto');
    const before=await cfgActual();
    await setCfg({ redondeo: Number(before.redondeo)===1 ? 5 : 1 });
    row=await current(); assert.ok(row,'redondeo cambió: debe reaparecer'); await keep(row.revision);
    await setCfg({}); // guardar sin cambios no reaviva
    assert.equal(await current(),undefined);
    // Márgenes: producto → categoría → sede. Cada uno manda sobre el siguiente.
    const margenSede = Number((await cfgActual()).porcentaje_ganancia_normal);
    const otro = (...evitar) => { let v = 40; while (evitar.includes(v)) v += 5; return v; };
    // Sin margen de categoría, manda el de la sede.
    await c.query('UPDATE categorias_producto SET margen_contribucion=NULL WHERE id=$1',[cat.id]);
    if (await current()) await keep((await current()).revision);
    await setCfg({ margen: otro(margenSede) });
    row=await current(); assert.ok(row,'margen general cambió: debe reaparecer'); await keep(row.revision);
    // El de la categoría manda sobre el de la sede.
    const margenCat = otro(otro(margenSede), margenSede);
    await c.query('UPDATE categorias_producto SET margen_contribucion=$2 WHERE id=$1',[cat.id, margenCat]);
    row=await current(); assert.ok(row,'margen de la categoría: debe reaparecer'); await keep(row.revision);
    await c.query('UPDATE categorias_producto SET margen_contribucion=NULL WHERE id=$1',[cat.id]);
    row=await current(); assert.ok(row,'quitarlo devuelve el de la sede: debe reaparecer'); await keep(row.revision);
    // El propio del producto manda sobre todo.
    await c.query('UPDATE productos SET margen_porcentaje=90 WHERE id=$1',[p.id]);
    row=await current(); assert.ok(row,'margen propio del producto: debe reaparecer'); await keep(row.revision);
    await c.query('UPDATE categorias_producto SET margen_contribucion=$2 WHERE id=$1',[cat.id, margenCat]);
    assert.equal(await current(),undefined,'con margen propio, el de la categoría ya no cambia nada');
    await c.query('UPDATE materias_primas SET stock_actual=3 WHERE id=$1',[m.id]);
    assert.equal(await current(),undefined);
    console.log('PASS: conserva precio, persiste, reaparece por receta/ingrediente/costo, por el margen que aplica (producto/categoría/sede), por el redondeo y por lo que mueve el piso (gastos fijos y qué entra al costo); ignora stock, unidades estimadas e insumos ajenos; rechaza revisiones obsoletas y otra sucursal.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
