// Tormenta de pujas (HU-20, HU-21, HU-23): VUS estudiantes pujan a la vez sobre la misma ronda.
// Aisla la contencion del lock de ronda (H1 en docs/RESULTADOS.md); no modela la pantalla de
// sala completa (para eso estan load/stress/spike).
//
// Cada usuario virtual es un estudiante admitido de .data/run.json. En cada iteracion lee el
// estado de la sala, como haria la pantalla, y puja el precio vigente + 100 a 500. Perder la
// carrera (409: otra puja llego primero) es parte del juego y no cuenta como error; un 5xx si.
//
// No hay umbrales de latencia: el backlog no fija ninguno (supuesto A4). Se reportan p50/p95/p99
// y las garantias se comprueban despues con scripts/verify.mjs.
//
//   node scripts/run.mjs bid-storm -- -e VUS=25 -e DURATION=90s
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { getRoomState, placeBid } from '../lib/api.js';
import { num, SUMMARY_TREND_STATS } from '../lib/config.js';
import { assertCapacity, currentStudent, rooms } from '../lib/data.js';

const VUS = num('VUS', 25);
/** Pausa maxima entre pujas de un mismo estudiante, en segundos (como alguien que mira y reacciona). */
const THINK = num('THINK', 1);
const roundId = rooms[0].rounds[0].id;

const bidLatency = new Trend('bid_latency', true);

export const options = {
  scenarios: {
    storm: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '90s' },
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = () => assertCapacity(VUS);

export default function () {
  const student = currentStudent();
  const state = getRoomState(student.token, student.roomId);
  const round = state?.currentRound ?? null;
  if (!round || round.id !== roundId) {
    // La ronda ya cerro o la sala termino: no hay a que pujar.
    sleep(1);
    return;
  }

  const amount = Math.floor(Number(round.currentPrice) + 100 + Math.random() * 400);
  const result = placeBid(student.token, roundId, amount);
  bidLatency.add(result.duration, { status: String(result.status) });
  check(result, { 'puja respondida (201 o 409)': (r) => r.status === 201 || r.status === 409 });

  sleep(Math.random() * THINK);
}
