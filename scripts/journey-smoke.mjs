// Bounded end-to-end concurrency proof. Uses only isolated load databases and synthetic users.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { ROOT, SERVICE_URL, readData, writeData } from './lib/config.mjs';
import { HttpError, request, sleep } from './lib/http.mjs';

function script(name, args) {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', name), ...args], { stdio: 'inherit' });
  assert.equal(result.status, 0, `${name} failed`);
}
async function eventually(work, predicate, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await work();
    if (predicate(value)) return value;
    await sleep(300);
  } while (Date.now() < deadline);
  throw new Error('Projection did not converge before the deadline');
}
async function attempt(method, url, options) {
  try { return { ok: true, body: await request(method, url, options) }; }
  catch (error) { if (error instanceof HttpError && [400, 409].includes(error.status)) return { ok: false, status: error.status }; throw error; }
}
const results = [];
script('tokens.mjs', ['--students', '5']);
script('setup.mjs', ['--scenario', 'journey-smoke', '--students', '5', '--rounds', '2', '--buy-now', '500', '--starts-in', '20', '--wait-active']);
const run = readData('run.json');
const tokens = readData('tokens.json');
const people = tokens.students.slice(0, 2);
const staff = tokens.staff;
const E = SERVICE_URL.engagement;
const A = SERVICE_URL.auction;
const call = (person, method, path, body) => request(method, E + path, { token: person.token, body });

// Exercise chat acknowledgements with a finite timeout before closing the room.
const socket = io(`${E}/realtime`, { transports: ['websocket'], auth: { token: people[0].token }, reconnection: false, timeout: 5000 });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timeout')), 6000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
  const joined = await socket.timeout(5000).emitWithAck('chat.join', { roomId: run.roomId, token: people[0].token });
  assert.equal(joined.ok, true);
  const sent = await socket.timeout(5000).emitWithAck('chat.send', { roomId: run.roomId, token: people[0].token, text: `Humo ${run.runId}` });
  assert.equal(sent.ok, true);
  results.push('chat join/send acknowledged');
} finally { socket.disconnect(); }

const first = run.rounds[0];
const purchases = await Promise.all(people.map((person) => attempt('POST', `${A}/rounds/${first.id}/buy-now`, { token: person.token })));
assert.equal(purchases.filter((result) => result.ok).length, 1, 'Exactly one buyer must win');
assert.equal(purchases.find((result) => !result.ok).status, 409);
const winnerIndex = purchases.findIndex((result) => result.ok);
const winner = people[winnerIndex];
const other = people[1 - winnerIndex];
const replay = await request('POST', `${A}/rounds/${first.id}/buy-now`, { token: winner.token });
assert.equal(replay.replayed, true);
await request('POST', `${A}/rounds/${run.rounds[1].id}/buy-now`, { token: other.token });
results.push('buy-now race has one winner and idempotent replay');
const assignments = [{ person: winner, roundId: first.id }, { person: other, roundId: run.rounds[1].id }];
for (const { person, roundId } of assignments) {
  await eventually(() => call(person, 'GET', '/pickups/mine'), (rows) => rows.some((row) => row.roundId === roundId));
}
const startsAt = new Date(Date.now() + 12_000).toISOString();
const endsAt = new Date(Date.parse(startsAt) + 120_000).toISOString();
const slot = await call(staff, 'POST', '/pickups/staff/slots', { location: `CARGA ${run.runId}`, startsAt, endsAt, capacity: 1 });
const bookings = await Promise.all(assignments.map(({ person, roundId }) => attempt('POST', `${E}/pickups/mine/${roundId}/booking`, { token: person.token, body: { slotId: slot.id } })));
assert.equal(bookings.filter((result) => result.ok).length, 1, 'The last slot cannot be oversubscribed');
assert.equal(bookings.find((result) => !result.ok).status, 409);
const booked = assignments[bookings.findIndex((result) => result.ok)];
await call(booked.person, 'POST', `/pickups/mine/${booked.roundId}/help`, { message: 'Necesito confirmar la ubicación' });
await call(staff, 'POST', `/pickups/staff/${booked.roundId}/reply`, { message: 'La recogida es en recepción' });
const code = await call(booked.person, 'POST', `/pickups/mine/${booked.roundId}/code`);
await sleep(Math.max(0, Date.parse(startsAt) - Date.now() + 100));
const deliveries = await Promise.all([1, 2].map(() => attempt('POST', `${E}/pickups/staff/${booked.roundId}/delivery`, { token: staff.token, body: { code: code.code } })));
assert.equal(deliveries.filter((result) => result.ok).length, 1, 'A delivery code may be consumed only once');
assert.equal(deliveries.find((result) => !result.ok).status, 409);
const detail = await call(booked.person, 'GET', `/pickups/mine/${booked.roundId}`);
assert.equal(detail.status, 'DELIVERED');
results.push('one-capacity slot race, staff help/reply and single-use delivery code');
for (const path of ['/profiles/me', '/leaderboard?week=current', '/notifications', `/rooms/${run.roomId}/activity`]) await call(winner, 'GET', path);
results.push('profile, leaderboard, notifications and activity available');
// Let asynchronous wallet settlement converge before the strict financial assertions below.
for (const person of people) await eventually(() => request('GET', `${SERVICE_URL.wallet}/me`, { token: person.token }), (wallet) => Number(wallet.heldBalance) === 0);
script('verify.mjs', ['--strict-settlement']);
writeData('journey-smoke-results.json', { runId: run.runId, results, passed: true, finishedAt: new Date().toISOString() });
console.log(results.map((text) => `OK ${text}`).join('\n'));
