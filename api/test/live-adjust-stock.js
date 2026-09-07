// Solo Docker local; todos los datos de prueba se revierten al terminar.
const assert = require('node:assert/strict');
const { pool } = require('./src/db');
const { ajustarStock } = require('./src/services/adjustStock');

(async () => {
  assert.equal(process.env.NODE_ENV, 'development', 'Ejecutar solo en desarrollo');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [cat] } = await client.query('SELECT id, sucursal_id FROM categorias_materia_prima LIMIT 1');
    const { rows: [user] } = await client.query('SELECT id FROM usuarios LIMIT 1');
    const create = async (unidad = 'kg', lote = true, caducidad = false) => (await client.query(
      `INSERT INTO materias_primas (nombre,categoria_id,sucursal_id,unidad,requiere_lote,requiere_caducidad,costo_unitario)
       VALUES ('QA ajuste rollback',$1,$2,$3,$4,$5,320) RETURNING id`, [cat.id,cat.sucursal_id,unidad,lote,caducidad])).rows[0].id;
    const adjust = (id, nuevaCantidad, extra = {}) => ajustarStock(client, {
      id, sucursalId: cat.sucursal_id, usuarioId: user.id, nuevaCantidad, motivo: 'Corrección de alta', ...extra,
    });
    const check = async (id, total) => {
      const { rows: [m] } = await client.query(`SELECT stock_actual, costo_unitario,
        (SELECT COALESCE(SUM(fn_convertir_unidad(cantidad_disponible,unidad,m.unidad)),0) FROM lotes WHERE materia_prima_id=m.id) AS saldo
        FROM materias_primas m WHERE id=$1`, [id]);
      assert.equal(Number(m.stock_actual),total);
      assert.equal(Number(m.saldo),total);
      assert.equal(Number(m.costo_unitario),320);
    };
    const reject = async (action, status) => {
      await client.query('SAVEPOINT rechazo');
      await assert.rejects(action, e => e.status === status);
      await client.query('ROLLBACK TO SAVEPOINT rechazo');
    };
    const id = await create();
    await adjust(id, 2, {stockEsperado: 0});
    await check(id, 2);
    await adjust(id, 1.2, {stockEsperado: 2});
    await check(id, 1.2);
    await adjust(id, 3);
    await check(id, 3);
    await client.query("SELECT fn_consumir_insumo($1,250,'g',$2)", [id,user.id]);
    await check(id, 2.75);
    await reject(() => adjust(id, 1, {stockEsperado: 3}), 409);
    await reject(() => adjust(id, 1, {sucursalId:'00000000-0000-4000-8000-000000000000'}), 404);
    await reject(() => adjust(id, 1, {motivo: ''}), 400);
    for (const value of ['', -1, NaN, 0.0001, 1000000000]) await reject(() => adjust(id, value), 400);
    await check(id, 2.75);
    await adjust(id, 0);
    await check(id, 0);
    const {rows: [mov]} = await client.query(`SELECT SUM(cantidad) AS saldo, count(*) AS n,
      bool_and(lote_id IS NOT NULL AND (tipo <> 'ajuste' OR motivo='Corrección de alta')) AS trazable
      FROM movimientos_inventario WHERE materia_prima_id=$1`,[id]);
    assert.equal(Number(mov.saldo),0); assert.equal(mov.trazable,true);
    await adjust(id, 0);
    assert.equal((await client.query('SELECT count(*) AS n FROM movimientos_inventario WHERE materia_prima_id=$1',[id])).rows[0].n,mov.n);
    assert.equal(Number((await client.query('SELECT sum(costo_total) AS costo FROM lotes WHERE materia_prima_id=$1',[id])).rows[0].costo),0);

    const mixed = await create();
    await client.query(`INSERT INTO lotes (materia_prima_id,cantidad_comprada,cantidad_disponible,unidad,costo_total,usuario_id,fecha_compra)
      VALUES ($1,1000,1000,'g',320,$2,'2026-01-01'),($1,2,2,'kg',640,$2,'2026-02-01')`,[mixed,user.id]);
    await client.query('UPDATE materias_primas SET stock_actual=3 WHERE id=$1',[mixed]);
    await adjust(mixed,1.5);
    await check(mixed,1.5);
    const {rows: balances} = await client.query('SELECT cantidad_disponible,cantidad_comprada,costo_total FROM lotes WHERE materia_prima_id=$1 ORDER BY fecha_compra',[mixed]);
    assert.deepEqual(balances.map(l=>Number(l.cantidad_disponible)),[0,1.5]);
    assert.deepEqual(balances.map(l=>Number(l.cantidad_comprada)),[1000,2]);
    assert.deepEqual(balances.map(l=>Number(l.costo_total)),[320,640]);
    await adjust(mixed,0);
    await check(mixed,0);

    const precision = await create('g');
    await client.query(`INSERT INTO lotes (materia_prima_id,cantidad_comprada,cantidad_disponible,unidad,costo_total,usuario_id,fecha_compra)
      VALUES ($1,100,100,'g',32,$2,'2026-01-01'),($1,1,1,'kg',320,$2,'2026-02-01')`,[precision,user.id]);
    await client.query('UPDATE materias_primas SET stock_actual=1100 WHERE id=$1',[precision]);
    await reject(() => adjust(precision,999.5),400);
    await check(precision,1100);
    assert.equal((await client.query('SELECT count(*) FROM movimientos_inventario WHERE materia_prima_id=$1',[precision])).rows[0].count,'0');

    const expiring = await create('kg',true,true);
    await reject(() => adjust(expiring,1),400);
    await reject(() => adjust(expiring,1,{fechaCaducidad:'2026-02-30'}),400);
    await adjust(expiring,1,{fechaCaducidad:'2027-01-01'});
    await check(expiring,1);

    const plain = await create('pieza',false);
    await adjust(plain,5,{motivo:undefined});
    assert.equal(Number((await client.query('SELECT stock_actual FROM materias_primas WHERE id=$1',[plain])).rows[0].stock_actual),5);
    console.log('PASS: aumentos, reducciones, cero, PEPS, unidades mixtas, consumo posterior, costos, historial, caducidad, concurrencia obsoleta y aislamiento de sucursal.');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
