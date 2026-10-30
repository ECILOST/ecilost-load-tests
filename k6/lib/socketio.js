// Cliente Socket.IO v4 minimo sobre `k6/websockets`, para el namespace `/realtime` de
// engagement. k6 no trae cliente Socket.IO: se habla el protocolo a mano (Engine.IO v4 con
// transporte websocket, sin polling), igual que `io(url + '/realtime', { auth: { token },
// transports: ['websocket'] })` en el frontend.
//
// Paquetes que se usan (https://socket.io/docs/v4/socket-io-protocol/):
//   0{...}                   Engine.IO open (servidor)
//   2 / 3                    ping del servidor / pong del cliente
//   40/realtime,{auth}       conectar al namespace;  40/realtime,{sid} aceptado
//   44/realtime,{message}    conexion rechazada (token invalido)
//   42/realtime,<id>[ev,..]  evento (con id si espera ack);  43/realtime,<id>[..] ack
import { WebSocket } from 'k6/websockets';
import { REALTIME_URL } from './config.js';
import { wsConnect, wsErrors, wsEvents } from './metrics.js';

const NAMESPACE = '/realtime';

function parse(data) {
  if (data === '2') return { kind: 'ping' };
  if (data[0] === '0') return { kind: 'open' };
  if (data[0] !== '4') return { kind: 'other' };
  const type = data[1];
  let rest = data.slice(2);
  if (rest.startsWith(`${NAMESPACE},`)) rest = rest.slice(NAMESPACE.length + 1);
  const match = /^(\d*)([\s\S]*)$/.exec(rest);
  const payload = match[2] ? JSON.parse(match[2]) : null;
  const id = match[1] === '' ? null : Number(match[1]);
  if (type === '0') return { kind: 'connected', payload };
  if (type === '4') return { kind: 'rejected', payload };
  if (type === '2') return { kind: 'event', id, name: payload[0], payload: payload[1] };
  if (type === '3') return { kind: 'ack', id, payload: payload[0] };
  return { kind: 'other' };
}

/**
 * `onEvent(name, payload)` recibe cada evento del servidor; `onConnected()` se llama cuando el
 * namespace acepta la conexion. Los errores y cierres inesperados se cuentan en `ws_errors`.
 */
export class RealtimeClient {
  constructor(token, { onEvent, onConnected } = {}) {
    this.token = token;
    this.onEvent = onEvent ?? (() => {});
    this.onConnected = onConnected ?? (() => {});
    this.acks = new Map();
    this.nextAck = 1;
    this.closing = false;
    this.connected = false;

    const startedAt = Date.now();
    this.ws = new WebSocket(REALTIME_URL);
    this.ws.onmessage = (message) => {
      const packet = parse(String(message.data));
      if (packet.kind === 'ping') this.ws.send('3');
      else if (packet.kind === 'open') this.ws.send(`40${NAMESPACE},${JSON.stringify({ token: this.token })}`);
      else if (packet.kind === 'connected') {
        this.connected = true;
        wsConnect.add(Date.now() - startedAt);
        this.onConnected();
      } else if (packet.kind === 'rejected') {
        wsErrors.add(1, { reason: 'rejected' });
        this.close();
      } else if (packet.kind === 'ack') {
        const resolve = this.acks.get(packet.id);
        this.acks.delete(packet.id);
        if (resolve) resolve(packet.payload);
      } else if (packet.kind === 'event') {
        wsEvents.add(1, { event: packet.name });
        this.onEvent(packet.name, packet.payload);
      }
    };
    this.ws.onerror = () => wsErrors.add(1, { reason: 'error' });
    this.ws.onclose = () => {
      this.connected = false;
      if (!this.closing) wsErrors.add(1, { reason: 'closed-by-server' });
      for (const resolve of this.acks.values()) resolve(null);
      this.acks.clear();
    };
  }

  /** Emite y devuelve una promesa con el ack (null si el socket se cierra antes). */
  emit(name, payload) {
    const id = this.nextAck;
    this.nextAck += 1;
    return new Promise((resolve) => {
      this.acks.set(id, resolve);
      this.ws.send(`42${NAMESPACE},${id}${JSON.stringify([name, payload])}`);
    });
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.ws.close();
  }
}
