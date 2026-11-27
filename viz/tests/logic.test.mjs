// Run with: node --test viz/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percent, signedRuns, lineAtStumps, heightAtStumps, outcomeLabel } from '../js/format.js';
import { addChoice, cutIndex, emptyScore, pickRound } from '../js/game-logic.js';
import { validate, findScenario, venueKeys } from '../js/data.js';
import { animationFor } from '../js/outcomes.js';
import { clapTimes, cuesFor, soundNames } from '../js/audio.js';
import { CAMERAS, RELEASE, cutAt, fovFor, shotFor } from '../js/director.js';
import { BODY_LIMIT, COVER, KEEPER_Y, STANCE_X, batterRootX, extendToKeeper } from '../js/geometry.js';
import { LINES, kindOf, mostDramatic, pickVoice } from '../js/commentary.js';
import { replaySchedule } from '../js/boot.js';
import { clipTime } from '../js/models/frames.js';

test('a clip is only ever shown on one of its baked frames', () => {
  const step = 1 / 30;
  const onFrame = (t) => Math.abs(t / step - Math.round(t / step)) < 1e-6;
  for (let time = -0.5; time < 2; time += 0.0137) {
    const once = clipTime(time, { duration: 0.6, looping: false, step });
    assert.ok(once >= 0 && once < 0.6, `${time}: ${once}`);
    assert.ok(onFrame(once) || 0.6 - once < 1e-3, `${time}: ${once}`); // the last frame, held just inside the clip
    const loop = clipTime(time, { duration: 1.2, looping: true, step });
    assert.ok(loop >= 0 && loop < 1.2 && onFrame(loop), `${time}: ${loop}`);
  }
  assert.equal(clipTime(0.31, { duration: 0.6, looping: false, step }), 0.3);
  assert.equal(clipTime(1.24, { duration: 1.2, looping: true, step }).toFixed(4), (1 / 30).toFixed(4)); // 0.04 s in: frame 1
  assert.equal(clipTime(0.31, { duration: 0.6, looping: false, step: 0 }), 0.31); // no frame step known: unchanged
});

test('formats probabilities and expected values', () => {
  assert.equal(percent(0.05357), '5.4%');
  assert.equal(percent(0), '0.0%');
  assert.equal(percent(1), '100.0%');
  assert.equal(percent(0.0027), '0.27%');
  assert.equal(percent(0.00019), '0.02%');
  assert.equal(percent(0.00002), '0.002%');
  assert.equal(percent(0.000001), '<0.001%');
  assert.equal(percent(0.0096), '1.0%');
  assert.equal(signedRuns(-17.1752), '−17.18');
  assert.equal(signedRuns(-1.6072), '−1.61');
  assert.equal(signedRuns(0.5), '+0.50');
  assert.equal(signedRuns(-0), '0.00');
  assert.equal(signedRuns(-0.001), '0.00');
  assert.equal(lineAtStumps(0.3953, 0.1143), '28 cm outside off stump');
  assert.equal(lineAtStumps(-0.3, 0.1143), '19 cm outside leg stump');
  assert.equal(lineAtStumps(0.05, 0.1143), 'in line with the stumps');
  assert.equal(lineAtStumps(0.117, 0.1143), 'in line with the stumps');
  assert.equal(lineAtStumps(-0.117, 0.1143), 'in line with the stumps');
  assert.equal(heightAtStumps(0.6245, 0.711), '9 cm below the bails');
  assert.equal(heightAtStumps(0.714, 0.711), 'level with the bails');
  assert.equal(outcomeLabel('edged_caught'), 'Edged and caught');
  assert.equal(outcomeLabel('something_new'), 'something_new');
});

test('scores a round without mutating the previous score', () => {
  const delivery = {
    id: 7, path: [[0, 2, 1], [0, 1, 0], [0, 0, 1]], bounce_index: 1,
    outcome_leave: 'bowled', outcome_play: 'middled', ev_leave: -8, ev_play: 0.5, best: 'play',
  };
  const start = emptyScore();
  const afterLeave = addChoice(start, delivery, 'leave');
  assert.deepEqual(start, emptyScore());
  assert.deepEqual(
    { ev: afterLeave.ev, bestEv: afterLeave.bestEv, correct: afterLeave.correct, dismissals: afterLeave.dismissals },
    { ev: -8, bestEv: 0.5, correct: 0, dismissals: 1 },
  );
  const afterPlay = addChoice(afterLeave, delivery, 'play');
  assert.equal(afterPlay.ev, -7.5);
  assert.equal(afterPlay.correct, 1);
  assert.equal(afterPlay.choices.length, 2);
});

