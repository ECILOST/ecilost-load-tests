// Resume una corrida cruzando k6 (lo que vivio el usuario) con Prometheus (lo que paso en el
// servidor) en la ventana exacta de la corrida, y lo deja en results/<corrida>/report.md.
//
//   node scripts/report.mjs results/<corrida> [--step 60]
//
// --step: segundos por fila de la curva (60 por defecto; 30 para corridas cortas).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { LOAD_POSTGRES_URL, parseArgs } from './lib/config.mjs';

const PROMETHEUS = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';
const [dir] = process.argv.slice(2);
if (!dir) {
  console.error('Uso: node scripts/report.mjs results/<corrida> [--step 60]');
  process.exit(1);
}
const args = parseArgs(process.argv.slice(3));
const step = Number(args.step ?? 60);
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
const start = Date.parse(meta.startedAt) / 1000;
const end = Date.parse(meta.finishedAt) / 1000;
const window = `${Math.max(60, Math.round(end - start))}s`;
const K6 = `testid="${meta.testid}"`;

async function query(expr, time = end) {
  const url = `${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(expr)}&time=${time}`;
  const body = await (await fetch(url)).json();
  if (body.status !== 'success') throw new Error(`${expr}: ${body.error}`);
  return body.data.result.map((r) => ({ labels: r.metric, value: Number(r.value[1]) }));
}

async function range(expr) {
  const url = `${PROMETHEUS}/api/v1/query_range?query=${encodeURIComponent(expr)}&start=${start}&end=${end}&step=${step}`;
  const body = await (await fetch(url)).json();
  if (body.status !== 'success') throw new Error(`${expr}: ${body.error}`);
  return body.data.result;
}

