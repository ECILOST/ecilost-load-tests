// Genera los tableros de Grafana (observability/grafana/dashboards/*.json) desde esta unica
// definicion: un panel nuevo o una consulta corregida se cambia aqui y se regenera, en vez de
// editar cuatro JSON largos a mano. Grafana los carga al arrancar (provisioning).
//
//   node observability/grafana/build-dashboards.mjs
//
// Lado cliente (k6, filtrado por la variable testid) y lado servidor (servicios, Postgres,
// RabbitMQ, contenedores) comparten la ventana de tiempo: asi se cruzan. Las series del servidor
// no llevan testid; la ventana exacta de cada corrida esta en results/<corrida>/meta.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'dashboards');
const DS = { type: 'prometheus', uid: 'prometheus' };
const K6 = 'testid=~"$testid"';
const RI = '$__rate_interval';
/** Requisito de tiempo real (< 1 s): linea roja en los paneles de latencia que lo miden. */
const REALTIME_LIMIT = 1;

// --- Constructores -----------------------------------------------------------------------
let nextId = 1;

function target(expr, legend, extra = {}) {
  return { datasource: DS, expr, legendFormat: legend ?? '__auto', range: true, ...extra };
}

function thresholdSteps(limit) {
  return limit === undefined
    ? { mode: 'absolute', steps: [{ color: 'green', value: null }] }
    : { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value: limit }] };
}

/** Serie temporal. `limit` dibuja una linea de umbral (rojo por encima). */
function series(title, targets, { unit = 'short', limit, description, stack = false, min, w = 12, h = 8, right, noValue } = {}) {
  return {
    id: nextId++, type: 'timeseries', title, description, datasource: DS, w, h,
    targets: targets.map((t, i) => ({ ...t, refId: String.fromCharCode(65 + i) })),
    fieldConfig: {
      defaults: {
        unit, min, noValue,
        thresholds: thresholdSteps(limit),
        custom: {
          // Sin unir huecos: un tramo sin datos (sin trafico) no debe dibujarse como una recta.
          drawStyle: 'line', lineWidth: 1, fillOpacity: stack ? 30 : 8, showPoints: 'never', spanNulls: false,
          stacking: { mode: stack ? 'normal' : 'none', group: 'A' },
          thresholdsStyle: { mode: limit === undefined ? 'off' : 'line' },
        },
      },
      // `right`: regex de series que van en el eje derecho (p. ej. VUs contra latencia).
      overrides: right ? [{ matcher: { id: 'byRegexp', options: right }, properties: [{ id: 'custom.axisPlacement', value: 'right' }, { id: 'unit', value: 'short' }] }] : [],
    },
    options: { legend: { displayMode: 'table', placement: 'bottom', calcs: ['mean', 'max', 'lastNotNull'] }, tooltip: { mode: 'multi', sort: 'desc' } },
  };
}

function stat(title, expr, { unit = 'short', limit, description, w = 4, h = 4, decimals } = {}) {
  return {
    id: nextId++, type: 'stat', title, description, datasource: DS, w, h,
    targets: [{ ...target(expr, title), refId: 'A', instant: false }],
    fieldConfig: { defaults: { unit, decimals, thresholds: thresholdSteps(limit), color: { mode: 'thresholds' } }, overrides: [] },
    options: { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'value', graphMode: 'area', textMode: 'auto' },
  };
}

function table(title, expr, { description, w = 12, h = 8, unit = 's' } = {}) {
  return {
    id: nextId++, type: 'table', title, description, datasource: DS, w, h,
    targets: [{ ...target(expr, ''), refId: 'A', instant: true, range: false, format: 'table' }],
    fieldConfig: { defaults: { unit }, overrides: [] },
    transformations: [{ id: 'organize', options: { excludeByName: { Time: true, instance: true, job: true } } }],
    options: { showHeader: true, sortBy: [{ displayName: 'Value', desc: true }] },
  };
}

function row(title) {
  return { id: nextId++, type: 'row', title, collapsed: false, w: 24, h: 1, panels: [] };
}