test('cuts at the bounce, or part-way when there is no bounce', () => {
  const path = Array.from({ length: 11 }, (_, i) => [0, 10 - i, 1]);
  assert.equal(cutIndex({ path, bounce_index: 4 }), 4);
  assert.equal(cutIndex({ path, bounce_index: -1 }), 6);
});

test('picks a round of distinct deliveries', () => {
  const pool = Array.from({ length: 20 }, (_, id) => ({ id }));
  const round = pickRound(pool, 6);
  assert.equal(new Set(round.map((d) => d.id)).size, 6);
  assert.equal(pickRound(pool.slice(0, 3), 6).length, 3);
  assert.equal(pool[0].id, 0);
});

test('the exported file passes validation and has every scenario', () => {
  const data = validate(JSON.parse(readFileSync(new URL('../data/trajectories.json', import.meta.url))));
  for (const venue of venueKeys(data)) {
    for (const ballAge of data.ball_ages) {
      for (const arm of data.arms) {
        assert.ok(findScenario(data, { venue, ballAge, arm, end: 0 }), `${venue} ${ballAge} ${arm}`);
      }
    }
  }
  assert.throws(() => validate({ meta: {} }), /meta\.constants/);
});

test('maps every action and outcome to its animation', () => {
  const pick = (action, outcome) => {
    const { batter, ball, flash } = animationFor(action, outcome);
    return [batter, ball, flash];
  };
  assert.deepEqual(pick('leave', 'safe'), ['leave', 'through', null]);
  assert.deepEqual(pick('leave', 'bowled'), ['leave', 'stumps', 'Bowled']);
  assert.deepEqual(pick('play', 'middled'), ['defend', 'dead', null]);
  assert.deepEqual(pick('play', 'edged_safe'), ['defend', 'edge-short', null]);
  assert.deepEqual(pick('play', 'edged_caught'), ['defend', 'edge-carry', 'Caught']);
  assert.deepEqual(pick('play', 'missed'), ['defend', 'through', null]);
  assert.deepEqual(pick('play', 'missed_bowled'), ['defend', 'stumps', 'Bowled']);
  // an outcome the page does not know still has the batter take the action
  assert.deepEqual(pick('play', 'something_new'), ['defend', 'through', null]);
  assert.deepEqual(pick('leave', undefined), ['leave', 'through', null]);
});

test('every outcome in the exported file has an animation', () => {
  const data = JSON.parse(readFileSync(new URL('../data/trajectories.json', import.meta.url)));
  const seen = new Set();
  data.game.forEach((d) => seen.add(`leave:${d.outcome_leave}`).add(`play:${d.outcome_play}`));
  data.scenarios.forEach((s) => (s.fan_outcomes ?? []).forEach((o) => seen.add(`leave:${o.leave}`).add(`play:${o.play}`)));
  seen.forEach((key) => {
    const [action, outcome] = key.split(':');
    assert.notEqual(animationFor(action, outcome).name, 'unknown', key);
  });
});

test('maps every outcome animation to its sounds', () => {
  const sounds = (name) => cuesFor(name).map((cue) => cue.sound);
  assert.deepEqual(sounds('bowled'), ['timber', 'bails', 'roar', 'applause']);
  assert.deepEqual(sounds('edged-short'), ['nick', 'ooh']);
  assert.deepEqual(sounds('edged-caught'), ['nick', 'glove', 'roar', 'applause']);
  assert.deepEqual(sounds('middled'), ['middled', 'crisp-applause']);
  assert.deepEqual(sounds('left-alone'), ['whoosh', 'glove', 'pavilion-claps']);
  assert.deepEqual(sounds('play-and-miss'), ['whoosh', 'glove', 'ooh-short']);
  assert.deepEqual(sounds('watching'), []);
  assert.deepEqual(sounds('unknown'), []);
  // the catch comes after the nick, the bails after the stump, and the whoosh before the ball arrives
  assert.ok(cuesFor('edged-caught')[1].at > cuesFor('edged-caught')[0].at);
  assert.ok(cuesFor('bowled')[1].at > 0);
  assert.ok(cuesFor('left-alone')[0].at < 0);
  // the crowd roars for a catch only once it is taken
  assert.ok(cuesFor('edged-caught')[2].at >= cuesFor('edged-caught')[1].at);
  // a ball that goes through has a 0.55 s tail (play.js); a later cue would never fire
  [...cuesFor('left-alone'), ...cuesFor('play-and-miss')].forEach((cue) => assert.ok(cue.at < 0.55, cue.sound));
});

