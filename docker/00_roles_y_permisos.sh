#!/bin/bash
# Se ejecuta automáticamente la PRIMERA vez que el contenedor de Postgres crea
# su volumen de datos (mecanismo estándar de la imagen oficial: todo lo que
# esté en /docker-entrypoint-initdb.d se corre en orden alfabético — por eso
# este archivo se llama 00_, antes que 01_schema.sql, 02_..., etc.).
#
# Crea el rol de la API (cafeteria_app) SIN privilegios de superusuario, con
# la contraseña que venga de la variable de entorno CAFETERIA_APP_PASSWORD
# (definida en .env, nunca quemada en este archivo).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE cafeteria_app WITH LOGIN PASSWORD '$CAFETERIA_APP_PASSWORD';
  GRANT CONNECT ON DATABASE $POSTGRES_DB TO cafeteria_app;
  GRANT USAGE ON SCHEMA public TO cafeteria_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cafeteria_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cafeteria_app;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO cafeteria_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cafeteria_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO cafeteria_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO cafeteria_app;
EOSQL

echo "Rol cafeteria_app creado correctamente."
