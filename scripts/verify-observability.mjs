// Fail before collecting evidence when a required source is absent; never substitute fake zeros.
import { parseArgs } from './lib/config.mjs';
const args = parseArgs();
const prometheus = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';
const services = ['auth', 'catalog', 'wallet', 'auction', 'engagement'];
const metrics = ['process_cpu_seconds_total', 'process_resident_memory_bytes', 'process_start_time_seconds',
  'nodejs_heap_size_used_bytes', 'nodejs_heap_size_total_bytes', 'nodejs_active_handles_total',
  'nodejs_eventloop_lag_p99_seconds', 'nodejs_eventloop_utilization_summary'];
async function get(path) {
  const response = await fetch(prometheus + path, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Prometheus ${response.status}`);
  const body = await response.json();
  if (body.status !== 'success') throw new Error(body.error ?? 'Prometheus query failed');
  return body.data;
}
async function inspect() {
  const { activeTargets } = await get('/api/v1/targets');
  const required = ['services', 'postgres', 'cadvisor', 'rabbitmq', 'rabbitmq-queues', 'prometheus'];
  const missing = required.flatMap((job) => {
    const targets = activeTargets.filter((target) => target.labels.job === job);
    return !targets.length ? [`target ${job} absent`] : targets.filter((target) => target.health !== 'up').map((target) => `${target.scrapeUrl}: ${target.lastError}`);
  });
  for (const metric of metrics) {
    const { result } = await get(`/api/v1/query?query=${encodeURIComponent(`count by (service) (${metric}{job="services"})`)}`);
    for (const service of services) if (!result.some((row) => row.metric.service === service)) missing.push(`${service}: ${metric} absent`);
  }
  const { result } = await get('/api/v1/query?query=realtime_connected_sockets');
  if (!result.length) missing.push('engagement: realtime_connected_sockets absent');
  return { missing, targets: activeTargets.map((target) => ({ job: target.labels.job, url: target.scrapeUrl, health: target.health })) };
}
const deadline = Date.now() + Number(args['wait-seconds'] ?? 0) * 1000;
let report;
do {
  try { report = await inspect(); }
  catch (error) { report = { missing: [error.message] }; }
  if (!report.missing.length || Date.now() >= deadline) break;
  await new Promise((resolve) => setTimeout(resolve, 3000));
} while (true);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...report }, null, 2));
process.exitCode = report.missing.length ? 1 : 0;
