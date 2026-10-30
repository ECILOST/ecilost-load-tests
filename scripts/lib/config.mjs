import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Carpeta del repo de carga y carpeta ECILOST que contiene los repos de los servicios. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORKSPACE = process.env.ECILOST_WORKSPACE ?? resolve(ROOT, '..');
export const DATA_DIR = join(ROOT, '.data');

/** Puertos locales, los mismos que usan los servicios en desarrollo. */
export const SERVICE_URL = {
  auth: process.env.AUTH_URL ?? 'http://localhost:3000',
  catalog: process.env.CATALOG_URL ?? 'http://localhost:3001',
  wallet: process.env.WALLET_URL ?? 'http://localhost:3002/wallet',
  auction: process.env.AUCTION_URL ?? 'http://localhost:3003',
  engagement: process.env.ENGAGEMENT_URL ?? 'http://localhost:3005',
};

/** Servicios que guardan datos durante la carga. */
export const LOAD_SERVICES = ['catalog', 'wallet', 'auction', 'engagement'];

/** Servicios con base propia en el Postgres de carga: auth tambien, porque arranca su outbox. */
export const MIGRATED_SERVICES = ['auth', ...LOAD_SERVICES];

export const serviceDir = (service) => join(WORKSPACE, `ecilost-${service}-service`);

/** Llaves RS256 propias del entorno de carga (las genera scripts/keys.mjs). */
export const KEYS_DIR = join(DATA_DIR, 'keys');

/**
 * Issuer y audience de los tokens en el entorno de carga. Son los mismos JWT_ISSUER/JWT_AUDIENCE
 * (AUTH_ISSUER/AUTH_AUDIENCE en wallet) que fija compose/docker-compose.yml: si cambias uno,
 * cambia el otro.
 */
export const LOAD_JWT = { issuer: 'https://auth.ecilost.local', audience: 'ecilost-services' };

/** Una llave de .data/keys (base64 del PEM o el kid). */
export function readKey(name) {
  const file = join(KEYS_DIR, name);
  if (!existsSync(file)) throw new Error(`Falta ${file}: levanta el entorno (docker compose up) o corre node scripts/keys.mjs.`);
  return readFileSync(file, 'utf8').trim();
}

/**
 * Postgres de la carga (`compose/docker-compose.yml`). Por defecto, visto desde el host por su
 * puerto publicado; el runner del compose lo cambia a `postgres:5432`. Es otro contenedor: las
 * bases de desarrollo (5433-5437) no se tocan.
 */
export const LOAD_POSTGRES_URL = process.env.LOAD_POSTGRES_URL ?? 'postgresql://ecilost:ecilost@localhost:55432';

/** RabbitMQ del compose de carga, visto desde el host. */
export const LOAD_RABBITMQ_URL = process.env.LOAD_RABBITMQ_URL ?? 'amqp://ecilost:ecilost@localhost:55672';

/**
 * Base y esquema de cada servicio en el Postgres de carga. Una base por servicio, con el
 * mismo esquema que en desarrollo: wallet escribe `"wallet"` en sus migraciones y engagement
 * no le pasa esquema a su adaptador (usa `public`). Los contenedores usan los mismos nombres
 * con el host `postgres:5432`: si cambias uno, cambia tambien el compose.
 */
const LOAD_DATABASE = {
  auth: { database: 'ecilost_auth_load', schema: 'auth' },
  catalog: { database: 'ecilost_catalog_load', schema: 'catalog' },
  wallet: { database: 'ecilost_wallet_load', schema: 'wallet' },
  auction: { database: 'ecilost_auction_load', schema: 'auction' },
  engagement: { database: 'ecilost_engagement_load', schema: 'public' },
};

export function loadDatabaseUrl(service) {
  const target = LOAD_DATABASE[service];
  if (!target) throw new Error(`Servicio sin base de carga: ${service}`);
  const url = new URL(LOAD_POSTGRES_URL);
  url.pathname = `/${target.database}`;
  url.searchParams.set('schema', target.schema);
  return url.toString();
}

/** Esquema dentro de la base de carga, para las consultas de verificacion. */
export const loadSchema = (service) => LOAD_DATABASE[service].schema;

export function readData(name) {
  const file = join(DATA_DIR, name);
  if (!existsSync(file)) throw new Error(`Falta ${file}. Corre antes el paso que lo genera.`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeData(name, value) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, name), JSON.stringify(value, null, 2));
}

/** `--clave valor` y `--bandera` a un objeto; los numeros se convierten. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = /^-?\d+$/.test(next) ? Number(next) : next;
      i += 1;
    }
  }
  return args;
}
