# stress-2db2c1ec

- Ventana: 2026-11-21T10:23:29.359Z -> 2026-11-21T10:34:01.115Z (632 s; incluye setup/teardown de k6 y cierre de conexiones)
- Datos: 420 estudiantes, 2 sala(s), 6 ronda(s); args k6: `-e FULL_DURATION=true`
- k6 exit 0, verify exit 0
- Grafana: http://localhost:3300/d/ecilost-overview?from=1795256549359&to=1795257301115&var-testid=stress-2db2c1ec

## Umbrales (k6)

| Metrica | Regla | Cumplido |
|---|---|---|
| http_req_duration{name:GET /rooms/:id} | `p(95)<300` | si |
| http_req_duration{name:GET /notifications} | `p(95)<300` | si |
| http_req_duration{name:GET /wallet/me} | `p(95)<300` | si |
| checks | `rate>0.99` | si |
| http_req_failed | `rate<0.5` | si |
| ws_join_ok | `rate>0.99` | si |
| realtime_price_propagation | `p(95)<1000` | si |
| http_req_duration{name:GET /rooms/:id/state} | `p(95)<300` | si |
| realtime_round_close_lag | `p(95)<1000` | si |
| http_req_duration{name:POST /rounds/:id/bids} | `p(95)<1000` | si |

## Verificacion de garantias

- Sin fallas; 0 aviso(s).

## Totales

| | |
|---|---|
| Peticiones HTTP | 196874 (312.5/s) |
| Fallidas | 0.00 % |
| Checks | 100.00 % |
| Pujas aceptadas | 2530 |
| 409 otra llego primero / bajo minimo / fondos / ronda cerrada / otro | 420 / 1471 / 0 / 44 / 0 |
| Pujas 5xx / sin respuesta | 0 |
| Precios no recibidos por el socket | 0 |
| Errores de socket | 0 |
| room.join aceptados | 100.00 % |
| Iteraciones descartadas | 0 |

## Latencia vista por el usuario (mediana / p90 / p95 / p99 / max)

| Endpoint | |
|---|---|
| GET /rooms/:id | 22 ms / 132 ms / 175 ms / 924 ms / 1148 ms |
| GET /notifications | 3 ms / 20 ms / 31 ms / 64 ms / 563 ms |
| GET /wallet/me | 2 ms / 3 ms / 4 ms / 13 ms / 232 ms |
| GET /rooms/:id/state | 25 ms / 131 ms / 174 ms / 926 ms / 1172 ms |
| POST /rounds/:id/bids | 40 ms / 193 ms / 272 ms / 1191 ms / 2883 ms |
| **Todas** | 11 ms / 108 ms / 154 ms / 789 ms / 2883 ms |

### Rutas HTTP registradas en Prometheus

Incluye rutas sin umbral propio. Percentiles estimados a partir de histogramas nativos.

| Endpoint | Muestras | p95 |
|---|---|---|
| GET /items?ids= | 40 | 9 ms |
| GET /leaderboard | 2786 | 33 ms |
| GET /notifications | 34688 | 31 ms |
| GET /pickups/mine | 2786 | 29 ms |
| GET /pickups/slots | 2786 | 27 ms |
| GET /profiles/me | 2786 | 33 ms |
| GET /rooms | 299 | 72 ms |
| GET /rooms?include=rounds | 299 | 102 ms |
| GET /rooms/:id | 56491 | 175 ms |
| GET /rooms/:id/activity | 33041 | 185 ms |
| GET /rooms/:id/state | 33043 | 174 ms |
| GET /wallet/me | 23346 | 4 ms |
| POST /rounds/:id/bids | 4465 | 272 ms |
| PUT /rounds/:id/auto-bid | 13 | 1734 ms |
| setup: reloj | 5 | 4 ms |

| Tiempo real | |
|---|---|
| Precio en vivo (puja aceptada -> socket) | 143 ms / 228 ms / 240 ms / 295 ms / 552 ms (n=2526) |
| Puja enviada -> precio visto | 206 ms / 343 ms / 393 ms / 633 ms / 2225 ms (n=2526) |
| Retraso del cierre de ronda | 468 ms / 468 ms / 468 ms / 468 ms / 468 ms (n=400) |
| Entrega del socket | 6 ms / 13 ms / 16 ms / 20 ms / 56 ms (n=553366) |
| room.join -> ack | 8 ms / 91 ms / 133 ms / 212 ms / 317 ms (n=566) |

## Curva cada 30 s: usuario contra servidor

min = minutos desde el inicio; CPU en nucleos; locks = sesiones de auction esperando un lock
(maximo del intervalo); cola = mensajes sin consumir en RabbitMQ (maximo del intervalo).

