// Docker local; todos los cambios se revierten.
const assert=require('node:assert/strict');
const {pool}=require('./src/db');
const {moneyAmount,cashPart,setOpeningFund,drawerSql}=require('./src/services/cashDrawer');
(async()=>{assert.equal(process.env.NODE_ENV,'development');const c=await pool.connect();try{
 await c.query('BEGIN');
 const {rows:[u]}=await c.query('SELECT id,sucursal_id FROM usuarios WHERE sucursal_id IS NOT NULL LIMIT 1');const s=u.sucursal_id;
 await c.query('UPDATE turnos SET cerrado_en=now() WHERE sucursal_id=$1 AND cerrado_en IS NULL',[s]);
 const {rows:[old]}=await c.query("INSERT INTO turnos(abierto_por,sucursal_id,abierto_en,cerrado_en) VALUES($1,$2,now()-interval '3 days',now()-interval '1 day') RETURNING id",[u.id,s]);
 const {rows:[t]}=await c.query('INSERT INTO turnos(abierto_por,sucursal_id) VALUES($1,$2) RETURNING id',[u.id,s]);
 const info=async()=> (await c.query(drawerSql,[s])).rows[0];
 assert.equal((await info()).fondo_inicial,null);
 await setOpeningFund(c,{id:t.id,sucursalId:s,usuarioId:u.id,monto:500});
 assert.equal(Number((await info()).ventas_turno),0);
 await assert.rejects(()=>setOpeningFund(c,{id:t.id,sucursalId:s,usuarioId:u.id,monto:100}),e=>e.status===409);
 const sale=async(total,method,cash,manual=false)=>{return (await c.query(`INSERT INTO pedidos(origen,sucursal_id,total,subtotal,cobrado,metodo_pago,importe_efectivo,registro_manual,creado_en)
 VALUES('mostrador',$1,$2,$2,true,$3,$4,$5,CASE WHEN $5 THEN now()-interval '2 days' ELSE now() END) RETURNING *`,[s,total,method,cash,manual])).rows[0];};
 await sale(100,'efectivo',null);await sale(80,'tarjeta',null);await sale(120,'mixto',30);const past=await sale(200,'efectivo',null,true);assert.equal(past.turno_cobro_id,old.id);
 let r=await info();assert.equal(Number(r.ventas_turno),300);assert.equal(Number(r.ventas_efectivo),130);assert.equal(Number(r.ventas_no_efectivo),170);assert.equal(Number(r.fondo_inicial)+Number(r.ventas_efectivo),630);
 const {rows:[pending]}=await c.query("INSERT INTO pedidos(origen,sucursal_id,total,turno_id) VALUES('app',$1,25,$2) RETURNING id",[s,old.id]);
 await c.query("UPDATE pedidos SET cobrado=true,metodo_pago='efectivo' WHERE id=$1",[pending.id]);
 assert.equal(Number((await info()).ventas_efectivo),155);
 await sale(50,'mixto',null);assert.equal(Number((await info()).pagos_sin_desglose),1);
 assert.equal(cashPart('mixto',100,25),25);assert.equal(cashPart('tarjeta',100,100),0);assert.throws(()=>cashPart('mixto',100,101));
 for(const value of ['',null,-1,NaN,true])assert.throws(()=>moneyAmount(value));assert.equal(moneyAmount(0),0);
 await assert.rejects(()=>setOpeningFund(c,{id:t.id,sucursalId:'00000000-0000-4000-8000-000000000000',usuarioId:u.id,monto:10}),e=>e.status===409);
 console.log('PASS: fondo separado de ventas, efectivo y mixtos, tarjeta fuera de caja, ventas atrasadas en turno original, cobros actuales en turno actual, fondo único, validación y aislamiento de sede.');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}})().catch(e=>{console.error(e);process.exitCode=1});
