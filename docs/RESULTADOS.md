# Resultados de las pruebas de carga

Solo hay numeros medidos. Lo que no se pudo comprobar se dice explicitamente.

## Entorno

| | |
|---|---|
| Maquina | AMD Ryzen 5 5600X (12 hilos), 32 GB RAM, Windows 11 |
| Servicios | Una instancia de cada uno (`npm run start`), en la misma maquina que k6 |
| Infraestructura | Docker 29.3.1, PostgreSQL 17.11, RabbitMQ local |
| Codigo | ecilost-auction-service `a5cf9a6`, ecilost-wallet-service `2840c65` (develop, 2026-10-16) |
| Herramienta | k6 v2.2.0 |

Los generadores de carga y los servicios comparten CPU: los numeros sirven para comparar niveles
entre si y encontrar cuellos de botella, no como capacidad de produccion.

## Escenario 1: tormenta de pujas (HU-20, HU-21, HU-23)

N estudiantes pujan durante 90 s sobre la misma ronda (`k6/scenarios/bid-storm.js`). Cada uno lee el estado
de la sala y puja el precio vigente + 100 a 500, con una pausa al azar de 0 a 1 s. Todos tienen
5.000.000 ECICoin, asi que ninguna puja deberia fallar por saldo.

| Estudiantes | Pujas enviadas | Aceptadas/s | p50 puja | p95 puja | p99 puja | 409 "otra llego primero" | 409 "saldo insuficiente" | 5xx |
|---|---|---|---|---|---|---|---|---|
| 10 (20 s, calibracion) | 336 | 11,4 | 68 ms | 187 ms | 624 ms | 98 en total (sin desglose) | — | 0 |
| 25 | 3.055 | 9,6 | 183 ms | 460 ms | 1,16 s | 1.541 | **495** | 0 |
| 50 | 3.233 | 2,6 | 807 ms | 1,50 s | 1,87 s | 2.318 | **641** | 0 |
| 100 | 2.332 | 0,7 | 3,23 s | 4,50 s | 6,86 s | 1.652 | **599** | 0 |

Leer el estado de la sala (`GET /rooms/:id/state`) se mantuvo rapido: p95 de 34 ms con 25
estudiantes y 108 ms con 100.

**Garantias (`scripts/verify.mjs`), en todas las corridas:** historial estrictamente creciente,
precio y lider iguales a la ultima puja aceptada, el lider con su precio reservado, ningun saldo
negativo y lo retenido igual a la suma de las reservas. **No se rompio ninguna regla de dinero ni de
orden.**

### Hallazgos

**H1. El rendimiento cae al subir la concurrencia (contencion).** Con mas estudiantes se aceptan
*menos* pujas por segundo (9,6 → 2,6 → 0,7) y cada puja tarda mas (p95 460 ms → 4,5 s). La fila
de la ronda serializa todas las pujas, y cada puja hace llamadas a wallet por RabbitMQ (reservar y,
si pierde, deshacer) mientras esta en la cola. Con 100 estudiantes, una puja tarda mas de 3 s en
responder, tiempo en el que el precio ya cambio y la puja casi siempre pierde.
*Estado: mejora parcial tras corregir wallet (ver "Despues de la correccion"); la fila de la ronda
sigue serializando las pujas.*