| min | VUs | req/s | p95 | p95 puja | error | p95 precio | pujas/s | CPU auction | CPU engagement | CPU postgres | event loop auction | locks | cola |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 70 | 56.8 | 10 ms | 59 ms | 0.00 % | 240 ms | 1.17 | 0.16 | 0.12 | 0.10 | 11 ms | 0 | 0 |
| 1 | 70 | 81.7 | 8 ms | 43 ms | 0.00 % | 240 ms | 1.92 | 0.14 | 0.11 | 0.14 | 11 ms | 0 | 1 |
| 1.5 | 88 | 76.5 | 8 ms | 44 ms | 0.00 % | 224 ms | 1.71 | 0.16 | 0.11 | 0.15 | 11 ms | 0 | 1 |
| 2 | 120 | 161.8 | 17 ms | 60 ms | 0.00 % | 223 ms | 3.12 | 0.27 | 0.21 | 0.28 | 12 ms | 0 | 1 |
| 2.5 | 120 | 170.9 | 18 ms | 48 ms | 0.00 % | 228 ms | 3.71 | 0.28 | 0.21 | 0.28 | 11 ms | 0 | 3 |
| 3 | 164 | 207.3 | 22 ms | 95 ms | 0.00 % | 233 ms | 3.98 | 0.33 | 0.24 | 0.34 | 12 ms | 0 | 2 |
| 3.5 | 170 | 267.5 | 27 ms | 59 ms | 0.00 % | 234 ms | 4.95 | 0.39 | 0.30 | 0.43 | 12 ms | 0 | 1 |
| 4 | 170 | 262.6 | 29 ms | 78 ms | 0.00 % | 234 ms | 4.53 | 0.40 | 0.29 | 0.45 | 12 ms | 0 | 4 |
| 4.5 | 220 | 354.3 | 35 ms | 80 ms | 0.00 % | 233 ms | 5.12 | 0.55 | 0.39 | 0.60 | 13 ms | 0 | 1 |
| 5 | 220 | 368.7 | 33 ms | 87 ms | 0.00 % | 231 ms | 5.34 | 0.55 | 0.37 | 0.62 | 14 ms | 0 | 5 |
| 5.5 | 258 | 394.5 | 36 ms | 74 ms | 0.00 % | 225 ms | 5.22 | 0.61 | 0.40 | 0.69 | 13 ms | 0 | 4 |
| 6 | 320 | 568.8 | 82 ms | 144 ms | 0.00 % | 248 ms | 5.85 | 0.93 | 0.59 | 1.08 | 18 ms | 0 | 4 |
| 6.5 | 320 | 591.9 | 87 ms | 169 ms | 0.00 % | 242 ms | 6.11 | 0.94 | 0.58 | 1.04 | 16 ms | 0 | 4 |
| 7 | 408 | 631.3 | 137 ms | 273 ms | 0.00 % | 259 ms | 5.72 | 0.99 | 0.62 | 1.11 | 16 ms | 0 | 4 |
| 7.5 | 420 | 671.1 | 180 ms | 336 ms | 0.00 % | 309 ms | 5.72 | 0.91 | 0.61 | 1.15 | 16 ms | 0 | 3 |
| 8 | 420 | 676.6 | 172 ms | 310 ms | 0.00 % | 294 ms | 6.63 | 1.09 | 0.60 | 1.01 | 16 ms | 0 | 3 |
| 8.5 | 411 | 594.7 | 695 ms | 1621 ms | 0.00 % | 257 ms | 6.45 | 1.01 | 0.45 | 1.07 | 17 ms | 0 | 2 |
| 9 | 45 | 224.3 | 71 ms | 144 ms | 0.00 % | 240 ms | 3.74 | 0.42 | 0.28 | 0.37 | 14 ms | 0 | 2 |
| 9.5 | 45 | 48.7 | 9 ms | 40 ms | 0.00 % | 225 ms | 1.10 | 0.09 | 0.09 | 0.11 | 11 ms | 0 | 0 |
| 10 | 41 | 42.7 | 9 ms | 45 ms | 0.00 % | 243 ms | 1.12 | 0.09 | 0.08 | 0.09 | 11 ms | 0 | 0 |
| 10.5 | 2 | 29.6 | 9 ms | 46 ms | 0.00 % | 241 ms | 0.93 | 0.08 | 0.06 | 0.07 | 11 ms | 0 | 0 |

## Servidor en la ventana

| Contenedor | CPU media | CPU max (nucleos) | Memoria max |
|---|---|---|---|
| postgres | 0.53 | 1.18 | 294 MiB |
| auction | 0.49 | 1.10 | 388 MiB |
| runner | 0.45 | 1.05 | 1289 MiB |
| engagement | 0.32 | 0.65 | 411 MiB |
| rabbitmq | 0.46 | 0.58 | 218 MiB |
| wallet | 0.14 | 0.28 | 107 MiB |
| catalog | 0.03 | 0.04 | 117 MiB |
| auth | 0.03 | 0.04 | 113 MiB |

