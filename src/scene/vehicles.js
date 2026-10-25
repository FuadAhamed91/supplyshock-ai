// Trucks and the container ship, driven entirely by the simulation timeline.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { JUNCTIONS } from '../data/network.js';
import { cloneAsset, findMaterial } from './assets.js';
import { smoothPolyline, offsetPolyline, PathSampler, catmull } from './geometry.js';
import { icon } from '../ui/icons.js';
import { mulberry32 } from '../sim/rng.js';

export const TRUCK_COLORS = { normal: '#4F46E5', ai: '#16A34A' };
const isJunction = new Set(Object.values(JUNCTIONS).map(([x, z]) => `${x},${z}`));
const SEA_LEVEL = -0.55;

const truckEase = (f) => {
  const a = 0.1;
  if (f < a) return (f * f) / (2 * a * (1 - a));
  if (f > 1 - a) return 1 - ((1 - f) * (1 - f)) / (2 * a * (1 - a));
  return (f - a / 2) / (1 - a);
};

export class TruckLayer {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = new Map(); // shipment id -> truck
    this.paths = new Map();
    this.pos = { x: 0, z: 0, angle: 0 };
  }

  setRun(run) {
    this.run = run;
    this.paths.clear();
    for (const truck of this.active.values()) this.release(truck);
    this.active.clear();
  }

  path(s) {
    let p = this.paths.get(s.id);
    if (!p) {
      const smooth = smoothPolyline(s.points, (pt) => (isJunction.has(`${pt[0]},${pt[1]}`) ? 2.6 : 8), 8);
      p = new PathSampler(offsetPolyline(smooth, 0.8));
      this.paths.set(s.id, p);
    }
    return p;
  }

  acquire() {
    let truck = this.pool.pop();
    if (!truck) {
      const obj = cloneAsset('truck', ['TintTruck']);
      const tint = findMaterial(obj, 'TintTruck');
      const badge = document.createElement('div');
      badge.className = 'truck-badge';
      badge.innerHTML = icon('Clock', 11, 2.5);
      const badgeObj = new CSS2DObject(badge);
      badgeObj.position.set(0, 3, 0);
      obj.add(badgeObj);
      obj.traverse((o) => { if (o.isMesh) o.userData.truck = true; });
      truck = { obj, tint, badge, badgeObj, angle: 0 };
    }
    this.scene.add(truck.obj);
    truck.obj.visible = true;
    return truck;
  }

  release(truck) {
    truck.obj.visible = false;
    truck.badge.classList.remove('is-on');
    this.scene.remove(truck.obj);
    this.pool.push(truck);
  }

  update(t, dt = 1 / 60) {
    const run = this.run;
    if (!run) return;
    const turn = 1 - Math.exp(-dt * 14);
    const seen = new Set();
    const waitOrigin = new Map();
    const waitDest = new Map();
    for (const s of run.shipments) {
      if (t < s.created || t >= s.arrive + 0.15) continue;
      seen.add(s.id);
      let truck = this.active.get(s.id);
      if (!truck) {
        truck = this.acquire();
        truck.tint.color.set(s.kind === 'transfer' || s.kind === 'backup' ? TRUCK_COLORS.ai : TRUCK_COLORS.normal);
        truck.angle = null;
        this.active.set(s.id, truck);
      }
      const path = this.path(s);
      let dist;
      let waiting = false;
      if (t < s.depart) {
        const n = waitOrigin.get(s.from) || 0;
        waitOrigin.set(s.from, n + 1);
        dist = 2 + n * 4.2;
        waiting = s.depart - s.created > 0.3;
      } else if (t < s.arriveGate) {
        dist = path.length * truckEase((t - s.depart) / Math.max(1e-3, s.arriveGate - s.depart));
      } else if (t < s.arrive) {
        const n = waitDest.get(s.to) || 0;
        waitDest.set(s.to, n + 1);
        dist = Math.max(0, path.length - 7 - n * 4.2);
        waiting = true;
      } else {
        dist = path.length;
      }
      path.at(dist, this.pos);
      const o = truck.obj;
      o.position.set(this.pos.x, 0, this.pos.z);
      if (truck.angle === null) truck.angle = this.pos.angle;
      let da = this.pos.angle - truck.angle;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      truck.angle += da * turn;
      o.rotation.y = truck.angle;
      const appear = Math.min(1, (t - s.created) / 0.15);
      const vanish = Math.min(1, Math.max(0, (s.arrive + 0.15 - t) / 0.15));
      o.scale.setScalar(Math.max(0.001, Math.min(appear, vanish)));
      truck.badge.classList.toggle('is-on', waiting);
    }
    for (const [id, truck] of this.active) {
      if (!seen.has(id)) {
        this.release(truck);
        this.active.delete(id);
      }
    }
  }
}

