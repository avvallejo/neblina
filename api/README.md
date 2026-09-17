# API — Cafetería Móvil

API REST en Node.js + Express + PostgreSQL que conecta el prototipo (Cliente,
Caja, Barista, Admin) con la base de datos real. **Se probó en vivo, con
peticiones HTTP reales**, no solo se escribió — login con PIN real (bcrypt),
pedidos completos, descuento automático de inventario a través de la API,
cobro, fidelidad, no-show, mermas, reportes y el punto de equilibrio,
funcionando de extremo a extremo.

## Arranque rápido

```bash
# 1. Base de datos (en orden, conectado como superusuor de Postgres)
psql -U postgres -f ../db/00_roles_y_permisos.sql   # crea el rol de la app — cambia la contraseña primero
createdb -U postgres cafeteria
psql -U postgres -d cafeteria -f ../db/01_schema.sql
psql -U postgres -d cafeteria -f ../db/02_functions_triggers.sql
psql -U postgres -d cafeteria -f ../db/03_seed_data.sql
psql -U postgres -d cafeteria -f ../db/04_views.sql
psql -U postgres -d cafeteria -f ../db/05_mejoras_produccion.sql
psql -U postgres -d cafeteria -f ../db/06_costos_indirectos.sql
psql -U postgres -d cafeteria -f ../db/07_verificacion_y_sync.sql
psql -U postgres -d cafeteria -f ../db/08_configuracion.sql
psql -U postgres -d cafeteria -f ../db/09_tiempo_extraccion_por_tipo.sql
psql -U postgres -d cafeteria -f ../db/10_security_hardening.sql
psql -U postgres -d cafeteria -f ../db/11_catalogos_y_unidades.sql
psql -U postgres -d cafeteria -f ../db/12_multisucursal.sql
psql -U postgres -d cafeteria -f ../db/13_flujo_costos_menu.sql
psql -U postgres -d cafeteria -f ../db/14_proveedores_categorias.sql

# 2. API
npm install
cp .env.example .env        # edita PGPASSWORD y genera un JWT_SECRET real
npm start
```

Solo la semilla de desarrollo crea estos usuarios: Admin `1234`, Caja `1111`,
Barista `2222`. Producción omite por completo esa semilla y usa
`npm run bootstrap:admin` para crear una credencial única.

## Multi-sucursal (cómo piensa la API desde la migración 12)

Todo — catálogo, inventario, clientes, personal, turnos, folios y
configuración — pertenece a UNA sucursal. Reglas:

- **Endpoints públicos** (menú, opciones, `turnos/estado`, `config`,
  fidelidad): reciben la sede como `?sucursal=<id>`. La lista de sedes para
  el selector es `GET /api/sucursales` (público, solo id y nombre).
- **Sesiones**: el login es POR SEDE y el token queda atado a ella. El
  personal con sede fija opera SOLO su sucursal — cualquier `X-Sucursal-Id`
  que mande se ignora, y un recurso de otra sede le responde 404.
- **Jerarquía de administradores**:
  - *Administrador general* (`usuarios.sucursal_id = NULL`): opera cualquier
    sede eligiéndola con el encabezado `X-Sucursal-Id` (o `?sucursal=`); es
    el único que administra sucursales (`/api/sucursales/todas`, `POST`,
    `PATCH`), crea otros admins generales, reasigna gente de sede y ve el
    reporte consolidado (`?consolidado=true`).
  - *Administrador de sede*: administra únicamente su sucursal (incluido su
    personal); no ve ni edita a los admins generales ni a otras sedes.
- **Descuentos**: el PIN autorizador debe ser de un admin DE ESA SEDE o de un
  admin general.
- La prueba de integración `npm run test:multisucursal:live` verifica estas
  garantías (10 casos) contra la API corriendo.

## Autenticación

- `POST /api/auth/login { pin, sucursalId }` → personal (admin/cajero/
  barista) **de esa sucursal** (los admins generales entran desde cualquier
  sede). Devuelve `{ token, usuario }`, donde `usuario.sucursalId === null`
  identifica al administrador general. El PIN se compara con bcrypt solo
  contra el personal de esa sede + los generales — nunca se guarda ni se
  compara en texto plano.
