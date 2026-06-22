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

# 2. API
npm install
cp .env.example .env        # edita PGPASSWORD y genera un JWT_SECRET real
npm start
```

Solo la semilla de desarrollo crea estos usuarios: Admin `1234`, Caja `1111`,
Barista `2222`. Producción omite por completo esa semilla y usa
`npm run bootstrap:admin` para crear una credencial única.

## Autenticación

- `POST /api/auth/login { pin }` → personal (admin/cajero/barista). Devuelve
  `{ token, usuario }`. El PIN se compara con bcrypt contra los usuarios
  activos — nunca se guarda ni se compara en texto plano.
- **Cliente, en dos pasos (verificación real por SMS):**
  1. `POST /api/auth/cliente/solicitar-codigo { telefono }` — manda un código
     de 6 dígitos por SMS (o lo imprime en consola si `SMS_PROVIDER=console`,
     para desarrollo sin gastar SMS reales). Límite: 1 código por minuto y
     máximo 5 por hora, por teléfono.
  2. `POST /api/auth/cliente/verificar-codigo { telefono, codigo, nombre?, apellido? }`
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
| `GET /api/productos` | público | Menú (Caja y Cliente) |
| `GET /api/opciones/{tamanos,leches,cafes,extras}` | público | Hoja de personalización |
| `GET /api/turnos/estado` | público | El cliente ve si está abierto |
| `POST /api/pedidos` | staff o cliente | Levantar un pedido (precio se calcula en el servidor) |
| `PATCH /api/pedidos/:id/cobrar` | cajero/admin | Confirma el cobro — **aquí** se acredita fidelidad |
| `PATCH /api/pedidos/:id/no-show` | cajero/admin | Penaliza fidelidad por no recogido |
| `GET /api/pedido-items/cola` | barista/admin | Cola de preparación, ordenada por urgencia |
| `PATCH /api/pedido-items/:id/terminar` | barista/admin | Descuenta inventario automáticamente (trigger) |
| `POST /api/mermas` | barista/admin | Registra y descuenta merma real |
| `GET /api/clientes/yo` , `/yo/pedidos` | cliente | Su cuenta y su historial |
| `POST /api/sync/batch` | staff o cliente | Sincroniza una cola de acciones hechas sin internet |
| `PUT /api/recetas/:productoId` | admin | Editar pasos/molienda/tiempo/temperatura |
| `GET /api/productos/:id/precio-sugerido` | admin | Costo directo + indirecto + precio de equilibrio |
| `GET /api/promociones/punto-equilibrio` | admin | Unidades/mes y /día para no perder dinero |
| `GET /api/reportes/*` | admin | Los mismos reportes del dashboard |

Todos los precios se **calculan en el servidor** (`src/utils/pricing.js`) — el
precio que manda el frontend nunca se usa para cobrar, solo se confía en los
catálogos (`opciones_*`, `productos.precio_base`) que vive en la base de
datos.

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

- **Pruebas automatizadas**: todo esto se probó a mano con peticiones HTTP
  reales (ver el historial de la conversación), pero no hay todavía una
  suite de pruebas que corra sola en CI. Vale la pena escribirla antes de que
  el equipo crezca.
- **Backups de la base de datos**: configura `pg_dump` programado (cron) o el
  backup automático de tu proveedor de hosting desde el primer día en
  producción — no es algo que la API resuelva por ti.
- **El frontend (React) todavía no tiene cola offline propia.** La API ya
  acepta lotes sincronizados (`/api/sync/batch`), pero construir la cola
  local en el prototipo (guardar en IndexedDB mientras no hay red, reintentar
  al volver la conexión) es trabajo de frontend que sigue pendiente.
