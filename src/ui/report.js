// Printable incident report + plain-text summary for sharing.
import { SCENARIOS, SITES } from '../data/network.js';
import { fmtTime, overdueSeries } from '../sim/query.js';
import {
  planTitle, scenarioSentence, rippleChain, actionDetails, insights, recoveryText,
} from '../sim/explain.js';
import { lineChart } from './charts.js';
import {
  money, int, pct, co2, plural,
} from './format.js';
import { extraCost, extraCo2 } from '../sim/planner.js';

// Same mark as public/favicon.svg, inline so it prints without network access.
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#4338CA"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#rg)"/><rect x="10" y="10" width="12" height="12" rx="2" transform="rotate(45 16 16)" fill="none" stroke="#fff" stroke-width="2.6"/></svg>';

function row(label, cells) {
  return `<tr><td>${label}</td>${cells.map((c) => `<td class="r">${c}</td>`).join('')}</tr>`;
}

export function buildReport(s) {
  const { scenario: sc, impact, search, option, baselineOpt, runnerUp, planRun } = s;
  const now = new Date();
  const chain = rippleChain(impact.expected);
  const steps = actionDetails(option, sc);
  const tips = insights(sc, impact.expected, option, planRun, search);
  const cols = [...new Set([baselineOpt, option, runnerUp].filter(Boolean))];
  const m = impact.expected.metrics;
  const head = (c) => {
    if (c === option) return `Chosen plan<br><span class="muted">${planTitle(c.actions)}</span>`;
    return c === baselineOpt ? 'Do nothing' : `Runner-up<br><span class="muted">${planTitle(c.actions)}</span>`;
  };
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
    <div class="report__brand">${LOGO}<h1>SupplyShock AI — disruption report</h1></div>
    <div class="muted">${SCENARIOS[sc.type].title} · generated ${now.toLocaleString()} · demo network: regional medical-supply distributor</div>

    <h2>What happened</h2>
    <p>${scenarioSentence(sc)} It starts ${fmtTime(sc.start)}.</p>

    <h2>Impact if nothing is done</h2>
    <table>
      ${row('Late orders', [int(m.late)])}
      ${row('Hospital orders late', [int(m.critLate)])}
      ${row('Back to normal after', [recoveryText(m)])}
      ${row(`Late orders in a bad week (1 in 10 of ${search.runs} futures)`, [int(Math.max(m.late, impact.risk.lateP90))])}
    </table>
    <ul>${chain.map((c) => `<li>${fmtTime(c.t)} — ${c.text}</li>`).join('')}</ul>

    <h2>Recovery plan: ${planTitle(option.actions)}</h2>
    <ul>${steps.map((a) => `<li><b>${a.title}.</b> ${a.text}</li>`).join('') || `<li>No changes — ${m.late ? 'for this objective, waiting it out scored best' : 'stock buffers cover this disruption'}.</li>`}</ul>
    ${chart}
    <div class="muted">Red: orders overdue with no action. Green: with the plan.</div>

    <h2>How the options compare</h2>
    <table>
      <tr><th></th>${cols.map((c) => `<th class="r">${head(c)}</th>`).join('')}</tr>
      ${row('Late orders', cols.map((c) => int(c.expected.late)))}
      ${row('Hospital orders late', cols.map((c) => int(c.expected.critLate)))}
      ${row('Back to normal after', cols.map((c) => recoveryText(c.expected)))}
      ${row('Disruption cost', cols.map((c) => money(extraCost(c.expected, search.horizon))))}
      ${row('Extra CO₂', cols.map((c) => co2(extraCo2(c.expected, search.horizon))))}
      ${row(`Hospitals safe in (of ${search.runs} futures)`, cols.map((c) => pct(c.stats.success)))}
    </table>
    <p class="muted">Rows show the expected course of events; the last row shows how often every hospital order arrived on time when demand, travel times and the disruption’s length were varied.</p>

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
    `If we do nothing: ${plural(m.late, 'late order')} (${m.critLate} for hospitals)${m.late ? `, back to normal after ${recoveryText(m)}` : ''}.`,
    `Plan: ${planTitle(option.actions)}.`,
    ...actionDetails(option, sc).map((a) => `• ${a.title}: ${a.text}`),
    `Expected with the plan: ${plural(option.expected.late, 'late order')} (${option.expected.critLate} for hospitals), disruption cost ${money(extraCost(option.expected, s.search.horizon))}; every hospital order on time in ${pct(st.success)} of ${s.search.runs} simulated futures.`,
    `Most affected: ${[...new Set(rippleChain(impact.expected).map((c) => c.site).filter(Boolean))].map((id) => SITES[id].name).join(', ') || 'none'}.`,
  ].join('\n');
}
