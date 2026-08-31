# Plan de migración a multi-sucursal — Cafetería Móvil

**Fecha:** 30 de agosto de 2026
**Alcance decidido:** 2–5 sucursales, una sola base de datos. Catálogo (productos, recetas, precios, opciones) **por sucursal**. Clientes y fidelidad **por sucursal**.

Esa combinación de decisiones tiene una consecuencia muy favorable: como *todo* es por sucursal, el modelo es en la práctica "aislamiento por tenant con `sucursal_id`", y los triggers de inventario y las funciones de costos casi no cambian — solo hay que garantizar que cada fila sepa a qué sucursal pertenece y que la API nunca cruce datos de una sede con otra.

---

## Fase 1 — Base de datos: migración `db/12_multisucursal.sql`

Una sola migración nueva, idempotente como las demás, con este orden interno:

### 1.1 Tabla madre y sucursal semilla

```sql
CREATE TABLE sucursales (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT NOT NULL UNIQUE,
  prefijo_folio TEXT NOT NULL UNIQUE,     -- p. ej. 'S1', 'S2' → folios 'S1-P-104'
  activo     BOOLEAN NOT NULL DEFAULT true,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sucursales (nombre, prefijo_folio) VALUES ('Principal', 'S1');
```

Todo lo existente se rellena (backfill) apuntando a `Principal`, así la migración corre sobre una base con datos reales sin perder nada.

### 1.2 Columna `sucursal_id` — tablas operativas

Agregar `sucursal_id UUID NOT NULL REFERENCES sucursales(id)` (con backfill a `Principal` antes del `SET NOT NULL`) en:

| Tabla | Nota |
|---|---|
| `turnos` | ver 1.4: cambia el índice de turno único |
| `pedidos` | + índice `(sucursal_id, creado_en)` |
| `clientes` | `telefono` deja de ser UNIQUE global → `UNIQUE (sucursal_id, telefono)` |
| `mermas` | |
| `lotes` | hereda de la materia prima, pero llevarla explícita simplifica reportes |
| `movimientos_inventario` | |
| `gastos_fijos` | la renta de cada sede es distinta |
| `verificaciones_telefono` | el código SMS se valida por sede: `(sucursal_id, telefono)` |
| `auditoria` | nullable aquí (acciones globales de un admin general) |

`pedido_items`, `pedido_item_extras`, `receta_insumos_fijos` y `aprobaciones_descuento` **no** necesitan columna: heredan sucursal vía su FK padre (pedido, receta, pedido).

### 1.3 Columna `sucursal_id` — catálogo por sucursal

Mismo patrón en: `productos`, `categorias_producto`, `materias_primas`, `categorias_materia_prima`, `proveedores`, `opciones_tamano`, `opciones_leche`, `opciones_cafe`, `opciones_extra`, `promociones_apertura`, `promocion_fidelidad`, `configuracion_margen` y `configuracion`.

Los UNIQUE globales de nombre/código pasan a compuestos:

- `productos.nombre`, `materias_primas` etc. → `UNIQUE (sucursal_id, nombre)`
- `opciones_*.codigo` → `UNIQUE (sucursal_id, codigo)`
- `configuracion.clave` → `UNIQUE (sucursal_id, clave)` (nombre y logo por sede)
- `configuracion_margen` y `promocion_fidelidad`: una fila por sucursal

`recetas` no cambia: su `producto_id UNIQUE` ya la ata a un producto que ahora es de una sede. `tamano_empaque` y `tamano_leche_cantidad` heredan de `opciones_tamano`.

**Guardia de integridad cruzada** (el único riesgo real del diseño por herencia): un trigger `fn_validar_misma_sucursal()` en `receta_insumos_fijos` y en `pedido_items` que verifique que la materia prima / el producto pertenece a la misma sucursal que la receta / el pedido. Barato y elimina toda una clase de bugs.

### 1.4 Reemplazos de reglas "hay una sola cafetería"

```sql
-- Antes: solo un turno abierto en TODO el sistema
DROP INDEX uq_un_turno_abierto;
CREATE UNIQUE INDEX uq_un_turno_abierto_por_sucursal
  ON turnos (sucursal_id) WHERE cerrado_en IS NULL;
```