const SHIP_IN = catmull([[-106, 36], [-86, 35], [-70, 31], [-64, 22], [-60.6, 12], [-60, 4]], 10);
const SHIP_OUT = catmull([[-60, 4], [-60.4, -6], [-64, -16], [-74, -23], [-106, -27]], 10);
// Held ships wait here: on the inbound route but east of the coastal lane.
const ANCHOR = [-66.5, 27];

const CLIP = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), 79.6),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), 55.6),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), 55.6),
];

// Wake: a fading V of foam behind the stern, as an alpha map (u: tail 0 -> stern 1, v: across).
let wakeShape = null;
function wakeTexture() {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const rng = mulberry32(5);
  const g = (d, s) => Math.exp(-(d * d) / (2 * s * s));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = 1 - x / (w - 1); // 0 at the stern, 1 at the tail
      const across = Math.abs(y / (h - 1) - 0.5);
      const arms = g(across - (0.07 + a * 0.36), 0.026 + a * 0.04);
      const wash = g(across, 0.05 + a * 0.1) * Math.exp(-a * 2.5);
      const fade = (1 - a) ** 1.2 * Math.min(1, a * 25);
      const v = Math.min(1, (arms + wash) * fade * (0.8 + rng() * 0.2)) * 255;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8; // stays crisp at the camera's low angle
  return tex;
}

function makeWake(scene, ship) {
  if (!wakeShape) {
    // the hull in the ship's own frame (+x is forward)
    const box = new THREE.Box3().setFromObject(cloneAsset('ship'));
    const len = box.max.x - box.min.x;
    const geometry = new THREE.PlaneGeometry(len * 1.8, len * 0.85).rotateX(-Math.PI / 2).translate(-len * 0.9, 0, 0);
    wakeShape = { geometry, texture: wakeTexture(), sternX: box.min.x + len * 0.04, midZ: (box.min.z + box.max.z) / 2 };
  }
  const mesh = new THREE.Mesh(wakeShape.geometry, new THREE.MeshBasicMaterial({
    color: '#FFFFFF', alphaMap: wakeShape.texture, transparent: true, opacity: 0, depthWrite: false, clippingPlanes: CLIP,
  }));
  mesh.visible = false;
  scene.add(mesh);
  ship.wake = { mesh, strength: 0 };
  ship.speed = 0;
}

const _stern = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
/**
 * Follow the ship's stern. The wake grows with `ship.speed` (board units per
 * simulated hour), so it holds while the clock is paused.
 */
function trailWake(ship) {
  const w = ship.wake;
  const o = ship.obj;
  const target = o.visible ? THREE.MathUtils.smoothstep(ship.speed, 0.5, 6) : 0;
  w.strength += (target - w.strength) * 0.08;
  const m = w.mesh;
  m.visible = o.visible && w.strength > 0.02;
  if (!m.visible) return;
  const s = o.scale.x;
  _stern.set(wakeShape.sternX * s, 0, wakeShape.midZ * s).applyAxisAngle(_up, o.rotation.y);
  m.position.set(o.position.x + _stern.x, SEA_LEVEL + 0.03, o.position.z + _stern.z);
  m.rotation.y = o.rotation.y;
  m.scale.set(s * (0.45 + 0.55 * w.strength), 1, s);
  m.material.opacity = 0.9 * w.strength;
}

/** A container ship whose materials are clipped at the board edge (it sails in "through" it). */
function makeShip(scene, { hull = null, scale = 1 } = {}) {
  const obj = cloneAsset('ship');
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const mats = [].concat(o.material).map((m) => {
      const c = m.clone();
      c.clippingPlanes = CLIP;
      if (hull && c.name === 'HullTop') c.color.set(hull);
      return c;
    });
    o.material = mats.length === 1 ? mats[0] : mats;
  });
  obj.scale.setScalar(scale);
  obj.visible = false;
  scene.add(obj);
  const bays = ['a', 'b', 'c', 'd', 'e'].map((k) => obj.getObjectByName(`ship_cargo_${k}`)).filter(Boolean);
  const ship = { obj, bays, shown: 0 };
  makeWake(scene, ship);
  return ship;
}

