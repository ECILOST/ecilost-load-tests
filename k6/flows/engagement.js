import { getLeaderboard, getPickups, getPickupSlots, getProfile } from '../lib/api.js';
import { num, str } from '../lib/config.js';

// The legacy baseline remains reproducible with EXTENDED_READS=false.
let nextRead = 0;
export async function engagementReads(token) {
  if (str('EXTENDED_READS', 'true') === 'false' || Date.now() < nextRead) return;
  nextRead = Date.now() + num('ENGAGEMENT_READ_INTERVAL', 30) * 1000;
  await Promise.all([getPickups(token), getPickupSlots(token),
    ...(str('GAMIFICATION', 'true') === 'true' ? [getProfile(token), getLeaderboard(token)] : []),
  ]);
}
