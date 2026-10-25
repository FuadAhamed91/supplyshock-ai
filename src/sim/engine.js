// Discrete-event simulation of the distribution network.
//
// One call to simulate() plays the whole horizon hour by hour: customers place
// orders, hubs ship deliveries, the vessel restocks the port, the port restocks
// the hubs - and a disruption plus an optional recovery plan bend that flow.
// The same engine drives the 3D playback (noise off) and the AI planner's
// Monte Carlo search (noise on, many seeds).

import {
  SITES, HUB_IDS, CUSTOMER_IDS, SKU_IDS, SKUS, VESSEL, BACKUP, OPS, BASE_HORIZON, BRIDGES,
} from '../data/network.js';
import { route, usesRoad } from './graph.js';
import { mulberry32, clamp } from './rng.js';

const BRIDGE_ROAD = 'harborRd';
const UNIT_COST = Object.fromEntries(SKUS.map((s) => [s.id, s.unitCost]));
const PRIO = {
  ARRIVE: 0, UNLOAD: 1, BERTH: 1, HELD: 2, DSTART: 2, DEND: 2, PLAN: 3, RATION_END: 3, DUE: 4,
  REBALANCE: 5, BACKUP: 6, DISPATCH: 7, PORT: 8, SAMPLE: 9,
};

export const zero = () => Object.fromEntries(SKU_IDS.map((k) => [k, 0]));
export const total = (c) => SKU_IDS.reduce((a, k) => a + c[k], 0);

/** An order counts as late if it was due within the horizon and arrived after its due time (or never). */
export const isLateOrder = (o, horizon) => o.dueAt <= horizon
  && (o.completeAt === null ? o.dueAt < horizon : o.completeAt > o.dueAt + 1e-6);