**Folios por sucursal:** quitar el `DEFAULT` con secuencia global de `pedidos.folio`. Nuevo trigger `BEFORE INSERT ON pedidos` que crea/usa una secuencia por sede (`pedidos_folio_seq_<prefijo>`) y arma `folio = prefijo_folio || '-P-' || nextval(...)`. Los folios existentes no se tocan (siguen siendo únicos).

**`fn_asignar_turno_abierto()`:** el `SELECT` del turno abierto ahora filtra `WHERE sucursal_id = NEW.sucursal_id AND cerrado_en IS NULL`.

Los triggers de inventario (`fn_descontar_inventario`, `fn_consumir_insumo`, `fn_registrar_merma`) y las funciones de costos/precios (`fn_costo_teorico_producto`, `fn_precio_efectivo`, `fn_precio_sugerido`, `fn_resetear_receta`) **no cambian**: operan sobre IDs concretos de materias/productos que ya son de una sola sede. Solo `fn_precio_sugerido` ajusta su lectura de `configuracion_margen`/`gastos_fijos` para tomar la fila de la sucursal del producto.

### 1.5 Vistas (`db/04_views.sql` y `05`)

Recrear las vistas agregando `sucursal_id` a la salida y al `GROUP BY`: `vw_stock_bajo`, `vw_ventas_por_metodo_pago`, `vw_productos_mas_vendidos`, `vw_cancelaciones_no_show`, `vw_mermas_por_motivo`, `vw_costo_real_por_venta`, `vw_pedidos_con_estado`, `vw_ventas_reales_promedio_mes` (esta última en `06`). `vw_kpis_turno_actual` pasa a devolver una fila **por sucursal** con turno abierto (la API filtra la suya).

### 1.6 Usuarios y semillas

- `usuarios.sucursal_id UUID NULL REFERENCES sucursales(id)`: **NOT NULL vía CHECK para cajero y barista; NULL permitido solo para admin** = "admin general" con acceso a todas las sedes. Con 2–5 sucursales esto evita la tabla puente `usuario_sucursales`; si algún día un cajero trabaja en dos sedes, ahí sí se agrega la puente.
- `03_seed_data.sql` (solo dev): asignar los usuarios de prueba y todo el catálogo semilla a `Principal`.
- `api/scripts` `bootstrap:admin`: crea el admin con `sucursal_id = NULL` (general) y, si no existe, la sucursal `Principal`.

---

## Fase 2 — API: autenticación y contexto de sucursal

### `api/src/middleware/auth.js`
- El JWT de staff agrega `suc` (sucursal del usuario, o `null` si es admin general). El de cliente agrega `suc` siempre.
- `requireAuth` valida contra BD como hoy y deja `req.auth.sucursalId`.
- Nuevo middleware `resolveSucursal`: para usuarios con sede fija, es la del token y **se ignora cualquier otra**; para admin general, se toma del header `X-Sucursal-Id` (o query `?sucursal=`) y se valida que exista y esté activa. Deja `req.sucursalId`. Toda ruta de datos lo usa.

### `api/src/routes/auth.js`
- **Login staff:** la pantalla de login pide sucursal (lista pública `GET /api/sucursales`); el `SELECT` de PINs compara solo contra usuarios de esa sede **más** los admin generales. Beneficio extra: el barrido de bcrypt deja de crecer con el total de empleados de todas las sedes, y un mismo PIN puede existir en dos sedes sin ambigüedad.
- **Cliente:** `solicitar-codigo`, `verificar-codigo` y `registro` reciben `sucursalId`; la unicidad del teléfono y el rate-limit por teléfono operan por sede. El token de cliente queda atado a su sucursal.

### Nueva ruta `api/src/routes/sucursales.js`
`GET /` público (nombre e id, para el selector), `POST/PATCH` solo admin general (crear sede genera su secuencia de folios, su fila de `configuracion_margen` y `promocion_fidelidad`).

---

## Fase 3 — API: rutas de datos (el grueso, mecánico)

Patrón único: cada `SELECT/INSERT/UPDATE` agrega `sucursal_id = $n` con `req.sucursalId`. Por archivo:

