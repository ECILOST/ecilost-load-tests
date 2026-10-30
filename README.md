# ecilost-load-tests

Pruebas de rendimiento de ECILOST (k6 + Prometheus + Grafana) contra un entorno **local** en
Docker, con bases de datos aisladas para no tocar los datos de desarrollo. Documentacion completa
en `docs/` (`AUDITORIA.md`, `ESTRATEGIA.md`, `EJECUCION.md`).

El backlog no fija metas de rendimiento (supuesto A4: "no se inventa ningun SLA"). Por eso estas
pruebas **miden y reportan** latencias y capacidad, y solo hacen fallar una corrida por:

- el unico requisito con numero: **tiempo real < 1 segundo** (precio, contador y transicion de ronda);
- las garantias de concurrencia del dominio: un unico ganador, ECICoin nunca comprometidos dos
  veces, aforo nunca superado e historial de pujas estrictamente creciente (`scripts/verify.mjs`).

## Inicio rapido (solo Docker)

Requisitos: **Docker** (Desktop o Engine con Compose v2.20+) y los repos de ECILOST clonados en la
misma carpeta. No hace falta Node, k6, `npm install` ni los `.env` de los servicios.

```
ECILOST/
  ecilost-auth-service/   ecilost-catalog-service/   ecilost-wallet-service/
  ecilost-auction-service/   ecilost-engagement-service/
  ecilost-load-tests/      <- este repo
```

Desde `ecilost-load-tests`:

```bash
docker compose up -d --build --wait            # sistema + Prometheus + Grafana (primera vez: varios minutos)
docker compose run --rm runner smoke           # prueba de humo
docker compose run --rm runner load -- -e USERS=50
```

- Grafana: http://localhost:3300 (carpeta ECILOST; ver sin login, editar con admin/admin).
- Prometheus: http://localhost:9090.
- Resultados de cada corrida: `results/<escenario>-<fecha>-<runId>/` (`report.md`, `k6.txt`,
  `verify.txt`, `meta.json` con el enlace a Grafana en la ventana de la corrida).
- Con los limites de Azure Container Apps (0.25 vCPU / 0.5 GiB por servicio):
  `SERVICE_CPUS=0.25 SERVICE_MEMORY=512m docker compose up -d --build --wait`.
- Apagar: `docker compose down` (con `-v` borra bases y series).

Que hay en `docker-compose.yml`:

| Parte | Archivo | Contenido |
|---|---|---|
| Sistema bajo prueba | `compose/docker-compose.yml` | Postgres 17.11, RabbitMQ 4.3.6, Azurite, `keygen` y los cinco servicios construidos con su Dockerfile |
| Observabilidad | `observability/docker-compose.yml` | Prometheus, Grafana (tableros ya cargados), cAdvisor, postgres_exporter |
| Ejecutor | `docker-compose.yml` (`runner`, perfil `tools`) | Node 22 + k6 2.2.0 + cliente Docker (`docker/runner.Dockerfile`); corre `scripts/run.mjs` |

## Aislamiento

El entorno usa su propia infraestructura (proyecto `ecilost-load`) en puertos que no chocan con
desarrollo: Postgres en 55432, RabbitMQ en 55672 (consola en 55673). Los contenedores de
desarrollo (`ecilost-*-db`, `ecilost-rabbitmq`) no se tocan.

| Servicio | Base de carga | Esquema |
|---|---|---|
| auth | `ecilost_auth_load` | `auth` |
| catalog | `ecilost_catalog_load` | `catalog` |
| wallet | `ecilost_wallet_load` | `wallet` (sus migraciones lo escriben a mano) |
| auction | `ecilost_auction_load` | `auction` |
| engagement | `ecilost_engagement_load` | `public` (no le pasa esquema a su adaptador) |

Una base por servicio en un solo servidor, como Neon en Azure. Las bases se crean en el primer
arranque (`compose/postgres/init.sql`) y cada servicio aplica sus migraciones al arrancar. Los
servicios **no leen su `.env`**: el compose les da todo lo necesario con valores propios de la
carga (Google con valores de relleno, Azurite, `METRICS_ENABLED=true`). Los nombres de las bases
estan en `scripts/lib/config.mjs` y en el compose: si cambias uno, cambia el otro.

## Usuarios sinteticos

El login es solo con Google. El servicio `keygen` genera, la primera vez, un par de llaves RS256
**propio de la carga** en `.data/keys/` (`scripts/keys.mjs`); auth firma con ellas y
`scripts/tokens.mjs` firma con la misma llave los tokens de los estudiantes y el funcionario
sinteticos (mismo `kid`, issuer y audience que `TokenService`). No se usa la llave de desarrollo.
**Solo sirve en este entorno.** Llaves y tokens quedan en `.data/` (no se versiona).

## Sin Docker para el ejecutor (opcional)

Con Node 22 y k6 en el equipo se puede correr lo mismo fuera del contenedor, contra el entorno de
Docker: `npm install` y `node scripts/run.mjs smoke`. Para depurar un servicio fuera de Docker:
`docker compose up -d postgres rabbitmq azurite keygen`, `npm run migrate` (requiere `npm install`
en el repo del servicio) y `node scripts/start-service.mjs <servicio>`.

