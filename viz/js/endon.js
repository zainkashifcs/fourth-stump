// End-on chart of the plane of the batter's stumps, seen from behind the
// stumps (off side on the right). The ball is drawn at its true size.
const SVG = 'http://www.w3.org/2000/svg';
const UNITS = 1000; // SVG units per metre
const STUMP_WIDTH = 0.035;

function el(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  if (text != null) node.textContent = text;
  return node;
}

// entries: [{ name, color, end: [x, z], fanEnds: [[x, z], ...] }]
export function renderEndOn(svg, constants, entries) {
  const {
    stump_half_width: halfWidth, stump_height: height, ball_radius: radius,
    corridor_min: corridorMin, corridor_max: corridorMax,
  } = constants;
  const all = entries.flatMap((entry) => [entry.end, ...entry.fanEnds]);
  const xMin = Math.min(-halfWidth - 0.25, ...all.map(([x]) => x - 0.1));
  const xMax = Math.max(corridorMax + 0.25, ...all.map(([x]) => x + 0.1));
  const zMax = Math.max(height + 0.3, ...all.map(([, z]) => z + 0.15));
  const labelRoom = 0.11; // space under the ground line for the side labels
  const X = (x) => (x - xMin) * UNITS;
  const Y = (z) => (zMax - z) * UNITS;
  const M = (metres) => metres * UNITS;

  svg.setAttribute('viewBox', `0 0 ${M(xMax - xMin)} ${M(zMax + labelRoom)}`);
  svg.replaceChildren();

  const corridorX = (corridorMin + corridorMax) / 2;
  svg.append(
    el('rect', { class: 'endon-corridor', x: X(corridorMin), y: 0, width: M(corridorMax - corridorMin), height: Y(0) }),
    el('text', { class: 'endon-label', x: X(corridorX), y: M(0.07), 'text-anchor': 'middle' }, 'Fourth-stump corridor'),
    el('line', { class: 'endon-ground', x1: 0, x2: M(xMax - xMin), y1: Y(0), y2: Y(0) }),
    el('text', { class: 'endon-label', x: M(0.03), y: Y(0) + M(0.075) }, 'Leg side'),
    el('text', { class: 'endon-label', x: M(xMax - xMin - 0.03), y: Y(0) + M(0.075), 'text-anchor': 'end' }, 'Off side'),
  );

  const outer = halfWidth - STUMP_WIDTH / 2;
  [-outer, 0, outer].forEach((x) => svg.append(el('rect', {
    class: 'endon-stump', x: X(x - STUMP_WIDTH / 2), y: Y(height), width: M(STUMP_WIDTH), height: M(height),
  })));
  svg.append(el('rect', {
    class: 'endon-stump', x: X(-halfWidth), y: Y(height) - M(0.018), width: M(2 * halfWidth), height: M(0.018),
  }));

  entries.forEach(({ color, fanEnds }) => fanEnds.forEach(([x, z]) => svg.append(el('circle', {
    class: 'endon-fan', cx: X(x), cy: Y(z), r: M(radius), stroke: color,
  }))));
  entries.forEach(({ color, end: [x, z] }) => svg.append(el('circle', {
    class: 'endon-mean', cx: X(x), cy: Y(z), r: M(radius), fill: color,
  })));
}
