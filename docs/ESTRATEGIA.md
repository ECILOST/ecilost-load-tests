# Estrategia y plan de pruebas de rendimiento

## 1. Objetivos y criterios

El backlog fija un solo requisito con numero y varias garantias de dominio. Nada mas es requisito.

| Tipo | Criterio | Origen | Donde se mide |
|---|---|---|---|
| **Requisito** | Tiempo real < 1 s: precio, contador y transicion de ronda | `ECILOST-Backlog.md:57` | `realtime_price_propagation` p95, `realtime_round_close_lag` p95 |
| **Requisito** | Aforo nunca superado, un ganador, ECICoin nunca comprometidos dos veces, historial creciente, cobro = precio | `ECILOST-Backlog.md:56` | `scripts/verify.mjs` tras cada corrida |
| Referencia | Errores HTTP < 1 % | propuesta | `http_req_failed` |
| Referencia | Lecturas de sala (`GET /rooms/:id`, `/state`, `/notifications`, `/wallet/me`) p95 < 300 ms | propuesta | `http_req_duration{name:...}` |
| Referencia | Puja p95 < 1 s | propuesta | `http_req_duration{name:POST /rounds/:id/bids}` |
| Referencia | `room.join` aceptado > 99 % | propuesta | `ws_join_ok` |

**Por que esas referencias.** El backlog no tiene SLA (supuesto A4) y no se inventa uno. Hacian
falta valores para poder decir "esta corrida es peor que la anterior":
- 300 ms para lecturas: la pantalla de sala las repite en cada evento; por encima de unos cientos
  de ms el precio en pantalla se atrasa respecto al socket y deja de sentirse en vivo.
- 1 s para la puja: la mitad del contador de anti-sniping de un minuto no debe irse en esperar
  la respuesta; ademas es el mismo orden que el requisito de tiempo real.
- 1 % de errores: valor usual de partida; un error en una puja es dinero que el usuario cree
  comprometido y no lo esta.

Se cambian en `k6/lib/thresholds.js`. Si el equipo fija metas reales, reemplazan a estas.

## 2. Modelo de usuario

Derivado del codigo del frontend (`use-room.ts`, `use-live-room.ts`, `use-notifications.ts`,
`use-auction-items.ts`, `http-auction.gateway.ts`), no supuesto:

| Rol | Que hace | Archivo |
|---|---|---|
| Espectador en sala | Socket `/realtime` + `room.join`; `GET /rooms/:id` cada 5 s; por cada evento (coalescido) `GET /rooms/:id` + `/state` + `/notifications` y `GET /wallet/me` si cambio su liderazgo; respaldo cada 15 s; notificaciones cada 10 s | `k6/flows/live-room.js` |
| Pujador | Lo mismo + puja cada 3-10 s si no va ganando (precio + 100..500); 10 % activa puja automatica | `k6/flows/live-room.js` |
| Visitante del catalogo | Listado (`GET /rooms`, detalle en lote, fichas de catalog cada 5 min), una ficha releida cada 5 s durante 15-40 s | `k6/flows/browse.js` |

Una sesion de sala dura 3-7 min (o hasta que la sala cierra) y luego el VU vuelve a entrar.

**Supuestos de mezcla** (configurables): 30 % de los estudiantes en sala pujan (`BIDDER_RATIO`),
10 % de los pujadores usan puja automatica (`AUTOBID_RATIO`), 20 visitantes de catalogo.
Referencia de tamano: 25/50/100 estudiantes en sala, igual que las corridas previas
(`RESULTADOS.md`), en 1-2 salas simultaneas. No hay cifra oficial de estudiantes por evento.

## 3. Escenarios

