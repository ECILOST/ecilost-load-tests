// Firma tokens de acceso para usuarios sinteticos: N estudiantes y un funcionario.
//
// Usa la llave del entorno de carga (.data/keys, la misma con la que firma auth en el compose) y
// el mismo kid, issuer y audience que TokenService, asi que los servicios los aceptan al
// verificarlos contra el JWKS de auth. La llave nunca se imprime. Solo sirve en ese entorno.
//
//   node scripts/tokens.mjs --students 200 [--ttl-minutes 240]
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { calculateJwkThumbprint, exportJWK, importPKCS8, importSPKI, SignJWT } from 'jose';
import { DATA_DIR, LOAD_JWT, parseArgs, readData, readKey, writeData } from './lib/config.mjs';

const ALG = 'RS256';
const args = parseArgs();
const studentCount = Number(args.students ?? 50);
const ttlMinutes = Number(args['ttl-minutes'] ?? 240);

/** Igual que auth-service: el PEM puede venir tal cual o codificado en base64. */
function decodePem(value) {
  const text = value.includes('-----BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8');
  return text.replace(/\\n/g, '\n');
}

const privateKey = await importPKCS8(decodePem(readKey('private.b64')), ALG);
const publicKey = await importSPKI(decodePem(readKey('public.b64')), ALG, { extractable: true });
const kid = await calculateJwkThumbprint(await exportJWK(publicKey));
const { issuer, audience } = LOAD_JWT;

// Los identificadores se conservan entre corridas: asi una billetera creada antes se reutiliza.
const users = existsSync(join(DATA_DIR, 'users.json')) ? readData('users.json') : { staff: randomUUID(), students: [] };
while (users.students.length < studentCount) users.students.push(randomUUID());
writeData('users.json', users);

const sign = (sub, role) =>
  new SignJWT({ role })
    .setProtectedHeader({ alg: ALG, kid, typ: 'JWT' })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(privateKey);

const tokens = {
  // run.mjs vuelve a firmar si la llave del entorno cambio (p. ej. volumenes borrados).
  kid,
  expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
  staff: { id: users.staff, token: await sign(users.staff, 'STAFF') },
  students: await Promise.all(
    users.students.slice(0, studentCount).map(async (id) => ({ id, token: await sign(id, 'STUDENT') })),
  ),
};
writeData('tokens.json', tokens);
console.log(`Tokens firmados: 1 funcionario y ${tokens.students.length} estudiantes (kid ${kid.slice(0, 8)}…, vencen ${tokens.expiresAt}).`);
