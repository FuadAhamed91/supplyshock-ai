// Loads the Blender-built asset pack (public/models/supplyshock.glb) and hands
// out clones. Run `npm run assets` to rebuild the GLB from blender/build_assets.py.
//
// Baking: a prop can arrive with 20 materials, which would be 20 draw calls per
// copy. We merge its meshes into one vertex-coloured mesh *per surface finish* —
// matte render, glossy paint, metal, glass, emissive — so a prop costs a handful
// of draw calls while plaster still reads as plaster and glass as glass. Flatten
// them all into a single material instead and the whole board turns to clay.
// Materials the app recolours at runtime (KEEP) stay as their own small meshes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const url = `${import.meta.env.BASE_URL}models/supplyshock.glb`;
// Foliage is kept separate too, so each instanced tree can be given its own green.
const KEEP = new Set(['TintTruck', 'Brand', 'TintRoof', 'HullTop', 'Leaf', 'LeafDark']);
let library = null;
const bakedCache = new Map();
const finishCache = new Map();

/** Vehicle paint and signage get a clearcoat, so they read as sprayed, not moulded. */
const CLEARCOAT = new Set(['TintTruck', 'Brand']);

/**
 * One material per surface finish. Roughness and metalness are quantised so
 * near-identical finishes share a bucket (and a draw call); emissive surfaces
 * keep their own, since their glow colour can't ride on vertex colours.
 */
function finishKey(m) {
  const lit = m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0;
  if (lit) return `e:${m.name}`;
  const r = Math.round(THREE.MathUtils.clamp(m.roughness ?? 0.75, 0, 1) * 10) / 10;
  const t = Math.round(THREE.MathUtils.clamp(m.metalness ?? 0, 0, 1) * 10) / 10;
  return `s:${r}:${t}`;
}

function finishMaterial(key, src) {
  if (finishCache.has(key)) return finishCache.get(key);
  let m;
  if (key.startsWith('e:')) {
    m = src.clone();
    m.vertexColors = false;
  } else {
    const [, r, t] = key.split(':').map(Number);
    m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: r,
      metalness: t,
      // Smooth surfaces should mirror more of the sky than plaster does.
      envMapIntensity: 0.6 + (1 - r) * 1.5,
    });
  }
  m.name = `finish${key}`;
  finishCache.set(key, m);
  return m;
}

export async function loadAssets(onProgress) {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });
  library = {};
  gltf.scene.updateMatrixWorld(true);
  for (const child of gltf.scene.children) library[child.name] = child;
  return library;
}

/** Collapse every mesh under `root` into one vertex-coloured geometry per finish (+ kept materials). */
function bakeNode(root, name) {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map(); // finish key -> { material, geos }
  const kept = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = [].concat(o.material)[0];
    let g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    if (g.index) g = g.toNonIndexed();
    if (KEEP.has(m.name)) {
      if (!kept.has(m.name)) kept.set(m.name, { material: m, geos: [] });
      kept.get(m.name).geos.push(g);
      return;
    }
    const key = finishKey(m);
    if (!buckets.has(key)) buckets.set(key, { material: finishMaterial(key, m), geos: [], lit: key.startsWith('e:') });
    const bucket = buckets.get(key);
    if (!bucket.lit) {
      // Base colour rides on the vertices, plus a hint of contact shading near
      // the ground; screen-space occlusion in world.js does the rest.
      const c = m.color;
      const n = g.attributes.position.count;
      const pos = g.attributes.position;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const y = pos.getY(i);
        const t = Math.min(1, Math.max(0, y / 1.6));
        const ao = 0.84 + 0.16 * t * t * (3 - 2 * t);
        col[i * 3] = c.r * ao;
        col[i * 3 + 1] = c.g * ao;
        col[i * 3 + 2] = c.b * ao;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    bucket.geos.push(g);
  });
  const group = new THREE.Group();
  group.name = name;
  for (const [key, { material, geos }] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.name = `${name}__${key}`;
    group.add(mesh);
  }
  for (const [mname, { material, geos }] of kept) {
    let mat = material;
    if (CLEARCOAT.has(mname) && !material.isMeshPhysicalMaterial) {
      mat = new THREE.MeshPhysicalMaterial({
        name: mname,
        color: material.color,
        roughness: material.roughness,
        metalness: material.metalness,
        clearcoat: 0.7,
        clearcoatRoughness: 0.22,
        envMapIntensity: 1.2,
      });
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.name = `${name}__${mname}`;
    group.add(mesh);
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

function baked(name) {
  if (bakedCache.has(name)) return bakedCache.get(name);
  const src = library[name];
  if (!src) throw new Error(`Missing asset "${name}" in supplyshock.glb`);
  let out;
  if (name === 'ship') {
    // keep the hull and each cargo bay as separate parts (bays empty out while unloading)
    out = new THREE.Group();
    out.name = 'ship';
    for (const child of src.children) out.add(bakeNode(child, child.name));
  } else {
    out = bakeNode(src, name);
  }
  bakedCache.set(name, out);
  return out;
}

/** Clone of a named asset. Materials listed in `uniqueMaterials` get per-clone copies. */
export function cloneAsset(name, uniqueMaterials = []) {
  const obj = baked(name).clone(true);
  if (uniqueMaterials.length) {
    obj.traverse((o) => {
      if (o.isMesh && uniqueMaterials.includes(o.material.name)) o.material = o.material.clone();
    });
  }
  return obj;
}

/** Find a material by name inside an object (first match). */
export function findMaterial(obj, name) {
  let found = null;
  obj.traverse((o) => {
    if (!found && o.isMesh && o.material.name === name) found = o.material;
  });
  return found;
}

/** Geometry + material of a single-mesh asset, for InstancedMesh. */
export function meshParts(name) {
  let mesh = null;
  library[name].traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  return { geometry: mesh.geometry, material: mesh.material };
}

export const tmpColor = new THREE.Color();
