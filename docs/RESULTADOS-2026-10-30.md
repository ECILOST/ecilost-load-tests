# Resultados de rendimiento, 2026-10-30

Solo hay numeros medidos. Lo que no se pudo comprobar se dice explicitamente. Cada corrida tiene
su informe completo en `results/<corrida>/report.md` (no versionado) y sus series en Prometheus
(`testid`). Estrategia y criterios en `ESTRATEGIA.md`; como reproducir en `EJECUCION.md`.

## 1. Entorno

| | |
|---|---|
| Equipo | AMD Ryzen 5 5600X (12 hilos), 32 GB RAM, Windows 11; Docker Desktop 29.3.1 con 12 CPU y 15.6 GiB |
| Sistema bajo prueba | Un contenedor por servicio, **sin limite de CPU ni memoria**, Postgres 17.11 y RabbitMQ 4.3.6 en Docker |
| Codigo | rama `feature/prometheus-metrics`: auth `4f7c5b6`, catalog `6b7a348`, wallet `6de384a`, auction `56aa09e`, engagement `8e12683` |
| Generador | k6 2.2.0 en el mismo equipo (Windows), remote write a Prometheus 3.5.0 |
| Escenarios | `ecilost-load-tests` rama `feature/performance-observability` |

k6 y el sistema comparten CPU (k6 llego a 1.4 GB de RAM con 420 VUs). Los numeros comparan niveles
y ubican cuellos de botella; **no son la capacidad de Azure** (0.25 vCPU por servicio, Neon y
CloudAMQP gratuitos).

## 2. Resumen

1. **Requisito de tiempo real: cumplido en todas las corridas**, incluido el estres con 420
   usuarios. Precio en vivo p95 entre 229 y 464 ms; cierre de ronda 128-450 ms despues de su
   `endsAt`; entrega del socket p95 <= 23 ms.
2. **Garantias de dominio: intactas en todas las corridas** (`verify.mjs` sin fallas): aforo,
   historial creciente, precio = ultima puja, un cierre por ronda, cobro = precio, sin saldos
   negativos, retenido = reservas. Ningun 5xx, ningun "fondos insuficientes" falso.
3. **El limite es auction, y lo pone la lectura, no la puja.** Su event loop llega al 100 % con
   ~100 estudiantes en sala (~570 req/s en total). En el estres hubo 77 lecturas de sala por
   cada intento de puja (537 000 contra 6 989).
4. **Degradacion desde ~100 estudiantes en sala; saturacion hacia ~120-150**: las peticiones/s
   dejan de subir (~650-800/s) y desde ahi solo crece la latencia (p95 de lectura 0.26 s -> 1.6 s;
   p95 de puja 0.45 s -> 6-10 s).
5. **Se recupera sola**: al bajar la carga la p95 vuelve a ~40 ms en menos de un minuto, sin
   reinicios ni memoria retenida.

## 3. Validez de la medicion

Dos defectos de los propios scripts se encontraron revisando los datos y se corrigieron antes de
las corridas que se reportan:

- **HTTP sincrono en el cliente**: mientras un VU esperaba una lectura no atendia el socket, y la
  "entrega del socket" salia en p95 220 ms con 100 usuarios (4 ms en humo). Se paso todo a
  `http.asyncRequest`; con la correccion, p95 13 ms. Las corridas `load-8619ca81`,
  `load-c755e502` y `load-767a3ae1` tienen las metricas de tiempo real del cliente infladas y no
  se usan para eso (sus metricas de servidor son validas).
- **"Sin muestras" en el cierre de ronda**: era el informe (una consulta puntual de Prometheus
  no ve una serie cuyo ultimo dato tiene mas de 5 min). Las rondas si cerraron; corregido en
  `report.mjs`. `n` del cierre cuenta observaciones (cada VU de la sala ve el mismo cierre).

Limitacion conocida: `realtime_price_propagation` se mide desde la respuesta HTTP de la puja. Si
la respuesta tarda mas que el evento (saturacion), el valor queda en 0; en esos tramos el dato
util es la entrega del socket y `realtime_bid_to_price`.

## 4. Carga nominal (`load`, 2 salas + 20 visitantes, 10 min estables)

Promedios de los minutos estables (4-12). `USERS` = estudiantes en sala; VUs = + 20 visitantes.

