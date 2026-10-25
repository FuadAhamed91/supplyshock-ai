// Visual effects: animated flow lines on roads, shockwave ripples, disruption
// beacons, the bridge barrier and factory smoke.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ROADS } from '../data/network.js';
import { ribbonGeometry } from './geometry.js';
import { cloneAsset } from './assets.js';
import { icon } from '../ui/icons.js';

const flowVertex = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const flowFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uOpacity;
  uniform float uDash;
  varying vec2 vUv;
  void main() {
    float d = fract(vUv.y * uDash - uTime * uSpeed);
    float dash = smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.5, 0.58, d));
    float edge = 1.0 - smoothstep(0.32, 0.5, abs(vUv.x - 0.5));
    float a = dash * edge * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Effects {
  constructor(scene, roadPaths, bridges) {
    this.scene = scene;
    this.time = 0;

    // One flow overlay per road, both directions share the mesh (direction = speed sign).
    this.flows = {};
    for (const road of ROADS) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: flowVertex,
        fragmentShader: flowFragment,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -12,
        uniforms: {
          uColor: { value: new THREE.Color('#4F46E5') },
          uTime: { value: 0 },
          uSpeed: { value: 0.6 },
          uOpacity: { value: 0 },
          uDash: { value: 0.5 },
        },
      });
      const mesh = new THREE.Mesh(ribbonGeometry(roadPaths[road.id], 1.25, 0.12, 1), mat);
      mesh.renderOrder = 3;
      mesh.visible = false;
      scene.add(mesh);
      this.flows[road.id] = { mesh, mat, target: 0 };
    }

    // Shockwave rings
    this.ripples = [];
    this.ringGeo = new THREE.RingGeometry(0.92, 1, 96).rotateX(-Math.PI / 2);

    // Beacon at the disrupted place
    this.beacon = new THREE.Group();
    this.beacon.visible = false;
    scene.add(this.beacon);
    this.beaconRings = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: '#E5484D', transparent: true, opacity: 0, depthWrite: false }));
      m.position.y = 0.12;
      m.renderOrder = 4;
      this.beacon.add(m);
      return m;
    });
    const pinEl = document.createElement('div');
    pinEl.className = 'beacon-pin';
    this.pinEl = pinEl;
    this.pin = new CSS2DObject(pinEl);
    this.beacon.add(this.pin);

    // Anchorage alarm around a ship held offshore: the ring pulses, the tag stays
    // put above the ship (siblings, so the ring's scale doesn't move the tag).
    this.anchor = new THREE.Group();
    this.anchor.visible = false;
    scene.add(this.anchor);
    this.anchorRing = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: '#E5484D', transparent: true, opacity: 0, depthWrite: false }));
    this.anchorRing.position.y = -0.45;
    this.anchor.add(this.anchorRing);
    const anchorEl = document.createElement('div');
    anchorEl.className = 'anchor-tag';
    anchorEl.innerHTML = `${icon('Anchor', 12, 2.4)}<span>Held at anchor</span>`;
    this.anchorTag = new CSS2DObject(anchorEl);
    this.anchorTag.position.set(0, 7, 0);
    this.anchor.add(this.anchorTag);

    // Barriers at both ends of Kell Bridge
    this.barriers = new THREE.Group();
    const kell = bridges.kell;
    if (kell) {
      for (const side of [-1, 1]) {
        const b = cloneAsset('barrier');
        const dx = Math.cos(kell.dir) * 6.2 * side;
        const dz = -Math.sin(kell.dir) * 6.2 * side;
        b.position.set(kell.x + dx, 0.05, kell.z + dz);
        b.rotation.y = kell.dir + Math.PI / 2;
        this.barriers.add(b);
      }
    }
    this.barriers.visible = false;
    scene.add(this.barriers);

    // Factory smoke
    this.smoke = [];
    const puffGeo = new THREE.IcosahedronGeometry(0.7, 1);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshStandardMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, roughness: 1, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.smoke.push({ mesh: m, phase: i / 9 });
    }
    this.smokeOn = 0;
    this.chimney = new THREE.Vector3(-20.4, 9.3, -45.6);
  }

  /** states: { roadId: { color, speed, opacity } }; blocked: Set of closed road ids */
  setFlows(states, blocked) {
    for (const [id, f] of Object.entries(this.flows)) {
      const st = states[id];
      const u = f.mat.uniforms;
      if (blocked.has(id)) {
        f.target = 1;
        u.uColor.value.set('#E5484D');
        u.uSpeed.value = 0;
        u.uDash.value = 0.9;
      } else if (st) {
        f.target = st.opacity ?? 0.9;
        u.uColor.value.set(st.color);
        u.uSpeed.value = st.speed;
        u.uDash.value = 0.45;
      } else {
        f.target = 0;
      }
    }
  }

  ripple(x, z, color = '#E5484D', radius = 90, duration = 2.2, delay = 0) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(x, 0.14, z);
    mesh.renderOrder = 5;
    mesh.visible = false;
    this.scene.add(mesh);
    this.ripples.push({ mesh, age: -delay, duration, radius });
  }

  clearRipples() {
    for (const r of this.ripples) {
      this.scene.remove(r.mesh);
      r.mesh.material.dispose();
    }
    this.ripples = [];
  }

  setBeacon(beacon) {
    if (!beacon) {
      this.beacon.visible = false;
      this.pinEl.classList.remove('is-on');
      return;
    }
    this.beacon.visible = true;
    this.beacon.position.set(beacon.x, 0, beacon.z);
    this.pin.position.set(0, beacon.h || 12, 0);
    this.pinEl.innerHTML = `<span class="beacon-pin__icon">${icon(beacon.icon || 'TriangleAlert', 14, 2.4)}</span><span>${beacon.text}${beacon.sub ? `<small>${beacon.sub}</small>` : ''}</span>`;
    this.pinEl.classList.add('is-on');
    this.beaconRadius = beacon.r || 10;
  }

  setBarriers(on) { this.barriers.visible = on; }
  setSmoke(on) { this.smokeOn = on ? 1 : 0; }

  setAnchorAlarm(pos) {
    if (!pos) {
      this.anchor.visible = false;
      return;
    }
    this.anchor.visible = true;
    this.anchor.position.x = pos[0];
    this.anchor.position.z = pos[1];
  }

  update(dt) {
    this.time += dt;
    const time = this.time;
    for (const f of Object.values(this.flows)) {
      const u = f.mat.uniforms;
      u.uTime.value = time;
      u.uOpacity.value += (f.target - u.uOpacity.value) * Math.min(1, dt * 5);
      f.mesh.visible = u.uOpacity.value > 0.02;
    }
    this.ripples = this.ripples.filter((r) => {
      r.age += dt;
      if (r.age < 0) return true;
      const f = r.age / r.duration;
      if (f >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        return false;
      }
      const e = 1 - (1 - f) ** 3;
      r.mesh.visible = true;
      r.mesh.scale.setScalar(1 + e * r.radius);
      r.mesh.material.opacity = 0.75 * (1 - f);
      return true;
    });
    if (this.beacon.visible) {
      this.beaconRings.forEach((m, i) => {
        const f = (time * 0.6 + i / 3) % 1;
        m.scale.setScalar(this.beaconRadius * (0.6 + f * 0.9));
        m.material.opacity = 0.7 * (1 - f);
      });
    }
    if (this.anchor.visible) {
      const f = (time * 0.7) % 1;
      this.anchorRing.scale.setScalar(9 + f * 6);
      this.anchorRing.material.opacity = 0.8 * (1 - f);
    }
    for (const p of this.smoke) {
      const f = (time * 0.22 + p.phase) % 1;
      const active = this.smokeOn > 0;
      p.mesh.visible = active;
      if (!active) continue;
      p.mesh.position.set(this.chimney.x + f * 2.2, this.chimney.y + f * 6, this.chimney.z - f * 1.2);
      p.mesh.scale.setScalar(0.6 + f * 1.8);
      p.mesh.material.opacity = 0.7 * Math.sin(Math.PI * f);
    }
  }
}