const ms = (s) => (Number.isFinite(s) ? `${Math.round(s * 1000)} ms` : '—');
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)} %` : '—');
const num = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const mib = (b) => (Number.isFinite(b) ? `${Math.round(b / 2 ** 20)} MiB` : '—');

// --- Curva por intervalo: usuario contra servidor ------------------------------------------
const rw = `${step}s`;
const curves = {
  vus: `sum(k6_vus{${K6}})`,
  rps: `sum(rate(k6_http_reqs_total{${K6}}[${rw}]))`,
  p95: `histogram_quantile(0.95, sum(rate(k6_http_req_duration_seconds{${K6}}[${rw}])))`,
  bidP95: `histogram_quantile(0.95, sum(rate(k6_http_req_duration_seconds{${K6}, name="POST /rounds/:id/bids"}[${rw}])))`,
  errors: `(sum(rate(k6_http_reqs_total{${K6}, expected_response="false"}[${rw}])) or vector(0)) / sum(rate(k6_http_reqs_total{${K6}}[${rw}]))`,
  price: `histogram_quantile(0.95, sum(rate(k6_realtime_price_propagation_seconds{${K6}}[${rw}])))`,
  bids: `sum(rate(k6_bids_accepted_total{${K6}}[${rw}]))`,
  auctionCpu: `sum(rate(container_cpu_usage_seconds_total{container="auction"}[${rw}]))`,
  engagementCpu: `sum(rate(container_cpu_usage_seconds_total{container="engagement"}[${rw}]))`,
  pgCpu: `sum(rate(container_cpu_usage_seconds_total{container="postgres"}[${rw}]))`,
  auctionLoop: `max_over_time(nodejs_eventloop_lag_p99_seconds{service="auction"}[${rw}])`,
  locks: `max_over_time((sum(pg_stat_activity_count{datname="ecilost_auction_load", wait_event_type="Lock"}) or vector(0))[${rw}:5s])`,
  queued: `max_over_time((sum(rabbitmq_detailed_queue_messages_ready + rabbitmq_detailed_queue_messages_unacked) or vector(0))[${rw}:5s])`,
};
const series = {};
for (const [key, expr] of Object.entries(curves)) {
  const [first] = await range(expr);
  series[key] = new Map((first?.values ?? []).map(([t, v]) => [Number(t), Number(v)]));
}
const times = [...series.vus.keys()].sort((a, b) => a - b);
const curveRows = times.map((t) => {
  const v = (key) => series[key].get(t);
  const minute = Math.round((t - start) / 60 * 10) / 10;
  return `| ${minute} | ${num(v('vus'), 0)} | ${num(v('rps'))} | ${ms(v('p95'))} | ${ms(v('bidP95'))} | ${pct(v('errors'))} | ${ms(v('price'))} | ${num(v('bids'), 2)} | ${num(v('auctionCpu'), 2)} | ${num(v('engagementCpu'), 2)} | ${num(v('pgCpu'), 2)} | ${ms(v('auctionLoop'))} | ${num(v('locks'), 0)} | ${num(v('queued'), 0)} |`;
});

// --- Maximos del servidor en la ventana ------------------------------------------------------
const byLabel = (rows, label) => rows.sort((a, b) => b.value - a.value).map((r) => `${r.labels[label] ?? '?'} ${r.value}`);
const cpu = await query(`max_over_time((sum by (container) (rate(container_cpu_usage_seconds_total[30s])))[${window}:5s])`);
const cpuAvg = await query(`avg_over_time((sum by (container) (rate(container_cpu_usage_seconds_total[30s])))[${window}:5s])`);
const mem = await query(`max_over_time((sum by (container) (container_memory_working_set_bytes))[${window}:5s])`);
const loop = await query(`max_over_time(nodejs_eventloop_lag_p99_seconds{job="services"}[${window}])`);
const elu = await query(`max_over_time(nodejs_eventloop_utilization_summary{job="services", quantile="0.5"}[${window}])`);
const rssStart = await query('process_resident_memory_bytes{job="services"}', start + 60);
const rssEnd = await query('process_resident_memory_bytes{job="services"}', end);
const handlesStart = await query('nodejs_active_handles_total{job="services"}', start + 60);
const handlesEnd = await query('nodejs_active_handles_total{job="services"}', end);
const routes = await query(`histogram_quantile(0.95, sum by (le, service, route) (increase(http_server_request_duration_seconds_bucket{route!="/metrics"}[${window}])))`);
const routeCount = await query(`sum by (service, route) (increase(http_server_request_duration_seconds_count{route!="/metrics"}[${window}]))`);
const errors5xx = await query(`sum by (service, route, status_code) (increase(http_server_request_duration_seconds_count{status_code=~"5.."}[${window}]))`);
const pgConn = await query(`max_over_time((sum by (datname) (pg_stat_database_numbackends{datname=~".*_load"}))[${window}:5s])`);
const pgLocks = await query(`max_over_time((sum by (datname) (pg_stat_activity_count{datname=~".*_load", wait_event_type="Lock"}))[${window}:5s])`);
const pgDeadlocks = await query(`sum by (datname) (increase(pg_stat_database_deadlocks{datname=~".*_load"}[${window}]))`);
const pgLongestTx = await query(`max_over_time((max by (datname) (pg_stat_activity_max_tx_duration{datname=~".*_load"}))[${window}:5s])`);
const queues = await query(`max_over_time((sum by (queue) (rabbitmq_detailed_queue_messages_ready + rabbitmq_detailed_queue_messages_unacked))[${window}:5s])`);
const amqpOpened = await query(`sum(increase(rabbitmq_connections_opened_total[${window}]))`);
const deadLettered = await query(`sum(increase(rabbitmq_global_messages_dead_lettered_rejected_total[${window}]))`);
const topStatements = await query(`topk(8, sum by (datname, queryid) (increase(pg_stat_statements_seconds_total{datname=~".*_load"}[${window}])))`);

// Texto de las consultas mas costosas (pg_stat_statements vive en el Postgres de carga).
const statementText = new Map();
if (topStatements.length) {
  const client = new pg.Client({ connectionString: `${LOAD_POSTGRES_URL}/postgres` });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT queryid::text AS id, calls, round(mean_exec_time::numeric, 2) AS mean,
              left(regexp_replace(query, '\\s+', ' ', 'g'), 140) AS text
         FROM pg_stat_statements WHERE queryid::text = ANY($1)`,
      [topStatements.map((r) => r.labels.queryid)],
    );
    for (const row of rows) statementText.set(row.id, row);
  } finally {
    await client.end();
  }
}

