# Cafetería Móvil — proyecto completo

Backend completo (PostgreSQL + API REST en Node/Express) de la cafetería
móvil, ya listo para abrir como su propio proyecto en VS Code y correr en
Docker, sin pisar ningún otro proyecto que ya tengas corriendo en tu máquina.

```
.
├── docker-compose.yml            # Servicios: db (PostgreSQL) + api (Node)
├── docker-compose.override.yml   # Se combina solo: monta código fuente, recarga en vivo
├── .devcontainer/                # Configuración de VS Code Dev Containers
├── docker/00_roles_y_permisos.sh # Crea el rol de la API al iniciar el contenedor de Postgres
├── db/                           # Las mismas migraciones SQL (00-07), para correr sin Docker / contra AWS RDS
└── api/                          # Código fuente de la API (Node + Express)
```

## Arrancar con Docker (recomendado)

```bash
cp .env.example .env
# Edita .env: cambia las contraseñas y genera un JWT_SECRET real con:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up
```

Eso levanta PostgreSQL, le corre las 8 migraciones automáticamente (solo la
primera vez que crea su volumen de datos) y arranca la API en
`http://localhost:3000` con recarga en vivo (gracias a
`docker-compose.override.yml`, que Compose combina solo).

Usuarios de prueba (mismos PIN que el prototipo): Admin `1234`, Caja `1111`,
Barista `2222`.

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
   migraciones (`db/00` a `db/07`) se corren UNA VEZ contra el endpoint de RDS
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
