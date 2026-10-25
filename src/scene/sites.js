// Buildings, stock yards and floating labels for every site in the network.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { SITES, HUB_IDS, SKUS, SKU_IDS } from '../data/network.js';
import { cloneAsset, meshParts, findMaterial } from './assets.js';
import { icon, SITE_ICON } from '../ui/icons.js';
import {
  dailyDemand, hubState, customerState, portState, backupState, stockAt,
} from '../sim/query.js';

const MODEL = {
  hub: 'warehouse', supplier: 'factory', hospital: 'hospital', clinic: 'clinic', pharmacy: 'pharmacy', carehome: 'carehome',
};
const LABEL_Y = { port: 17, hub: 8.6, supplier: 11.5, hospital: 11.5, clinic: 8, pharmacy: 6.6, carehome: 7.2 };
export const RING_R = { port: 14, hub: 12.5, supplier: 10.5, hospital: 9.5, clinic: 7, pharmacy: 6, carehome: 7 };
export const TONE_COLORS = {
  ok: '#16A34A', warn: '#F59E0B', bad: '#E5484D', disrupted: '#E5484D', ai: '#16A34A', idle: '#94A3B8', select: '#4F46E5',
};

const CRATES_PER_SKU = 12;
const CONTAINER_UNITS = 28;
const CONTAINER_SLOTS = 5 * 9 * 3;
const CONTAINER_COLORS = ['#5B7DB1', '#7FB0D6', '#E2B46F', '#97C3A3', '#C2C9D3', '#8D8AD6', '#E59F7E', '#6FA7A0'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function makeLabel(id, site) {
  const el = document.createElement('div');
  el.className = `tag tag--${site.type}`;
  el.dataset.site = id;
  const bars = site.type === 'hub'
    ? `<span class="tag__bars">${SKUS.map((s) => `<i style="--c:${s.color}" title="${s.name}"><b></b></i>`).join('')}</span>`
    : '';
  el.innerHTML = `<span class="tag__icon">${icon(SITE_ICON[site.type], 14)}</span>`
    + `<span class="tag__body"><span class="tag__name">${site.name}</span><span class="tag__meta"></span></span>${bars}`;
  return el;
}

/** Animated InstancedMesh where each slot scales in/out. */
class SlotMesh {
  constructor(parent, geometry, material, slots, colors = null) {
    this.slots = slots; // [{x,y,z,ry}]
    this.mesh = new THREE.InstancedMesh(geometry, material, slots.length);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.cur = new Float32Array(slots.length);
    this.target = new Float32Array(slots.length);
    if (colors) slots.forEach((_, i) => this.mesh.setColorAt(i, colors(i)));
    this.write();
    parent.add(this.mesh);
  }
  write() {
    this.slots.forEach((sl, i) => {
      _q.setFromAxisAngle(_up, sl.ry || 0);
      _p.set(sl.x, sl.y, sl.z);
      const s = this.cur[i];
      _s.set(s, s, s);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    let changed = false;
    const k = Math.min(1, dt * 7);
    for (let i = 0; i < this.cur.length; i++) {
      const d = this.target[i] - this.cur[i];
      if (Math.abs(d) > 0.002) {
        this.cur[i] += d * k;
        changed = true;
      } else if (this.cur[i] !== this.target[i]) {
        this.cur[i] = this.target[i];
        changed = true;
      }
    }
    if (changed) this.write();
  }
}

export function buildSites(scene) {
  const sites = {};
  const hitTargets = [];
  const crate = meshParts('crate');
  const pallet = meshParts('pallet');
  const crateMat = crate.material.clone();
  crateMat.color.set('#FFFFFF');

  for (const [id, site] of Object.entries(SITES)) {
    const group = new THREE.Group();
    group.position.set(site.pos[0], 0, site.pos[1]);
    scene.add(group);
    const yard = new THREE.Group();
    yard.rotation.y = site.rot || 0;
    group.add(yard);
    const entry = { id, site, group, yard, materials: {} };

    if (site.type === 'port') {
      buildPort(entry, scene);
    } else {
      const model = cloneAsset(MODEL[site.type], ['Brand']);
      yard.add(model);
      entry.model = model;
      entry.materials.brand = findMaterial(model, 'Brand');
    }

    // Stock yard for hubs: crates per SKU, 6 columns x 2 levels
    if (site.type === 'hub') {
      const slots = [];
      SKU_IDS.forEach((k, r) => {
        for (let l = 0; l < 2; l++) {
          for (let c = 0; c < 6; c++) slots.push({ x: -6.6 + c * 1.08, y: l * 0.95, z: 6.0 + r * 1.1, sku: k });
        }
      });
      const color = new THREE.Color();
      entry.crates = new SlotMesh(yard, crate.geometry, crateMat, slots, (i) => color.set(SKUS.find((s) => s.id === slots[i].sku).color));
      entry.pallets = new SlotMesh(yard, pallet.geometry, pallet.material, slots);
      entry.capacity = Object.fromEntries(SKU_IDS.map((k) => [k, site.targetDays * dailyDemand(id, k)]));
    }

    // Status ring + soft fill
    const R = RING_R[site.type];
    const ringMat = new THREE.MeshBasicMaterial({ color: TONE_COLORS.ok, transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.45, R, 72).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.1;
    ring.renderOrder = 2;
    group.add(ring);
    const fillMat = new THREE.MeshBasicMaterial({ color: TONE_COLORS.ok, transparent: true, opacity: 0, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.CircleGeometry(R - 0.45, 72).rotateX(-Math.PI / 2), fillMat);
    fill.position.y = 0.08;
    fill.renderOrder = 1;
    group.add(fill);
    entry.ring = ring;
    entry.fill = fill;

    const el = makeLabel(id, site);
    const label = new CSS2DObject(el);
    label.position.set(site.type === 'port' ? -2 : 0, LABEL_Y[site.type], 0);
    group.add(label);
    entry.label = el;
    entry.meta = el.querySelector('.tag__meta');
    entry.bars = [...el.querySelectorAll('.tag__bars b')];
    entry.labelObj = label;

    group.traverse((o) => { if (o.isMesh && o !== ring && o !== fill) { o.userData.site = id; hitTargets.push(o); } });
    sites[id] = entry;
  }
  return { sites, hitTargets };
}

function buildPort(entry, scene) {
  const { group, site } = entry;
  const local = (x, z) => [x - site.pos[0], z - site.pos[1]];
  for (const z of [0.5, 12.5]) {
    const crane = cloneAsset('port_crane');
    const [lx, lz] = local(-52, z);
    crane.position.set(lx, 0.25, lz);
    group.add(crane);
  }
  const office = cloneAsset('office');
  const [ox, oz] = local(-38.5, -6);
  office.position.set(ox, 0, oz);
  office.rotation.y = Math.PI / 2;
  group.add(office);
  // container yard
  const slots = [];
  for (let tier = 0; tier < 3; tier++) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 5; c++) {
        const [x, z] = local(-47.6 + c * 1.35, -6 + r * 2.75);
        slots.push({ x, y: 0.25 + tier * 1.02, z, ry: Math.PI / 2 });
      }
    }
  }
  const { geometry, material } = meshParts('container');
  const mat = material.clone();
  mat.color.set('#FFFFFF');
  const color = new THREE.Color();
  entry.containers = new SlotMesh(group, geometry, mat, slots, (i) => color.set(CONTAINER_COLORS[(i * 7 + (i >> 3)) % CONTAINER_COLORS.length]));
  void scene;
}

/** Refresh labels, rings and stock piles for time t. */
export function updateSites(state, run, t, ui) {
  const { sites } = state;
  for (const [id, e] of Object.entries(sites)) {
    let st;
    if (e.site.type === 'hub') st = hubState(run, id, t);
    else if (e.site.type === 'port') st = portState(run, t);
    else if (e.site.type === 'supplier') st = backupState(run, t);
    else st = customerState(run, id, t);
    e.state = st;

    if (e.meta.textContent !== st.meta) e.meta.textContent = st.meta;
    const cls = `tag tag--${e.site.type} is-${st.tone}${ui.selected === id ? ' is-selected' : ''}${ui.hover === id ? ' is-hover' : ''}${ui.dim && !ui.highlight?.has(id) ? ' is-dim' : ''}`;
    if (e.label.className !== cls) e.label.className = cls;

    if (e.crates) {
      SKU_IDS.forEach((k, r) => {
        const s = stockAt(run, id, k, t);
        const n = Math.round(Math.min(1, s / e.capacity[k]) * CRATES_PER_SKU);
        const v = Math.min(1, st.cover[k] / 5);
        if (e.bars[r]) e.bars[r].style.transform = `scaleX(${v.toFixed(3)})`;
        for (let j = 0; j < CRATES_PER_SKU; j++) {
          const i = r * CRATES_PER_SKU + j;
          e.crates.target[i] = j < n ? 1 : 0;
          e.pallets.target[i] = j < n ? 1 : 0;
        }
      });
    }
    if (e.containers) {
      const units = SKU_IDS.reduce((a, k) => a + stockAt(run, 'port', k, t), 0);
      const n = Math.min(CONTAINER_SLOTS, Math.round(units / CONTAINER_UNITS));
      for (let i = 0; i < CONTAINER_SLOTS; i++) e.containers.target[i] = i < n ? 1 : 0;
    }
    if (e.materials.brand) e.materials.brand.color.set(st.tone === 'disrupted' ? '#E5484D' : '#4F46E5');
  }
}

/** Per-frame animation (crate pop-in, ring pulses). */
export function animateSites(state, dt, time, ui) {
  for (const [id, e] of Object.entries(state.sites)) {
    e.crates?.update(dt);
    e.pallets?.update(dt);
    e.containers?.update(dt);
    const tone = ui.selected === id ? 'select' : e.state?.tone;
    const show = ui.selected === id || tone === 'bad' || tone === 'warn' || tone === 'disrupted' || (tone === 'ai' && e.state?.producing);
    const pulse = tone === 'bad' || tone === 'disrupted' ? 0.55 + 0.45 * Math.sin(time * 5) : 1;
    const targetOpacity = show ? 0.85 * pulse : 0;
    const rm = e.ring.material;
    rm.opacity += (targetOpacity - rm.opacity) * Math.min(1, dt * 8);
    rm.color.set(TONE_COLORS[tone] || TONE_COLORS.ok);
    e.fill.material.color.copy(rm.color);
    e.fill.material.opacity = rm.opacity * 0.12;
    e.ring.visible = rm.opacity > 0.01;
    e.fill.visible = e.ring.visible;
  }
}

export { HUB_IDS };
