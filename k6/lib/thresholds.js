// Umbrales de aprobacion. Se separan en dos grupos a proposito:
//
// - REQUIREMENT: lo unico que el backlog fija con numero, "tiempo real < 1 segundo" en precio,
//   contador y transicion de ronda (ECILOST-Backlog.md, RNF). Romperlo es un fallo real.
// - REFERENCE: valores iniciales propuestos para poder comparar corridas; NO son requisitos
//   (supuesto A4: no hay SLA). Se justifican en docs/ESTRATEGIA.md y se pueden ajustar.

export const REQUIREMENT = {
  realtime_price_propagation: ['p(95)<1000'],
  realtime_round_close_lag: ['p(95)<1000'],
};

export const REFERENCE = {
  // Errores: 5xx, sin respuesta o un estado que la llamada no admite (los 409 de puja se admiten).
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  ws_join_ok: ['rate>0.99'],
  // Lecturas que la pantalla de sala repite en cada evento: deben sentirse instantaneas.
  'http_req_duration{name:GET /rooms/:id}': ['p(95)<300'],
  'http_req_duration{name:GET /rooms/:id/state}': ['p(95)<300'],
  'http_req_duration{name:GET /notifications}': ['p(95)<300'],
  'http_req_duration{name:GET /wallet/me}': ['p(95)<300'],
  // Una puja pasa por el lock de la ronda y la reserva en wallet: se le da hasta 1 s.
  'http_req_duration{name:POST /rounds/:id/bids}': ['p(95)<1000'],
};

/** Para estres: sin aprobacion, pero se corta si el sistema ya no atiende (evita minutos inutiles). */
export const ABORT_WHEN_DOWN = {
  http_req_failed: [{ threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '1m' }],
};
