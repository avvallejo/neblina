const { ApiError } = require('../utils/asyncHandler');

// El pedido y su línea ya están bloqueados por changeOrderItem.
// Se revierte el consumo real, con sus lotes originales. La cantidad que
// permanece usa la misma composición registrada, no una receta modificada.
async function correctCashItem(client, { item, cantidad, auth, motivo, devuelto }) {
  if (typeof motivo !== 'string' || motivo.trim().length < 3 || motivo.trim().length > 300) {
    throw new ApiError(400,'Escribe el motivo de la corrección (3 a 300 caracteres).');
  }
  if (cantidad < Number(item.cantidad) && devuelto !== true) {
    throw new ApiError(400,'Confirma que el producto no se entregó o fue devuelto sin consumir y puede venderse de nuevo.');
  }
  const { rows: consumos } = await client.query(`SELECT mi.materia_prima_id, mp.unidad, -SUM(mi.cantidad) AS cantidad
    FROM movimientos_inventario mi JOIN materias_primas mp ON mp.id=mi.materia_prima_id
    WHERE mi.pedido_item_id=$1 AND mi.tipo='consumo' AND mi.cantidad<0
      AND NOT EXISTS (SELECT 1 FROM movimientos_inventario r WHERE r.revierte_movimiento_id=mi.id)
    GROUP BY mi.materia_prima_id, mp.unidad ORDER BY mi.materia_prima_id`,[item.id]);
  await client.query('SELECT fn_revertir_consumo_item($1,$2,$3)',[item.id,auth.id,`Corrección en caja: ${motivo.trim()}`]);
  if (cantidad > 0) {
    for (const consumo of consumos) {
      await client.query('SELECT fn_consumir_insumo($1,$2,$3,$4,$5)',
        [consumo.materia_prima_id, Number(consumo.cantidad)*cantidad/Number(item.cantidad),consumo.unidad,auth.id,item.id]);
    }
    // Sigue terminado: no dispara nuevamente el consumo automático.
    await client.query('UPDATE pedido_items SET cantidad=$1, cantidad_entregada=LEAST(cantidad_entregada,$1) WHERE id=$2',[cantidad,item.id]);
  } else {
    // Conservar el historial y las referencias del kardex; excluir de total y ventas.
    await client.query("UPDATE pedido_items SET estado='cancelado', cantidad_entregada=0 WHERE id=$1",[item.id]);
  }
}
module.exports = { correctCashItem };
