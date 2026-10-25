// Renderer, camera, lights and controls for the light "architectural model" look.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const BG = '#EEF2F7';
// Phones and portrait tablets put the panel in a bottom sheet (see styles.css).
const SHEET_QUERY = '(max-width: 760px), (max-width: 1024px) and (orientation: portrait)';
// Home view: the board seen from the south, high up. Its distance and image
// offset are fitted on every resize so the whole board sits in the screen area
// the floating cards leave free.
const HOME_DIR = new THREE.Vector3(0, 174, 164).normalize();
const BOARD_BOX = []; // the board plus headroom for buildings and labels on its back edge
for (const x of [-80, 80]) for (const y of [-0.5, 14]) for (const z of [-56, 56]) BOARD_BOX.push(new THREE.Vector3(x, y, z));

export function createWorld(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels-layer';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 230, 420);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 1600);
  const homeView = { target: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(), dist: 240 };
  homeView.pos.copy(homeView.target).addScaledVector(HOME_DIR, homeView.dist);
  camera.position.copy(homeView.pos);

  const hemi = new THREE.HemisphereLight('#FFFFFF', '#BFCADA', 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#FFF4E2', 3.4);
  sun.position.set(-75, 105, -55); // from the north-west: shadows fall towards the viewer
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -112;
  sc.right = 112;
  sc.top = 100;
  sc.bottom = -100;
  sc.near = 20;
  sc.far = 320;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(homeView.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 35;
  controls.maxDistance = 260;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.2;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.update();

  /** Screen area (CSS px) the floating cards leave free for the map. */
  function freeRect(w, h) {
    const pad = 12;
    const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const top = (box('.topbar')?.bottom ?? 0) + pad;
    const bottom = (box('.timeline')?.top ?? h) - pad;
    const panel = box('#panel');
    if (!window.matchMedia(SHEET_QUERY).matches) return { left: (panel?.right ?? 0) + pad, right: w - pad, top, bottom };
    // bottom sheet: up to 48vh tall, sitting on the timeline
    const sheetTop = (panel ? panel.bottom : h - 98) - h * 0.48;
    return { left: pad / 2, right: w - pad / 2, top, bottom: Math.min(bottom, sheetTop) - pad };
  }

  const probe = new THREE.PerspectiveCamera();
  const corner = new THREE.Vector3();
  /** The board's projected extent (px, relative to the screen centre) from `dist`, without a view offset. */
  function measure(dist, w, h) {
    probe.fov = camera.fov;
    probe.aspect = camera.aspect;
    probe.updateProjectionMatrix();
    probe.position.copy(homeView.target).addScaledVector(HOME_DIR, dist);
    probe.lookAt(homeView.target);
    probe.updateMatrixWorld();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const c of BOARD_BOX) {
      corner.copy(c).project(probe);
      const px = (corner.x * w) / 2;
      const py = (-corner.y * h) / 2;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  /** Closest distance at which the whole board fits the free area, then centre it there. */
  function fitHome(w, h) {
    const free = freeRect(w, h);
    let lo = 40;
    let hi = 1400;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      const m = measure(mid, w, h);
      if (m.w <= free.right - free.left && m.h <= free.bottom - free.top) hi = mid;
      else lo = mid;
    }
    const m = measure(hi, w, h);
    homeView.dist = hi;
    homeView.pos.copy(homeView.target).addScaledVector(HOME_DIR, hi);
    camera.setViewOffset(w, h, w / 2 + m.cx - (free.left + free.right) / 2, h / 2 + m.cy - (free.top + free.bottom) / 2, w, h);
    controls.maxDistance = Math.max(260, hi * 1.3);
    scene.fog.near = hi * 0.96;
    scene.fog.far = hi * 1.76;
  }

  // Smooth camera moves
  let flight = null;
  let atHome = true; // follow the fitted home view on resize until the user moves the camera

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    // A wider lens on narrow and portrait screens keeps the board from shrinking too far.
    const lens = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(17)) / camera.aspect));
    camera.fov = THREE.MathUtils.clamp(lens, 30, 68);
    fitHome(w, h);
    camera.updateProjectionMatrix();
    if (atHome && !flight) {
      camera.position.copy(homeView.pos);
      controls.target.copy(homeView.target);
    }
  }
  window.addEventListener('resize', resize);
  resize();

  function flyTo(target, distance = 70, duration = 1.1) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    flight = {
      t: 0, duration,
      fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
      toTarget: target.clone(), toPos: target.clone().add(dir.multiplyScalar(distance)),
    };
  }
  function home(duration = 1.2) {
    if (!duration) { // jump straight there (screenshots)
      flight = null;
      atHome = true;
      camera.position.copy(homeView.pos);
      controls.target.copy(homeView.target);
      return;
    }
    flight = {
      t: 0, duration, fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
      toTarget: homeView.target.clone(), toPos: homeView.pos.clone(), home: true,
    };
  }
  let userMovedAt = -Infinity;
  controls.addEventListener('start', () => {
    flight = null;
    atHome = false;
    userMovedAt = performance.now();
  });
  const userMovedSince = (t) => userMovedAt >= t;

  // Dynamic resolution: if frames stay slow for several seconds, render fewer
  // pixels instead of stuttering. Short stalls (e.g. while the planner runs) don't count.
  let slowFrames = 0;
  let sampled = 0;
  let slowWindows = 0;
  function adapt(dt) {
    if (document.hidden || dt > 0.25) return;
    sampled++;
    if (dt > 1 / 45) slowFrames++;
    if (sampled < 120) return;
    slowWindows = slowFrames > 80 ? slowWindows + 1 : 0;
    if (slowWindows >= 3 && pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      resize();
      slowWindows = 0;
    }
    sampled = 0;
    slowFrames = 0;
  }

  function tick(dt) {
    adapt(dt);
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.duration);
      const e = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
      camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
      if (flight.t >= 1) {
        atHome = !!flight.home;
        flight = null;
      }
    }
    // keep the camera over the board
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -70, 70);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -50, 50);
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  return {
    renderer, scene, camera, controls, labels, sun, tick, flyTo, home, resize, userMovedSince,
  };
}
