// Read-only views of a simulation run at a moment in time (for the map and panels).
import { SITES, HUB_IDS, CUSTOMER_IDS, SKU_IDS, SKUS, VESSEL } from '../data/network.js';

export const LOW_COVER = 0.5; // days of stock below which a hub counts as at risk

export const dailyDemand = (hub, sku) => CUSTOMER_IDS.reduce(
  (a, c) => a + (SITES[c].hub === hub ? SITES[c].demand[sku] : 0), 0,
);

/** Stock of one SKU at a site at time t (hourly samples). */
export function stockAt(run, site, sku, t) {
  const s = run.series[site]?.[sku];
  if (!s) return 0;
  return s[Math.max(0, Math.min(s.length - 1, Math.floor(t)))];
}

export function disruptionActive(run, t) {
  const sc = run.scenario;
  return !!sc && t >= sc.start && t < sc.end;
}

export function hubState(run, hub, t) {
  const sc = run.scenario;
  const cover = {};
  let minCover = Infinity;
  let out = false;
  for (const k of SKU_IDS) {
    const d = dailyDemand(hub, k);
    const s = stockAt(run, hub, k, t);
    cover[k] = d ? s / d : Infinity;
    minCover = Math.min(minCover, cover[k]);
    if (d && s < 1) out = true;
  }
  const closed = sc && sc.type === 'hub' && sc.target === hub && t >= sc.start && t < sc.end;
  // Hubs dip to ~0.6 days right after a normal dispatch run, so "at risk" starts
  // below half a day: a calm week never shows false alarms.
  let tone = 'ok';
  if (closed) tone = 'disrupted';
  else if (out) tone = 'bad';
  else if (minCover < LOW_COVER) tone = 'warn';
  const outSku = SKUS.find((s) => cover[s.id] * dailyDemand(hub, s.id) < 1);
  const meta = closed ? 'Offline · power outage'
    : out ? `Out of ${outSku ? outSku.name.toLowerCase() : 'stock'}`
      : `${minCover.toFixed(1)} days of stock`;
  return { tone, cover, minCover, meta, closed };
}

export function customerState(run, c, t) {
  let overdue = 0;
  let atRisk = 0;
  let delivered = 0;
  for (const o of run.orders) {
    if (o.customer !== c || o.placedAt > t) continue;
    const open = o.completeAt === null || o.completeAt > t;
    if (!open) { delivered++; continue; }
    if (o.dueAt <= t) overdue++;
    else if (o.dueAt - t < 8) atRisk++;
  }
  const tone = overdue ? 'bad' : atRisk ? 'warn' : 'ok';
  const meta = overdue ? `${overdue} order${overdue > 1 ? 's' : ''} overdue`
    : atRisk ? 'Delivery at risk' : 'On schedule';
  return { tone, meta, overdue, atRisk, delivered };
}

export function portState(run, t) {
  const sc = run.scenario;
  const congested = sc && sc.type === 'port' && t >= sc.start && t < sc.end;
  const unloading = run.vessels.find((v) => t >= v.arrive && t < v.unloadEnd);
  const held = run.vessels.find((v) => v.held && t >= v.scheduled && t < v.arrive);
  const next = run.vessels.find((v) => v.arrive > t);
  let meta;
  if (unloading) meta = `Unloading ${Math.round(SKU_IDS.reduce((a, k) => a + unloading.cargo[k], 0)).toLocaleString('en-US')} units`;
  else if (held) meta = 'Ship held at anchor';
  else if (congested) meta = 'Congested · no berthing';
  else if (next) meta = `Next ship ${fmtTime(next.arrive)}`;
  else meta = 'No ships scheduled';
  const supplierCut = sc && sc.type === 'supplier' && t >= sc.start && t < sc.end;
  const tone = congested || held ? 'disrupted' : supplierCut ? 'warn' : 'ok';
  return { tone, meta };
}

export function backupState(run, t) {
  const batches = run.acts?.batches || [];
  if (!batches.length) return { tone: 'idle', meta: 'Standby · local backup', producing: false };
  const first = batches[0].t - 8;
  const last = batches[batches.length - 1].t;
  const producing = t >= first && t <= last + 0.5;
  const shipped = batches.filter((b) => b.t <= t).reduce((a, b) => a + b.units, 0);
  if (producing) return { tone: 'ai', meta: shipped ? `Rush orders · ${shipped.toLocaleString('en-US')} shipped` : 'Starting rush production', producing };
  if (t > last) return { tone: 'ai', meta: `Delivered ${shipped.toLocaleString('en-US')} rush units`, producing: false };
  return { tone: 'idle', meta: 'Standby · local backup', producing: false };
}

export function kpisAt(run, t) {
  let due = 0;
  let late = 0;
  let critLate = 0;
  for (const o of run.orders) {
    if (o.dueAt > t) continue;
    due++;
    const lateNow = o.completeAt === null || o.completeAt > o.dueAt + 1e-6;
    if (lateNow) {
      late++;
      if (o.critical) critLate++;
    }
  }
  let trucks = 0;
  let aiTrucks = 0;
  for (const s of run.shipments) {
    if (t >= s.created && t < s.arrive) {
      trucks++;
      if (s.kind === 'transfer' || s.kind === 'backup') aiTrucks++;
    }
  }
  let cover = 0;
  for (const h of HUB_IDS) cover += hubState(run, h, t).minCover;
  return {
    onTime: due ? 1 - late / due : 1, due, late, critLate, trucks, aiTrucks,
    cover: cover / HUB_IDS.length,
  };
}

export function eventsUntil(run, t, n = 6) {
  const out = [];
  for (let i = run.events.length - 1; i >= 0 && out.length < n; i--) {
    if (run.events[i].t <= t) out.push(run.events[i]);
  }
  return out;
}

export const vesselName = VESSEL.name;

/** Orders that are overdue and still undelivered, hour by hour. */
export function overdueSeries(run) {
  const H = run.horizon;
  const arr = new Float32Array(H + 1);
  for (const o of run.orders) {
    const end = o.completeAt ?? Infinity;
    if (end <= o.dueAt + 1e-6) continue;
    for (let h = Math.ceil(o.dueAt); h <= Math.min(H, Math.floor(end)); h++) arr[h]++;
  }
  return arr;
}

export function fmtTime(t, withDay = true) {
  const mins = Math.floor(t * 60 + 1e-6); // the epsilon keeps 14.2 h at 14:12, not 14:11
  const day = Math.floor(mins / 1440) + 1;
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return withDay ? `Day ${day} · ${hm}` : hm;
}
