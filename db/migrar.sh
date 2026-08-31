#!/usr/bin/env bash
# ============================================================================
# db/migrar.sh — aplica las migraciones PENDIENTES de db/ sobre una base que ya
# tiene datos (producción, o un desarrollo que no quieres borrar con `down -v`).
#
# Lleva registro en la tabla `schema_migraciones` para no repetir ninguna. La
# primera vez detecta lo que la base ya tiene (por ejemplo una instalación que
# nació con 00-10 por docker-entrypoint-initdb.d) y solo aplica lo que falta.
#
# Uso:
#   db/migrar.sh                          # contra el contenedor Docker cafeteria-db
#   DB_CONTAINER=otro db/migrar.sh        # otro nombre de contenedor
#   PSQL="psql postgres://user:pass@host:5432/cafeteria" db/migrar.sh   # base externa (RDS…)
#   db/migrar.sh --dry-run                # solo muestra qué aplicaría
#
# Lo llama el despliegue automático (.github/workflows/deploy.yml) ANTES de
# levantar la nueva API, para que código y base viajen juntos.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"
export PGOPTIONS="-c client_min_messages=warning"  # sin NOTICE ruidosos

DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
PSQL=${PSQL:-"docker exec -i ${DB_CONTAINER:-cafeteria-db} psql -U postgres -d cafeteria"}
q()   { $PSQL -X -At -v ON_ERROR_STOP=1 -c "$1"; }
runf() { $PSQL -X -q -v ON_ERROR_STOP=1 < "$1"; }

q "SELECT 1" >/dev/null || { echo "No pude conectarme a la base (¿está corriendo el contenedor ${DB_CONTAINER:-cafeteria-db}?)"; exit 1; }

# Tabla de registro. Si acaba de crearse, estamos en "línea base": lo que la
# base ya tenga se registra como aplicado sin volver a ejecutarlo.
existia=$(q "SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migraciones'" || true)
linea_base=0; [ -z "$existia" ] && linea_base=1
if [ "$DRY" = 0 ]; then
  q "CREATE TABLE IF NOT EXISTS schema_migraciones (archivo TEXT PRIMARY KEY, aplicado_en TIMESTAMPTZ NOT NULL DEFAULT now())" >/dev/null
fi
registrada() { [ -n "$existia" ] || [ "$DRY" = 0 ] || return 1; [ -n "$(q "SELECT 1 FROM schema_migraciones WHERE archivo = '$1'")" ]; }

# ¿La base ya contiene lo que deja cada migración? (solo se consulta en la línea base)
ya_tiene() {
  local n=$1
  case "$n" in
    00|01|02|03|04|05|06|07|08|09|10) echo 1 ;;  # toda base que corre hoy nació con estas
    # 11 solo redefine funciones/vistas (sin huella propia): 12 la requiere, así
    # que si ya hay sucursales, 11 ya pasó; si la base está en 10, se aplica.
    11|12) q "SELECT 1 FROM information_schema.tables WHERE table_name = 'sucursales'" ;;
    13) q "SELECT 1 FROM information_schema.columns WHERE table_name = 'productos' AND column_name = 'margen_porcentaje'" ;;
    14) q "SELECT 1 FROM information_schema.columns WHERE table_name = 'proveedores' AND column_name = 'categorias'" ;;
    15) q "SELECT 1 FROM information_schema.columns WHERE table_name = 'recetas' AND column_name = 'leche_ml_por_tamano'" ;;
    16) q "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'rol_usuario' AND e.enumlabel = 'mostrador'" ;;
    17) q "SELECT 1 FROM information_schema.columns WHERE table_name = 'productos' AND column_name = 'descripcion'" ;;
    *) echo "" ;;  # migraciones futuras: si no están registradas, se aplican
  esac
}

aplicadas=0; registradas=0
for f in [0-9][0-9]_*.sql; do
  n=${f:0:2}
  if registrada "$f"; then
    continue
  fi
  if [ "$linea_base" = 1 ] && [ -n "$(ya_tiene "$n")" ]; then
    [ "$DRY" = 1 ] && echo "= $f (ya estaba en la base; se registra)" || q "INSERT INTO schema_migraciones (archivo) VALUES ('$f')" >/dev/null
    registradas=$((registradas + 1))
    continue
  fi
  if [ "$DRY" = 1 ]; then echo "→ $f (pendiente)"; continue; fi
  echo "→ aplicando $f"
  runf "$f"
  q "INSERT INTO schema_migraciones (archivo) VALUES ('$f')" >/dev/null
  aplicadas=$((aplicadas + 1))
done

[ "$DRY" = 1 ] && exit 0
echo "Listo: $aplicadas migración(es) aplicada(s), $registradas registrada(s) como ya existentes."
if [ "$aplicadas" -gt 0 ]; then
  echo "Nota: si se aplicó 12_multisucursal, todas las sesiones del personal quedaron cerradas a propósito; cada quien vuelve a entrar eligiendo su sede."
fi
