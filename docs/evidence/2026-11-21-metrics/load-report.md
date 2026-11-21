# load-fa69be4b

- Ventana: 2026-11-21T10:11:50.703Z -> 2026-11-21T10:22:21.680Z (631 s; incluye setup/teardown de k6 y cierre de conexiones)
- Datos: 120 estudiantes, 2 sala(s), 6 ronda(s); args k6: `-e FULL_DURATION=true`
- k6 exit 0, verify exit 0
- Grafana: http://localhost:3300/d/ecilost-overview?from=1795255850703&to=1795256601680&var-testid=load-fa69be4b

## Umbrales (k6)

| Metrica | Regla | Cumplido |
|---|---|---|
| http_req_duration{name:GET /wallet/me} | `p(95)<300` | si |
| realtime_round_close_lag | `p(95)<1000` | si |
| realtime_price_propagation | `p(95)<1000` | si |
| checks | `rate>0.99` | si |
| http_req_failed | `rate<0.01` | si |
| http_req_duration{name:POST /rounds/:id/bids} | `p(95)<1000` | si |
| http_req_duration{name:GET /rooms/:id} | `p(95)<300` | si |
| http_req_duration{name:GET /notifications} | `p(95)<300` | si |
| http_req_duration{name:GET /rooms/:id/state} | `p(95)<300` | si |
| ws_join_ok | `rate>0.99` | si |

## Verificacion de garantias

- Sin fallas; 0 aviso(s).

## Totales

| | |
|---|---|
| Peticiones HTTP | 97988 (155.5/s) |
| Fallidas | 0.00 % |
| Checks | 100.00 % |
| Pujas aceptadas | 1898 |
| 409 otra llego primero / bajo minimo / fondos / ronda cerrada / otro | 53 / 395 / 0 / 2 / 0 |
| Pujas 5xx / sin respuesta | 0 |
| Precios no recibidos por el socket | 0 |
| Errores de socket | 0 |
| room.join aceptados | 100.00 % |
| Iteraciones descartadas | 0 |

## Latencia vista por el usuario (mediana / p90 / p95 / p99 / max)

| Endpoint | |
|---|---|
| GET /wallet/me | 2 ms / 2 ms / 3 ms / 5 ms / 41 ms |
| POST /rounds/:id/bids | 28 ms / 56 ms / 70 ms / 112 ms / 252 ms |
| GET /rooms/:id | 5 ms / 19 ms / 25 ms / 43 ms / 126 ms |
| GET /notifications | 2 ms / 7 ms / 10 ms / 19 ms / 79 ms |
| GET /rooms/:id/state | 5 ms / 17 ms / 25 ms / 69 ms / 119 ms |
| **Todas** | 4 ms / 19 ms / 26 ms / 51 ms / 252 ms |

### Rutas HTTP registradas en Prometheus

Incluye rutas sin umbral propio. Percentiles estimados a partir de histogramas nativos.

| Endpoint | Muestras | p95 |
|---|---|---|
| GET /items?ids= | 40 | 22 ms |
| GET /leaderboard | 1373 | 15 ms |
| GET /notifications | 20774 | 10 ms |
| GET /pickups/mine | 1373 | 13 ms |
| GET /pickups/slots | 1373 | 11 ms |
| GET /profiles/me | 1373 | 16 ms |
| GET /rooms | 259 | 11 ms |
| GET /rooms?include=rounds | 259 | 8 ms |
| GET /rooms/:id | 26103 | 24 ms |
| GET /rooms/:id/activity | 13887 | 34 ms |
| GET /rooms/:id/state | 13891 | 25 ms |
| GET /wallet/me | 14924 | 3 ms |
| POST /rounds/:id/bids | 2348 | 70 ms |
| PUT /rounds/:id/auto-bid | 6 | 145 ms |
| setup: reloj | 5 | 6 ms |

| Tiempo real | |
|---|---|
| Precio en vivo (puja aceptada -> socket) | 140 ms / 219 ms / 230 ms / 241 ms / 257 ms (n=1896) |
| Puja enviada -> precio visto | 177 ms / 253 ms / 265 ms / 292 ms / 471 ms (n=1896) |
| Retraso del cierre de ronda | 95 ms / 95 ms / 95 ms / 95 ms / 95 ms (n=100) |
| Entrega del socket | 3 ms / 6 ms / 6 ms / 8 ms / 25 ms (n=164266) |
| room.join -> ack | 5 ms / 9 ms / 13 ms / 17 ms / 35 ms (n=214) |

## Curva cada 30 s: usuario contra servidor

min = minutos desde el inicio; CPU en nucleos; locks = sesiones de auction esperando un lock
(maximo del intervalo); cola = mensajes sin consumir en RabbitMQ (maximo del intervalo).

