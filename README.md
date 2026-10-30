# ecilost-load-tests

Pruebas de carga de ECILOST contra el entorno **local** (Docker), con bases de datos aisladas
para no tocar los datos de desarrollo.

El backlog no fija metas de rendimiento (supuesto A4: "no se inventa ningun SLA"). Por eso estas
pruebas **miden y reportan** latencias y capacidad, y solo hacen fallar una corrida por:

- el unico requisito con numero: **tiempo real < 1 segundo** (precio, contador y transicion de ronda);
- las garantias de concurrencia del dominio: un unico ganador, ECICoin nunca comprometidos dos
  veces, aforo nunca superado e historial de pujas estrictamente creciente (`scripts/verify.mjs`).

## Aislamiento

El sistema completo corre en Docker con su propia infraestructura (`compose/docker-compose.yml`,
proyecto `ecilost-load`): un Postgres 17 (puerto 55432), RabbitMQ (55672, consola en 55673) y
Azurite. Los contenedores de desarrollo (`ecilost-*-db`, `ecilost-rabbitmq`) no se tocan.

| Servicio | Base de carga | Esquema |
|---|---|---|
| auth | `ecilost_auth_load` | `auth` |
| catalog | `ecilost_catalog_load` | `catalog` |
| wallet | `ecilost_wallet_load` | `wallet` (sus migraciones lo escriben a mano) |
| auction | `ecilost_auction_load` | `auction` |
| engagement | `ecilost_engagement_load` | `public` (no le pasa esquema a su adaptador) |

Una base por servicio en un solo servidor, como Neon en Azure. Los servicios se construyen con su
propio Dockerfile y leen su `.env`; el compose solo reemplaza lo que apunta a `localhost`
(base, broker, JWKS, Azurite) y activa `METRICS_ENABLED`. Los nombres de las bases estan en
`scripts/lib/config.mjs` y en el compose: si cambias uno, cambia el otro.

## Usuarios sinteticos

El login es solo con Google. `scripts/tokens.mjs` firma tokens con la **llave privada local** de
ecilost-auth-service y el mismo `kid`, issuer y audience que su `TokenService`, asi que los
servicios los aceptan al verificarlos contra el JWKS local. La llave se lee del `.env` de auth y no
se copia ni se imprime. **Solo sirve en local.** Los tokens quedan en `.data/` (no se versiona).

## Requisitos

- Node 22 o superior y Docker Desktop.
- Los repos de los servicios junto a este (`../ecilost-<servicio>-service`) con su `.env` y
  `npm install` hecho (las migraciones se aplican con su Prisma CLI).
- [k6](https://k6.io) para los escenarios de carga (`winget install k6 --source winget`).

## Uso

```bash
npm install
npm run stack:infra                 # Postgres, RabbitMQ y Azurite de la carga
npm run migrate                     # crea/actualiza las bases *_load (se puede repetir)
npm run stack:up                    # construye y levanta los cinco servicios (espera healthy)
```

`npm run stack:up:azure` levanta los servicios con los limites de Azure Container Apps
(0.25 vCPU, 0.5 GiB). `npm run stack:down` los apaga sin borrar los volumenes.
`node scripts/start-service.mjs <servicio>` sigue sirviendo para depurar un servicio fuera de
Docker contra la misma infraestructura.

Observabilidad (Prometheus en `localhost:9090`, Grafana en `localhost:3300`):

```bash
npm run obs:up
```

Tableros en la carpeta ECILOST de Grafana (`observability/grafana/dashboards`):

| Tablero | Para que |
|---|---|
| Correlacion (`ecilost-overview`) | Usuarios, latencia y tiempo real arriba; CPU, event loop, locks de Postgres y colas abajo, en la misma linea de tiempo |
| k6 (`ecilost-k6`) | VUs, peticiones, percentiles p50/p90/p95/p99 por endpoint, errores, checks, pujas por resultado y Socket.IO |
| Servicios (`ecilost-services`) | Lado servidor por ruta (desde `GET /metrics`), CPU, event loop, memoria, heap, GC |
| Infraestructura (`ecilost-infra`) | Disponibilidad, contenedores, Postgres (conexiones, locks, transacciones, consultas) y RabbitMQ |

Se generan con `node observability/grafana/build-dashboards.mjs`: los cambios se hacen ahi y se
regenera; Grafana relee los JSON solo. Los cambios hechos en la UI no se guardan.

### Escenarios k6

`scripts/run.mjs` prepara datos nuevos, corre k6 con remote write a Prometheus (etiqueta
`testid=<escenario>-<runId>`), verifica las garantias y guarda todo en `results/`:

```bash
node scripts/run.mjs smoke
node scripts/run.mjs load -- -e USERS=50
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

Prueba de humo de la cadena completa, sin k6:

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

Las bases de carga son solo de esta prueba. `docker compose -f compose/docker-compose.yml down -v`
borra sus volumenes; despues `npm run stack:infra` y `npm run migrate`. Las bases de desarrollo no
se tocan.
