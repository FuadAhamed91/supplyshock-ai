// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, total } from '../src/sim/engine.js';
import {
  searchPlans, rank, runPlan, horizonFor, OBJECTIVES,
} from '../src/sim/planner.js';
import { route } from '../src/sim/graph.js';
import { hubState, fmtTime } from '../src/sim/query.js';
import { rippleChain } from '../src/sim/explain.js';
import {
  SITES, HUB_IDS, SKU_IDS, VESSEL, SCENARIOS,
} from '../src/data/network.js';

const port = { type: 'port', start: 7, days: 4 };
const scenarios = [
  port,
  { type: 'hub', target: 'central', start: 7, days: 2 },
  { type: 'bridge', start: 7, days: 4 },
  { type: 'supplier', start: 7, days: 4 },
];

test('a normal week delivers every order on time, with no false alarms', () => {
  const run = simulate({});
  assert.equal(run.metrics.late, 0);
  assert.equal(run.stockouts.length, 0);
  assert.ok(run.shipments.length > 50, 'trucks should be moving');
  for (let t = 0; t < run.horizon; t += 0.5) {
    for (const h of HUB_IDS) assert.equal(hubState(run, h, t).tone, 'ok', `${h} looks at risk at ${fmtTime(t)}`);
  }
});

test('stock is conserved: every unit is in a hub, at the port, on a truck or delivered', () => {
  const sc = { type: 'supplier', start: 7, days: 4 };
  const run = simulate({ scenario: sc, plan: { actions: ['backup', 'rebalance'], at: sc.start }, horizon: horizonFor(sc) });
  const H = run.horizon;
  for (const k of SKU_IDS) {
    const initial = HUB_IDS.reduce((a, h) => a + run.series[h][k][0], 0);
    let unloaded = 0;
    for (const v of run.vessels) {
      const part = Math.floor(v.cargo[k] / 3);
      for (let p = 1; p <= 3; p++) {
        if (v.arrive + (p * VESSEL.unloadHours) / 3 <= H) unloaded += p === 3 ? v.cargo[k] - 2 * part : part;
      }
    }
    const sum = (list) => list.reduce((a, s) => a + s.cargo[k], 0);
    const backup = sum(run.shipments.filter((s) => s.kind === 'backup'));
    const delivered = sum(run.shipments.filter((s) => s.kind === 'delivery'));
    const onTheRoad = sum(run.shipments.filter((s) => s.kind !== 'delivery' && s.arrive > H));
    const left = [...HUB_IDS, 'port'].reduce((a, id) => a + run.series[id][k][H], 0);
    assert.equal(initial + unloaded + backup, left + delivered + onTheRoad, `${k} balance`);
  }
  const shipped = run.shipments.filter((s) => s.kind === 'backup').reduce((a, s) => a + total(s.cargo), 0);
  assert.equal(run.metrics.backupUnits, shipped, 'every rush unit paid for is shipped');
  for (const o of run.orders) {
    for (const line of Object.values(o.lines)) assert.ok(line.delivered <= line.qty, 'never over-delivered');
  }
});

test('port congestion makes hubs run dry and orders late', () => {
  const run = simulate({ scenario: port, horizon: horizonFor(port) });
  assert.ok(run.stockouts.some((s) => s.t >= port.start), 'a hub runs out');
  assert.ok(run.metrics.late > 0);
  assert.ok(run.metrics.critLate > 0);
  assert.ok(run.vessels.some((v) => v.held), 'the incoming ship is held at anchor');
});

test('every disruption plays out inside its horizon', () => {
  for (const type of Object.keys(SCENARIOS)) {
    const { min, max } = SCENARIOS[type].days;
    for (let days = min; days <= max; days++) {
      for (const start of [0, 6.5, 47.5, 160]) {
        const sc = { type, days, start, target: 'central' };
        const m = simulate({ scenario: sc, horizon: horizonFor(sc), light: true }).metrics;
        const long = simulate({ scenario: sc, horizon: 40 * 24, light: true }).metrics;
        assert.ok(!m.late || m.recovered, `${type} ${days}d @${start} recovers`);
        assert.equal(m.late, long.late, `${type} ${days}d @${start}: no late orders hide past the horizon`);
      }
    }
  }
});

