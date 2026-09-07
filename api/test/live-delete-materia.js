// Ejecutado por verify-daily-and-cleanup.py SOLO en su base temporal.
const assert = require('node:assert/strict');
const { query, withTransaction, pool } = require('./src/db');
const { eliminarMateria } = require('./src/services/deleteMateria');
(async () => {
  assert.match(process.env.PGDATABASE, /^codex_check_/, 'Solo una base temporal de prueba');
  const sede = '11111111-1111-4111-8111-111111111111';
  const otra = '22222222-2222-4222-8222-222222222222';
  const { rows: [user] } = await query('SELECT id FROM usuarios LIMIT 1');
  const borrar = (id, desvincular = false, sucursalId = sede) => withTransaction(client => eliminarMateria(client, { id, desvincular, sucursalId, usuarioId: user.id }));
  const materia = async nombre => (await query(`INSERT INTO materias_primas (nombre,categoria_id,unidad,sucursal_id)
    SELECT $1,id,'g',sucursal_id FROM categorias_materia_prima WHERE sucursal_id=$2 RETURNING id`, [nombre,sede])).rows[0].id;
  const expectBlocked = (action, codigo) => assert.rejects(action, e => e.details?.codigo === codigo);
  const { rows: [withOption] } = await query("SELECT id FROM materias_primas WHERE nombre='Con receta'");
  await expectBlocked(() => borrar(withOption.id), 'CONFIRMAR_DESVINCULACION');
  assert.equal((await query('SELECT activo FROM materias_primas WHERE id=$1',[withOption.id])).rows[0].activo,true);
  await assert.rejects(() => borrar(withOption.id,true,otra), e => e.status === 404);
  await borrar(withOption.id,true);
  const { rows: [option] } = await query("SELECT activo,materia_prima_id FROM opciones_cafe WHERE codigo='prueba'");
  assert.equal(option.activo,false); assert.equal(option.materia_prima_id,null);
  const { rows: [used] } = await query("SELECT id,activo FROM materias_primas WHERE nombre='Con movimiento'");
  await expectBlocked(() => borrar(used.id,true),'INSUMO_CON_HISTORIAL');
  assert.equal((await query('SELECT activo FROM materias_primas WHERE id=$1',[used.id])).rows[0].activo,used.activo);
  await borrar(await materia('Libre API'));

  const { rows: [cat] } = await query("INSERT INTO categorias_producto (nombre,sucursal_id) VALUES ('Prueba API',$1) RETURNING id",[sede]);
  const producto = async (nombre,tipo='frappe') => (await query(`INSERT INTO productos (nombre,categoria_id,tipo,precio_base,sucursal_id)
    VALUES ($1,$2,$3,50,$4) RETURNING id`,[nombre,cat.id,tipo,sede])).rows[0].id;
  const productRecipe = await producto('Receta sin ventas','snack');
  const ingredient = await materia('Ingrediente sin ventas');
  await query("INSERT INTO receta_insumos_fijos (producto_id,materia_prima_id,cantidad,unidad) VALUES ($1,$2,1,'g')",[productRecipe,ingredient]);
  await expectBlocked(() => borrar(ingredient),'CONFIRMAR_DESVINCULACION');
  await borrar(ingredient,true);
  assert.equal((await query('SELECT activo FROM productos WHERE id=$1',[productRecipe])).rows[0].activo,false);
  assert.equal((await query('SELECT count(*) FROM receta_insumos_fijos WHERE producto_id=$1',[productRecipe])).rows[0].count,'0');

  const frappe = await producto('Frappé prueba');
  const cup = await materia('Vaso prueba'), lid = await materia('Tapa prueba');
  const { rows: [size] } = await query("INSERT INTO opciones_tamano (codigo,etiqueta,onzas,sucursal_id) VALUES ('16','16 oz',16,$1) RETURNING id",[sede]);
  await query("INSERT INTO tamano_empaque (tamano_id,variante,materia_prima_vaso_id,materia_prima_tapa_id) VALUES ($1,'frappe',$2,$3)",[size.id,cup,lid]);
  await expectBlocked(() => borrar(cup),'CONFIRMAR_DESVINCULACION');
  const result = await borrar(cup,true);
  assert.deepEqual(result.productos_desactivados,['Frappé prueba']);
  assert.equal((await query('SELECT activo FROM productos WHERE id=$1',[frappe])).rows[0].activo,false);
  assert.equal((await query('SELECT count(*) FROM materias_primas WHERE id=$1',[lid])).rows[0].count,'1');

  const pendingIngredient = await materia('Café pedido pendiente');
  const { rows: [coffee] } = await query("INSERT INTO opciones_cafe (codigo,etiqueta,materia_prima_id,sucursal_id) VALUES ('pendiente','Pendiente',$1,$2) RETURNING id",[pendingIngredient,sede]);
  const pendingProduct = await producto('Pedido pendiente');
  const { rows: [pedido] } = await query('SELECT id FROM pedidos WHERE sucursal_id=$1 LIMIT 1',[sede]);
  await query('INSERT INTO pedido_items (pedido_id,producto_id,cafe_id,precio_unitario) VALUES ($1,$2,$3,50)',[pedido.id,pendingProduct,coffee.id]);
  await expectBlocked(() => borrar(pendingIngredient,true),'INSUMO_CON_HISTORIAL');
  assert.equal((await query('SELECT materia_prima_id FROM opciones_cafe WHERE id=$1',[coffee.id])).rows[0].materia_prima_id,pendingIngredient);
  assert.equal((await query("SELECT count(*) FROM materias_primas WHERE sucursal_id=$1",[otra])).rows[0].count,'1');
  assert.equal((await query("SELECT count(*) FROM auditoria WHERE accion='eliminar' AND sucursal_id=$1",[sede])).rows[0].count,'4');
  console.log('PASS: API delete confirms configuration changes, protects history/pending orders, disables affected menu, preserves other branch, audits deletions');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
