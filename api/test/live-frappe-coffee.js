// Docker local: migra y simula ventas dentro de una transacción revertida.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pool } = require('./src/db');
const { calcularPrecioItem } = require('./src/utils/pricing');
(async () => {
  assert.equal(process.env.NODE_ENV,'development');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const {rows:[cat]} = await c.query('SELECT id,sucursal_id FROM categorias_producto LIMIT 1');
    const {rows: coffees} = await c.query("SELECT * FROM opciones_cafe WHERE sucursal_id=$1 AND activo AND materia_prima_id IS NOT NULL ORDER BY codigo",[cat.sucursal_id]);
    assert.ok(coffees.length >= 2);
    const {rows:[p]} = await c.query(`INSERT INTO productos (nombre,categoria_id,sucursal_id,tipo,precio_base,permite_tipo_cafe,permite_tamanos,permite_leche,permite_extras)
      VALUES ('QA frappé', $1,$2,'frappe',50,false,false,false,false) RETURNING id`,[cat.id,cat.sucursal_id]);
    await c.query("INSERT INTO recetas (producto_id,pasos) VALUES ($1,'[\"Licuar\"]') ON CONFLICT (producto_id) DO NOTHING",[p.id]);
    await c.query("INSERT INTO receta_insumos_fijos (producto_id,materia_prima_id,cantidad,unidad) VALUES ($1,$2,14,'g')",[p.id,coffees[0].materia_prima_id]);
    const migration = fs.readFileSync('/workspace/db/18_cafe_frappes_seleccionable.sql','utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    await c.query(migration);
    assert.equal((await c.query('SELECT permite_tipo_cafe FROM productos WHERE id=$1',[p.id])).rows[0].permite_tipo_cafe,true);
    assert.equal(Number((await c.query('SELECT gramaje_por_shot FROM recetas WHERE producto_id=$1',[p.id])).rows[0].gramaje_por_shot),18);
    assert.equal((await c.query('SELECT count(*) FROM receta_insumos_fijos WHERE producto_id=$1',[p.id])).rows[0].count,'0');
    assert.equal((await c.query("SELECT count(*) FROM auditoria WHERE entidad='recetas' AND entidad_id=$1",[p.id])).rows[0].count,'1');
    const prices = [];
    for (const coffee of coffees.slice(0,2)) {
      prices.push(await calcularPrecioItem({productoId:p.id,cafeId:coffee.id,sucursalId:cat.sucursal_id},c.query.bind(c)));
      const {rows:[pedido]} = await c.query('INSERT INTO pedidos (sucursal_id) VALUES ($1) RETURNING id',[cat.sucursal_id]);
      const {rows:[item]} = await c.query('INSERT INTO pedido_items (pedido_id,producto_id,cafe_id,precio_unitario) VALUES ($1,$2,$3,50) RETURNING id',[pedido.id,p.id,coffee.id]);
      await c.query("UPDATE pedido_items SET estado='terminado' WHERE id=$1",[item.id]);
      const {rows: movements} = await c.query(`SELECT mi.materia_prima_id,SUM(fn_convertir_unidad(-mi.cantidad,m.unidad,'g')) AS gramos
        FROM movimientos_inventario mi JOIN materias_primas m ON m.id=mi.materia_prima_id
        WHERE mi.pedido_item_id=$1 GROUP BY mi.materia_prima_id`,[item.id]);
      assert.equal(movements.length,1);
      assert.equal(movements[0].materia_prima_id,coffee.materia_prima_id);
      assert.equal(Number(movements[0].gramos),18);
    }
    assert.equal(prices[1]-prices[0],Number(coffees[1].delta_precio)-Number(coffees[0].delta_precio));
    console.log('PASS: receta corregida a 18 g, elección al vender, recargo por tipo, descuento único del café elegido y auditoría.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