test('applause is many separate hand claps, swelling then thinning', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const claps = clapTimes(3, 90, random);
  assert.ok(claps.length > 120 && claps.length < 240, `${claps.length} claps`);
  claps.forEach((clap, i) => {
    assert.ok(clap.at >= 0 && clap.at < 3);
    assert.ok(clap.length >= 0.006 && clap.length <= 0.018); // short bursts, not a wash of noise
    if (i > 0) assert.ok(clap.at >= claps[i - 1].at);
  });
  const inside = (from, to) => claps.filter((clap) => clap.at >= from && clap.at < to).length;
  assert.ok(inside(0.6, 1.2) > inside(0, 0.3) * 2); // builds
  assert.ok(inside(0.6, 1.2) > inside(2.6, 3) * 2); // thins out
  assert.ok(clapTimes(2, 11, random).length < clapTimes(2, 90, random).length / 4); // a pavilion ripple is sparse
});

test('the commentator has a line for every outcome and speaks the most dramatic', () => {
  const pairs = [['leave', 'safe'], ['leave', 'bowled'], ['play', 'middled'], ['play', 'edged_safe'], ['play', 'edged_caught'], ['play', 'missed'], ['play', 'missed_bowled']];
  pairs.forEach(([action, outcome]) => {
    const kind = kindOf({ action, outcome: outcomeLabel(outcome) });
    assert.equal(kind, animationFor(action, outcome).name);
    assert.ok(LINES[kind], kind);
  });
  assert.equal(LINES.bowled, 'Bowled him! Right through the gate, timber everywhere!');
  assert.equal(kindOf({ outcome: 'Play-and-miss, bowled' }), 'bowled');
  assert.equal(kindOf({ outcome: 'something new' }), null);
  assert.equal(mostDramatic(['middled', 'bowled', 'left-alone']), 'bowled');
  assert.equal(mostDramatic(['middled', 'edged-caught', 'edged-short']), 'edged-caught');
  assert.equal(mostDramatic(['middled', 'edged-short', 'play-and-miss']), 'edged-short');
  assert.equal(mostDramatic(['left-alone', 'play-and-miss', 'middled']), 'play-and-miss');
  assert.equal(mostDramatic(['left-alone', 'middled', 'left-alone']), 'middled');
  assert.equal(mostDramatic(['left-alone']), 'left-alone');
  assert.equal(mostDramatic([null, 'unknown']), null);
  assert.equal(mostDramatic([]), null);
});

test('the commentator prefers an English (UK) voice', () => {
  const us = { name: 'US', lang: 'en-US' };
  const uk = { name: 'UK', lang: 'en-GB' };
  assert.equal(pickVoice([us, uk]), uk);
  assert.equal(pickVoice([us, { name: 'Android UK', lang: 'en_GB' }]).name, 'Android UK');
  assert.equal(pickVoice([us]), null); // the browser's default voice
  assert.equal(pickVoice([]), null);
});

test('a boot replay paces its lines and lasts about three seconds', () => {
  const at = replaySchedule(4);
  assert.deepEqual(at.lines, [0, 500, 1000, 1500]);
  assert.ok(at.ready > at.lines[3]);
  assert.ok(at.wipe > at.ready);
  assert.equal(at.end - at.wipe, 420); // the CSS wipe
  assert.ok(Math.abs(at.end - 3000) <= 150, `${at.end} ms`);
});

test('every animation the page can play has sounds the synth knows', () => {
  const pairs = [['leave', 'safe'], ['leave', 'bowled'], ['play', 'middled'], ['play', 'edged_safe'], ['play', 'edged_caught'], ['play', 'missed'], ['play', 'missed_bowled']];
  pairs.forEach(([action, outcome]) => {
    const cues = cuesFor(animationFor(action, outcome).name);
    assert.ok(cues.length > 0, `${action}:${outcome}`);
    cues.forEach((cue) => assert.ok(soundNames.includes(cue.sound), cue.sound));
  });
  assert.ok(soundNames.includes('bounce') && soundNames.includes('chime'));
});

