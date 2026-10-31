// Estres: sube por escalones hasta encontrar donde se degrada y donde se satura el sistema, y
// despues baja a poca carga para ver si se recupera solo.
//
// Escalones de STEPS estudiantes en sala (total entre las salas), cada uno STEP_HOLD estable
// tras STEP_RAMP de subida; luego RECOVERY_USERS durante RECOVERY. Por defecto, 10 min en total:
// 6 x (20 s + 1 min) + 20 s + 1 min 20 s + 20 s. No hay umbral de
// aprobacion: se registran los de requisito y referencia para ver en que escalon se rompen, y
// la corrida se corta sola si mas de la mitad de las peticiones fallan (ya no hay nada que medir).
//
//   node scripts/run.mjs stress
//   node scripts/run.mjs stress -- -e STEPS=100,200,300 -e STEP_HOLD=2m
import { num, str, SUMMARY_TREND_STATS } from '../lib/config.js';
import { setupRun, teardownRun } from '../lib/lifecycle.js';
import { userMix } from '../lib/profiles.js';
import { ABORT_WHEN_DOWN, REFERENCE, REQUIREMENT } from '../lib/thresholds.js';
import { browseCatalog } from '../flows/browse.js';
import { liveRoomSession } from '../flows/live-room.js';

const STEPS = str('STEPS', '50,100,150,200,300,400').split(',').map(Number);
const STEP_RAMP = __ENV.STEP_RAMP || '20s';
const STEP_HOLD = __ENV.STEP_HOLD || '1m';
const RECOVERY_USERS = num('RECOVERY_USERS', 25);
const RECOVERY = __ENV.RECOVERY || '1m20s';
/** Visitantes del catalogo: fijos, para que el escalon solo mueva la gente en sala. */
const BROWSERS = num('BROWSERS', 20);

const roomStages = STEPS.flatMap((target) => [{ duration: STEP_RAMP, target }, { duration: STEP_HOLD, target }]);
roomStages.push({ duration: '20s', target: RECOVERY_USERS }, { duration: RECOVERY, target: RECOVERY_USERS }, { duration: '20s', target: 0 });
const total = roomStages.map((s) => s.duration);
const browserStages = total.map((duration, i) => ({ duration, target: i === total.length - 1 ? 0 : BROWSERS }));

const { scenarios, maxVus } = userMix(roomStages, browserStages);

export const options = {
  scenarios,
  thresholds: { ...REQUIREMENT, ...REFERENCE, ...ABORT_WHEN_DOWN },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = () => setupRun(maxVus);
export const teardown = teardownRun;
export const viewer = (data) => liveRoomSession(data, 'viewer');
export const bidder = (data) => liveRoomSession(data, 'bidder');
export const browser = () => browseCatalog();