function text(content, { w = 24, h = 3 } = {}) {
  return { id: nextId++, type: 'text', title: '', w, h, options: { mode: 'markdown', content } };
}

/** Coloca los paneles de izquierda a derecha, saltando de linea al llenar 24 columnas. */
function layout(panels) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return panels.map(({ w, h, ...panel }) => {
    if (panel.type === 'row' || x + w > 24) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    const placed = { ...panel, gridPos: { x, y, w, h } };
    x += w;
    rowHeight = Math.max(rowHeight, h);
    if (panel.type === 'row') {
      y += h;
      x = 0;
      rowHeight = 0;
    }
    return placed;
  });
}

const testidVariable = {
  name: 'testid', label: 'Corrida (testid)', type: 'query', datasource: DS,
  query: { query: 'label_values(k6_vus, testid)', refId: 'testid' },
  definition: 'label_values(k6_vus, testid)', refresh: 2, sort: 2, multi: true, includeAll: true, allValue: '.*',
  current: {}, hide: 0,
};

const serviceVariable = {
  name: 'service', label: 'Servicio', type: 'query', datasource: DS,
  query: { query: 'label_values(http_server_request_duration_seconds_count, service)', refId: 'service' },
  definition: 'label_values(http_server_request_duration_seconds_count, service)', refresh: 2, sort: 1, multi: true, includeAll: true, allValue: '.*',
  current: {}, hide: 0,
};

function dashboard(uid, title, description, variables, panels) {
  nextId = 1;
  return {
    uid, title, description, tags: ['ecilost', 'rendimiento'], editable: true, graphTooltip: 1,
    timezone: 'browser', refresh: '10s', schemaVersion: 39, version: 1,
    time: { from: 'now-30m', to: 'now' },
    templating: { list: variables },
    links: [{ title: 'Tableros ECILOST', type: 'dashboards', tags: ['ecilost'], asDropdown: true, includeVars: true, keepTime: true }],
    panels: layout(panels),
  };
}

// --- PromQL reutilizado --------------------------------------------------------------------
const k6Quantile = (q, metric, by = '') => `histogram_quantile(${q}, sum ${by ? `by (${by}) ` : ''}(rate(${metric}{${K6}}[${RI}])))`;
/**
 * Percentil acumulado desde el inicio de la corrida. k6 solo envia una serie cuando tiene
 * muestras nuevas: para eventos escasos (cierres de ronda, conexiones, room.join) rate() no
 * tiene dos puntos en la ventana y no devuelve nada; el histograma acumulado si.
 */
const k6QuantileSoFar = (q, metric) => `histogram_quantile(${q}, sum(${metric}{${K6}}))`;
const svcQuantile = (q, by) => `histogram_quantile(${q}, sum by (le, ${by}) (rate(http_server_request_duration_seconds_bucket{job="services", service=~"$service", route!="/metrics"}[${RI}])))`;
// `or vector(0)`: sin peticiones fallidas la serie no existe y el panel diria "No data" en vez de 0 %.
const k6ErrorRatio = `(sum(rate(k6_http_reqs_total{${K6}, expected_response="false"}[${RI}])) or vector(0)) / sum(rate(k6_http_reqs_total{${K6}}[${RI}]))`;
const containerCpu = `sum by (container) (rate(container_cpu_usage_seconds_total[${RI}]))`;
const pgLockWaits = 'sum by (datname) (pg_stat_activity_count{datname=~".*_load", wait_event_type="Lock"})';