test('cuts between the three cameras at the right moments', () => {
  assert.deepEqual(cutAt(0), { id: 1, tag: 'CAM 1 // MARK', camera: 'stumps', punchIn: false });
  assert.equal(cutAt(0.79).id, 1);
  assert.deepEqual(cutAt(0.8), { id: 2, tag: 'CAM 2 // CREASE', camera: 'stumps', punchIn: false });
  assert.equal(cutAt(RELEASE - 0.001).id, 2);
  assert.deepEqual(cutAt(RELEASE), { id: 3, tag: 'CAM 3 // STUMP CAM', camera: 'stumps', punchIn: false });
  assert.equal(RELEASE, 1.35);
  // cut 3 lands on the preset the visitor chose
  assert.equal(cutAt(RELEASE, { camera: 'side' }).tag, 'CAM 3 // SIDE ON');
  assert.equal(cutAt(RELEASE, { camera: 'above' }).tag, 'CAM 3 // FROM ABOVE');
  assert.equal(cutAt(0.9, { camera: 'side' }).tag, 'CAM 2 // CREASE');
  assert.equal(cutAt(RELEASE, { camera: 'nonsense' }).tag, 'CAM 3 // STUMP CAM');
  // the close-up waits for the ball to arrive, and for an outcome to be known
  assert.equal(cutAt(2.5, { eventTime: 2.8 }).punchIn, false);
  assert.equal(cutAt(2.8, { eventTime: 2.8 }).punchIn, true);
  assert.equal(cutAt(9).punchIn, false);
  assert.equal(cutAt(0.5, { eventTime: 0.1 }).punchIn, false);
  // a ball left alone or missed has nothing to close in on: the wide frame follows it to the keeper
  assert.equal(cutAt(2.8, { eventTime: 2.8, through: true }).punchIn, false);
  // the side-on and from-above presets hold their wide frame
  assert.equal(cutAt(2.8, { eventTime: 2.8, camera: 'side' }).punchIn, false);
  assert.equal(cutAt(2.8, { eventTime: 2.8, camera: 'above' }).punchIn, false);
});

test('puts each camera where its cut says', () => {
  const home = CAMERAS.stumps;
  const scene = { side: 1, pitchLength: 20.12, ball: [0.3, 8, 1], impact: [0.3, 1.22, 0.6] };
  const mark = shotFor(cutAt(0), { ...scene, time: 0 });
  assert.equal(mark.position[1], 20.12 + 11); // 11 m behind the bowling crease
  assert.ok(shotFor(cutAt(0.7), { ...scene, time: 0.7 }).position[1] < mark.position[1]); // tracking in
  const crease = shotFor(cutAt(1), { ...scene, time: 1 });
  assert.deepEqual([Math.abs(crease.position[0]), crease.position[1]], [3.5, 20.12 - 1.5]);
  assert.equal(shotFor(cutAt(1), { ...scene, time: 1, side: -1 }).position[0], -crease.position[0]); // mirrored for a left-armer
  const live = shotFor(cutAt(2), { ...scene, time: 2 });
  assert.deepEqual(live.position, home.position);
  assert.ok(live.target[1] > home.target[1]); // leaning towards the ball
  assert.equal(live.fov, null);
  ['side', 'above'].forEach((camera) => {
    const shot = shotFor(cutAt(2, { camera }), { ...scene, time: 2 });
    assert.deepEqual([shot.position, shot.target, shot.fov], [CAMERAS[camera].position, CAMERAS[camera].target, null]);
  });
  const close = shotFor(cutAt(3, { eventTime: 2.9 }), { ...scene, time: 3 });
  assert.ok(close.position[1] > home.position[1] && close.target[1] === 1.22); // punched in on the bat
});

// Where a data point lands in a preset's picture: [-1, 1] on both axes is inside the frame.
function inPicture({ position, target, minHorizontalFov }, aspect, point) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const unit = (a) => a.map((v) => v / Math.hypot(...a));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const forward = unit(sub(target, position));
  const right = unit(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  const d = sub(point, position);
  if (dot(d, forward) <= 0) return [Infinity, Infinity]; // behind the camera
  const tanHalf = Math.tan((fovFor(aspect, minHorizontalFov) * Math.PI) / 360);
  return [dot(d, right) / dot(d, forward) / (tanHalf * aspect), dot(d, up) / dot(d, forward) / tanHalf];
}
const inside = (xy) => xy.every((v) => Math.abs(v) < 1);
const ASPECTS = [0.8, 0.9, 1.4, 2, 2.4]; // venue columns, the game view, a phone held either way

