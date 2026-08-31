# Cafetería Móvil — proyecto completo

Sistema completo y **multi-sucursal** de la cafetería (PostgreSQL + API REST
en Node/Express + frontend React adaptable a cualquier pantalla), listo para
abrir como su propio proyecto en VS Code y correr en Docker, sin pisar ningún
otro proyecto que ya tengas corriendo en tu máquina.

```
.
├── docker-compose.yml            # Servicios: db (PostgreSQL) + api (Node)
├── docker-compose.override.yml   # Se combina solo: monta código fuente, recarga en vivo
├── .devcontainer/                # Configuración de VS Code Dev Containers
├── docker/00_roles_y_permisos.sh # Crea el rol de la API al iniciar el contenedor de Postgres
├── db/                           # Las mismas migraciones SQL (00-12), para correr sin Docker / contra AWS RDS
├── api/                          # Código fuente de la API (Node + Express)
└── frontend/                     # Frontend React (Vite) — adaptable a celular, tablet y escritorio
```

## Arrancar con Docker (recomendado)

```bash
cp .env.example .env
# Edita .env: cambia las contraseñas y genera un JWT_SECRET real con:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up
```

Eso levanta PostgreSQL, le corre las 13 migraciones automáticamente (solo la
primera vez que crea su volumen de datos) y arranca la API en
`http://localhost:3000` con recarga en vivo (gracias a
`docker-compose.override.yml`, que Compose combina solo).

Solo en desarrollo se cargan usuarios de prueba: Admin `1234`, Caja `1111`,
Barista `2222`. `docker-compose.prod.yml` no monta esa semilla.

En producción, después de aplicar las migraciones, crea el primer
**administrador general** (con acceso a todas las sucursales) una sola vez y
elimina el PIN del entorno al terminar:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  -e BOOTSTRAP_ADMIN_NAME='Administrador' \
  -e BOOTSTRAP_ADMIN_PIN='<PIN-UNICO-DE-4-DIGITOS>' \
  api npm run bootstrap:admin
