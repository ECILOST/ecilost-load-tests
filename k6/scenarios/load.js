// Carga nominal: como se comporta el sistema con la gente que se espera en un evento.
//
// Referencia (supuesto, no requisito): USERS estudiantes en sala repartidos entre las salas de
// la corrida (2 salas x 50 por defecto) y BROWSERS mirando el catalogo. Subida de RAMP para
// no medir el arranque en frio, HOLD estable (cruza al menos un cierre de ronda) y bajada.
//
//   node scripts/run.mjs load                    (USERS=100)
//   node scripts/run.mjs load -- -e USERS=50     (variantes 25/50/100 para comparar)
import { num, SUMMARY_TREND_STATS } from '../lib/config.js';
import { setupRun, teardownRun } from '../lib/lifecycle.js';
import { userMix } from '../lib/profiles.js';
import { REFERENCE, REQUIREMENT } from '../lib/thresholds.js';
import { browseCatalog } from '../flows/browse.js';
import { liveRoomSession } from '../flows/live-room.js';

const USERS = num('USERS', 100);
const BROWSERS = num('BROWSERS', 20);
const RAMP = __ENV.RAMP || '2m';
const HOLD = __ENV.HOLD || '10m';

const { scenarios, maxVus } = userMix(
  [{ duration: RAMP, target: USERS }, { duration: HOLD, target: USERS }, { duration: '1m', target: 0 }],
  [{ duration: RAMP, target: BROWSERS }, { duration: HOLD, target: BROWSERS }, { duration: '1m', target: 0 }],
);

export const options = {
  scenarios,
  thresholds: { ...REQUIREMENT, ...REFERENCE },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = () => setupRun(maxVus);
export const teardown = teardownRun;
export const viewer = (data) => liveRoomSession(data, 'viewer');
export const bidder = (data) => liveRoomSession(data, 'bidder');
export const browser = () => browseCatalog();
