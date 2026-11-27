// One WebGL canvas, one scene and one camera, drawn into several page
// elements ("views") with scissored viewports. Every view shows the same
// ground. The batter, bowler, wicket and ball are shared: before each view is
// drawn, that view's play poses them for its own delivery, its venue's
// backdrop and sky are switched in, and, when a run-up is shown, the
// director's camera for that moment replaces the visitor's.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toScene } from './coords.js';
import { buildWorld } from './world.js';
import { createPlay } from './play.js';
import { WATCHING } from './outcomes.js';
import { CAMERAS, RELEASE, VERTICAL_FOV, cutAt, fovFor, shotFor } from './director.js';
import { buildBall } from './models/ball.js';
import { buildStumps } from './models/stumps.js';
import { buildBatter } from './models/batter.js';
import { buildBowler } from './models/bowler.js';
import { buildRingFielder, buildSlip } from './models/fielders.js';
import { buildBackdrops, buildStadium, skyFor } from './models/backdrops.js';
import { textureReport } from './models/load.js';

export const cameraOptions = Object.entries(CAMERAS).map(([value, { label }]) => ({ value, label }));

const toData = (v) => [v.x, -v.z, v.y]; // the inverse of coords.js

// models: what models/load.js resolved, { batter, bowler, slip, fielder, stumps, stadium, <venue key>... }
// onSound(name, level) is called when a view's delivery reaches one of its sound cues.
export function createStage(constants, venueKeys, models, { onSound } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'stage-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(skyFor());
  const stadium = buildStadium(models.stadium, venueKeys);
  scene.add(buildWorld(constants, { boundary: !stadium.group })); // the stadium brings its own rope and stands

  const actors = {
    ball: buildBall(constants.ball_radius),
    batter: buildBatter(models.batter, constants),
    bowler: buildBowler(models.bowler),
    wicket: buildStumps(models.stumps, constants, 0),
  };
  const slip = buildSlip(models.slip);
  const fielder = buildRingFielder(models.fielder, constants);
  const backdrops = buildBackdrops(Object.fromEntries(venueKeys.map((key) => [key, models[key]])), constants.pitch_length);
  scene.add(
    actors.ball.group, actors.batter.group, actors.bowler.group, actors.wicket.group,
    buildStumps(models.stumps, constants, constants.pitch_length).group, // the bowler's end, never broken
    slip.group, fielder.group, ...Object.values(backdrops),
  );
  if (stadium.group) scene.add(stadium.group);

  const camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, 0.1, 1500); // the visitor's, moved by dragging
  const directorCamera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, 0.1, 1500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false; // the wheel scrolls the page
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  canvas.style.touchAction = 'pan-y';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let views = []; // { el, venue, play, animation, time, run, fired, onEvent, cutTag, onCut }
  let host = null;
  let dirty = true;
  let lastTime = 0;
  let takenOver = false; // the visitor has grabbed the camera back from the director
  let cameraName = 'stumps'; // the preset chosen, which the director's cut 3 lands on
  const invalidate = () => { dirty = true; };
  const observer = new ResizeObserver(invalidate);
  controls.addEventListener('change', invalidate);
  controls.addEventListener('start', () => { takenOver = true; });
  window.addEventListener('resize', invalidate);

  function setCamera(name) {
    cameraName = CAMERAS[name] ? name : 'stumps';
    const preset = CAMERAS[cameraName];
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

  function setTag(view, tag) {
    if (view.cutTag === tag) return;
    view.cutTag = tag;
    view.onCut?.(tag);
  }

  function clearPlay(index) {
    const view = views[index];
    if (!view) return;
    stop(view, false);
    view.play?.dispose();
    view.play = null;
    setTag(view, null);
    invalidate();
  }

  function mount(nextHost, elements) {
    views.forEach((_, index) => clearPlay(index));
    observer.disconnect();
    host = nextHost;
    host.prepend(canvas);
    views = elements.map((el) => ({ el, venue: null, play: null, time: 0, run: null, fired: false, onEvent: null, cutTag: null, onCut: null }));
    [host, ...elements].forEach((el) => observer.observe(el));
    invalidate();
  }

  // spec: { venue, arm, path, bounceIndex, pauseIndex?, runUp?, color, fan?, mean?, onEvent?, onCut? }
  // runUp shows the bowler's approach under the three-camera director; reduced motion never does.
  function setPlay(index, spec) {
    clearPlay(index);
    const view = views[index];
    const lead = spec.runUp && !reducedMotion.matches ? RELEASE : 0;
    const play = createPlay({ ...spec, lead }, constants, slip.catchPoint);
    play.group.visible = false;
    scene.add(play.group);
    Object.assign(view, {
      play, venue: spec.venue, arm: spec.arm, time: 0, fired: false, animation: null,
      onEvent: spec.onEvent ?? null, onCut: spec.onCut ?? null,
    });
    takenOver = false;
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
      const before = view.time;
      view.time = Math.min(view.time + seconds * view.run.rate, view.run.until);
      view.play.cues().forEach((cue) => {
        if (cue.time > before && cue.time <= view.time) onSound?.(cue.sound, 1 / Math.sqrt(views.length));
      });
      checkEvent(view);
      if (view.time >= view.run.until) stop(view, true);
      dirty = true;
    });
  }

  // Poses the shared actors for one view and returns the camera to draw it with.
  function pose(view, aspect, clock) {
    scene.background.setHex(skyFor(view.venue));
    Object.entries(backdrops).forEach(([key, backdrop]) => { backdrop.visible = key === view.venue; });
    stadium.show(view.venue);
    const idle = reducedMotion.matches ? 0 : clock; // the fielders hold still under reduced motion
    slip.pose(idle);
    fielder.pose(idle);
    views.forEach((other) => {
      if (other.play) other.play.group.visible = other === view;
    });
    actors.bowler.group.visible = Boolean(view.play);
    if (!view.play) {
      actors.ball.group.visible = false;
      actors.batter.pose(clock, null);
      actors.wicket.pose(null);
    } else {
      view.play.apply(view.time, actors, clock);
    }

    const presetFov = fovFor(aspect, CAMERAS[cameraName].minHorizontalFov);
    if (!view.play || view.play.lead === 0 || takenOver) {
      setTag(view, null);
      camera.aspect = aspect;
      camera.fov = presetFov;
      camera.updateProjectionMatrix();
      return camera;
    }
    const cut = cutAt(view.time, {
      eventTime: view.play.decided ? view.play.eventTime : Infinity,
      camera: cameraName,
      through: view.animation?.ball === 'through',
    });
    const shot = shotFor(cut, {
      time: view.time,
      side: view.arm === 'left' ? -1 : 1,
      pitchLength: constants.pitch_length,
      ball: actors.ball.group.visible ? toData(actors.ball.group.position) : null,
      impact: toData(view.play.impact),
    });
    setTag(view, cut.tag);
    directorCamera.position.copy(toScene(...shot.position));
    directorCamera.lookAt(toScene(...shot.target));
    directorCamera.aspect = aspect;
    directorCamera.fov = shot.fov == null ? presetFov : shot.fov * (fovFor(aspect) / VERTICAL_FOV);
    directorCamera.updateProjectionMatrix();
    return directorCamera;
  }

  function draw(clock) {
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
      renderer.render(scene, pose(view, rect.width / rect.height, clock));
    });
  }

  function frame(time) {
    const seconds = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    advance(seconds);
    // the fielders' crouch, and the batter's stance while a delivery waits at the bounce, loop between balls
    const idling = !reducedMotion.matches;
    if ((dirty || idling) && host && host.clientWidth > 0) {
      dirty = false;
      draw(time / 1000);
    }
    requestAnimationFrame(frame);
  }

  // What the mixers have shown and how the textures are set, read back live: for checking in the browser.
  const report = () => ({
    clips: {
      batter: [...actors.batter.clips], bowler: [...actors.bowler.clips], stumps: [...actors.wicket.clips],
      slip: [...slip.clips], fielder: [...fielder.clips],
    },
    textures: textureReport(),
  });

  setCamera('stumps');
  requestAnimationFrame(frame);

  return { mount, setPlay, clearPlay, setOutcome, playTo, jumpTo, setCamera, report };
}
