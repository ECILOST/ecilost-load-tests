# Validación de adaptación de endpoints

Entorno: Docker Compose local de carga, servicios reconstruidos desde el código disponible.
No se generó carga sobre producción ni tráfico hacia Google.

| Prueba | Evidencia | Resultado |
|---|---|---|
| Humo k6 de sala, chat y lecturas actuales | `smoke-20261121-071050-5db02d06` | 1068 checks correctos; 531 peticiones, cero errores; verificación sin fallas ni avisos |
| Humo dinámico: reclamación holandesa y pujas/lecturas misteriosas | `smoke-20261121-071214-1c42651e` | 920 checks correctos; 461 peticiones, cero errores; verificación sin fallas ni avisos |
| Carga de recogidas, 3 usuarios durante 15 s | `pickup-load-20261121-070710-9df263cd` | 119 checks correctos; cero errores; verificación sin fallas ni avisos |
| Estrés de recogidas, escalones 1/2/3, rampas 3 s y mesetas 5 s | `pickup-stress-20261121-070931-8077dde9` | 162 checks correctos; cero errores; verificación sin fallas ni avisos |
| Flujo funcional concurrente | `results/adaptation/journey-smoke.log`, corrida `76f7ae02` | Ganador único de compra, replay idempotente, último cupo, ayuda/respuesta, entrega única, chat; liquidación estricta correcta |
| Expiración y reconexión de sesión | `results/adaptation/session-smoke.log` | JWT corto desconecta; token vigente permite reconectar y entrar a sala |
| Verificador por modalidad | `npm test` | 4 pruebas correctas |
| Carga sostenida: 100 usuarios en sala y 20 visitantes, meseta 3 min, ventana total 5 min | `load-20261121-074430-492c994d` | 40.772 peticiones, cero errores; p95 precio por socket 225 ms; 767 pujas aceptadas; verificación sin fallas ni avisos |
| Estrés: 50/100/200/400 usuarios en sala más 20 visitantes y recuperación | `stress-20261121-075050-75e21dae` | 55.423 peticiones, cero errores; p95 precio por socket 318 ms; 521 pujas aceptadas; verificación sin fallas ni avisos |
| Lecturas con modelo abierto: 100/200/400 ciclos/s, máximo 200 VUs | `stress-reads-20261121-075506-ee3067e8` | Degradación detectada: p95 sala 694 ms, estado 691 ms y 6.987 iteraciones descartadas; 60.087 peticiones sin errores HTTP; verificación sin fallas ni avisos |
| Lecturas posteriores a 50 ciclos/s, sala de sobres con 3 participantes | `stress-reads-20261121-075810-d631c9b9` | 5.559 peticiones, cero errores y cero descartes; p95 sala 5 ms y estado 4 ms; verificación sin fallas ni avisos |
| Sobres con cierre por el reloj real del servidor | `results/adaptation/sealed-smoke.log`, corrida `d631c9b9` | Tres ofertas de 1000/2000/1500, duplicado rechazado, ranking privado hasta el cierre y luego anónimo y ordenado; ganador único por 2000, un solo cierre, un solo cobro y ninguna reserva pendiente |

Los artefactos completos permanecen en `results/`, ignorado por Git. Cada corrida k6 conserva
resumen, informe, verificación y métricas. Los fixtures y tokens permanecen en `.data/`, también
ignorado por Git. No se deben publicar los tokens ni los códigos de entrega.

La carga nominal mantuvo 120 usuarios totales durante una meseta de tres minutos. El estrés
alcanzó 420 usuarios totales, con recuperación posterior. El perfil abierto de lecturas incumplió
los umbrales de latencia y de iteraciones descartadas; k6 salió con 99, que aquí es evidencia de
degradación, no un resultado aprobado. Agotó el límite de 200 VUs del generador: no se puede
atribuir toda la pérdida de ritmo al servidor ni derivar una capacidad máxima universal.
Los resultados corresponden a este equipo, estos datos y estas duraciones; no prueban fugas
lentas ni comportamiento de producción. Las corridas sin cierre no prueban su latencia.
La autenticación usa JWT sintéticos; login Google y renovación de cookies quedan fuera.
Las modalidades dinámicas se sortean mediante API: preparar varias no garantiza ejecutarlas
todas antes de terminar la sesión.

El cierre de sobres se ejecutó con `scripts/sealed-smoke.mjs`: sorteo real de ocho salas de una
ronda, selección de una que obtuvo SEALED y tres participantes. La preparación tiene un máximo
de tres intentos si el sorteo no produce SEALED. Se esperó el vencimiento natural de tres minutos,
sin modificar modalidades, fechas ni tablas directamente. La verificación financiera fue estricta.

Los informes incluyen ahora las rutas HTTP sin umbral propio mediante histogramas de Prometheus.
Una métrica de tiempo real sin observaciones se marca como `sin muestras` en la tabla de umbrales.
La validación se realizó en `feature/current-endpoint-load-tests`.

## Evidencias finales de diez minutos: carga y estrés

Alcance ajustado por el usuario: únicamente `load` y `stress`. La cola de otros escenarios se
canceló; `smoke` ya había terminado antes del ajuste. Cada curva de carga sumó 600 segundos,
verificados contra las opciones exportadas por k6; el cierre de conexiones añadió unos 30 segundos.

| Prueba | Corrida | Peticiones | Errores HTTP / socket | p95 precio por socket | p95 cierre | Resultado |
|---|---|---|---|---|---|---|
| Carga, 100 usuarios en sala + 20 visitantes | `load-e38953ca` | 94.530 | 0 / 0 | 232 ms | 115 ms | Umbrales y verificación correctos, sin avisos |
| Estrés hasta 400 usuarios en sala + 20 visitantes y recuperación | `stress-c8df39bf` | 195.530 | 0 / 0 | 236 ms | 388 ms | Umbrales y verificación correctos, sin avisos |

Índice local: `results/evidence-10m-2026-11-21T08-06-40-407Z/README.md`. Incluye enlaces a Grafana
con intervalos de 600 segundos, informes, configuración efectiva y resumen JSON. Las carpetas
de cada corrida conservan métricas, logs y verificaciones completas.

Se levantaron cAdvisor y postgres-exporter antes de estas corridas; ambos recolectores, RabbitMQ
y las métricas de k6 aportaron datos. Los cinco servicios actuales responden 404 en `/metrics`,
por lo que sus paneles internos de aplicación permanecen sin muestras. Grafana queda disponible
en `http://localhost:3300`; las series tienen retención configurada de quince días.
