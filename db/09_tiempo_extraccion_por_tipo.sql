-- ============================================================================
-- CAFETERÍA MÓVIL — TIEMPO DE EXTRACCIÓN POR TIPO DE CAFÉ
-- ============================================================================
-- La receta ya guardaba molienda y ajuste de molino por tipo (tradicional vs
-- origen especial). Faltaba el TIEMPO (segundos) por tipo: el café de origen
-- suele calibrarse con un tiempo distinto. Se agrega tiempo_extraccion_especial
-- para que el barista vea, según el café elegido, cómo calibrar su máquina.
-- ============================================================================

ALTER TABLE recetas ADD COLUMN IF NOT EXISTS tiempo_extraccion_especial TEXT;

-- Para las recetas existentes, arranca el tiempo del especial igual al tradicional.
UPDATE recetas SET tiempo_extraccion_especial = tiempo_extraccion
WHERE tiempo_extraccion_especial IS NULL;
