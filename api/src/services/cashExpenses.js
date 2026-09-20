const {createHash}=require('node:crypto');
const {ApiError}=require('../utils/asyncHandler');
const {cleanText}=require('../utils/catalogValidation');
const A=require('./accounting');
const {registrarCompra}=require('./purchases');
const {parseNumber}=require('../utils/catalogValidation');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function proof(body){
 const referencia=cleanText(body.referencia,{field:'folio de comprobante',max:80})||null;
 const nota=cleanText(body.nota,{field:'nota o motivo sin comprobante',max:300})||null;
 if(!referencia&&!nota)throw new ApiError(400,'Indica el folio del comprobante o explica por qué no se tiene.');
 return {referencia,nota};
}
async function cashExpense(c,{sucursalId,usuarioId,body,purchaseId=null,materiaId=null}){
 if(!UUID.test(body.solicitudId||''))throw new ApiError(400,'Falta el identificador del registro. Actualiza Caja.');
 if(purchaseId&&!UUID.test(purchaseId))throw new ApiError(400,'Compra inválida.');
 if(materiaId&&!UUID.test(materiaId))throw new ApiError(400,'Selecciona un insumo válido.');
 if(materiaId&&purchaseId)throw new ApiError(400,'Elige una sola operación.');
 const comprobante=proof(body);
 const signature=createHash('sha256').update(JSON.stringify({purchaseId,...(materiaId?{materiaId,compra:{cantidadComprada:body.cantidadComprada,unidad:body.unidad,paquetes:body.paquetes,costoTotal:body.costoTotal,pagado:body.pagado,numeroLote:body.numeroLote,fechaCaducidad:body.fechaCaducidad}}:{}),concepto:body.concepto,monto:body.monto,cuentaContableId:body.cuentaContableId,proveedorId:body.proveedorId,...comprobante})).digest('hex');
 const q=c.query.bind(c);
 const key=`${sucursalId}:${usuarioId}:${body.solicitudId}`;
 await q('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
 const {rows:[old]}=await q("SELECT valor_nuevo FROM auditoria WHERE entidad='salidas_caja' AND entidad_id=$1 AND sucursal_id=$2 AND usuario_id=$3",[body.solicitudId,sucursalId,usuarioId]);
 if(old){
  if(old.valor_nuevo.signature!==signature)throw new ApiError(409,'Este registro ya se envió con otros datos. Abre un registro nuevo.');
  return A.obtenerEgreso(q,sucursalId,old.valor_nuevo.egresoId);
 }
 const {rows:[turno]}=await q('SELECT id FROM turnos WHERE sucursal_id=$1 AND cerrado_en IS NULL FOR UPDATE',[sucursalId]);
 if(!turno)throw new ApiError(409,'No hay un turno abierto en esta sucursal.');
 const hoy=A.hoyMx();await A.exigirMesAbierto(q,sucursalId,hoy);
 const caja=await A.cuentaDineroPorClave(q,sucursalId,'caja');
 await A.validarCuentaDinero(q,sucursalId,caja.id,{requerida:true});
 let egreso,anterior=null;
 if(materiaId){
  if(typeof body.pagado!=='boolean')throw new ApiError(400,'Indica si pagaste con efectivo o queda por pagar.');
  const costo=parseNumber(body.costoTotal,'costo total',{required:true,min:0});
  if(costo<=0)throw new ApiError(400,'El costo total debe ser mayor que cero.');
  const {rows:[m]}=await q('SELECT id FROM materias_primas WHERE id=$1 AND sucursal_id=$2 AND activo FOR UPDATE',[materiaId,sucursalId]);
  if(!m)throw new ApiError(404,'El insumo no existe en esta sucursal o está inactivo.');
  const lote=await registrarCompra(c,{materiaId,sucursalId,usuarioId,body:{
   cantidadComprada:body.cantidadComprada,unidad:body.unidad,paquetes:body.paquetes,
   costoTotal:costo,proveedorId:body.proveedorId||null,numeroLote:body.numeroLote,
   fechaCaducidad:body.fechaCaducidad||null,pagado:body.pagado,cuentaDineroId:body.pagado?caja.id:null,
  }});
  ({rows:[egreso]}=await q(`UPDATE egresos SET turno_id=$3,referencia=$4,nota=$5 WHERE lote_id=$1 AND sucursal_id=$2 RETURNING *`,[lote.id,sucursalId,turno.id,comprobante.referencia,comprobante.nota]));
  if(!egreso)throw new ApiError(500,'No se pudo registrar el egreso de la compra.');
 }else if(purchaseId){
  const {rows:[e]}=await q(`SELECT e.* FROM egresos e WHERE e.id=$1 AND e.sucursal_id=$2 FOR UPDATE`,[purchaseId,sucursalId]);
  if(!e||!e.lote_id||e.anulado)throw new ApiError(404,'No se encontró una compra de Inventario pendiente en esta sucursal.');
  if(e.pagado)throw new ApiError(409,'Esta compra ya está pagada. Actualiza la lista.');
  if(Number(body.monto)!==Number(e.monto))throw new ApiError(409,'El importe de la compra cambió. Actualiza la lista antes de pagar.');
  await A.exigirMesAbierto(q,sucursalId,e.fecha);
  anterior=e;
  ({rows:[egreso]}=await q(`UPDATE egresos SET pagado=true,pagado_en=$3,cuenta_dinero_id=$4,turno_id=$5,actualizado_en=now() WHERE id=$1 AND sucursal_id=$2 RETURNING *`,[e.id,sucursalId,hoy,caja.id,turno.id]));
 }else{
  const cuenta=body.cuentaContableId?await A.validarCuentaContable(q,sucursalId,body.cuentaContableId):await A.cuentaPorClave(q,sucursalId,'otros_gastos');
  if(!['gasto_operacion','costo_ventas'].includes(cuenta.grupo))throw new ApiError(400,'Para una compra de Inventario usa Pagar proveedor. Los gastos pequeños deben ser de operación o insumos consumidos.');
  egreso=await A.crearEgreso(c,{sucursalId,usuarioId,fecha:hoy,cuentaContable:cuenta,concepto:body.concepto,monto:body.monto,cuentaDineroId:caja.id,pagado:true,proveedorId:body.proveedorId||null,turnoId:turno.id,...comprobante});
 }
 await q(`INSERT INTO auditoria(entidad,entidad_id,accion,valor_anterior,valor_nuevo,motivo,usuario_id,sucursal_id) VALUES('egresos',$1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)`,[egreso.id,materiaId?(egreso.pagado?'pago_caja':'compra_caja'):purchaseId?'pago_caja':'gasto_caja',anterior?JSON.stringify(anterior):null,JSON.stringify({...egreso,comprobantePago:comprobante}),materiaId?'Compra de Inventario registrada por Caja':'Salida de efectivo registrada por Caja',usuarioId,sucursalId]);
 await q(`INSERT INTO auditoria(entidad,entidad_id,accion,valor_nuevo,usuario_id,sucursal_id) VALUES('salidas_caja',$1,'registrar',$2::jsonb,$3,$4)`,[body.solicitudId,JSON.stringify({egresoId:egreso.id,signature}),usuarioId,sucursalId]);
 return A.obtenerEgreso(q,sucursalId,egreso.id);
}
module.exports={cashExpense,proof};
