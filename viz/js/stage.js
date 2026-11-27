// One WebGL canvas, one scene and one camera, drawn into several page
// elements ("views") with scissored viewports. Every view shows the same
// ground from the same camera, with its own delivery on top, so the venues
// stay directly comparable when the visitor turns the camera.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toScene } from './coords.js';
import { buildWorld, NIGHT } from './world.js';
import { makeDelivery } from './delivery.js';

const VERTICAL_FOV = 34;
const MIN_HORIZONTAL_FOV = 24; // narrow views widen their lens instead of cropping the pitch

// Camera positions and targets in data coordinates.
const CAMERAS = {
  stumps: { label: 'Behind the stumps', position: [0.2, -6.6, 2.5], target: [0.15, 4, 0.4] },
  side: { label: 'Side on', position: [11.5, 3.1, 1.4], target: [0, 3.1, 0.8] },
  above: { label: 'From above', position: [0.2, 3.78, 14], target: [0.2, 3.8, 0] },
};

export const cameraOptions = Object.entries(CAMERAS).map(([value, { label }]) => ({ value, label }));

const radians = THREE.MathUtils.degToRad;
const degrees = THREE.MathUtils.radToDeg;

function fovFor(aspect) {
  const horizontal = 2 * Math.atan(Math.tan(radians(VERTICAL_FOV) / 2) * aspect);
  if (degrees(horizontal) >= MIN_HORIZONTAL_FOV) return VERTICAL_FOV;
  return degrees(2 * Math.atan(Math.tan(radians(MIN_HORIZONTAL_FOV) / 2) / aspect));
}

export function createStage(constants) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'stage-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(NIGHT);
  scene.fog = new THREE.Fog(NIGHT, 70, 190);
  scene.add(buildWorld(constants));

  const camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, 0.1, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false; // the wheel scrolls the page
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  canvas.style.touchAction = 'pan-y';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let views = []; // { el, delivery, progress, animation }
  let host = null;
  let dirty = true;
  let lastTime = 0;
  const invalidate = () => { dirty = true; };
  const observer = new ResizeObserver(invalidate);
  controls.addEventListener('change', invalidate);
  window.addEventListener('resize', invalidate);

  function setCamera(name) {
    const preset = CAMERAS[name] ?? CAMERAS.stumps;
    camera.position.copy(toScene(...preset.position));
    controls.target.copy(toScene(...preset.target));
    controls.update();
    invalidate();
  }

  function clearDelivery(view) {
    view.animation?.resolve(false);
    view.animation = null;
    view.delivery?.dispose();
    view.delivery = null;
  }

  function mount(nextHost, elements) {
    views.forEach(clearDelivery);
    observer.disconnect();
    host = nextHost;
    host.prepend(canvas);
    views = elements.map((el) => ({ el, delivery: null, progress: 0, animation: null }));
    [host, ...elements].forEach((el) => observer.observe(el));
    invalidate();
  }

  function setDelivery(index, spec) {
    const view = views[index];
    clearDelivery(view);
    view.delivery = makeDelivery({ ...spec, ballRadius: constants.ball_radius });
    view.delivery.group.visible = false;
    view.progress = 0;
    scene.add(view.delivery.group);
    invalidate();
    return view.delivery.last;
  }

  function jump(index, to) {
    const view = views[index];
    if (!view?.delivery) return;
    view.animation?.resolve(false);
    view.animation = null;
    view.progress = to;
    view.delivery.setProgress(to);
    invalidate();
  }

  // Moves the ball to path point `to` at `speed` points per second. Resolves
  // true on arrival, false if the delivery was replaced first.
  function play(index, to, speed) {
    const view = views[index];
    if (!view?.delivery) return Promise.resolve(false);
    if (reducedMotion.matches) {
      jump(index, to);
      return Promise.resolve(true);
    }
    view.animation?.resolve(false);
    return new Promise((resolve) => {
      view.animation = { to, speed, resolve };
    });
  }

  function advance(seconds) {
    views.forEach((view) => {
      const { animation } = view;
      if (!animation) return;
      view.progress = Math.min(view.progress + animation.speed * seconds, animation.to);
      view.delivery.setProgress(view.progress);
      if (view.progress >= animation.to) {
        view.animation = null;
        animation.resolve(true);
      }
      dirty = true;
    });
  }

  function draw() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== width || size.y !== height) renderer.setSize(width, height, false);
    const frame = canvas.getBoundingClientRect();

    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0); // drawing the scene background leaves its colour as the clear colour
    renderer.clear();
    renderer.setScissorTest(true);
    views.forEach((view) => {
      const rect = view.el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const left = rect.left - frame.left;
      const bottom = frame.bottom - rect.bottom;
      renderer.setViewport(left, bottom, rect.width, rect.height);
      renderer.setScissor(left, bottom, rect.width, rect.height);
      camera.aspect = rect.width / rect.height;
      camera.fov = fovFor(camera.aspect);
      camera.updateProjectionMatrix();
      views.forEach((other) => {
        if (other.delivery) other.delivery.group.visible = other === view;
      });
      renderer.render(scene, camera);
    });
  }

  function frame(time) {
    const seconds = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    advance(seconds);
    if (dirty && host && host.clientWidth > 0) {
      dirty = false;
      draw();
    }
    requestAnimationFrame(frame);
  }

  setCamera('stumps');
  requestAnimationFrame(frame);

  return { mount, setDelivery, play, jump, setCamera, invalidate };
}
