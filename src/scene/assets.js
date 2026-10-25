// Loads the Blender-built asset pack (public/models/supplyshock.glb) and hands
// out clones. Run `npm run assets` to rebuild the GLB from blender/build_assets.py.
//
// For speed, every asset is "baked" once at load: all of its materials collapse
// into one vertex-coloured mesh (one draw call), except materials the app
// recolours at runtime (KEEP), which stay as their own small meshes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const url = `${import.meta.env.BASE_URL}models/supplyshock.glb`;
const KEEP = new Set(['TintTruck', 'Brand', 'TintRoof', 'HullTop']);
let library = null;
const bakedCache = new Map();
const bakedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04, envMapIntensity: 0.55 });

export async function loadAssets(onProgress) {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });
  library = {};
  gltf.scene.updateMatrixWorld(true);
  for (const child of gltf.scene.children) library[child.name] = child;
  return library;
}

/** Collapse every mesh under `root` into one vertex-coloured geometry (+ kept materials). */
function bakeNode(root, name) {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
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
    const c = m.color;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  });
  const group = new THREE.Group();
  group.name = name;
  if (parts.length) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), bakedMaterial);
    mesh.name = `${name}__baked`;
    group.add(mesh);
  }
  for (const [mname, { material, geos }] of kept) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
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
