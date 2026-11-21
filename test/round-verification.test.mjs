import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundHistoryProblem } from '../scripts/lib/round-verification.mjs';

test('classic history catches a mismatched leader', () => {
  assert.ok(roundHistoryProblem({ mode: 'CLASSIC', price: 100, leader: 'wrong' }, [{ amount: 100, bidder: 'winner' }]));
});
test('Dutch closure does not require a manual bid', () => {
  assert.equal(roundHistoryProblem({ mode: 'DUTCH', reason: 'DUTCH_CLAIM', price: 120, winner: 'a', leader: 'a' }, []), null);
});
test('sealed rounds remain private while active and settle using sealed history', () => {
  const round = { mode: 'SEALED', status: 'ACTIVE', price: 100 };
  assert.equal(roundHistoryProblem(round, [], [{ amount: 500, bidder: 'a' }]), null);
  assert.ok(roundHistoryProblem({ ...round, status: 'CLOSED', winner: 'b' }, [], [{ amount: 500, bidder: 'a' }]));
  assert.equal(roundHistoryProblem({ ...round, status: 'CLOSED', price: 500, winner: 'a' }, [], [{ amount: 500, bidder: 'a' }]), null);
});
test('buy now validates the configured price and buyer', () => {
  assert.ok(roundHistoryProblem({ reason: 'BUY_NOW', price: 400, buyNow: 500, leader: 'a', winner: 'a' }, []));
});