| Escenario | Objetivo | Executor y perfil | Ramp-up / estabilizacion | Datos (`run.mjs`) | Criterio |
|---|---|---|---|---|---|
| smoke | Scripts, datos y metricas funcionan | `constant-vus`: 2 espectadores, 2 pujadores, 1 visitante, 90 s | sin rampa | 5 est., 1 sala | 0 errores, checks 100 %, verify OK |
| load | Comportamiento nominal | `ramping-vus`: `USERS` (25/50/100) en sala + 20 visitantes | 2 min de subida, 10 min estable, 1 min de bajada | 120 est., 2 salas, 6 rondas | requisito + referencias + verify |
| stress | Degradacion, saturacion y recuperacion | `ramping-vus` por escalones 50/100/150/200/300/400 | 30 s de subida + 3 min estable por escalon; luego 25 usuarios 3 min | 420 est., 2 salas, 10 rondas | sin aprobacion; se corta si > 50 % falla; se registra el escalon donde rompe |
| stress-reads | Relecturas/s que aguanta la sala (H5) | `ramping-arrival-rate` 10/50/100/200/400 it/s; 1 it = `GET /rooms/:id` + `/state` + `/notifications` | 15 s + 2 min por escalon | 200 est., 1 sala | p95 < 300 ms, sin iteraciones descartadas |
| spike | Oleada repentina (apertura de sala, ultimo minuto) | `ramping-vus` 10 -> 200 en 10 s, 1 min, -> 10 | 1 min base, 3 min de recuperacion | 200 est., 2 salas | p95 vuelve a la base; verify OK |
| soak | Fugas y deriva | `ramping-vus` 60 en sala + 10 visitantes, 45 min | 1 min de subida | 70 est., 1 sala, 20 rondas | memoria, event loop, conexiones y colas estables |
| bid-storm | Contencion de pujas sobre una ronda (H1) | `constant-vus` `VUS`, 90 s | sin rampa | 100 est., 1 sala, 1 ronda | comparacion con `RESULTADOS.md` |

**Por que cada executor.**
- `ramping-vus` (modelo cerrado) para sala: un VU es una persona con su socket abierto, que es lo
  que limita a engagement y lo que el negocio cuenta.
- `ramping-arrival-rate` (modelo abierto) para la capacidad de lectura: si el servicio se frena,
  k6 sigue lanzando iteraciones y la cola se ve; en un modelo cerrado la carga bajaria sola
  (coordinated omission).
- `constant-vus` en humo y bid-storm: carga fija y conocida.

**Por que RPS no se fija en los escenarios de sala.** Las peticiones/s salen del comportamiento
(eventos x espectadores + sondeo), como en produccion; fijarlas romperia el modelo. Las RPS
medidas se reportan por escenario.

## 4. Metricas a analizar

| Lado | Metricas | Tablero |
|---|---|---|
| Usuario (k6) | VUs, iteraciones, peticiones/s por endpoint, promedio y p50/90/95/99, error por endpoint, checks, pujas por resultado, tiempo real, sesiones y `room.join` | k6, Correlacion |
| Servicios | Peticiones/s, 4xx/5xx, p95/p99 por ruta, CPU del proceso, event loop (lag y utilizacion), memoria, heap, GC, handles, sockets | Servicios |
| Postgres | Conexiones por base, sesiones por estado, esperas por lock, locks, transacciones, deadlocks, transaccion mas larga, consultas mas costosas | Infraestructura |
| RabbitMQ | Mensajes listos/sin confirmar por cola, publicados/entregados, dead-letter, conexiones abiertas/s | Infraestructura |
| Contenedores | CPU, memoria, tiempo esperando CPU | Infraestructura |

## 5. Seguridad de los datos

- Todo corre contra `*_load` en un Postgres propio (`compose/`), nunca contra desarrollo ni Azure.
- Cada corrida crea sus datos por API (`setup.mjs`), con nombres `[CARGA <runId>]`, y verifica
  solo esos (`verify.mjs`). Los estudiantes son sinteticos (`tokens.mjs`).
- `docker compose down -v` borra todo.

## 6. Orden de ejecucion

1. `smoke` (valida todo).
2. `load` con 25, 50 y 100 (linea base y crecimiento).
3. `stress` (techo y recuperacion), `stress-reads` (capacidad de lectura).
4. `spike`, `soak`.
5. `bid-storm` cuando se quiera comparar la contencion con las corridas anteriores.

Entre corridas no se reinician los servicios (asi se ve si se recuperan solos); si una corrida
deja el sistema roto, se anota y se reinicia antes de la siguiente.
