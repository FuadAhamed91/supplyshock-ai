// Turns simulation results into plain-language explanations. Every number here
// comes from the simulator or the Monte Carlo search, never from a template guess.
import { ACTIONS, SITES, SKUS, BACKUP, SCENARIOS } from '../data/network.js';
import { fmtTime } from './query.js';
import { money, int, pct, days, plural } from '../ui/format.js';
import { extraCost } from './planner.js';

const skuName = (k) => SKUS.find((s) => s.id === k)?.name.toLowerCase() ?? k;

export function planTitle(actions) {
  if (!actions.length) return 'Wait it out';
  return actions.map((a) => ACTIONS[a].short).join(' + ');
}

export function scenarioSentence(sc) {
  const d = plural(sc.days, 'day');
  switch (sc.type) {
    case 'port': return `Bayport Terminal can’t berth ships for about ${d} (${SCENARIOS.port.cause}).`;
    case 'hub': return `${SITES[sc.target].name} is offline for about ${d} (${SCENARIOS.hub.cause}).`;
    case 'bridge': return `Kell Bridge is closed for about ${d}, cutting the direct road from the port to Central Hub.`;
    default: return `Kestrel Pharma ships only 25% of normal volume for about ${d}.`;
  }
}

/** The chain of consequences in the do-nothing run, in time order. */
export function rippleChain(run) {
  const sc = run.scenario;
  const items = [{ t: sc.start, site: sc.type === 'hub' ? sc.target : sc.type === 'port' ? 'port' : null, tone: 'bad', text: SCENARIOS[sc.type].title }];
  const seenHub = new Set();
  for (const s of run.stockouts) {
    if (s.t < sc.start || seenHub.has(s.hub)) continue;
    seenHub.add(s.hub);
    items.push({ t: s.t, site: s.hub, tone: 'warn', text: `${SITES[s.hub].name} runs out of ${skuName(s.sku)}` });
  }
  const seenCust = new Set();
  const late = run.orders
    .filter((o) => o.dueAt >= sc.start && (o.completeAt === null || o.completeAt > o.dueAt + 1e-6))
    .sort((a, b) => a.dueAt - b.dueAt);
  for (const o of late) {
    if (seenCust.has(o.customer)) continue;
    seenCust.add(o.customer);
    items.push({ t: o.dueAt, site: o.customer, tone: 'bad', text: `${SITES[o.customer].name} gets a late order` });
  }
  return items.sort((a, b) => a.t - b.t);
}

/** Concrete steps of a plan, from what the plan's simulation actually did. */
export function actionDetails(option, sc) {
  const acts = option.acts || {};
  return option.actions.map((a) => {
    const base = { id: a, icon: ACTIONS[a].icon, title: ACTIONS[a].title };
    if (a === 'backup') {
      const units = (acts.batches || []).reduce((s, b) => s + b.units, 0);
      return { ...base, title: 'Rush order from Ridgeway Labs', text: `${int(units)} units in ${plural((acts.batches || []).length, 'batch', 'batches')}, first trucks out ${BACKUP.leadHours} h after ordering · +${Math.round(BACKUP.premium * 100)}% unit cost` };
    }
    if (a === 'rebalance') {
      const pairs = {};
      for (const tr of acts.transfers || []) {
        const k = `${SITES[tr.from].short} → ${SITES[tr.to].short}`;
        pairs[k] = (pairs[k] || 0) + tr.units;
      }
      const list = Object.entries(pairs).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${int(v)}`);
      return { ...base, title: 'Move stock to where it’s needed', text: list.length ? `${list.join(' · ')} units` : 'Watches stock every 12 h and moves surplus to hubs that are running low' };
    }
    if (a === 'reroute') {
      if (sc.type === 'hub') {
        const r = (acts.reassigned || []).map((x) => `${SITES[x.customer].short} → ${SITES[x.to].short}`);
        return { ...base, title: 'Serve customers from other hubs', text: r.length ? `While ${SITES[sc.target].short} is offline: ${r.join(', ')}` : 'Customers move to the nearest open hub' };
      }
      return { ...base, title: 'Detour trucks over North & Mill bridges', text: `${plural(acts.detours || 0, 'trip')} rerouted instead of waiting for Kell Bridge` };
    }
    return { ...base, title: 'Hospitals first', text: 'When stock is short, hospital orders ship first and half a day of hospital demand is held in reserve' };
  });
}

/** One plain sentence on why these levers fit this disruption. */
export function planReason(actions, sc) {
  if (!actions.length) return 'Stock buffers already cover this disruption, so the cheapest move is to keep running as normal.';
  const parts = [];
  if (actions.includes('backup')) {
    parts.push({
      port: 'Ridgeway Labs fills the gap while ships can\u2019t unload',
      supplier: 'Ridgeway Labs tops up what Kestrel can\u2019t ship',
      bridge: 'Ridgeway Labs supplies Central from the north side of the river',
      hub: 'Ridgeway Labs adds stock to the hubs carrying the extra load',
    }[sc.type]);
  }
  if (actions.includes('rebalance')) parts.push('spare stock moves from North Hub to the hubs that run dry first');
  if (actions.includes('reroute')) parts.push(sc.type === 'hub' ? `customers of ${SITES[sc.target].short} are served from the nearest open hub` : 'trucks take the North and Mill bridges instead of waiting at Kell Bridge');
  if (actions.includes('prioritize')) parts.push('scarce stock goes to hospitals first');
  const text = parts.join(', ').replace(/, ([^,]*)$/, ' and $1');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export function whyText(option, baseline, search) {
  const H = search.horizon;
  const b = baseline.expected;
  const o = option.expected;
  const lines = [
    `If you do nothing: ${plural(b.late, 'late order')} (${b.critLate} for hospitals) and about ${money(extraCost(b, H))} in penalties and extra trucking.`,
  ];
  if (option.actions.length) {
    lines.push(`With this plan: ${plural(o.late, 'late order')}${o.late < b.late ? ` (${b.late - o.late} fewer)` : ''}. In ${pct(option.stats.success)} of ${search.runs} simulated futures every hospital order still arrives on time — versus ${pct(baseline.stats.success)} if you do nothing.`);
  }
  return lines;
}

export function insights(sc, baselineRun, option, planRun) {
  const out = [];
  const first = baselineRun.metrics.firstStockout;
  if (first) out.push(`Without action the first stockout hits ${SITES[first.hub].name} (${skuName(first.sku)}) at ${fmtTime(first.t)} — ${days(first.t - sc.start)} after the disruption starts.`);
  if (option.actions.includes('backup')) out.push('Pre-negotiate a standing rush agreement with a local backup supplier — it was the strongest lever in this test.');
  if (option.actions.includes('rebalance')) out.push('North Hub’s extra safety stock acted as the network’s shock absorber; keep a regional reserve like it.');
  if (option.actions.includes('reroute') && sc.type === 'bridge') out.push('Add the North Bridge detour to dispatch playbooks so trucks don’t wait on a closed bridge.');
  if (option.actions.includes('reroute') && sc.type === 'hub') out.push('Document which hub backs up each customer so reassignments happen within hours, not days.');
  if (option.actions.includes('prioritize')) out.push('Agree a hospital-first rationing rule in advance so scarce stock goes to patients automatically.');
  if (planRun && planRun.metrics.late === 0) out.push('With the plan, every order in the simulated week was delivered on time.');
  return out;
}
