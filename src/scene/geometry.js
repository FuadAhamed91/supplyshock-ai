// Path helpers shared by roads, rivers and vehicles (all on the ground plane).
import * as THREE from 'three';

/**
 * Round the corners of a polyline [[x,z],...] with quadratic arcs.
 * `radius` is a number or a function (point) => radius for per-corner control.
 */
export function smoothPolyline(pts, radius = 3, steps = 6) {
  if (pts.length < 3) return pts.map((p) => [...p]);
  const out = [[...pts[0]]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const [cx, cz] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, bz - az);
    const l2 = Math.hypot(cx - bx, cz - bz);
    const r = Math.min(typeof radius === 'function' ? radius(pts[i]) : radius, l1 / 2, l2 / 2);
    if (r < 0.05) { out.push([bx, bz]); continue; }
    const p0 = [bx - ((bx - ax) / l1) * r, bz - ((bz - az) / l1) * r];
    const p2 = [bx + ((cx - bx) / l2) * r, bz + ((cz - bz) / l2) * r];
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      out.push([a * p0[0] + b * bx + c * p2[0], a * p0[1] + b * bz + c * p2[1]]);
    }
  }
  out.push([...pts[pts.length - 1]]);
  // drop near-duplicate points
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-4);
}

/** Catmull-Rom resample for organic shapes (rivers, coastlines). */
export function catmull(pts, segmentsPer = 8) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  return curve.getPoints(pts.length * segmentsPer).map((v) => [v.x, v.z]);
}

/** Shift a polyline sideways; positive = right of travel direction. */
export function offsetPolyline(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / l) * d, p[1] + (dx / l) * d];
  });
}

/** Arc-length lookup for a polyline. */
export class PathSampler {
  constructor(pts) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    this.length = this.cum[this.cum.length - 1];
  }
  /** Writes position into out {x,z,angle} for distance s along the path. */
  at(s, out) {
    const { pts, cum } = this;
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const u = (s - cum[lo]) / seg;
    const a = pts[lo];
    const b = pts[hi];
    out.x = a[0] + (b[0] - a[0]) * u;
    out.z = a[1] + (b[1] - a[1]) * u;
    out.angle = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    return out;
  }
}

/**
 * Flat ribbon along a polyline at height y. UV: u across (0..1), v along the
 * path in world units / vScale (for dashes and scrolling flow).
 */
export function ribbonGeometry(pts, width, y = 0, vScale = 1) {
  const pos = [];
  const uv = [];
  const idx = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [x, z] = pts[i];
    pos.push(x - (nx * width) / 2, y, z - (nz * width) / 2, x + (nx * width) / 2, y, z + (nz * width) / 2);
    uv.push(0, along / vScale, 1, along / vScale);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k); // counter-clockwise from above
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Distance from point to polyline. */
export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (ax + dx * u), z - (az + dz * u)));
  }
  return best;
}

/** Intersection of two segments, or null. */
export function segmentIntersection(p, p2, q, q2) {
  const r = [p2[0] - p[0], p2[1] - p[1]];
  const s = [q2[0] - q[0], q2[1] - q[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
  const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p[0] + r[0] * t, z: p[1] + r[1] * t, dir: Math.atan2(-r[1], r[0]) };
}
