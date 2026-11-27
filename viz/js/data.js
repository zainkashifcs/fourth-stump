// Loads and checks data/trajectories.json (schema in data/SCHEMA.md).

const CONSTANTS = [
  'pitch_length', 'stump_half_width', 'stump_height', 'ball_radius',
  'bat_plane_y', 'bat_half_width', 'corridor_min', 'corridor_max',
];

function check(condition, message) {
  if (!condition) throw new Error(`trajectories.json: ${message}`);
}

const isPath = (path) =>
  Array.isArray(path) && path.length >= 2 && path.every((p) => Array.isArray(p) && p.length === 3);

export function validate(data) {
  check(data && typeof data === 'object', 'not an object');
  const constants = data.meta?.constants;
  check(constants, 'meta.constants is missing');
  CONSTANTS.forEach((key) => check(Number.isFinite(constants[key]), `meta.constants.${key} is missing`));
  check(data.venues && Object.keys(data.venues).length > 0, 'venues is empty');
  Object.entries(data.venues).forEach(([key, venue]) =>
    check(Array.isArray(venue.ends) && venue.ends.length > 0, `venues.${key}.ends is missing`));
  check(Array.isArray(data.ball_ages) && data.ball_ages.length > 0, 'ball_ages is empty');
  check(Array.isArray(data.arms) && data.arms.length > 0, 'arms is empty');
  check(Array.isArray(data.scenarios) && data.scenarios.length > 0, 'scenarios is empty');
  check(Array.isArray(data.game), 'game is missing');
  [...data.scenarios, ...data.game].forEach((d) => check(isPath(d.path), 'a delivery has no usable path'));
  return data;
}

// The file as it is on disk, unchecked: pass it to validate().
export async function fetchData(url = './data/trajectories.json') {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

export function findScenario(data, { venue, ballAge, arm, end }) {
  return data.scenarios.find(
    (s) => s.venue === venue && s.ball_age === ballAge && s.arm === arm && s.end === end,
  );
}

export const venueKeys = (data) => Object.keys(data.venues);

// The number of bowling ends every venue has (the `end` index is shared).
export const endCount = (data) => Math.min(...Object.values(data.venues).map((v) => v.ends.length));
