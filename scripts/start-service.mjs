// Alternativa al compose: levanta un servicio en el host con `npm run start`, apuntando a su
// base de carga y al RabbitMQ del compose (`docker compose up -d postgres rabbitmq azurite
// keygen` y `npm run migrate` antes). Sirve para depurar un servicio fuera de Docker; las
// corridas que se reportan usan el compose completo. Auth firma con las llaves de la carga.
//
//   node scripts/start-service.mjs <auth|catalog|wallet|auction|engagement>
import { spawn } from 'node:child_process';
import { LOAD_JWT, LOAD_RABBITMQ_URL, loadDatabaseUrl, MIGRATED_SERVICES, readKey, serviceDir } from './lib/config.mjs';

const service = process.argv[2];
if (!MIGRATED_SERVICES.includes(service)) {
  console.error(`Uso: node scripts/start-service.mjs <${MIGRATED_SERVICES.join('|')}>`);
  process.exit(1);
}

// La variable del proceso tiene prioridad sobre el .env del servicio.
const env = { ...process.env, DATABASE_URL: loadDatabaseUrl(service), RABBITMQ_URL: LOAD_RABBITMQ_URL, METRICS_ENABLED: 'true' };
if (service === 'auth') {
  Object.assign(env, { JWT_PRIVATE_KEY: readKey('private.b64'), JWT_PUBLIC_KEY: readKey('public.b64'), JWT_ISSUER: LOAD_JWT.issuer, JWT_AUDIENCE: LOAD_JWT.audience });
}
const url = new URL(env.DATABASE_URL);
console.log(`${service}: base ${url.pathname.slice(1)}, esquema ${url.searchParams.get('schema')} (carga)`);

// Comando fijo: en Windows `npm` es un .cmd y necesita shell.
const child = spawn('npm run start', { cwd: serviceDir(service), env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
