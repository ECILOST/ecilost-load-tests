// Levanta un servicio con `npm run start` apuntando a su base de carga (`*_load`). Auth se
// levanta tal cual: solo publica el JWKS con el que los demas verifican los tokens de prueba.
//
//   node scripts/start-service.mjs <auth|catalog|wallet|auction|engagement>
import { spawn } from 'node:child_process';
import { LOAD_SERVICES, loadDatabaseUrl, serviceDir } from './lib/config.mjs';

const service = process.argv[2];
const known = ['auth', ...LOAD_SERVICES];
if (!known.includes(service)) {
  console.error(`Uso: node scripts/start-service.mjs <${known.join('|')}>`);
  process.exit(1);
}

const env = { ...process.env };
if (LOAD_SERVICES.includes(service)) {
  // La variable del proceso tiene prioridad sobre el .env del servicio.
  env.DATABASE_URL = loadDatabaseUrl(service);
  const url = new URL(env.DATABASE_URL);
  console.log(`${service}: base ${url.pathname.slice(1)}, esquema ${url.searchParams.get('schema') ?? 'public'} (carga)`);
}

// Comando fijo: en Windows `npm` es un .cmd y necesita shell.
const child = spawn('npm run start', { cwd: serviceDir(service), env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
