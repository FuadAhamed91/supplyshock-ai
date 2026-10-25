// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/sim/engine.js';
import { searchPlans, rank, runPlan, horizonFor } from '../src/sim/planner.js';
import { route } from '../src/sim/graph.js';

const port = { type: 'port', start: 7, days: 4 };

test('a normal week delivers every order on time', () => {
  const run = simulate({});
  assert.equal(run.metrics.late, 0);
  assert.equal(run.stockouts.length, 0);
  assert.ok(run.shipments.length > 50, 'trucks should be moving');
});

test('stock is conserved: nothing is created or lost in transit', () => {
  const run = simulate({ scenario: port, horizon: horizonFor(port) });
  for (const s of run.shipments) {
    for (const k of Object.keys(s.cargo)) assert.ok(s.cargo[k] >= 0, 'no negative cargo');
  }
  for (const o of run.orders) {
    for (const line of Object.values(o.lines)) assert.ok(line.delivered <= line.qty, 'never over-delivered');
  }
});

test('port congestion makes hubs run dry and orders late', () => {
  const run = simulate({ scenario: port, horizon: horizonFor(port) });
  assert.ok(run.metrics.late > 0);
  assert.ok(run.metrics.critLate > 0);
  assert.ok(run.vessels.some((v) => v.held), 'the incoming ship is held at anchor');
});

test('simulations are reproducible for the same seed', () => {
  const a = simulate({ scenario: port, horizon: horizonFor(port), seed: 5, noise: true, light: true }).metrics;
  const b = simulate({ scenario: port, horizon: horizonFor(port), seed: 5, noise: true, light: true }).metrics;
  assert.deepEqual(a, b);
});

test('closing Kell Bridge forces a longer detour', () => {
  const direct = route('port', 'central');
  const detour = route('port', 'central', new Set(['harborRd']));
  assert.ok(direct.roads.includes('harborRd'));
  assert.ok(!detour.roads.includes('harborRd'));
  assert.ok(detour.length > direct.length * 2);
});

test('the AI plan protects hospitals better than doing nothing', () => {
  for (const sc of [port, { type: 'hub', target: 'central', start: 7, days: 2 }, { type: 'bridge', start: 7, days: 4 }, { type: 'supplier', start: 7, days: 4 }]) {
    const search = searchPlans(sc, sc.start, { runs: 12 });
    const best = rank(search, 'balanced')[0];
    const nothing = search.options.find((o) => o.id === 'none');
    assert.ok(best.actions.length > 0, `${sc.type}: should recommend an action`);
    assert.ok(best.stats.critLate < nothing.stats.critLate, `${sc.type}: fewer late hospital orders`);
    const played = runPlan(sc, best, sc.start);
    assert.ok(played.metrics.critLate <= simulate({ scenario: sc, horizon: horizonFor(sc) }).metrics.critLate);
  }
});
