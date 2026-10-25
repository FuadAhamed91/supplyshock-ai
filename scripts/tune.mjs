// Prints how every scenario and recovery strategy plays out. Used to calibrate the demo network.
import { simulate } from '../src/sim/engine.js';
import { searchPlans, rank, OBJECTIVES, analyzeImpact, extraCost } from '../src/sim/planner.js';
import { SCENARIOS } from '../src/data/network.js';

const start = Number(process.argv[2] ?? 10);
const f = (x, d = 1) => Number(x).toFixed(d);
const normal = simulate({});
console.log('NORMAL  late', normal.metrics.late, 'of', normal.metrics.orders, 'stockouts', normal.stockouts.length,
  'trips', normal.metrics.truckTrips, 'logistics $', f(normal.metrics.logistics, 0));
for (const id of Object.keys(SCENARIOS)) {
  const sc = { type: id, target: SCENARIOS[id].defaultTarget, start, days: SCENARIOS[id].days.default };
  const imp = analyzeImpact(sc);
  const m = imp.expected.metrics;
  console.log(`\n=== ${id} (${sc.days}d @${start}h)  baseline late ${m.late}/${m.orders} crit ${m.critLate} recov ${f(m.recoveryH / 24)}d cost $${f(extraCost(m, imp.horizon), 0)} firstOut ${m.firstStockout ? m.firstStockout.hub + ':' + m.firstStockout.sku + '@' + f(m.firstStockout.t) : '-'}  risk late ${f(imp.risk.lateP10, 0)}-${f(imp.risk.lateP90, 0)}`);
  const s = searchPlans(sc, start);
  console.log(`   ${s.simulations} sims in ${f(s.ms, 0)} ms`);
  for (const o of s.options) {
    const st = o.stats;
    console.log(`   ${o.id.padEnd(34)} late ${f(st.late).padStart(5)} crit ${f(st.critLate).padStart(4)} succ ${f(st.success * 100, 0).padStart(3)}% recov ${f(st.recoveryH / 24, 2).padStart(5)}d cost $${f(st.cost, 0).padStart(6)} co2 ${f(st.co2, 0).padStart(5)}kg | exp late ${o.expected.late} crit ${o.expected.critLate}`);
  }
  for (const obj of Object.keys(OBJECTIVES)) console.log(`   best[${obj}] = ${rank(s, obj)[0].id}`);
}
