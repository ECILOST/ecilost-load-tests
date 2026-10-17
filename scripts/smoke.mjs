// Prueba de humo de la cadena completa, sin carga: cada estudiante de la corrida puja una vez
// en orden sobre la primera ronda. Sirve para validar tokens, preparacion y verificacion
// antes de correr k6. Requiere una corrida preparada con --wait-active.
//
//   node scripts/smoke.mjs
import { request } from './lib/http.mjs';
import { readData, SERVICE_URL } from './lib/config.mjs';

const run = readData('run.json');
const tokens = readData('tokens.json');
const byId = new Map(tokens.students.map((student) => [student.id, student.token]));
const [round] = run.rounds;

let price = round.startingPrice;
for (const [index, studentId] of run.students.entries()) {
  // La primera puja alcanza el minimo; las siguientes lo superan en 100.
  const amount = index === 0 ? price : price + 100;
  const started = performance.now();
  const bid = await request('POST', `${SERVICE_URL.auction}/rounds/${round.id}/bids`, { token: byId.get(studentId), body: { amount } });
  console.log(`  puja ${index + 1}: ${amount} ECICoin por ${studentId.slice(0, 8)} -> secuencia ${bid.sequence} en ${(performance.now() - started).toFixed(0)} ms`);
  price = amount;
}
console.log(`Humo OK: ${run.students.length} pujas aceptadas en la ronda ${round.id.slice(0, 8)}.`);