| min | VUs | req/s | p95 | p95 puja | error | p95 precio | pujas/s | CPU auction | CPU engagement | CPU postgres | event loop auction | locks | cola |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 27 | 16.3 | 21 ms | 51 ms | 0.00 % | 222 ms | 0.31 | 0.08 | 0.06 | 0.08 | 11 ms | 0 | 0 |
| 1 | 57 | 57.1 | 12 ms | 67 ms | 0.00 % | 209 ms | 1.34 | 0.13 | 0.12 | 0.15 | 11 ms | 0 | 0 |
| 1.5 | 81 | 101.7 | 22 ms | 125 ms | 0.00 % | 213 ms | 1.95 | 0.22 | 0.14 | 0.35 | 11 ms | 0 | 1 |
| 2 | 117 | 158.7 | 26 ms | 85 ms | 0.00 % | 239 ms | 2.96 | 0.30 | 0.24 | 0.32 | 12 ms | 0 | 3 |
| 2.5 | 120 | 177.6 | 32 ms | 66 ms | 0.00 % | 226 ms | 3.46 | 0.30 | 0.23 | 0.32 | 13 ms | 0 | 2 |
| 3 | 120 | 183.0 | 29 ms | 71 ms | 0.00 % | 237 ms | 3.57 | 0.29 | 0.21 | 0.31 | 13 ms | 0 | 2 |
| 3.5 | 120 | 178.0 | 29 ms | 76 ms | 0.00 % | 221 ms | 3.52 | 0.29 | 0.20 | 0.31 | 12 ms | 0 | 1 |
| 4 | 120 | 184.2 | 30 ms | 71 ms | 0.00 % | 225 ms | 3.59 | 0.30 | 0.22 | 0.28 | 12 ms | 0 | 1 |
| 4.5 | 120 | 180.6 | 29 ms | 67 ms | 0.00 % | 235 ms | 3.39 | 0.29 | 0.21 | 0.30 | 13 ms | 0 | 1 |
| 5 | 120 | 186.9 | 27 ms | 61 ms | 0.00 % | 229 ms | 4.09 | 0.30 | 0.23 | 0.31 | 12 ms | 0 | 4 |
| 5.5 | 120 | 201.5 | 30 ms | 83 ms | 0.00 % | 229 ms | 3.19 | 0.34 | 0.24 | 0.31 | 11 ms | 0 | 5 |
| 6 | 120 | 192.1 | 24 ms | 56 ms | 0.00 % | 231 ms | 3.56 | 0.25 | 0.21 | 0.31 | 12 ms | 0 | 3 |
| 6.5 | 120 | 195.3 | 23 ms | 55 ms | 0.00 % | 242 ms | 3.58 | 0.33 | 0.24 | 0.33 | 12 ms | 0 | 1 |
| 7 | 120 | 211.3 | 22 ms | 91 ms | 0.00 % | 232 ms | 3.53 | 0.33 | 0.24 | 0.36 | 12 ms | 0 | 2 |
| 7.5 | 120 | 193.5 | 18 ms | 74 ms | 0.00 % | 231 ms | 3.15 | 0.31 | 0.21 | 0.32 | 12 ms | 0 | 2 |
| 8 | 120 | 175.7 | 18 ms | 56 ms | 0.00 % | 225 ms | 3.28 | 0.29 | 0.20 | 0.30 | 11 ms | 0 | 0 |
| 8.5 | 120 | 171.2 | 31 ms | 47 ms | 0.00 % | 228 ms | 3.50 | 0.24 | 0.18 | 0.30 | 13 ms | 0 | 2 |
| 9 | 120 | 170.6 | 19 ms | 45 ms | 0.00 % | 211 ms | 3.91 | 0.25 | 0.21 | 0.27 | 11 ms | 0 | 3 |
| 9.5 | 116 | 172.5 | 21 ms | 54 ms | 0.00 % | 231 ms | 3.69 | 0.29 | 0.21 | 0.30 | 12 ms | 0 | 5 |
| 10 | 60 | 129.6 | 13 ms | 48 ms | 0.00 % | 241 ms | 2.84 | 0.21 | 0.15 | 0.21 | 11 ms | 0 | 0 |
| 10.5 | 1 | 41.1 | 10 ms | 42 ms | 0.00 % | 219 ms | 1.03 | 0.09 | 0.07 | 0.07 | 11 ms | 0 | 2 |

## Servidor en la ventana

| Contenedor | CPU media | CPU max (nucleos) | Memoria max |
|---|---|---|---|
| rabbitmq | 0.44 | 0.56 | 218 MiB |
| postgres | 0.28 | 0.39 | 259 MiB |
| auction | 0.26 | 0.34 | 302 MiB |
| runner | 0.19 | 0.28 | 354 MiB |
| engagement | 0.19 | 0.25 | 232 MiB |
| wallet | 0.10 | 0.12 | 97 MiB |
| auth | 0.03 | 0.04 | 109 MiB |
| catalog | 0.03 | 0.04 | 111 MiB |

