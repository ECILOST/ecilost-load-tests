// Corre un escenario completo y deja todo lo necesario para analizarlo despues:
//
//   1. tokens suficientes (tokens.mjs) y datos nuevos de la corrida (setup.mjs --wait-active);
//   2. k6 con remote write a Prometheus y la etiqueta testid=<escenario>-<runId>;
//   3. verify.mjs sobre las salas de la corrida;
//   4. en results/<escenario>-<fecha>-<runId>/: resumen de k6 (texto y JSON con el estado de
//      cada umbral), run.json, verificacion, logs de los servicios y meta.json con el enlace
//      a Grafana en la ventana exacta de la corrida.
//
//   node scripts/run.mjs <escenario> [--students N] [--rooms N] [--rounds N] [--skip-setup]
//                                    [-- <argumentos de k6, p. ej. -e USERS=50>]
//
// Requiere el sistema (npm run stack:up) y la observabilidad (npm run obs:up) levantados.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, parseArgs, readData, ROOT } from './lib/config.mjs';

/**
 * Datos por escenario: estudiantes (= VUs maximos del escenario, ver k6/lib/profiles.js),
 * salas y rondas. Las rondas sobran a proposito: con pujas continuas cada una se alarga hasta
 * 8 min por anti-sniping, sin pujas dura 3; la sala no debe terminar antes que la prueba.
 */
const DEFAULTS = {
  smoke: { students: 5, rooms: 1, rounds: 2 },
  load: { students: 120, rooms: 2, rounds: 6 },
  stress: { students: 420, rooms: 2, rounds: 10 },
  'stress-reads': { students: 200, rooms: 1, rounds: 6 },
  spike: { students: 200, rooms: 2, rounds: 4 },
  soak: { students: 70, rooms: 1, rounds: 20 },
  'bid-storm': { students: 100, rooms: 1, rounds: 1 },
};
/** Saldo de sobra para que "fondos insuficientes" no aparezca por la duracion de la prueba. */
const RECHARGE = 10_000_000;
const PROMETHEUS_WRITE_URL = process.env.K6_PROMETHEUS_RW_SERVER_URL ?? 'http://localhost:9090/api/v1/write';
const GRAFANA_URL = process.env.GRAFANA_URL ?? 'http://localhost:3300';
const SERVICES = ['auth', 'catalog', 'wallet', 'auction', 'engagement'];

const separator = process.argv.indexOf('--');
const k6Extra = separator >= 0 ? process.argv.slice(separator + 1) : [];
const [scenario, ...ownArgs] = separator >= 0 ? process.argv.slice(2, separator) : process.argv.slice(2);
if (!DEFAULTS[scenario]) {
  console.error(`Uso: node scripts/run.mjs <${Object.keys(DEFAULTS).join('|')}> [opciones] [-- args de k6]`);
  process.exit(1);
}
const args = { ...DEFAULTS[scenario], ...parseArgs(ownArgs) };
const step = (text) => console.log(`\n[${new Date().toISOString().slice(11, 19)}] ${text}`);

