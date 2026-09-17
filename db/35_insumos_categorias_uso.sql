BEGIN;
CREATE TABLE IF NOT EXISTS materia_categorias_uso (
  materia_prima_id UUID NOT NULL REFERENCES materias_primas(id) ON DELETE CASCADE,
  categoria_id INTEGER NOT NULL REFERENCES categorias_producto(id) ON DELETE CASCADE,
  PRIMARY KEY (materia_prima_id, categoria_id)
);
-- Clasificar únicamente lo que ya sabemos por las recetas existentes.
INSERT INTO materia_categorias_uso (materia_prima_id, categoria_id)
SELECT DISTINCT r.materia_prima_id, p.categoria_id
FROM receta_insumos_fijos r JOIN productos p ON p.id=r.producto_id
JOIN materias_primas m ON m.id=r.materia_prima_id
WHERE p.sucursal_id=m.sucursal_id
ON CONFLICT DO NOTHING;
COMMIT;