| Archivo | Cambios concretos |
|---|---|
| `turnos.js` | `/estado` recibe `?sucursal=` (público, para la app cliente); abrir/cerrar/kpis usan `req.sucursalId`. Desaparece el 409 "ya hay un turno abierto" *entre sedes*. |
| `pedidos.js` | crear pedido con `sucursal_id`; listados y `/:id` filtrados; `aprobaciones-descuento` valida que autorizador y pedido sean de la misma sede (o admin general). |
| `pedidoItems.js` | `/cola` del barista filtrada por su sede (JOIN a pedidos). |
| `materias.js` | todos los endpoints + `ajustar-stock` y `lotes` filtrados; `stock-bajo` usa la vista con filtro. |
| `productos.js`, `recetas.js`, `opciones.js`, `proveedores.js` | CRUD filtrado por sede; validaciones de catálogo (`catalogValidation.js`) verifican pertenencia a la misma sede. |
| `promociones.js` | fidelidad, apertura, margen y punto de equilibrio: una configuración por sede. |
| `gastosFijos.js` | filtrado por sede. |
| `mermas.js` | inserta con `sucursal_id`. |
| `clientes.js` | alta en mostrador usa la sede del cajero; `/yo` ya viene atado por el token. |
| `reportes.js` | cada reporte filtra por `req.sucursalId`; **nuevo** `?consolidado=true` (solo admin general) que agrupa por sucursal para comparativos. |
| `config.js` | lee/escribe la config de la sede; el `GET` público recibe `?sucursal=`. |
| `sync.js` | cada operación del lote se ejecuta con la sucursal del token del dispositivo; los `client_uuid` siguen siendo globalmente únicos, así que la idempotencia no cambia. |
| `usuarios.js` | alta exige sede para cajero/barista; un admin de sede (si se usa `admin` con sede fija) solo administra usuarios de su sede. |
| `services/*` | `orderValidation`, `customerRegistration`, `discountApprovals` reciben `sucursalId` y lo propagan en sus queries. |

---

## Fase 4 — Frontend (`frontend/src/App.jsx` + `api/client.js`)

1. **`client.js`:** guarda la sucursal activa y la manda en `X-Sucursal-Id`.
2. **Login de personal:** selector de sucursal antes del PIN (se recuerda por dispositivo, p. ej. la tablet de la sede 2 queda fija).
3. **App del cliente:** al registrarse elige sucursal; `BootScreen` consulta `/turnos/estado?sucursal=` y `/config?sucursal=` de *su* sede.
4. **Vista admin:** para admin general, un switcher de sucursal en la cabecera (recarga catálogo/inventario/reportes de la sede elegida) + una pestaña "Comparativo" con el endpoint consolidado.
5. Caja y barista no ven ningún cambio más allá del login: su mundo ya es su sede.

---

## Fase 5 — Pruebas y despliegue

- **Tests (`api/test`):** actualizar fixtures para crear 2 sucursales y agregar los casos que definen multi-sucursal: dos turnos abiertos a la vez (uno por sede) ✔; pedido de la sede A no descuenta stock de la sede B ✔; mismo teléfono de cliente registrado en ambas sedes ✔; cajero de A recibe 403 al tocar un pedido de B ✔; folios no chocan entre sedes ✔; sync batch de un dispositivo de A solo escribe en A ✔.
- **Despliegue:** la migración `12` es compatible con datos existentes (backfill a `Principal`); correrla igual que las demás (auto-init en Docker local; una vez contra RDS en prod). Los tokens vigentes al momento del deploy no traen `suc` → basta subir `token_version` de todos los usuarios (o dejar que expiren en 12 h) para forzar re-login.
- **Riesgo principal a vigilar:** cualquier query nueva que se olvide del filtro. Mitigación: hacer que `resolveSucursal` sea obligatorio en los routers de datos (montado a nivel router, como hoy `requireAuth`) y que los tests de aislamiento cubran cada recurso.

## Orden de trabajo sugerido

| Paso | Entregable | Tamaño relativo |
|---|---|---|
| 1 | Migración `12_multisucursal.sql` + vistas + seeds | ~30 % |
| 2 | Auth + middleware + ruta `sucursales` | ~15 % |
| 3 | Rutas de datos (patrón mecánico, archivo por archivo) | ~30 % |
| 4 | Frontend (selectores, switcher admin, comparativo) | ~15 % |
| 5 | Tests de aislamiento + ajuste de docs (README, DEPLOY) | ~10 % |

Los pasos 1→2→3 son estrictamente secuenciales; 4 puede empezar en paralelo con 3 una vez que auth ya devuelve sucursal.
