// Desfase entre el reloj de k6 (Windows) y el de los contenedores (la VM de Docker). Los
// `serverTime` de auction y engagement salen del reloj de la VM; sin corregirlo, una
// latencia de entrega cruzada entre ambos relojes mediria tambien el desfase.
import http from 'k6/http';
import { SERVICE_URL } from './config.js';

/**
 * Estima `servidor - local` en ms con varias lecturas de `serverTime` de `GET /rooms/:id`,
 * tomando el punto medio de cada ida y vuelta y la de menor ida y vuelta (la mas precisa).
 * Se llama en `setup()`, con poca carga.
 */
export function measureClockOffset(token, roomId) {
  let best = null;
  for (let i = 0; i < 5; i += 1) {
    const before = Date.now();
    const response = http.get(`${SERVICE_URL.auction}/rooms/${roomId}`, {
      headers: { authorization: `Bearer ${token}` }, tags: { name: 'setup: reloj' },
    });
    const after = Date.now();
    const serverTime = response.status === 200 ? Date.parse(response.json('serverTime')) : NaN;
    if (!Number.isFinite(serverTime)) continue;
    const roundTrip = after - before;
    if (!best || roundTrip < best.roundTrip) best = { roundTrip, offset: serverTime - (before + after) / 2 };
  }
  if (!best) throw new Error('No se pudo leer la hora del servidor (GET /rooms/:id).');
  return Math.round(best.offset);
}
