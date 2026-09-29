// Solo desarrollo. Las ventas, notas y cierres de prueba se revierten.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pool } = require('../src/db');
const { cashExpense } = require('../src/services/cashExpenses');
const { closingPreview, saveClosing } = require('../src/services/cashClosing');

(async()=>{
  assert.equal(process.env.NODE_ENV,'development');
  const c=await pool.connect(); const q=c.query.bind(c);
  try {
    await q('BEGIN');
    const {rows:[u]}=await q('SELECT id,nombre,sucursal_id FROM usuarios WHERE sucursal_id IS NOT NULL LIMIT 1');
    const s=u.sucursal_id,ctx={sucursalId:s,usuarioId:u.id,nombreUsuario:u.nombre};
    await q('DELETE FROM cierres_mes WHERE sucursal_id=$1',[s]);
    await q('UPDATE turnos SET cerrado_en=now() WHERE sucursal_id=$1 AND cerrado_en IS NULL',[s]);
    const {rows:[t]}=await q('INSERT INTO turnos(sucursal_id,abierto_por,fondo_inicial) VALUES($1,$2,500) RETURNING id',[s,u.id]);
    async function sale(total,method,cash=null) {
      return (await q(`INSERT INTO pedidos(origen,sucursal_id,subtotal,total,cobrado,metodo_pago,importe_efectivo)
        VALUES('mostrador',$1,$2,$2,true,$3,$4) RETURNING *`,[s,total,method,cash])).rows[0];
    }
    await sale(1000,'efectivo');await sale(300,'transferencia');await sale(200,'tarjeta');await sale(100,'mixto',40);
    const expenseBody={solicitudId:randomUUID(),concepto:'Nota sin número impreso',monto:80,tieneComprobante:true};
    const n=await cashExpense(c,{...ctx,body:expenseBody});
    assert.match(n.folio,/^N-\d+$/);assert.equal(n.tiene_comprobante,true);
    assert.equal((await cashExpense(c,{...ctx,body:expenseBody})).folio,n.folio);
    async function dbReject(fn,pattern){await q('SAVEPOINT rechazo');await assert.rejects(fn,pattern);await q('ROLLBACK TO SAVEPOINT rechazo');}
    await dbReject(()=>cashExpense(c,{...ctx,body:{...expenseBody,solicitudId:randomUUID(),referencia:n.folio}}),/ya está registrado/);
    const n2=await cashExpense(c,{...ctx,body:{...expenseBody,solicitudId:randomUUID(),monto:20,referencia:'  Remisión  123  '}});
    assert.notEqual(n.folio,n2.folio);
    await dbReject(()=>cashExpense(c,{...ctx,body:{...expenseBody,solicitudId:randomUUID(),referencia:'remisión 123'}}),/ya está registrado/);
    await dbReject(()=>q('UPDATE egresos SET folio=$2 WHERE id=$1',[n.id,'N-99999999']),/no se puede cambiar/);
    await assert.rejects(()=>closingPreview(q,randomUUID(),t.id),e=>e.status===404);
    let p=await closingPreview(q,s,t.id);
    assert.deepEqual(p.resumen,{fondo:500,ventas:1600,efectivo:1040,transferencias:300,tarjeta:200,mixtoBanco:60,sinDesglose:0,salidas:100,notasPendientesPago:0,esperado:1440});
    const body={solicitudId:randomUUID(),revision:p.revision,efectivoEntregado:940,fondoRetenido:500,transferenciasVerificadas:360,tarjetaVerificada:200,entrega:'Administradora',recibe:'Dueño',notasRevisadas:[n.id,n2.id]};
    await assert.rejects(()=>saveClosing(c,{...ctx,id:t.id,body:{...body,notasRevisadas:[randomUUID()]}}),e=>e.status===400);
    await assert.rejects(()=>saveClosing(c,{...ctx,id:t.id,body:{...body,efectivoEntregado:''}}),e=>e.status===400);
    await assert.rejects(()=>saveClosing(c,{...ctx,id:t.id,body:{...body,efectivoEntregado:900}}),e=>e.status===400);
    await assert.rejects(()=>saveClosing(c,{...ctx,id:t.id,body:{...body,notasRevisadas:[]}}),e=>e.status===400);
    await sale(10,'efectivo');
    await assert.rejects(()=>saveClosing(c,{...ctx,id:t.id,body}),e=>e.status===409);
    p=await closingPreview(q,s,t.id);body.revision=p.revision;body.efectivoEntregado=950;
    const saved=await saveClosing(c,{...ctx,id:t.id,body});
    assert.equal(saved.importes.diferenciaEfectivo,0);assert.equal(saved.importes.diferenciaBanco,0);
    assert.ok(saved.turno.cerrado_en);assert.equal(saved.notas.length,2);
    assert.equal((await saveClosing(c,{...ctx,id:t.id,body})).folio,saved.folio);
    await assert.rejects(()=>saveClosing(c,{...ctx,id:t.id,body:{...body,solicitudId:randomUUID()}}),e=>e.status===409);
    await assert.rejects(()=>cashExpense(c,{...ctx,body:{...expenseBody,solicitudId:randomUUID()}}),e=>e.status===409);
    await dbReject(()=>sale(5,'efectivo'),/Abre un turno/);
    // Una corrección posterior no reescribe el comprobante histórico del corte.
    await q('UPDATE egresos SET anulado=true WHERE id=$1',[n.id]);
    assert.equal((await closingPreview(q,s,t.id)).resumen.salidas,100);
    const {rows:[legacy]}=await q(`INSERT INTO turnos(sucursal_id,abierto_por,fondo_inicial) VALUES($1,$2,null) RETURNING id`,[s,u.id]);
    await sale(50,'mixto');
    const old=await closingPreview(q,s,legacy.id);assert.equal(old.resumen.esperado,null);assert.equal(old.resumen.sinDesglose,1);
    const pending=await saveClosing(c,{...ctx,id:legacy.id,body:{...body,solicitudId:randomUUID(),revision:old.revision,notasRevisadas:[],observaciones:'Sin fondo documentado ni desglose antiguo'}});
    assert.equal(pending.importes.diferenciaEfectivo,null);assert.equal(pending.importes.diferenciaBanco,null);
    console.log('PASS: corte efectivo/transferencia/tarjeta/mixto, fondo retenido, notas con folio, duplicados y reintentos, revisión y diferencias obligatorias, corte cambiado, aislamiento, cierre único, histórico congelado y datos antiguos por aclarar.');
  } finally {await q('ROLLBACK');c.release();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
