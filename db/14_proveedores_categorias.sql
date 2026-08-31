-- ============================================================================
-- MIGRACIÓN 14 — UN PROVEEDOR, VARIAS CATEGORÍAS DE INSUMOS
-- ============================================================================
-- Antes cada proveedor tenía UNA sola categoría ("Café" O "Jarabes"); en la
-- realidad el mismo proveedor suele surtir varias. La columna pasa a ser una
-- lista (`categorias TEXT[]`), con backfill de la categoría que ya tenía.
-- Requiere 00-13. Re-ejecutable.
-- ============================================================================

BEGIN;

ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS categorias TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: la categoría única existente se convierte en lista de uno.
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'proveedores' AND column_name = 'categoria'
  ) THEN
    UPDATE proveedores
    SET categorias = ARRAY[categoria]
    WHERE (categorias IS NULL OR categorias = '{}')
      AND categoria IS NOT NULL AND categoria <> '';
    ALTER TABLE proveedores DROP COLUMN categoria;
  END IF;
END $mig$;

-- Nunca vacía ni con más de 10 categorías.
ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS chk_proveedores_categorias;
ALTER TABLE proveedores ADD CONSTRAINT chk_proveedores_categorias
  CHECK (array_length(categorias, 1) BETWEEN 1 AND 10);

COMMENT ON COLUMN proveedores.categorias IS 'Categorías de insumos que surte este proveedor (una o varias): Café, Leche, Empaques, Jarabes...';

COMMIT;