test('a supplier outage is made up on later sailings', () => {
  const sc = { type: 'supplier', start: 7, days: 4 };
  const run = simulate({ scenario: sc, horizon: horizonFor(sc) });
  const cut = run.vessels.filter((v) => v.share < 1);
  const extra = run.vessels.reduce((a, v) => a + v.extra, 0);
  const lost = cut.reduce((a, v) => a + SKU_IDS.reduce((b, k) => b + VESSEL.cargo[k] - v.cargo[k], 0), 0);
  assert.ok(cut.length > 0);
  assert.equal(extra, lost, 'the whole backlog is shipped');
});

test('hospitals-first rationing ends after the disruption', () => {
  const run = simulate({ scenario: port, plan: { actions: ['prioritize'], at: port.start }, horizon: horizonFor(port) });
  const lifted = run.events.find((e) => /rationing lifted/.test(e.text));
  assert.ok(lifted && lifted.t >= run.scenario.end, 'rationing is lifted once the port reopens');
});

test('the ripple only lists late orders the metrics count', () => {
  for (let start = 0; start <= 9; start += 1.5) {
    const sc = { type: 'supplier', start, days: 2 };
    const run = simulate({ scenario: sc, horizon: horizonFor(sc) });
    const lateCustomers = rippleChain(run).filter((c) => /late order/.test(c.text)).length;
    if (!run.metrics.late) assert.equal(lateCustomers, 0, `start ${start}`);
  }
});

test('simulations are reproducible for the same seed', () => {
  const a = simulate({ scenario: port, horizon: horizonFor(port), seed: 5, noise: true, light: true }).metrics;
  const b = simulate({ scenario: port, horizon: horizonFor(port), seed: 5, noise: true, light: true }).metrics;
  assert.deepEqual(a, b);
});

test('closing Kell Bridge forces a longer detour, over Mill Bridge', () => {
  const direct = route('port', 'central');
  const detour = route('port', 'central', new Set(['harborRd']));
  assert.ok(direct.roads.includes('harborRd'));
  assert.ok(!detour.roads.includes('harborRd'));
  assert.ok(detour.length > direct.length * 2);
  const sc = { type: 'bridge', start: 7, days: 4 };
  const run = simulate({ scenario: sc, plan: { actions: ['reroute'], at: sc.start }, horizon: horizonFor(sc) });
  assert.ok(run.acts.detours > 0);
  assert.deepEqual(run.acts.bridges, ['south'], 'detours cross Mill Bridge');
});

test('the AI plan protects hospitals better than doing nothing', () => {
  for (const base of scenarios) {
    for (const start of [7, 20, 45.5]) {
      const sc = { ...base, start };
      const search = searchPlans(sc, sc.start, { runs: 12 });
      const best = rank(search, 'balanced')[0];
      const nothing = search.options.find((o) => o.id === 'none');
      const label = `${sc.type} @${start}`;
      assert.ok(best.actions.length > 0, `${label}: should recommend an action`);
      assert.ok(best.stats.critLate < nothing.stats.critLate, `${label}: fewer late hospital orders`);
      const played = runPlan(sc, best, sc.start);
      assert.ok(played.metrics.critLate <= simulate({ scenario: sc, horizon: horizonFor(sc) }).metrics.critLate);
    }
  }
});

test('no objective trades hospital safety for cost, speed or CO2', () => {
  for (const sc of scenarios) {
    const search = searchPlans(sc, sc.start, { runs: 12 });
    const safest = Math.max(...search.options.map((o) => o.stats.success));
    for (const objective of Object.keys(OBJECTIVES)) {
      const pick = rank(search, objective)[0];
      assert.ok(pick.stats.success >= safest - 1e-9, `${sc.type} / ${objective}: ${pick.id} is less safe than the best plan`);
    }
  }
});

test('near-ties go to the simpler plan', () => {
  // Rerouting alone already protects every hospital on a bridge closure, so the
  // planner must not also recommend a rationing rule that changes nothing.
  const sc = { type: 'bridge', start: 7, days: 4 };
  const best = rank(searchPlans(sc, sc.start, { runs: 12 }), 'balanced')[0];
  assert.deepEqual(best.actions, ['reroute']);
});

test('clock labels never round a minute down or roll past midnight', () => {
  assert.equal(fmtTime(14.2), 'Day 1 · 14:12');
  assert.equal(fmtTime(23.9999), 'Day 1 · 23:59');
  assert.equal(fmtTime(24), 'Day 2 · 00:00');
  assert.equal(SITES.port.type, 'port');
});