**H2. Wallet rechaza reservas validas y auction las reporta como "saldo insuficiente".** Entre el
16 % y el 26 % de las pujas recibieron "No tienes ECICoin disponibles suficientes" con 5.000.000 de
saldo. El log de wallet lo explica: cada operacion corre en una transaccion `SERIALIZABLE` con 3
reintentos, y las de billeteras distintas chocan entre si ("Transaction failed due to a write
conflict or a deadlock"). El consumidor convierte cualquier error en `{ accepted: false }`, que
auction no puede distinguir de falta de saldo. Durante el experimento de H4 (25 estudiantes 60 s
y luego 100 estudiantes 170 s) el log registro 1.287 reservas y 666 liberaciones rechazadas por
este motivo. Lo mismo hace fallar con 500 las
recargas de staff concurrentes a billeteras distintas.
*Estado: corregido (ver "Despues de la correccion").*

**H3. Reservas de estudiantes superados quedan retenidas.** Cuando la liberacion inmediata de quien
fue superado choca en wallet (H2), su reserva sigue retenida hasta que se liquide la ronda: 2, 6 y
13 reservas con 25, 50 y 100 estudiantes. Mientras tanto ese dinero no se puede usar en otra
ronda. No rompe el invariante (retenido = suma de reservas).
*Estado: no volvio a aparecer; las liberaciones dejaron de chocar.*

**H4 (critico). Wallet pierde liquidaciones bajo carga.** Si una ronda cierra mientras wallet esta
ocupado con reservas, `settleRound` choca igual que en H2, el consumidor reintenta **una sola vez**
y despues **descarta el mensaje** (la cola no tiene dead-letter). La ronda queda sin liquidar para
siempre: **al ganador nunca se le cobra** y **las reservas de los demas quedan retenidas**, mientras
catalog si marca el objeto como vendido.

- Observado en las corridas de 25 y 50 estudiantes, que cerraron mientras corria la siguiente:
  3 y 7 reservas retenidas y sin cobro, minutos despues del cierre.
- Reproducido a proposito: una sala con 25 estudiantes cerro a las 03:51:34 UTC durante una
  tormenta de 100 en otra sala. El log de wallet muestra en ese segundo "No se pudo liquidar la
  ronda (se reintenta)" y "(se descarta)"; la sala quedo con 6 reservas retenidas y el ganador sin
  cobrar 153.039.
- No siempre ocurre: una sala de 10 estudiantes que cerro durante una tormenta de 50 si se liquido.
  Con mas reservas en la ronda la transaccion de liquidacion es mas larga y mas propensa a chocar.
- Con el sistema en reposo, todas las liquidaciones se completaron.
- *Estado: corregido (ver "Despues de la correccion").*

## Despues de la correccion (H2 a H4)

| | |
|---|---|
| Codigo | ecilost-wallet-service `36fdbe8` (rama `feature/wallet-load-hardening`), ecilost-auction-service `3f9cb80` (rama `feature/wallet-rejection-reason`), 2026-10-17 |
| Wallet | READ COMMITTED con bloqueo de la fila de la billetera en vez de `SERIALIZABLE`; la liquidacion fallida pasa a una cola de reintento (1 s) y nunca se descarta; las respuestas de reserva/liberacion traen `reason` |
| Auction | Si wallet responde `RETRY` o `ERROR`, la puja responde 503 en vez de 409 "saldo insuficiente", y la puja automatica no se detiene |

Se repitio el experimento de H4: sala A con 25 estudiantes pujando 60 s y, mientras A cerraba, sala
B con 100 estudiantes pujando 170 s, con las mismas pausas que el escenario 1. Es mas exigente que
las corridas aisladas de la tabla de arriba: las dos salas comparten wallet y las primeras 25
billeteras. Se corrio dos veces: solo con wallet corregido (auction `a5cf9a6`) y con los dos
servicios corregidos.

| Corrida | Estudiantes | Pujas enviadas | Aceptadas/s | p50 puja | p95 puja | p99 puja | 409 "otra llego primero" | 409 "saldo insuficiente" | 5xx/503 |
|---|---|---|---|---|---|---|---|---|---|
| Solo wallet, sala A | 25 (60 s) | 1.389 | 8,4 | 108 ms | 2,32 s | 4,03 s | 821 | **0** | 0 |
| Solo wallet, sala B | 100 (170 s) | 7.482 | 1,5 | 1,63 s | 2,81 s | 3,43 s | 7.200 | **0** | 0 |
| Wallet + auction, sala A | 25 (60 s) | 1.343 | 8,0 | 111 ms | 2,07 s | 3,93 s | 807 | **0** | 0 |
| Wallet + auction, sala B | 100 (170 s) | 7.823 | 1,6 | 1,57 s | 2,09 s | 3,27 s | 7.522 | **0** | 0 |

Leer el estado de la sala se mantuvo en p95 de 7 a 14 ms.

| | Antes | Despues (las dos corridas) |
|---|---|---|
| Reservas / liberaciones rechazadas en el log de wallet (experimento H4) | 1.287 / 666 | 0 / 0 |
| Errores "write conflict or a deadlock" en el log de wallet (experimento H4) | 1.955 | 0 |
| Liquidacion de la sala A, que cerro durante la tormenta de B | descartada: 6 reservas retenidas, ganador sin cobrar | liquidada al primer intento, 0 reservas retenidas |
| 100 estudiantes: p50 / p95 de una puja | 3,23 s / 4,50 s | 1,57 a 1,63 s / 2,09 a 2,81 s |
| 100 estudiantes: pujas aceptadas por segundo | 0,7 | 1,5 a 1,6 |

**Garantias (`scripts/verify.mjs`) en las cuatro salas: sin fallas y sin avisos.** Ademas de las
comprobaciones del escenario 1: ninguna reserva tras liquidar y cobro al ganador igual al precio
adjudicado.

Lo que estas corridas no comprueban:

- La cola de reintento de la liquidacion no llego a usarse, porque ninguna liquidacion choco. Ese
  camino esta cubierto por las pruebas unitarias de wallet, no por la carga.
- Ninguna reserva recibio `RETRY`, asi que el 503 de auction no aparecio en la carga. Esta cubierto
  por las pruebas unitarias de auction.
- H1 sigue: con 100 estudiantes cada puja tarda mas de 1,5 s y se aceptan menos de 2 por segundo,
  porque la fila de la ronda sigue serializando las pujas y sus llamadas a wallet.
