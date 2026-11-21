// Load and stress profiles, each with 600 seconds of scheduled k6 load.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './lib/config.mjs';

const profiles = [
  { name: 'load', own: [], env: [] },
  { name: 'stress', own: [], env: [] },
];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(ROOT, 'results', `evidence-10m-${stamp}`);
mkdirSync(dir, { recursive: true });
const state = { startedAt: new Date().toISOString(), plannedLoadSeconds: 1200, profiles: [], current: null };
const json = (file, value) => writeFileSync(join(dir, file), JSON.stringify(value, null, 2));
const links = (uid, meta) => `http://localhost:3300/d/${uid}?from=${Date.parse(meta.startedAt)}&to=${Date.parse(meta.finishedAt)}&var-testid=${meta.testid}`;
function persist() {
  json('progress.json', state);
  const rows = state.profiles.map((profile) => {
    const meta = profile.meta;
    const report = profile.resultDir ? `../${profile.resultDir}/report.md` : `${profile.name}.log`;
    return `| ${profile.name} | 600 | ${meta ? Math.round((Date.parse(meta.finishedAt) - Date.parse(meta.startedAt)) / 1000) : '—'} | ${meta?.k6Exit ?? '—'} | ${meta?.verifyExit ?? '—'} | [Informe](${report}) | ${meta ? `[k6](${links('ecilost-k6', meta)}) · [Correlación](${links('ecilost-overview', meta)}) · [Infraestructura](${links('ecilost-infra', meta)})` : '—'} |`;
  });
  writeFileSync(join(dir, 'README.md'), `# Evidencias: carga y estrés de 10 minutos

Inicio: ${state.startedAt}. ${state.finishedAt ? `Fin: ${state.finishedAt}.` : `En curso: ${state.current ?? 'preparación'}.`}

Cada curva programa exactamente 600 segundos. La preparación no cuenta dentro de esos diez minutos.
La ventana real puede sumar hasta 30 segundos de cierre de iteraciones/conexiones, además de setup/teardown.
FULL_DURATION=true conserva los umbrales y desactiva únicamente su aborto anticipado.
Salida k6 0: umbrales cumplidos; 99: umbrales incumplidos. La verificación de invariantes tiene su propio código.
Las pruebas se ejecutan en secuencia sobre Docker local, con datos nuevos en cada una.

| Escenario | Carga programada (s) | Ventana real (s) | k6 | Verificación | Evidencia | Grafana |
|---|---|---|---|---|---|---|
${rows.join('\n')}

Los archivos plan.json, source-sha256.json y environment.txt permiten identificar parámetros y entorno.
Los logs de ejecución están en esta carpeta. Los datos, resumen k6, logs de servicios y reportes de cada
corrida están en su carpeta enlazada. Los tokens y llaves de .data no se copian a las evidencias.
Los paneles de servicios que requieren GET /metrics no tendrán datos cuando esa revisión no lo exponga.
`);
}
const commands = profiles.map((profile) => ({ ...profile, loadSeconds: 600, command: ['docker', 'compose', 'run', '--rm', '--no-deps', 'runner', profile.name,
  ...profile.own, '--starts-in', '60', '--', '-e', 'FULL_DURATION=true', ...profile.env.flatMap((env) => ['-e', env])] }));
json('plan.json', commands);
const hashes = {};
for (const folder of ['scripts', 'k6']) {
  for (const file of readdirSync(join(ROOT, folder), { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const path = join(file.parentPath ?? file.path, file.name);
    hashes[relative(ROOT, path).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
}
json('source-sha256.json', hashes);
const inventory = spawnSync('docker', ['compose', 'ps', '--format', '{{.Service}} {{.State}} {{.Health}}'], { cwd: ROOT, encoding: 'utf8' });
const images = spawnSync('docker', ['compose', 'images', '--format', 'json'], { cwd: ROOT, encoding: 'utf8' });
writeFileSync(join(dir, 'environment.txt'), `${inventory.stdout}\n${images.stdout}`);
persist();
console.log(`EVIDENCE_DIR=${dir}`);
for (const profile of commands) {
  state.current = profile.name;
  persist();
  const before = new Set(readdirSync(join(ROOT, 'results')));
  const entry = { name: profile.name, startedAt: new Date().toISOString(), command: profile.command, loadSeconds: 600 };
  console.log(`START ${profile.name} ${entry.startedAt}`);
  const stream = createWriteStream(join(dir, `${profile.name}.log`));
  entry.exit = await new Promise((resolve) => {
    const child = spawn(profile.command[0], profile.command.slice(1), { cwd: ROOT, windowsHide: true });
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.once('error', (error) => { stream.write(`${error.stack}\n`); resolve(1); });
    child.once('close', (code) => resolve(code ?? 1));
  });
  await new Promise((resolve) => stream.end(resolve));
  entry.finishedAt = new Date().toISOString();
  const resultDir = readdirSync(join(ROOT, 'results')).find((name) => !before.has(name) && name.startsWith(`${profile.name}-`) && existsSync(join(ROOT, 'results', name, 'meta.json')));
  if (resultDir) {
    entry.resultDir = resultDir;
    entry.meta = JSON.parse(readFileSync(join(ROOT, 'results', resultDir, 'meta.json'), 'utf8'));
  }
  state.profiles.push(entry);
  persist();
  console.log(`DONE ${profile.name}: process=${entry.exit}, k6=${entry.meta?.k6Exit ?? 'missing'}, verify=${entry.meta?.verifyExit ?? 'missing'}`);
}
state.current = null;
state.finishedAt = new Date().toISOString();
persist();
console.log(`COMPLETE ${dir}`);
process.exitCode = state.profiles.some((profile) => profile.exit !== 0) ? 1 : 0;
