const { ApiError } = require('../utils/asyncHandler');

// Configuración actual que usaría este insumo al terminar una bebida.
const vinculadaAlItem = `
  EXISTS (SELECT 1 FROM opciones_cafe o WHERE o.id = pi.cafe_id AND o.materia_prima_id = $1)
  OR EXISTS (SELECT 1 FROM opciones_leche o WHERE o.id = pi.leche_id AND o.materia_prima_id = $1)
  OR EXISTS (SELECT 1 FROM pedido_item_extras e JOIN opciones_extra o ON o.id = e.extra_id
    WHERE e.pedido_item_id = pi.id AND o.materia_prima_id = $1)
  OR EXISTS (SELECT 1 FROM receta_insumos_fijos r WHERE r.producto_id = pi.producto_id AND r.materia_prima_id = $1)
  OR EXISTS (SELECT 1 FROM tamano_empaque e JOIN productos p ON p.id = pi.producto_id
    WHERE e.tamano_id = pi.tamano_id AND e.variante = CASE WHEN p.tipo = 'frappe' THEN 'frappe' WHEN p.es_frio THEN 'fria' ELSE 'caliente' END
    AND (e.materia_prima_vaso_id = $1 OR e.materia_prima_tapa_id = $1))`;

async function eliminarMateria(client, { id, sucursalId, usuarioId, desvincular = false }) {
  // Operación administrativa infrecuente. Serializar la comprobación y el borrado
  // evita que un pedido o receta aparezca entre ambos, incluso sin movimientos aún.
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query(`LOCK TABLE materias_primas, lotes, movimientos_inventario, mermas,
    opciones_cafe, opciones_leche, opciones_extra, tamano_empaque, receta_insumos_fijos,
    productos, pedido_items, pedido_item_extras IN SHARE ROW EXCLUSIVE MODE`);
  const { rows: materias } = await client.query(
    'SELECT * FROM materias_primas WHERE id = $1 AND sucursal_id = $2 FOR UPDATE', [id, sucursalId]);
  if (!materias.length) throw new ApiError(404, 'Materia prima no encontrada.');
  const materia = materias[0];
  const { rows: [historial] } = await client.query(`SELECT
    (SELECT COUNT(*) FROM lotes WHERE materia_prima_id = $1)::int AS lotes,
    (SELECT COUNT(*) FROM movimientos_inventario WHERE materia_prima_id = $1)::int AS movimientos,
    (SELECT COUNT(*) FROM mermas WHERE materia_prima_id = $1)::int AS mermas,
    (SELECT COUNT(*) FROM pedido_items pi WHERE ${vinculadaAlItem})::int AS pedidos`, [id]);
  if (Object.values(historial).some(n => n > 0)) {
    const motivo = Object.entries(historial).filter(([, n]) => n > 0).map(([nombre, n]) => `${n} ${nombre}`).join(', ');
    throw new ApiError(409, `No se puede borrar "${materia.nombre}": tiene ${motivo}. Puedes desactivarlo o editarlo para usarlo en tu inventario real.`,
      { codigo: 'INSUMO_CON_HISTORIAL', historial });
  }
  const { rows: opciones } = await client.query(`
    SELECT 'opciones_cafe' AS tabla, id, etiqueta FROM opciones_cafe WHERE materia_prima_id = $1
    UNION ALL SELECT 'opciones_leche', id, etiqueta FROM opciones_leche WHERE materia_prima_id = $1
    UNION ALL SELECT 'opciones_extra', id, etiqueta FROM opciones_extra WHERE materia_prima_id = $1`, [id]);
  const { rows: recetas } = await client.query('SELECT * FROM receta_insumos_fijos WHERE materia_prima_id = $1', [id]);
  const { rows: empaques } = await client.query(
    'SELECT * FROM tamano_empaque WHERE materia_prima_vaso_id = $1 OR materia_prima_tapa_id = $1', [id]);
  const { rows: productos } = await client.query(`SELECT id, nombre FROM productos p WHERE p.sucursal_id = $2 AND p.activo AND (
    EXISTS (SELECT 1 FROM receta_insumos_fijos r WHERE r.producto_id = p.id AND r.materia_prima_id = $1)
    OR (p.permite_tamanos AND EXISTS (SELECT 1 FROM tamano_empaque e
      WHERE e.variante = CASE WHEN p.tipo = 'frappe' THEN 'frappe' WHEN p.es_frio THEN 'fria' ELSE 'caliente' END
      AND (e.materia_prima_vaso_id = $1 OR e.materia_prima_tapa_id = $1))))`, [id, sucursalId]);
  if (!desvincular && (opciones.length || recetas.length || empaques.length)) {
    throw new ApiError(409, 'El insumo no tiene historial, pero está vinculado al menú.', {
      codigo: 'CONFIRMAR_DESVINCULACION', opciones: opciones.map(o => o.etiqueta),
      recetas: recetas.length, empaques: empaques.length, productos: productos.map(p => p.nombre),
    });
  }
  // Conservar las opciones para que puedan editarse y vincularse al inventario real.
  // Quedan inactivas para no venderlas sin su ingrediente.
  for (const tabla of ['opciones_cafe', 'opciones_leche', 'opciones_extra']) {
    await client.query(`UPDATE ${tabla} SET materia_prima_id = NULL, activo = false WHERE materia_prima_id = $1`, [id]);
  }
  if (productos.length) await client.query('UPDATE productos SET activo = false WHERE id = ANY($1::uuid[])', [productos.map(p => p.id)]);
  await client.query('DELETE FROM receta_insumos_fijos WHERE materia_prima_id = $1', [id]);
  await client.query('DELETE FROM tamano_empaque WHERE materia_prima_vaso_id = $1 OR materia_prima_tapa_id = $1', [id]);
  await client.query('DELETE FROM materias_primas WHERE id = $1 AND sucursal_id = $2', [id, sucursalId]);
  await client.query(`INSERT INTO auditoria (usuario_id, entidad, entidad_id, accion, valor_anterior, motivo, sucursal_id)
    VALUES ($1, 'materias_primas', $2, 'eliminar', $3::jsonb, 'Insumo sin historial; desvinculación confirmada si correspondía', $4)`,
    [usuarioId, id, JSON.stringify({ materia, opciones, recetas, empaques, productos_desactivados: productos }), sucursalId]);
  return { id, eliminado: true, modo_eliminacion: 'definitivo', productos_desactivados: productos.map(p => p.nombre) };
}

module.exports = { eliminarMateria };