// --- 1. Correlacion ------------------------------------------------------------------------
const overview = dashboard('ecilost-overview', 'ECILOST · Correlacion', 'Usuarios de k6 contra latencia, tiempo real y recursos en la misma linea de tiempo.', [testidVariable], [
  text('**Como leerlo.** Arriba lo que vive el usuario (k6, filtrado por *testid*); abajo lo que pasa en el servidor en la misma ventana. ' +
    'Una degradacion se explica buscando, en el mismo instante, que recurso sube: CPU de un contenedor, event loop de un servicio, sesiones esperando un lock en Postgres o mensajes acumulados en una cola. ' +
    'Linea roja = requisito de tiempo real (1 s). Los demas umbrales son de referencia (docs/ESTRATEGIA.md).'),
  stat('VUs activos', `sum(k6_vus{${K6}})`),
  stat('Peticiones/s (k6)', `sum(rate(k6_http_reqs_total{${K6}}[${RI}]))`, { unit: 'reqps' }),
  stat('Errores HTTP', k6ErrorRatio, { unit: 'percentunit', limit: 0.01, decimals: 2 }),
  stat('p95 HTTP (todas)', k6Quantile(0.95, 'k6_http_req_duration_seconds'), { unit: 's', limit: 0.3 }),
  stat('p95 precio en vivo', k6Quantile(0.95, 'k6_realtime_price_propagation_seconds'), { unit: 's', limit: REALTIME_LIMIT, description: 'Puja aceptada -> precio en el socket (requisito < 1 s).' }),
  stat('Pujas aceptadas/s', `sum(rate(k6_bids_accepted_total{${K6}}[${RI}]))`, { unit: 'reqps' }),
  series('Usuarios contra latencia p95', [
    target(k6Quantile(0.95, 'k6_http_req_duration_seconds', 'name'), 'p95 {{name}}'),
    target(`sum(k6_vus{${K6}})`, 'VUs'),
  ], { unit: 's', right: '^VUs$', w: 24, h: 9 }),
  series('Tiempo real (requisito < 1 s)', [
    target(k6Quantile(0.95, 'k6_realtime_price_propagation_seconds'), 'p95 precio en vivo'),
    target(k6Quantile(0.95, 'k6_realtime_bid_to_price_seconds'), 'p95 puja -> precio visto'),
    target(k6QuantileSoFar(0.95, 'k6_realtime_round_close_lag_seconds'), 'p95 retraso de cierre de ronda (acumulado)'),
    target(k6Quantile(0.95, 'k6_realtime_event_delivery_seconds'), 'p95 entrega del socket'),
  ], { unit: 's', limit: REALTIME_LIMIT }),
  series('Errores y pujas', [
    target(`sum(rate(k6_http_reqs_total{${K6}, expected_response="false"}[${RI}]))`, 'HTTP fallidas/s'),
    target(`sum(rate(k6_bids_unavailable_total{${K6}}[${RI}]))`, 'pujas 5xx/s'),
    target(`sum(rate(k6_bids_accepted_total{${K6}}[${RI}]))`, 'pujas aceptadas/s'),
    target(`sum(rate(k6_ws_errors_total{${K6}}[${RI}]))`, 'errores de socket/s'),
  ], { unit: 'reqps' }),
  row('Servidor en la misma ventana'),
  series('CPU por contenedor (nucleos)', [target(containerCpu, '{{container}}')], { unit: 'short', w: 8 }),
  series('Event loop p99 por servicio', [target('max by (service) (nodejs_eventloop_lag_p99_seconds{job="services"})', '{{service}}')], { unit: 's', w: 8, description: 'Base de ~10 ms = resolucion del muestreo de la libreria (eventLoopMonitoringPrecision), no lentitud. Un event loop atascado frena todas las peticiones del proceso, no solo la lenta.' }),
  series('p95 por servicio (lado servidor)', [target('histogram_quantile(0.95, sum by (le, service) (rate(http_server_request_duration_seconds_bucket{route!="/metrics"}[$__rate_interval])))', '{{service}}')], { unit: 's', w: 8 }),
  series('Postgres: sesiones esperando un lock', [target(pgLockWaits, '{{datname}}')], { unit: 'short', w: 8, noValue: '0', description: 'Sesiones bloqueadas por otra transaccion (FOR UPDATE de la ronda, advisory lock del pujador).' }),
  series('Postgres: conexiones por base', [target('sum by (datname) (pg_stat_database_numbackends{datname=~".*_load"})', '{{datname}}')], { unit: 'short', w: 8 }),
  series('RabbitMQ: mensajes sin consumir por cola', [target('sum by (queue) (rabbitmq_detailed_queue_messages_ready + rabbitmq_detailed_queue_messages_unacked) > 0', '{{queue}}')], { unit: 'short', w: 8, noValue: '0', description: 'Listos + sin confirmar. Una cola que crece es un consumidor que no da abasto.' }),
]);

