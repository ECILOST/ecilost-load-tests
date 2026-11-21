// setup() y teardown() comunes a los escenarios con salas.
import { fail } from 'k6';
import { getRoomState } from './api.js';
import { measureClockOffset } from './clock.js';
import { assertCapacity, roomMember, rooms, runInfo } from './data.js';

/**
 * Antes de generar carga: los datos alcanzan, los tokens no vencen durante la corrida y todas
 * las salas estan abiertas. Devuelve el desfase de reloj para las metricas de tiempo real.
 */
export async function setupRun(maxVus) {
  assertCapacity(maxVus);
  for (const room of rooms) {
    const state = await getRoomState(roomMember(room.roomId).token, room.roomId);
    if (!state) fail(`No se pudo leer la sala ${room.roomId}.`);
    if (state.status !== 'ACTIVE') fail(`La sala ${room.roomId} esta ${state.status}: prepara la corrida con setup.mjs --wait-active.`);
  }
  const first = roomMember(rooms[0].roomId);
  const clockOffset = measureClockOffset(first.token, first.roomId);
  console.log(`Corrida ${runInfo.runId} (${runInfo.scenario}): ${rooms.length} sala(s); desfase de reloj servidor-k6 ${clockOffset} ms`);
  return { clockOffset };
}

/** Deja en el log como quedaron las salas; las garantias las comprueba scripts/verify.mjs. */
export async function teardownRun() {
  for (const room of rooms) {
    const state = await getRoomState(roomMember(room.roomId).token, room.roomId);
    if (state) console.log(`Al terminar: sala ${room.roomId.slice(0, 8)} ${state.status}, ronda vigente ${state.currentRound?.position ?? '-'}`);
  }
}
