-- ============================================================================
-- CAFETERÍA MÓVIL — 00: ROL DE APLICACIÓN Y PERMISOS
-- ============================================================================
-- Se corre UNA VEZ, antes de 01_schema.sql, conectado como superusuario.
-- La API nunca debe conectarse como "postgres" (superusuario) — eso es
-- exactamente el tipo de hueco de seguridad que se cierra aquí: si alguien
-- explota una inyección SQL o un bug, con este rol como mucho puede leer y
-- escribir datos, nunca borrar tablas, crear extensiones ni tocar otros roles.
--
-- Cambia 'CAMBIA_ESTA_CONTRASEÑA' por una contraseña real generada (ej. con
-- `openssl rand -base64 32`) antes de correr esto en cualquier ambiente real.
-- ============================================================================

CREATE ROLE cafeteria_app WITH LOGIN PASSWORD 'CAMBIA_ESTA_CONTRASEÑA';

GRANT CONNECT ON DATABASE cafeteria TO cafeteria_app;
GRANT USAGE ON SCHEMA public TO cafeteria_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cafeteria_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cafeteria_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO cafeteria_app;

-- Esto es lo que evita el error "permission denied for table X" la próxima
-- vez que se agregue una tabla en una migración futura: los permisos de
-- arriba solo cubren lo que YA existe al momento de correr este script; esta
-- parte hace que TODO lo que se cree después (vía CREATE TABLE / FUNCTION /
-- SEQUENCE, corriendo las migraciones como el mismo superusuario) también
-- quede otorgado a cafeteria_app automáticamente, sin tener que repetir el
-- GRANT manual cada vez (que es justo el bug que encontramos probando esto).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cafeteria_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO cafeteria_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO cafeteria_app;
