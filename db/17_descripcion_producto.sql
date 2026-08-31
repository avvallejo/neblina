-- ============================================================================
-- MIGRACIÓN 17 — DESCRIPCIÓN CORTA DEL PRODUCTO (PARA LA PANTALLA DEL NEGOCIO)
-- ============================================================================
-- El menú de la TV en estilo "pizarra" muestra una frase bajo cada bebida
-- ("Espresso con leche espumada y capa de espuma cremosa"). Es opcional.
-- Requiere 00-16. Re-ejecutable.
-- ============================================================================

BEGIN;

ALTER TABLE productos ADD COLUMN IF NOT EXISTS descripcion TEXT;
ALTER TABLE productos DROP CONSTRAINT IF EXISTS chk_productos_descripcion_len;
ALTER TABLE productos ADD CONSTRAINT chk_productos_descripcion_len CHECK (descripcion IS NULL OR char_length(descripcion) <= 140);
COMMENT ON COLUMN productos.descripcion IS 'Frase corta (máx. 140) que se muestra bajo el nombre en la pantalla del negocio y en la app del cliente.';

COMMIT;
