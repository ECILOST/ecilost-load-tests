// Datos de la corrida preparada con scripts/setup.mjs y los tokens de scripts/tokens.mjs.
// `open` solo funciona en el contexto de inicio: este modulo se importa al tope de cada escenario.
import exec from 'k6/execution';

const run = JSON.parse(open('../../.data/run.json'));
const tokens = JSON.parse(open('../../.data/tokens.json'));

const tokenOf = new Map(tokens.students.map((student) => [student.id, student.token]));

/** Salas de la corrida; las corridas de una sola sala no traen `rooms`. */
export const rooms = (run.rooms ?? [run]).map((room) => ({ roomId: room.roomId, rounds: room.rounds, students: room.students }));

/**
 * Cada estudiante admitido, con su sala y su token, intercalados por sala (s1 de A, s1 de B,
 * s2 de A...). k6 numera seguidos los VUs de cada escenario: asi cada rol (espectador,
 * pujador) queda repartido entre las salas y no concentrado en una.
 */
const participants = [];
for (let i = 0; i < Math.max(...rooms.map((room) => room.students.length)); i += 1) {
  for (const room of rooms) {
    const id = room.students[i];
    if (id) participants.push({ id, token: tokenOf.get(id), roomId: room.roomId });
  }
}

export const runInfo = { runId: run.runId, scenario: run.scenario, tokensExpireAt: tokens.expiresAt };

/**
 * El estudiante de este VU. `idInTest` es unico entre todos los escenarios de la corrida, asi
 * que dos VUs vivos nunca comparten estudiante mientras haya tantos admitidos como VUs.
 */
export function currentStudent() {
  const index = (exec.vu.idInTest - 1) % participants.length;
  return participants[index];
}

/** Un admitido de la sala: `GET /rooms/:id/state` solo responde a participantes. */
export const roomMember = (roomId) => participants.find((p) => p.roomId === roomId);

/** Falla al inicio, no a mitad de corrida, si los datos no alcanzan para la carga pedida. */
export function assertCapacity(maxVus) {
  if (participants.length < maxVus) {
    throw new Error(`La corrida tiene ${participants.length} estudiantes admitidos y el escenario usa hasta ${maxVus} VUs: prepara mas con setup.mjs --students ${maxVus}.`);
  }
  if (participants.some((p) => !p.token)) throw new Error('Hay estudiantes de run.json sin token: corre tokens.mjs con mas estudiantes.');
  if (Date.parse(tokens.expiresAt) < Date.now() + 30 * 60_000) throw new Error(`Los tokens vencen ${tokens.expiresAt}: corre de nuevo scripts/tokens.mjs.`);
}