test('every camera preset frames the release, the bowler, the batter and the keeper plane', () => {
  const bowler = [-1.2, 1.2].flatMap((x) => [[x, 19.8, 0], [x, 18.4, 2.3]]); // both arms, from feet to raised hand
  const keep = [[0.45, 18.9, 2.1], [-0.45, 18.9, 2.1], ...bowler, [0, 0, 0], [0.3, KEEPER_Y, 0.6], [-0.9, 1.22, 1.9], [-0.9, 1.22, 0]];
  Object.entries(CAMERAS).forEach(([name, preset]) => ASPECTS.forEach((aspect) => keep.forEach((point) => {
    assert.ok(inside(inPicture(preset, aspect, point)), `${name} at ${aspect}: ${point}`);
  })));
  // the bowler stays below the camera tag along the top, and the batter and the top of the
  // wicket above the captions, which take the bottom fifth or so
  Object.entries(CAMERAS).forEach(([name, preset]) => ASPECTS.forEach((aspect) => {
    keep.slice(0, 6).forEach((point) => {
      assert.ok(inPicture(preset, aspect, point)[1] < 0.75, `${name} at ${aspect}: ${point}`);
    });
    [[-0.9, 1.22, 1.9], [-0.9, 1.22, 0], [0, 0, 0.71]].forEach((point) => {
      assert.ok(inPicture(preset, aspect, point)[1] > -0.55, `${name} at ${aspect}: ${point}`);
    });
  }));
});

test('the close-up keeps the whole batter, head included, and the wicket above the captions', () => {
  const scene = { side: 1, pitchLength: 20.12, ball: null };
  [[0.05, 0, 0.3], [0.3, 1.22, 0.6]].forEach((impact) => {
    const shot = shotFor(cutAt(3, { eventTime: 2.9 }), { ...scene, time: 3, impact });
    assert.equal(shot.fov, 34); // the preset lens, so the picture test below holds as written
    ASPECTS.forEach((aspect) => {
      [[-0.75, 1.22, 1.95], [-0.25, 1.22, 1.95], [-0.48, 1.22, 0]].forEach((point) => {
        const [x, y] = inPicture(shot, aspect, point);
        assert.ok(Math.abs(x) < 1 && y < 0.92 && y > -0.7, `${impact} at ${aspect}: batter ${point} at ${x.toFixed(2)}, ${y.toFixed(2)}`);
      });
      [[0.11, 0, 0.71], [-0.11, 0, 0.71]].forEach((point) => {
        const [x, y] = inPicture(shot, aspect, point);
        assert.ok(Math.abs(x) < 1 && y > -0.7, `${impact} at ${aspect}: wicket ${point} at ${x.toFixed(2)}, ${y.toFixed(2)}`);
      });
    });
  });
});

test('the cover fielder is out of the behind-the-stumps frame and in the other two', () => {
  const [x, y] = COVER;
  const body = [[x, y, 0], [x, y, 1.3], [x - 0.5, y, 0.6], [x + 0.5, y, 0.6]];
  ASPECTS.forEach((aspect) => body.forEach((point) => {
    assert.ok(!inside(inPicture(CAMERAS.stumps, aspect, point)), `stumps at ${aspect}`);
    assert.ok(inside(inPicture(CAMERAS.side, aspect, point)), `side at ${aspect}`);
    assert.ok(inside(inPicture(CAMERAS.above, aspect, point)), `above at ${aspect}`);
  }));
  assert.equal(fovFor(0.9), 34);
  assert.ok(fovFor(0.5) > 34); // a narrow view widens its lens
  assert.ok(fovFor(0.9, CAMERAS.side.minHorizontalFov) > 34);
});

