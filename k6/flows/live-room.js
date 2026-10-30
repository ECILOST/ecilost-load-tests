// Un estudiante admitido en la pantalla de sala en vivo (/salas/:id), con las mismas lecturas
// que hace ecilost-frontend mientras la sala esta abierta:
//
// - al entrar: GET /wallet/me, GET /notifications y la lectura en vivo (GET /rooms/:id +
//   GET /rooms/:id/state), y abre el socket /realtime con room.join;
// - useRoom: GET /rooms/:id cada 5 s;
// - por cada evento de la sala (coalescido: una lectura en curso y, si llegaron mas eventos,
//   una mas al terminar): lectura en vivo + GET /notifications, y GET /wallet/me (otra vez a
//   los 3 s) si cambio su liderazgo o su puja mas alta. Las peticiones son asincronas: el socket
//   se sigue atendiendo mientras esperan, como en el navegador;
// - respaldo de la lectura en vivo cada 15 s y GET /notifications cada 10 s.
// (use-room.ts, use-live-room.ts, use-notifications.ts y http-auction.gateway.ts.)
//
// El pujador hace lo mismo y ademas puja cada THINK_MIN..THINK_MAX segundos si no va ganando,
// el precio vigente + 100..500, como alguien que mira y reacciona. Tras pujar relee la sala,
// las notificaciones y el saldo, como la mutacion del frontend.
import { sleep } from 'k6';
import { setInterval, setTimeout, clearInterval, clearTimeout } from 'k6/timers';
import { getNotifications, getRoom, getRoomState, getWallet, enableAutoBid, placeBid } from '../lib/api.js';
import { num } from '../lib/config.js';
import { currentStudent } from '../lib/data.js';
import {
  bidToPrice, eventDelivery, priceEventsMissed, pricePropagation, roundCloseLag, wsJoin, wsJoinOk,
} from '../lib/metrics.js';
import { RealtimeClient } from '../lib/socketio.js';

const SESSION_MIN = num('SESSION_MIN', 180);
const SESSION_MAX = num('SESSION_MAX', 420);
const THINK_MIN = num('THINK_MIN', 3);
const THINK_MAX = num('THINK_MAX', 10);
/** Fraccion de pujadores que activan la puja automatica al entrar (HU-22). */
const AUTOBID_RATIO = num('AUTOBID_RATIO', 0.1);
/** Un precio aceptado que no llega por el socket en este tiempo cuenta como perdido. */
const PRICE_EVENT_TIMEOUT_MS = 10_000;

const between = (min, max) => min + Math.random() * (max - min);

/** Lo que mueve el saldo de quien mira (walletSignature en use-live-room.ts). */
const walletSignature = (room) => (room?.rounds ?? []).map((r) => `${r.id}:${r.status}:${r.isLeading}:${r.myHighestBid}`).join('|');

/**
 * `data.clockOffset` viene de setup() (ver lib/clock.js). `role`: 'viewer' o 'bidder'.
 * La sesion dura SESSION_MIN..SESSION_MAX segundos o hasta que la sala cierra; al terminar
 * la iteracion k6 abre otra (alguien que vuelve a entrar).
 */
