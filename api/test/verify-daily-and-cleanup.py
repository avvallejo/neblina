"""Integration check on a disposable database in LOCAL Docker (schema copied, no data).
Run from repository root: python3 api/test/verify-daily-and-cleanup.py
"""
import json
from pathlib import Path
import subprocess
import uuid

root = Path(__file__).resolve().parents[2]
database = 'codex_check_' + uuid.uuid4().hex[:12]

def docker(*args, data=None):
    result = subprocess.run(['docker', 'exec', '-i', 'cafeteria-db', *args],
                            input=data, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout

def sql(source, *variables):
    return docker('psql', '-X', '-qAt', '-U', 'postgres', '-d', database,
                  '-v', 'ON_ERROR_STOP=1', *variables, data=source).strip()

sede = '11111111-1111-4111-8111-111111111111'
otra = '22222222-2222-4222-8222-222222222222'
docker('createdb', '-U', 'postgres', database)
try:
    schema = docker('pg_dump', '-U', 'postgres', '-d', 'cafeteria', '--schema-only', '--no-owner', '--no-privileges')
    sql(schema)
    sql(f"""
    INSERT INTO sucursales (id,nombre,prefijo_folio) VALUES ('{sede}','Prueba','QA1'), ('{otra}','Otra','QA2');
    INSERT INTO usuarios (nombre,rol,pin_hash) VALUES ('Prueba','admin','unused');
    INSERT INTO turnos (abierto_por, abierto_en, cerrado_en, sucursal_id)
      SELECT id, '2026-09-06 08:00-06', '2026-09-06 12:00-06', '{sede}' FROM usuarios;
    INSERT INTO turnos (abierto_por, abierto_en, sucursal_id)
      SELECT id, '2026-09-06 12:01-06', '{sede}' FROM usuarios;
    INSERT INTO pedidos (sucursal_id,turno_id,creado_en,total,cobrado)
      SELECT '{sede}',id,'2026-09-06 09:00-06',100,true FROM turnos WHERE cerrado_en IS NOT NULL;
    INSERT INTO pedidos (sucursal_id,creado_en,total,cobrado,cancelado,no_show) VALUES
      ('{sede}','2026-09-06 23:59:59-06',50,true,false,false),
      ('{sede}','2026-09-06 00:00:00-06',25,true,false,false),
      ('{sede}','2026-09-07 00:00:00-06',90,true,false,false),
      ('{sede}','2026-09-05 23:59:59-06',80,true,false,false),
      ('{sede}','2026-09-06 14:00-06',999,false,false,false),
      ('{sede}','2026-09-06 14:00-06',999,true,true,false),
      ('{sede}','2026-09-06 14:00-06',999,true,false,true),
      ('{otra}','2026-09-06 14:00-06',999,true,false,false);
    INSERT INTO categorias_materia_prima (nombre,sucursal_id) VALUES ('Prueba','{sede}'),('Otra','{otra}');
    INSERT INTO materias_primas (nombre,categoria_id,unidad,stock_actual,sucursal_id)
      SELECT n, c.id,'g',10,c.sucursal_id FROM categorias_materia_prima c
      CROSS JOIN (VALUES ('Libre'),('Con movimiento'),('Con receta')) names(n) WHERE c.sucursal_id='{sede}';
    INSERT INTO materias_primas (nombre,categoria_id,unidad,sucursal_id)
      SELECT 'Otra sede',id,'g',sucursal_id FROM categorias_materia_prima WHERE sucursal_id='{otra}';
    INSERT INTO movimientos_inventario (materia_prima_id,tipo,cantidad)
      SELECT id,'ajuste',1 FROM materias_primas WHERE nombre='Con movimiento';
    INSERT INTO opciones_cafe (codigo,etiqueta,materia_prima_id,sucursal_id)
      SELECT 'prueba','Prueba',id,sucursal_id FROM materias_primas WHERE nombre='Con receta';
    """)
    query = subprocess.run(['node','-e',"process.stdout.write(require('./api/src/services/dailySales').dailySalesSql)"],
                           cwd=root, text=True, capture_output=True, check=True).stdout
    def report(date, branch=sede):
        prepared = query.replace('$1', f"'{branch}'::uuid").replace('$2', f"'{date}'")
        return json.loads(sql(f'SELECT row_to_json(r) FROM ({prepared}) r;'))
    assert float(report('2026-09-06')['ventas']) == 175
    assert float(report('2026-09-07')['ventas']) == 90
    assert float(report('2026-09-08')['ventas']) == 0
    assert float(report('2026-09-06', otra)['ventas']) == 999
    sql('UPDATE turnos SET cerrado_en = now() WHERE cerrado_en IS NULL;')
    assert float(report('2026-09-06')['ventas']) == 175, 'Closing shift must not change sales'
    cleanup = (root / 'db/maintenance/limpiar_insumos_sin_uso.sql').read_text()
    sql(cleanup, '-v', f'sucursal_id={sede}')
    assert sql('SELECT count(*) FROM materias_primas') == '4', 'Preview must not delete'
    sql(cleanup, '-v', f'sucursal_id={sede}', '-v', 'aplicar=true')
    assert sql('SELECT nombre FROM materias_primas ORDER BY nombre').splitlines() == ['Con movimiento','Con receta','Otra sede']
    assert sql('SELECT count(*) FROM pedidos') == '9', 'Preserve sales'
    sql(cleanup, '-v', f'sucursal_id={sede}', '-v', 'aplicar=true')
    assert sql('SELECT count(*) FROM materias_primas') == '3', 'Cleanup is repeatable'
    sql('GRANT ALL ON ALL TABLES IN SCHEMA public TO cafeteria_app; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO cafeteria_app;')
    test_code = (root / 'api/test/live-delete-materia.js').read_text()
    result = subprocess.run(['docker','exec','-i','-e',f'PGDATABASE={database}','cafeteria-api','node'],
                            input=test_code,text=True,capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    print(result.stdout.strip())
    print('PASS: calendar boundaries, two shifts, open/closed, unpaid/cancelled/no-show, branch isolation, preview, cleanup and history preservation')
finally:
    docker('dropdb', '-U', 'postgres', database)