// --- 2. k6 ---------------------------------------------------------------------------------
const k6 = dashboard('ecilost-k6', 'ECILOST · k6', 'Comportamiento de la carga y de las peticiones vistas por el cliente.', [testidVariable], [
  text('Metricas de k6 por remote write (prefijo `k6_`, etiqueta `testid`). k6 no exporta el estado de los umbrales: el veredicto de cada corrida esta en `results/<corrida>/summary.json` ' +
    '(un umbral en `false` = cumplido) y en `k6.txt`. Las lineas rojas marcan el valor de cada umbral.', { h: 2 }),
  series('VUs', [target(`sum by (testid) (k6_vus{${K6}})`, 'activos {{testid}}'), target(`sum by (testid) (k6_vus_max{${K6}})`, 'maximo {{testid}}')], { w: 8 }),
  series('Iteraciones completadas por escenario', [target(`sum by (scenario) (k6_iterations_total{${K6}})`, '{{scenario}}')], { w: 8, description: 'Acumulado. Una iteracion de sala es una sesion completa (minutos); la del catalogo, una visita.' }),
  series('Peticiones/s: exitosas y fallidas', [
    target(`sum(rate(k6_http_reqs_total{${K6}, expected_response="true"}[${RI}]))`, 'exitosas'),
    target(`sum(rate(k6_http_reqs_total{${K6}, expected_response="false"}[${RI}]))`, 'fallidas'),
  ], { unit: 'reqps', stack: true, w: 8 }),
  series('Peticiones/s por endpoint', [target(`sum by (name) (rate(k6_http_reqs_total{${K6}}[${RI}]))`, '{{name}}')], { unit: 'reqps' }),
  series('Tasa de error por endpoint', [target(`sum by (name) (rate(k6_http_reqs_total{${K6}, expected_response="false"}[${RI}])) / sum by (name) (rate(k6_http_reqs_total{${K6}}[${RI}]))`, '{{name}}')], { unit: 'percentunit', limit: 0.01, noValue: '0' }),
  series('Duracion promedio por endpoint', [target(`histogram_avg(sum by (name) (rate(k6_http_req_duration_seconds{${K6}}[${RI}])))`, '{{name}}')], { unit: 's', w: 8 }),
  series('p50 por endpoint', [target(k6Quantile(0.5, 'k6_http_req_duration_seconds', 'name'), '{{name}}')], { unit: 's', w: 8 }),
  series('p90 por endpoint', [target(k6Quantile(0.9, 'k6_http_req_duration_seconds', 'name'), '{{name}}')], { unit: 's', w: 8 }),
  series('p95 por endpoint', [target(k6Quantile(0.95, 'k6_http_req_duration_seconds', 'name'), '{{name}}')], { unit: 's', limit: 0.3, description: 'Referencia: lecturas p95 < 300 ms; pujas p95 < 1 s.' }),
  series('p99 por endpoint', [target(k6Quantile(0.99, 'k6_http_req_duration_seconds', 'name'), '{{name}}')], { unit: 's' }),
  series('Desglose de una peticion (p95)', [
    target(k6Quantile(0.95, 'k6_http_req_blocked_seconds'), 'bloqueada (pool del cliente)'),
    target(k6Quantile(0.95, 'k6_http_req_connecting_seconds'), 'conectando'),
    target(k6Quantile(0.95, 'k6_http_req_waiting_seconds'), 'esperando al servidor (TTFB)'),
    target(k6Quantile(0.95, 'k6_http_req_receiving_seconds'), 'recibiendo'),
  ], { unit: 's', description: 'Si "esperando" domina, el tiempo lo pone el servidor; si "bloqueada", el generador de carga.' }),
  series('Checks fallidos (acumulado)', [target(`1 - avg by (check) (k6_checks_rate{${K6}}) > 0`, '{{check}}')], { unit: 'percentunit', description: 'Solo aparecen los checks con alguna falla.' }),
  row('Pujas'),
  series('Resultado de las pujas/s', [
    target(`sum(rate(k6_bids_accepted_total{${K6}}[${RI}]))`, 'aceptada'),
    target(`sum(rate(k6_bids_409_outbid_total{${K6}}[${RI}]))`, '409 otra llego primero'),
    target(`sum(rate(k6_bids_409_below_minimum_total{${K6}}[${RI}]))`, '409 bajo el minimo'),
    target(`sum(rate(k6_bids_409_insufficient_funds_total{${K6}}[${RI}]))`, '409 fondos insuficientes'),
    target(`sum(rate(k6_bids_409_round_closed_total{${K6}}[${RI}]))`, '409 ronda cerrada'),
    target(`sum(rate(k6_bids_409_other_total{${K6}}[${RI}]))`, '409 otro'),
    target(`sum(rate(k6_bids_unavailable_total{${K6}}[${RI}]))`, '5xx / sin respuesta'),
  ], { unit: 'reqps', stack: true }),
  series('Tiempo real (requisito < 1 s)', [
    target(k6Quantile(0.5, 'k6_realtime_price_propagation_seconds'), 'p50 precio en vivo'),
    target(k6Quantile(0.95, 'k6_realtime_price_propagation_seconds'), 'p95 precio en vivo'),
    target(k6Quantile(0.99, 'k6_realtime_price_propagation_seconds'), 'p99 precio en vivo'),
    target(k6Quantile(0.95, 'k6_realtime_bid_to_price_seconds'), 'p95 puja -> precio visto'),
    target(k6QuantileSoFar(0.95, 'k6_realtime_round_close_lag_seconds'), 'p95 retraso de cierre (acumulado)'),
    target(`sum(rate(k6_realtime_price_events_missed_total{${K6}}[${RI}]))`, 'precios no recibidos/s'),
  ], { unit: 's', limit: REALTIME_LIMIT }),
  row('Socket.IO'),
  series('Sesiones de socket (acumulado)', [target(`sum(k6_ws_sessions_total{${K6}})`, 'sesiones abiertas'), target(`sum by (reason) (k6_ws_errors_total{${K6}})`, 'errores {{reason}}')], { w: 8 }),
  series('Conexion y room.join (p95 acumulado)', [
    target(k6QuantileSoFar(0.95, 'k6_ws_connect_duration_seconds'), 'conexion al namespace'),
    target(k6QuantileSoFar(0.95, 'k6_ws_join_duration_seconds'), 'room.join -> ack'),
  ], { unit: 's', w: 8 }),
  series('Eventos recibidos/s por tipo', [target(`sum by (event) (rate(k6_ws_events_received_total{${K6}}[${RI}]))`, '{{event}}')], { unit: 'reqps', w: 8 }),
]);