## Tableros

En la carpeta ECILOST de Grafana (`observability/grafana/dashboards`):

| Tablero | Para que |
|---|---|
| Correlacion (`ecilost-overview`) | Usuarios, latencia y tiempo real arriba; CPU, event loop, locks de Postgres y colas abajo, en la misma linea de tiempo |
| k6 (`ecilost-k6`) | VUs, peticiones, percentiles p50/p90/p95/p99 por endpoint, errores, checks, pujas por resultado y Socket.IO |
| Servicios (`ecilost-services`) | Lado servidor por ruta (desde `GET /metrics`), CPU, event loop, memoria, heap, GC |
| Infraestructura (`ecilost-infra`) | Disponibilidad, contenedores, Postgres (conexiones, locks, transacciones, consultas) y RabbitMQ |

Se generan con `node observability/grafana/build-dashboards.mjs`: los cambios se hacen ahi y se
regenera; Grafana relee los JSON solo. Los cambios hechos en la UI no se guardan.

## Escenarios k6

`scripts/run.mjs` (lo que corre `docker compose run --rm runner`) prepara datos nuevos, corre k6
con remote write a Prometheus (etiqueta `testid=<escenario>-<runId>`), verifica las garantias,
genera el informe y guarda todo en `results/`. Lo que va despues de `--` se pasa a k6:

```bash
docker compose run --rm runner stress -- -e STEPS=100,200,300
docker compose run --rm runner soak -- -e DURATION=60m
```

| Escenario | Que mide | Datos por defecto |
|---|---|---|
| `smoke` | scripts, datos y metricas funcionan (cero errores) | 5 estudiantes, 1 sala |
| `load` | carga nominal: `USERS` en sala (100) + `BROWSERS` (20), 10 min estable | 120, 2 salas |
| `stress` | escalones `STEPS` (50..400) hasta degradar, y recuperacion | 420, 2 salas |
| `stress-reads` | relecturas/s que aguanta la sala (modelo abierto, `RATES`) | 200, 1 sala |
| `spike` | `BASE` 10 -> `PEAK` 200 en 10 s y recuperacion | 200, 2 salas |
| `soak` | `USERS` 60 durante 45 min: fugas y deriva | 70, 1 sala |
| `bid-storm` | contencion de pujas sobre una ronda (`VUS`) | 100, 1 sala |

Estructura: `k6/lib` (configuracion, datos, API con checks, cliente Socket.IO, metricas y
umbrales), `k6/flows` (lo que hace cada tipo de usuario, segun el frontend) y `k6/scenarios`
(perfiles de carga). Los umbrales de `REQUIREMENT` son el requisito de tiempo real; los de
`REFERENCE` son valores propuestos para comparar corridas, no requisitos.

En `summary.json` de cada corrida, un umbral en `false` significa que **no** se cruzo
(se cumplio); k6 sale con 99 si alguno se cruzo.

Prueba de humo de la cadena completa, sin k6 (con Node en el equipo):

```bash
node scripts/tokens.mjs --students 5
node scripts/setup.mjs --scenario smoke --students 5 --starts-in 8 --wait-active
node scripts/smoke.mjs
node scripts/verify.mjs
```

### `setup.mjs`

Todo por las APIs de los servicios: billeteras (emision inicial y recarga opcional), objetos en
catalog, las salas con sus rondas y la admision previa. Deja `.data/run.json` para k6 y `verify.mjs`.

| Opcion | Por defecto | Para que |
|---|---|---|
| `--scenario` | `smoke` | Nombre de la corrida |
| `--students` | 5 | Estudiantes que participan (tokens de `tokens.mjs`) |
| `--rooms` | 1 | Salas; los estudiantes se reparten entre ellas |
| `--capacity` | estudiantes / salas | Aforo de cada sala |
| `--rounds` | 1 | Rondas (un objeto por ronda) |
| `--starting-price` | 100 | Precio minimo de cada ronda |
| `--buy-now` | sin compra inmediata | Precio de compra inmediata de cada ronda |
| `--recharge` | 0 | Recarga de staff por estudiante, para pujas grandes |
| `--starts-in` | 20 | Segundos hasta que la sala se abre sola |
| `--admit false` | se admite | No admitir (para medir la admision con k6) |
| `--wait-active` | no | Esperar a que el reloj del servidor abra la sala |

Una ronda dura 3 minutos (8 como maximo con anti-sniping): las corridas largas usan salas con
varias rondas (ver `DEFAULTS` en `scripts/run.mjs`).

### `verify.mjs`

Consultas de solo lectura sobre las bases de carga, limitadas a la sala de la corrida. Cada
comprobacion termina en `OK`, `AVISO` (esperable pero conviene mirarlo, por ejemplo reservas de
superados que se liberan al liquidar) o `FALLA`; con alguna `FALLA` sale con codigo 1.

## Empezar de cero

Las bases de carga son solo de esta prueba. `docker compose down -v` borra bases y series;
`docker compose up -d --build --wait` las crea de nuevo. Para llaves nuevas, borrar tambien
`.data/`. Las bases de desarrollo no se tocan.
