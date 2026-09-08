const {ApiError}=require('../utils/asyncHandler');
const TABLES={tamanos:'opciones_tamano',cafes:'opciones_cafe',leches:'opciones_leche',extras:'opciones_extra'};
async function changeOption(client,{tipo,id,sucursalId,activo,retirar=false,usuarioId}) {
 const tabla=TABLES[tipo];
 if(!tabla)throw new ApiError(404,'Tipo de opción desconocido.');
 if(!Number.isInteger(Number(id)))throw new ApiError(400,'Identificador inválido.');
 if(typeof activo!=='boolean')throw new ApiError(400,'Estado inválido.');
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`opciones:${sucursalId}`]);
 const {rows:[actual]}=await client.query(`SELECT * FROM ${tabla} WHERE id=$1 AND sucursal_id=$2 FOR UPDATE`,[id,sucursalId]);
 if(!actual)throw new ApiError(404,'Opción no encontrada.');
 if(actual.retirado){if(retirar)return actual;throw new ApiError(409,'La opción ya fue eliminada de la lista.');}
 if(!activo&&((tipo==='cafes'&&actual.codigo==='tradicional')||(tipo==='leches'&&actual.codigo==='entera')))throw new ApiError(400,'Esta opción es la base de las recetas y debe conservarse.');
 if(tipo==='tamanos'&&!activo&&actual.activo){
  const {rows:[check]}=await client.query(`SELECT EXISTS(SELECT 1 FROM productos WHERE sucursal_id=$1 AND activo AND permite_tamanos) necesita,
   (SELECT count(*) FROM opciones_tamano WHERE sucursal_id=$1 AND activo AND NOT retirado AND id<>$2) disponibles`,[sucursalId,id]);
  if(check.necesita&&Number(check.disponibles)===0)throw new ApiError(400,'Conserva al menos un tamaño activo para las bebidas que permiten elegir tamaño.');
 }
 const {rows:[nuevo]}=await client.query(`UPDATE ${tabla} SET activo=$3,retirado=$4 WHERE id=$1 AND sucursal_id=$2 RETURNING *`,[id,sucursalId,activo,retirar]);
 await client.query(`INSERT INTO auditoria(entidad,entidad_id,accion,valor_anterior,valor_nuevo,usuario_id,sucursal_id)
 VALUES($1,$2,$3,$4,$5,$6,$7)`,[tabla,String(id),retirar?'retirar':activo?'activar':'desactivar',actual,nuevo,usuarioId,sucursalId]);
 return nuevo;
}
module.exports={changeOption};
