/** Compare the authoritative round against the history appropriate to its mode. */
export function roundHistoryProblem(round, bids, sealedBids = []) {
  if (round.reason === 'BUY_NOW') {
    return round.price !== round.buyNow || round.leader !== round.winner ? 'Compra inmediata incoherente' : null;
  }
  if (round.mode === 'DUTCH') {
    return round.winner && (round.reason !== 'DUTCH_CLAIM' || round.leader !== round.winner || round.price <= 0)
      ? 'Adjudicación holandesa incoherente' : null;
  }
  if (round.mode === 'SEALED') {
    if (round.status !== 'CLOSED') return null;
    const top = sealedBids[0]; // SQL orders by amount descending, then creation and ID.
    return top && (round.winner !== top.bidder || round.price !== top.amount)
      ? 'Ganador/precio no corresponde al primer sobre del ranking' : null;
  }
  const last = bids.at(-1);
  return last && (round.price !== last.amount || round.leader !== last.bidder)
    ? 'Precio/líder no corresponde a la última puja aceptada' : null;
}
