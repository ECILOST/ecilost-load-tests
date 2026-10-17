// Prepara las bases aisladas de la carga: crea las bases `*_load` de wallet y engagement si
// faltan y aplica las migraciones Prisma de cada servicio en su base o esquema de carga. Las
// bases de desarrollo no se tocan. Se puede repetir: `migrate deploy` solo aplica lo pendiente.
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { isolatedByDatabase, LOAD_SERVICES, loadDatabaseUrl, serviceDir } from './lib/config.mjs';

async function ensureDatabase(service) {
  const target = new URL(loadDatabaseUrl(service));
  const database = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(target);
  admin.pathname = '/postgres';
  admin.search = '';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rowCount === 0) {
      // El nombre no admite parametros: se valida antes de interpolarlo.
      if (!/^[a-z0-9_]+$/.test(database)) throw new Error(`Nombre de base inesperado: ${database}`);
      await client.query(`CREATE DATABASE ${database}`);
      console.log(`${service}: base ${database} creada`);
    } else {
      console.log(`${service}: base ${database} ya existe`);
    }
  } finally {
    await client.end();
  }
}

for (const service of LOAD_SERVICES.filter(isolatedByDatabase)) await ensureDatabase(service);

for (const service of LOAD_SERVICES) {
  console.log(`\n=== ${service}`);
  // La variable del proceso tiene prioridad sobre el .env del servicio.
  // Comando fijo y sin datos externos: en Windows `npx` es un .cmd y necesita shell.
  const result = spawnSync('npx prisma migrate deploy', {
    cwd: serviceDir(service),
    env: { ...process.env, DATABASE_URL: loadDatabaseUrl(service) },
    encoding: 'utf8',
    shell: true,
  });
  const output = `${result.stdout}${result.stderr}`;
  // Solo las lineas utiles: a donde se conecto y que aplico. Nunca la URL completa.
  for (const line of output.split(/\r?\n/)) {
    if (/Datasource|migrations? found|Applying|applied|No pending|Error|error/.test(line)) console.log(`  ${line.trim()}`);
  }
  if (result.status !== 0) {
    console.error(`  migrate deploy fallo en ${service} (exit ${result.status})`);
    process.exit(1);
  }
}