| En sala | req/s | p95 HTTP | p95 puja | p95 precio en vivo | Pujas/s | CPU auction | CPU postgres | Event loop auction (util. max) | room.join p95 |
|---|---|---|---|---|---|---|---|---|---|
| 25 | 85 | 41 ms | 66 ms | 230 ms | 1.0 | 0.18 | 0.16 | 5 % | 16 ms |
| 50 | 270 | 105 ms | 162 ms | 236 ms | 1.9 | 0.45 | 0.45 | 34 % | 58 ms |
| 100 | 573 | 270 ms (max 299) | 450 ms | 320 ms | 2.5 | 0.95 | 0.93 | **100 %** | 268 ms |

- Todas pasan los umbrales (requisito y referencia), 0 % de errores, `verify` sin fallas.
- La carga de auction crece mas rapido que los usuarios: x4 usuarios -> x6.7 peticiones/s, porque
  cada evento hace que **cada** espectador relea (H5). Con 100 en sala, en 13 min y medido en el
  servidor: 141 043 `GET /rooms/:id`, 124 370 `GET /rooms/:id/state` y 2 693 intentos de puja.
- Con 100 en sala auction ya esta en el limite (utilizacion del event loop 100 %): es la carga
  nominal maxima en este equipo.

## 5. Estres (`stress`, escalones de 3 min y recuperacion)

| En sala | req/s | p95 HTTP | p95 puja | Pujas aceptadas/s | CPU auction | Event loop p99 auction |
|---|---|---|---|---|---|---|
| 50 | 195-313 | 99-124 ms | 99-206 ms | 1.9 | 0.34-0.49 | 16-18 ms |
| 100 | 650-675 | 258-270 ms | 433-449 ms | 2.4-2.6 | 0.94-1.05 | 21-28 ms |
| 150 | 662-708 | 384-416 ms | 628-643 ms | 2.6-2.8 | 1.06-1.15 | 24-53 ms |
| 200 | 641-708 | 554-773 ms | 1.0-1.7 s | 1.9-2.0 | 1.08-1.19 | 20-47 ms |
| 300 | 732-805 | 760-817 ms | 1.8-2.3 s | 1.7-2.1 | 1.17-1.19 | 24-35 ms |
| 400 | 606-784 | 1.06-1.58 s | 6.5-10 s | 0.6-1.0 | 1.18-1.20 | 29-89 ms |
| 25 (recuperacion) | 64-102 | 36-42 ms | 51-66 ms | 1.0 | 0.15-0.19 | 13 ms |

- **Inicio de la degradacion**: entre 50 y 100 en sala (la p95 se duplica y el event loop de
  auction pasa a estar ocupado todo el tiempo).
- **Saturacion**: ~120-150 en sala. Las peticiones/s se quedan en ~650-800 aunque los usuarios se
  tripliquen; lo que crece es la cola (latencia).
- **La puja se degrada mas que la lectura**: aceptadas/s cae de 2.8 a 0.6 con mas pujadores, y
  los 409 suben (2 789 "otra llego primero" y 1 510 "bajo el minimo"): el estudiante puja sobre un
  precio que ya cambio porque su lectura tardo. Es el patron de H1 (contencion), pero aqui
  agravado por la saturacion general de auction.
- Errores: 0.01 % en el escalon de 400 (una peticion llego al timeout de 60 s de k6). Ningun 5xx.
- Tiempo real: precio en vivo p95 371 ms en toda la corrida; cierre de ronda <= 450 ms; entrega
  del socket p95 23 ms. `room.join` p95 917 ms (engagement espera a auction).
- **Recuperacion**: al volver a 25 usuarios, p95 36 ms en el primer minuto; RSS de auction
  235 -> 190 MiB y handles 87 -> 21. Sin reinicios.

## 6. Capacidad de lectura (`stress-reads`, modelo abierto)

Una iteracion = `GET /rooms/:id` + `GET /rooms/:id/state` + `GET /notifications` (lo que hace cada
espectador por evento). Sala de 6 rondas, sin pujas.

| Objetivo (it/s) | req/s logradas | p95 |
|---|---|---|
| 10 / 50 / 100 | 30 / 150 / 300 | 5 ms |
| 200 | 600 | 5 ms |
| 400 | ~830-880 (no se alcanza) | 374-652 ms, 17 157 iteraciones descartadas |

Sola, la lectura aguanta ~200-280 relecturas/s (~400-560 req/s en auction). Con N espectadores
y E eventos/s una sala necesita N x E relecturas/s: 100 espectadores con 3 pujas/s ya son 300/s.

## 7. Pico (`spike`, 10 -> 200 en 10 s, 1 min, -> 10)

- Sin errores; los 200 entraron (`room.join` 100 %).
- Durante el pico: ~680-920 req/s, p95 405-441 ms, p95 puja 645-726 ms, precio en vivo p95
  323-460 ms.