| Servicio | RSS al inicio | RSS al final | Handles | Event loop p99 max | Utilizacion event loop max |
|---|---|---|---|---|---|
| wallet | 126 MiB | 151 MiB | 26 -> 11 | 12 ms | 3.85 % |
| auction | 179 MiB | 167 MiB | 70 -> 30 | 13 ms | 22.66 % |
| engagement | 198 MiB | 181 MiB | 154 -> 30 | 17 ms | 14.09 % |
| auth | 143 MiB | 146 MiB | 5 -> 5 | 21 ms | 0.25 % |
| catalog | 144 MiB | 154 MiB | 9 -> 7 | 14 ms | 0.25 % |

p95 por ruta en el servidor (toda la ventana):

| Servicio y ruta | Peticiones | p95 |
|---|---|---|
| auction /rounds/:roundId/auto-bid | 5 | 212 ms |
| auction /rounds/:roundId/bids | 2363 | 84 ms |
| engagement /rooms/:roomId/activity | 13920 | 43 ms |
| auction /rooms/:roomId | 41394 | 24 ms |
| auction /rooms/:roomId/state | 13977 | 23 ms |
| catalog /items | 39 | 21 ms |
| engagement /leaderboard | 1376 | 10 ms |
| engagement /profiles/me | 1376 | 9 ms |
| auction /rooms | 521 | 9 ms |
| engagement /pickups/mine | 1376 | 9 ms |
| engagement /pickups/slots | 1376 | 7 ms |
| engagement /notifications | 20823 | 6 ms |
| wallet /wallet/me | 14926 | 5 ms |
| auth /.well-known/jwks.json | 5 | 5 ms |

Respuestas 5xx: ninguna

| Postgres | Conexiones max | Esperando lock max | Deadlocks | Transaccion mas larga |
|---|---|---|---|---|
| ecilost_auth_load | 1 | 0 | 0 | 0.00 s |
| ecilost_catalog_load | 1 | 0 | 0 | 0.00 s |
| ecilost_wallet_load | 13 | 0 | 0 | 0.02 s |
| ecilost_auction_load | 10 | 0 | 0 | 0.03 s |
| ecilost_engagement_load | 10 | 0 | 0 | 0.02 s |

Consultas con mas tiempo de ejecucion en la ventana (pg_stat_statements; llamadas y media son acumulados desde el ultimo reset):

| Base | Tiempo en la ventana | Llamadas | Media | Consulta |
|---|---|---|---|---|
| engagement | 5.82 s | 111400 | 0.23 ms | `SELECT "public"."notifications"."id", "public"."notifications"."kind"::text, "public"."notifications"."roomId", "public"."notifications"."pa` |
| engagement | 5.15 s | 90640 | 0.31 ms | `SELECT "public"."consumed_events"."eventId", "public"."consumed_events"."eventType", "public"."consumed_events"."occurredAt", "public"."cons` |
| auction | 3.03 s | 247953 | 0.08 ms | `SELECT "auction"."rounds"."id", "auction"."rounds"."position", "auction"."rounds"."status"::text, "auction"."rounds"."startingPrice", "aucti` |
| auction | 2.86 s | 244544 | 0.07 ms | `SELECT "auction"."round_entries"."id", "auction"."round_entries"."kind"::text, "auction"."round_entries"."catalogId", "auction"."round_entri` |
| auction | 2.46 s | 244544 | 0.05 ms | `SELECT "auction"."bids"."id", "auction"."bids"."amount", "auction"."bids"."roundId" FROM "auction"."bids" WHERE (("auction"."bids"."bidderId` |
| auction | 2.03 s | 338612 | 0.04 ms | `SELECT "auction"."room_participants"."id", "auction"."room_participants"."roomId" FROM "auction"."room_participants" WHERE ("auction"."room_` |
| engagement | 1.89 s | 9144 | 0.45 ms | `INSERT INTO "public"."notifications" ("id","eventId","kind","roomId","recipientId","payload","createdAt") VALUES ($1,$2,CAST($3::text AS "pu` |
| auction | 1.49 s | 8382 | 0.78 ms | `WITH candidate AS ( -- Misma regla que minimumBid(), evaluada sobre la fila bloqueada: el precio y el -- lider que decide son los vigentes a` |

RabbitMQ: cola max engagement.events.v1 3, engagement.gamification.v1 2, ecilost.wallet.bid-releases 1, ecilost.wallet.bid-holds 1; conexiones abiertas 1539; a dead-letter 0.