const count = new Map(routeCount.map((r) => [`${r.labels.service} ${r.labels.route}`, r.value]));
const rssRows = rssEnd.map((r) => {
  const before = rssStart.find((s) => s.labels.service === r.labels.service)?.value;
  const handlesBefore = handlesStart.find((s) => s.labels.service === r.labels.service)?.value;
  const handlesAfter = handlesEnd.find((s) => s.labels.service === r.labels.service)?.value;
  const looped = loop.find((s) => s.labels.service === r.labels.service)?.value;
  const utilization = elu.find((s) => s.labels.service === r.labels.service)?.value;
  return `| ${r.labels.service} | ${mib(before)} | ${mib(r.value)} | ${num(handlesBefore, 0)} -> ${num(handlesAfter, 0)} | ${ms(looped)} | ${pct(utilization)} |`;
});

// --- k6 -------------------------------------------------------------------------------------
const metric = (name) => summary.metrics[name];
// El resumen de k6 da 0 en una Trend sin muestras (p. ej. ninguna ronda cerro): se distingue
// con el numero de observaciones que llego a Prometheus.
const samples = new Map();
for (const name of ['realtime_price_propagation', 'realtime_bid_to_price', 'realtime_round_close_lag', 'realtime_event_delivery', 'ws_join_duration']) {
  // last_over_time sobre toda la ventana: una serie escasa (p. ej. un cierre de ronda a mitad de
  // la corrida) ya esta vencida para una consulta puntual al final (que solo mira 5 min).
  const [row] = await query(`histogram_count(sum(last_over_time(k6_${name}_seconds{${K6}}[${window}])))`);
  samples.set(name, row?.value ?? 0);
}
const trend = (name) => {
  const m = metric(name);
  if (!m || samples.get(name) === 0) return 'sin muestras';
  const n = samples.has(name) ? ` (n=${Math.round(samples.get(name))})` : '';
  return `${ms(m.med / 1000)} / ${ms(m['p(90)'] / 1000)} / ${ms(m['p(95)'] / 1000)} / ${ms(m['p(99)'] / 1000)} / ${ms(m.max / 1000)}${n}`;
};
const endpointRows = Object.keys(summary.metrics)
  .filter((k) => k.startsWith('http_req_duration{name:'))
  .map((k) => `| ${k.slice('http_req_duration{name:'.length, -1)} | ${trend(k)} |`);
const thresholds = Object.entries(summary.metrics)
  .filter(([, m]) => m.thresholds)
  .flatMap(([name, m]) => Object.entries(m.thresholds).map(([rule, crossed]) => `| ${name} | \`${rule}\` | ${crossed ? '**NO**' : 'si'} |`));
const counter = (name) => metric(name)?.count ?? 0;
const verify = readFileSync(join(dir, 'verify.txt'), 'utf8').trim().split('\n').filter((l) => /FALLA|AVISO|Sin fallas|FALLA\(S\)/.test(l));

