// MapView: the interactive 3D digital twin. The app hands it a simulation run
// and a clock; everything on the board (trucks, ship, stock piles, labels,
// flows) is derived from that run at that moment.
import * as THREE from 'three';
import { SITES, JUNCTIONS, ROADS, HUB_IDS, CUSTOMER_IDS } from '../data/network.js';
import {
  backupState, hubState, customerState, LOW_COVER,
} from '../sim/query.js';
import { route } from '../sim/graph.js';
import { createWorld } from './world.js';
import { loadAssets } from './assets.js';
import { buildTerrain } from './terrain.js';
import { buildSites, updateSites, animateSites, RING_R } from './sites.js';
import { Effects } from './effects.js';
import { TruckLayer, ShipLayer, AmbientShips } from './vehicles.js';

const ROAD_BY_ID = Object.fromEntries(ROADS.map((r) => [r.id, r]));
const FOCUS_DIST = { port: 95, hub: 70, supplier: 70, hospital: 60, clinic: 55, pharmacy: 55, carehome: 55 };

export class MapView {
  constructor() {
    this.ui = { selected: null, hover: null };
    this.time = 0;
    this.lastQ = null;
    this.handlers = { select: () => {}, hover: () => {} };
    this.timers = [];
  }

  async init(container, onProgress) {
    this.container = container;
    this.world = createWorld(container);
    await loadAssets(onProgress);
    const { scene } = this.world;
    this.terrain = buildTerrain(scene);
    this.sites = buildSites(scene);
    this.effects = new Effects(scene, this.terrain.roadPaths, this.terrain.bridges);
    this.trucks = new TruckLayer(scene);
    this.ships = new ShipLayer(scene, this.effects);
    this.ambient = new AmbientShips(scene);
    this.setupPicking();
  }

  on(event, fn) { this.handlers[event] = fn; }