class EventQueue {
  constructor() { this.a = []; this.seq = 0; }
  static less(x, y) {
    return x.t < y.t || (x.t === y.t && (x.p < y.p || (x.p === y.p && x.s < y.s)));
  }
  push(t, type, data) {
    const a = this.a;
    a.push({ t, p: PRIO[type], s: this.seq++, type, ...data });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!EventQueue.less(a[i], a[parent])) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && EventQueue.less(a[l], a[m])) m = l;
        if (r < a.length && EventQueue.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

/**
 * @param {object} opts
 * @param {{type:string,target?:string,start:number,days:number}|null} opts.scenario
 * @param {{actions:string[],at:number}|null} opts.plan
 * @param {number} opts.horizon  hours from Day 1 00:00
 * @param {number} opts.seed     Monte Carlo seed (only used when noise is on)
 * @param {boolean} opts.noise   sample demand, travel and disruption uncertainty
 * @param {boolean} opts.light   skip the event log and hourly stock samples
 */
export function simulate({
  scenario = null, plan = null, horizon = BASE_HORIZON, seed = 0, noise = false, light = false,
} = {}) {
  const rngOrders = mulberry32(seed * 9973 + 11);
  const rngScen = mulberry32(seed * 7919 + 23);
  const rngTravel = mulberry32(seed * 104729 + 37);

  // Disruption window. Real disruptions rarely end exactly when announced.
  let sc = null;
  if (scenario) {
    const mult = noise ? 0.8 + 0.55 * rngScen() : 1;
    sc = {
      ...scenario,
      end: scenario.start + scenario.days * 24 * mult,
      plannedEnd: scenario.start + scenario.days * 24,
    };
  }
  const actions = new Set(plan ? plan.actions : []);

  // ------------------------------------------------------------------ state
  const stock = {};
  const inTransit = {};
  for (const id of [...HUB_IDS, 'port']) {
    stock[id] = zero();
    inTransit[id] = zero();
  }
  const assign = Object.fromEntries(CUSTOMER_IDS.map((c) => [c, SITES[c].hub]));
  const reassigned = [];
  let prioritize = false;
  let reroute = false;

  const hubDaily = (h, k) => CUSTOMER_IDS.reduce((a, c) => a + (assign[c] === h ? SITES[c].demand[k] : 0), 0);
  for (const h of HUB_IDS) for (const k of SKU_IDS) stock[h][k] = Math.round(SITES[h].stockDays * hubDaily(h, k));

  const hubClosedAt = (h, t) => sc && sc.type === 'hub' && sc.target === h && t >= sc.start && t < sc.end;
  const bridgeClosedAt = (t) => sc && sc.type === 'bridge' && t >= sc.start && t < sc.end;

  const q = new EventQueue();
  const push = (t, type, data = {}) => { if (t <= horizon + 1e-9) q.push(t, type, data); };

  const shipments = [];
  const orders = [];
  const vessels = [];
  const events = [];
  const stockouts = [];
  const outNow = Object.fromEntries(HUB_IDS.map((h) => [h, zero()]));
  const log = light ? () => {} : (t, tone, text, site = null) => events.push({ t, tone, text, site });
  const acts = {
    transfers: [], batches: [], reassigned, detours: 0, bridges: [], firstAt: null,
  };
  let movingHours = 0;
  let waitingHours = 0;
  let premiumCost = 0;
  let backupUnits = 0;
  let transferUnits = 0;

  const travelMult = () => (noise ? clamp(1 + 0.08 * rngTravel.gauss(), 0.85, 1.35) : 1);

  // -------------------------------------------------------------- shipments
  function dispatchTruck(kind, from, to, cargo, t, allocations = null) {
    let r = route(from, to);
    let depart = t;
    let detour = false;
    if (bridgeClosedAt(t) && usesRoad(r, BRIDGE_ROAD)) {
      const alt = reroute ? route(from, to, new Set([BRIDGE_ROAD])) : null;
      if (alt) {
        r = alt;
        detour = true;
        acts.detours++;
        for (const [id, b] of Object.entries(BRIDGES)) {
          if (r.roads.includes(b.road) && !acts.bridges.includes(id)) acts.bridges.push(id);
        }
      } else {
        depart = sc.end; // hold the truck until the bridge reopens
      }
    }
    const travel = (r.length / OPS.speed) * travelMult();
    const arriveGate = depart + travel;
    const arrive = SITES[to].type === 'hub' && hubClosedAt(to, arriveGate) ? sc.end : arriveGate;
    const s = {
      id: shipments.length + 1, kind, from, to, cargo, created: t, depart, arriveGate, arrive,
      points: r.points, roads: r.roads, detour, allocations,
    };
    shipments.push(s);
    movingHours += travel;
    waitingHours += depart - t + (arrive - arriveGate);
    if (inTransit[to]) for (const k of SKU_IDS) inTransit[to][k] += cargo[k];
    push(arrive, 'ARRIVE', { ship: s });
    return s;
  }

  function sendLoads(kind, from, to, cargo, t) {
    const n = Math.ceil(total(cargo) / OPS.truckCapacity);
    for (let i = 0; i < n; i++) {
      const part = {};
      for (const k of SKU_IDS) {
        const base = Math.floor(cargo[k] / n);
        part[k] = i === n - 1 ? cargo[k] - base * (n - 1) : base;
      }
      dispatchTruck(kind, from, to, part, t + i * 0.2);
    }
  }

  function noteStockout(h, k, t) {
    if (outNow[h][k]) return;
    outNow[h][k] = 1;
    stockouts.push({ hub: h, sku: k, t });
    const sku = SKUS.find((s) => s.id === k).name;
    log(t, 'bad', `${SITES[h].name} ran out of ${sku}`, h);
  }

  // ------------------------------------------------------------------ orders
  for (let day = 0; day * 24 <= horizon; day++) {
    for (const hr of OPS.orderHours) {
      const t = day * 24 + hr;
      if (t > horizon) continue;
      for (const c of CUSTOMER_IDS) {
        const lines = {};
        for (const k of SKU_IDS) {
          const m = noise ? clamp(1 + 0.15 * rngOrders.gauss(), 0.6, 1.5) : 1;
          const qty = Math.round((SITES[c].demand[k] / OPS.orderHours.length) * m);
          lines[k] = { qty, allocated: 0, delivered: 0 };
        }
        const o = {
          id: orders.length + 1, customer: c, critical: !!SITES[c].critical,
          placedAt: t, dueAt: t + OPS.dueAfter, lines, done: false, completeAt: null, allocatedAll: false,
        };
        orders.push(o);
        push(o.dueAt, 'DUE', { order: o });
      }
    }
  }

  const byFifo = (a, b) => a.placedAt - b.placedAt || (a.customer < b.customer ? -1 : 1);
  const byPriority = (a, b) => (b.critical - a.critical) || a.dueAt - b.dueAt || (a.customer < b.customer ? -1 : 1);

  function hubDispatch(t) {
    for (const h of HUB_IDS) {
      if (hubClosedAt(h, t)) continue;
      const mine = orders.filter((o) => !o.allocatedAll && o.placedAt <= t && assign[o.customer] === h);
      if (!mine.length) continue;
      mine.sort(prioritize ? byPriority : byFifo);
      // When rationing, keep half a day of hospital demand back from other customers.
      const reserve = zero();
      if (prioritize) {
        for (const c of CUSTOMER_IDS) {
          if (assign[c] === h && SITES[c].critical) for (const k of SKU_IDS) reserve[k] += 0.5 * SITES[c].demand[k];
        }
      }
      const loads = {};
      for (const o of mine) {
        for (const k of SKU_IDS) {
          const line = o.lines[k];
          const want = line.qty - line.allocated;
          if (want <= 0) continue;
          let avail = stock[h][k];
          if (prioritize && !o.critical) avail = Math.max(0, Math.floor(avail - reserve[k]));
          const give = Math.min(want, avail);
          if (give > 0) {
            stock[h][k] -= give;
            line.allocated += give;
            const L = (loads[o.customer] ||= { cargo: zero(), allocations: [] });
            L.cargo[k] += give;
            L.allocations.push({ order: o, sku: k, qty: give });
          }
          if (give < want && stock[h][k] < 1) noteStockout(h, k, t);
        }
        o.allocatedAll = SKU_IDS.every((k) => o.lines[k].allocated >= o.lines[k].qty);
      }
      for (const c of Object.keys(loads)) dispatchTruck('delivery', h, c, loads[c].cargo, t, loads[c].allocations);
    }
  }

  function portDispatch(t) {
    if (total(stock.port) < 1) return;
    const targets = HUB_IDS.filter((h) => !(reroute && hubClosedAt(h, t)));
    const need = {};
    for (const h of targets) {
      need[h] = {};
      for (const k of SKU_IDS) {
        need[h][k] = Math.max(0, SITES[h].targetDays * hubDaily(h, k) - stock[h][k] - inTransit[h][k]);
      }
    }
    for (const k of SKU_IDS) {
      const sum = targets.reduce((a, h) => a + need[h][k], 0);
      const f = sum > stock.port[k] ? stock.port[k] / sum : 1;
      for (const h of targets) need[h][k] = Math.floor(need[h][k] * f);
    }
    for (const h of targets) {
      if (total(need[h]) < 40) continue;
      for (const k of SKU_IDS) stock.port[k] -= need[h][k];
      sendLoads('replenish', 'port', h, need[h], t);
    }
  }

  // ------------------------------------------------------------ AI levers
  function rebalance(t) {
    const open = HUB_IDS.filter((h) => !hubClosedAt(h, t));
    const moves = {};
    for (const k of SKU_IDS) {
      const rate = (h) => hubDaily(h, k) / 24;
      const deficits = open
        .map((h) => ({ h, need: rate(h) * 54 - stock[h][k] - inTransit[h][k] }))
        .filter((x) => x.need > 1)
        .sort((a, b) => b.need - a.need);
      const donors = open
        .map((h) => ({ h, spare: stock[h][k] - rate(h) * 60 }))
        .filter((x) => x.spare > 1);
      for (const d of deficits) {
        donors.sort((a, b) => route(a.h, d.h).length - route(b.h, d.h).length);
        for (const s of donors) {
          if (s.h === d.h || d.need < 1 || s.spare < 1) continue;
          const qty = Math.floor(Math.min(d.need, s.spare));
          s.spare -= qty;
          d.need -= qty;
          const key = `${s.h}>${d.h}`;
          (moves[key] ||= zero())[k] += qty;
        }
      }
    }
    for (const key of Object.keys(moves)) {
      const cargo = moves[key];
      const units = total(cargo);
      if (units < 60) continue;
      const [a, b] = key.split('>');
      for (const k of SKU_IDS) stock[a][k] -= cargo[k];
      sendLoads('transfer', a, b, cargo, t);
      transferUnits += units;
      acts.transfers.push({ t, from: a, to: b, units });
      log(t, 'ai', `Moving ${units.toLocaleString('en-US')} units ${SITES[a].short} → ${SITES[b].short}`, b);
    }
  }

  function backupBatch(t) {
    const open = HUB_IDS.filter((h) => !hubClosedAt(h, t));
    const alloc = Object.fromEntries(open.map((h) => [h, zero()]));
    let units = 0;
    for (const k of SKU_IDS) {
      let left = Math.round(BACKUP.batch[k] * (noise ? clamp(1 + 0.1 * rngScen.gauss(), 0.8, 1.15) : 1));
      units += left;
      premiumCost += left * UNIT_COST[k] * BACKUP.premium;
      // water-fill: each chunk goes to the hub with the fewest hours of cover
      const cover = (h) => {
        const rate = hubDaily(h, k) / 24;
        return rate > 0 ? (stock[h][k] + inTransit[h][k] + alloc[h][k]) / rate : Infinity;
      };
      while (left > 0) {
        let best = open[0];
        for (const h of open) if (cover(h) < cover(best)) best = h;
        if (cover(best) === Infinity) break;
        const qty = Math.min(10, left);
        alloc[best][k] += qty;
        left -= qty;
      }
    }
    backupUnits += units;
    acts.batches.push({ t, units });
    // Small shares ride along with the biggest load, so every unit paid for is shipped.
    const big = open.reduce((a, b) => (total(alloc[b]) > total(alloc[a]) ? b : a));
    for (const h of open) {
      if (h === big || total(alloc[h]) >= 30) continue;
      for (const k of SKU_IDS) {
        alloc[big][k] += alloc[h][k];
        alloc[h][k] = 0;
      }
    }
    for (const h of open) if (total(alloc[h]) > 0) sendLoads('backup', 'backup', h, alloc[h], t);
    log(t, 'ai', `Ridgeway Labs shipped ${units.toLocaleString('en-US')} rush units`, 'backup');
  }

  function reassignFrom(hub, t) {
    const open = HUB_IDS.filter((h) => h !== hub && !hubClosedAt(h, t));
    for (const c of CUSTOMER_IDS) {
      if (assign[c] !== hub) continue;
      const best = open.reduce((a, b) => (route(a, c).length <= route(b, c).length ? a : b));
      assign[c] = best;
      reassigned.push({ customer: c, from: hub, to: best, t });
      log(t, 'ai', `${SITES[c].name} now served from ${SITES[best].name}`, c);
    }
  }

  // ----------------------------------------------------------------- vessel
  let berthFree = 0;
  const backlog = zero(); // cargo a supplier outage held back, shipped on later sailings
  for (let i = 0; ; i++) {
    const scheduled = VESSEL.firstArrival + i * VESSEL.every + (noise ? rngScen() * 3 - 1 : 0);
    if (scheduled > horizon) break;
    let arrive = Math.max(scheduled, berthFree);
    let held = false;
    if (sc && sc.type === 'port' && arrive >= sc.start && arrive < sc.end) {
      arrive = Math.max(sc.end, berthFree);
      held = true;
    }
    const share = sc && sc.type === 'supplier' && scheduled >= sc.start && scheduled < sc.end ? 0.25 : 1;
    const cargo = {};
    let extra = 0;
    for (const k of SKU_IDS) {
      const full = VESSEL.cargo[k];
      if (share < 1) {
        cargo[k] = Math.round(full * share);
        backlog[k] += full - cargo[k];
      } else {
        // once the outage is over, each sailing carries part of the backlog on top
        const add = Math.min(backlog[k], Math.round(full * VESSEL.catchUp));
        backlog[k] -= add;
        extra += add;
        cargo[k] = full + add;
      }
    }
    const v = {
      id: i + 1, scheduled, arrive, held, share, extra, cargo, unloadEnd: arrive + VESSEL.unloadHours,
    };
    berthFree = v.unloadEnd + 0.5;
    vessels.push(v);
    if (held) push(scheduled, 'HELD', { vessel: v });
    push(arrive, 'BERTH', { vessel: v });
    for (let p = 1; p <= 3; p++) push(arrive + (p * VESSEL.unloadHours) / 3, 'UNLOAD', { vessel: v, part: p });
  }

  // ------------------------------------------------------------- schedules
  for (let day = 0; day * 24 <= horizon; day++) {
    for (const hr of OPS.dispatchHours) push(day * 24 + hr, 'DISPATCH');
    for (const hr of OPS.portDispatchHours) push(day * 24 + hr, 'PORT');
  }
  if (sc) {
    push(sc.start, 'DSTART');
    push(sc.end, 'DEND');
  }
  if (plan) push(plan.at, 'PLAN');
  if (!light) for (let h = 0; h <= horizon; h++) push(h, 'SAMPLE');

  const series = {};
  if (!light) {
    for (const id of [...HUB_IDS, 'port']) {
      series[id] = Object.fromEntries(SKU_IDS.map((k) => [k, new Float32Array(horizon + 1)]));
    }
  }

  // ------------------------------------------------------------------- loop
  while (q.size) {
    const ev = q.pop();
    const t = ev.t;
    switch (ev.type) {
      case 'ARRIVE': {
        const s = ev.ship;
        if (s.allocations) {
          const touched = new Set();
          for (const a of s.allocations) {
            a.order.lines[a.sku].delivered += a.qty;
            touched.add(a.order);
          }
          for (const o of touched) {
            if (!o.done && SKU_IDS.every((k) => o.lines[k].delivered >= o.lines[k].qty)) {
              o.done = true;
              o.completeAt = t;
            }
          }
          if (SITES[s.to].critical) log(t, 'good', `Delivered ${total(s.cargo).toLocaleString('en-US')} units to ${SITES[s.to].name}`, s.to);
        } else if (stock[s.to]) {
          for (const k of SKU_IDS) {
            stock[s.to][k] += s.cargo[k];
            inTransit[s.to][k] -= s.cargo[k];
            if (outNow[s.to] && outNow[s.to][k] && stock[s.to][k] > 0) outNow[s.to][k] = 0;
          }
        }
        break;
      }
      case 'HELD':
        log(t, 'bad', `${VESSEL.name} held at anchor — cannot berth`, 'port');
        break;
      case 'BERTH': {
        const v = ev.vessel;
        const note = v.share < 1 ? ' (partial load)' : v.extra ? ' (incl. backlog)' : '';
        log(t, v.share < 1 ? 'warn' : 'info', `${VESSEL.name} berthed with ${total(v.cargo).toLocaleString('en-US')} units${note}`, 'port');
        break;
      }
      case 'UNLOAD': {
        const v = ev.vessel;
        for (const k of SKU_IDS) {
          const part = Math.floor(v.cargo[k] / 3);
          stock.port[k] += ev.part === 3 ? v.cargo[k] - 2 * part : part;
        }
        if (ev.part === 3) portDispatch(t);
        break;
      }
      case 'DSTART': {
        const text = {
          port: 'Port congestion: Bayport Terminal stops berthing ships',
          hub: `${SITES[sc.target]?.name} shuts down (power outage)`,
          bridge: 'Kell Bridge closed — trucks cannot use Harbor Road',
          supplier: 'Kestrel Pharma cuts shipments to 25%',
        }[sc.type];
        log(t, 'bad', text, sc.type === 'hub' ? sc.target : sc.type === 'bridge' ? null : 'port');
        if (reroute && sc.type === 'hub') reassignFrom(sc.target, t);
        break;
      }
      case 'DEND': {
        for (const r of reassigned) if (assign[r.customer] === r.to) assign[r.customer] = r.from;
        const text = {
          port: 'Bayport Terminal reopens for berthing',
          hub: `${SITES[sc.target]?.name} is back online`,
          bridge: 'Kell Bridge reopens',
          supplier: 'Kestrel Pharma back to full volume',
        }[sc.type];
        log(t, 'good', text, sc.type === 'hub' ? sc.target : null);
        break;
      }
      case 'PLAN': {
        acts.firstAt = t;
        prioritize = actions.has('prioritize');
        reroute = actions.has('reroute');
        if (actions.size) log(t, 'ai', 'AI recovery plan activated', null);
        if (reroute && sc && sc.type === 'hub' && hubClosedAt(sc.target, t)) reassignFrom(sc.target, t);
        // Levers stay active until the disruption is actually over (plus a day
        // of catch-up for rebalancing), like a planner cancelling rush orders
        // once the supplier confirms recovery.
        const until = sc ? Math.max(sc.end, t) : t;
        if (actions.has('rebalance')) {
          for (let tt = t + 0.25; tt < until + 24; tt += 12) push(tt, 'REBALANCE');
        }
        if (actions.has('backup')) {
          const lead = BACKUP.leadHours + (noise ? rngScen() * 4 - 1 : 0);
          for (let tt = t + lead; tt < until + 6; tt += BACKUP.batchEvery) push(tt, 'BACKUP');
        }
        if (prioritize) push(until + 24, 'RATION_END');
        if (reroute || prioritize) push(t + 0.5, 'DISPATCH');
        break;
      }
      case 'RATION_END':
        prioritize = false;
        log(t, 'ai', 'Hospitals-first rationing lifted — normal dispatch resumes', null);
        break;
      case 'DUE': {
        const o = ev.order;
        if (!o.done) {
          o.overdue = true;
          log(t, 'bad', `Order for ${SITES[o.customer].name} is overdue`, o.customer);
        }
        break;
      }
      case 'REBALANCE':
        rebalance(t);
        break;
      case 'BACKUP':
        backupBatch(t);
        break;
      case 'DISPATCH':
        hubDispatch(t);
        break;
      case 'PORT':
        portDispatch(t);
        break;
      case 'SAMPLE': {
        const h = Math.round(t);
        for (const id of [...HUB_IDS, 'port']) for (const k of SKU_IDS) series[id][k][h] = stock[id][k];
        break;
      }
      default:
        break;
    }
  }

  // ----------------------------------------------------------------- metrics
  const considered = orders.filter((o) => o.dueAt <= horizon);
  const late = considered.filter((o) => isLateOrder(o, horizon));
  const critLate = late.filter((o) => o.critical);
  let recoveredAt = null;
  if (late.length) recoveredAt = Math.max(...late.map((o) => o.completeAt ?? Infinity));
  const recovered = recoveredAt !== Infinity;
  const recoveryH = sc && late.length ? Math.max(0, (recovered ? recoveredAt : horizon) - sc.start) : 0;
  const penalties = critLate.length * OPS.latePenalty.critical
    + (late.length - critLate.length) * OPS.latePenalty.standard;
  const logistics = (movingHours + waitingHours) * OPS.truckCostPerHour;

  return {
    horizon, scenario: sc, plan, shipments, orders, vessels, events, stockouts, series, acts,
    metrics: {
      orders: considered.length,
      late: late.length,
      critLate: critLate.length,
      onTime: considered.length ? 1 - late.length / considered.length : 1,
      lateCustomers: [...new Set(late.map((o) => o.customer))],
      recoveryH,
      recovered,
      penalties,
      logistics,
      premiumCost,
      co2: movingHours * OPS.co2PerTruckHour,
      truckTrips: shipments.length,
      backupUnits,
      transferUnits,
      firstStockout: stockouts.find((s) => !sc || s.t >= sc.start) || null,
    },
  };
}
