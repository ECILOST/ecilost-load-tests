import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { SERVICE_URL, num, SUMMARY_TREND_STATS } from '../lib/config.js';
const run = JSON.parse(open('../../.data/run.json'));
const tokens = JSON.parse(open('../../.data/tokens.json'));
const maxUsers = num('USERS', 10);
const stress = run.scenario === 'pickup-stress';
const steps = (__ENV.STEPS || '5,10,20').split(',').map(Number);
const capacity = stress ? Math.max(...steps) : maxUsers;
if (!run.pickups || run.pickups.assignments.length < capacity) throw new Error('Prepare at least one paid pickup per VU using the runner');
export const options = {
  scenarios: { collectors: stress
    ? { executor: 'ramping-vus', startVUs: 0, stages: [...steps.flatMap((target) => [{ duration: __ENV.STEP_RAMP || '10s', target }, { duration: __ENV.STEP_HOLD || '30s', target }]), { duration: '10s', target: 0 }], gracefulRampDown: '5s' }
    : { executor: 'constant-vus', vus: maxUsers, duration: __ENV.DURATION || '2m' } },
  thresholds: { checks: ['rate==1'], http_req_failed: [{ threshold: stress ? 'rate<0.5' : 'rate<0.01', abortOnFail: stress, delayAbortEval: '30s' }] },
  summaryTrendStats: SUMMARY_TREND_STATS,
};
export default async function () {
  const assignment = run.pickups.assignments[exec.vu.idInTest - 1];
  if (!assignment) throw new Error('No unique pickup assigned to VU');
  const token = tokens.students.find((person) => person.id === assignment.id).token;
  const base = `${SERVICE_URL.engagement}/pickups/mine/${assignment.roundId}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const slotId = run.pickups.slotIds[exec.vu.iterationInScenario % 2];
  const response = await http.asyncRequest('POST', `${base}/booking`, JSON.stringify({ slotId }), {
    headers, tags: { name: 'POST /pickups/mine/:id/booking' }, responseCallback: http.expectedStatuses(201, 409),
  });
  check(response, { 'booking accepted or capacity conflict': (r) => r.status === 201 || r.status === 409 });
  const detail = await http.asyncRequest('GET', base, null, { headers, tags: { name: 'GET /pickups/mine/:id' } });
  check(detail, { 'own pickup readable': (r) => r.status === 200 && r.json().winnerId === assignment.id });
  if (response.status === 201) {
    const code = await http.asyncRequest('POST', `${base}/code`, null, { headers, tags: { name: 'POST /pickups/mine/:id/code' } });
    check(code, { 'booked pickup issues a delivery code': (r) => r.status === 201 && typeof r.json().code === 'string' && r.json().code.length === 16 });
  }
  sleep(num('THINK_SECONDS', 2));
}
