// Baseline impact of each scenario across trigger times (calibration helper).
import { simulate } from '../src/sim/engine.js';
import { SCENARIOS } from '../src/data/network.js';
import { horizonFor } from '../src/sim/planner.js';

const normal = simulate({});
console.log('normal late', normal.metrics.late, 'stockouts', normal.stockouts.length);
for (const id of Object.keys(SCENARIOS)) {
  const row = [];
  for (const start of [6.5, 10, 13.5, 20, 30, 40, 50, 60]) {
    const sc = { type: id, target: SCENARIOS[id].defaultTarget, start, days: SCENARIOS[id].days.default };
    const m = simulate({ scenario: sc, horizon: horizonFor(sc) }).metrics;
    row.push(`${start}h:${m.late}/${m.critLate}`);
  }
  console.log(id.padEnd(9), row.join('  '));
}
