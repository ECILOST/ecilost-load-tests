// Humo: pocos usuarios durante poco tiempo, para validar scripts, datos y el envio de metricas
// a Prometheus antes de cualquier prueba con carga. Debe pasar sin un solo error.
//
//   node scripts/run.mjs smoke
//   (o: setup.mjs --scenario smoke --students 5 --wait-active; k6 run k6/scenarios/smoke.js)
import { num, SUMMARY_TREND_STATS } from '../lib/config.js';
import { setupRun, teardownRun } from '../lib/lifecycle.js';
import { REFERENCE, REQUIREMENT } from '../lib/thresholds.js';
import { browseCatalog } from '../flows/browse.js';
import { liveRoomSession } from '../flows/live-room.js';

const DURATION = __ENV.DURATION || '90s';
const VIEWERS = num('VIEWERS', 2);
const BIDDERS = num('BIDDERS', 2);
const BROWSERS = num('BROWSERS', 1);

export const options = {
  scenarios: {
    viewers: { executor: 'constant-vus', exec: 'viewer', vus: VIEWERS, duration: DURATION },
    bidders: { executor: 'constant-vus', exec: 'bidder', vus: BIDDERS, duration: DURATION },
    browsers: { executor: 'constant-vus', exec: 'browser', vus: BROWSERS, duration: DURATION },
  },
  thresholds: {
    ...REQUIREMENT,
    ...REFERENCE,
    // En humo no se tolera ningun error.
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    ws_errors: ['count==0'],
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = () => setupRun(VIEWERS + BIDDERS + BROWSERS);
export const teardown = teardownRun;
export const viewer = (data) => liveRoomSession(data, 'viewer');
export const bidder = (data) => liveRoomSession(data, 'bidder');
export const browser = () => browseCatalog();
