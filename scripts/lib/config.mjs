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

/** Servicios que guardan datos durante la carga. Auth solo publica su JWKS: no se aisla. */
export const LOAD_SERVICES = ['catalog', 'wallet', 'auction', 'engagement'];

export const serviceDir = (service) => join(WORKSPACE, `ecilost-${service}-service`);

/**
 * Lee una variable del `.env` de un servicio sin cargarlo en este proceso. Nunca se imprime:
 * puede ser una credencial.
 */
export function readServiceEnv(service, name) {
  const file = join(serviceDir(service), '.env');
  if (!existsSync(file)) throw new Error(`No existe ${file}: copia .env.example a .env en ecilost-${service}-service.`);
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match?.[1] === name) return match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  throw new Error(`${name} no esta en el .env de ecilost-${service}-service.`);
}

/**
 * Servicios que se aislan con otra base de datos y no con otro esquema:
 * - wallet: sus migraciones escriben el esquema `"wallet"` a mano, asi que no se pueden aplicar
 *   en otro esquema.
 * - engagement: no le pasa el esquema a su adaptador de Prisma, que siempre usa `public`.
 */
const ISOLATED_BY_DATABASE = new Set(['wallet', 'engagement']);

/**
 * La base de la carga de cada servicio: la misma de desarrollo, pero aislada. catalog y
 * auction pasan `?schema=` a Prisma, asi que basta con otro esquema (`<x>_load`); wallet y
 * engagement usan otra base (`<base>_load`) en el mismo contenedor.
 */
export function loadDatabaseUrl(service) {
  const url = new URL(readServiceEnv(service, 'DATABASE_URL'));
  if (ISOLATED_BY_DATABASE.has(service)) {
    url.pathname = `${url.pathname}_load`;
  } else {
    const schema = url.searchParams.get('schema');
    if (!schema) throw new Error(`La DATABASE_URL de ${service} no tiene ?schema=.`);
    url.searchParams.set('schema', `${schema}_load`);
  }
  return url.toString();
}

export const isolatedByDatabase = (service) => ISOLATED_BY_DATABASE.has(service);

/** Esquema dentro de la base de carga, para las consultas de verificacion. */
export const loadSchema = (service) => new URL(loadDatabaseUrl(service)).searchParams.get('schema') ?? 'public';

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