- **Recuperacion en menos de 30 s**: p95 18 ms en el primer intervalo tras bajar.

## 8. Cuellos de botella

| # | Hallazgo | Tipo | Evidencia |
|---|---|---|---|
| C1 | **auction satura su unico hilo** con ~100 en sala | Aplicacion | Utilizacion del event loop 100 %, CPU ~1 nucleo, req/s planas desde 120 usuarios |
| C2 | **Amplificacion de lecturas (H5 confirmada)**: cada evento -> cada espectador relee sala, estado y notificaciones | Aplicacion (cliente + API) | Estres: 297 416 `GET /rooms/:id` + 239 277 `/state` contra 6 989 intentos de puja (77:1), medido en el servidor |
| C3 | **`GET /rooms/:id` es caro**: unas 8 consultas por llamada (sala, participante, rondas, entradas, mi mejor puja, sobres, conteo de sobres, hora) | Aplicacion / BD | `roomDetailSelect` en `rooms.service.ts:25-50`; las 8 consultas con mas tiempo en Postgres durante el estres son todas de estas lecturas |
| C4 | **Falta un indice**: "mi mejor puja" (`bids WHERE bidderId AND status AND roundId IN`) no tiene indice por pujador | Base de datos | `EXPLAIN ANALYZE`: con la tabla chica, Seq Scan de toda la tabla; con 16 000 pujas, lee todas las pujas de las rondas de la sala (1 615) y descarta las ajenas (1 475) para devolver 140, 1.95 ms. Es la consulta con mas tiempo total (80 s en estres) y crece con las pujas de la sala |
| C5 | Postgres llega a ~1 nucleo | Base de datos (consecuencia de C2-C4) | CPU postgres 0.93-1.10 con 100+ usuarios; sin esperas por lock ni deadlocks |
| C6 | **El outbox abre una conexion AMQP por ciclo (H4 confirmada)** | Aplicacion / configuracion | 2 226 conexiones abiertas en 26 min de estres (~1 por cada 3 intentos de puja); RabbitMQ usa 0.48 nucleos con 25 usuarios (0.24 en reposo) |
| C7 | El sondeo del outbox (200 ms) fija el piso de latencia del precio en vivo | Diseno | Mediana ~140 ms, p95 ~230 ms sin carga; la entrega del socket es solo 3-5 ms |
| C8 | `room.join` depende de auction (H8) | Aplicacion | p95 16 ms con 25 usuarios, 268 ms con 100, 917 ms en estres |
| C9 | La puja se degrada antes que la lectura (H1 parcial) | Aplicacion | p95 puja 6-10 s con 400; aceptadas/s caen; sin esperas de lock en Postgres: la cola esta dentro de auction (semaforo `MAX_LOCKED_SECTIONS` y event loop), que hoy no se mide |

No confirmados a esta carga: wallet sin prefetch (H3: CPU de wallet <= 0.17, colas <= 2
mensajes), scheduler de 500 ms (H7: cierres a tiempo), `GET /rooms` sin paginar (H6: p95 803 ms
en estres pero con poco volumen).

Memoria: sin indicios de fuga en corridas de hasta 26 min (auction sube a ~440 MiB bajo carga y
vuelve a ~190 MiB). **No hay prueba de resistencia todavia** (seccion 10).

## 9. Capacidad aproximada

- **Este equipo, una instancia por servicio**: hasta ~50 estudiantes en sala, todo comodo
  (p95 ~100 ms); ~100 es el maximo nominal (p95 270 ms, auction al 100 %); desde ~150 el sistema
  esta saturado y solo empeora la latencia. El requisito de tiempo real se sigue cumpliendo
  hasta 400, pero con 400 la puja tarda 6-10 s en responder.
- **Azure (estimacion, no medida)**: auction con 0.25 vCPU tendria del orden de un cuarto de esa
  CPU, es decir la saturacion rondaria **25-30 estudiantes en sala** con este comportamiento de
  cliente. Comprobarlo con `SERVICE_CPUS=0.25 SERVICE_MEMORY=512m docker compose up -d --build
  --wait` y `load` con `USERS=25/50`.

## 10. Pendiente

- **Resistencia (`soak`)**: aplazada a pedido. Desde esta fecha los escenarios duran 10 min por
  defecto: `docker compose run --rm runner soak` muestra deriva entre rondas; para fugas lentas,
  `-- -e DURATION=45m`.

