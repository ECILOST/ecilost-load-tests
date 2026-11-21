// Evaluate the provisioned panels over a real run, including sparse event metrics.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, parseArgs } from './lib/config.mjs';
const args = parseArgs();
if (!args.testid || !args.from || !args.to) throw new Error('Use --testid ID --from UTC --to UTC [--out FILE]');
const from = Date.parse(String(args.from)) / 1000;
const to = Date.parse(String(args.to)) / 1000;
const range = `${Math.max(60, Math.ceil(to - from))}s`;
const endpoint = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';
const panels = [];
for (const file of readdirSync(join(ROOT, 'observability/grafana/dashboards'))) {
  if (!file.endsWith('.json')) continue;
  const board = JSON.parse(readFileSync(join(ROOT, 'observability/grafana/dashboards', file)));
  for (const panel of board.panels.filter((panel) => panel.targets?.length)) {
    const targets = [];
    for (const target of panel.targets) {
      const expression = target.expr.replaceAll('$testid', String(args.testid)).replaceAll('$service', '.*')
        .replaceAll('$__rate_interval', '30s').replaceAll('$__range', range);
      const url = new URL(`${endpoint}/api/v1/query_range`);
      url.search = new URLSearchParams({ query: expression, start: String(from), end: String(to), step: '5' });
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const body = await response.json();
      const finite = body.data?.result?.some((series) => series.values?.some(([, value]) => Number.isFinite(Number(value))));
      targets.push({ expression, hasSamples: Boolean(finite), error: body.status === 'success' ? undefined : body.error });
    }
    panels.push({ board: board.uid, title: panel.title, hasSamples: targets.some((target) => target.hasSamples), targets });
  }
}
const missing = panels.filter((panel) => !panel.hasSamples);
const errors = panels.flatMap((panel) => panel.targets.filter((target) => target.error));
const report = { testid: args.testid, from: args.from, to: args.to, totalPanels: panels.length, missingPanels: missing.map(({ board, title }) => ({ board, title })), panels };
if (args.out) writeFileSync(String(args.out), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totalPanels: panels.length, missingPanels: report.missingPanels, queryErrors: errors }, null, 2));
process.exitCode = missing.length || errors.length ? 1 : 0;
