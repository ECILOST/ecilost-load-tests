// Tormenta de pujas (HU-20, HU-21, HU-23): VUS estudiantes pujan a la vez sobre la misma ronda.
//
// Cada usuario virtual es un estudiante admitido de .data/run.json. En cada iteracion lee el
// estado de la sala, como haria la pantalla, y puja el precio vigente + 100 a 500. Perder la
// carrera (409: otra puja llego primero) es parte del juego y no cuenta como error; un 5xx si.
//
// No hay umbrales de latencia: el backlog no fija ninguno (supuesto A4). Se reportan p50/p95/p99
// y las garantias se comprueban despues con scripts/verify.mjs.
//
//   k6 run -e VUS=25 -e DURATION=90s --summary-export results/bid-storm-25.json k6/bid-storm.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const run = JSON.parse(open('../.data/run.json'));
const tokens = JSON.parse(open('../.data/tokens.json'));
const AUCTION = __ENV.AUCTION_URL || 'http://localhost:3003';
const VUS = Number(__ENV.VUS || 25);
/** Pausa maxima entre pujas de un mismo estudiante, en segundos (como alguien que mira y reacciona). */
const THINK = Number(__ENV.THINK || 1);

const byId = new Map(tokens.students.map((student) => [student.id, student.token]));
const students = run.students.map((id) => ({ id, token: byId.get(id) }));
const roundId = run.rounds[0].id;
if (students.length < VUS) throw new Error(`La corrida tiene ${students.length} estudiantes y se pidieron ${VUS} VUs.`);

const accepted = new Counter('bids_accepted');
const unavailable = new Counter('bids_unavailable');
/**
 * Los 409 por motivo. "Fondos insuficientes" no deberia aparecer: cada estudiante tiene saldo de
 * sobra, asi que si aparece es que wallet rechazo la reserva por otra causa y auction lo
 * reporto como falta de saldo.
 */
const conflicts = {
  outbid: new Counter('bids_409_outbid'),
  belowMinimum: new Counter('bids_409_below_minimum'),
  insufficientFunds: new Counter('bids_409_insufficient_funds'),
  roundClosed: new Counter('bids_409_round_closed'),
  other: new Counter('bids_409_other'),
};

function conflictReason(response) {
  const message = String(response.json('message') ?? '');
  if (message.includes('Otra puja llego primero')) return 'outbid';
  if (message.includes('al menos')) return 'belowMinimum';
  if (message.includes('ECICoin disponibles')) return 'insufficientFunds';
  if (message.includes('no esta activa')) return 'roundClosed';
  return 'other';
}
const bidLatency = new Trend('bid_latency', true);
const stateLatency = new Trend('state_latency', true);

// 201 (aceptada) y 409 (otra puja llego primero) son respuestas esperadas; el resto es error.
http.setResponseCallback(http.expectedStatuses(200, 201, 409));

export const options = {
  scenarios: {
    storm: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '90s' },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const student = students[(__VU - 1) % students.length];
  const headers = { authorization: `Bearer ${student.token}`, 'content-type': 'application/json' };

  const state = http.get(`${AUCTION}/rooms/${run.roomId}/state`, { headers, tags: { name: 'GET /rooms/:id/state' } });
  stateLatency.add(state.timings.duration);
  const round = state.status === 200 ? state.json('currentRound') : null;
  if (!round || round.id !== roundId) {
    // La ronda ya cerro o la sala termino: no hay a que pujar.
    sleep(1);
    return;
  }

  const price = Number(round.currentPrice);
  const amount = Math.floor(price + 100 + Math.random() * 400);
  const response = http.post(`${AUCTION}/rounds/${roundId}/bids`, JSON.stringify({ amount }), {
    headers, tags: { name: 'POST /rounds/:id/bids' },
  });
  bidLatency.add(response.timings.duration, { status: String(response.status) });
  if (response.status === 201) accepted.add(1);
  else if (response.status === 409) conflicts[conflictReason(response)].add(1);
  else if (response.status >= 500) unavailable.add(1);
  check(response, { 'puja respondida (201 o 409)': (r) => r.status === 201 || r.status === 409 });

  sleep(Math.random() * THINK);
}