- **Cliente, en dos pasos (verificación real por SMS):**
  1. `POST /api/auth/cliente/solicitar-codigo { telefono, sucursalId }` — manda un código
     de 6 dígitos por SMS (o lo imprime en consola si `SMS_PROVIDER=console`,
     para desarrollo sin gastar SMS reales). Límite: 1 código por minuto y
     máximo 5 por hora, por teléfono.
  2. `POST /api/auth/cliente/verificar-codigo { telefono, codigo, sucursalId, nombre?, apellido? }`
     — `nombre`/`apellido` solo son obligatorios la primera vez (cliente
     nuevo); alguien que ya tiene cuenta solo necesita el código. Devuelve
     `{ token, cliente }`.
- `POST /api/clientes { nombre, apellido, telefono }` (cajero/admin) — Caja
  registra a un cliente **en persona**, sin SMS: la presencia física frente
  al cajero es su propia verificación.
- Todas las demás rutas requieren `Authorization: Bearer <token>`. Para
  personal, cada petición vuelve a comprobar `activo`, rol y `token_version`;
  cambiar rol, PIN o estado revoca los JWT anteriores.
- Límite de 10 intentos de login / 15 min por IP (protege contra fuerza bruta
  sobre un PIN de 4 dígitos).

## Endpoints principales

| Método y ruta | Quién | Para qué |
|---|---|---|
| `GET /api/sucursales` | público | Sedes activas, para el selector |
| `GET /api/productos?sucursal=<id>` | público | Menú de esa sede (Caja y Cliente) |
| `GET /api/opciones/{tamanos,leches,cafes,extras}` | público | Hoja de personalización |
| `GET /api/opciones/admin` · `POST /api/opciones/{leches,cafes,extras}` · `PATCH /api/opciones/{tipo}/:id` | admin | Ajustes de precio de la personalización, con costo estimado y sugerido |
| `GET/POST/PATCH/DELETE /api/gastos-fijos` · `GET/PUT /api/promociones/margen` | admin | Gastos fijos y margen/volumen (costo indirecto) |
| `GET /api/turnos/estado?sucursal=<id>` | público | El cliente ve si SU sede está abierta |
| `POST /api/pedidos` | staff o cliente | Levantar un pedido (precio se calcula en el servidor) |
| `PATCH /api/pedidos/:id/cobrar` | cajero/admin | Confirma el cobro — **aquí** se acredita fidelidad |
| `GET /api/cortesias/plan` | cajero/admin | Cupo de cortesías del mes de la sede (por producto): límite, usadas, restantes, tickets pendientes |
| `GET /api/pedido-items/cola[?estacion=]` | barista/admin | Comanda filtrada por las estaciones del usuario (barra / parrilla); trae destino y mesa |
| `GET /api/cortesias?estado=pendiente` · `PATCH /api/cortesias/:id/{autorizar,rechazar}` | admin | Autorizaciones de cortesías fuera del plan (nota opcional) |
| `PATCH /api/pedidos/:id/no-show` | cajero/admin | Penaliza fidelidad por no recogido |
| `GET /api/pedido-items/cola` | barista/admin | Cola de preparación, ordenada por urgencia |
| `PATCH /api/pedido-items/:id/terminar` | barista/admin | Descuenta inventario automáticamente (trigger) |
| `POST /api/mermas` | barista/admin | Registra y descuenta merma real |
| `GET /api/clientes/yo` , `/yo/pedidos` | cliente | Su cuenta y su historial |
| `POST /api/sync/batch` | staff o cliente | Sincroniza una cola de acciones hechas sin internet |
| `PUT /api/recetas/:productoId` | admin | Editar pasos/molienda/tiempo/temperatura |
| `GET /api/productos/:id/precio-sugerido` | admin | Costo directo + indirecto, margen aplicable y redondeo |
| `POST/PATCH/DELETE /api/productos/categorias[/:id]` · `PUT /api/productos/categorias/orden` | admin | Categorías del menú por sede (borrar solo sin productos) |
| `POST/PATCH/DELETE /api/materias-primas/categorias[/:id]` | admin | Categorías de insumos por sede (borrar solo sin insumos) |
| `GET /api/productos/precios-por-revisar` | admin | Productos cuyo precio de menú ya no cuadra con su costo + margen |
| `GET /api/promociones/punto-equilibrio` | admin | Unidades/mes y /día para no perder dinero |
| `GET /api/reportes/*` | admin | Reportes de su sede |
| `GET /api/reportes/*?consolidado=true` | admin general | Todas las sedes, con nombre de sucursal |
| `GET/POST/PATCH /api/sucursales*` | admin general | Crear y administrar sucursales |

Todos los precios se **calculan en el servidor** (`src/utils/pricing.js`) — el
precio que manda el frontend nunca se usa para cobrar, solo se confía en los
catálogos (`opciones_*`, `productos.precio_base`) que vive en la base de
datos.

