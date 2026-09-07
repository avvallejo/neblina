# Revisión de ventas y limpieza de insumos

El cierre de turno no es requisito para ver ventas cobradas. El resumen anterior
usaba el último turno aunque decía «Ventas hoy». Además, un fallo al cargar
catálogos o fidelidad impedía llegar a la consulta de ventas. El panel actualizado
consulta el resumen por separado cada cinco segundos, muestra errores y permite
elegir una fecha. Suma todos los turnos de la sucursal seleccionada.

El día se calcula en `America/Mexico_City` según `pedidos.creado_en` porque el
esquema no guarda una fecha de cobro. Un pedido registrado ayer y cobrado hoy
se refleja en ayer. Se excluyen del importe pedidos sin cobrar, cancelados y
no recogidos. Los reportes por método de pago existentes son históricos
acumulados; el selector de fecha corresponde al resumen principal.

Para publicar este cambio, desplegar API y frontend juntos mediante el flujo
habitual. No necesita una migración. Estas correcciones no prueban por sí solas
por qué faltaron ventas concretas en producción: hay que revisar allí sucursal,
fecha, estado de cobro y posibles errores de la API.

## Limpieza manual, separada del despliegue

`limpiar_insumos_sin_uso.sql` elimina únicamente materias primas SIN referencias
en lotes, movimientos, mermas, opciones de café/leche/extras, empaques o recetas.
No elimina ni modifica ventas, recetas, productos, proveedores o categorías.
Conserva insumos vinculados, aunque estén inactivos o nunca se hayan vendido.
Los vínculos de recetas deben revisarse desde el catálogo antes de eliminarlos;
no se desconectan automáticamente porque cambiaría la operación del menú.

La limpieza incluye insumos activos e inactivos e incluso stock inicial mayor
que cero si no tiene referencias: revisar la columna `stock_actual` antes de
aplicar. No identifica datos de prueba por nombre. Hacer respaldo antes de
aplicar en producción y guardar la salida como registro de lo eliminado.

Desde la raíz del repositorio, en el servidor de la base correspondiente:

```sh
# Identificar la sucursal; consulta de solo lectura.
docker exec cafeteria-db psql -U postgres -d cafeteria -c 'SELECT id, nombre FROM sucursales ORDER BY nombre'

# Vista previa: reemplazar UUID_DE_LA_SUCURSAL con el id anterior.
docker exec -i cafeteria-db psql -X -U postgres -d cafeteria \
  -v sucursal_id=UUID_DE_LA_SUCURSAL \
  < db/maintenance/limpiar_insumos_sin_uso.sql

# Aplicar únicamente después de revisar la lista ELIMINABLE.
docker exec -i cafeteria-db psql -X -U postgres -d cafeteria \
  -v sucursal_id=UUID_DE_LA_SUCURSAL -v aplicar=true \
  < db/maintenance/limpiar_insumos_sin_uso.sql
```

Por defecto ejecuta ROLLBACK. Al aplicar, toda la eliminación es transaccional;
si aparece una referencia nueva no contemplada, la clave foránea bloquea el
borrado y se revierte. No usar TRUNCATE ni CASCADE. El script bloquea brevemente
los insumos de esa sucursal para evitar referencias concurrentes y aborta si
no puede obtener el bloqueo en cinco segundos. Conviene hacerlo sin operación.
No se ejecuta automáticamente al desplegar o iniciar el sistema.

## Verificación local

```sh
npm --prefix api test
npm --prefix frontend run build
python3 api/test/verify-daily-and-cleanup.py
```

La última prueba usa Docker local y crea una base temporal con solo el esquema
de `cafeteria`, introduce datos ficticios y la elimina al terminar. Verifica
límites de medianoche, múltiples turnos, turno abierto/cerrado, estados de cobro,
aislación de sucursales, vista previa, borrado repetible y conservación de historial.
