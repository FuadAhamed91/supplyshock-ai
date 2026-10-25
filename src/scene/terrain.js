// The diorama board: land, sea, river, roads, bridges and scenery.
import * as THREE from 'three';
import { ROADS, RIVER, SITES, JUNCTIONS, BRIDGES } from '../data/network.js';
import { ROAD_POINTS } from '../sim/graph.js';
import { mulberry32 } from '../sim/rng.js';
import {
  smoothPolyline, catmull, ribbonGeometry, distToPolyline, segmentIntersection,
} from './geometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cloneAsset, meshParts } from './assets.js';
import { createWater } from './water.js';

export const BOARD = { x0: -80, x1: 80, z0: -56, z1: 56, r: 9 };
export const ROAD_W = 3.2;
export const COLORS = {
  land: '#EDF1EA',
  landSide: '#E3E0D7',
  base: '#DCE3EC',
  water: '#BCDCF1',
  bank: '#DCEBDD',
  road: '#D2D9E2',
  roadLine: '#FFFFFF',
  quay: '#D8DEE6',
};

/**
 * Soft mottling for the land: without it the board reads as blank paper under
 * this much ambient light. Blobs are drawn nine times, wrapped, so the texture
 * tiles without a visible seam.
 */
function groundTexture() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(23);
  for (let i = 0; i < 190; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 12 + rng() * 44;
    const shade = rng();
    const tint = shade < 0.45 ? '198, 208, 193' : shade < 0.8 ? '214, 211, 198' : '255, 255, 255';
    const alpha = 0.1 + rng() * 0.22;
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, `rgba(${tint}, ${alpha})`);
        g.addColorStop(1, `rgba(${tint}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / 54, 1 / 54); // extrude UVs are in world units
  tex.anisotropy = 4;
  return tex;
}

export const coastX = (z) => -47 + 2.4 * Math.sin(z * 0.09) + 1.4 * Math.sin(z * 0.21 + 1.3);

// Shape helpers work in the XY plane; shape y = -world z (see rotateX below).
function roundedRect(x0, z0, x1, z1, r) {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, -z0);
  s.lineTo(x1 - r, -z0);
  s.quadraticCurveTo(x1, -z0, x1, -z0 - r);
  s.lineTo(x1, -z1 + r);
  s.quadraticCurveTo(x1, -z1, x1 - r, -z1);
  s.lineTo(x0 + r, -z1);
  s.quadraticCurveTo(x0, -z1, x0, -z1 + r);
  s.lineTo(x0, -z0 - r);
  s.quadraticCurveTo(x0, -z0, x0 + r, -z0);
  return s;
}

function landShape() {
  const { x1, z0, z1, r } = BOARD;
  const s = new THREE.Shape();
  s.moveTo(coastX(z0), -z0);
  s.lineTo(x1 - r, -z0);
  s.quadraticCurveTo(x1, -z0, x1, -z0 - r);
  s.lineTo(x1, -z1 + r);
  s.quadraticCurveTo(x1, -z1, x1 - r, -z1);
  s.lineTo(coastX(z1), -z1);
  for (let z = z1; z >= z0; z -= 1) s.lineTo(coastX(z), -z);
  return s;
}

function toGround(geometry) {
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * The sea's cut face: a wall along the board edge wherever the sea reaches it,
 * so the water reads as a body of water in the model rather than a film.
 */
function seaWallGeometry() {
  const { x0, z0, z1, r } = BOARD;
  const pts = []; // [x, z, outward x, outward z]
  // the same quadratic corners as roundedRect(), walked anticlockwise from above
  const corner = (p0, c, p2) => {
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      const x = (1 - u) ** 2 * p0[0] + 2 * u * (1 - u) * c[0] + u * u * p2[0];
      const z = (1 - u) ** 2 * p0[1] + 2 * u * (1 - u) * c[1] + u * u * p2[1];
      const tx = (1 - u) * (c[0] - p0[0]) + u * (p2[0] - c[0]);
      const tz = (1 - u) * (c[1] - p0[1]) + u * (p2[1] - c[1]);
      const l = Math.hypot(tx, tz);
      pts.push([x, z, -tz / l, tx / l]);
    }
  };
  pts.push([coastX(z0), z0, 0, -1]);
  corner([x0 + r, z0], [x0, z0], [x0, z0 + r]); // back-left, then down the left edge
  corner([x0, z1 - r], [x0, z1], [x0 + r, z1]); // front-left
  pts.push([coastX(z1), z1, 0, 1]);
  const top = -0.56;
  const bottom = -3.9;
  const pos = [];
  const col = [];
  const idx = [];
  const cTop = new THREE.Color('#9CCBEA');
  const cBottom = new THREE.Color('#6E9FCF');
  pts.forEach(([x, z, nx, nz], i) => {
    // just proud of the base slab so the two faces don't fight
    const ox = x + nx * 0.04;
    const oz = z + nz * 0.04;
    pos.push(ox, top, oz, ox, bottom, oz);
    col.push(cTop.r, cTop.g, cTop.b, cBottom.r, cBottom.g, cBottom.b);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k); // facing outwards
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = COLORS.road;
  ctx.fillRect(0, 0, 32, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillRect(15, 0, 2, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(0, 0, 1.2, 64);
  ctx.fillRect(30.8, 0, 1.2, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildTerrain(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const { x0, x1, z0, z1, r } = BOARD;

  // Base slab
  const base = new THREE.Mesh(
    toGround(new THREE.ExtrudeGeometry(roundedRect(x0, z0, x1, z1, r), { depth: 3.4, bevelEnabled: false })),
    new THREE.MeshStandardMaterial({ color: COLORS.base, roughness: 0.9 }),
  );
  base.position.y = -4;
  base.receiveShadow = true;
  group.add(base);

  // Sea
  const water = createWater();
  const sea = new THREE.Mesh(toGround(new THREE.ShapeGeometry(roundedRect(x0, z0, x1, z1, r), 16)), water.sea);
  sea.position.y = -0.55;
  sea.receiveShadow = true;
  group.add(sea);
  group.add(new THREE.Mesh(seaWallGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })));

  // Land
  const land = new THREE.Mesh(
    toGround(new THREE.ExtrudeGeometry(landShape(), {
      depth: 0.6, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.5, bevelSegments: 2, curveSegments: 6,
    })),
    [
      new THREE.MeshStandardMaterial({ color: COLORS.land, roughness: 0.95, map: groundTexture() }),
      new THREE.MeshStandardMaterial({ color: COLORS.landSide, roughness: 0.95 }),
    ],
  );
  land.position.y = -0.85;
  land.receiveShadow = true;
  group.add(land);

  // River with soft green banks
  const river = catmull(RIVER, 6).filter(([, z]) => z >= z0 - 0.5 && z <= z1 + 0.5);
  const bank = new THREE.Mesh(ribbonGeometry(river, 8.4, 0.012), new THREE.MeshStandardMaterial({ color: COLORS.bank, roughness: 1 }));
  bank.receiveShadow = true;
  group.add(bank);
  const riverMesh = new THREE.Mesh(ribbonGeometry(river, 5.2, 0.024), water.river);
  riverMesh.receiveShadow = true;
  group.add(riverMesh);

  // Port quay
  const quay = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 32), new THREE.MeshStandardMaterial({ color: COLORS.quay, roughness: 0.9 }));
  quay.position.set(-50.5, -0.25, 6);
  quay.receiveShadow = true;
  quay.castShadow = true;
  group.add(quay);
  const quayEdge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 32), new THREE.MeshStandardMaterial({ color: '#F2C94C', roughness: 0.6 }));
  quayEdge.position.set(-57.25, 0.3, 6);
  group.add(quayEdge);

  // Roads
  const roadTex = roadTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const plainMat = new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  // Roads, junctions and driveways are merged into a few meshes (few draw calls).
  const roadPaths = {};
  const roadGeos = [];
  for (const road of ROADS) {
    const pts = smoothPolyline(ROAD_POINTS[road.id], 8, 10);
    roadPaths[road.id] = pts;
    roadGeos.push(ribbonGeometry(pts, ROAD_W, 0.05, 6));
  }
  const roads = new THREE.Mesh(mergeGeometries(roadGeos), roadMat);
  roads.receiveShadow = true;
  group.add(roads);
  const plainGeos = [];
  for (const [x, z] of Object.values(JUNCTIONS)) {
    plainGeos.push(toGround(new THREE.CircleGeometry(ROAD_W / 2 + 0.05, 24)).translate(x, 0.055, z));
  }
  for (const site of Object.values(SITES)) plainGeos.push(ribbonGeometry([site.dock, JUNCTIONS[site.access]], 2.6, 0.045));
  const plain = new THREE.Mesh(mergeGeometries(plainGeos.map((g) => (g.index ? g : g))), plainMat);
  plain.receiveShadow = true;
  group.add(plain);

  // Bridges where roads cross the river (deck + railings, merged per material)
  const bridges = {};
  const deckMat = new THREE.MeshStandardMaterial({ color: '#C9D1DC', roughness: 0.8 });
  const railMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.6 });
  const deckGeos = [];
  const railGeos = [];
  const place = (geo, hit, lx, ly, lz) => {
    const m = new THREE.Matrix4().makeRotationY(hit.dir).premultiply(new THREE.Matrix4().makeTranslation(hit.x, 0, hit.z));
    return geo.translate(lx, ly, lz).applyMatrix4(m);
  };
  for (const [id, b] of Object.entries(BRIDGES)) {
    const pts = roadPaths[b.road];
    let hit = null;
    for (let i = 1; i < pts.length && !hit; i++) {
      for (let j = 1; j < river.length && !hit; j++) hit = segmentIntersection(pts[i - 1], pts[i], river[j - 1], river[j]);
    }
    if (!hit) continue;
    deckGeos.push(place(new THREE.BoxGeometry(9.5, 0.5, ROAD_W + 1.1), hit, 0, -0.2, 0));
    for (const side of [-1, 1]) {
      railGeos.push(place(new THREE.BoxGeometry(9.5, 0.14, 0.14), hit, 0, 0.75, side * (ROAD_W / 2 + 0.4)));
      for (let k = -4; k <= 4; k += 2) railGeos.push(place(new THREE.BoxGeometry(0.16, 0.75, 0.16), hit, k, 0.38, side * (ROAD_W / 2 + 0.4)));
    }
    bridges[id] = { x: hit.x, z: hit.z, dir: hit.dir };
  }
  const deck = new THREE.Mesh(mergeGeometries(deckGeos), deckMat);
  deck.receiveShadow = true;
  group.add(deck);
  const rails = new THREE.Mesh(mergeGeometries(railGeos), railMat);
  rails.castShadow = true;
  group.add(rails);

  scatterScenery(group, roadPaths, river);
  return { group, roadPaths, bridges, water, river };
}

// Trees and a few homes so the network sits in a living landscape.
function scatterScenery(group, roadPaths, river) {
  const rng = mulberry32(7);
  const allRoads = Object.values(roadPaths);
  const driveways = Object.values(SITES).map((s) => [s.dock, JUNCTIONS[s.access]]);
  const blocked = (x, z, pad) => {
    if (x < coastX(z) + 3 || x > BOARD.x1 - 2.5 || z < BOARD.z0 + 2.5 || z > BOARD.z1 - 2.5) return true;
    if (x < -40 && z > -12 && z < 24) return true; // port area
    for (const s of Object.values(SITES)) {
      if (Math.hypot(x - s.pos[0], z - s.pos[1]) < (s.type === 'hub' || s.type === 'supplier' ? 13 : 9)) return true;
      if (Math.hypot(x - s.dock[0], z - s.dock[1]) < 5) return true;
    }
    for (const p of allRoads) if (distToPolyline(x, z, p) < pad) return true;
    for (const p of driveways) if (distToPolyline(x, z, p) < pad - 0.5) return true;
    return distToPolyline(x, z, river) < 6;
  };

  // Homes in a few neighbourhoods
  const homes = [];
  const hoods = [[26, 16, 14, 8], [-4, 22, 10, 8], [30, -12, 10, 6], [-36, -34, 8, 8], [32, 44, 10, 6], [62, 44, 8, 6], [62, -44, 8, 6]];
  for (const [cx, cz, w, d] of hoods) {
    for (let i = 0; i < 26 && homes.length < 60; i++) {
      const x = cx + (rng() - 0.5) * w * 2;
      const z = cz + (rng() - 0.5) * d * 2;
      if (blocked(x, z, 4.6) || homes.some((h) => Math.hypot(h[0] - x, h[1] - z) < 4.6)) continue;
      homes.push([x, z, rng() < 0.5 ? 0 : Math.PI / 2, 0.85 + rng() * 0.3]);
    }
  }
  const roofColors = ['#B9C6D9', '#D9C7B3', '#AFC9BC', '#CDBFDA', '#E2B7A6'].map((c) => new THREE.Color(c));
  addInstanced(group, 'house', homes.map(([x, z, ry, s]) => ({ x, z, ry, s })), (mat) => mat.name === 'TintRoof', (i) => roofColors[i % roofColors.length]);

  // Trees: clustered with a low-frequency noise field
  const trees = [];
  const field = (x, z) => Math.sin(x * 0.08) * Math.cos(z * 0.09) + Math.sin((x + z) * 0.05);
  for (let i = 0; i < 5200 && trees.length < 430; i++) {
    const x = BOARD.x0 + rng() * (BOARD.x1 - BOARD.x0);
    const z = BOARD.z0 + rng() * (BOARD.z1 - BOARD.z0);
    if (field(x, z) < 0.15 && rng() > 0.12) continue;
    if (blocked(x, z, 3.6)) continue;
    if (homes.some((h) => Math.hypot(h[0] - x, h[1] - z) < 3.4)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.95)) continue;
    trees.push({
      x, z, ry: rng() * Math.PI * 2, s: 0.7 + rng() * 0.75,
      kind: rng() < 0.6 ? 'tree_round' : 'tree_cone',
      color: LEAF_COLORS[Math.floor(rng() * LEAF_COLORS.length)],
    });
  }
  // Woodland reads as woodland only when no two neighbours share a green.
  const round = trees.filter((t) => t.kind === 'tree_round');
  const cone = trees.filter((t) => t.kind === 'tree_cone');
  const isLeaf = (m) => m.name === 'Leaf' || m.name === 'LeafDark';
  addInstanced(group, 'tree_round', round, isLeaf, (i) => round[i].color);
  addInstanced(group, 'tree_cone', cone, isLeaf, (i) => cone[i].color);
}

const LEAF_COLORS = ['#9CCB90', '#8CC088', '#AFD9A0', '#7FB487', '#BCE0AB', '#93C9A2', '#A8D293']
  .map((c) => new THREE.Color(c));

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** One InstancedMesh per material slot of a (possibly multi-material) asset. */
export function addInstanced(parent, assetName, items, tintMaterial = null, colorFor = null) {
  if (!items.length) return null;
  const src = cloneAsset(assetName);
  const meshes = [];
  src.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const out = new THREE.Group();
  for (const mesh of meshes) {
    const tint = tintMaterial && tintMaterial(mesh.material);
    const material = tint ? mesh.material.clone() : mesh.material;
    if (tint) material.color.set('#FFFFFF');
    const inst = new THREE.InstancedMesh(mesh.geometry, material, items.length);
    items.forEach((it, i) => {
      _q.setFromAxisAngle(_up, it.ry || 0);
      _p.set(it.x, it.y || 0, it.z);
      _s.setScalar(it.s || 1);
      inst.setMatrixAt(i, _m.compose(_p, _q, _s));
      if (tint && colorFor) inst.setColorAt(i, colorFor(i));
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    out.add(inst);
  }
  parent.add(out);
  return out;
}

export { meshParts };
