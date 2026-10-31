# Como reproducir las pruebas e interpretar los resultados

## 1. Requisitos

- Docker (Desktop o Engine) con Compose v2.20 o superior (`docker compose version`).
- Los repos de los cinco servicios clonados junto a este (`../ecilost-<servicio>-service`), en
  la rama que se quiere medir. No hacen falta sus `.env` ni `npm install`: el compose construye
  cada servicio con su Dockerfile y le da su configuracion de carga.
- Los servicios deben incluir `src/observability/metrics.ts` (metricas en `GET /metrics`).
- Puertos libres en el equipo: 3000-3005, 3300, 9090, 55432, 55672, 55673.
- Si `DOCKER_HOST` apunta a un daemon que no existe, quitarlo.

## 2. Levantar el entorno

```bash
docker compose up -d --build --wait
```

Construye las cinco imagenes y el ejecutor, crea las bases (primer arranque), genera las llaves de
la carga (`keygen`), aplica las migraciones de cada servicio y levanta Prometheus, Grafana,
cAdvisor y postgres_exporter. `--wait` vuelve cuando todo esta sano.

Comprobaciones rapidas:
- `docker compose ps`: los servicios `healthy`; `keygen` termina con `Exited (0)`.
- http://localhost:9090/targets: 10 targets `UP`.
- Grafana http://localhost:3300 -> carpeta ECILOST (sin login para ver; admin/admin para editar).

Con limites de Azure (0.25 vCPU / 0.5 GiB por servicio):
`SERVICE_CPUS=0.25 SERVICE_MEMORY=512m docker compose up -d --build --wait` (en PowerShell:
`$env:SERVICE_CPUS='0.25'; $env:SERVICE_MEMORY='512m'` antes del comando).

Despues de cambiar codigo de un servicio, el mismo `docker compose up -d --build --wait` lo
reconstruye. Despues de cambiar `observability/prometheus/prometheus.yml`:
`docker compose restart prometheus`.

## 3. Correr un escenario

```bash
docker compose run --rm runner smoke
docker compose run --rm runner load -- -e USERS=50
docker compose run --rm runner stress -- -e STEPS=100,200,300
```

El ejecutor (`runner`) es Node 22 + k6 2.2.0 en la red del proyecto: llega a los servicios y a
Prometheus por nombre y escribe en `.data/` y `results/` del repo. Con Node y k6 en el equipo
tambien vale `node scripts/run.mjs <escenario>` (mismos argumentos).

`run.mjs` hace, en orden: tokens si faltan, vencen en < 90 min o la llave cambio, datos nuevos
(`setup.mjs --wait-active`), k6 con remote write y `testid=<escenario>-<runId>`, `verify.mjs`,
`report.mjs`, y guarda todo.
Lo que va despues de `--` se pasa a k6 (variables `-e`). Variables por escenario:

Con los valores por defecto load, stress, stress-reads, spike y soak duran 10 min cada uno (k6
agrega hasta 30 s al final para cerrar sesiones); smoke ~1.5 min y bid-storm 90 s.

| Escenario | Variables (por defecto) |
|---|---|
| todos los de sala | `BIDDER_RATIO` (0.3), `AUTOBID_RATIO` (0.1), `THINK_MIN`/`THINK_MAX` (3/10 s), `SESSION_MIN`/`SESSION_MAX` (180/420 s) |
| smoke | `DURATION` (90s), `VIEWERS` (2), `BIDDERS` (2), `BROWSERS` (1) |
| load | `USERS` (100), `BROWSERS` (20), `RAMP` (2m), `HOLD` (7m) |
| stress | `STEPS` (50,...,400), `STEP_RAMP` (20s), `STEP_HOLD` (1m), `RECOVERY_USERS` (25), `RECOVERY` (1m20s), `BROWSERS` (20) |
| stress-reads | `RATES` (10,...,400), `STEP` (1m45s), `MAX_VUS` (200) |
| spike | `BASE` (10), `PEAK` (200), `SPIKE_RAMP` (10s), `SPIKE_HOLD` (2m), `RECOVERY` (4m40s) |
| soak | `USERS` (60), `BROWSERS` (10), `DURATION` (8m30s) |
| bid-storm | `VUS` (25), `THINK` (1), `DURATION` (90s) |

