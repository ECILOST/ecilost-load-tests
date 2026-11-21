// Configuracion comun de los escenarios. Todo se puede cambiar con `-e NOMBRE=valor` sin tocar
// los scripts; los valores por defecto son los del compose de carga (compose/docker-compose.yml).

/** Mismos puertos y rutas que scripts/lib/config.mjs. */
export const SERVICE_URL = {
  catalog: __ENV.CATALOG_URL || 'http://localhost:3001',
  wallet: __ENV.WALLET_URL || 'http://localhost:3002/wallet',
  auction: __ENV.AUCTION_URL || 'http://localhost:3003',
  engagement: __ENV.ENGAGEMENT_URL || 'http://localhost:3005',
};

/** Socket.IO v4 sobre WebSocket directo, como el frontend (`transports: ['websocket']`). */
export const REALTIME_URL = `${SERVICE_URL.engagement.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;

export function num(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name}=${raw} no es un numero.`);
  return value;
}

export function str(name, fallback) {
  return __ENV[name] === undefined || __ENV[name] === '' ? fallback : __ENV[name];
}

/** Estadisticas del resumen de fin de corrida: las mismas para todos los escenarios. */
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];