| Servicio | RSS al inicio | RSS al final | Handles | Event loop p99 max | Utilizacion event loop max |
|---|---|---|---|---|---|
| wallet | 153 MiB | 145 MiB | 25 -> 13 | 28 ms | 9.67 % |
| auction | 200 MiB | 172 MiB | 82 -> 23 | 18 ms | 99.99 % |
| engagement | 208 MiB | 208 MiB | 167 -> 22 | 30 ms | 54.70 % |
| auth | 145 MiB | 140 MiB | 5 -> 5 | 16 ms | 0.24 % |
| catalog | 155 MiB | 149 MiB | 7 -> 7 | 17 ms | 0.23 % |

p95 por ruta en el servidor (toda la ventana):

| Servicio y ruta | Peticiones | p95 |
|---|---|---|
| auction /rounds/:roundId/auto-bid | 13 | 1525 ms |
| auction /rounds/:roundId/bids | 4515 | 306 ms |
| engagement /rooms/:roomId/activity | 33148 | 230 ms |
| auction /rooms/:roomId | 92177 | 225 ms |
| auction /rooms/:roomId/state | 33407 | 224 ms |
| auction /rooms | 603 | 86 ms |
| engagement /leaderboard | 2795 | 21 ms |
| engagement /pickups/mine | 2795 | 14 ms |
| engagement /profiles/me | 2795 | 14 ms |
| engagement /notifications | 34803 | 13 ms |
| engagement /pickups/slots | 2795 | 9 ms |
| catalog /items | 39 | 9 ms |
| wallet /wallet/me | 23607 | 5 ms |
| auth /.well-known/jwks.json | 4 | 5 ms |

Respuestas 5xx: ninguna

| Postgres | Conexiones max | Esperando lock max | Deadlocks | Transaccion mas larga |
|---|---|---|---|---|
| ecilost_auth_load | 1 | 0 | 0 | 0.00 s |
| ecilost_catalog_load | 1 | 0 | 0 | 0.00 s |
| ecilost_wallet_load | 13 | 0 | 0 | 0.01 s |
| ecilost_auction_load | 10 | 0 | 0 | 0.38 s |
| ecilost_engagement_load | 10 | 0 | 0 | 0.02 s |

Consultas con mas tiempo de ejecucion en la ventana (pg_stat_statements; llamadas y media son acumulados desde el ultimo reset):

| Base | Tiempo en la ventana | Llamadas | Media | Consulta |
|---|---|---|---|---|
| engagement | 13.19 s | 123684 | 0.34 ms | `SELECT "public"."consumed_events"."eventId", "public"."consumed_events"."eventType", "public"."consumed_events"."occurredAt", "public"."cons` |
| auction | 7.09 s | 339247 | 0.08 ms | `SELECT "auction"."rounds"."id", "auction"."rounds"."position", "auction"."rounds"."status"::text, "auction"."rounds"."startingPrice", "aucti` |
| auction | 6.92 s | 335838 | 0.07 ms | `SELECT "auction"."round_entries"."id", "auction"."round_entries"."kind"::text, "auction"."round_entries"."catalogId", "auction"."round_entri` |
| engagement | 6.56 s | 146091 | 0.22 ms | `SELECT "public"."notifications"."id", "public"."notifications"."kind"::text, "public"."notifications"."roomId", "public"."notifications"."pa` |
| auction | 4.94 s | 335838 | 0.05 ms | `SELECT "auction"."bids"."id", "auction"."bids"."amount", "auction"."bids"."roundId" FROM "auction"."bids" WHERE (("auction"."bids"."bidderId` |
| auction | 4.58 s | 462951 | 0.04 ms | `SELECT "auction"."room_participants"."id", "auction"."room_participants"."roomId" FROM "auction"."room_participants" WHERE ("auction"."room_` |
| auction | 3.03 s | 123712 | 0.08 ms | `SELECT "auction"."rounds"."id", "auction"."rounds"."position", "auction"."rounds"."status"::text, "auction"."rounds"."currentPrice", "auctio` |
| auction | 2.90 s | 335838 | 0.03 ms | `SELECT "auction"."sealed_bids"."id", "auction"."sealed_bids"."amount", "auction"."sealed_bids"."createdAt", "auction"."sealed_bids"."roundId` |

RabbitMQ: cola max engagement.events.v1 3, engagement.gamification.v1 2, ecilost.wallet.bid-releases 2, ecilost.wallet.bid-holds 1; conexiones abiertas 1841; a dead-letter 0.
