// Mezcla de usuarios. Un escenario define una sola curva de "estudiantes en sala" y esta se
// reparte entre espectadores y pujadores; los visitantes del catalogo siguen su propia curva.
//
// Se usa `ramping-vus` (modelo cerrado): cada VU es una persona con su socket abierto, que es
// lo que limita a engagement y lo que el negocio cuenta (gente en la sala). Para medir la
// capacidad de un endpoint sin que la lentitud frene la carga se usa `ramping-arrival-rate`
// (ver scenarios/stress-reads.js).
import { num } from './config.js';

/** Fraccion de estudiantes en sala que pujan; el resto mira (supuesto, ver docs/ESTRATEGIA.md). */
export const BIDDER_RATIO = num('BIDDER_RATIO', 0.3);

const scale = (stages, factor) => stages.map((stage) => ({ duration: stage.duration, target: Math.round(stage.target * factor) }));

const maxTarget = (stages) => Math.max(0, ...stages.map((stage) => stage.target));

/**
 * `roomStages`: estudiantes en sala (espectadores + pujadores) por etapa.
 * `browserStages`: visitantes del catalogo por etapa (opcional).
 */
export function userMix(roomStages, browserStages = []) {
  const bidders = scale(roomStages, BIDDER_RATIO);
  const viewers = roomStages.map((stage, i) => ({ duration: stage.duration, target: stage.target - bidders[i].target }));
  const base = { executor: 'ramping-vus', startVUs: 0, gracefulRampDown: '30s' };
  const scenarios = {
    viewers: { ...base, exec: 'viewer', stages: viewers },
    bidders: { ...base, exec: 'bidder', stages: bidders },
  };
  if (maxTarget(browserStages) > 0) scenarios.browsers = { ...base, exec: 'browser', stages: browserStages };
  return { scenarios, maxVus: maxTarget(viewers) + maxTarget(bidders) + maxTarget(browserStages) };
}
