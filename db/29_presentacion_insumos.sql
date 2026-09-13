-- ============================================================================
-- MIGRACIÓN 29 — PRESENTACIÓN DE COMPRA DE LOS INSUMOS
-- ============================================================================
-- Cómo llega el insumo del proveedor: "bolsa de 900 g", "caja de 12 l",
-- "paquete de 50 piezas". Con esto las compras (incluida la primera, al dar
-- de alta el insumo) se capturan como "N paquetes por $X" y el sistema
-- convierte a la unidad de control y calcula el costo unitario. El alta ya no
-- pide costo unitario a mano: lo deriva de la primera compra (API).
-- Requiere 00-28. Re-ejecutable.
-- ============================================================================
BEGIN;

ALTER TABLE materias_primas ADD COLUMN IF NOT EXISTS presentacion_cantidad NUMERIC(12,3) CHECK (presentacion_cantidad > 0);
ALTER TABLE materias_primas ADD COLUMN IF NOT EXISTS presentacion_unidad unidad_medida;
ALTER TABLE materias_primas ADD COLUMN IF NOT EXISTS presentacion_nombre TEXT CHECK (length(presentacion_nombre) BETWEEN 1 AND 30);
ALTER TABLE materias_primas DROP CONSTRAINT IF EXISTS materias_presentacion_coherente;
ALTER TABLE materias_primas ADD CONSTRAINT materias_presentacion_coherente CHECK (
  (presentacion_cantidad IS NULL AND presentacion_unidad IS NULL AND presentacion_nombre IS NULL)
  OR (presentacion_cantidad IS NOT NULL AND presentacion_unidad IS NOT NULL AND presentacion_nombre IS NOT NULL)
);
COMMENT ON COLUMN materias_primas.presentacion_cantidad IS 'Contenido de un paquete tal como se compra (en presentacion_unidad). NULL = sin presentación.';
COMMENT ON COLUMN materias_primas.presentacion_nombre IS 'Cómo se llama el paquete: bolsa, caja, paquete, garrafón…';

-- La compra de un lote puede venir en paquetes: se guarda cuántos fueron.
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS paquetes NUMERIC(12,3) CHECK (paquetes > 0);

COMMIT;