## Flujo inventario → receta → costo → precio → menú

La cadena está automatizada de punta a punta:

1. Das de alta la **materia prima** en el inventario (con su costo unitario).
2. Creas el **producto**: su receta se crea sola con valores predeterminados;
   en el editor de receta agregas sus **ingredientes del inventario**
   (`PUT /api/recetas/:productoId` con `insumosFijos`). El café, la leche y
   el vaso/tapa se calculan según las opciones de cada venta.
3. El sistema calcula el **costo prorrateado** (directo por receta +
   indirecto por gastos fijos). Tú solo decides el **margen** — el de la
   sucursal o uno propio del producto (`margenPorcentaje`) — y aplicas el
   **precio sugerido** al menú con un clic.
4. El producto queda visible en el menú de la app y en la **pantalla del
   negocio** (frontend: `/?pantalla=menu&sucursal=<id>`, pensada para una TV;
   se actualiza sola cada minuto).
5. Si el costo de un insumo cambia, el precio NO cambia solo:
   `GET /api/productos/precios-por-revisar` alimenta el aviso del panel para
   repreciar con un clic.

## Costos indirectos y punto de equilibrio (lo que pediste explícitamente)

Antes, el "precio sugerido" solo contaba insumos (café, leche, vaso, tapa).
Eso es el costo *variable* — pero un negocio puede vender cada bebida "con
utilidad" sobre el insumo y **seguir perdiendo dinero** si esa utilidad no
alcanza a cubrir renta, sueldos, gasolina y servicios.

Ahora:

1. **`POST /api/gastos-fijos`** — registras cada gasto fijo real (renta,
   sueldos, transporte, servicios, seguros...).
2. **`PUT /api/promociones/margen { unidadesEstimadasMes }`** — cuántas
   bebidas esperas vender al mes; con esto se reparte el gasto fijo entre cada
   unidad.
3. **`GET /api/productos/:id/desglose-costo`** — te dice, por producto:
   costo directo, costo indirecto que le toca, costo total, **precio de
   equilibrio** (el mínimo para no perder dinero en esa bebida) y precio
   sugerido (con tu margen deseado encima de eso).
4. **`GET /api/promociones/punto-equilibrio`** — la pregunta de fondo:
   *¿cuántas bebidas necesito vender al mes (y al día) para que el negocio no
   pierda dinero?*, usando el margen de contribución promedio real de tu
   catálogo activo.

El modelo reparte el gasto fijo **por igual entre todas las bebidas**
(modelo simple, estándar para un negocio chico). Una mejora de Fase 2 sería
prorratear distinto según qué tan caro es cada producto.

⚠️ Con datos de muy pocos días de venta, `unidades_estimadas_mes` (tu meta) y
`ventas_reales_promedio_mes` (lo que ya se vendió) van a verse muy distintos
— eso es normal, no es un error; cuando tengas 1-2 meses de historia real,
ajusta la meta con datos de verdad.

## Sincronización offline

Cada dispositivo (tablet de Caja, de Barista, o el celular del Cliente) puede
seguir operando sin internet: guarda sus acciones en una cola local, cada una
con un `clientUuid` que el propio dispositivo genera
(`crypto.randomUUID()` en el navegador o en React Native). Al recuperar
conexión, manda TODA la cola de una vez, **en el mismo orden en que pasaron**:

```json
POST /api/sync/batch
{
  "dispositivo": "Tablet Caja 1",
  "operaciones": [
    { "tipo": "crear_pedido", "clientUuid": "<uuid>", "payload": {
        "timestampOriginal": "2026-06-20T15:00:00Z",
        "items": [{ "clientUuid": "<uuid>", "productoId": "...", "tamanoId": 2, "cafeId": 1, "cantidad": 1 }]
    }},
    { "tipo": "actualizar_item", "clientUuid": "<uuid>", "payload": { "itemClientUuid": "<uuid del item>", "nuevoEstado": "terminado" }},
    { "tipo": "crear_merma", "clientUuid": "<uuid>", "payload": { "materiaPrimaId": "...", "cantidad": 50, "unidad": "ml", "motivo": "Leche derramada" } }
  ]
}
```

Responde con el resultado de cada operación (`creado` / `ya_existia` /
`error`), para que el dispositivo sepa cuáles puede borrar de su cola local.

Puntos clave que ya se probaron en vivo:

- **Idempotente de verdad**: reenviar el mismo lote (por una respuesta que se
  perdió en el camino) no duplica nada — se reconoce por `clientUuid`.