const md = `# ${meta.testid}

- Ventana: ${meta.startedAt} -> ${meta.finishedAt} (${Math.round((end - start) / 60)} min)
- Datos: ${meta.data.students} estudiantes, ${meta.data.rooms} sala(s), ${meta.data.rounds} ronda(s); args k6: \`${meta.k6Args.join(' ') || '(por defecto)'}\`
- k6 exit ${meta.k6Exit}, verify exit ${meta.verifyExit}
- Grafana: ${meta.grafana}

## Umbrales (k6)

| Metrica | Regla | Cumplido |
|---|---|---|
${thresholds.join('\n')}

## Verificacion de garantias

${verify.map((l) => `- ${l.trim()}`).join('\n')}

## Totales

| | |
|---|---|
| Peticiones HTTP | ${metric('http_reqs')?.count ?? 0} (${num(metric('http_reqs')?.rate)}/s) |
| Fallidas | ${pct(metric('http_req_failed')?.value)} |
| Checks | ${pct(metric('checks')?.value)} |
| Pujas aceptadas | ${counter('bids_accepted')} |
| 409 otra llego primero / bajo minimo / fondos / ronda cerrada / otro | ${counter('bids_409_outbid')} / ${counter('bids_409_below_minimum')} / ${counter('bids_409_insufficient_funds')} / ${counter('bids_409_round_closed')} / ${counter('bids_409_other')} |
| Pujas 5xx / sin respuesta | ${counter('bids_unavailable')} |
| Precios no recibidos por el socket | ${counter('realtime_price_events_missed')} |
| Errores de socket | ${counter('ws_errors')} |
| room.join aceptados | ${pct(metric('ws_join_ok')?.value)} |
| Iteraciones descartadas | ${counter('dropped_iterations')} |

## Latencia vista por el usuario (mediana / p90 / p95 / p99 / max)

| Endpoint | |
|---|---|
${endpointRows.join('\n')}
| **Todas** | ${trend('http_req_duration')} |

| Tiempo real | |
|---|---|
| Precio en vivo (puja aceptada -> socket) | ${trend('realtime_price_propagation')} |
| Puja enviada -> precio visto | ${trend('realtime_bid_to_price')} |
| Retraso del cierre de ronda | ${trend('realtime_round_close_lag')} |
| Entrega del socket | ${trend('realtime_event_delivery')} |
| room.join -> ack | ${trend('ws_join_duration')} |

## Curva cada ${step} s: usuario contra servidor

min = minutos desde el inicio; CPU en nucleos; locks = sesiones de auction esperando un lock
(maximo del intervalo); cola = mensajes sin consumir en RabbitMQ (maximo del intervalo).

| min | VUs | req/s | p95 | p95 puja | error | p95 precio | pujas/s | CPU auction | CPU engagement | CPU postgres | event loop auction | locks | cola |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${curveRows.join('\n')}

## Servidor en la ventana

| Contenedor | CPU media | CPU max (nucleos) | Memoria max |
|---|---|---|---|
${cpu.sort((a, b) => b.value - a.value).map((r) => `| ${r.labels.container} | ${num(cpuAvg.find((x) => x.labels.container === r.labels.container)?.value, 2)} | ${num(r.value, 2)} | ${mib(mem.find((x) => x.labels.container === r.labels.container)?.value)} |`).join('\n')}

| Servicio | RSS al inicio | RSS al final | Handles | Event loop p99 max | Utilizacion event loop max |
|---|---|---|---|---|---|
${rssRows.join('\n')}

p95 por ruta en el servidor (toda la ventana):

| Servicio y ruta | Peticiones | p95 |
|---|---|---|
${routes.filter((r) => Number.isFinite(r.value)).sort((a, b) => b.value - a.value).map((r) => `| ${r.labels.service} ${r.labels.route} | ${Math.round(count.get(`${r.labels.service} ${r.labels.route}`) ?? 0)} | ${ms(r.value)} |`).join('\n')}

Respuestas 5xx: ${errors5xx.length ? byLabel(errors5xx, 'route').join(', ') : 'ninguna'}

| Postgres | Conexiones max | Esperando lock max | Deadlocks | Transaccion mas larga |
|---|---|---|---|---|
${pgConn.map((r) => `| ${r.labels.datname} | ${num(r.value, 0)} | ${num(pgLocks.find((x) => x.labels.datname === r.labels.datname)?.value ?? 0, 0)} | ${num(pgDeadlocks.find((x) => x.labels.datname === r.labels.datname)?.value ?? 0, 0)} | ${num(pgLongestTx.find((x) => x.labels.datname === r.labels.datname)?.value, 2)} s |`).join('\n')}

Consultas con mas tiempo de ejecucion en la ventana (pg_stat_statements; llamadas y media son acumulados desde el ultimo reset):

| Base | Tiempo en la ventana | Llamadas | Media | Consulta |
|---|---|---|---|---|
${topStatements.sort((a, b) => b.value - a.value).map((r) => {
  const s = statementText.get(r.labels.queryid);
  return `| ${r.labels.datname.replace('ecilost_', '').replace('_load', '')} | ${num(r.value, 2)} s | ${s?.calls ?? '?'} | ${s?.mean ?? '?'} ms | \`${(s?.text ?? r.labels.queryid).replaceAll('|', '/')}\` |`;
}).join('\n')}

RabbitMQ: cola max ${queues.filter((q) => q.value > 0).sort((a, b) => b.value - a.value).map((q) => `${q.labels.queue} ${q.value}`).join(', ') || 'ninguna acumulo'}; conexiones abiertas ${num(amqpOpened[0]?.value, 0)}; a dead-letter ${num(deadLettered[0]?.value ?? 0, 0)}.
`;

writeFileSync(join(dir, 'report.md'), md);
console.log(`${join(dir, 'report.md')}`);
