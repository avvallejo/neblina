# Base de datos — Cafetería Móvil

Esquema de PostgreSQL (14+) que corresponde 1:1 con el prototipo funcional ya
construido (Cliente, Caja, Barista, Admin), **más la API REST que ya lo
conecta** (carpeta `../api`). **Todo lo que hay aquí se probó de verdad**
contra un PostgreSQL real y, después, contra la API corriendo en vivo — no es
SQL que "se ve bien", es SQL que se ejecutó con datos reales, simulando el
flujo completo de un pedido de principio a fin, a través de peticiones HTTP
reales.

## Archivos, en el orden en que se ejecutan

0. **`00_roles_y_permisos.sql`** — Crea el rol `cafeteria_app` (la API nunca
   se conecta como superusuario) y los privilegios por defecto para que las
   migraciones futuras no se queden sin permiso sobre tablas nuevas.
1. **`01_schema.sql`** — Tablas, tipos, índices y restricciones. 27 tablas.
2. **`02_functions_triggers.sql`** — La lógica de negocio real: descuento
   automático de inventario (con PEPS), mermas, fidelidad, turnos.
3. **`03_seed_data.sql`** — Datos exclusivamente de desarrollo. Incluye catálogo,
   proveedores y usuarios con PIN conocidos; producción no ejecuta este archivo.
4. **`04_views.sql`** — Vistas para los reportes que ya viste en Admin (stock
   bajo, ventas por método de pago, productos más vendidos, mermas, KPIs).
5. **`05_mejoras_produccion.sql`** — Cierra huecos que quedaron a propósito
   del prototipo: costo real por lote, columnas de sincronización offline,
   precio efectivo con promoción de apertura, precio sugerido por margen.
6. **`06_costos_indirectos.sql`** — Gastos fijos/indirectos (renta, sueldos,
   gasolina, servicios) y el **punto de equilibrio real** del negocio y por
   producto — ver más abajo.
7. **`07_verificacion_y_sync.sql`** — Verificación de teléfono por código
   (OTP) antes de dejar pedir a un cliente nuevo, y la bitácora de
   sincronización offline (`lotes_sincronizacion`) para poder investigar
   "¿por qué este dispositivo no sincronizó bien ayer?" en vez de adivinar.
8. **`08_configuracion.sql`** — Configuración del negocio; la verificación SMS
   arranca activada.
9. **`09_tiempo_extraccion_por_tipo.sql`** — Tiempos de extracción por tipo.
10. **`10_security_hardening.sql`** — Revocación de sesiones y autorizaciones
    de descuento de un solo uso.
11. **`11_catalogos_y_unidades.sql`** — Eliminación segura de catálogos desde
    la API y corrección de conversiones g/kg, ml/l respetando la unidad real
    de cada lote.
12. **`12_multisucursal.sql`** — **Multi-sucursal**: tabla `sucursales`,
    `sucursal_id` en todas las tablas operativas y de catálogo (con backfill
    de todo lo existente a la sede "Principal"), un turno abierto POR sede,
    folios con prefijo por sede (`S1-P-105`, `S2-P-1`…), unicidades por sede
    (teléfono de cliente, códigos de opciones), triggers de blindaje que
    impiden mezclar datos de dos sedes, y funciones de costos parametrizadas
    por sucursal. `usuarios.sucursal_id = NULL` define al **administrador
    general** (todas las sedes). ⚠️ Debe desplegarse JUNTO con la versión
    multi-sucursal de la API: cambia contratos que la API anterior asume.
13. **`13_flujo_costos_menu.sql`** — Flujo inventario → receta → costo →
    precio: margen de ganancia POR PRODUCTO (`productos.margen_porcentaje`,
    NULL = usa el de la sucursal), `fn_precio_sugerido` que lo respeta, y
    `vw_precios_por_revisar` — los productos cuyo precio de menú ya no
    corresponde a su costo + margen (el precio nunca cambia solo; el panel
    avisa y el admin lo aplica con un clic).
14. **`14_proveedores_categorias.sql`** — Un proveedor puede surtir VARIAS
    categorías de insumos: `proveedores.categorias TEXT[]` reemplaza a la
    categoría única (con backfill de la existente).