- **No se puede regresar el estado de un ticket**: si un "iniciar" viejo
  llega después de que ya se sincronizó su "terminar", se reconoce como ya
  superado en vez de retroceder el estado — esto importa porque retroceder y
  re-avanzar volvía a disparar el descuento de inventario una segunda vez
  (bug real que se encontró y se corrigió probando esto).
- **Resuelve dependencias dentro del mismo lote**: si un pedido se creó sin
  conexión y su ticket también se marcó "terminado" sin conexión, el pedido
  va primero en el arreglo — su id real ya está disponible para cuando se
  procesa el "terminado" de ese mismo lote.
- **Respeta el turno real**: si el pedido pasó a las 3pm pero se sincronizó
  hasta las 7pm (con el turno ya cerrado), se le asigna el turno que estaba
  abierto A LAS 3PM, no el de ahora.
- Solo el personal puede mandar `actualizar_item` y `crear_merma`; cualquiera
  (personal o cliente) puede mandar `crear_pedido`.

### Descuentos

El PIN del administrador ya no viaja con el pedido. Caja solicita primero una
autorización efímera y de un solo uso:

```json
POST /api/pedidos/aprobaciones-descuento
{ "pin": "<PIN ADMIN>", "descuentoPorcentaje": 10 }
```

El `token` devuelto dura cinco minutos y el pedido lo manda como
`autorizacionDescuento`. Está ligado al cajero, porcentaje y primer uso. Cinco
PIN fallidos bloquean nuevas pruebas durante una hora.

### Cortesías (por producto)

Una cortesía es un producto del ticket que se entrega sin cobrar; el resto
del mismo ticket se cobra normal. Se marca por línea: `POST /api/pedidos`
con `items[].esCortesia: true` (solo caja/mostrador/admin), o al cobrar un
ticket abierto o pedido en línea con `PATCH /api/pedidos/:id/cobrar
{ itemsCortesia: [pedidoItemId…], motivoCortesia? }` (la lista sustituye las
marcas anteriores; sin el campo se respetan las marcas con que se abrió el
ticket; `totalEsperado` es el total que la Caja vio antes de marcar). Las
líneas agregadas a un ticket abierto (`POST /api/pedidos/:id/items`) también
aceptan `esCortesia`. Por compatibilidad, `pago.metodoPago: 'cortesia'` marca
TODAS las líneas y solo es válido si el total queda en 0.

El servidor guarda `pedido_items.es_cortesia`, `pedidos.cortesia_valor` y
`pedidos.cortesia_unidades`, y calcula `total = (subtotal − cortesia_valor) ×
(1 − descuento)`; el descuento aplica solo sobre lo cobrable. Un ticket 100 %
cortesía sale con `metodo_pago = 'cortesia'` y `total = 0`; uno mixto lleva la
forma de pago real. No combina con una recompensa de fidelidad (ya es gratis).
El estado se decide al cobrar con el cupo mensual de la sede (`PUT /api/config
{ cortesiasMesCajero }`, **unidades** por mes, compartido por todos los
cajeros, reinicia cada mes en hora de Ciudad de México):

* las unidades del ticket caben en lo que queda → `dentro_plan` (consume esas
  unidades);
* no caben completas → **la venta se procesa igual** pero el ticket queda
  `pendiente` sin consumir cupo; la respuesta trae `cortesia.leyenda` para la
  Caja y el pedido aparece en `GET /api/cortesias?estado=pendiente` hasta que
  un admin lo autorice o rechace (rechazar solo lo marca: no revierte la
  venta);
* un admin cobrando en Caja → `autorizada` por él mismo, sin consumir cupo.

`GET /api/cortesias/plan` devuelve `limite`, `usadas` (unidades), `tickets`,
`restantes`, `pendientes` (tickets), `unidadesPendientes`, `mes` y
`mesNombre`. Un bloqueo de aviso por sucursal (`pg_advisory_xact_lock`) evita
que dos cajas consuman las últimas unidades al mismo tiempo. La caja del
turno, el resumen del día y el reporte por forma de pago exponen
`cortesias` (tickets), `unidades` y `valor`. `test/live-courtesies.js`
(`npm run test:cortesias:live`, con `NODE_ENV=development`, se ejecuta desde
la raíz de la API como los demás `live-*`) cubre el flujo completo con rollback.

### Mesas y estaciones