Si un escenario pide mas VUs que estudiantes, falla al inicio: subir `--students` en `run.mjs`.

## 4. Que queda en `results/<escenario>-<fecha>-<runId>/`

| Archivo | Contenido |
|---|---|
| `report.md` | **informe de la corrida**: umbrales, garantias, latencias por endpoint y de tiempo real, curva por minuto usuario contra servidor, maximos de CPU/memoria/event loop, Postgres y RabbitMQ (`scripts/report.mjs`, se puede regenerar) |
| `meta.json` | escenario, `testid`, inicio/fin, codigos de salida y el **enlace a Grafana** con la ventana y el testid de la corrida |
| `k6.txt` | resumen de k6 (umbrales con ✓/✗, percentiles, contadores) |
| `summary.json` | lo mismo en JSON; **un umbral en `false` = cumplido** (convencion de k6) |
| `verify.txt` | garantias de dominio: OK / AVISO / FALLA |
| `run.json` | salas, rondas y estudiantes de la corrida |
| `logs/<servicio>.log` | logs de cada servicio durante la corrida |

Codigos de salida de k6: 0 = todo bien, 99 = algun umbral no se cumplio, 108 = cortado por
`abortOnFail`.

## 5. Como interpretar

1. **Veredicto**: `k6.txt` (umbrales) y `verify.txt` (dinero y orden). Un AVISO en verify suele
   ser una ronda aun abierta o una liquidacion pendiente: se vuelve a correr
   `node scripts/verify.mjs --run results/<corrida>/run.json` cuando la sala cierra.
2. **Donde empieza a degradarse**: tablero Correlacion, panel "Usuarios contra latencia p95". El
   punto donde la p95 deja de ser plana mientras suben los VUs.
3. **Por que**: en el mismo instante, abajo, que sube:
   - CPU de un contenedor cerca de 1 nucleo o event loop p99 > ~50 ms -> el proceso Node esta
     saturado (aplicacion).
   - Sesiones esperando lock en Postgres -> contencion de transacciones (base de datos/diseno).
   - Conexiones por base pegadas al tamano del pool, con CPU baja -> pool agotado (configuracion).
   - Una cola de RabbitMQ que crece -> un consumidor no da abasto.
   - "Tiempo esperando turno" de CPU alto en todos los contenedores -> el equipo esta saturado
     (infraestructura de prueba, incluido k6), no la aplicacion.
4. **Desglose de la peticion** (tablero k6): si domina "esperando al servidor", el tiempo lo pone el
   servicio; si domina "bloqueada", lo pone el generador de carga.
5. **Fugas** (soak): memoria residente y heap que suben sin bajar tras los GC, o handles activos que
   crecen sin parar.
6. **Recuperacion** (stress, spike): tras bajar la carga, la p95 y las colas vuelven a los valores
   de la base en pocos minutos y no hay reinicios (panel "Tiempo en marcha").

Texto de una consulta de la tabla de pg_stat_statements (`report.md` ya trae las mas costosas):

```bash
docker compose exec postgres psql -U ecilost -d postgres -c "SELECT calls, round(total_exec_time) AS ms, query FROM pg_stat_statements WHERE queryid = <id>"
```

Para empezar las estadisticas de consultas de cero antes de una corrida:
`... psql -U ecilost -d postgres -c "SELECT pg_stat_statements_reset()"`.

## 6. Limpiar

- `docker compose down`: apaga todo y conserva bases, series y tableros.
- `docker compose down -v`: borra tambien las bases de carga y las series de Prometheus.
- Borrar `.data/` descarta llaves, tokens y la ultima corrida preparada (se regeneran solos).