export async function liveRoomSession(data, role) {
  const me = currentStudent();
  const { roomId } = me;
  const timers = [];
  /** Pujas propias aceptadas que aun no llegan por el socket, por monto. */
  const pending = new Map();
  /** Precios propios que llegaron por el socket antes que la respuesta HTTP de la puja. */
  const early = new Map();
  /** Ultimo `endsAt` conocido de cada ronda: una relectura puede ver ya la ronda siguiente. */
  const endsAtByRound = new Map();
  let round = null;
  let signature = null;
  let lastLiveRead = 0;
  let ended = false;
  let bidTimer = null;
  let autoBidRoundId = null;
  let client = null;
  let reading = null;
  let readAgain = false;
  const wantsAutoBid = role === 'bidder' && Math.random() < AUTOBID_RATIO;

  function refreshWallet() {
    getWallet(me.token);
    timers.push(setTimeout(() => !ended && getWallet(me.token), 3000));
  }

  /** La lectura en vivo (`live()` en http-auction.gateway.ts): detalle y luego estado. */
  async function liveRead() {
    const room = await getRoom(me.token, roomId);
    const state = await getRoomState(me.token, roomId);
    lastLiveRead = Date.now();
    if (state) {
      round = state.currentRound;
      if (round) endsAtByRound.set(round.id, round.endsAt);
    }
    const next = walletSignature(room);
    if (signature !== null && next !== signature) refreshWallet();
    signature = next;
    if (room?.status === 'CLOSED') end();
    return room;
  }

  /**
   * `coalesce()` del frontend: una lectura en curso a la vez; si llegan eventos mientras tanto,
   * una mas al terminar. Cada lectura disparada por un evento relee tambien las notificaciones.
   */
  function refresh() {
    if (reading) {
      readAgain = true;
      return reading;
    }
    reading = (async () => {
      do {
        readAgain = false;
        await Promise.all([liveRead(), getNotifications(me.token)]);
      } while (readAgain && !ended);
    })().finally(() => {
      reading = null;
    });
    return reading;
  }

  function end() {
    if (ended) return;
    ended = true;
    for (const timer of timers) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    if (bidTimer) clearTimeout(bidTimer);
    client?.close();
  }

  function recordOwnPrice(bid, seenAt) {
    pricePropagation.add(Math.max(0, seenAt - bid.answeredAt));
    bidToPrice.add(seenAt - bid.sentAt);
  }

  function onEvent(name, payload) {
    const now = Date.now();
    if (payload?.serverTime) eventDelivery.add(now + data.clockOffset - Date.parse(payload.serverTime), { event: name });
    if (name === 'round.price') {
      endsAtByRound.set(payload.roundId, payload.endsAt);
      if (round && payload.roundId === round.id) {
        round = { ...round, currentPrice: payload.currentPrice, currentBidderId: payload.currentBidderId, endsAt: payload.endsAt };
      }
      if (payload.currentBidderId === me.id) {
        const amount = Number(payload.currentPrice);
        const bid = pending.get(amount);
        if (bid) {
          recordOwnPrice(bid, now);
          pending.delete(amount);
        } else {
          early.set(amount, now);
        }
      }
    }
    // El cierre por tiempo deberia ocurrir en `endsAt`; uno anterior es una compra inmediata.
    const endsAt = endsAtByRound.get(payload?.roundId);
    if (name === 'round.closed' && endsAt && payload.closedAt) {
      const lag = Date.parse(payload.closedAt) - Date.parse(endsAt);
      if (lag >= 0) roundCloseLag.add(lag);
    }
    if (name === 'room.status' && payload.status === 'CLOSED') end();
    refresh();
  }

  async function tryBid() {
    bidTimer = null;
    if (ended) return;
    const leading = round?.currentBidderId === me.id;
    if (round && round.status === 'ACTIVE' && !leading && autoBidRoundId !== round.id) {
      const amount = Math.floor(Number(round.currentPrice) + 100 + Math.random() * 400);
      const result = await placeBid(me.token, round.id, amount);
      if (result.accepted) {
        const seenAt = early.get(amount);
        if (seenAt !== undefined) {
          recordOwnPrice(result, seenAt);
          early.delete(amount);
        } else {
          pending.set(amount, result);
        }
      }
      // Como la mutacion del frontend: relee la sala, las notificaciones y el saldo.
      await Promise.all([refresh(), getWallet(me.token)]);
    }
    if (!ended) bidTimer = setTimeout(tryBid, between(THINK_MIN, THINK_MAX) * 1000);
  }

  // --- Entrar a la sala -------------------------------------------------------------------
  const [, , room] = await Promise.all([getWallet(me.token), getNotifications(me.token), liveRead()]);
  if (!room || ended) {
    // La sala ya termino (o no responde): sin pausa, cada VU volveria a entrar sin parar.
    sleep(5);
    return;
  }

  if (wantsAutoBid && round?.status === 'ACTIVE') {
    const maximum = Math.floor(Number(round.currentPrice) + between(5_000, 20_000));
    if (await enableAutoBid(me.token, round.id, maximum)) autoBidRoundId = round.id;
  }

  client = new RealtimeClient(me.token, {
    onEvent,
    onConnected: async () => {
      const startedAt = Date.now();
      const ack = await client.emit('room.join', { roomId, token: me.token });
      wsJoin.add(Date.now() - startedAt);
      wsJoinOk.add(ack?.ok === true);
    },
  });

  timers.push(setInterval(() => !ended && getRoom(me.token, roomId), 5_000));
  timers.push(setInterval(() => !ended && Date.now() - lastLiveRead >= 15_000 && refresh(), 1_000));
  timers.push(setInterval(() => !ended && getNotifications(me.token), 10_000));
  timers.push(setInterval(() => {
    const now = Date.now();
    for (const [amount, bid] of pending) {
      if (now - bid.answeredAt > PRICE_EVENT_TIMEOUT_MS) {
        priceEventsMissed.add(1);
        pending.delete(amount);
      }
    }
    for (const [amount, seenAt] of early) if (now - seenAt > PRICE_EVENT_TIMEOUT_MS) early.delete(amount);
  }, 1_000));
  timers.push(setTimeout(end, between(SESSION_MIN, SESSION_MAX) * 1000));
  if (role === 'bidder') bidTimer = setTimeout(tryBid, between(THINK_MIN, THINK_MAX) * 1000);
}
