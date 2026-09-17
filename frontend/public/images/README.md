# Fotografías ilustrativas del menú

`bebidas-menu.png` fue creado con la herramienta integrada `image_gen.imagegen` para este menú. Son imágenes ilustrativas, no fotografías de los productos del negocio.

Prompt: crear un atlas cuadrado de fotografía gastronómica, cuadrícula uniforme 3 × 3 sin texto, sobre fondo café oscuro. Primera fila: espresso, americano, cortado. Segunda: capuchino, latte caliente, latte helado. Tercera: frappé café, frappé Oreo, frappé moka, sin crema batida. Iluminación cálida, vasos completos y centrados, separación uniforme para usar cada celda como imagen de menú.

Las celdas se muestran mediante posiciones CSS; los precios y nombres son texto vivo del catálogo.

## Menú por categoría (TV)

- `neblina-logo-original.png`: logo proporcionado por el negocio. Se usa sin modificar, con tratamiento CSS para integrar las montañas al fondo.
- `bebidas-transparentes.png`: versión con canal alfa generada con ImageGen a partir del atlas original de bebidas.
- `menu-complementos-transparentes.png`: atlas ilustrativo con fondo transparente generado con ImageGen. Incluye té, chocomilk, esquimo, frappé de fresa, horchata, jamaica, refresco, brownies, concha, galletas, muffin, oreja, tarta, hamburguesas, papas, quesaburger, torta y chocolate.

Las ventanas de cada producto se definen en `src/lib/menuImages.js`; los SVG de la vista recortan el atlas al mostrarlo para no incluir productos vecinos. Las ilustraciones no son fotografías de los productos reales ni cambian sus precios. Productos no reconocidos conservan su imagen cargada o su icono.
