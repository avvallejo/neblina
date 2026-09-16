// Costeo por margen de contribución (migración 34). Todo dentro de una
// transacción que se revierte: no deja rastro en la base.
//   NODE_ENV=development node test/live-margen-contribucion.js
const assert = require('node:assert/strict');
const { pool } = require('../src/db');

const r2 = n => Math.round(Number(n) * 100) / 100;
const r4 = n => Math.round(Number(n) * 10000) / 10000;   // fn_costo_indirecto_producto redondea a 4 decimales

(async () => {
  assert.equal(process.env.NODE_ENV, 'development', 'solo contra una base de desarrollo');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const uno = async (sql, params) => (await c.query(sql, params)).rows[0];

    const { id: sede } = await uno("INSERT INTO sucursales (nombre, prefijo_folio) VALUES ('Costeo prueba','CT') RETURNING id");
    const { id: usuario } = await uno(
      "INSERT INTO usuarios (nombre, rol, pin_hash, sucursal_id) VALUES ('Admin costeo','admin','x',$1) RETURNING id", [sede]);

    // La sede nace con sus pesos por estación (trigger de la migración 34).
    const pesos = (await c.query('SELECT estacion, peso FROM pesos_estacion WHERE sucursal_id = $1 ORDER BY estacion', [sede])).rows;
    assert.deepEqual(pesos.map(p => `${p.estacion}:${Number(p.peso)}`), ['barra:1', 'caja:0.25', 'parrilla:1.5'],
      'una sede nueva nace con barra 1, refrigerador 0.25 y parrilla 1.5');

    // ---- 1. Qué gastos entran al costo ------------------------------------
    const cuenta = async clave => (await uno('SELECT id, entra_al_costo FROM cuentas_contables WHERE sucursal_id = $1 AND clave = $2', [sede, clave]));
    const renta = await cuenta('renta');
    const prestamo = await cuenta('prestamo');
    const sueldoDueno = await cuenta('sueldo_dueno');
    const sueldos = await cuenta('sueldos');
    assert.equal(renta.entra_al_costo, true, 'la renta es costo de operar');
    assert.equal(sueldos.entra_al_costo, true, 'los sueldos del personal son costo de operar');
    assert.equal(prestamo.entra_al_costo, false, 'el pago del préstamo es financiamiento, no costo del producto');
    assert.equal(sueldoDueno.entra_al_costo, false, 'el sueldo del dueño no infla el precio');

    const gasto = async (concepto, monto, cuentaId) => uno(
      'INSERT INTO gastos_fijos (concepto, categoria, monto_mensual, sucursal_id, cuenta_contable_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [concepto, 'Otro', monto, sede, cuentaId]);
    await gasto('Renta', 9000, renta.id);
    await gasto('Sueldos', 6000, sueldos.id);
    await gasto('Préstamo', 6000, prestamo.id);
    await gasto('Sueldo del dueño', 6000, sueldoDueno.id);

    const totales = Number((await uno('SELECT fn_gastos_fijos_totales_mes($1) AS v', [sede])).v);
    const costeables = Number((await uno('SELECT fn_gastos_fijos_costeables_mes($1) AS v', [sede])).v);
    assert.equal(totales, 27000, 'la contabilidad sigue viendo TODOS los gastos fijos');
    assert.equal(costeables, 15000, 'al costo del producto solo entran renta y sueldos');

    // ---- 2. Catálogo de prueba -------------------------------------------
    const { id: catBebidas } = await uno("INSERT INTO categorias_producto (nombre, orden, sucursal_id) VALUES ('Bebidas prueba', 1, $1) RETURNING id", [sede]);
    const { id: catFrios } = await uno("INSERT INTO categorias_producto (nombre, orden, sucursal_id) VALUES ('Fríos prueba', 2, $1) RETURNING id", [sede]);
    const { id: catParrilla } = await uno("INSERT INTO categorias_producto (nombre, orden, sucursal_id) VALUES ('Parrilla prueba', 3, $1) RETURNING id", [sede]);

    const { id: catInsumo } = await uno("INSERT INTO categorias_materia_prima (nombre, sucursal_id) VALUES ('Insumos prueba', $1) RETURNING id", [sede]);
    const insumo = async (nombre, costo) => uno(
      `INSERT INTO materias_primas (nombre, categoria_id, unidad, stock_actual, stock_minimo, costo_unitario, sucursal_id, requiere_lote)
       VALUES ($1,$2,'pieza',1000,1,$3,$4,false) RETURNING id`, [nombre, catInsumo, costo, sede]);
    const { id: iBebida } = await insumo('Insumo bebida', 10);
    const { id: iBotella } = await insumo('Insumo botella', 14);
    const { id: iCarne } = await insumo('Insumo carne', 40);

    // Los alimentos y snacks toman su costo de receta_insumos_fijos.
    const producto = async (nombre, categoria, estacion, tipo, precio, insumoId) => {
      const { id } = await uno(
        `INSERT INTO productos (nombre, categoria_id, tipo, icono, precio_base, sucursal_id, estacion, permite_tamanos, permite_leche, permite_tipo_cafe, permite_extras)
         VALUES ($1,$2,$3::tipo_producto,'Coffee',$4,$5,$6,false,false,false,false) RETURNING id`,
        [nombre, categoria, tipo, precio, sede, estacion]);
      await c.query('INSERT INTO receta_insumos_fijos (producto_id, materia_prima_id, cantidad, unidad) VALUES ($1,$2,1,$3)',
        [id, insumoId, 'pieza']);
      return id;
    };
    const latte = await producto('Latte prueba', catBebidas, 'barra', 'alimento', 40, iBebida);
    const jamaica = await producto('Jamaica prueba', catFrios, 'caja', 'snack', 25, iBotella);
    const burger = await producto('Burger prueba', catParrilla, 'parrilla', 'alimento', 95, iCarne);

    const costo = async id => Number((await uno('SELECT fn_costo_teorico_producto($1) AS v', [id])).v);
    assert.equal(await costo(latte), 10);
    assert.equal(await costo(jamaica), 14);
    assert.equal(await costo(burger), 40);

    // ---- 3. Reparto del indirecto: por estación, no en partes iguales -----
    // Sin historia de ventas todavía: volumen estimado, repartido con el peso
    // promedio del catálogo (1 + 0.25 + 1.5) / 3 = 0.9166…
    await c.query('INSERT INTO configuracion_margen (porcentaje_ganancia_normal, redondeo, unidades_estimadas_mes, sucursal_id) VALUES (60, 1, 1000, $1)', [sede]);
    const indirecto = async id => Number((await uno('SELECT fn_costo_indirecto_producto($1) AS v', [id])).v);
    const pesoPromedio = (1 + 0.25 + 1.5) / 3;
    assert.equal(await indirecto(latte), r4(15000 * 1 / (1000 * pesoPromedio)));
    assert.equal(await indirecto(jamaica), r4(15000 * 0.25 / (1000 * pesoPromedio)), 'la botella carga un cuarto desde el primer día');
    assert.equal(await indirecto(burger), r4(15000 * 1.5 / (1000 * pesoPromedio)));

    // Con ventas reales, cada estación carga según su peso.
    const { id: turno } = await uno('INSERT INTO turnos (abierto_por, sucursal_id) VALUES ($1,$2) RETURNING id', [usuario, sede]);
    const vender = async (productoId, cantidad, precio) => {
      const { id: pedido } = await uno(
        `INSERT INTO pedidos (origen, sucursal_id, total, subtotal, cobrado, metodo_pago, turno_id, cajero_id)
         VALUES ('mostrador',$1,$2,$2,true,'efectivo',$3,$4) RETURNING id`, [sede, cantidad * precio, turno, usuario]);
      await c.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, estado) VALUES ($1,$2,$3,$4,'terminado')`,
        [pedido, productoId, cantidad, precio]);
      return pedido;
    };
    await vender(latte, 4000, 40);     // 4000 × peso 1    = 4000
    await vender(jamaica, 4000, 25);   // 4000 × peso 0.25 = 1000
    await vender(burger, 2000, 95);    // 2000 × peso 1.5  = 3000
    // unidades ponderadas = 8000 → tasa = 15000 / 8000 = 1.875 por unidad-peso
    assert.equal(await indirecto(latte), 1.875);
    assert.equal(await indirecto(jamaica), r4(1.875 * 0.25), 'la botella solo carga un cuarto: sale del refrigerador');
    assert.equal(await indirecto(burger), r4(1.875 * 1.5), 'la parrilla carga vez y media');
    // Lo repartido cubre EXACTAMENTE los gastos costeables del mes.
    assert.equal(r2(4000 * 1.875 + 4000 * 0.46875 + 2000 * 2.8125), 15000);

    // Un pedido cancelado no cuenta en la mezcla.
    const pedidoCancelado = await vender(jamaica, 8000, 25);
    await c.query('UPDATE pedidos SET cancelado = true WHERE id = $1', [pedidoCancelado]);
    assert.equal(await indirecto(latte), 1.875, 'las ventas canceladas no mueven el reparto');

    // ---- 4. El precio sale del margen de contribución ---------------------
    const sugerido = async id => Number((await uno('SELECT fn_precio_sugerido($1) AS v', [id])).v);
    const margen = async id => Number((await uno('SELECT fn_margen_contribucion_producto($1) AS v', [id])).v);

    // Sin margen propio ni de categoría: el de la sede (60 %).
    assert.equal(await margen(latte), 60);
    assert.equal(await sugerido(latte), 25, '10 / (1 - 0.60) = 25');

    // El de la categoría manda sobre el de la sede.
    await c.query('UPDATE categorias_producto SET margen_contribucion = 75 WHERE id = $1', [catBebidas]);
    assert.equal(await margen(latte), 75);
    assert.equal(await sugerido(latte), 40, '10 / (1 - 0.75) = 40');

    // El del producto manda sobre el de la categoría.
    await c.query('UPDATE productos SET margen_porcentaje = 80 WHERE id = $1', [latte]);
    assert.equal(await margen(latte), 80);
    assert.equal(await sugerido(latte), 50, '10 / (1 - 0.80) = 50');
    await c.query('UPDATE productos SET margen_porcentaje = NULL WHERE id = $1', [latte]);

    // La botella ya NO carga lo mismo que la hamburguesa: ese era el problema.
    await c.query('UPDATE categorias_producto SET margen_contribucion = 44 WHERE id = $1', [catFrios]);
    await c.query('UPDATE categorias_producto SET margen_contribucion = 57 WHERE id = $1', [catParrilla]);
    assert.equal(await sugerido(jamaica), 25, '14 / (1 - 0.44) = 25, no los 60 que salían sumándole la renta');
    assert.equal(await sugerido(burger), 94, '40 / (1 - 0.57) = 93.02 → 94');

    // ---- 5. El piso: nunca por debajo de costo + su parte de fijos --------
    // Con un margen muy bajo, el piso manda.
    await c.query('UPDATE productos SET margen_porcentaje = 1 WHERE id = $1', [burger]);
    const piso = r2(40 + 1.875 * 1.5);
    assert.equal(await sugerido(burger), Math.ceil(piso), `el piso (${piso}) manda sobre 40 / 0.99 = 40.40`);
    const fila = await uno('SELECT piso_manda, margen_origen, margen_aplicado FROM vw_precios_por_revisar WHERE id = $1', [burger]);
    assert.equal(fila.piso_manda, true);
    assert.equal(fila.margen_origen, 'producto');
    await c.query('UPDATE productos SET margen_porcentaje = NULL WHERE id = $1', [burger]);
    assert.equal((await uno('SELECT margen_origen FROM vw_precios_por_revisar WHERE id = $1', [burger])).margen_origen, 'categoria');

    // ---- 6. Sacar un gasto del costo baja el piso, no el precio -----------
    const sugeridoAntes = await sugerido(burger);
    await c.query('UPDATE cuentas_contables SET entra_al_costo = false WHERE id = $1', [renta.id]);
    assert.equal(Number((await uno('SELECT fn_gastos_fijos_costeables_mes($1) AS v', [sede])).v), 6000);
    assert.equal(await indirecto(burger), r4(6000 / 8000 * 1.5), 'el piso baja porque la renta salió del costo');
    assert.equal(await sugerido(burger), sugeridoAntes, 'pero el precio no se mueve: lo fija el margen, no los fijos');
    await c.query('UPDATE cuentas_contables SET entra_al_costo = true WHERE id = $1', [renta.id]);

    // ---- 7. La huella de revisión no depende de la mezcla de ventas -------
    const huella = async id => (await uno('SELECT fn_revision_precio($1) AS v', [id])).v;
    const huellaAntes = await huella(latte);
    await vender(burger, 500, 95);   // cambia la mezcla real
    assert.notEqual(await indirecto(latte), 1.875, 'la mezcla real cambió el reparto');
    assert.equal(await huella(latte), huellaAntes, 'vender NO debe revivir "precios por revisar"');
    // Cambiar el margen de la categoría SÍ debe revivirlo.
    await c.query('UPDATE categorias_producto SET margen_contribucion = 70 WHERE id = $1', [catBebidas]);
    assert.notEqual(await huella(latte), huellaAntes, 'cambiar el margen sí cambia la huella');

    // ---- 8. Punto de equilibrio del mes ----------------------------------
    const pe = await uno('SELECT * FROM vw_punto_equilibrio_negocio WHERE sucursal_id = $1', [sede]);
    assert.equal(Number(pe.gastos_fijos_mes), 27000, 'el equilibrio se calcula contra TODOS los fijos');
    assert.equal(Number(pe.gastos_fijos_costeables_mes), 15000);
    const ventaEsperada = 4000 * 40 + 4000 * 25 + 2500 * 95;
    const contribucionEsperada = ventaEsperada - (4000 * 10 + 4000 * 14 + 2500 * 40);
    assert.equal(Number(pe.venta_30_dias), ventaEsperada);
    assert.equal(Number(pe.contribucion_30_dias), contribucionEsperada);
    assert.equal(Number(pe.utilidad_estimada_mes), contribucionEsperada - 27000);
    assert.equal(Number(pe.venta_equilibrio_mes), r2(27000 * ventaEsperada / contribucionEsperada));

    console.log('PASS: préstamo y sueldo del dueño fuera del costo, reparto por estación con la mezcla real que suma exactamente los fijos, precio por margen de contribución (producto → categoría → sede), piso que nunca se cruza, huella estable ante las ventas y punto de equilibrio del mes.');
  } finally {
    await c.query('ROLLBACK');
    c.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