  setupPicking() {
    const el = this.world.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    const pick = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.world.camera);
      const hit = ray.intersectObjects(this.sites.hitTargets, false)[0];
      return hit ? hit.object.userData.site : null;
    };
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      this.setHover(pick(e));
    });
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      this.handlers.select(pick(e));
    });
    for (const [id, s] of Object.entries(this.sites.sites)) {
      s.label.addEventListener('click', (e) => { e.stopPropagation(); this.handlers.select(id); });
      s.label.addEventListener('mouseenter', () => this.setHover(id));
      s.label.addEventListener('mouseleave', () => this.setHover(null));
    }
  }

  setHover(id) {
    if (this.ui.hover === id) return;
    this.ui.hover = id;
    this.world.renderer.domElement.style.cursor = id ? 'pointer' : '';
    this.lastQ = null;
    this.handlers.hover(id);
  }

  setSelected(id) {
    this.ui.selected = id;
    this.lastQ = null;
  }

  setRun(run) {
    this.run = run;
    this.trucks.setRun(run);
    this.ships.setRun(run);
    this._ai = null;
    this.lastQ = null;
  }

  setScenario(sc, sub = '') {
    this.scenario = sc;
    this.beaconSub = sub;
    if (!sc) {
      this.effects.setBeacon(null);
      return;
    }
    this.effects.setBeacon({ ...beaconFor(sc, this.terrain.bridges), sub });
  }

  focusSite(id) {
    const s = SITES[id];
    if (!s) return;
    this.world.flyTo(new THREE.Vector3(s.pos[0], 0, s.pos[1]), FOCUS_DIST[s.type]);
  }

  focusScenario(sc) {
    const b = beaconFor(sc, this.terrain.bridges);
    this.world.flyTo(new THREE.Vector3(b.x, 0, b.z), b.focus || 80);
  }

  home(duration) { this.world.home(duration); }

  /** Shockwave from `origin` ({x, z}), then each affected site lights up in turn. */
  ripple(origin, affected, color = '#E5484D') {
    this.effects.ripple(origin.x, origin.z, color, 120, 2.6);
    this.effects.ripple(origin.x, origin.z, color, 120, 2.6, 0.35);
    affected.forEach((a, i) => {
      const s = SITES[a];
      if (!s) return;
      const delay = 0.6 + i * 0.32;
      this.effects.ripple(s.pos[0], s.pos[1], color === '#E5484D' ? '#F59E0B' : color, RING_R[s.type] * 1.4, 1.2, delay);
      const label = this.sites.sites[a]?.label;
      if (label) {
        this.timers.push(setTimeout(() => {
          label.classList.remove('is-flash');
          void label.offsetWidth;
          label.classList.add('is-flash');
        }, delay * 1000));
      }
    });
  }

  /** Stop shockwaves and label flashes still in flight (e.g. after Reset). */
  clearEffects() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.effects.clearRipples();
  }

  roadDirection(points, roadId) {
    const r = ROAD_BY_ID[roadId];
    const [ax, az] = JUNCTIONS[r.a];
    const [bx, bz] = JUNCTIONS[r.b];
    const ia = points.findIndex((p) => p[0] === ax && p[1] === az);
    const ib = points.findIndex((p) => p[0] === bx && p[1] === bz);
    return ia <= ib ? 1 : -1;
  }

  /** The supply links drawn as glowing lines: port -> hubs -> customers. */
  staticRoutes() {
    if (this._routes) return this._routes;
    const links = [
      ...HUB_IDS.map((h) => ({ from: 'port', to: h, kind: 'supply' })),
      ...CUSTOMER_IDS.map((c) => ({ from: SITES[c].hub, to: c, kind: 'delivery' })),
    ];
    this._routes = links.map((l) => {
      const r = route(l.from, l.to);
      return { ...l, roads: r.roads.map((id) => ({ id, dir: this.roadDirection(r.points, id) })) };
    });
    return this._routes;
  }

  /** AI recovery links in the current run with the time window they are active. */
  aiRoutes(run) {
    const groups = new Map();
    for (const s of run.shipments) {
      const ai = s.kind === 'transfer' || s.kind === 'backup' || s.detour;
      if (!ai) continue;
      const key = `${s.from}>${s.to}>${s.roads.join(',')}`;
      const g = groups.get(key) || { from: s.from, to: s.to, start: s.depart, end: s.arriveGate, roads: s.roads.map((id) => ({ id, dir: this.roadDirection(s.points, id) })) };
      g.start = Math.min(g.start, s.depart);
      g.end = Math.max(g.end, s.arriveGate);
      groups.set(key, g);
    }
    for (const r of run.acts?.reassigned || []) {
      const rr = route(r.to, r.customer);
      groups.set(`re>${r.customer}`, { from: r.to, to: r.customer, start: r.t, end: run.scenario.end, roads: rr.roads.map((id) => ({ id, dir: this.roadDirection(rr.points, id) })) });
    }
    return [...groups.values()];
  }

  updateFlows(t) {
    const run = this.run;
    const sc = run.scenario;
    const live = (x) => sc && t >= sc.start && t < sc.end && x;
    const portDown = live(sc?.type === 'port');
    const bridgeDown = live(sc?.type === 'bridge');
    const reassigned = new Set((run.acts?.reassigned || []).filter((r) => t >= r.t && t < sc.end).map((r) => r.customer));
    const RANK = { normal: 1, ai: 2, warn: 3, bad: 4 };
    const STYLE = {
      normal: { color: '#6366F1', speed: 0.3, opacity: 0.5 },
      ai: { color: '#16A34A', speed: 0.75, opacity: 0.95 },
      warn: { color: '#F59E0B', speed: 0.3, opacity: 0.9 },
      bad: { color: '#E5484D', speed: 0.15, opacity: 0.95 },
    };
    const roads = {};
    const mark = (list, status) => {
      for (const { id, dir } of list) {
        const cur = roads[id];
        if (!cur || RANK[status] > RANK[cur.status]) roads[id] = { status, dir };
      }
    };
    const hubs = Object.fromEntries(HUB_IDS.map((h) => [h, hubState(run, h, t)]));
    for (const r of this.staticRoutes()) {
      let status = 'normal';
      if (r.kind === 'supply') {
        const viaBridge = r.roads.some((x) => x.id === 'harborRd');
        if (portDown || hubs[r.to].closed || (bridgeDown && viaBridge)) status = 'bad';
        else if (hubs[r.to].minCover < LOW_COVER) status = 'warn';
      } else {
        if (reassigned.has(r.to)) continue;
        const c = customerState(run, r.to, t);
        if (c.tone === 'bad' || hubs[r.from].closed) status = 'bad';
        else if (c.tone === 'warn' || hubs[r.from].tone === 'bad') status = 'warn';
      }
      mark(r.roads, status);
    }
    if (!this._ai || this._aiRun !== run) {
      this._ai = this.aiRoutes(run);
      this._aiRun = run;
    }
    for (const r of this._ai) if (t >= r.start - 0.5 && t <= r.end) mark(r.roads, 'ai');
    const out = {};
    for (const [id, st] of Object.entries(roads)) {
      const style = STYLE[st.status];
      out[id] = { ...style, speed: style.speed * st.dir };
    }
    const blocked = new Set(bridgeDown ? ['harborRd'] : []);
    this.effects.setFlows(out, blocked);
    this.effects.setBarriers(blocked.size > 0);
  }

  update(t, dt) {
    this.time += dt;
    if (this.run) {
      const q = Math.floor(t * 6);
      this.sinceSites = (this.sinceSites || 0) + dt;
      if (q !== this.lastQ && (this.sinceSites > 0.08 || this.lastQ === null)) {
        this.sinceSites = 0;
        updateSites(this.sites, this.run, t, this.ui);
        this.lastQ = q;
        this.effects.setSmoke(backupState(this.run, t).producing);
        this.updateFlows(t);
      }
      this.trucks.update(t, dt);
      this.ships.update(t, this.time);
      const sc0 = this.run.scenario;
      this.ambient.update(t, this.time, !!sc0 && sc0.type === 'port' && t >= sc0.start && t < sc0.end);
      const sc = this.run.scenario;
      if (sc && t >= sc.end && this.effects.beacon.visible) this.effects.setBeacon(null);
      else if (sc && t >= sc.start && t < sc.end && !this.effects.beacon.visible) this.effects.setBeacon({ ...beaconFor(sc, this.terrain.bridges), sub: this.beaconSub });
    }
    animateSites(this.sites, dt, this.time, this.ui);
    this.effects.update(dt);
    this.terrain.water.update(this.time);
    this.world.tick(dt);
  }
}

export function beaconFor(sc, bridges) {
  const days = `${sc.days} day${sc.days > 1 ? 's' : ''}`;
  switch (sc.type) {
    case 'port':
      return { x: -50, z: 6, h: 26, r: 13, icon: 'Ship', text: `Port congestion · ${days}`, focus: 95 };
    case 'hub': {
      const s = SITES[sc.target];
      return { x: s.pos[0], z: s.pos[1], h: 11, r: 13, icon: 'PlugZap', text: `${s.short} offline · ${days}`, focus: 75 };
    }
    case 'bridge': {
      const b = bridges.kell;
      return { x: b.x, z: b.z, h: 7, r: 7, icon: 'Construction', text: `Kell Bridge closed · ${days}`, focus: 70 };
    }
    default:
      return { x: -72, z: 33, h: 6, r: 8, icon: 'Factory', text: `Supplier at 25% · ${days}`, focus: 100 };
  }
}
