// Genera, si no existe, el par de llaves RS256 con el que auth firma en el entorno de carga y
// con el que tokens.mjs firma a los usuarios sinteticos. Es propio de la carga: no se reutiliza
// la llave de desarrollo (no hace falta el .env de auth) y no sirve fuera de este entorno.
//
// Deja en .data/keys/ el PEM de cada llave en base64 (el formato de JWT_PRIVATE_KEY y
// JWT_PUBLIC_KEY de auth) y el kid que auth publica en su JWKS. Lo corre el servicio `keygen`
// del compose antes de que arranque auth.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateJwkThumbprint, exportJWK, exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { KEYS_DIR } from './lib/config.mjs';

const files = ['private.b64', 'public.b64', 'kid'].map((name) => join(KEYS_DIR, name));
if (files.every((file) => existsSync(file))) {
  console.log(`Llaves de carga ya presentes en ${KEYS_DIR}`);
  process.exit(0);
}

const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
const kid = await calculateJwkThumbprint(await exportJWK(publicKey));
const b64 = (pem) => Buffer.from(pem, 'utf8').toString('base64');

mkdirSync(KEYS_DIR, { recursive: true });
// Legible por todos a proposito: keygen corre como root y auth como el usuario `node` de su
// imagen. Es una llave solo de este entorno, dentro de .data/ (que git ignora).
writeFileSync(files[0], b64(await exportPKCS8(privateKey)), { mode: 0o644 });
writeFileSync(files[1], b64(await exportSPKI(publicKey)));
writeFileSync(files[2], kid);
console.log(`Llaves de carga generadas en ${KEYS_DIR} (kid ${kid.slice(0, 8)}...)`);