// ------------------------------------------------------------- ship traffic
// Ships follow simple harbour rules so no two hulls ever share water:
//  * the cargo lane is a queue: a ship never closes within BERTH_SEP of the one
//    ahead of it, so a ship waits for the berth instead of docking on top of the
//    one still unloading;
//  * the coastal ship sails its own lane and yields to cargo crossing it;
//  * everything that waits (the anchorage, the anchored freighter, the queue
//    that forms when the port is closed) sits clear of both lanes.
// Positions are pure functions of the clock, so the timeline can be scrubbed.
const APPROACH = 6;       // hours to sail in from the board edge
const LEG = 2;            // hours from the anchorage to the berth
const DEPART = 5;         // hours to sail out and clear the board
const BERTH_SEP = 26;     // centre-to-centre gap kept between cargo ships in the lane
const LANE_X = -77.4;     // the coastal ship's lane, close to the board's sea edge
const LANE_SPEED = 160 / 30;
const LANE_STEP = 0.05;   // hours per entry in the coastal ship's precomputed track
const easeOut = (f) => 1 - (1 - f) ** 2;

/** Hull footprint (length and beam, in world units) of a ship at its current scale. */
function hullSize(ship) {
  const o = ship.obj;
  const keep = [o.position.clone(), o.rotation.y, o.visible];
  o.position.set(0, 0, 0);
  o.rotation.set(0, 0, 0);
  o.visible = true;
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  o.position.copy(keep[0]);
  o.rotation.y = keep[1];
  o.visible = keep[2];
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  return { hl: size.x / 2, hb: size.z / 2, cx: c.x, cz: c.z };
}

/** Oriented rectangle of a hull in the sea plane. Vehicles face +X locally. */
function hullRect(x, z, angle, size, grow = 0) {
  const ax = [Math.cos(angle), -Math.sin(angle)];
  const az = [Math.sin(angle), Math.cos(angle)];
  return {
    c: [x + ax[0] * size.cx + az[0] * size.cz, z + ax[1] * size.cx + az[1] * size.cz],
    ax, az, hl: size.hl + grow, hb: size.hb,
  };
}

/** Separating-axis test for two oriented rectangles. */
function hullsTouch(a, b) {
  for (const axis of [a.ax, a.az, b.ax, b.az]) {
    const reach = (r) => Math.abs(r.hl * (r.ax[0] * axis[0] + r.ax[1] * axis[1])) + Math.abs(r.hb * (r.az[0] * axis[0] + r.az[1] * axis[1]));
    const gap = Math.abs((b.c[0] - a.c[0]) * axis[0] + (b.c[1] - a.c[1]) * axis[1]);
    if (gap >= reach(a) + reach(b)) return false;
  }
  return true;
}

/** Background shipping: a coastal ship in its lane, one at anchor, and a queue when the port is congested. */
export class AmbientShips {
  constructor(scene, cargo) {
    this.cargo = cargo;
    this.passer = makeShip(scene, { hull: '#1F4E5A', scale: 0.78 });
    this.anchored = makeShip(scene, { hull: '#3A3F6E', scale: 0.72 });
    // `from` is how far each queued ship steams in along its own heading, from behind.
    this.queue = [
      { ship: makeShip(scene, { hull: '#4A3B5C', scale: 0.7 }), x: -64, z: 48, ry: 1.9, from: 10 },
      { ship: makeShip(scene, { hull: '#2E4A3A', scale: 0.7 }), x: -69, z: 13, ry: 1.35, from: 5 },
    ];
    this.passerSize = hullSize(this.passer);
    this.lane = null;
    this.laneRun = undefined;
  }

