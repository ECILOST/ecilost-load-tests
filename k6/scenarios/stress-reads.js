// Capacidad de lectura de la sala, con modelo abierto (`ramping-arrival-rate`): k6 lanza
// RATES relecturas por segundo pase lo que pase, asi que si el servicio se frena la cola crece y
// se ve (en un modelo cerrado los VUs esperarian y la carga bajaria sola: coordinated omission).
//
// Una iteracion es exactamente lo que hace cada espectador por cada evento de la sala:
// GET /rooms/:id + GET /rooms/:id/state + GET /notifications. Con N espectadores y E eventos
// por segundo la sala necesita N x E de estas por segundo; el resultado dice cuantas aguanta.
//
//   node scripts/run.mjs stress-reads
//   node scripts/run.mjs stress-reads -- -e RATES=20,100,300 -e STEP=1m
import { getNotifications, getRoom, getRoomState } from '../lib/api.js';
import { num, str, SUMMARY_TREND_STATS } from '../lib/config.js';
import { currentStudent } from '../lib/data.js';
import { setupRun, teardownRun } from '../lib/lifecycle.js';
import { ABORT_WHEN_DOWN } from '../lib/thresholds.js';

const RATES = str('RATES', '10,50,100,200,400').split(',').map(Number);
/** 5 escalones x (15 s + STEP) = 10 min por defecto. */
const STEP = __ENV.STEP || '1m45s';
const MAX_VUS = num('MAX_VUS', 200);

const stages = RATES.flatMap((target) => [{ duration: '15s', target }, { duration: STEP, target }]);

export const options = {
  scenarios: {
    reads: {
      executor: 'ramping-arrival-rate',
      exec: 'refresh',
      startRate: 1,
      timeUnit: '1s',
      stages,
      // Cada VU es un estudiante admitido; si no alcanzan, k6 registra dropped_iterations.
      preAllocatedVUs: Math.min(MAX_VUS, 50),
      maxVUs: MAX_VUS,
    },
  },
  thresholds: {
    ...ABORT_WHEN_DOWN,
    // Referencia: la relectura completa debe sentirse instantanea.
    'http_req_duration{name:GET /rooms/:id}': ['p(95)<300'],
    'http_req_duration{name:GET /rooms/:id/state}': ['p(95)<300'],
    dropped_iterations: ['count==0'],
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = () => setupRun(MAX_VUS);
export const teardown = teardownRun;

export async function refresh() {
  const me = currentStudent();
  // Como `refresh()` del frontend: detalle y estado en serie, notificaciones en paralelo.
  await Promise.all([
    getRoom(me.token, me.roomId).then(() => getRoomState(me.token, me.roomId)),
    getNotifications(me.token),
  ]);
}
