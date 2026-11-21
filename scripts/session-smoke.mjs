// Synthetic JWT expiry/reconnect proof; does not exercise Google's login or refresh cookie flow.
import assert from 'node:assert/strict';
import { importPKCS8, SignJWT } from 'jose';
import { io } from 'socket.io-client';
import { LOAD_JWT, SERVICE_URL, readData, readKey } from './lib/config.mjs';
const run = readData('run.json');
const tokens = readData('tokens.json');
const person = tokens.students.find((student) => run.students.includes(student.id));
const key = await importPKCS8(Buffer.from(readKey('private.b64'), 'base64').toString('utf8'), 'RS256');
const expiresAt = Math.floor(Date.now() / 1000) + 8;
const short = await new SignJWT({ role: 'STUDENT' }).setProtectedHeader({ alg: 'RS256', kid: readKey('kid') })
  .setSubject(person.id).setIssuer(LOAD_JWT.issuer).setAudience(LOAD_JWT.audience).setIssuedAt().setExpirationTime(expiresAt).sign(key);
async function connect(token) {
  const socket = io(`${SERVICE_URL.engagement}/realtime`, { transports: ['websocket'], auth: { token }, reconnection: false, timeout: 5000 });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timeout')), 6000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
    });
    const joined = await socket.timeout(5000).emitWithAck('room.join', { roomId: run.roomId, token });
    assert.equal(joined.ok, true);
    return socket;
  } catch (error) { socket.disconnect(); throw error; }
}
const first = await connect(short);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Expired token did not close socket')), 12_000);
    first.once('disconnect', () => { clearTimeout(timer); resolve(); });
  });
  assert.ok(Date.now() >= expiresAt * 1000 - 1000, 'Socket disconnected before JWT expiration');
} finally { first.disconnect(); }
const second = await connect(person.token);
second.disconnect();
console.log('OK expired synthetic JWT disconnects; fresh token reconnects and restores room subscription');
