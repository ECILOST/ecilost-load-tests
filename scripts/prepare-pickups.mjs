// Materialize genuine paid awards through the public APIs before pickup load begins.
import assert from 'node:assert/strict';
import { readData, SERVICE_URL, writeData } from './lib/config.mjs';
import { request, sleep } from './lib/http.mjs';

const run = readData('run.json');
const tokens = readData('tokens.json');
const assignments = [];
for (const room of run.rooms) {
  for (const [index, round] of room.rounds.entries()) {
    const id = room.students[index];
    if (!id) continue;
    const person = tokens.students.find((student) => student.id === id);
    await request('POST', `${SERVICE_URL.auction}/rounds/${round.id}/buy-now`, { token: person.token });
    assignments.push({ id, roundId: round.id });
  }
}
assert.equal(assignments.length, run.students.length, 'Each virtual collector needs a distinct paid award');
const deadline = Date.now() + 60_000;
for (;;) {
  const all = await request('GET', `${SERVICE_URL.engagement}/pickups/staff`, { token: tokens.staff.token });
  if (assignments.every((assignment) => all.some((pickup) => pickup.roundId === assignment.roundId))) break;
  if (Date.now() > deadline) throw new Error('Paid awards did not produce pickup projections');
  await sleep(300);
}
const slots = [];
for (let index = 0; index < 2; index += 1) {
  slots.push(await request('POST', `${SERVICE_URL.engagement}/pickups/staff/slots`, {
    token: tokens.staff.token,
    body: { location: `CARGA ${run.runId} ${index}`, startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 7_200_000).toISOString(), capacity: index === 0 ? Math.max(1, Math.ceil(assignments.length / 5)) : assignments.length },
  }));
}
writeData('run.json', { ...run, pickups: { assignments, slotIds: slots.map((slot) => slot.id) } });
console.log(`Prepared ${assignments.length} paid pickups and two competing slots`);