// --- 3. Servicios ----------------------------------------------------------------------------
const services = dashboard('ecilost-services', 'ECILOST · Servicios', 'Lado servidor de cada microservicio (GET /metrics con METRICS_ENABLED=true).', [serviceVariable], [
  series('Peticiones/s por ruta', [target(`sum by (service, route) (rate(http_server_request_duration_seconds_count{job="services", service=~"$service", route!="/metrics"}[${RI}]))`, '{{service}} {{route}}')], { unit: 'reqps' }),
  series('Respuestas 5xx y 4xx/s', [
    target(`sum by (service, route) (rate(http_server_request_duration_seconds_count{job="services", service=~"$service", status_code=~"5.."}[${RI}]))`, '5xx {{service}} {{route}}'),
    target(`sum by (service, route, status_code) (rate(http_server_request_duration_seconds_count{job="services", service=~"$service", status_code=~"4.."}[${RI}]))`, '{{status_code}} {{service}} {{route}}'),
  ], { unit: 'reqps' }),
  series('p95 por ruta', [target(svcQuantile(0.95, 'service, route'), '{{service}} {{route}}')], { unit: 's', limit: 0.3 }),
  series('p99 por ruta', [target(svcQuantile(0.99, 'service, route'), '{{service}} {{route}}')], { unit: 's' }),
  row('Proceso Node.js'),
  series('CPU del proceso (nucleos)', [target(`sum by (service) (rate(process_cpu_seconds_total{job="services", service=~"$service"}[${RI}]))`, '{{service}}')], { w: 8, description: 'Node ejecuta JavaScript en un solo hilo: cerca de 1 nucleo es saturacion aunque el contenedor tenga mas.' }),
  series('Utilizacion del event loop', [target(`avg by (service) (nodejs_eventloop_utilization_summary{job="services", service=~"$service", quantile="0.5"})`, '{{service}}')], { unit: 'percentunit', w: 8 }),
  series('Event loop lag (p99)', [target(`max by (service) (nodejs_eventloop_lag_p99_seconds{job="services", service=~"$service"})`, '{{service}}')], { unit: 's', w: 8, description: 'Base de ~10 ms = resolucion del muestreo de la libreria (eventLoopMonitoringPrecision), no lentitud. ' }),
  series('Memoria residente', [target('max by (service) (process_resident_memory_bytes{job="services", service=~"$service"})', '{{service}}')], { unit: 'bytes', w: 8, description: 'Crecimiento sostenido sin bajar tras los GC en una corrida larga = posible fuga.' }),
  series('Heap usado / total', [
    target('max by (service) (nodejs_heap_size_used_bytes{job="services", service=~"$service"})', 'usado {{service}}'),
    target('max by (service) (nodejs_heap_size_total_bytes{job="services", service=~"$service"})', 'total {{service}}'),
  ], { unit: 'bytes', w: 8 }),
  series('Tiempo en GC (s/s)', [target(`sum by (service, kind) (rate(nodejs_gc_duration_seconds_sum{job="services", service=~"$service"}[${RI}]))`, '{{service}} {{kind}}')], { unit: 's', w: 8 }),
  series('Handles activos', [target('max by (service) (nodejs_active_handles_total{job="services", service=~"$service"})', '{{service}}')], { w: 8, description: 'Sockets, timers y conexiones abiertas. Si crecen sin parar: conexiones que no se cierran.' }),
  series('Sockets conectados (engagement)', [target('max(realtime_connected_sockets)', 'engagement /realtime')], { w: 8 }),
  series('Tiempo en marcha', [target('min by (service) (time() - process_start_time_seconds{job="services", service=~"$service"})', '{{service}}')], { unit: 's', w: 8, description: 'Si cae a cero, el servicio se reinicio (caida o falta de memoria).' }),
]);

