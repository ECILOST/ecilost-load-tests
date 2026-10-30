// Prepara una corrida: billeteras, objetos en catalog y una o varias salas programadas en auction.
// Todo por las APIs de los servicios (nada se escribe directo en las bases) y sobre las bases
// de carga. Deja el resultado en .data/run.json para k6 y para verify.mjs.
//
//   node scripts/setup.mjs --scenario bid-storm --students 50 [--rooms 1] [--capacity 50] [--rounds 1]
//     [--starting-price 100] [--buy-now 5000] [--recharge 1000000] [--starts-in 20]
//     [--admit false] [--wait-active]
import { randomUUID } from 'node:crypto';
import { inBatches, request, sleep } from './lib/http.mjs';
import { parseArgs, readData, SERVICE_URL, writeData } from './lib/config.mjs';

const args = parseArgs();
const scenario = String(args.scenario ?? 'smoke');
const studentCount = Number(args.students ?? 5);
const roomCount = Number(args.rooms ?? 1);
// Los estudiantes se reparten entre las salas; el aforo por defecto es la parte de cada una.
const capacity = Number(args.capacity ?? Math.ceil(studentCount / roomCount));
const roundCount = Number(args.rounds ?? 1);
const startingPrice = Number(args['starting-price'] ?? 100);
const buyNowPrice = args['buy-now'] === undefined ? undefined : Number(args['buy-now']);
const recharge = Number(args.recharge ?? 0);
const startsInSeconds = Number(args['starts-in'] ?? 20);
const admit = args.admit !== 'false';
const runId = randomUUID().slice(0, 8);

const tokens = readData('tokens.json');
if (Date.parse(tokens.expiresAt) < Date.now() + 10 * 60_000) throw new Error('Los tokens vencen pronto: corre de nuevo scripts/tokens.mjs.');
if (tokens.students.length < studentCount) throw new Error(`Hay ${tokens.students.length} tokens de estudiante: corre scripts/tokens.mjs --students ${studentCount}.`);
const students = tokens.students.slice(0, studentCount);
const staff = tokens.staff;
const step = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);

// 1. Billeteras: la emision inicial es idempotente; la recarga lleva una referencia unica por
//    corrida y estudiante, asi que reintentar no duplica saldo.
step(`Billeteras de ${students.length} estudiantes`);
await inBatches(students, 20, (student) => request('POST', `${SERVICE_URL.wallet}/me/bootstrap`, { token: student.token }));
if (recharge > 0) {
  // En serie: wallet corre cada operacion en una transaccion SERIALIZABLE con 3 reintentos y,
  // con recargas concurrentes a billeteras distintas, responde 500 por conflicto de
  // serializacion (hallazgo de la carga, ver docs). La preparacion no es lo que se mide.
  step(`Recarga de ${recharge} ECICoin a cada uno (en serie)`);
  await inBatches(students, 1, (student) =>
    request('POST', `${SERVICE_URL.wallet}/${student.id}/recharges`, {
      token: staff.token,
      body: { amount: recharge, reference: `load:${runId}:${student.id}` },
    }),
  );
}

// 2-4. Por sala: un objeto de catalog por ronda, la sala (se abre sola en `startsInSeconds`)
//      y la admision previa al inicio (HU-16/17: despues del inicio nadie entra).
const startsAt = new Date(Date.now() + startsInSeconds * 1000).toISOString();
const rooms = [];
for (let index = 0; index < roomCount; index += 1) {
  const label = roomCount > 1 ? `${scenario} sala ${index + 1}` : scenario;
  const members = students.filter((_, position) => position % roomCount === index);

  step(`${label}: ${roundCount} objeto(s) en catalog`);
  const items = [];
  for (let position = 1; position <= roundCount; position += 1) {
    items.push(
      await request('POST', `${SERVICE_URL.catalog}/items`, {
        token: staff.token,
        body: {
          name: `[CARGA ${runId}] ${label} ${position}`,
          description: `Objeto sintetico de la prueba de carga ${scenario} (corrida ${runId}).`,
          condition: 'GOOD',
          category: 'Carga',
        },
      }),
    );
  }

  step(`${label}: sala con ${roundCount} ronda(s), aforo ${capacity}, inicia ${startsAt}`);
  const room = await request('POST', `${SERVICE_URL.auction}/rooms`, {
    token: staff.token,
    body: {
      name: `[CARGA ${runId}] ${label}`.slice(0, 80),
      maximumCapacity: capacity,
      startsAt,
      rounds: items.map((item) => ({
        entries: [{ kind: 'ITEM', catalogId: item.id }],
        startingPrice,
        ...(buyNowPrice !== undefined ? { buyNowPrice } : {}),
      })),
    },
  });

  let admitted = 0;
  if (admit) {
    step(`${label}: admision de ${members.length} estudiantes`);
    await inBatches(members, 20, async (student) => {
      await request('POST', `${SERVICE_URL.auction}/rooms/${room.id}/participants`, { token: student.token });
      admitted += 1;
    });
  }

  rooms.push({
    roomId: room.id,
    capacity,
    admitted,
    rounds: room.rounds.map((round) => ({
      id: round.id, position: round.position, startingPrice: Number(round.startingPrice), buyNowPrice: round.buyNowPrice == null ? null : Number(round.buyNowPrice),
    })),
    students: members.map((student) => student.id),
  });
}

// `roomId`, `rounds`, `capacity` y `admitted` repiten la primera sala: smoke.mjs y las corridas
// guardadas antes de que hubiera varias salas los leen asi.
const run = {
  runId,
  scenario,
  ...rooms[0],
  startsAt,
  rooms,
  students: students.map((student) => student.id),
  createdAt: new Date().toISOString(),
};
writeData('run.json', run);
step(`Listo: ${rooms.length} sala(s), ${rooms.reduce((sum, room) => sum + room.admitted, 0)} admitidos. Datos en .data/run.json`);

// 5. Opcional: esperar a que el reloj del servidor abra la sala.
if (args['wait-active']) {
  step('Esperando a que las salas se abran...');
  for (const room of rooms) {
    for (;;) {
      const detail = await request('GET', `${SERVICE_URL.auction}/rooms/${room.roomId}`, { token: staff.token });
      if (detail.status === 'ACTIVE') break;
      await sleep(500);
    }
  }
  step('Salas ACTIVE');
}