15. **`15_receta_leche_por_tamano.sql`** — Los ingredientes base de una
    receta se pueden ajustar por producto: además del gramaje de café por
    shot, `recetas.leche_ml_por_tamano` (`{"8":180,"12":280,"16":360}`;
    NULL = leche predeterminada de la sede). `fn_leche_ml_receta()` la resuelve
    y la usan tanto el descuento de inventario como el costo teórico.
16. **`16_rol_mostrador.sql`** — Rol `mostrador` (= cajero + barista) para
    sedes donde la misma persona levanta el pedido, cobra y prepara.
17. **`17_descripcion_producto.sql`** — `productos.descripcion` (frase corta
    opcional) para la pantalla del negocio estilo pizarra.
18–25. Migraciones incrementales posteriores (café seleccionable en frappés,
    mantener precio, recargo por café, ventas directas/atrasadas, revisión de
    precio estable, retirar opciones, fondo de caja e imagen de producto).
26. **`26_cortesias.sql`** — **Cortesías**: valor `cortesia` en `metodo_pago`
    (el pedido completo sale en $0; `subtotal` conserva lo regalado),
    columnas `pedidos.cortesia_*` (estado `dentro_plan | pendiente |
    autorizada | rechazada`, motivo de la Caja, quién y cuándo resolvió, nota
    del admin) con CHECK de coherencia, índice parcial para contar el cupo del
    mes por sucursal, `vw_pedidos_con_estado` recreada (expone las columnas
    nuevas) y `vw_ventas_por_metodo_pago` con `valor_cortesias` y sin pedidos
    cancelados. El cupo mensual vive en `configuracion`
    (`cortesias_mes_cajero`, compartido por sucursal; sin fila = 0). El
    `ALTER TYPE` va fuera de transacción, igual que en la 16.
