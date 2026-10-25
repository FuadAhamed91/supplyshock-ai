// Renderer, camera, lights, post-processing and controls for the "architectural
// model under daylight" look: a physical sky lights the board, ground-truth
// ambient occlusion darkens every crevice, and a touch of bloom lets the water
// and lit windows sparkle.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const BG = '#E8EEF6';
// The sun, shared by the sky shader, the key light and the shadow camera so the
// highlight on a roof and the shadow it casts always agree.
export const SUN_DIR = new THREE.Vector3(-0.535, 0.749, -0.392);
// Phones and portrait tablets put the panel in a bottom sheet (see styles.css).
const SHEET_QUERY = '(max-width: 760px), (max-width: 1024px) and (orientation: portrait)';
// Home view: the board seen from the south, high up. Its distance and image
// offset are fitted on every resize so the whole board sits in the screen area
// the floating cards leave free.
const HOME_DIR = new THREE.Vector3(0, 174, 164).normalize();
const BOARD_BOX = []; // the board plus headroom for buildings and labels on its back edge
for (const x of [-80, 80]) for (const y of [-0.5, 14]) for (const z of [-56, 56]) BOARD_BOX.push(new THREE.Vector3(x, y, z));

/** A soft vertical gradient behind the board — a photographer's sweep, not a sky.
 *  It rides along with the camera, so it is never clipped by the far plane. */
function backdrop() {
  const geo = new THREE.SphereGeometry(400, 32, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color('#F4F8FD') },
      mid: { value: new THREE.Color('#E6EDF7') },
      bot: { value: new THREE.Color('#D3DDEB') },
    },
    vertexShader: /* glsl */`
      varying float vH;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vH = normalize(world.xyz).y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      varying float vH;
      void main() {
        float h = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = h < 0.5 ? mix(bot, mid, smoothstep(0.0, 0.5, h))
                         : mix(mid, top, smoothstep(0.5, 1.0, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'backdrop';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (r, s, cam) => {
    mesh.position.copy(cam.position);
    mesh.updateMatrixWorld();
  };
  return mesh;
}

export function createWorld(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  let pixelRatio = Math.min(window.devicePixelRatio, 1.6);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels-layer';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.add(backdrop());
  scene.fog = new THREE.Fog(BG, 230, 420);

  // ------------------------------------------------------------ environment
  // A physical sky, rendered once into an environment map: materials pick up a
  // blue zenith, a pale horizon and a warm sun, which is what makes paint read
  // as paint and glass as glass.
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const skyScene = new THREE.Scene();
  const sky = new Sky();
  sky.scale.setScalar(10000);
  sky.material.uniforms.turbidity.value = 3.4;
  sky.material.uniforms.rayleigh.value = 1.15;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  sky.material.uniforms.mieDirectionalG.value = 0.82;
  sky.material.uniforms.sunPosition.value.copy(SUN_DIR).multiplyScalar(1000);
  skyScene.add(sky);
  const envRT = pmrem.fromScene(skyScene);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.22;
  sky.geometry.dispose();
  sky.material.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 10, 800);
  const homeView = { target: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(), dist: 240 };
  homeView.pos.copy(homeView.target).addScaledVector(HOME_DIR, homeView.dist);
  camera.position.copy(homeView.pos);

  // ----------------------------------------------------------------- lights
  // Key (the sun) + a cool sky fill from the opposite side + a warm bounce off
  // the ground. The environment map carries the rest of the ambient.
  const sun = new THREE.DirectionalLight('#FFF1DC', 3.1);
  sun.position.copy(SUN_DIR).multiplyScalar(140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -116;
  sc.right = 116;
  sc.top = 104;
  sc.bottom = -104;
  sc.near = 20;
  sc.far = 340;
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 2.4;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight('#CFE0F5', 0.5);
  fill.position.set(88, 62, 74); // opposite the sun: lifts the shadow side
  scene.add(fill);

  const hemi = new THREE.HemisphereLight('#EAF2FF', '#C9C2B4', 0.35);
  scene.add(hemi);

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

  // -------------------------------------------------------- post-processing
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.95;
  gtao.updateGtaoMaterial({
    radius: 2.6, distanceExponent: 1.6, thickness: 1.4, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false,
  });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
  composer.addPass(gtao);

  // Threshold is in linear HDR, well above a sunlit white roof: only genuine
  // highlights (sun glints on water, lit windows) are allowed to bleed.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.5, 3.0);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  // Quality ladder, walked down by `adapt()` when frames stay slow.
  let quality = 2; // 2 = AO + bloom + MSAA, 1 = bloom only, 0 = plain forward render
  function applyQuality() {
    gtao.enabled = quality >= 2;
    bloom.enabled = quality >= 1;
    composer.renderTarget1.samples = quality >= 2 ? 4 : 0;
    composer.renderTarget2.samples = quality >= 2 ? 4 : 0;
    sun.shadow.mapSize.setScalar(quality >= 2 ? 4096 : 2048);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
  applyQuality();

  /** Screen area (CSS px) the floating chrome leaves free for the map. */
  function freeRect(w, h) {
    const pad = 12;
    const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const top = (box('[data-chrome="top"]')?.bottom ?? box('.topbar')?.bottom ?? 0) + pad;
    const bottom = (box('[data-chrome="bottom"]')?.top ?? box('.timeline')?.top ?? h) - pad;
    const panel = box('[data-chrome="panel"]') ?? box('#panel');
    const rail = box('[data-chrome="rail"]');
    const leftEdge = Math.max(panel?.right ?? 0, rail?.right ?? 0);
    if (!window.matchMedia(SHEET_QUERY).matches) return { left: leftEdge + pad, right: w - pad, top, bottom };
    // bottom sheet: up to 48vh tall, sitting on the scrub bar
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
    scene.fog.near = hi * 1.25;
    scene.fog.far = hi * 2.6;
  }

  // Smooth camera moves
  let flight = null;
  let atHome = true; // follow the fitted home view on resize until the user moves the camera

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
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

  // Dynamic quality: if frames stay slow for several seconds, drop the most
  // expensive effect rather than stuttering — ambient occlusion first, then
  // bloom, then resolution. Short stalls (e.g. while the planner runs) don't count.
  let slowFrames = 0;
  let sampled = 0;
  let slowWindows = 0;
  function adapt(dt) {
    if (document.hidden || dt > 0.25) return;
    sampled++;
    if (dt > 1 / 45) slowFrames++;
    if (sampled < 120) return;
    slowWindows = slowFrames > 80 ? slowWindows + 1 : 0;
    if (slowWindows >= 3) {
      if (quality > 0) {
        quality--;
        applyQuality();
      } else if (pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        composer.setPixelRatio(pixelRatio);
        resize();
      }
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
    if (quality > 0) composer.render(dt);
    else renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  const world = {
    renderer, scene, camera, controls, labels, sun, fill, hemi, composer, gtao, bloom, tick, flyTo, home, resize, userMovedSince,
  };
  if (import.meta.env.DEV) window.__world = world; // live light tuning from the console
  return world;
}
