// Real clock, real roulette and API-only fixtures; never force a round's mode or closure.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, SERVICE_URL, readData, writeData } from './lib/config.mjs';
import { HttpError, request, sleep } from './lib/http.mjs';

function script(name, args) {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', name), ...args], { stdio: 'inherit' });
  assert.equal(result.status, 0, `${name} failed`);
}
async function conflict(work) {
  await assert.rejects(work, (error) => error instanceof HttpError && error.status === 409);
}
async function until(work, predicate, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await work();
    if (predicate(value)) return value;
    await sleep(1000);
  }
  throw new Error('Sealed round or settlement did not converge before the deadline');
}

script('tokens.mjs', ['--students', '24']);
let room;
let prepared;
// The roulette can legitimately omit SEALED. Bound retries rather than editing the database.
for (let attempt = 0; attempt < 3 && !room; attempt += 1) {
  script('setup.mjs', ['--scenario', 'sealed-smoke', '--students', '24', '--rooms', '8',
    '--rounds', '1', '--dynamic', '--recharge', '10000', '--starts-in', '30']);
  prepared = readData('run.json');
  room = prepared.rooms.find((candidate) => candidate.rounds[0].mode === 'SEALED');
}
assert.ok(room, 'No SEALED round was drawn after three bounded preparations; rerun this test');
const run = { ...prepared, ...room, rooms: [room], students: room.students };
writeData('run.json', run);
writeData('sealed-smoke-run.json', run);
const tokens = readData('tokens.json');
const people = room.students.map((id) => tokens.students.find((person) => person.id === id));
assert.equal(people.length, 3);
const roundId = room.rounds[0].id;
const base = `${SERVICE_URL.auction}/rounds/${roundId}`;
const detail = () => request('GET', `${SERVICE_URL.auction}/rooms/${room.roomId}`, { token: tokens.staff.token });
await until(detail, (value) => value.rounds[0].status === 'ACTIVE', 120_000);
await conflict(() => request('GET', `${base}/sealed-results`, { token: people[0].token }));
const amounts = [1000, 2000, 1500];
await Promise.all(people.map(async (person, index) => {
  const receipt = await request('POST', `${base}/sealed-bid`, { token: person.token, body: { amount: amounts[index] } });
  assert.equal(receipt.roundId, roundId);
  assert.equal(Number(receipt.amount), amounts[index]);
}));
await conflict(() => request('POST', `${base}/sealed-bid`, { token: people[0].token, body: { amount: 3000 } }));
await conflict(() => request('GET', `${base}/sealed-results`, { token: people[1].token }));
console.log(`SEALED ${run.runId}: three bids accepted, duplicate rejected, results remain private; waiting for server clock`);
const closed = await until(detail, (value) => value.rounds[0].status === 'CLOSED', 240_000);
assert.equal(closed.rounds[0].result, 'AWARDED');
for (const [index, person] of people.entries()) {
  const results = await request('GET', `${base}/sealed-results`, { token: person.token });
  assert.deepEqual(results.ranking.map((entry) => Number(entry.amount)), [2000, 1500, 1000]);
  assert.equal(results.sealedCount, 3);
  assert.equal(results.myRank, [3, 1, 2][index]);
  assert.equal(results.ranking.filter((entry) => entry.winner).length, 1);
  assert.equal(results.ranking[0].winner, true);
  assert.equal(results.ranking[0].mine, index === 1);
  assert.ok(results.ranking.every((entry) => !('bidderId' in entry) && !('userId' in entry)));
}
for (const person of people) {
  await until(() => request('GET', `${SERVICE_URL.wallet}/me`, { token: person.token }), (value) => Number(value.heldBalance) === 0, 30_000);
}
script('verify.mjs', ['--run', join(ROOT, '.data', 'sealed-smoke-run.json'), '--strict-settlement']);
writeData('sealed-smoke-results.json', { runId: run.runId, roundId, passed: true, finishedAt: new Date().toISOString(),
  checks: ['three sealed bids', 'duplicate rejected', 'private until closed', 'highest bidder wins', 'anonymous sorted ranking', 'strict settlement'] });
console.log('OK SEALED: natural closure, anonymous ranking, unique winner and strict settlement');