Las corridas de este informe usaron los perfiles anteriores (load con 10 min estables, stress con
escalones de 3 min); las siguientes usan los de 10 min en total (`ESTRATEGIA.md`).
- Corrida con limites de Azure (seccion 9).
- `bid-storm` con el codigo actual, para comparar con `RESULTADOS.md` (2026-10-16).

## 11. Recomendaciones (de mayor a menor impacto por esfuerzo)

1. **Indice para "mi mejor puja"** (C4): `@@index([bidderId, roundId])` en `Bid`. Cambio de una
   migracion; la consulta deja de leer todas las pujas de la sala. **Implementado**: p95 HTTP -29 % y
   CPU de Postgres -18 % con 100 en sala (seccion 12).
2. **Cortar la amplificacion** (C2), la palanca mas grande. **Implementado**: -80 % de peticiones,
   auction sin saturar hasta 400 en sala (seccion 13).
   - el frontend ya recibe en `round.price` el precio, el lider y el cierre: aplicar el evento al
     estado local y releer solo en transiciones (`round.activated/closed`, `room.status`) o si se
     detecta un hueco de `sequence`;
   - no releer `/notifications` en cada evento: los avisos personales ya llegan por `user:{id}`.
3. **Abaratar `GET /rooms/:id` y `/state`** (C3): una sola consulta (o vista) para el detalle, o
   un cache por sala de pocos cientos de ms invalidado por los eventos de la propia sala; la hora
   del servidor puede salir del mismo query.
4. **Reusar la conexion y el canal del outbox** (C6): una conexion con canal de confirmacion
   persistente y reconexion, en vez de una por ciclo. Baja la CPU de RabbitMQ y la latencia del
   evento.
5. **Medir la cola de pujas** (C9): histograma de espera del semaforo `MAX_LOCKED_SECTIONS` y de
   la RPC a wallet. Sin eso no se puede separar la contencion propia de la puja (H1) de la
   saturacion general.
6. **`room.join` sin depender de auction en cada join** (C8): validar con el token y un cache corto
   de acceso por sala.
7. **Escalar auction** solo despues de 1-4: hoy tiene supuestos de instancia unica (semaforo y
   deduplicacion de la puja automatica en memoria, scheduler y outbox sin coordinacion), y Azure
   lo fija en `max_replicas = 1`.

Estas recomendaciones siguen la linea del proyecto: operaciones cortas y tiempo real en vez de
transacciones mas pesadas.

## 12. Despues de la recomendacion 1: indice `bids(bidderId, roundId)`

Implementado en ecilost-auction-service (migracion `20261030000000_bids_bidder_round_index`).
`EXPLAIN ANALYZE` de "mi mejor puja" con datos reales (16 000 pujas): de 1.95 ms leyendo 1 615
filas por `bids_roundId_status_sequence_idx` a **0.25 ms** leyendo 169 por el indice nuevo.

`load` con 100 en sala, k6 en el equipo en ambas corridas. Promedio de los intervalos con la carga
completa (>= 115 VUs):

| | Sin indice (`load-d21b0487`, 2026-10-30) | Con indice (`load-4476af0c`, 2026-10-31) | Cambio |
|---|---|---|---|
| req/s atendidas | 559 | 632 | +13 % |
| p95 HTTP (todas) | 265 ms | 187 ms | -29 % |
| p95 puja | 442 ms | 298 ms | -33 % |
| p95 precio en vivo | 314 ms | 266 ms | -15 % |
| `room.join` p95 | 268 ms | 109 ms | -59 % |
| CPU auction / postgres (nucleos) | 0.93 / 0.91 | 0.80 / 0.75 | -14 % / -18 % |
| Tiempo de "mi mejor puja" en Postgres | 2.2 s por minuto (la consulta mas costosa) | 0.43 s por minuto (la cuarta) | -80 % |

Ambas corridas pasan todos los umbrales; `verify` sin fallas.

Salvedades: una corrida de cada lado; la de referencia uso el perfil de 13 min (10 estables) y la
nueva el de 10 min (7 estables); la base ya tenia mas pujas acumuladas en la segunda, lo que
juega en contra del indice. **auction sigue llegando a 100 % de utilizacion del event loop** con
100 en sala: el indice mueve el techo pero no lo quita. Lo siguiente con mas impacto son las
recomendaciones 2 y 3 (amplificacion de lecturas y costo de `GET /rooms/:id`).

## 13. Despues de la recomendacion 2: el precio en vivo no relee la sala

