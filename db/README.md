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
- **`activo BOOLEAN` en vez de borrar filas.** Nada se borra de verdad
  (usuarios, productos, materias primas, proveedores) — se desactiva. Igual
  que ya hace el prototipo.
- **Conversión de unidades explícita.** Las recetas siempre piensan en
  gramos/mililitros, pero el inventario se puede llevar en kg/L. Encontré este
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