// --- 4. Infraestructura ------------------------------------------------------------------------
const infra = dashboard('ecilost-infra', 'ECILOST · Infraestructura', 'Contenedores, Postgres y RabbitMQ del sistema bajo prueba.', [], [
  series('Disponibilidad de los targets', [target('up', '{{job}} {{instance}}')], { min: 0, w: 24, h: 6, description: '1 = Prometheus pudo raspar el target. Un 0 durante una corrida es una caida.' }),
  row('Contenedores (cAdvisor)'),
  series('CPU por contenedor (nucleos)', [target(containerCpu, '{{container}}')], { w: 8 }),
  series('Memoria (working set)', [target('sum by (container) (container_memory_working_set_bytes)', '{{container}}')], { unit: 'bytes', w: 8 }),
  series('CPU: tiempo esperando turno', [target(`sum by (container) (rate(container_pressure_cpu_waiting_seconds_total[${RI}]))`, '{{container}}')], { unit: 's', w: 8, description: 'Presion de CPU: el contenedor queria correr y no habia CPU (limite o equipo saturado, incluido k6).' }),
  row('Postgres (un servidor, una base por servicio)'),
  series('Conexiones por base', [target('sum by (datname) (pg_stat_database_numbackends{datname=~".*_load"})', '{{datname}}'), target('max(pg_settings_max_connections)', 'max_connections')], { w: 8 }),
  series('Sesiones por estado', [target('sum by (datname, state) (pg_stat_activity_count{datname=~".*_load"}) > 0', '{{datname}} {{state}}')], { w: 8, description: '"idle in transaction" alto = transacciones abiertas esperando a la aplicacion.' }),
  series('Sesiones esperando un lock', [target(pgLockWaits, '{{datname}}')], { w: 8, noValue: '0' }),
  series('Locks por modo', [target('sum by (datname, mode) (pg_locks_count{datname=~".*_load"}) > 0', '{{datname}} {{mode}}')], { w: 8 }),
  series('Transacciones/s', [
    target(`sum by (datname) (rate(pg_stat_database_xact_commit{datname=~".*_load"}[${RI}]))`, 'commit {{datname}}'),
    target(`sum by (datname) (rate(pg_stat_database_xact_rollback{datname=~".*_load"}[${RI}]))`, 'rollback {{datname}}'),
  ], { unit: 'ops', w: 8 }),
  series('Deadlocks y transaccion mas larga', [
    target(`sum by (datname) (increase(pg_stat_database_deadlocks{datname=~".*_load"}[${RI}]))`, 'deadlocks {{datname}}'),
    target('max by (datname) (pg_stat_activity_max_tx_duration{datname=~".*_load"})', 'tx mas larga (s) {{datname}}'),
  ], { w: 8 }),
  series('Filas escritas/s', [
    target(`sum by (datname) (rate(pg_stat_database_tup_inserted{datname=~".*_load"}[${RI}]))`, 'insert {{datname}}'),
    target(`sum by (datname) (rate(pg_stat_database_tup_updated{datname=~".*_load"}[${RI}]))`, 'update {{datname}}'),
  ], { unit: 'ops', w: 12 }),
  series('Aciertos de cache', [target(`sum by (datname) (rate(pg_stat_database_blks_hit{datname=~".*_load"}[${RI}])) / (sum by (datname) (rate(pg_stat_database_blks_hit{datname=~".*_load"}[${RI}])) + sum by (datname) (rate(pg_stat_database_blks_read{datname=~".*_load"}[${RI}])))`, '{{datname}}')], { unit: 'percentunit', w: 12 }),
  table('Consultas con mas tiempo en la ventana (pg_stat_statements)', 'topk(10, sum by (datname, queryid) (increase(pg_stat_statements_seconds_total{datname=~".*_load"}[$__range])))', {
    w: 24, description: 'El texto de cada queryid: SELECT query FROM pg_stat_statements WHERE queryid = <id> (ver docs/EJECUCION.md).',
  }),
  row('RabbitMQ'),
  series('Mensajes listos por cola', [target('sum by (queue) (rabbitmq_detailed_queue_messages_ready) > 0', '{{queue}}')], { w: 8, noValue: '0' }),
  series('Mensajes sin confirmar por cola', [target('sum by (queue) (rabbitmq_detailed_queue_messages_unacked) > 0', '{{queue}}')], { w: 8, noValue: '0', description: 'Entregados al consumidor y aun sin ack: trabajo en curso.' }),
  series('Publicados y entregados/s', [
    target(`sum(rate(rabbitmq_global_messages_received_total[${RI}]))`, 'publicados'),
    target(`sum(rate(rabbitmq_global_messages_delivered_total[${RI}]))`, 'entregados'),
    target(`sum(rate(rabbitmq_global_messages_dead_lettered_rejected_total[${RI}]))`, 'a dead-letter'),
  ], { unit: 'ops', w: 8 }),
  series('Conexiones abiertas/s', [target(`sum(rate(rabbitmq_connections_opened_total[${RI}]))`, 'abiertas/s'), target(`sum(rate(rabbitmq_connections_closed_total[${RI}]))`, 'cerradas/s')], { unit: 'ops', w: 8, description: 'El outbox de auction abre una conexion por ciclo con pendientes: crece con las pujas.' }),
  series('Conexiones y canales', [target('sum(rabbitmq_connections)', 'conexiones'), target('sum(rabbitmq_channels)', 'canales')], { w: 8 }),
  series('Memoria del broker', [target('sum(rabbitmq_process_resident_memory_bytes)', 'rabbitmq')], { unit: 'bytes', w: 8 }),
]);

mkdirSync(OUT, { recursive: true });
for (const board of [overview, k6, services, infra]) {
  writeFileSync(join(OUT, `${board.uid}.json`), `${JSON.stringify(board, null, 2)}\n`);
  console.log(`${board.uid}.json: ${board.panels.length} paneles`);
}