Implementado en ecilost-frontend: `round.price` y `round.extended` traen precio, lider y cierre
completos y se pintan sin pedir la sala (`domain/live-room-events.ts`, `subscribe` del gateway);
las transiciones, los modos dinamicos, la puja automatica propia y las reconexiones siguen
releyendo. La bandeja se relee solo cuando cambia algo de quien mira. k6 replica ese
comportamiento (`k6/flows/live-room.js`; `CLIENT_READS=legacy` reproduce el anterior).

`load` con 100 en sala, mismo perfil de 10 min, ambas con el indice de la seccion 12. Promedio de
los intervalos con la carga completa (>= 115 VUs) y conteos del servidor en toda la corrida:

| | Frontend anterior (`load-4476af0c`) | Precio aplicado (`load-67a36294`) | Cambio |
|---|---|---|---|
| req/s que genera la misma gente | 632 | 126 | **-80 %** |
| `GET /rooms/:id` / `/state` / `/notifications` en el servidor | 114 012 / 101 540 / 107 395 | 22 042 / 9 494 / 20 318 | -81 % / -91 % / -81 % |
| p95 HTTP (todas) | 187 ms | 20 ms | -89 % |
| p95 puja | 298 ms | 46 ms | -85 % |
| Puja enviada -> precio visto, p95 | 469 ms | 259 ms | -45 % |
| Precio en vivo p95 (requisito < 1 s) | 251 ms | 230 ms | = (lo pone el outbox) |
| `room.join` p95 | 109 ms | 10 ms | -91 % |
| CPU auction / engagement / postgres (nucleos) | 0.80 / 0.28 / 0.75 | 0.19 / 0.11 / 0.18 | -76 % / -61 % / -76 % |
| Utilizacion del event loop de auction (max) | 100 % | 15 % | |
| Pujas aceptadas/s | 2.65 | 3.26 | +23 % |
| 409 "otra llego primero" | 156 | 44 | -72 % |

Ambas sin errores, todos los umbrales cumplidos y `verify` sin fallas. Con 100 en sala auction
deja de estar saturado: la carga de lectura bajo cinco veces y la puja responde en ~50 ms. El
piso del precio en vivo (~230 ms) sigue siendo el sondeo del outbox (C7, recomendacion 4).

**Estres con el cliente nuevo** (`stress-fee36291`, perfil de 10 min: escalones de 1 min, distinto
de los 3 min de la seccion 5):

| En sala | req/s | p95 HTTP | p95 puja | Pujas aceptadas/s | CPU auction | Event loop p99 auction |
|---|---|---|---|---|---|---|
| 50 | 40-69 | 6-7 ms | 40-45 ms | 1.3-2.1 | 0.10-0.13 | 11 ms |
| 100 | 114-132 | 9-11 ms | 42-50 ms | 3.0-3.6 | 0.20-0.21 | 11 ms |
| 150 | 201-210 | 18-21 ms | 53-60 ms | 4.4-4.5 | 0.30-0.32 | 12 ms |
| 200 | 239-298 | 20-27 ms | 59-78 ms | 5.1-5.8 | 0.37-0.45 | 13-14 ms |
| 300 | 389-410 | 33-39 ms | 78-101 ms | 6.4-7.1 | 0.57-0.65 | 14-16 ms |
| 400 | 402-508 | 42-112 ms | 102-157 ms | 7.8-8.7 | 0.47-0.78 | 15-30 ms |
| 25 (recuperacion) | 34-36 | 6-7 ms | 48-49 ms | 1.0 | 0.08-0.10 | 11 ms |

- **Pasa todos los umbrales** (requisito y referencia) con hasta 400 en sala; 0 % de errores,
  ningun 5xx, `verify` sin fallas. Antes la referencia se rompia desde ~150.
- **Ya no hay saturacion en el rango probado**: auction llega a 0.82 nucleos y 69 % de
  utilizacion del event loop como maximo; las pujas aceptadas/s **crecen** con la carga (antes
  caian de 2.8 a 0.6). El techo quedo por encima de 400 en sala en este equipo; para ubicarlo hay
  que subir `STEPS`.
- Cola larga: p99 HTTP 781 ms y maximo 1.76 s en toda la corrida (algunas pujas en el ultimo
  escalon). Precio en vivo p95 232 ms en todos los escalones.
- `room.join` p95 27 ms (antes 917 ms). Cierre de ronda 143 ms despues de `endsAt`.

Con esto la estimacion para Azure de la seccion 9 queda desactualizada: con 0.25 vCPU auction ya no
satura en ~25-30 estudiantes. Hay que medirla con `SERVICE_CPUS=0.25 SERVICE_MEMORY=512m`.