27. **`27_mesas_y_estaciones.sql`** — Mesas y estaciones: `pedidos.destino`
    (`mesa | barra | llevar`, NULL = pedido en línea) + `mesa_numero` con
    CHECK de coherencia; `productos.estacion` (`barra | parrilla | caja`,
    snacks existentes → parrilla); `usuarios.estaciones TEXT[]` (existentes →
    ambas, para que nadie deje de ver pedidos); `vw_pedidos_con_estado`
    recreada (expone destino y no cuenta los ítems de caja como "en
    preparación"). Cantidad de mesas en `configuracion` (`mesas`, 4 si no hay).
28. **`28_reventa_snacks.sql`** — Snacks de reventa: `fn_descontar_inventario`
    consume los insumos fijos de un snack (su insumo en piezas) en vez de
    ignorarlo; `fn_costo_teorico_producto` usa el costo de compra cuando hay
    insumo (si no, sigue el 40 %); `vw_stock_bajo` con `stock_maximo` y
    `a_pedir`; `vw_precios_por_revisar` incluye snacks con insumo. Solo
    funciones y vistas (re-ejecutable).
29. **`29_presentacion_insumos.sql`** — Presentación de compra de los
    insumos (`materias_primas.presentacion_cantidad/_unidad/_nombre`, con
    CHECK de coherencia) y `lotes.paquetes`. La API deriva el costo unitario
    de cada compra (incluida la primera, al dar de alta).
30. **`30_parrilla_alimentos.sql`** — Tipo de producto `alimento`
    (parrilla/cocina: receta de varios ingredientes, sin café/leche/vaso;
    CHECK `productos_alimento_sin_opciones_bebida`), `opciones_extra.aplica_a`
    (`bebidas` | `alimentos`, el shot solo bebidas), `fn_descontar_inventario`
    y `fn_costo_teorico_producto` para snacks y alimentos (ingredientes fijos
    + extras), `fn_resetear_receta` con pasos de alimento y
    `vw_precios_por_revisar` con alimentos que ya tienen ingredientes. El
    `ALTER TYPE` va fuera de transacción (como 16 y 26). Re-ejecutable.
31. **`31_revision_precio_costos.sql`** — `fn_revision_precio` incluye el
    costo indirecto por unidad de la sede (gastos fijos ÷ unidades estimadas)
    y el margen/redondeo del negocio: cambiar cualquiera de ellos en Admin →
    Costos devuelve a "precios por revisar" los productos con "Mantener
    precio". Invalida a propósito las decisiones guardadas (reaparecen una vez).
32. **`32_contabilidad.sql`** — **Contabilidad y mayordomía**:
    `cuentas_contables` (catálogo por sede; `grupo` decide si baja la utilidad),
    `cuentas_dinero` (Caja y Banco con saldo inicial fechado), `egresos` (todo
    lo que sale de dinero: gastos, compras ligadas al lote, salidas de caja del
    turno, diezmo; pagado/por pagar, único por gasto fijo y mes),
    `traspasos_dinero`, `cierres_mes` (congela el mes) y `gastos_fijos` ligados
    a cuenta contable, cuenta de dinero y día de pago. Agrega
    `movimientos_inventario.costo_unitario` (congelado al registrar, para que el
    costo de ventas de un mes no cambie con compras posteriores),
    `fn_grupo_afecta_utilidad`, `fn_contabilidad_semilla` y un trigger que siembra
    el catálogo en cada sede nueva. Re-ejecutable.
34. **`34_margen_contribucion.sql`** — **El precio se fija por margen de
    contribución**: `cuentas_contables.entra_al_costo` (con trigger que pone lo
    sensato según el grupo; préstamo y sueldo del dueño fuera),
    `pesos_estacion` por sede (barra 1, parrilla 1.5, caja 0.25, sembrada
    también en cada sede nueva), `categorias_producto.margen_contribucion` y el
    cambio de significado de `productos.margen_porcentaje` (era markup sobre el
    costo, ahora es margen de contribución < 100). Funciones nuevas:
    `fn_gastos_fijos_costeables_mes`, `fn_costo_indirecto_producto` (reparto por
    peso de estación sobre la mezcla real de 30 días; suma exactamente los
    gastos costeables), `fn_margen_contribucion_producto` (producto → categoría
    → sede) y `fn_contribucion_actual`. `fn_precio_sugerido` pasa a
    `insumo / (1 - margen)` con piso en `fn_costo_total_unitario`, y
    `fn_revision_precio` deja de depender del reparto (que cambia con cada
    venta) para depender de las decisiones: margen, redondeo, gastos costeables
    y peso de la estación. Recrea `vw_precios_por_revisar`,
    `vw_desglose_costo_producto` y `vw_punto_equilibrio_negocio` (ahora sobre
    ventas reales de 30 días). Siembra los márgenes desde los precios vigentes,
    así que al aplicarla ningún precio cambia. Re-ejecutable.
33. **`33_cancelaciones.sql`** — **Cancelación de tickets con autorización**:
    `pedidos.cancelacion_estado` (`pendiente` / `autorizada` / `rechazada`) con
    motivo, quién la pidió, quién la resolvió y la nota, más un CHECK que
    mantiene coherentes estado y `cancelado`. Agrega
    `movimientos_inventario.revierte_movimiento_id` (único) y
    `fn_revertir_consumo_pedido`, que devuelve al lote y al stock lo que el
    pedido consumió con un movimiento de `ajuste` al mismo costo congelado —
    idempotente, así autorizar dos veces no devuelve el doble. Extiende
    `fn_confirmar_cobro_pedido` para regresar el punto de fidelidad al cancelar
    un ticket cobrado, recrea `vw_pedidos_con_estado` (cambiaron las columnas de
    `pedidos`) y fecha las compras con el día de México
    (`lotes.fecha_compra` por omisión, antes `CURRENT_DATE` en UTC: una compra
    de la tarde caía "mañana" y su egreso salía del mes). Re-ejecutable.
38. **`38_cortesia_por_producto.sql`** — **Cortesía por producto** (ya no por
    ticket completo): `pedido_items.es_cortesia` (la línea sale en $0;
    `precio_unitario` conserva el precio de menú), `pedidos.cortesia_valor` y
    `pedidos.cortesia_unidades` (lo regalado a precio de menú y las unidades;
    el cupo mensual se consume **por unidad**), `total = (subtotal −
    cortesia_valor) × (1 − descuento)`. `metodo_pago = 'cortesia'` queda solo
    para tickets 100 % cortesía; un ticket mixto lleva la forma de pago real.
    Traduce las cortesías anteriores (todas sus líneas pasan a `es_cortesia`),
    reescribe el CHECK de coherencia y el índice parcial (ahora por
    `cortesia_estado`), recrea `vw_pedidos_con_estado`,
    `vw_ventas_por_metodo_pago` (las formas reales suman solo lo cobrado; la
    fila `cortesia` agrupa todo lo regalado con `valor_cortesias` y
    `unidades_cortesia`) y `vw_productos_mas_vendidos` (las unidades regaladas
    cuentan como unidades pero no como ingresos). Re-ejecutable.

```bash
psql -U postgres -f 00_roles_y_permisos.sql   # cambia la contraseña antes de correrlo
createdb -U postgres cafeteria
psql -U postgres -d cafeteria -f 01_schema.sql
psql -U postgres -d cafeteria -f 02_functions_triggers.sql
psql -U postgres -d cafeteria -f 03_seed_data.sql
psql -U postgres -d cafeteria -f 04_views.sql
psql -U postgres -d cafeteria -f 05_mejoras_produccion.sql
psql -U postgres -d cafeteria -f 06_costos_indirectos.sql
psql -U postgres -d cafeteria -f 07_verificacion_y_sync.sql
psql -U postgres -d cafeteria -f 08_configuracion.sql
psql -U postgres -d cafeteria -f 09_tiempo_extraccion_por_tipo.sql
psql -U postgres -d cafeteria -f 10_security_hardening.sql
psql -U postgres -d cafeteria -f 11_catalogos_y_unidades.sql
psql -U postgres -d cafeteria -f 12_multisucursal.sql
psql -U postgres -d cafeteria -f 13_flujo_costos_menu.sql
psql -U postgres -d cafeteria -f 14_proveedores_categorias.sql
psql -U postgres -d cafeteria -f 15_receta_leche_por_tamano.sql
psql -U postgres -d cafeteria -f 16_rol_mostrador.sql
psql -U postgres -d cafeteria -f 17_descripcion_producto.sql
# … y así hasta 38_cortesia_por_producto.sql (o simplemente: db/migrar.sh)
```

## El punto de equilibrio ya considera TODO, no solo insumos

Antes, el costo de una bebida solo contaba café/leche/vaso/tapa — eso es el
costo *variable* de la receta. Pero para fijar un precio real hace falta
también la parte de renta, sueldos, gasolina y servicios (costos fijos /
indirectos): sin ellos, puedes vender cada bebida "con ganancia" sobre el
insumo y aun así perder dinero el fin de mes si esa ganancia no cubre tus
gastos fijos.

La migración 06 agrega:

- **`gastos_fijos`** — tabla donde registras cada gasto fijo real (renta,
  sueldos, gasolina, servicios, seguros...).
- **`configuracion_margen.unidades_estimadas_mes`** — cuántas bebidas esperas
  vender al mes; con esto se reparte el gasto fijo entre cada unidad vendida.
- **`fn_precio_punto_equilibrio(producto_id)`** — el precio mínimo al que
  puedes vender esa bebida sin perder dinero (insumo + su parte de gastos
  fijos, sin margen de ganancia todavía).
- **`fn_precio_sugerido(producto_id)`** — ahora parte de ese costo total
  (no solo del insumo) antes de aplicar tu margen deseado.
- **`vw_punto_equilibrio_negocio`** — la pregunta de fondo: *¿cuántas bebidas
  necesito vender al mes (y al día) para que el negocio no pierda dinero?*,
  usando el margen de contribución promedio real de tu catálogo activo.
- **`vw_ventas_reales_promedio_mes`** — para comparar tu estimación contra lo
  que de verdad se está vendiendo, y ajustarla con datos reales conforme pasa
  el tiempo.

Se probó con gastos de ejemplo de una cafetería móvil real (renta de espacio,
un sueldo, gasolina, servicios, seguro = $15,650/mes): con eso, **el sistema
calculó que se necesitan vender 16 bebidas al día (466 al mes) solo para
cubrir esos gastos fijos**, antes de empezar a ganar algo — exactamente la
pregunta que un punto de equilibrio debe responder.

El reparto es **por igual entre todas las bebidas** (modelo simple, el
estándar para un negocio chico). Una mejora de Fase 2 sería prorratear
distinto según qué tan caro es cada producto.

## Lo más importante: cómo se conecta con lo que ya construimos

### El descuento de inventario es automático y real (sección 11 del requerimiento)

Cuando el barista marca un `pedido_item` como `terminado`, un **trigger**
(`fn_descontar_inventario`) calcula solo y descuenta:

- El café (según la opción de café elegida — tradicional o especial — y si
  llevó shot extra, que duplica el gramaje).
- La leche (según el tamaño y la opción de leche elegida).
- El vaso y la tapa correctos (caliente / fría / frappé — un frappé usa tapa
  domo, no la tapa plana de una bebida fría normal).
- Los ingredientes fijos del producto (el chocolate del Moka, el jarabe del
  Caramel Macchiato, la galleta del Frappé Oreo, etc. — esto ya no son
  condicionales pegados al *nombre* del producto como en el prototipo de UI;
  ahora es una fila en `receta_insumos_fijos`, así que es editable sin tocar
  código).
- Los extras que el cliente agregó.

Cada descuento queda registrado en `movimientos_inventario`, así que siempre
puedes responder "¿a qué pedido se le fue esta leche?".

### PEPS de verdad, no solo de nombre

Para insumos con `requiere_lote = true` (como el café), el descuento **recorre
los lotes del más antiguo al más nuevo** y, si un lote no alcanza, sigue con
el siguiente — incluyendo el caso de que un solo pedido consuma de dos lotes
distintos. Esto se probó explícitamente: un Latte consumiendo de un lote viejo
de 10g y completando el resto desde el lote nuevo.

### El punto de fidelidad se acredita SOLO al cobrar — igual que en el prototipo

`fn_confirmar_cobro_pedido` solo suma al contador del cliente cuando
`pedidos.cobrado` pasa de `false` a `true` — nunca al crear el pedido. Si el
pedido se marca `no_show`, se le resta un punto. Reclamar el regalo apaga la
bandera `recompensa_pendiente` en el momento en que se crea ese pedido (no
hasta que se entregue), igual que decidimos en el prototipo.

### Mermas: una mejora real sobre el prototipo

En el prototipo de UI, registrar una merma era solo una bitácora — no tocaba
el inventario de verdad. **Aquí sí lo hace**: insertar una fila en `mermas`
dispara el mismo descuento de inventario (con PEPS si aplica) que una venta.
Es lo correcto — si se quemó leche, ese inventario ya no existe.

## Decisiones de diseño que vale la pena que conozcas

- **UUID como llave primaria** en casi todo (excepto catálogos pequeños como
  categorías y opciones, que usan `SERIAL`). Esto importa para el modo
  offline/semi-offline de la Fase 3 del requerimiento: con UUID, dos
  dispositivos sin conexión pueden crear registros sin riesgo de que choquen
  los IDs al sincronizar.
- **Eliminación segura en catálogos.** Proveedores, productos y materias primas
  se borran definitivamente solo si no tienen historial; si ya participaron en
  lotes, ventas, recetas o movimientos, la API los desactiva para conservar los
  reportes.
- **Conversión de unidades explícita.** Las recetas siempre piensan en
  gramos/mililitros, pero el inventario se puede llevar en kg/l. Encontré este
  bug probando el esquema: si no conviertes, "descontar 18 g" de un insumo en
  kilos te borra 18 **kilos** de un golpe. La función
  `fn_convertir_unidad` existe exactamente para evitar esto.
- **`auditoria` genérica** (tabla única con `entidad` + `entidad_id` +
  `valor_anterior`/`valor_nuevo` en JSONB) en vez de una tabla de historial
  por cada entidad. Cubre la sección 17 completa (cambios de precio, receta,
  inventario, cancelaciones, descuentos, márgenes, promociones) sin duplicar
  estructura. El backend debe llenarla explícitamente en cada operación
  sensible; no hay trigger automático para esto porque el "motivo" del
  cambio normalmente lo escribe una persona, no se infiere solo.
- **`promociones_apertura` y `configuracion_margen` ya existen** aunque el
  prototipo de UI todavía no las construye — son del Fase 2/3 de tu propio
  documento de requerimiento, y es más fácil tenerlas desde ahora que
  migrar después.

## Lo que ya se cerró en esta vuelta (antes decía "falta a propósito")

- **Autenticación real.** `usuarios.pin_hash` ya usa hash bcrypt real (vía
  `pgcrypto` en el seed) — se probó que `bcryptjs` en Node verifica
  correctamente un hash generado en Postgres, y la API (`../api`) hace la
  verificación real en cada login, con límite de intentos.
- **Costo real por venta.** `vw_costo_real_por_venta` (migración 05) usa el
  costo del lote efectivamente consumido (PEPS), no un estimado.
- **Costo indirecto y punto de equilibrio.** Migración 06 — ver la sección de
  arriba.
- **Verificación de teléfono y sincronización offline.** Migración 07 +
  `../api` (`/api/auth/cliente/solicitar-codigo`, `/api/sync/batch`) — se
  probaron en vivo, incluyendo el caso de un lote reenviado por duplicado.
- **La API REST que conecta todo esto** ya existe y se probó en vivo —
  ver `../api`.
- **Listo para Docker / VS Code / camino a AWS** — ver el `README.md` de la
  raíz del proyecto.

## Lo que sigue pendiente a propósito

- **Pruebas automatizadas en CI** — todo se probó a mano con peticiones HTTP
  reales; falta una suite que corra sola.
- **La cola offline del lado del dispositivo** (guardar en IndexedDB mientras
  no hay red) — la API ya acepta lotes sincronizados, pero esa cola en el
  prototipo de React todavía no se construyó.

### Nombre del ticket y comandas agrupadas (39)

`39_nombre_ticket.sql` agrega `pedidos.nombre_ticket` (hasta 80 caracteres).
Aplicar con `bash db/migrar.sh` antes de actualizar la API. Es compatible con
pedidos anteriores, que pueden no tener nombre. Caja pide el nombre para nuevos
tickets; la API permite omitirlo para conservar compatibilidad con clientes anteriores.
Las comandas muestran quién levantó el pedido usando `pedidos.cajero_id`, que se
asigna desde la sesión al crearlo. Cada estación conserva su filtro de productos.

Verificación local: `docker exec cafeteria-api node test/live-ticket-identity.js`
(prueba transaccional con reversión) y `node --test frontend/test/preparationOrders.test.js`.

Las comandas se presentan en franjas horizontales. Pendientes y en preparación
comparten pantalla; las líneas terminadas permanecen dentro del ticket. Los
tickets completos pasan a «Listos» y se conservan durante el día de operación
(zona America/Mexico_City), también después de recargar. Iniciar preparación y
Terminar todo se ejecutan de forma atómica por estación y sobre las líneas
visibles al pulsar, sin incluir productos agregados después ni repetir consumos.

### Preparación por empleado y entregas (40)

Aplicar `40_preparacion_y_entrega.sql` con `bash db/migrar.sh` antes de actualizar
la API. Registra quién pulsó Terminar y cuántas unidades entregó caja, con fecha
y responsable. La entrega no cambia el cobro ni vuelve a consumir inventario.
Las entregas parciales quedan auditadas y usan control de concurrencia.

Caja → Comandas permite seguir ambas estaciones y registrar entregas.
Preparados por empleado consulta por fecha de terminación (hora CDMX) y empleado;
Administración → Comandas / personal ofrece la misma consulta en modo lectura.
Los productos permanecen en el historial después de entregarlos. Los tickets
salen de Por entregar cuando no quedan productos pendientes de preparación o entrega.
No se infieren entregas históricas ni quién terminó registros anteriores: esos
campos no existían. El historial indica por separado quién inició, si está registrado.

Los productos asignados a Caja / sin preparación también aparecen en Comandas,
listos para surtir pero con entrega pendiente. El rol Mostrador (Caja + barra)
puede levantar, preparar y entregar desde su misma sesión; no se cambian los
permisos del rol de preparación. En Productos, elegir Comprado hecho propone
Caja como estación; puede cambiarse para productos que necesitan calentarse.
No se reclasifican automáticamente productos existentes.

«Entregas por empleado» consulta cada evento auditado de entrega, con su fecha,
cantidad y empleado real (incluidas las parciales de varias personas).
«Preparados por empleado» excluye Caja, que no requiere preparación. Las
correcciones y devoluciones ajustan el saldo entregado conservando la auditoría.
