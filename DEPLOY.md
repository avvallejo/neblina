# Despliegue a producción — AWS + Docker + HTTPS

Guía paso a paso para poner la **Cafetería Móvil** en un servidor de AWS, en un
solo servidor con Docker, con dominio y HTTPS, y despliegues automáticos por
versión (tags) desde GitHub.

> Pensado para poder **separar la base de datos** después (a su propio servidor
> o a Amazon RDS) sin reescribir nada — ver la Parte 8.

---

## Cómo queda (arquitectura)

Un solo servidor EC2 corriendo `docker compose -f docker-compose.prod.yml`:

```
Internet ──HTTPS──▶  [ web (Caddy) ]  ──/api──▶  [ api (Node) ]  ──▶  [ db (PostgreSQL) ]
                      sirve el sitio                 interno              interno (sin
                      + saca el certificado          (puerto 3000)        puerto al exterior)
```

- **web**: Caddy sirve el frontend ya compilado, reenvía `/api` a la API y
  obtiene/renueva el certificado HTTPS solo (Let's Encrypt). Únicos puertos
  abiertos al mundo: **80 y 443**.
- **api**: Node/Express, solo accesible por dentro de la red de Docker.
- **db**: PostgreSQL, solo accesible por dentro; sus datos viven en un volumen.

**Flujo de despliegue una vez configurado:** creas un tag de versión y lo
empujas → una GitHub Action entra por SSH al servidor, baja ese tag y reconstruye
los contenedores. Nada más.

---

## Parte 1 — Subir el proyecto a GitHub (la cuenta nueva)

El repo ya está versionado localmente (tiene commits y un esquema de versiones).
Solo hay que conectarlo a un repo nuevo en la otra cuenta.

1. **En la OTRA cuenta de GitHub**, crea un repositorio **vacío** (sin README ni
   .gitignore), por ejemplo `cafeteria-movil`. Anota su URL.

2. **Autenticación de esa cuenta** (elige una):
   - **Token (HTTPS, lo más simple):** en esa cuenta → *Settings → Developer
     settings → Personal access tokens → Fine-grained tokens* → crea uno con
     permiso *Contents: Read and write* sobre ese repo. Lo usarás como
     contraseña al hacer `git push`.
   - **SSH:** genera una llave para esa cuenta y agrégala en *Settings → SSH keys*.

3. **En tu máquina**, en `/Users/vallejoan/cafeteria-movil`:
   ```bash
   git remote add origin https://github.com/LA-OTRA-CUENTA/cafeteria-movil.git
   git push -u origin main        # usa el token como contraseña
   git push origin --tags         # sube los tags de versión existentes
   ```
   > Si ya existe un `origin`, usa `git remote set-url origin <url>`.

4. **Versionado** (igual que tu proyecto anterior): cada release es un tag
   `vMAYOR.MENOR.PARCHE`, p. ej. `v1.0.0`. Empujar un tag es lo que dispara el
   despliegue (Parte 5).

---

## Parte 2 — Crear el servidor en AWS (desde cero)

1. **Cuenta AWS:** si no tienes, créala en https://aws.amazon.com (necesita
   tarjeta; hay capa gratuita). Inicia sesión en la consola.

2. **Lanzar la instancia EC2:**
   - Servicio **EC2** → *Launch instance*.
   - **Nombre:** cafeteria-movil.
   - **Imagen (AMI):** *Ubuntu Server 24.04 LTS*.
   - **Tipo:** **t3.small** (2 GB RAM; el `t2.micro` gratuito se queda corto al
     compilar la imagen del frontend).
   - **Par de llaves:** *Create new key pair* → descarga el `.pem` (te conectarás
     con él). Guárdalo bien.
   - **Almacenamiento:** 20 GB.

3. **Security group (firewall) — reglas de entrada:**
   | Tipo  | Puerto | Origen        | Para qué              |
   |-------|--------|---------------|-----------------------|
   | SSH   | 22     | *Mi IP*       | conectarte tú         |
   | HTTP  | 80     | 0.0.0.0/0     | HTTP + reto del cert  |
   | HTTPS | 443    | 0.0.0.0/0     | la app                |

   > **No** abras el 5432 (la base de datos queda interna).

4. **IP fija (Elastic IP):** EC2 → *Elastic IPs* → *Allocate* → *Associate* a la
   instancia. Así la IP no cambia al reiniciar (la necesitas para el DNS).

5. **Conéctate por SSH** (desde tu máquina):
   ```bash
   chmod 400 ~/Descargas/cafeteria-movil.pem
   ssh -i ~/Descargas/cafeteria-movil.pem ubuntu@TU_ELASTIC_IP
   ```

6. **Instala Docker** (ya conectado al servidor):
   ```bash
   sudo apt-get update && sudo apt-get install -y ca-certificates curl git
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker ubuntu        # para no usar sudo con docker
   exit                                   # sal y vuelve a entrar por SSH para que aplique
   ```
   Reconéctate y verifica: `docker compose version`.

---

## Parte 3 — Apuntar el dominio (DNS) y HTTPS

1. En tu proveedor de dominios (donde compraste el dominio), crea un **registro A**:
   - **Nombre:** `cafeteria` (quedaría `cafeteria.tudominio.com`) — o `@` para el
     dominio raíz.
   - **Valor:** tu **Elastic IP**.
2. Espera unos minutos a que propague (`ping cafeteria.tudominio.com` debe
   responder con tu IP).
3. No tienes que hacer nada más para el certificado: **Caddy lo saca solo** la
   primera vez que levantes (Parte 4), porque el dominio ya apunta al servidor y
   los puertos 80/443 están abiertos.

