// Turns simulation results into plain-language explanations. Every number here
// comes from the simulator or the Monte Carlo search, never from a template guess.
import {
  ACTIONS, SITES, SKUS, BACKUP, SCENARIOS, BRIDGES,
} from '../data/network.js';
import { fmtTime } from './query.js';
import { isLateOrder } from './engine.js';
import { int, days, plural } from '../ui/format.js';

const skuName = (k) => SKUS.find((s) => s.id === k)?.name.toLowerCase() ?? k;
const listText = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] ?? '');
const bridgeNames = (acts) => (acts?.bridges || []).map((b) => BRIDGES[b].name);

/** Hubs that gave away the most stock when rebalancing, biggest donor first. */
function donors(acts) {
  const out = {};
  for (const tr of acts?.transfers || []) out[tr.from] = (out[tr.from] || 0) + tr.units;
  return Object.keys(out).sort((a, b) => out[b] - out[a]).map((h) => SITES[h].name);
}

export function planTitle(actions) {
  if (!actions.length) return 'Wait it out';
  return actions.map((a) => ACTIONS[a].short).join(' + ');
}

/** "Back to normal" for a run's metrics, worded the same on every screen. */
export function recoveryText(m) {
  if (!m.late) return 'no delay';
  return m.recovered ? days(m.recoveryH) : `> ${days(m.recoveryH)}`;
}

export function scenarioSentence(sc) {
  const d = plural(sc.days, 'day');
  switch (sc.type) {
    case 'port': return `Bayport Terminal can’t berth ships for about ${d} (${SCENARIOS.port.cause}).`;
    case 'hub': return `${SITES[sc.target].name} is offline for about ${d} (${SCENARIOS.hub.cause}).`;
    case 'bridge': return `Kell Bridge is closed for about ${d}, cutting the direct road from the port to Central Hub.`;
    default: return `Kestrel Pharma ships only 25% of normal volume for about ${d}; the backlog follows on later sailings.`;
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
    .filter((o) => o.dueAt >= sc.start && isLateOrder(o, run.horizon))
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
      const batches = acts.batches || [];
      const units = batches.reduce((s, b) => s + b.units, 0);
      const what = batches.length ? `${int(units)} units in ${plural(batches.length, 'batch', 'batches')}` : `A rush batch every ${BACKUP.batchEvery} h`;
      return { ...base, title: 'Rush order from Ridgeway Labs', text: `${what}, first trucks out ${BACKUP.leadHours} h after ordering · +${Math.round(BACKUP.premium * 100)}% unit cost` };
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
        return { ...base, title: 'Serve customers from other hubs', text: r.length ? `While ${SITES[sc.target].name} is offline: ${r.join(', ')}` : 'Customers move to the nearest open hub' };
      }
      const names = bridgeNames(acts);
      return {
        ...base,
        title: names.length ? `Detour trucks over ${listText(names)}` : 'Detour trucks around Kell Bridge',
        text: `${plural(acts.detours || 0, 'trip')} rerouted instead of waiting for Kell Bridge to reopen`,
      };
    }
    return { ...base, title: 'Hospitals first', text: 'Hospital orders ship first and half a day of their demand is held back, until a day after the disruption ends' };
  });
}

/** One plain sentence on why these levers fit this disruption. */
export function planReason(option, sc) {
  const { actions, acts } = option;
  if (!actions.length) {
    return option.expected.late
      ? 'For this objective, no combination of recovery moves beats waiting it out.'
      : 'Stock buffers already cover this disruption, so the cheapest move is to keep running as normal.';
  }
  const parts = [];
  if (actions.includes('backup')) {
    parts.push({
      port: 'Ridgeway Labs fills the gap while ships can’t unload',
      supplier: 'Ridgeway Labs tops up what Kestrel can’t ship',
      bridge: 'Ridgeway Labs rush-ships stock while the port road is cut',
      hub: 'Ridgeway Labs adds stock to the hubs carrying the extra load',
    }[sc.type]);
  }
  if (actions.includes('rebalance')) {
    const from = donors(acts);
    parts.push(from.length ? `spare stock moves from ${listText(from)} to the hubs that run low first` : 'spare stock moves to any hub that runs low');
  }
  if (actions.includes('reroute')) {
    const names = bridgeNames(acts);
    parts.push(sc.type === 'hub'
      ? `customers of ${SITES[sc.target].name} are served from the nearest open hub`
      : `trucks take ${names.length ? listText(names) : 'another bridge'} instead of waiting at Kell Bridge`);
  }
  if (actions.includes('prioritize')) parts.push('scarce stock goes to hospitals first');
  const text = listText(parts);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** The single lever that helped hospitals most on its own (Monte Carlo averages). */
function strongestLever(search) {
  const singles = search.options.filter((o) => o.actions.length === 1);
  singles.sort((a, b) => a.stats.critLate - b.stats.critLate || a.stats.late - b.stats.late);
  return singles[0] || null;
}

export function insights(sc, baselineRun, option, planRun, search) {
  const out = [];
  const first = baselineRun.metrics.firstStockout;
  if (first) out.push(`Without action the first stockout hits ${SITES[first.hub].name} (${skuName(first.sku)}) at ${fmtTime(first.t)} — ${days(first.t - sc.start)} after the disruption starts.`);
  const none = search.options.find((o) => o.id === 'none');
  const best = strongestLever(search);
  if (best && none && best.stats.late < none.stats.late) {
    out.push(`On its own, “${ACTIONS[best.actions[0]].short}” was the strongest single move: ${plural(Math.round(best.expected.late), 'late order')} instead of ${int(none.expected.late)}.`);
  }
  const has = (a) => option.actions.includes(a);
  if (has('backup')) out.push('Pre-negotiate a standing rush agreement with a local backup supplier so it can start within hours.');
  const from = donors(option.acts);
  if (has('rebalance') && from.length) out.push(`${from[0]}’s extra safety stock acted as the network’s shock absorber; keep a regional reserve like it.`);
  const names = bridgeNames(option.acts);
  if (has('reroute') && sc.type === 'bridge' && names.length) out.push(`Add the ${listText(names)} detour to dispatch playbooks so trucks don’t wait at a closed bridge.`);
  if (has('reroute') && sc.type === 'hub') out.push('Document which hub backs up each customer so reassignments happen within hours, not days.');
  if (has('prioritize')) out.push('Agree a hospital-first rationing rule in advance so scarce stock goes to patients automatically.');
  if (planRun && planRun.metrics.late === 0) out.push('With the plan, every order in the simulated period was delivered on time.');
  return out;
}
