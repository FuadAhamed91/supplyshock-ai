// Trucks and the container ship, driven entirely by the simulation timeline.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { JUNCTIONS } from '../data/network.js';
import { cloneAsset, findMaterial } from './assets.js';
import { smoothPolyline, offsetPolyline, PathSampler, catmull } from './geometry.js';
import { icon } from '../ui/icons.js';

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
const ANCHOR = [-70, 31];

const CLIP = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), 79.6),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), 55.6),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), 55.6),
];

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
  return { obj, bays, shown: 0 };
}

/** Background shipping: a ship passing in the lane, one at anchor, and a queue when the port is congested. */
export class AmbientShips {
  constructor(scene) {
    this.passer = makeShip(scene, { hull: '#1F4E5A', scale: 0.78 });
    this.anchored = makeShip(scene, { hull: '#3A3F6E', scale: 0.72 });
    this.queue = [
      { ship: makeShip(scene, { hull: '#4A3B5C', scale: 0.7 }), x: -66, z: 46, ry: 1.9 },
      { ship: makeShip(scene, { hull: '#2E4A3A', scale: 0.7 }), x: -71, z: 13, ry: 1.35 },
    ];
  }

  update(t, time, congested) {
    const bob = (o, k) => {
      o.position.y = SEA_LEVEL + Math.sin(time * 0.8 + k) * 0.05;
      o.rotation.z = Math.sin(time * 1.1 + k) * 0.01;
    };
    const f = (t / 30 + 0.15) % 1;
    const p = this.passer.obj;
    p.visible = true;
    p.position.set(-77.4, SEA_LEVEL, -80 + 160 * f);
    p.rotation.y = -Math.PI / 2;
    bob(p, 1);
    const a = this.anchored.obj;
    a.visible = true;
    a.position.set(-71, SEA_LEVEL, -42);
    a.rotation.y = 0.45;
    bob(a, 2);
    this.queue.forEach((q, i) => {
      q.ship.shown += ((congested ? 1 : 0) - q.ship.shown) * 0.04;
      const o = q.ship.obj;
      o.visible = q.ship.shown > 0.02;
      if (!o.visible) return;
      o.position.set(q.x - (1 - q.ship.shown) * 20, SEA_LEVEL, q.z);
      o.rotation.y = q.ry;
      o.scale.setScalar(0.7 * Math.min(1, q.ship.shown * 1.2));
      bob(o, 3 + i);
    });
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
    this.ships = [0, 1].map(() => makeShip(scene));
    this.p = { x: 0, z: 0, angle: 0 };
    this.held = null;
  }

  setRun(run) { this.run = run; }

  place(ship, sampler, s, time) {
    sampler.at(s, this.p);
    ship.obj.visible = true;
    ship.obj.position.set(this.p.x, SEA_LEVEL + Math.sin(time * 0.9) * 0.05, this.p.z);
    ship.obj.rotation.set(0, this.p.angle, Math.sin(time * 1.3) * 0.012);
  }

  update(t, time) {
    const run = this.run;
    if (!run) return;
    let used = 0;
    let heldPos = null;
    const L = this.inPath.length;
    const ease = (f) => 1 - (1 - f) ** 2;
    for (const v of run.vessels) {
      if (used >= this.ships.length) break;
      const approach = 6;
      const startIn = (v.held ? v.scheduled : v.arrive) - approach;
      if (t < startIn || t > v.unloadEnd + 6) continue;
      const ship = this.ships[used++];
      if (v.held && t < v.arrive - 2) {
        // sail to the anchorage, then wait
        const f = Math.min(1, (t - startIn) / approach);
        this.place(ship, this.inPath, this.anchorS * ease(f), time);
        if (f >= 1) heldPos = [this.p.x, this.p.z];
      } else if (t < v.arrive) {
        const from = v.held ? this.anchorS : 0;
        const dur = v.held ? 2 : approach;
        const f = Math.min(1, Math.max(0, (t - (v.arrive - dur)) / dur));
        this.place(ship, this.inPath, from + (L - from) * ease(f), time);
      } else if (t < v.unloadEnd) {
        this.place(ship, this.inPath, L, time);
      } else {
        const f = Math.min(1, (t - v.unloadEnd) / 6);
        this.place(ship, this.outPath, this.outPath.length * f * f, time);
      }
      // cargo bays empty out while unloading
      const loaded = Math.ceil(ship.bays.length * v.share - 1e-6);
      const unload = t < v.arrive ? 0 : Math.min(1, (t - v.arrive) / (v.unloadEnd - v.arrive));
      const visible = Math.round(loaded * (1 - unload));
      ship.bays.forEach((b, i) => { b.visible = i >= ship.bays.length - visible; });
    }
    for (let i = used; i < this.ships.length; i++) this.ships[i].obj.visible = false;
    this.effects.setAnchorAlarm(heldPos);
  }
}
