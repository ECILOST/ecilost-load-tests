# Métricas completas para Grafana

Levantar desde la raíz del repositorio:

```bash
docker compose up -d --build --wait auth catalog wallet auction engagement prometheus grafana cadvisor postgres-exporter
node scripts/verify-observability.mjs --wait-seconds 60
node scripts/evidence-suite.mjs
```

La batería ejecuta únicamente carga y estrés: diez minutos programados por perfil, más
preparación y cierre. Arranca los recolectores y comprueba su disponibilidad antes de crear
evidencias. Grafana se consulta en http://localhost:3300, con los enlaces por corrida del índice.

| Paneles | Fuente |
|---|---|
| Usuarios, HTTP cliente, checks, pujas, latencias y eventos | k6 → remote write de Prometheus |
| HTTP por plantilla, estado, CPU de proceso, memoria, heap, GC, handles, event loop y uptime | `/metrics` de auth, catalog, wallet, auction y engagement |
| Sockets actuales de `/realtime` | Gauge de engagement que lee el namespace real |
| CPU, memoria y presión de CPU por contenedor | cAdvisor |
| Conexiones, sesiones, locks, transacciones, caché y consultas | postgres-exporter y pg_stat_statements |
| Colas, confirmaciones, publicaciones, conexiones y memoria del broker | Endpoints de métricas de RabbitMQ |

`METRICS_ENABLED=true` activa la instrumentación. Por defecto queda desactivada en los servicios;
el endpoint no lleva autenticación y debe habilitarse solo en redes de observabilidad de confianza.
Usa `/metrics` también en wallet. La etiqueta `service` identifica cada microservicio; HTTP registra
plantillas como `/rooms/:roomId`, nunca tokens, query strings ni identificadores concretos.

Los paneles muestran cero cuando el fenómeno medido no ocurrió y existe una fuente válida:
errores con tráfico medido, checks correctos y colas sin pendientes. No se reemplaza una fuente
caída por datos inventados. Un target `up=0` indica fallo del scrape, no necesariamente del servicio.
Un percentil sin observaciones, por ejemplo sin cierre de ronda, permanece sin muestras.

Para auditar todas las consultas de los tableros sobre una corrida real:

```bash
node scripts/audit-dashboards.mjs --testid load-ID --from 2026-11-21T10:00:00Z --to 2026-11-21T10:10:30Z --out results/audit.json
```

El informe identifica paneles sin muestras finitas y errores de PromQL. Usa los tiempos reales
de `meta.json`, incluidas las conexiones que terminan después de los diez minutos programados.
Las métricas internas empiezan a existir después de desplegar esta instrumentación: las
evidencias anteriores permanecen históricas y no pueden completarse retroactivamente.
