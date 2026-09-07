// Configuración solicitada por el negocio. Sin --apply solo valida y revierte.
const { pool } = require('../src/db');
async function main() {
  const sede = process.argv[2];
  if (!sede) throw new Error('Indica el UUID de la sede');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const snapshot = async () => (await c.query(`SELECT jsonb_build_object(
      'cafes',(SELECT jsonb_agg(t) FROM opciones_cafe t WHERE sucursal_id=$1),
      'leches',(SELECT jsonb_agg(t) FROM opciones_leche t WHERE sucursal_id=$1),
      'extras',(SELECT jsonb_agg(t) FROM opciones_extra t WHERE sucursal_id=$1),
      'pantalla',(SELECT valor FROM configuracion WHERE sucursal_id=$1 AND clave='pantalla_estilo')) AS datos`, [sede])).rows[0].datos;
    const antes = await snapshot();
    const materia = async nombre => {
      const { rows } = await c.query('SELECT * FROM materias_primas WHERE sucursal_id=$1 AND nombre=$2 AND activo FOR UPDATE', [sede, nombre]);
      if (rows.length !== 1) throw new Error(`Insumo activo único requerido: ${nombre}`);
      return rows[0];
    };
    const gourmet = await materia('Cafe Gourmet');
    const leche = await materia('Leche Deslactosada MM');
    const chips = await materia('Chispas de Chocolate');
    if (chips.unidad !== 'g' || Number(chips.costo_unitario) > 5) throw new Error('Revisar costo de chispas por gramo antes de continuar');
    const { rows: bases } = await c.query("UPDATE opciones_cafe o SET etiqueta=m.nombre,precio_automatico=true FROM materias_primas m WHERE o.materia_prima_id=m.id AND o.sucursal_id=$1 AND o.codigo IN ('tradicional','especial') RETURNING o.codigo", [sede]);
    if (bases.length !== 2) throw new Error('Falta café tradicional o exportación vinculado');
    await c.query(`INSERT INTO opciones_cafe (sucursal_id,codigo,etiqueta,materia_prima_id,delta_precio,precio_automatico,activo)
      VALUES ($1,'gourmet',$2,$3,0,true,true) ON CONFLICT(sucursal_id,codigo) DO UPDATE
      SET etiqueta=EXCLUDED.etiqueta,materia_prima_id=EXCLUDED.materia_prima_id,precio_automatico=true,activo=true`, [sede,gourmet.nombre,gourmet.id]);
    const { rows:[cfg] } = await c.query('SELECT porcentaje_ganancia_normal,redondeo FROM configuracion_margen WHERE sucursal_id=$1 ORDER BY actualizado_en DESC LIMIT 1',[sede]);
    if (!cfg) throw new Error('Falta margen del negocio');
    const sugerido = costo => Math.sign(costo)*Math.ceil(Math.abs(costo)*(1+Number(cfg.porcentaje_ganancia_normal)/100)/Number(cfg.redondeo)-1e-9)*Number(cfg.redondeo);
    const { rows:[base] } = await c.query(`SELECT fn_convertir_unidad(280,'ml',m.unidad)*m.costo_unitario costo FROM opciones_leche o JOIN materias_primas m ON m.id=o.materia_prima_id WHERE o.sucursal_id=$1 AND o.codigo='entera'`,[sede]);
    if (!base) throw new Error('Falta leche entera');
    const { rows:[lc] } = await c.query("SELECT fn_convertir_unidad(280,'ml',$1)*$2 costo",[leche.unidad,leche.costo_unitario]);
    await c.query(`INSERT INTO opciones_leche (sucursal_id,codigo,etiqueta,materia_prima_id,delta_precio,activo)
      VALUES ($1,'deslactosada',$2,$3,$4,true) ON CONFLICT(sucursal_id,codigo) DO UPDATE SET
      etiqueta=EXCLUDED.etiqueta,materia_prima_id=EXCLUDED.materia_prima_id,delta_precio=EXCLUDED.delta_precio,activo=true`,[sede,leche.nombre,leche.id,sugerido(Number(lc.costo)-Number(base.costo))]);
    await c.query(`INSERT INTO opciones_extra (sucursal_id,codigo,etiqueta,materia_prima_id,delta_precio,cantidad,unidad,es_shot_adicional,activo)
      VALUES ($1,'chispas_chocolate','Chispas de chocolate',$2,$3,10,'g',false,true) ON CONFLICT(sucursal_id,codigo) DO UPDATE SET
      materia_prima_id=EXCLUDED.materia_prima_id,delta_precio=EXCLUDED.delta_precio,cantidad=10,unidad='g',activo=true`,[sede,chips.id,sugerido(10*Number(chips.costo_unitario))]);
    await c.query(`INSERT INTO configuracion (sucursal_id,clave,valor) VALUES ($1,'pantalla_estilo','"ilustrado"'::jsonb)
      ON CONFLICT(sucursal_id,clave) DO UPDATE SET valor=EXCLUDED.valor,actualizado_en=now()`,[sede]);
    const despues = await snapshot();
    await c.query(`INSERT INTO auditoria(entidad,entidad_id,accion,valor_anterior,valor_nuevo,motivo)
      VALUES ('opciones_menu',$1,'configurar',$2,$3,'Solicitud del negocio: café automático con margen, leche vinculada, chispas 10 g y menú ilustrado')`,[sede,antes,despues]);
    console.log(JSON.stringify({cafes:(await c.query('SELECT etiqueta,fn_recargo_cafe(id) precio FROM opciones_cafe WHERE sucursal_id=$1 AND activo',[sede])).rows,leche:sugerido(Number(lc.costo)-Number(base.costo)),chispas:sugerido(10*Number(chips.costo_unitario)),aplicado:process.argv.includes('--apply')},null,2));
    await c.query(process.argv.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
  } catch(e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); await pool.end(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
