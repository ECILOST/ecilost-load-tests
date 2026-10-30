# Auditoria de rendimiento de la arquitectura

Estado de ECILOST visto desde el rendimiento, antes de medir. Todo sale de leer el codigo, la
infraestructura (ecilost-terraform) y los workflows de CI de cada repo (2026-10-29). Las hipotesis
del final se confirman o descartan con datos en `RESULTADOS-2026-10-30.md`.

## 1. Arquitectura

Cinco microservicios NestJS (Node 22, TypeScript) con una base Postgres cada uno y un broker
RabbitMQ comun. El frontend (React 19 + Vite) habla directo con cada servicio.

```
                 navegador (React)
   HTTP /auth  /api/catalog  /api/wallet  /api/auction  /api/engagement     WebSocket /realtime
        |            |            |              |               |                   |
      auth        catalog       wallet  <--RPC-- auction --RPC--> catalog       engagement
     :3000         :3001        :3002   (AMQP)    :3003   (AMQP)                  :3005
        |            |            |              |  \                 HTTP GET /rooms/:id
     Postgres     Postgres     Postgres       Postgres  outbox --> RabbitMQ --> engagement
                     |                                   (eventos)        (Socket.IO a la sala)
                Azure Blob
```

| Servicio | Responsabilidad | Persistencia | Notas de rendimiento |
|---|---|---|---|
| auth | Login con Google (OIDC + PKCE), emite JWT RS256, JWKS | Prisma 7 + `pg` (pool 10) | Fuera de la ruta caliente: los demas verifican el JWT en local |
| catalog | Objetos, lotes, multimedia, pistas de misterio | Prisma 7 (pool 10), Azure Blob | Firma URLs SAS por objeto al listar |
| wallet | Saldo ECICoin, reservas, recargas, liquidacion | Prisma 6 (pool CPU x 2 + 1) | Atiende RPC de auction por AMQP; lock de fila por billetera |
| auction | Salas, rondas, pujas, compra inmediata, puja automatica, modos dinamicos | Prisma 7 (pool 10) | Scheduler cada 500 ms, outbox cada 200 ms |
| engagement | Notificaciones y Socket.IO `/realtime` | Prisma 7 (pool 10) | Una replica, adaptador en memoria |

`ecilost-api-gateway` (8080) y `ecilost-realtime-gateway` (3004) son esqueletos sin rutas: no se
prueban. El ruteo real lo hacen el proxy de Vite en desarrollo y `ecilost-frontend/middleware.ts`
en Vercel. Vercel no reenvia WebSocket: el navegador se conecta directo a engagement.

## 2. Comunicacion

- **HTTP sincrono** navegador -> servicio. Unico HTTP entre servicios: engagement -> auction
  `GET /rooms/:id` en cada `room.join` (timeout 3 s).
- **RPC sobre RabbitMQ** (`replyTo` + `correlationId`, timeout 5 s -> 503): auction -> wallet
  (reservar, liberar, consultar saldo) en la ruta de cada puja; auction -> catalog (reservar
  objetos) al crear una sala.
- **Eventos** por el exchange topic `ecilost.events`, publicados con outbox transaccional: puja
  aceptada, ronda activada/cerrada, modo elegido; `user.created.v1` desde auth.
- **Tiempo real**: engagement consume los eventos de auction y emite a `room:{id}` y `user:{id}`.

## 3. Autenticacion

Solo Google. auth emite un access token RS256 de 15 min (refresh rotado en cookie httpOnly). Los
demas servicios lo verifican en local contra `/.well-known/jwks.json` (jose, cache del JWKS).
Para la carga, `scripts/tokens.mjs` firma tokens sinteticos con la llave local de auth: no hay
login durante la prueba y auth queda fuera del camino critico, como en produccion.

## 4. Datos y dependencias externas

| Recurso | Local (carga) | Azure (dev/prod) |
|---|---|---|
| Postgres | 17.11 en Docker, una base por servicio | Neon free, un proyecto por entorno, esquema por servicio, sin pooler |
| RabbitMQ | 4.3.6 en Docker | CloudAMQP free |
| Blob | Azurite | Azure Storage `stecilost` |
| Computo | un contenedor por servicio | Container Apps 0.25 vCPU / 0.5 GiB, `max_replicas = 1`, DEV escala a 0 |

## 5. Ejecucion y despliegue