---

## Parte 4 — Primer despliegue (manual, una sola vez)

En el servidor (por SSH):

1. **Dale acceso de lectura al repo** (si es privado). Lo más limpio es una
   *deploy key* de solo lectura:
   ```bash
   ssh-keygen -t ed25519 -C "deploy-cafeteria" -f ~/.ssh/deploy_cafeteria -N ""
   cat ~/.ssh/deploy_cafeteria.pub
   ```
   Copia esa llave pública y pégala en el repo de GitHub → *Settings → Deploy
   keys → Add deploy key* (solo lectura). Luego configura git para usarla:
   ```bash
   echo "Host github-cafeteria
     HostName github.com
     User git
     IdentityFile ~/.ssh/deploy_cafeteria" >> ~/.ssh/config
   ```

2. **Clona el proyecto** en `/opt`:
   ```bash
   sudo mkdir -p /opt/cafeteria-movil && sudo chown ubuntu:ubuntu /opt/cafeteria-movil
   git clone git@github-cafeteria:LA-OTRA-CUENTA/cafeteria-movil.git /opt/cafeteria-movil
   cd /opt/cafeteria-movil
   ```

3. **Configura los secretos del entorno:**
   ```bash
   cp .env.prod.example .env.prod
   nano .env.prod
   ```
   Cambia: `DOMAIN`, `ACME_EMAIL`, las dos contraseñas de Postgres, `CORS_ORIGIN`
   (= `https://tudominio`), y genera el `JWT_SECRET`:
   ```bash
   openssl rand -hex 48      # pega el resultado en JWT_SECRET=
   ```

4. **Levanta todo:**
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   ```

5. **Verifica:**
   ```bash
   docker compose -f docker-compose.prod.yml ps          # los 3 servicios "Up"
   docker compose -f docker-compose.prod.yml logs -f web  # Caddy obteniendo el certificado
   ```
   Abre **https://cafeteria.tudominio.com** — debe cargar con el candado de HTTPS.
   Entra con PIN de Admin `1234` (¡cámbialo!).

---

## Parte 5 — Despliegues automáticos por tag (GitHub Actions)

La Action `.github/workflows/deploy.yml` ya está en el repo. Solo faltan los
secretos.

1. **Llave SSH para que la Action entre al servidor.** En tu máquina genera un
   par dedicado y autoriza la pública en el servidor:
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/gha_deploy -N ""
   ssh-copy-id -i ~/gha_deploy.pub ubuntu@TU_ELASTIC_IP   # o pega ~/gha_deploy.pub en ~/.ssh/authorized_keys del server
   ```

2. **En el repo de GitHub** → *Settings → Secrets and variables → Actions → New
   repository secret*, crea estos 4:
   | Secreto    | Valor                                              |
   |------------|----------------------------------------------------|
   | `SSH_HOST` | tu Elastic IP (o el dominio)                       |
   | `SSH_USER` | `ubuntu`                                           |
   | `SSH_KEY`  | **contenido completo** de `~/gha_deploy` (la privada) |
   | `APP_DIR`  | `/opt/cafeteria-movil`                             |

3. **Desplegar una versión nueva** (desde tu máquina):
   ```bash
   git tag v1.0.1 -m "Descripción del cambio"
   git push origin v1.0.1
   ```
   En *Actions* del repo verás el despliegue. La Action entra al servidor, hace
   `git checkout v1.0.1` y reconstruye los contenedores.

---

## Parte 6 — Operación diaria

```bash
cd /opt/cafeteria-movil
# Ver logs
docker compose -f docker-compose.prod.yml logs -f api
# Reiniciar / reconstruir a mano
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# Si dejaste SMS en modo "console", el código de verificación sale aquí:
docker logs cafeteria-api | grep -i código
```

**Respaldos de la base de datos** (recomendado desde el día 1) — un cron diario:
```bash
docker exec cafeteria-db pg_dump -U postgres cafeteria | gzip > ~/backup-$(date +%F).sql.gz
```

---

## Parte 7 — Apagar la verificación por SMS (o prenderla)

Por defecto el alta de clientes es directa (sin SMS). Para exigir SMS: entra como
Admin → *Acceso de clientes* → activa "Verificación por SMS". Si lo activas,
configura `SMS_PROVIDER=sns` en `.env.prod` y reinicia (necesita credenciales de
AWS SNS en el servidor).

---

## Parte 8 — Separar la base de datos después (a RDS u otro servidor)

El día que el cliente quiera la base en su propio servidor o en Amazon RDS:

1. Crea la instancia (p. ej. **RDS PostgreSQL 16**) y anota su endpoint.
2. Corre las migraciones una vez contra ese endpoint, en orden:
   ```bash
   for f in db/00_roles_y_permisos.sql db/01_schema.sql db/02_functions_triggers.sql \
            db/03_seed_data.sql db/04_views.sql db/05_mejoras_produccion.sql \
            db/06_costos_indirectos.sql db/07_verificacion_y_sync.sql \
            db/08_configuracion.sql db/09_tiempo_extraccion_por_tipo.sql; do
     psql "postgres://postgres:CLAVE@ENDPOINT_RDS:5432/cafeteria" -f "$f"
   done
   ```
   (El `00_roles` crea el rol `cafeteria_app`; ajusta la contraseña antes.)
3. En `.env.prod`, descomenta y apunta `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE` al
   endpoint de RDS.
4. Quita (o deja de usar) el servicio `db` del `docker-compose.prod.yml`.
5. `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d`.

La API no cambia: solo lee `PGHOST` del entorno. Por eso "está en el mismo
servidor hoy" y "puede vivir aparte mañana" sin tocar código.
