// Printable incident report + plain-text summary for sharing.
import { SCENARIOS, SITES } from '../data/network.js';
import { fmtTime, overdueSeries } from '../sim/query.js';
import {
  planTitle, scenarioSentence, rippleChain, actionDetails, insights,
} from '../sim/explain.js';
import { lineChart } from './charts.js';
import { money, int, pct, days, co2 } from './format.js';
import { extraCost, extraCo2 } from '../sim/planner.js';

function row(label, cells) {
  return `<tr><td>${label}</td>${cells.map((c) => `<td class="r">${c}</td>`).join('')}</tr>`;
}

export function buildReport(s) {
  const { scenario: sc, impact, search, option, baselineOpt, runnerUp, planRun } = s;
  const now = new Date();
  const chain = rippleChain(impact.expected);
  const steps = actionDetails(option, sc);
  const tips = insights(sc, impact.expected, option, planRun);
  const cols = [baselineOpt, option, runnerUp].filter(Boolean);
  const chart = lineChart({
    series: [
      { values: overdueSeries(impact.expected), color: '#E5484D', fill: true },
      { values: overdueSeries(planRun), color: '#16A34A' },
    ],
    horizon: impact.horizon,
    band: [sc.start, sc.start + sc.days * 24],
    width: 520,
    height: 150,
  });
  return `
    <h1>SupplyShock AI — disruption report</h1>
    <div class="muted">${SCENARIOS[sc.type].title} · generated ${now.toLocaleString()} · demo network: regional medical-supply distributor</div>

    <h2>What happened</h2>
    <p>${scenarioSentence(sc)} It starts ${fmtTime(sc.start)}.</p>

    <h2>Impact if nothing is done</h2>
    <table>
      ${row('Late orders', [int(impact.expected.metrics.late)])}
      ${row('Hospital orders late', [int(impact.expected.metrics.critLate)])}
      ${row('Back to normal after', [impact.expected.metrics.late ? days(impact.expected.metrics.recoveryH) : 'no late orders'])}
      ${row('Range across 40 simulated futures', [`${int(impact.risk.lateP10)}–${int(impact.risk.lateP90)} late orders`])}
    </table>
    <ul>${chain.map((c) => `<li>${fmtTime(c.t)} — ${c.text}</li>`).join('')}</ul>

    <h2>Recovery plan: ${planTitle(option.actions)}</h2>
    <ul>${steps.map((a) => `<li><b>${a.title}.</b> ${a.text}</li>`).join('') || '<li>No changes — the network absorbs this disruption.</li>'}</ul>
    ${chart}
    <div class="muted">Red: orders overdue with no action. Green: with the plan.</div>

    <h2>How the options compare</h2>
    <table>
      <tr><th></th>${cols.map((c) => `<th class="r">${c === baselineOpt ? 'Do nothing' : c === option ? 'Chosen plan' : 'Runner-up'}<br><span class="muted">${planTitle(c.actions)}</span></th>`).join('')}</tr>
      ${row('Late orders', cols.map((c) => int(c.expected.late)))}
      ${row('Hospital orders late', cols.map((c) => int(c.expected.critLate)))}
      ${row('Back to normal after', cols.map((c) => (c.expected.late ? days(c.expected.recoveryH) : 'no delay')))}
      ${row('Disruption cost', cols.map((c) => money(extraCost(c.expected, search.horizon))))}
      ${row('Extra CO₂', cols.map((c) => co2(extraCo2(c.expected, search.horizon))))}
      ${row(`Hospitals safe in (of ${search.runs} futures)`, cols.map((c) => pct(c.stats.success)))}
    </table>
    <p class="muted">Rows show the expected week; the last row shows how often every hospital order arrived on time when demand, travel times and the disruption’s length were varied.</p>

    <h2>Recommendations</h2>
    <ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul>

    <h2>Method</h2>
    <p class="muted">${int(search.simulations)} discrete-event simulations (${search.strategies} strategies × ${search.runs} futures + expected case). Each future varies order sizes (±15%), truck travel times (±8%) and the disruption’s real length (−20% to +35%). Plans are ranked with late hospital orders weighted highest, then the chosen objective. Customer and site names are fictional.</p>
  `;
}

export function summaryText(s) {
  const { scenario: sc, impact, option } = s;
  const m = impact.expected.metrics;
  const st = option.stats;
  return [
    `SupplyShock AI — ${SCENARIOS[sc.type].title}`,
    scenarioSentence(sc),
    `If we do nothing: ${m.late} late orders (${m.critLate} for hospitals), back to normal after ${m.late ? days(m.recoveryH) : '—'}.`,
    `Plan: ${planTitle(option.actions)}.`,
    ...actionDetails(option, sc).map((a) => `• ${a.title}: ${a.text}`),
    `Expected with the plan: ${option.expected.late} late orders (${option.expected.critLate} for hospitals), disruption cost ${money(extraCost(option.expected, s.search.horizon))}; every hospital order on time in ${pct(st.success)} of ${s.search.runs} simulated futures.`,
    `Most affected: ${[...new Set(rippleChain(impact.expected).map((c) => c.site).filter(Boolean))].map((id) => SITES[id].name).join(', ') || 'none'}.`,
  ].join('\n');
}