test('from above also takes in the rope, the boards and the front of the stands', () => {
  // stadium.glb: rope 65 m, boards 67 m and stands from 72 m out from the middle of the pitch,
  // open for the venue's backdrop for 19 degrees either side of straight behind the bowler
  const middle = 20.12 / 2;
  const ring = (radius, z) => Array.from({ length: 360 }, (_, deg) => deg)
    .filter((deg) => Math.abs(((deg + 180) % 360) - 180) > 19)
    .map((deg) => [radius * Math.sin((deg * Math.PI) / 180), middle + radius * Math.cos((deg * Math.PI) / 180), z]);
  [['rope', ring(65, 0.1)], ['boards', ring(67, 0.5)], ['stands', ring(72, 1.5)]].forEach(([name, points]) => ASPECTS.forEach((aspect) => {
    const seen = points.filter((point) => inside(inPicture(CAMERAS.above, aspect, point)));
    assert.ok(seen.length >= 8, `${name} at ${aspect}: ${seen.length} degrees of it in frame`);
  }));
});

test('the batter stands on the leg side and never lets a corridor delivery through his body', () => {
  const corridor = [0.18, 0.2, 0.23, 0.25, 0.28];
  const bats = [0, -0.07, -0.16, 0.17]; // middled, edged, missed, bowled through the gap (outcomes.js)
  const files = [{}, { batLine: 0.6, bodyEdge: 0.25 }, { batLine: 0.8, bodyEdge: 0.1 }, { batLine: 0.7, bodyEdge: 0 }];
  corridor.forEach((ballX) => bats.forEach((bat) => files.forEach((file) => ['leave', 'play'].forEach((action) => {
    const edge = batterRootX(action, ballX + bat, file) + (file.bodyEdge ?? 0.25);
    assert.ok(edge <= BODY_LIMIT + 1e-9, `${action} ${ballX} ${bat} ${JSON.stringify(file)}: ${edge}`);
  }))));
  assert.equal(STANCE_X, -0.48);
  assert.equal(batterRootX('leave', 0.25), STANCE_X);
  assert.ok(Math.abs(batterRootX('play', 0.23) + 0.7 - 0.23) < 1e-9); // the bat face meets the line
  assert.equal(batterRootX('play', 0.6), BODY_LIMIT - 0.25); // a wide one is not chased into the line
  assert.ok(batterRootX('play', -2) >= -0.9); // nor one far down the leg side
});

test('a leave steps further to the leg side when the ball would pass through the body', () => {
  const reach = { batLine: 0.7, bodyEdge: 0.234, ballRadius: 0.036 };
  for (let ballX = -1.2; ballX <= 0.8; ballX += 0.01) {
    const root = batterRootX('leave', ballX, reach);
    const misses = ballX - reach.ballRadius >= root + reach.bodyEdge - 1e-9 || ballX + reach.ballRadius <= root - reach.bodyEdge + 1e-9;
    assert.ok(misses, `${ballX.toFixed(2)}: root ${root}`);
    assert.ok(root <= STANCE_X, `${ballX.toFixed(2)}: never steps towards the off side`);
  }
  assert.equal(batterRootX('leave', 0.2, reach), STANCE_X); // a corridor ball keeps the stance
  assert.equal(batterRootX('leave', -1, reach), STANCE_X); // so does one well clear down the leg side
  assert.ok(Math.abs(batterRootX('leave', -0.3, reach) - (-0.3 - 0.036 - 0.234)) < 1e-9); // just far enough to miss
});

test('a delivery left or missed runs on, with gravity, to the keeper plane', () => {
  const path = [[0.4, 1.2, 0.5], [0.41, 0.8, 0.55], [0.42, 0.4, 0.6], [0.43, 0, 0.65]];
  const copy = structuredClone(path);
  const longer = extendToKeeper(path);
  assert.deepEqual(path, copy); // the data is left alone
  assert.deepEqual(longer.slice(0, path.length), path);
  assert.equal(longer.at(-1)[1], KEEPER_Y);
  assert.equal(longer.length, path.length + 4);
  longer.slice(path.length).forEach(([x, y, z], i) => {
    const along = -y / 0.4; // the last segment carried on in a straight line
    assert.ok(Math.abs(x - (0.43 + 0.01 * along)) < 1e-9);
    const drop = 0.65 + 0.05 * along - z;
    assert.ok(drop > 0 && drop < 0.02, `${i}: ${drop}`); // gravity bends it down, a little
    assert.ok(y < longer[path.length + i - 1][1]);
  });
  assert.equal(extendToKeeper([[0, 1, 0.1], [0, 0, 0.01]], { floor: 0.036 }).at(-1)[2], 0.036); // not into the turf
  const passed = [[0, 0, 1], [0, -2, 1]];
  assert.equal(extendToKeeper(passed), passed);
});
