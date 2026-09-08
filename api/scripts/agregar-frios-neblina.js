// Alta solicitada: precio fijo, sin café ni cantidades de receta inventadas.
// Sin --apply valida en una transacción y revierte.
const { pool } = require('../src/db');
async function main() {
  const sede = process.argv[2];
  if (!sede) throw new Error('Indica la sucursal');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`alta-frios:${sede}`]);
    const {rows:cats}=await c.query("SELECT id FROM categorias_producto WHERE sucursal_id=$1 AND nombre='Fríos'",[sede]);
    if(cats.length!==1) throw new Error('Se requiere una categoría Fríos única');
    const result=[];
    for(const [nombre,icono] of [['Chocomilk','🍫'],['Esquimo de fresa','🍓']]) {
      const {rows:existing}=await c.query('SELECT id FROM productos WHERE sucursal_id=$1 AND lower(nombre)=lower($2)',[sede,nombre]);
      if(existing.length) {result.push({nombre,existente:true});continue;}
      const {rows:[p]}=await c.query(`INSERT INTO productos
        (nombre,categoria_id,tipo,icono,precio_base,permite_tamanos,permite_leche,permite_tipo_cafe,permite_extras,es_frio,sucursal_id,descripcion)
        VALUES ($1,$2,'bebida',$3,50,false,false,false,false,true,$4,'Bebida fría sin café') RETURNING *`,[nombre,cats[0].id,icono,sede]);
      await c.query(`INSERT INTO recetas(producto_id,pasos,gramaje_por_shot,es_personalizada,temperatura_servicio)
        VALUES($1,'["Pendiente de configurar ingredientes, cantidades y preparación. Bebida sin café."]',NULL,true,'Fría')`,[p.id]);
      await c.query('UPDATE productos SET revision_precio_aceptada=fn_revision_precio(id) WHERE id=$1',[p.id]);
      await c.query(`INSERT INTO auditoria(entidad,entidad_id,accion,valor_nuevo,motivo,sucursal_id)
        VALUES('productos',$1,'crear',$2::jsonb,'Alta solicitada a $50 en Fríos, sin café. Receta pendiente de cantidades; por ahora solo precio.',$3)`,[p.id,JSON.stringify(p),sede]);
      result.push({id:p.id,nombre,precio:50,sinCafe:true,recetaPendiente:true});
    }
    await c.query(process.argv.includes('--apply')?'COMMIT':'ROLLBACK');
    console.log(JSON.stringify({aplicado:process.argv.includes('--apply'),productos:result}));
  }catch(e){await c.query('ROLLBACK');throw e;}
  finally{c.release();await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