  /**
   * The coastal ship's position along its lane for the whole run, sampled every
   * LANE_STEP hours. Cargo crosses its lane from the side, so looking ahead along
   * the lane is not enough: at every step it projects its own course against
   * where the cargo ships will be over the next few hours, and picks the first
   * speed that keeps clear — cruise, ease off, stop, or hurry through.
   */
  buildLane(run) {
    this.laneRun = run;
    if (!run) { this.lane = null; return; }
    const steps = Math.ceil(run.horizon / LANE_STEP) + 2;
    const look = Math.ceil(6 / LANE_STEP); // hours of foresight, in steps
    const every = 5;                       // check the forecast every 0.25 h
    const hulls = [];
    for (let i = 0; i <= steps + look; i++) {
      hulls.push(this.cargo.poses(i * LANE_STEP).map((p) => hullRect(p.x, p.z, p.angle, this.cargo.size)));
    }
    const meets = (z, i) => {
      const me = hullRect(LANE_X, z, -Math.PI / 2, this.passerSize, 1.5);
      return hulls[i].some((h) => hullsTouch(me, h));
    };
    /** Steps until holding speed v runs into cargo (Infinity if it never does within the forecast). */
    const firstHit = (z, i, v) => {
      for (let k = 0; k <= look; k += every) if (meets(z + v * k * LANE_STEP, i + k)) return k;
      return Infinity;
    };
    const lane = new Float32Array(steps);
    let z = -80 + 160 * 0.15;
    let v = LANE_SPEED;
    for (let i = 0; i < steps; i++) {
      lane[i] = z;
      let target = null;
      let latest = -1;
      for (const k of [1, 0.5, 0.2, 0, 1.6]) {
        const hit = firstHit(z, i, LANE_SPEED * k);
        if (hit === Infinity) { target = k; break; }
        if (hit > latest) { latest = hit; target = k; } // no clean option: put the meeting off longest
      }
      // ships don't stop dead: change speed over a few steps
      const dv = LANE_SPEED * target - v;
      v += Math.max(-0.3 * LANE_SPEED, Math.min(0.3 * LANE_SPEED, dv));
      z += v * LANE_STEP;
      if (z > 80) z -= 160; // off the north edge, back in from the south (both out of view)
    }
    this.lane = lane;
  }

  /** Lane position (and speed, for the wake) at time t. */
  laneAt(t) {
    if (!this.lane) return { z: -80 + 160 * ((t / 30 + 0.15) % 1), speed: LANE_SPEED };
    const f = Math.max(0, Math.min(this.lane.length - 1.001, t / LANE_STEP));
    const i = Math.floor(f);
    const a = this.lane[i];
    const b = this.lane[i + 1];
    if (b < a - 100) return { z: b, speed: LANE_SPEED }; // the wrap: no tween across the board
    return { z: a + (b - a) * (f - i), speed: (b - a) / LANE_STEP };
  }

  update(t, time, congested) {
    if (this.laneRun !== this.cargo.run) this.buildLane(this.cargo.run);
    const bob = (o, k) => {
      o.position.y = SEA_LEVEL + Math.sin(time * 0.8 + k) * 0.05;
      o.rotation.z = Math.sin(time * 1.1 + k) * 0.01;
    };
    const lane = this.laneAt(t);
    const p = this.passer.obj;
    p.visible = true;
    p.position.set(LANE_X, SEA_LEVEL, lane.z);
    p.rotation.y = -Math.PI / 2;
    this.passer.speed = lane.speed;
    bob(p, 1);
    const a = this.anchored.obj;
    a.visible = true;
    a.position.set(-64, SEA_LEVEL, -45); // clear of the coastal lane and the outbound route
    a.rotation.y = 0.45;
    bob(a, 2);
    this.queue.forEach((q, i) => {
      q.ship.shown += ((congested ? 1 : 0) - q.ship.shown) * 0.04;
      q.ship.speed = congested ? (1 - q.ship.shown) * 30 : 0; // steaming in to join the queue
      const o = q.ship.obj;
      o.visible = q.ship.shown > 0.02;
      if (!o.visible) return;
      const back = (1 - q.ship.shown) * q.from;
      o.position.set(q.x - Math.cos(q.ry) * back, SEA_LEVEL, q.z + Math.sin(q.ry) * back);
      o.rotation.y = q.ry;
      o.scale.setScalar(0.7 * Math.min(1, q.ship.shown * 1.2));
      bob(o, 3 + i);
    });
    for (const ship of [this.passer, this.anchored, ...this.queue.map((q) => q.ship)]) trailWake(ship);
  }
}

