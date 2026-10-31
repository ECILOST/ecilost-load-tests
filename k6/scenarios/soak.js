// Resistencia: carga moderada y constante durante mucho tiempo, para ver lo que una corrida
// corta no muestra: memoria que crece (fugas), event loop que se degrada, conexiones a
// Postgres o a RabbitMQ que se acumulan y colas que no se vacian. Cruza muchas rondas y cierres.
//
// USERS estudiantes en sala y BROWSERS en el catalogo durante DURATION. Por defecto 10 min en
// total (1 min de subida, 8 min 30 s estables, 30 s de bajada): alcanza para ver deriva de
// memoria o de conexiones a lo largo de varias rondas, no fugas lentas; para eso, DURATION mayor.
//
//   node scripts/run.mjs soak
//   node scripts/run.mjs soak -- -e DURATION=45m
import { num, SUMMARY_TREND_STATS } from '../lib/config.js';
import { setupRun, teardownRun } from '../lib/lifecycle.js';
import { userMix } from '../lib/profiles.js';
import { REFERENCE, REQUIREMENT } from '../lib/thresholds.js';
import { browseCatalog } from '../flows/browse.js';
import { liveRoomSession } from '../flows/live-room.js';

const USERS = num('USERS', 60);
const BROWSERS = num('BROWSERS', 10);
const DURATION = __ENV.DURATION || '8m30s';

const { scenarios, maxVus } = userMix(
  [{ duration: '1m', target: USERS }, { duration: DURATION, target: USERS }, { duration: '30s', target: 0 }],
  [{ duration: '1m', target: BROWSERS }, { duration: DURATION, target: BROWSERS }, { duration: '30s', target: 0 }],
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