CI por repo: typecheck, lint, pruebas, imagen `ghcr.io/ecilost/*:sha-<commit>`, `prisma migrate
deploy` y `az containerapp update` (develop -> DEV, main -> PROD). El frontend se despliega en
Vercel. No hay entorno de staging con datos (solo un README en terraform).

## 6. Observabilidad (antes de este trabajo)

Ninguna: sin `/metrics`, sin OpenTelemetry ni Application Insights; logs de Nest a stdout (en Azure
van a Log Analytics). Agregado en este trabajo:

- `GET /metrics` en los cinco servicios (`src/observability/metrics.ts`, `@prometheus-io/client`),
  apagado salvo `METRICS_ENABLED=true`: histograma por plantilla de ruta y estado, CPU, memoria,
  heap, GC, event loop; sockets conectados en engagement.
- Prometheus, Grafana, cAdvisor y postgres_exporter (`observability/`), y el plugin Prometheus de
  RabbitMQ.

## 7. Que se evalua y por que

| Componente | Por que | Como |
|---|---|---|
| auction | Ruta critica: estado de sala, pujas, cierres. Concentra las relecturas de toda la sala | load, stress, stress-reads, spike, bid-storm |
| engagement | Unico canal de tiempo real (requisito < 1 s); una sola replica | sesiones Socket.IO reales en todos los escenarios con sala |
| wallet | Reserva en cada puja (RPC sincrono), liquidacion al cerrar | indirecto via pujas; verify.mjs comprueba el dinero |
| RabbitMQ / outbox | Latencia entre puja aceptada y precio en pantalla | `realtime_price_propagation`, colas y conexiones |
| Postgres | Locks de ronda, pools de conexiones | sesiones esperando lock, conexiones, pg_stat_statements |
| catalog | Listado y fichas del catalogo | navegantes en load/stress/soak |
| auth | Fuera de la ruta caliente | solo JWKS (verificado en smoke) |

## 8. Cuellos de botella sospechados (hipotesis)

| # | Hipotesis | Donde |
|---|---|---|
| H1 | El lock de la ronda serializa las pujas: `FOR UPDATE` en la CTE de la puja, mas advisory lock por pujador, semaforo `MAX_LOCKED_SECTIONS = 4` y 2 conexiones por seccion sobre un pool de 10 | `auction/src/bids/bids.service.ts:42,73-91,206-295` |
| H2 | La reserva en wallet va por RPC AMQP dentro de la ruta de la puja (timeout 5 s -> 503) | `auction/src/events/wallet-hold.client.ts` |
| H3 | Los consumidores RPC de wallet no fijan prefetch: concurrencia ilimitada contra su pool | `wallet/src/events/resilient-consumer.ts:73-75` |
| H4 | El outbox de auction abre una conexion AMQP nueva por ciclo con pendientes y confirma mensaje a mensaje | `auction/src/events/events.module.ts:50,74` |
| H5 | Amplificacion: cada evento hace que cada espectador relea `GET /rooms/:id` + `/state` + `/notifications` | `ecilost-frontend/.../http-auction.gateway.ts`, `use-live-room.ts` |
| H6 | `GET /rooms` sin paginar; `include=rounds` devuelve todo | `auction/src/rooms/rooms.controller.ts` |
| H7 | Scheduler de 500 ms en una transaccion por tick (timeout 5 s) | `auction/src/rooms/rooms.service.ts:404-468` |
| H8 | engagement no escala horizontal (adaptador en memoria) y `room.join` llama a auction | `engagement/src/realtime/*` |
| H9 | Sondeo de fondo por estudiante: notificaciones cada 10 s, sala cada 5 s | hooks del frontend |
| H10 | Node usa un solo hilo por servicio; en Azure cada servicio tiene 0.25 vCPU | terraform `modules/compute` |

## 9. Limitaciones del entorno de prueba

- Todo corre en un equipo (Ryzen 5 5600X, 12 hilos; Docker Desktop con 12 CPU y 15.6 GiB): k6
  compite por CPU con los servicios. Los numeros comparan niveles y ubican cuellos de botella; no
  son la capacidad de produccion.
- Neon y CloudAMQP (Azure) tienen latencias de red y limites de plan que en local no existen. El
  overlay `compose/docker-compose.azure-limits.yml` reproduce solo el limite de CPU y memoria.
- No se prueba contra Azure: los tokens sinteticos no sirven alla y DEV/PROD comparten planes
  gratuitos con uso real.
