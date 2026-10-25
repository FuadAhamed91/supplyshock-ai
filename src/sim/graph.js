// Road network: shortest paths between sites, optionally avoiding closed roads.
import { JUNCTIONS, ROADS, SITES } from '../data/network.js';

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function polyLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

// Road geometry as point lists (a -> b), used by both the router and the 3D map.
export const ROAD_POINTS = Object.fromEntries(
  ROADS.map((r) => [r.id, [JUNCTIONS[r.a], ...(r.via || []), JUNCTIONS[r.b]]]),
);
const ROAD_LEN = Object.fromEntries(ROADS.map((r) => [r.id, polyLength(ROAD_POINTS[r.id])]));

const ADJ = {};
for (const r of ROADS) {
  (ADJ[r.a] ||= []).push({ to: r.b, road: r.id, len: ROAD_LEN[r.id], fwd: true });
  (ADJ[r.b] ||= []).push({ to: r.a, road: r.id, len: ROAD_LEN[r.id], fwd: false });
}

function dijkstra(from, to, blocked) {
  const best = { [from]: 0 };
  const prev = {};
  const open = new Set([from]);
  while (open.size) {
    let cur = null;
    for (const n of open) if (cur === null || best[n] < best[cur]) cur = n;
    open.delete(cur);
    if (cur === to) break;
    for (const e of ADJ[cur] || []) {
      if (blocked && blocked.has(e.road)) continue;
      const d = best[cur] + e.len;
      if (best[e.to] === undefined || d < best[e.to]) {
        best[e.to] = d;
        prev[e.to] = { node: cur, edge: e };
        open.add(e.to);
      }
    }
  }
  if (best[to] === undefined) return null;
  const legs = [];
  for (let n = to; n !== from; n = prev[n].node) legs.unshift(prev[n].edge);
  return legs;
}

const cache = new Map();

/**
 * Route between two sites. Returns { points, roads, length } where points is the
 * full polyline from the origin dock to the destination dock, or null if the
 * destination is unreachable with the given roads closed.
 */
export function route(fromSite, toSite, blocked = null) {
  const key = `${fromSite}>${toSite}|${blocked ? [...blocked].sort().join(',') : ''}`;
  if (cache.has(key)) return cache.get(key);
  const A = SITES[fromSite];
  const B = SITES[toSite];
  const legs = A.access === B.access ? [] : dijkstra(A.access, B.access, blocked);
  let result = null;
  if (legs) {
    const points = [A.dock, JUNCTIONS[A.access]];
    for (const leg of legs) {
      const pts = ROAD_POINTS[leg.road];
      const seq = leg.fwd ? pts : [...pts].reverse();
      points.push(...seq.slice(1));
    }
    points.push(B.dock);
    result = { points, roads: legs.map((l) => l.road), length: polyLength(points) };
  }
  cache.set(key, result);
  return result;
}

export const usesRoad = (r, roadId) => !!r && r.roads.includes(roadId);
