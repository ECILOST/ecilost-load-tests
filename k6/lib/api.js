// Llamadas HTTP de ECILOST tal como las hace el frontend (ecilost-frontend/src/features/*/api).
// Cada una lleva la etiqueta `name` con la plantilla de ruta, para que k6 y Prometheus agrupen
// por endpoint y no por URL, y valida estado y forma del cuerpo con checks.
import http from 'k6/http';
import { check } from 'k6';
import { SERVICE_URL } from './config.js';
import { bidConflicts, bidsAccepted, bidsUnavailable } from './metrics.js';

const OK = http.expectedStatuses(200);
/** En una puja el 409 es una respuesta de negocio (otra puja llego primero), no un fallo. */
const BID_EXPECTED = http.expectedStatuses(201, 409);

function headers(token, json = false) {
  return { authorization: `Bearer ${token}`, ...(json ? { 'content-type': 'application/json' } : {}) };
}

function json(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

/** GET con estado 200 esperado y una validacion del cuerpo. Devuelve el cuerpo o null. */
function get(url, token, name, valid) {
  const response = http.get(url, { headers: headers(token), tags: { name }, responseCallback: OK });
  const body = response.status === 200 ? json(response) : null;
  check(response, { [`${name} 200`]: (r) => r.status === 200, [`${name} cuerpo valido`]: () => body !== null && valid(body) });
  return body;
}

// --- auction ---------------------------------------------------------------------------------
export const listRooms = (token) => get(`${SERVICE_URL.auction}/rooms`, token, 'GET /rooms', Array.isArray);

export const listOpenRoomsWithRounds = (token) =>
  get(`${SERVICE_URL.auction}/rooms?include=rounds&status=SCHEDULED,ACTIVE`, token, 'GET /rooms?include=rounds', Array.isArray);

export const getRoom = (token, roomId) =>
  get(`${SERVICE_URL.auction}/rooms/${roomId}`, token, 'GET /rooms/:id', (body) => body.id === roomId && Array.isArray(body.rounds));

export const getRoomState = (token, roomId) =>
  get(`${SERVICE_URL.auction}/rooms/${roomId}/state`, token, 'GET /rooms/:id/state', (body) => body.id === roomId && 'currentRound' in body);

/** Mensaje del 409 a su motivo; los textos son los de auction (bids.service.ts). */
function conflictReason(response) {
  const message = String(json(response)?.message ?? '');
  if (message.includes('Otra puja llego primero')) return 'outbid';
  if (message.includes('al menos')) return 'belowMinimum';
  if (message.includes('ECICoin disponibles')) return 'insufficientFunds';
  if (message.includes('no esta activa')) return 'roundClosed';
  return 'other';
}

/**
 * Puja manual. Devuelve `{ status, accepted, duration, sentAt, answeredAt }`: `duration` es la de
 * k6 (ms); `sentAt`/`answeredAt`, el reloj local para cruzarlo con el evento del socket.
 */
export function placeBid(token, roundId, amount) {
  const sentAt = Date.now();
  const response = http.post(`${SERVICE_URL.auction}/rounds/${roundId}/bids`, JSON.stringify({ amount }), {
    headers: headers(token, true), tags: { name: 'POST /rounds/:id/bids' }, responseCallback: BID_EXPECTED,
  });
  const answeredAt = Date.now();
  const accepted = response.status === 201;
  if (accepted) bidsAccepted.add(1);
  else if (response.status === 409) bidConflicts[conflictReason(response)].add(1);
  else bidsUnavailable.add(1, { status: String(response.status) });
  check(response, {
    'POST /rounds/:id/bids 201 o 409': (r) => r.status === 201 || r.status === 409,
    'POST /rounds/:id/bids aceptada trae secuencia': (r) => r.status !== 201 || Number.isFinite(Number(json(r)?.sequence)),
  });
  return { status: response.status, accepted, duration: response.timings.duration, sentAt, answeredAt };
}

/** Puja automatica (HU-22) con tope `maximumAmount`. */
export function enableAutoBid(token, roundId, maximumAmount) {
  const response = http.put(`${SERVICE_URL.auction}/rounds/${roundId}/auto-bid`, JSON.stringify({ enabled: true, maximumAmount }), {
    headers: headers(token, true), tags: { name: 'PUT /rounds/:id/auto-bid' }, responseCallback: http.expectedStatuses(200, 409),
  });
  check(response, { 'PUT /rounds/:id/auto-bid 200 o 409': (r) => r.status === 200 || r.status === 409 });
  return response.status === 200;
}

// --- catalog ---------------------------------------------------------------------------------
export const listItemsByIds = (token, ids) =>
  get(`${SERVICE_URL.catalog}/items?ids=${ids.join(',')}&limit=${ids.length}`, token, 'GET /items?ids=', Array.isArray);

export const listLotsByIds = (token, ids) =>
  get(`${SERVICE_URL.catalog}/lots?ids=${ids.join(',')}`, token, 'GET /lots?ids=', Array.isArray);

// --- wallet y engagement ---------------------------------------------------------------------
export const getWallet = (token) => get(`${SERVICE_URL.wallet}/me`, token, 'GET /wallet/me', (body) => body.availableBalance !== undefined);

export const getNotifications = (token) =>
  get(`${SERVICE_URL.engagement}/notifications`, token, 'GET /notifications', (body) => Array.isArray(body.items));