export class ShipLayer {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.inPath = new PathSampler(SHIP_IN);
    this.outPath = new PathSampler(SHIP_OUT);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < SHIP_IN.length; i++) {
      const d = Math.hypot(SHIP_IN[i][0] - ANCHOR[0], SHIP_IN[i][1] - ANCHOR[1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.anchorS = this.inPath.cum[best];
    // Three hulls: after a closure the backlog arrives back to back, and the one
    // unloading, the one waiting and the one sailing in can all be on screen.
    this.ships = [0, 1, 2].map(() => makeShip(scene));
    this.size = hullSize(this.ships[0]);
    this.p = { x: 0, z: 0, angle: 0 };
    this.plan = [];
  }

  setRun(run) {
    this.run = run;
    // Dock times for one berth: a ship docks at its arrival, or once the ship
    // before it has sailed BERTH_SEP clear, whichever is later. Unloading still
    // ends when the simulation says it does.
    const L = this.outPath.length;
    const clearAfter = DEPART * (1 - Math.sqrt(Math.max(0, 1 - BERTH_SEP / L)));
    let prevClear = -Infinity;
    this.plan = (run ? [...run.vessels] : [])
      .sort((a, b) => a.arrive - b.arrive)
      .map((v) => {
        const dock = Math.max(v.arrive, prevClear);
        const depart = Math.max(v.unloadEnd, dock);
        prevClear = depart + clearAfter;
        return { v, dock, depart };
      });
  }

  /**
   * Every vessel on the board at time t, in lane order, as a pure function of
   * the clock. `lane` is the distance along the whole route (in, then out),
   * which is what the spacing rule is measured on.
   */
  poses(t) {
    const out = [];
    const inL = this.inPath.length;
    const outL = this.outPath.length;
    let ahead = Infinity; // lane position of the ship in front
    for (const p of this.plan) {
      const { v, dock, depart } = p;
      const startIn = (v.held ? v.scheduled : dock) - APPROACH;
      if (t < startIn || t > depart + DEPART) continue;
      let lane;
      let speed;
      let atAnchor = false;
      if (t >= depart) {
        const f = (t - depart) / DEPART;
        lane = inL + outL * easeOut(f);
        speed = (2 * outL * (1 - f)) / DEPART;
      } else if (v.held && t < dock - LEG) {
        const f = Math.min(1, (t - startIn) / APPROACH);
        lane = this.anchorS * easeOut(f);
        speed = (2 * this.anchorS * (1 - f)) / APPROACH;
        atAnchor = f >= 1;
      } else {
        const from = v.held ? this.anchorS : 0;
        const dur = v.held ? LEG : APPROACH;
        const f = Math.min(1, Math.max(0, (t - (dock - dur)) / dur));
        lane = from + (inL - from) * easeOut(f);
        speed = (2 * (inL - from) * (1 - f)) / dur;
      }
      if (lane > ahead - BERTH_SEP) { lane = ahead - BERTH_SEP; speed = 0; } // wait your turn
      ahead = lane;
      const onIn = lane <= inL;
      (onIn ? this.inPath : this.outPath).at(onIn ? Math.max(0, lane) : lane - inL, this.p);
      const unload = t < dock ? 0 : Math.min(1, (t - dock) / Math.max(1e-3, depart - dock));
      out.push({ v, x: this.p.x, z: this.p.z, angle: this.p.angle, speed, unload, atAnchor: atAnchor && lane >= this.anchorS - 0.01 });
    }
    return out;
  }

  update(t, time) {
    if (!this.run) return;
    const poses = this.poses(t);
    let heldPos = null;
    this.ships.forEach((ship, i) => {
      const p = poses[i];
      if (!p) { ship.obj.visible = false; return; }
      ship.speed = p.speed;
      ship.obj.visible = true;
      ship.obj.position.set(p.x, SEA_LEVEL + Math.sin(time * 0.9 + i) * 0.05, p.z);
      ship.obj.rotation.set(0, p.angle, Math.sin(time * 1.3 + i) * 0.012);
      if (p.atAnchor) heldPos = [p.x, p.z];
      // cargo bays empty out while unloading
      const loaded = Math.ceil(ship.bays.length * p.v.share - 1e-6);
      const visible = Math.round(loaded * (1 - p.unload));
      ship.bays.forEach((b, k) => { b.visible = k >= ship.bays.length - visible; });
    });
    for (const ship of this.ships) trailWake(ship);
    this.effects.setAnchorAlarm(heldPos);
  }
}
