// The AI planner.
//
// For a disruption it enumerates every combination of recovery levers that make
// sense for it, simulates each combination across many possible futures
// (Monte Carlo: demand, travel times and the disruption's real length all vary),
// scores the outcomes against what the user cares about, and explains the winner.

import { APPLICABLE, BASE_HORIZON } from '../data/network.js';
import { simulate } from './engine.js';

// Every objective keeps the same guardrail: a late hospital order costs far more
// than anything else, so no objective "optimises" by letting patients wait.
const GUARDRAIL = 60000;
export const OBJECTIVES = {
  balanced: { label: 'Balanced', hint: 'Service first, then cost and emissions',
    w: { late: 3000, cost: 1, co2: 1, recovery: 80 } },
  cost: { label: 'Cheapest', hint: 'Cheapest overall, penalties included',
    w: { late: 0, cost: 1, co2: 0, recovery: 0 } },
  speed: { label: 'Fastest', hint: 'Back to normal as soon as possible',
    w: { late: 2500, cost: 0.1, co2: 0, recovery: 1500 } },
  green: { label: 'Greenest', hint: 'Fewest extra truck kilometres',
    w: { late: 1500, cost: 0.15, co2: 20, recovery: 10 } },
};

export function horizonFor(scenario) {
  return Math.max(BASE_HORIZON, Math.ceil((scenario.start + scenario.days * 24 + 84) / 24) * 24);
}

function subsets(list) {
  const out = [];
  for (let m = 0; m < 1 << list.length; m++) out.push(list.filter((_, i) => m & (1 << i)));
  return out;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};

const normalCache = new Map();
function normalRef(horizon) {
  if (!normalCache.has(horizon)) normalCache.set(horizon, simulate({ horizon, light: true }).metrics);
  return normalCache.get(horizon);
}

// Costs attributable to the disruption, on top of a normal week.
export function extraCost(m, horizon) {
  const n = normalRef(horizon);
  return m.penalties + Math.max(0, m.logistics - n.logistics) + m.premiumCost;
}
export function extraCo2(m, horizon) {
  return Math.max(0, m.co2 - normalRef(horizon).co2);
}

function summarize(metricsList, horizon) {
  return {
    late: mean(metricsList.map((m) => m.late)),
    critLate: mean(metricsList.map((m) => m.critLate)),
    cost: mean(metricsList.map((m) => extraCost(m, horizon))),
    co2: mean(metricsList.map((m) => extraCo2(m, horizon))),
    recoveryH: mean(metricsList.map((m) => m.recoveryH)),
    success: mean(metricsList.map((m) => (m.critLate === 0 ? 1 : 0))),
    lateP10: pct(metricsList.map((m) => m.late), 0.1),
    lateP90: pct(metricsList.map((m) => m.late), 0.9),
    recoveryP90: pct(metricsList.map((m) => m.recoveryH), 0.9),
  };
}

/** Impact of doing nothing: expected run + a risk range. */
export function analyzeImpact(scenario, { runs = 40 } = {}) {
  const horizon = horizonFor(scenario);
  const expected = simulate({ scenario, horizon });
  const mc = [];
  for (let s = 1; s <= runs; s++) mc.push(simulate({ scenario, horizon, seed: s, noise: true, light: true }).metrics);
  return { horizon, expected, risk: summarize(mc, horizon) };
}

function evaluateCombo(scenario, actions, at, horizon, runs) {
  const plan = actions.length ? { actions, at } : null;
  const expected = simulate({ scenario, plan, horizon, light: true });
  const mc = [];
  for (let s = 1; s <= runs; s++) {
    mc.push(simulate({ scenario, plan, horizon, seed: s, noise: true, light: true }).metrics);
  }
  return { id: actions.join('+') || 'none', actions, expected: expected.metrics, acts: expected.acts, stats: summarize(mc, horizon) };
}

/**
 * Search every applicable combination of levers. Returns all options (the
 * empty combination is "do nothing"), each with expected + Monte Carlo stats.
 */
export function searchPlans(scenario, at, { runs = 40 } = {}) {
  const horizon = horizonFor(scenario);
  const combos = subsets(APPLICABLE[scenario.type]);
  const started = performance.now();
  const options = combos.map((actions) => evaluateCombo(scenario, actions, at, horizon, runs));
  return { horizon, options, runs, simulations: combos.length * (runs + 1), strategies: combos.length, ms: performance.now() - started };
}

/** Same search, yielding to the browser between strategies so the UI can animate. */
export async function searchPlansAsync(scenario, at, { runs = 40, onProgress } = {}) {
  const horizon = horizonFor(scenario);
  const combos = subsets(APPLICABLE[scenario.type]);
  const options = [];
  let ms = 0;
  for (let i = 0; i < combos.length; i++) {
    const t0 = performance.now();
    options.push(evaluateCombo(scenario, combos[i], at, horizon, runs));
    ms += performance.now() - t0;
    onProgress?.((i + 1) / combos.length, options[i]);
    await new Promise((r) => { setTimeout(r, 0); });
  }
  return { horizon, options, runs, simulations: combos.length * (runs + 1), strategies: combos.length, ms };
}

export function score(option, objective) {
  const { w } = OBJECTIVES[objective];
  const s = option.stats;
  return GUARDRAIL * s.critLate + w.late * s.late + w.cost * s.cost + w.co2 * s.co2 + w.recovery * s.recoveryH;
}

/** Rank options for an objective; ties go to the simpler plan. */
export function rank(search, objective) {
  return [...search.options].sort((a, b) => {
    const d = score(a, objective) - score(b, objective);
    return Math.abs(d) > 1 ? d : a.actions.length - b.actions.length;
  });
}

/** Full playback run for a chosen option. */
export function runPlan(scenario, option, at) {
  const horizon = horizonFor(scenario);
  const plan = option.actions.length ? { actions: option.actions, at } : null;
  return simulate({ scenario, plan, horizon });
}
