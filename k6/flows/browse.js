// Un estudiante que recorre el catalogo de subastas sin estar en una sala:
//
// - al abrir la app: GET /wallet/me y GET /notifications;
// - /subastas (useAuctionItems): GET /rooms y, si hay salas abiertas, el detalle en lote
//   GET /rooms?include=rounds&status=SCHEDULED,ACTIVE, mas la ficha de catalog de las entradas
//   en una peticion por tipo (GET /items?ids=, GET /lots?ids=) que el frontend guarda 5 min;
// - abre una ficha (/subastas/:roomId.:roundId, useAuctionItem): GET /rooms/:id cada 5 s
//   durante DETAIL_MIN..DETAIL_MAX segundos, con GET /notifications cada 10 s;
// - vuelve al listado tras una pausa. El listado tambien se refresca cada 15 s.
import { sleep } from 'k6';
import { getNotifications, getRoom, getWallet, listItemsByIds, listLotsByIds, listOpenRoomsWithRounds, listRooms } from '../lib/api.js';
import { num } from '../lib/config.js';
import { currentStudent } from '../lib/data.js';

const DETAIL_MIN = num('DETAIL_MIN', 15);
const DETAIL_MAX = num('DETAIL_MAX', 40);
const ENTRY_CACHE_MS = 5 * 60_000;

/** Cache de fichas por VU, como `createEntryResolver` del frontend. */
let entriesFetchedAt = 0;

const between = (min, max) => min + Math.random() * (max - min);

async function catalogList(token) {
  const rooms = (await listRooms(token)) ?? [];
  if (!rooms.some((room) => room.status === 'ACTIVE' || room.status === 'SCHEDULED')) return [];
  const open = (await listOpenRoomsWithRounds(token)) ?? [];
  if (Date.now() - entriesFetchedAt > ENTRY_CACHE_MS) {
    const entries = open.flatMap((room) => room.rounds ?? []).flatMap((round) => round.entries ?? []);
    const items = [...new Set(entries.filter((e) => e.kind === 'ITEM').map((e) => e.catalogId))];
    const lots = [...new Set(entries.filter((e) => e.kind === 'LOT').map((e) => e.catalogId))];
    // catalog limita `limit` a 200: el frontend pide una pagina por lote de ids.
    const pages = [];
    for (let i = 0; i < items.length; i += 200) pages.push(listItemsByIds(token, items.slice(i, i + 200)));
    for (let i = 0; i < lots.length; i += 200) pages.push(listLotsByIds(token, lots.slice(i, i + 200)));
    await Promise.all(pages);
    entriesFetchedAt = Date.now();
  }
  return open;
}

export async function browseCatalog() {
  const me = currentStudent();
  if (entriesFetchedAt === 0) {
    await Promise.all([getWallet(me.token), getNotifications(me.token)]);
  }

  const open = await catalogList(me.token);
  sleep(between(2, 6));
  if (open.length === 0) {
    sleep(15);
    return;
  }

  const room = open[Math.floor(Math.random() * open.length)];
  const until = Date.now() + between(DETAIL_MIN, DETAIL_MAX) * 1000;
  let lastNotifications = Date.now();
  while (Date.now() < until) {
    await getRoom(me.token, room.id);
    if (Date.now() - lastNotifications >= 10_000) {
      await getNotifications(me.token);
      lastNotifications = Date.now();
    }
    sleep(5);
  }
  sleep(between(3, 10));
}
