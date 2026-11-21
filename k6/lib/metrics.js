// Metricas propias de ECILOST. Las de k6 (http_req_duration, http_reqs, checks, vus...) miden
// peticiones sueltas; estas miden lo que vive el usuario: si ve el precio a tiempo, si su puja
// entro y por que no.
import { Counter, Rate, Trend } from 'k6/metrics';

// --- Pujas -----------------------------------------------------------------------------
export const bidsAccepted = new Counter('bids_accepted');
/** 5xx o sin respuesta: el servicio no pudo atender la puja. */
export const bidsUnavailable = new Counter('bids_unavailable');
/**
 * Los 409 por motivo. Perder la carrera es parte del juego; "fondos insuficientes" no deberia
 * aparecer porque setup.mjs recarga de sobra: si aparece, wallet rechazo la reserva por otra
 * causa y auction lo reporto como falta de saldo.
 */
export const bidConflicts = {
  outbid: new Counter('bids_409_outbid'),
  belowMinimum: new Counter('bids_409_below_minimum'),
  insufficientFunds: new Counter('bids_409_insufficient_funds'),
  roundClosed: new Counter('bids_409_round_closed'),
  other: new Counter('bids_409_other'),
};

// --- Tiempo real (requisito: < 1 s) --------------------------------------------------------
/**
 * Desde que la puja propia fue aceptada (respuesta HTTP) hasta que el socket trae ese precio:
 * outbox de auction, RabbitMQ, engagement y Socket.IO. Es lo que tarda el resto de la sala en
 * ver el precio nuevo, porque el aviso sale a todos a la vez.
 */
export const pricePropagation = new Trend('realtime_price_propagation', true);
/** Desde que el estudiante envia la puja hasta que ve su precio en vivo (incluye la puja HTTP). */
export const bidToPrice = new Trend('realtime_bid_to_price', true);
/** Retraso del cierre de ronda respecto a su `endsAt` (reloj del servidor en ambos extremos). */
export const roundCloseLag = new Trend('realtime_round_close_lag', true);
/** Desde que engagement emite (`serverTime`) hasta que llega al cliente, corregido por el desfase de reloj. */
export const eventDelivery = new Trend('realtime_event_delivery', true);
/** Precio aceptado que no llego por el socket antes de que el estudiante volviera a pujar. */
export const priceEventsMissed = new Counter('realtime_price_events_missed');

// --- Socket ------------------------------------------------------------------------------
/** Hasta que engagement acepta la conexion al namespace (incluye la verificacion del token). */
export const wsConnect = new Trend('ws_connect_duration', true);
/** `room.join` hasta su ack: engagement consulta la sala en auction en cada join. */
export const wsJoin = new Trend('ws_join_duration', true);
export const wsJoinOk = new Rate('ws_join_ok');
export const wsEvents = new Counter('ws_events_received');
export const wsErrors = new Counter('ws_errors');
