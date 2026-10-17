/** Error de una llamada HTTP, con el estado y el cuerpo que devolvio el servicio. */
export class HttpError extends Error {
  constructor(method, url, status, body) {
    super(`${method} ${url} -> ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 400));
    this.status = status;
    this.body = body;
  }
}

/** JSON sobre fetch con el token del usuario. Lanza HttpError si la respuesta no es 2xx. */
export async function request(method, url, { token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Se deja como texto.
  }
  if (!response.ok) throw new HttpError(method, url, response.status, parsed);
  return parsed;
}

/** Ejecuta `work` sobre cada elemento con a lo sumo `limit` en curso a la vez. */
export async function inBatches(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