```

El comando rechaza los PIN conocidos de demostración y no imprime el secreto.

## Multi-sucursal

El sistema opera de 1 a N sucursales sobre la misma base de datos, cada una
con su propio catálogo, inventario, clientes, personal, turnos, folios
(`S1-P-105`, `S2-P-1`…) y configuración. Hay dos niveles de administración:

- **Administrador general** (sin sede fija): configura TODAS las sedes — las
  crea y administra, cambia de sucursal desde el panel, crea admins de sede y
  ve el reporte comparativo consolidado.
- **Administrador de sucursal**: administra únicamente la suya.

El personal operativo tiene tres roles: **Cajero** (levanta pedidos y cobra),
**Barista** (prepara y descuenta inventario) y **Caja + barra** (`mostrador`),
para sedes donde la misma persona hace las dos cosas: entra una sola vez y
cambia entre Caja y Barra con un toque en la navegación, con contadores de
bebidas pendientes y pedidos por cobrar.

El frontend pide la sucursal al entrar (se la salta si solo hay una) y el
personal inicia sesión POR sede. Las garantías de aislamiento entre sedes se
verifican con `npm run test:multisucursal:live` (en `api/`, contra la API
corriendo) y con triggers de blindaje en la propia base de datos.

## Del inventario al menú, sin capturar precios a mano

Cada insumo se da de alta **una sola vez**; cada compra posterior se registra
como un **lote** de ese mismo insumo (botón "Registrar compra" en Inventario:
cantidad, costo, proveedor, lote y caducidad). El sistema descuenta por PEPS
(primero el lote más viejo), el costo real de cada venta usa el lote que de
verdad se consumió, y el costo de la última compra queda como costo de
referencia del insumo. Las correcciones de conteo físico se hacen con
"Ajustar stock" (con motivo) y las pérdidas con mermas — así el historial
explica cada movimiento.

Cada receta tiene dos capas: los **ingredientes base**, que se resuelven con lo
que el cliente pida (café por shot con gramaje editable por producto, leche por
tamaño —predeterminada de la sucursal o propia del producto— y vaso/tapa por
tamaño), y los **ingredientes fijos** del producto tomados del inventario
(jarabes, chocolate, toppings…). Las dos capas se ven en la receta que consulta
el barista y se editan desde Admin → Recetas → Editar receta.

El flujo está automatizado: alta de materia prima → receta con sus
ingredientes del inventario → el sistema calcula el costo prorrateado
(insumos + parte de renta/sueldos) → tú solo decides el margen (general de la
sucursal o propio del producto) y aplicas el precio sugerido con un clic → el
producto aparece en el menú de la app y en la **pantalla del negocio** (una
URL fija para la TV del local: `/?pantalla=menu&sucursal=<id>`, se actualiza
sola). La pantalla tiene dos estilos (Admin → Configuración → Pantalla del
negocio): **Pizarra** (oscuro y dorado, como un menú impreso: columnas por
categoría con la descripción corta de cada producto, precio normal tachado
cuando hay precio promocional, columna de extras, lema y pie configurables; sin
tamaños, el precio es el de la bebida estándar; se ajusta sola para caber en la
TV) y **Clásico**. La descripción corta y el precio promocional se capturan al
editar cada producto. Si un insumo sube de precio, el panel avisa qué productos repreciar —
el menú nunca cambia solo.

Los precios de la personalización (tamaños, tipo de café, tipo de leche y
extras: lo que el cliente ve como "+6") se ajustan en **Admin → Opciones**.
Cada opción muestra cuánto cuesta según el inventario (la leche entera y el
café tradicional son la base) y un ajuste sugerido con el margen de la
sucursal; el admin decide el ajuste final, puede crear nuevas leches, cafés y
extras (con el insumo y la porción que descuentan) y desactivar los que no
ofrezca. El cobro siempre usa estos ajustes en el servidor, y la pantalla del
negocio los muestra en la leyenda "Personaliza tu bebida".

La parte de renta/sueldos se configura en **Admin → Costos**: ahí se
capturan los gastos fijos mensuales de la sucursal (renta, personal,
servicios, transporte, seguros, mantenimiento) y las **unidades que esperas
vender al mes**. Costo indirecto por bebida = gastos fijos del mes ÷ unidades
estimadas; ese monto se suma al costo de receta en "Costo y precio". La misma
sección muestra el punto de equilibrio (cuántas bebidas al mes/día cubren los
gastos) y la venta real promedio para calibrar la estimación. Los montos que
trae la base de desarrollo son de ejemplo: sustitúyelos por los reales antes
de fijar precios.

## Frontend adaptable

`frontend/` es una app React (Vite) con un solo código para cualquier
pantalla: navegación inferior en el celular, riel de íconos en tablet y barra
lateral completa en escritorio (la caja, por ejemplo, muestra menú y carrito
lado a lado en pantallas grandes). `npm run dev` dentro de `frontend/` para
desarrollo (hace proxy de `/api` a la API local).

## Por qué no choca con tus otros proyectos en Docker

- Todo tiene nombre con el prefijo **`cafeteria-`**: el contenedor de la base
  de datos es `cafeteria-db`, el de la API `cafeteria-api`, la red
  `cafeteria-net`, el volumen `cafeteria_db_data`. Aunque tengas diez
  proyectos corriendo, `docker ps` / `docker network ls` / `docker volume ls`
  se entienden de un vistazo.
- Los puertos que se exponen a tu máquina son **configurables** (`DB_HOST_PORT`,
  `API_HOST_PORT` en `.env`). Si otro proyecto tuyo ya usa el 5432 o el 3000,
  solo cambias el número en `.env` — el contenedor sigue hablando con la API
  por dentro de la red de Docker sin que nada más se entere.
- La red `cafeteria-net` es propia de este proyecto; no comparte tráfico con
  las redes de tus otros `docker-compose` a menos que tú lo conectes a
  propósito.

## Abrir esto en VS Code

Con la extensión **Dev Containers** instalada, abre esta carpeta y elige
"Reabrir en contenedor". VS Code construye/levanta todo el `docker-compose`
y te deja editando *dentro* del contenedor de la API, con Postgres ya
disponible en `db:5432`. Cada Dev Container vive aislado por carpeta de
proyecto — abrir este no afecta ni se ve afectado por los devcontainers de
tus otros proyectos.

Si prefieres NO usar Dev Containers y solo trabajar con la extensión normal
de Docker en VS Code, `docker compose up` desde la terminal integrada hace
exactamente lo mismo.

## La ruta a AWS, cuando llegue el momento

Este `docker-compose.yml` es para **desarrollo local**. Para producción en
AWS, lo natural es:

1. **Base de datos → Amazon RDS para PostgreSQL**, no el contenedor `db`. Las
    migraciones (`db/00` a `db/12`) se corren UNA VEZ contra el endpoint de RDS
   (con `psql` desde una instancia con acceso, o con una tarea de ECS/Lambda
   de un solo uso) — el mecanismo de auto-inicio de `docker/00_roles_y_permisos.sh`
   solo aplica al contenedor local, RDS no lo usa.
2. **API → imagen del `Dockerfile` de `api/`, desplegada en ECS Fargate** (o
   en una instancia EC2 corriendo este mismo `docker compose up` con el
   archivo de producción, sin el `.override.yml` de desarrollo). El
   `Dockerfile` ya está pensado para esto: build multi-etapa, usuario sin
   privilegios, healthcheck — se traduce directo a una task definition de
   ECS.
3. **Secretos → AWS Secrets Manager o Parameter Store**, no un archivo `.env`
   en el servidor: `JWT_SECRET`, las contraseñas de Postgres, etc.
4. **SMS real → ya está listo**: `SMS_PROVIDER=sns` usa AWS SNS directamente
   (mismo SDK, misma cuenta de AWS que ya vas a tener para el hosting — no se
   necesita una cuenta de Twilio aparte). Con un rol de IAM adjunto al
   servicio de ECS, ni siquiera hacen falta credenciales explícitas.
5. **Red**: el API container expone `/health` — úsalo como health check del
   Application Load Balancer.

No construí la infraestructura de AWS en sí (Terraform / CloudFormation /
Copilot) porque depende de decisiones que son tuyas (VPC existente o nueva,
presupuesto, si quieres Fargate o EC2, etc.) — pero el Dockerfile y el diseño
de variables de entorno ya están hechos para que esa parte sea
configuración, no reescritura de código.

## ⚠️ Lo único que no pude probar en vivo

Construí y probé exhaustivamente la base de datos y la API con peticiones
HTTP reales (ver `api/README.md` y `db/README.md`). **Lo que no pude correr
en este entorno es `docker compose up` en sí** — el sandbox donde trabajo no
tiene Docker disponible (es, a su vez, un contenedor, y no tiene Docker
dentro). Validé la sintaxis de los YAML y el JSON del devcontainer
(son válidos), y el `Dockerfile`/`docker-compose.yml` siguen patrones
estándar y probados de la comunidad — pero te recomiendo que la primera vez
que hagas `docker compose up` en tu máquina, te quedes viendo los logs por si
algo necesita un ajuste fino que solo se ve corriendo de verdad.