`POST /api/pedidos` desde Caja exige `destino` (`mesa` + `mesa: N`, `barra` o
`llevar`); N se valida contra `PUT /api/config { mesas }`. Los pedidos de
clientes no lo llevan. Cada producto tiene `estacion` (`barra` | `parrilla` |
`caja`; `POST/PATCH /api/productos`): los ítems de `caja` se marcan
terminados al crear el pedido (`services/stations.js`), también en
`/api/sync/batch`. `usuarios.estaciones` (`POST/PATCH /api/usuarios`, viaja
en `/auth/login` y `/auth/yo`) decide qué ve cada quien en `/pedido-items/cola`.
`test/live-stations.js` (`npm run test:estaciones:live`) cubre el módulo.

### Snacks de reventa

`POST/PATCH /api/productos` acepta `reventa: { insumoId, cantidad }` (o
`null` para quitar el control) solo en snacks: se guarda como insumo fijo del
producto (`receta_insumos_fijos`), así que la venta lo descuenta con el mismo
trigger de inventario y `fn_costo_teorico_producto` devuelve el costo de
compra. `GET /api/productos` trae `reventa` (insumo, cantidad, stock, mínimo,
máximo, costo y `aPedir` cuando está bajo el mínimo). `POST /api/materias-primas`
acepta `stockMaximo` ("reabastecer hasta") y `vw_stock_bajo` expone `a_pedir`.
`test/live-resale.js` (`npm run test:reventa:live`).

### Compras de insumos y presentación

`POST /api/materias-primas` acepta `presentacion: { nombre, cantidad, unidad }`
(convertible a la unidad de control) y `primeraCompra: { paquetes | cantidadComprada + unidad, costoTotal }`;
con `primeraCompra` el stock inicial y el costo unitario los deriva el
servidor (`services/purchases.js`, la misma lógica de `POST /:id/lotes`, que
ahora también acepta `paquetes`). `stockActual` + `costoUnitario` siguen
valiendo para capturar existencias a mano. `PATCH` acepta `presentacion`
(`null` la quita). `test/live-purchases.js` (`npm run test:compras:live`).

### Alimentos de parrilla/cocina y extras por ámbito

`POST/PATCH /api/productos` acepta `tipo: 'alimento'` (sin tamaño, leche ni
tipo de café: 400 si se intenta; `estacion` por defecto `parrilla`; nace con
su fila en `recetas` y, si un snack cambia a alimento, se le crea). Su receta
se guarda con `PUT /api/recetas/:id` como la de una bebida, pero solo
importan `pasos`, `insumosFijos` (varios ingredientes), `tiempoExtraccion`
(tiempo de preparación) y `temperaturaServicio` (término). `reventa` sigue
siendo exclusivo de snacks. Los extras llevan `aplicaA` (`bebidas` |
`alimentos`) en `POST/PATCH /api/opciones/extras`; `calcularPrecioItem`
rechaza un extra que no aplique al tipo del producto (400 "no aplica"), y el
trigger de inventario descuenta ingredientes fijos + insumos de los extras
en snacks y alimentos. `scripts/agregar-parrilla.js <sede> [--apply]` carga el
menú inicial. `test/live-alimentos.js` (`npm run test:alimentos:live`).

### Revisión de precios y costos del negocio

`POST /api/productos/:id/mantener-precio` guarda la huella
`fn_revision_precio(id)`; el producto reaparece en
`GET /api/productos/precios-por-revisar` cuando la huella cambia. Desde la
migración 31 la huella también cubre `fn_costo_fijo_unitario` (gastos fijos ÷
unidades estimadas) y el margen/redondeo de `configuracion_margen`, así que
`PUT /api/promociones/margen` y los cambios en `/api/gastos-fijos` reavivan la
revisión de todo el catálogo. `test/live-price-review.js`.

### Contabilidad y mayordomía

`/api/contabilidad` (solo admin, por sede): `config` (porcentajes de diezmo y
ofrenda, fecha de arranque), `cuentas` y `cuentas-dinero` (catálogo y saldos),
`egresos` (alta, edición, marcar pagado, anular con motivo y auditoría),
`recurrentes?periodo=AAAA-MM` + `recurrentes/:id/registrar` (gastos fijos del
mes, uno solo por gasto y periodo), `traspasos`, `estado-resultados?periodo=`,
`flujo?periodo=`, `mayordomia?anio=`, `cierres` (cerrar / reabrir con motivo) y
`consolidado/estado-resultados` (solo administrador general). El costo de
ventas sale de `movimientos_inventario` valuado con el costo congelado en cada
movimiento; las compras (`POST /materias-primas/:id/lotes`) crean su egreso en
la cuenta "Compra de insumos" con `cuentaDineroId`/`pagado`, y
`POST /turnos/actual/salidas` registra una salida de caja del turno (baja el
efectivo esperado de `drawerSql`). Con el mes cerrado, cualquier alta o cambio
de egreso de ese mes devuelve 409. `scripts/configurar-contabilidad.js <sede>
[--apply]` deja la sede lista. `test/live-contabilidad.js`
(`npm run test:contabilidad:live`).

