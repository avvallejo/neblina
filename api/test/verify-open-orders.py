"""Prueba HTTP completa en una base desechable de Docker local. No toca producción."""
from pathlib import Path
import subprocess
import uuid

root = Path(__file__).resolve().parents[2]
database = 'codex_open_' + uuid.uuid4().hex[:12]
def run(args, data=None):
    r = subprocess.run(args, input=data, text=True, capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr + r.stdout)
    return r.stdout

def docker(*args, data=None):
    return run(['docker','exec','-i','cafeteria-db',*args], data)

def sql(source):
    return docker('psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1',data=source)

docker('createdb','-U','postgres',database)
try:
    sql(docker('pg_dump','-U','postgres','-d','cafeteria','--no-owner'))
    # La base local instalada puede ir por detrás del código actual.
    for file in sorted((root/'db').glob('[0-9][0-9]_*.sql')):
        if int(file.name[:2]) >= 29:
            sql(file.read_text())
    code = (root/'api/test/live-open-orders.js').read_text().replace("require('../src/", "require('./src/")
    print(run(['docker','exec','-i','-e',f'PGDATABASE={database}','-e','NODE_ENV=development',
               '-e','JWT_SECRET=open-orders-disposable-test-secret','cafeteria-api','node'],code))
finally:
    docker('dropdb','-U','postgres',database)
