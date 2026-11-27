// One WebGL canvas, one scene and one camera, drawn into several page
// elements ("views") with scissored viewports. Every view shows the same
// ground from the same camera. The batter, bowler, wicket and ball are shared:
// before each view is drawn, that view's play poses them for its own delivery
// and its venue's backdrop and sky are switched in.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toScene } from './coords.js';
import { buildWorld } from './world.js';
import { createPlay } from './play.js';
import { WATCHING } from './outcomes.js';
import { buildBall } from './models/ball.js';
import { buildWicket } from './models/wicket.js';
import { buildBatter } from './models/batter.js';
import { buildBowler, buildSlip } from './models/fielders.js';
import { buildBackdrops, skyFor } from './models/backdrops.js';

const VERTICAL_FOV = 34;
const MIN_HORIZONTAL_FOV = 24; // narrow views widen their lens instead of cropping the pitch

// Camera positions and targets in data coordinates.
const CAMERAS = {
  stumps: { label: 'Behind the stumps', position: [0.2, -6.6, 2.5], target: [0.15, 4, 0.7] },
  side: { label: 'Side on', position: [11.5, 3.1, 1.4], target: [0, 3.1, 0.8] },
  above: { label: 'From above', position: [0.2, 2.88, 14], target: [0.2, 2.9, 0] },
};

export const cameraOptions = Object.entries(CAMERAS).map(([value, { label }]) => ({ value, label }));

const radians = THREE.MathUtils.degToRad;
const degrees = THREE.MathUtils.radToDeg;

function fovFor(aspect) {
  const horizontal = 2 * Math.atan(Math.tan(radians(VERTICAL_FOV) / 2) * aspect);
  if (degrees(horizontal) >= MIN_HORIZONTAL_FOV) return VERTICAL_FOV;
  return degrees(2 * Math.atan(Math.tan(radians(MIN_HORIZONTAL_FOV) / 2) / aspect));
}

// models: what models/load.js resolved, { batter, bowler, slip, <venue key>... }
export function createStage(constants, venueKeys, models) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'stage-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(skyFor());
  scene.add(buildWorld(constants));

  const actors = {
    ball: buildBall(constants.ball_radius),
    batter: buildBatter(models.batter, constants),
    wicket: buildWicket(constants, 0),
  };
  const bowler = buildBowler(models.bowler);
  const slip = buildSlip(models.slip);
  const backdrops = buildBackdrops(Object.fromEntries(venueKeys.map((key) => [key, models[key]])), constants.pitch_length);
  scene.add(
    actors.ball.group, actors.batter.group, actors.wicket.group,
    buildWicket(constants, constants.pitch_length).group,
    bowler.group, slip.group, ...Object.values(backdrops),
  );

  const camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, 0.1, 1500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false; // the wheel scrolls the page
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  canvas.style.touchAction = 'pan-y';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let views = []; // { el, venue, arm, release, play, animation, time, run, fired, onEvent }
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

  function stop(view, arrived) {
    const { run } = view;
    view.run = null;
    run?.resolve(arrived);
  }

  function clearPlay(index) {
    const view = views[index];
    if (!view) return;
    stop(view, false);
    view.play?.dispose();
    view.play = null;
    invalidate();
  }

  function mount(nextHost, elements) {
    views.forEach((_, index) => clearPlay(index));
    observer.disconnect();
    host = nextHost;
    host.prepend(canvas);
    views = elements.map((el) => ({ el, venue: null, play: null, time: 0, run: null, fired: false, onEvent: null }));
    [host, ...elements].forEach((el) => observer.observe(el));
    invalidate();
  }

  // spec: { venue, arm, path, bounceIndex, pauseIndex?, color, fan?, mean?, onEvent? }
  function setPlay(index, spec) {
    clearPlay(index);
    const view = views[index];
    const play = createPlay(spec, constants, slip.catchPoint);
    play.group.visible = false;
    scene.add(play.group);
    Object.assign(view, { play, venue: spec.venue, arm: spec.arm, release: spec.path[0], time: 0, fired: false, animation: null, onEvent: spec.onEvent ?? null });
    invalidate();
  }

  // Tells the view how its delivery ends (see outcomes.js). The caption fires when the ball gets there.
  function setOutcome(index, animation) {
    const view = views[index];
    if (!view?.play) return;
    view.play.setOutcome(animation);
    view.animation = animation;
    view.fired = false;
  }

  function checkEvent(view) {
    if (view.fired || !view.animation || view.animation === WATCHING || view.time < view.play.eventTime) return;
    view.fired = true;
    view.onEvent?.();
  }

  const timeOf = (view, to) => (to === 'pause' ? view.play.pauseTime ?? view.play.duration : view.play.duration);

  function jumpTo(index, to) {
    const view = views[index];
    if (!view?.play) return;
    stop(view, false);
    view.time = timeOf(view, to);
    checkEvent(view);
    invalidate();
  }

  // Runs the view's delivery on to 'pause' (the bounce, in the game) or to
  // the 'end'. Resolves true on arrival, false if the delivery was replaced.
  function playTo(index, to, rate = 1) {
    const view = views[index];
    if (!view?.play) return Promise.resolve(false);
    if (reducedMotion.matches) {
      jumpTo(index, to);
      return Promise.resolve(true);
    }
    stop(view, false);
    return new Promise((resolve) => {
      view.run = { until: timeOf(view, to), rate, resolve };
    });
  }

  function advance(seconds) {
    views.forEach((view) => {
      if (!view.run) return;
      view.time = Math.min(view.time + seconds * view.run.rate, view.run.until);
      checkEvent(view);
      if (view.time >= view.run.until) stop(view, true);
      dirty = true;
    });
  }

  function pose(view) {
    scene.background.setHex(skyFor(view.venue));
    Object.entries(backdrops).forEach(([key, backdrop]) => { backdrop.visible = key === view.venue; });
    views.forEach((other) => {
      if (other.play) other.play.group.visible = other === view;
    });
    bowler.group.visible = Boolean(view.play);
    if (view.play) {
      bowler.place(view.release, view.arm);
      view.play.apply(view.time, actors);
    } else {
      actors.ball.group.visible = false;
      actors.batter.setPose('stance', 0);
      actors.wicket.setBreak(0);
    }
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
      pose(view);
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

  return { mount, setPlay, clearPlay, setOutcome, playTo, jumpTo, setCamera };
}