### Costeo por margen de contribución

`GET/PUT /promociones/margen` (margen de contribución general de la sede, < 100,
y redondeo), `GET/PUT /promociones/pesos-estacion` (peso de cada estación más
los gastos fijos del mes y cuánto de ellos es costo del producto),
`PATCH /productos/categorias/:id { margenContribucion }` y
`PATCH /productos/:id { margenPorcentaje }` (margen propio del producto; ahora
es de contribución). `PATCH /contabilidad/cuentas/:id { entraAlCosto }` decide
si los gastos de esa cuenta forman parte del costo de los productos.
`GET /productos/:id/precio-sugerido` explica el sugerido: insumo, su parte de
los gastos fijos, piso, margen aplicado con su origen (`producto` / `categoria`
/ `sede`), el margen que deja hoy el precio y si `piso_manda`.
`GET /promociones/punto-equilibrio` da la venta y la contribución de los últimos
30 días contra los gastos fijos. `test/live-margen-contribucion.js`
(`npm run test:margen:live`).

### Cancelación de tickets

`PATCH /pedidos/:id/cancelar { motivo }` (Caja, barra, admin y el cliente con
su propio pedido; el motivo es obligatorio, mínimo 3 caracteres). Devuelve
`cancelacion_estado` y la `leyenda` que hay que mostrar: `autorizada` cuando el
ticket no se había cobrado ni empezado a preparar (o cuando lo pide un admin),
`pendiente` en cualquier otro caso — y mientras esté pendiente el pedido SIGUE
contando en ventas. `/api/cancelaciones` (solo admin, por sede): `GET
?estado=pendiente` da la cola con el motivo, el detalle del ticket y cuántos
movimientos de insumo regresarían; `PATCH /:id/autorizar` cancela de verdad
(ítems, ventas del día, caja del turno, estado de resultados, punto de
fidelidad y devolución de inventario vía `fn_revertir_consumo_pedido`) y
`PATCH /:id/rechazar` lo deja como estaba. Ambas guardan auditoría con el
motivo y la nota. Un ticket de un mes contable ya cerrado devuelve 409.
`test/live-cancelaciones.js` (`npm run test:cancelaciones:live`).

## Decisiones de seguridad que ya están tomadas

- El PIN nunca se guarda ni compara en texto plano (bcrypt, vía pgcrypto en
  el seed y bcryptjs en la API — son compatibles, se probó).
- El teléfono del cliente se verifica con un código real por SMS antes de
  poder pedir — código de un solo uso, vence en 10 minutos, máximo 5 intentos
  y límite de 1 código por minuto / 5 por hora por número.
- La API se conecta con un rol de base de datos sin privilegios de
  superusuario (`cafeteria_app`), no con `postgres`.
- Los descuentos de cajero usan una autorización de un solo uso ligada al
  cajero y porcentaje. Los intentos de PIN se bloquean de forma persistente.
- Rate limiting en login, en solicitar código SMS, y en general.
- Helmet (cabeceras HTTP de seguridad) y CORS configurable por variable de
  entorno.

## Lo que falta a propósito (y qué hacer cuando llegue el momento)

- **Pruebas automatizadas**: ya existen dos niveles — `npm test` (unitarias,
  32 casos, corren sin base de datos) y las de integración contra la API viva:
  `npm run test:security:live` (seguridad) y `npm run test:multisucursal:live`
  (las 10 garantías multi-sucursal). Falta engancharlas a un CI (GitHub
  Actions) para que corran solas en cada cambio.
- **Backups de la base de datos**: configura `pg_dump` programado (cron) o el
  backup automático de tu proveedor de hosting desde el primer día en
  producción — no es algo que la API resuelva por ti.
- **El frontend (React) todavía no tiene cola offline propia.** La API ya
  acepta lotes sincronizados (`/api/sync/batch`), pero construir la cola
  local en el prototipo (guardar en IndexedDB mientras no hay red, reintentar
  al volver la conexión) es trabajo de frontend que sigue pendiente.
