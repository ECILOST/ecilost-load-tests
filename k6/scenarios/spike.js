// Pico: una sala tranquila recibe de golpe a mucha gente (la sala abre, se comparte el enlace,
// o el ultimo minuto con anti-sniping atrae a todos). Mide si aguanta la subida brusca de
// conexiones, room.join y pujas, y cuanto tarda en volver a la normalidad.
//
// BASE estudiantes en sala durante 1 m, sube a PEAK en SPIKE_RAMP, se mantiene SPIKE_HOLD,
// baja a BASE en SPIKE_RAMP y se observa la recuperacion durante RECOVERY.
//
//   node scripts/run.mjs spike
import { num, SUMMARY_TREND_STATS } from '../lib/config.js';
import { setupRun, teardownRun } from '../lib/lifecycle.js';
import { userMix } from '../lib/profiles.js';
import { ABORT_WHEN_DOWN, REFERENCE, REQUIREMENT } from '../lib/thresholds.js';
import { liveRoomSession } from '../flows/live-room.js';

const BASE = num('BASE', 10);
const PEAK = num('PEAK', 200);
const SPIKE_RAMP = __ENV.SPIKE_RAMP || '10s';
const SPIKE_HOLD = __ENV.SPIKE_HOLD || '1m';
const RECOVERY = __ENV.RECOVERY || '3m';

const { scenarios, maxVus } = userMix([
  { duration: '30s', target: BASE },
  { duration: '1m', target: BASE },
  { duration: SPIKE_RAMP, target: PEAK },
  { duration: SPIKE_HOLD, target: PEAK },
  { duration: SPIKE_RAMP, target: BASE },
  { duration: RECOVERY, target: BASE },
  { duration: '30s', target: 0 },
]);

export const options = {
  scenarios,
  thresholds: { ...REQUIREMENT, ...REFERENCE, ...ABORT_WHEN_DOWN },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = () => setupRun(maxVus);
export const teardown = teardownRun;
export const viewer = (data) => liveRoomSession(data, 'viewer');
export const bidder = (data) => liveRoomSession(data, 'bidder');