function node(script, scriptArgs) {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...scriptArgs], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${script} fallo (exit ${result.status}).`);
}

// --- 1. Tokens y datos ---------------------------------------------------------------------
if (!args['skip-setup']) {
  const tokens = existsSync(join(DATA_DIR, 'tokens.json')) ? readData('tokens.json') : null;
  const fresh = tokens && Date.parse(tokens.expiresAt) > Date.now() + 90 * 60_000;
  if (!fresh || tokens.students.length < args.students) {
    step(`Tokens para ${args.students} estudiantes`);
    node('tokens.mjs', ['--students', String(Math.max(args.students, tokens?.students.length ?? 0))]);
  }
  step(`Datos: ${args.students} estudiantes, ${args.rooms} sala(s), ${args.rounds} ronda(s)`);
  node('setup.mjs', [
    '--scenario', scenario, '--students', String(args.students), '--rooms', String(args.rooms),
    '--rounds', String(args.rounds), '--recharge', String(RECHARGE), '--starts-in', '10', '--wait-active',
  ]);
}
const run = readData('run.json');
const testid = `${scenario}-${run.runId}`;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const dir = join(ROOT, 'results', `${scenario}-${stamp}-${run.runId}`);
mkdirSync(join(dir, 'logs'), { recursive: true });
copyFileSync(join(DATA_DIR, 'run.json'), join(dir, 'run.json'));

// --- 2. k6 -----------------------------------------------------------------------------------
step(`k6 ${scenario} (testid=${testid})`);
const startedAt = new Date();
const k6Args = [
  // --quiet: sin TTY la barra de progreso llenaria k6.txt; el resumen final se escribe igual.
  'run', '--quiet', '-o', 'experimental-prometheus-rw', '--tag', `testid=${testid}`,
  // Sin `url` (lleva los ids de sala y ronda: una serie nueva por corrida y endpoint) ni las de
  // TLS/IP; `name` ya agrupa por plantilla de ruta.
  '--system-tags', 'proto,subproto,status,method,name,group,check,error,error_code,scenario,expected_response',
  '--summary-export', join(dir, 'summary.json'), ...k6Extra, join(ROOT, 'k6', 'scenarios', `${scenario}.js`),
];
const k6Out = createWriteStream(join(dir, 'k6.txt'));
const k6Exit = await new Promise((resolve) => {
  const child = spawn('k6', k6Args, {
    cwd: ROOT,
    env: {
      ...process.env,
      K6_PROMETHEUS_RW_SERVER_URL: PROMETHEUS_WRITE_URL,
      // Histogramas nativos: percentiles por ventana en Grafana, no solo el acumulado. En k6 2.x
      // reemplaza a K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM (alias deprecado).
      K6_FEATURES: 'native-histograms',
      K6_NO_COLOR: 'true',
    },
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      process.stdout.write(chunk);
      k6Out.write(chunk);
    });
  }
  // Ctrl+C llega tambien a k6, que corta y escribe su resumen: se guarda igual.
  process.on('SIGINT', () => {});
  child.on('exit', (code) => resolve(code ?? 1));
});
k6Out.end();
const finishedAt = new Date();

// --- 3. Verificacion -------------------------------------------------------------------------
step('Verificacion de garantias');
const verify = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify.mjs'), '--run', join(dir, 'run.json')], { cwd: ROOT, encoding: 'utf8' });
process.stdout.write(verify.stdout + verify.stderr);
writeFileSync(join(dir, 'verify.txt'), verify.stdout + verify.stderr);

// --- 4. Logs y metadatos ---------------------------------------------------------------------
for (const service of SERVICES) {
  const logs = spawnSync('docker', ['compose', '-f', join(ROOT, 'compose', 'docker-compose.yml'), 'logs', '--no-color', '--since', startedAt.toISOString(), service], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(join(dir, 'logs', `${service}.log`), (logs.stdout ?? '') + (logs.stderr ?? ''));
}
const from = startedAt.getTime() - 60_000;
const to = finishedAt.getTime() + 60_000;
const meta = {
  scenario,
  testid,
  runId: run.runId,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  data: { students: args.students, rooms: args.rooms, rounds: args.rounds },
  k6Args: k6Extra,
  // 99: algun umbral no se cumplio; 108: se corto por abortOnFail.
  k6Exit,
  verifyExit: verify.status,
  grafana: `${GRAFANA_URL}/d/ecilost-overview?from=${from}&to=${to}&var-testid=${testid}`,
};
writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

step(`Resultados en ${dir}`);
console.log(`  k6 exit ${k6Exit}${k6Exit === 99 ? ' (umbrales incumplidos)' : ''}, verify exit ${verify.status}`);
console.log(`  Grafana: ${meta.grafana}`);
process.exit(k6Exit !== 0 ? k6Exit : verify.status ?? 1);
