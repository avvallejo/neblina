const {ApiError}=require('../utils/asyncHandler');
function moneyAmount(value,label='Monto') {
 if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>99999999.99)throw new ApiError(400,`${label}: indica un monto válido, mayor o igual a cero.`);
 return Math.round(Number(value)*100)/100;
}
function cashPart(method,total,value){
 if(method==='efectivo')return total;
 if(method!=='mixto')return 0;
 if(value===undefined||value===null)return null; // clientes antiguos: no inventar el desglose
 const cash=moneyAmount(value,'Parte en efectivo');if(cash>total)throw new ApiError(400,'La parte en efectivo supera el total.');return cash;
}
async function setOpeningFund(c,{id,sucursalId,usuarioId,monto}){
 const amount=moneyAmount(monto,'Fondo inicial');
 const {rows:[turno]}=await c.query('UPDATE turnos SET fondo_inicial=$3 WHERE id=$1 AND sucursal_id=$2 AND cerrado_en IS NULL AND fondo_inicial IS NULL RETURNING *',[id,sucursalId,amount]);
 if(!turno)throw new ApiError(409,'El turno ya tiene fondo inicial o ya se cerró. Actualiza Caja.');
 await c.query("INSERT INTO auditoria(entidad,entidad_id,accion,valor_nuevo,usuario_id,sucursal_id) VALUES('turnos',$1,'fondo_inicial',$2,$3,$4)",[id,{fondoInicial:amount},usuarioId,sucursalId]);return turno;
}
const drawerSql=`SELECT t.id,t.abierto_en,t.fondo_inicial,
 (SELECT COALESCE(sum(d.total),0) FROM pedidos d WHERE d.sucursal_id=t.sucursal_id AND d.cobrado AND NOT d.cancelado AND NOT d.no_show
 AND d.creado_en >= ((now() AT TIME ZONE 'America/Mexico_City')::date)::timestamp AT TIME ZONE 'America/Mexico_City'
 AND d.creado_en < (((now() AT TIME ZONE 'America/Mexico_City')::date)+1)::timestamp AT TIME ZONE 'America/Mexico_City') ventas_dia,
 COALESCE(SUM(p.total),0) ventas_turno,
 COALESCE(SUM(p.importe_efectivo),0) ventas_efectivo,
 COALESCE(SUM(p.total-p.importe_efectivo) FILTER(WHERE p.importe_efectivo IS NOT NULL),0) ventas_no_efectivo,
 COUNT(p.id) FILTER(WHERE p.importe_efectivo IS NULL) pagos_sin_desglose
 FROM turnos t LEFT JOIN pedidos p ON p.turno_cobro_id=t.id AND p.cobrado AND NOT p.cancelado AND NOT p.no_show
 WHERE t.sucursal_id=$1 AND t.cerrado_en IS NULL GROUP BY t.id`;
module.exports={moneyAmount,cashPart,setOpeningFund,drawerSql};
