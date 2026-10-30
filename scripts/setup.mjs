// Prepara una corrida: billeteras, objetos en catalog y una sala programada en auction.
// Todo por las APIs de los servicios (nada se escribe directo en las bases) y sobre las bases
// de carga. Deja el resultado en .data/run.json para k6 y para verify.mjs.
//
//   node scripts/setup.mjs --scenario bid-storm --students 50 [--capacity 50] [--rounds 1]
//     [--starting-price 100] [--buy-now 5000] [--recharge 1000000] [--starts-in 20]
//     [--admit false] [--wait-active]
import { randomUUID } from 'node:crypto';
import { inBatches, request, sleep } from './lib/http.mjs';
import { parseArgs, readData, SERVICE_URL, writeData } from './lib/config.mjs';

const args = parseArgs();
const scenario = String(args.scenario ?? 'smoke');
const studentCount = Number(args.students ?? 5);
const capacity = Number(args.capacity ?? studentCount);
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

// 2. Un objeto de catalog por ronda.
step(`${roundCount} objeto(s) en catalog`);
const items = [];
for (let position = 1; position <= roundCount; position += 1) {
  items.push(
    await request('POST', `${SERVICE_URL.catalog}/items`, {
      token: staff.token,
      body: {
        name: `[CARGA ${runId}] ${scenario} ${position}`,
        description: `Objeto sintetico de la prueba de carga ${scenario} (corrida ${runId}).`,
        condition: 'GOOD',
        category: 'Carga',
      },
    }),
  );
}

// 3. La sala, que se abre sola en `startsInSeconds`.
const startsAt = new Date(Date.now() + startsInSeconds * 1000).toISOString();
step(`Sala con ${roundCount} ronda(s), aforo ${capacity}, inicia ${startsAt}`);
const room = await request('POST', `${SERVICE_URL.auction}/rooms`, {
  token: staff.token,
  body: {
    name: `[CARGA ${runId}] ${scenario}`.slice(0, 80),
    maximumCapacity: capacity,
    startsAt,
    rounds: items.map((item) => ({
      entries: [{ kind: 'ITEM', catalogId: item.id }],
      startingPrice,
      ...(buyNowPrice !== undefined ? { buyNowPrice } : {}),
    })),
  },
});

// 4. Admision previa al inicio (HU-16/17): despues del inicio nadie entra.
let admitted = 0;
if (admit) {
  step(`Admision de ${students.length} estudiantes`);
  await inBatches(students, 20, async (student) => {
    await request('POST', `${SERVICE_URL.auction}/rooms/${room.id}/participants`, { token: student.token });
    admitted += 1;
  });
}

const run = {
  runId,
  scenario,
  roomId: room.id,
  startsAt,
  capacity,
  admitted,
  rounds: room.rounds.map((round) => ({
    id: round.id, position: round.position, startingPrice: Number(round.startingPrice), buyNowPrice: round.buyNowPrice == null ? null : Number(round.buyNowPrice),
  })),
  students: students.map((student) => student.id),
  createdAt: new Date().toISOString(),
};
writeData('run.json', run);
step(`Listo: sala ${room.id}, ${admitted} admitidos. Datos en .data/run.json`);

// 5. Opcional: esperar a que el reloj del servidor abra la sala.
if (args['wait-active']) {
  step('Esperando a que la sala se abra...');
  for (;;) {
    const detail = await request('GET', `${SERVICE_URL.auction}/rooms/${room.id}`, { token: staff.token });
    if (detail.status === 'ACTIVE') break;
    await sleep(500);
  }
  step('Sala ACTIVE');
}
