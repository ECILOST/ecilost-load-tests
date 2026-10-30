// Verifica, con consultas de solo lectura sobre las bases de carga, las garantias que la carga
// no debe romper. Se limita a la sala y los estudiantes de .data/run.json.
//
//   node scripts/verify.mjs [--requesters 200] [--run results/bid-storm-50.run.json]
//   (--requesters: cuantos pidieron admision; --run: otra corrida guardada en vez de .data/run.json)
//
// Cada comprobacion termina en OK, AVISO (esperable pero conviene mirarlo) o FALLA. Si hay
// alguna FALLA el proceso sale con codigo 1.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { loadDatabaseUrl, loadSchema, parseArgs, readData } from './lib/config.mjs';

const args = parseArgs();
const run = args.run ? JSON.parse(readFileSync(String(args.run), 'utf8')) : readData('run.json');
const results = [];
const check = (level, name, detail) => results.push({ level, name, detail });
const ok = (name, detail = '') => check('OK', name, detail);
const warn = (name, detail) => check('AVISO', name, detail);
const fail = (name, detail) => check('FALLA', name, detail);

/** Conexion a la base de carga. El esquema va calificado en cada consulta, no en la URL. */
async function connect(service) {
  const url = new URL(loadDatabaseUrl(service));
  url.search = '';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

const A = `"${loadSchema('auction')}"`;
const W = `"${loadSchema('wallet')}"`;
const auction = await connect('auction');
const wallet = await connect('wallet');

try {
  // --- Sala y aforo (HU-16) ------------------------------------------------------------
  const { rows: [room] } = await auction.query(
    `SELECT status, "maximumCapacity" AS capacity, "admittedCount" AS admitted,
            (SELECT count(*)::int FROM ${A}.room_participants p WHERE p."roomId" = r.id) AS participants
       FROM ${A}.rooms r WHERE id = $1`,
    [run.roomId],
  );
  if (!room) throw new Error(`La sala ${run.roomId} no esta en la base de carga.`);
  if (room.participants > room.capacity) fail('Aforo nunca superado', `${room.participants} admitidos con aforo ${room.capacity}`);
  else ok('Aforo nunca superado', `${room.participants}/${room.capacity}`);
  if (room.participants !== room.admitted) fail('Contador de admitidos coherente', `admittedCount=${room.admitted}, filas=${room.participants}`);
  else ok('Contador de admitidos coherente', `${room.admitted}`);
  if (args.requesters !== undefined) {
    const expected = Math.min(Number(args.requesters), room.capacity);
    if (room.participants !== expected) fail('Admitidos = min(solicitantes, aforo)', `${room.participants}, se esperaban ${expected}`);
    else ok('Admitidos = min(solicitantes, aforo)', `${room.participants}`);
  }

  // --- Rondas: precio, lider y cierre (HU-20/21/24/25/28) ------------------------------
  const { rows: rounds } = await auction.query(
    `SELECT id, position, status, "currentPrice"::float AS price, "currentBidderId" AS leader,
            "winnerId" AS winner, result, "closeReason" AS reason, "buyNowPrice"::float AS "buyNow"
       FROM ${A}.rounds WHERE "roomId" = $1 ORDER BY position`,
    [run.roomId],
  );
  for (const round of rounds) {
    const tag = `ronda ${round.position}`;
    const { rows: bids } = await auction.query(
      `SELECT "bidderId" AS bidder, amount::float AS amount, sequence::bigint AS sequence
         FROM ${A}.bids WHERE "roundId" = $1 AND status = 'ACCEPTED' ORDER BY sequence`,
      [round.id],
    );
    const { rows: [{ rejected }] } = await auction.query(
      `SELECT count(*)::int AS rejected FROM ${A}.bids WHERE "roundId" = $1 AND status = 'REJECTED'`, [round.id],
    );
    const decreasing = bids.findIndex((bid, i) => i > 0 && bid.amount <= bids[i - 1].amount);
    if (decreasing >= 0) fail(`${tag}: historial estrictamente creciente`, `secuencia ${bids[decreasing].sequence} no supera a la anterior`);
    else ok(`${tag}: historial estrictamente creciente`, `${bids.length} aceptadas, ${rejected} rechazadas`);

    const last = bids.at(-1);
    if (round.reason === 'BUY_NOW') {
      if (round.price !== round.buyNow || round.leader !== round.winner) fail(`${tag}: cierre por compra coherente`, `precio ${round.price}, compra ${round.buyNow}`);
      else ok(`${tag}: cierre por compra coherente`, `comprador ${round.winner?.slice(0, 8)} a ${round.price}`);
    } else if (last) {
      if (round.price !== last.amount || round.leader !== last.bidder) fail(`${tag}: precio y lider = ultima puja aceptada`, `ronda ${round.price}/${round.leader?.slice(0, 8)}, puja ${last.amount}/${last.bidder.slice(0, 8)}`);
      else ok(`${tag}: precio y lider = ultima puja aceptada`, `${round.price}`);
    }

    const { rows: [{ closes }] } = await auction.query(
      `SELECT count(*)::int AS closes FROM ${A}.outbox_events WHERE "eventType" = 'auction.round.closed.v1' AND "aggregateId" = $1`, [round.id],
    );
    if (round.status === 'CLOSED') {
      if (closes !== 1) fail(`${tag}: un solo evento de cierre`, `${closes} eventos`);
      else ok(`${tag}: un solo evento de cierre`, `${round.result}${round.reason ? ` (${round.reason})` : ''}`);
    } else if (closes !== 0) fail(`${tag}: sin cierre mientras sigue abierta`, `${closes} eventos de cierre`);

    // --- Fondos de la ronda en wallet (HU-11/12/13/14) ---------------------------------
    const prefix = `bid:${round.id}:`;
    const { rows: holds } = await wallet.query(
      `SELECT reference, amount::float AS amount FROM ${W}.wallet_holds WHERE reference LIKE $1`, [`${prefix}%`],
    );
    const { rows: debits } = await wallet.query(
      `SELECT amount::float AS amount, metadata->>'reference' AS reference FROM ${W}.wallet_transactions
        WHERE type = 'DEBIT' AND reference = $1`, [`settle:${round.id}`],
    );
    if (debits.length > 1) fail(`${tag}: a lo sumo un cobro`, `${debits.length} cobros`);
    if (round.status === 'ACTIVE') {
      const leaderHold = holds.find((hold) => hold.reference === `${prefix}${round.leader}`);
      if (round.leader && leaderHold?.amount !== round.price) fail(`${tag}: el lider tiene reservado su precio`, `reserva ${leaderHold?.amount ?? 0}, precio ${round.price}`);
      else if (round.leader) ok(`${tag}: el lider tiene reservado su precio`, `${round.price}`);
      const stale = holds.filter((hold) => hold.reference !== `${prefix}${round.leader}`);
      if (stale.length) warn(`${tag}: reservas de superados aun retenidas`, `${stale.length} (se liberan al liquidar la ronda)`);
    } else if (round.status === 'CLOSED') {
      if (holds.length) warn(`${tag}: reservas pendientes de liquidar`, `${holds.length} (wallet aun no proceso el cierre)`);
      else ok(`${tag}: ninguna reserva tras liquidar`);
      if (round.winner) {
        const [debit] = debits;
        if (!debit) warn(`${tag}: cobro al ganador`, 'aun no hay cobro (liquidacion pendiente)');
        else if (debit.amount !== round.price || debit.reference !== `${prefix}${round.winner}`) fail(`${tag}: cobro al ganador`, `cobro ${debit.amount} a ${debit.reference}, precio ${round.price}`);
        else ok(`${tag}: cobro al ganador = precio adjudicado`, `${debit.amount}`);
      } else if (debits.length) fail(`${tag}: ronda desierta sin cobro`, `${debits.length} cobros`);
    }
  }

  // --- Billeteras de los estudiantes de la corrida -------------------------------------
  const { rows: wallets } = await wallet.query(
    `SELECT w.user_id, w.available_balance::float AS available, w.held_balance::float AS held,
            COALESCE((SELECT sum(h.amount)::float FROM ${W}.wallet_holds h WHERE h.wallet_id = w.id), 0) AS holds
       FROM ${W}.wallets w WHERE w.user_id = ANY($1)`,
    [run.students],
  );
  const negative = wallets.filter((w) => w.available < 0 || w.held < 0);
  if (negative.length) fail('Ningun saldo negativo', `${negative.length} billeteras`);
  else ok('Ningun saldo negativo', `${wallets.length} billeteras`);
  const mismatched = wallets.filter((w) => Math.abs(w.held - w.holds) > 0.001);
  if (mismatched.length) fail('Retenido = suma de reservas', `${mismatched.length} billeteras descuadradas`);
  else ok('Retenido = suma de reservas');
} finally {
  await auction.end();
  await wallet.end();
}

const icon = { OK: 'OK   ', AVISO: 'AVISO', FALLA: 'FALLA' };
console.log(`\nVerificacion de la corrida ${run.runId} (${run.scenario}, sala ${run.roomId.slice(0, 8)})\n`);
for (const { level, name, detail } of results) console.log(`  ${icon[level]}  ${name}${detail ? ` — ${detail}` : ''}`);
const failures = results.filter((r) => r.level === 'FALLA').length;
console.log(`\n${failures ? `${failures} FALLA(S)` : 'Sin fallas'}; ${results.filter((r) => r.level === 'AVISO').length} aviso(s).`);
process.exit(failures ? 1 : 0);
