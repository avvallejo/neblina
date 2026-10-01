const { createHash } = require('node:crypto');
const { ApiError } = require('../utils/asyncHandler');
const { estacionesDe } = require('./stations');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dimension = u => ['kg','g'].includes(u) ? 'peso' : ['l','ml'].includes(u) ? 'volumen' : u;

async function alternativas(query, sucursalId, id) {
  const { rows: [base] } = await query('SELECT id,nombre,unidad FROM materias_primas WHERE id=$1 AND sucursal_id=$2',[id,sucursalId]);
  if (!base) throw new ApiError(404,'Insumo no encontrado.');
  const { rows } = await query(`SELECT m.id,m.nombre,m.unidad,m.activo,
    EXISTS(SELECT 1 FROM insumo_alternativas a WHERE a.materia_prima_id=$1 AND a.alternativa_id=m.id) AS autorizada
    FROM materias_primas m WHERE m.sucursal_id=$2 AND m.id<>$1 ORDER BY m.nombre`,[id,sucursalId]);
  return { base, alternativas:rows.filter(m => dimension(m.unidad)===dimension(base.unidad)) };
}
async function guardarAlternativas(client,{sucursalId,usuarioId,id,ids}) {
  if (!Array.isArray(ids) || ids.length>30 || ids.some(x=>!UUID.test(x)) || new Set(ids).size!==ids.length) throw new ApiError(400,'Selecciona alternativas válidas.');
  await client.query('SELECT id FROM materias_primas WHERE id=$1 AND sucursal_id=$2 FOR UPDATE',[id,sucursalId]);
  const config = await alternativas(client.query.bind(client),sucursalId,id);
  if (ids.some(id=>!config.alternativas.some(m=>m.id===id && m.activo))) throw new ApiError(400,'Usa insumos activos de la misma sucursal y con unidades compatibles.');
  const anteriores=config.alternativas.filter(m=>m.autorizada).map(m=>m.id);
  await client.query('DELETE FROM insumo_alternativas WHERE materia_prima_id=$1',[id]);
  for (const alt of ids) await client.query('INSERT INTO insumo_alternativas(materia_prima_id,alternativa_id) VALUES($1,$2)',[id,alt]);
  await client.query(`INSERT INTO auditoria(entidad,entidad_id,accion,usuario_id,sucursal_id,valor_anterior,valor_nuevo,motivo)
    VALUES('materias_primas',$1,'alternativas',$2,$3,$4,$5,'Alternativas de preparación autorizadas por administrador')`,[id,usuarioId,sucursalId,JSON.stringify(anteriores),JSON.stringify(ids)]);
  return alternativas(client.query.bind(client),sucursalId,id);
}
async function item(query,{id,sucursalId,auth},lock=false) {
  if (!UUID.test(id)) throw new ApiError(400,'Producto de comanda inválido.');
  // Mismo orden de bloqueo que separación/cancelación: pedido, luego línea.
  if(lock) await query(`SELECT p.id FROM pedidos p JOIN pedido_items pi ON pi.pedido_id=p.id
    WHERE pi.id=$1 AND p.sucursal_id=$2 FOR UPDATE OF p`,[id,sucursalId]);
  const {rows:[line]}=await query(`SELECT pi.*,p.sucursal_id,p.cancelado,p.no_show,pr.nombre AS producto
    FROM pedido_items pi JOIN pedidos p ON p.id=pi.pedido_id LEFT JOIN productos pr ON pr.id=pi.producto_id
    WHERE pi.id=$1 AND p.sucursal_id=$2 ${lock?'FOR UPDATE OF pi':''}`,[id,sucursalId]);
  if(!line) throw new ApiError(404,'Producto de comanda no encontrado.');
  const stations=await estacionesDe(query,auth);
  if(!stations.includes(line.estacion_preparacion)) throw new ApiError(403,'Este producto pertenece a otra estación.');
  return line;
}
async function plan(query,line) {
  const {rows:insumos}=await query(`SELECT b.materia_prima_id AS origen_id,m.nombre AS origen,m.unidad AS unidad_origen,
    b.cantidad AS cantidad_origen,COALESCE(s.alternativa_id,m.id) AS elegido_id,
    d.nombre AS elegido,d.unidad,ROUND(fn_convertir_unidad(b.cantidad,m.unidad,d.unidad),3) AS cantidad,
    d.stock_actual,
    COALESCE((SELECT json_agg(json_build_object('id',alt.id,'nombre',alt.nombre,'unidad',alt.unidad,'stock',alt.stock_actual))
      FROM insumo_alternativas a JOIN materias_primas alt ON alt.id=a.alternativa_id
      WHERE a.materia_prima_id=m.id AND alt.sucursal_id=$2 AND alt.activo),'[]') AS alternativas
    FROM fn_insumos_receta_base($1) b JOIN materias_primas m ON m.id=b.materia_prima_id
    LEFT JOIN pedido_item_sustituciones s ON s.pedido_item_id=$1 AND s.materia_prima_id=m.id
    JOIN materias_primas d ON d.id=COALESCE(s.alternativa_id,m.id) ORDER BY m.nombre,m.id`,[line.id,line.sucursal_id]);
  const {rows:[alerts]}=await query('SELECT fn_alertas_insumos_item($1) AS alertas',[line.id]);
  // Stock no participa: un consumo de otra comanda no invalida esta elección.
  const huella=createHash('sha256').update(JSON.stringify([line.cantidad,line.estado,insumos.map(({stock_actual,alternativas,...m})=>({...m,alternativas:alternativas.map(a=>a.id).sort()}))])).digest('hex');
  return {id:line.id,producto:line.producto,unidades:line.cantidad,estado:line.estado,insumos,alertas:alerts.alertas,huella};
}
async function consultar(query,args) {
  const line=await item(query,args);
  if(line.estado==='terminado' || line.estado==='cancelado') {
    const {rows:insumos}=await query(`SELECT mi.materia_prima_id AS elegido_id,m.nombre AS elegido,m.unidad,
      SUM(-mi.cantidad) AS cantidad,MIN(mi.creado_en) AS consumido_en
      FROM movimientos_inventario mi JOIN materias_primas m ON m.id=mi.materia_prima_id
      WHERE mi.pedido_item_id=$1 AND mi.tipo='consumo' GROUP BY mi.materia_prima_id,m.nombre,m.unidad ORDER BY m.nombre`,[line.id]);
    return {id:line.id,producto:line.producto,unidades:line.cantidad,estado:line.estado,insumos,alertas:[],registrado:true};
  }
  return plan(query,line);
}
async function guardar(client,args) {
  const {body}=args;
  if(!Array.isArray(body.insumos) || body.insumos.length>100 || typeof body.huella!=='string') throw new ApiError(400,'Abre los insumos de la comanda antes de guardar.');
  const line=await item(client.query.bind(client),args,true);
  if(!['pendiente','en_preparacion'].includes(line.estado) || line.cancelado || line.no_show) throw new ApiError(409,'La preparación ya terminó o el pedido fue cancelado.');
  const current=await plan(client.query.bind(client),line);
  if(current.huella!==body.huella) throw new ApiError(409,'Cambió la receta o la selección. Cierra y vuelve a abrir los insumos.');
  if(body.insumos.length!==current.insumos.length || new Set(body.insumos.map(m=>m.origenId)).size!==current.insumos.length) throw new ApiError(400,'Conserva todos los ingredientes de la receta.');
  for(const choice of body.insumos) {
    const b=current.insumos.find(m=>m.origen_id===choice.origenId);
    if(!b || (choice.elegidoId!==b.origen_id && !b.alternativas.some(a=>a.id===choice.elegidoId))) throw new ApiError(400,'Solo puedes elegir alternativas autorizadas por el administrador.');
  }
  await client.query('DELETE FROM pedido_item_sustituciones WHERE pedido_item_id=$1',[line.id]);
  for(const choice of body.insumos.filter(m=>m.origenId!==m.elegidoId)) await client.query(`INSERT INTO pedido_item_sustituciones(pedido_item_id,materia_prima_id,alternativa_id,usuario_id)
    VALUES($1,$2,$3,$4)`,[line.id,choice.origenId,choice.elegidoId,args.auth.id]);
  await client.query(`INSERT INTO auditoria(entidad,entidad_id,accion,usuario_id,sucursal_id,valor_anterior,valor_nuevo,motivo)
    VALUES('pedido_items',$1,'elegir_insumos',$2,$3,$4,$5,'Insumos seleccionados antes de terminar la preparación')`,
    [line.id,args.auth.id,args.sucursalId,JSON.stringify(current.insumos.map(m=>({origenId:m.origen_id,elegidoId:m.elegido_id}))),JSON.stringify(body.insumos)]);
  return plan(client.query.bind(client),line);
}
module.exports={alternativas,guardarAlternativas,consultar,guardar};
