// Renderer, camera, lights and controls for the light "architectural model" look.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const BG = '#EEF2F7';
const HOME = { pos: new THREE.Vector3(4, 174, 172), target: new THREE.Vector3(4, 0, 8) };

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

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 1200);
  camera.position.copy(HOME.pos);

  const hemi = new THREE.HemisphereLight('#FFFFFF', '#D6DEE8', 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#FFF8EE', 2.4);
  sun.position.set(-60, 110, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -105;
  sc.right = 105;
  sc.top = 85;
  sc.bottom = -85;
  sc.near = 20;
  sc.far = 320;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 35;
  controls.maxDistance = 260;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.2;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.update();

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    // Keep the whole board in view on narrow screens.
    camera.fov = w / h < 1.2 ? 44 : 30;
    // Shift the optical centre into the free space right of the side panel.
    const panel = document.getElementById('panel');
    const right = panel && w > 760 ? panel.getBoundingClientRect().right : 0;
    const shift = right / 2;
    if (shift > 0) camera.setViewOffset(w, h, -shift, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Smooth camera moves
  let flight = null;
  function flyTo(target, distance = 70, duration = 1.1) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    flight = {
      t: 0, duration,
      fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
      toTarget: target.clone(), toPos: target.clone().add(dir.multiplyScalar(distance)),
    };
  }
  function home(duration = 1.2) {
    flight = {
      t: 0, duration, fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
      toTarget: HOME.target.clone(), toPos: HOME.pos.clone(),
    };
  }
  controls.addEventListener('start', () => { flight = null; });

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
      if (flight.t >= 1) flight = null;
    }
    // keep the camera over the board
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -70, 70);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -50, 50);
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  return { renderer, scene, camera, controls, labels, sun, tick, flyTo, home, resize };
}
