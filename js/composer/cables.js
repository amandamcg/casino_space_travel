/**
 * Cables (Amanda, 2026-10-14: "add cabling to the composer... get in cable mode and see
 * what should be where in the room").
 *
 * Every cable starts or ends at the hub: the wheel's stand, which Amanda builds with a
 * door and the HP, the FM-1, the amp, the speaker and the power strip inside it (idea
 * 23, 2026-10-14). A run goes from its device to the nearest wall, along the baseboards
 * the shorter way round (past the built-in cabinet when it is on the way), and from the
 * wall over to the stand: that last leg is the only open floor it crosses. The lengths
 * are the routed inches plus slack, rounded up to feet, so they can be bought. Pure
 * maths, tested in Node; plan.js draws the runs.
 */

export const SLACK = 1.15; // a cable has to go round things and up to its socket

export const KINDS = {
  video: "HDMI",
  power: "mains",
  usb: "USB-C",
  audio: "audio",
};

/** Where the hub sits: the wheel's stand (the pedestal), everything inside it. */
export function hubPoint(layout) {
  return [layout.pedestal.x, layout.pedestal.y];
}

/** The wall outlet: on the west wall unless the layout says otherwise. */
export function outletPoint(layout, room) {
  const c = layout.cables || {};
  const y = Number.isFinite(c.outletY) ? c.outletY : 40;
  return [0, Math.max(0, Math.min(room.width, y))];
}

/** Distance along the room's perimeter, from the south-west corner going east. */
function along(room, [x, y]) {
  const { length: L, width: W } = room;
  if (y <= 0) return x; // south wall
  if (x >= L) return L + y; // east wall
  if (y >= W) return L + W + (L - x); // north wall
  return 2 * L + W + (W - y); // west wall
}

/** The point on the perimeter at that distance. */
function atAlong(room, s) {
  const { length: L, width: W } = room;
  const total = 2 * (L + W);
  s = ((s % total) + total) % total;
  if (s <= L) return [s, 0];
  if (s <= L + W) return [L, s - L];
  if (s <= 2 * L + W) return [L - (s - L - W), W];
  return [0, W - (s - 2 * L - W)];
}

/** The nearest point on the walls to a point in the room. */
export function nearestWall(room, [x, y]) {
  const { length: L, width: W } = room;
  const picks = [
    [x, 0, y],
    [L, y, L - x],
    [x, W, W - y],
    [0, y, x],
  ];
  picks.sort((a, b) => a[2] - b[2]);
  return [picks[0][0], picks[0][1]];
}

/**
 * A route from one point to another along the walls: out to the nearest wall, round the
 * shorter way (corners included), and in. Points are [x, y] in inches.
 */
export function wallRoute(room, from, to) {
  const a = nearestWall(room, from);
  const b = nearestWall(room, to);
  const total = 2 * (room.length + room.width);
  const sa = along(room, a);
  const sb = along(room, b);
  const forward = (sb - sa + total) % total;
  const dir = forward <= total / 2 ? 1 : -1;
  const span = dir === 1 ? forward : total - forward;
  const points = [from, a];
  // Corners passed on the way, in order.
  const corners = [0, room.length, room.length + room.width, 2 * room.length + room.width];
  const passed = corners
    .map((c) => ({ c, d: dir === 1 ? (c - sa + total) % total : (sa - c + total) % total }))
    .filter(({ d }) => d > 0 && d < span)
    .sort((p, q) => p.d - q.d);
  for (const { c } of passed) points.push(atAlong(room, c));
  points.push(b, to);
  // Drop repeats, so a device on a wall does not get a zero-length leg.
  return points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.01);
}

export function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return len;
}

/** Inches on the plan to feet to buy, with slack, whole feet. */
export function feetFor(inches) {
  return Math.ceil((inches * SLACK) / 12);
}

/**
 * Every run in the room: { name, kind, points, inches, feet, floor }, `floor` being the
 * inches of open floor the run crosses (its legs off the walls, outside the stand).
 */
export function cableRuns(layout, room) {
  const hub = hubPoint(layout);
  const outlet = outletPoint(layout, room);
  const runs = [];
  const add = (name, kind, points) => {
    let floor = 0;
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const q = points[i];
      const onWall = (p[0] === q[0] && (p[0] === 0 || p[0] === room.length)) || (p[1] === q[1] && (p[1] === 0 || p[1] === room.width));
      if (!onWall) floor += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    const inches = polylineLength(points);
    runs.push({ name, kind, points, inches, feet: feetFor(inches), floor: Math.round(floor) });
  };
  add("Strip in the stand to the wall outlet", "power", wallRoute(room, hub, outlet));
  // The lava lamps' own strip, behind the cabinet's counter, into the same outlet
  // (Amanda, 2026-10-14).
  if (layout.lamps && layout.lamps.length) {
    const mx = layout.lamps.reduce((s, l) => s + l.x, 0) / layout.lamps.length;
    const behind = [Math.max(0, Math.min(room.cabinet.length, mx)), 1];
    add("Lava lamps' strip to the wall outlet", "power", wallRoute(room, behind, outlet));
  }
  layout.projectors.forEach((p, i) => {
    const who = p.name || `Projector ${i + 1}`;
    add(`HP to ${who}`, "video", wallRoute(room, hub, [p.x, p.y]));
    add(`${who} to the strip`, "power", wallRoute(room, [p.x, p.y], hub));
  });
  // Inside the stand, no run to buy: the toy's wires, the FM-1's USB-C, the amp's leads.
  add("Toy to the HP, in the stand", "audio", [hub, hub]);
  add("HP to the FM-1, in the stand", "usb", [hub, hub]);
  add("FM-1 to the amp to the speaker, in the stand", "audio", [hub, hub]);
  return runs;
}

export const KIND_INDEX = { video: 0, power: 1, usb: 2, audio: 3 };
export const MAX_SEGMENTS = 32; // the shader's uniform budget is tight: a vec4 a piece

/**
 * The runs as straight pieces for the room picture: { seg: [x1, y1, x2, y2, ...],
 * kind: [k, ...], kind4: [...] } with k from KIND_INDEX, zero-length pieces left out, at
 * most MAX_SEGMENTS of them; kind4 is the kinds padded to a multiple of four, for the
 * shader to take four to a slot.
 */
export function cableSegments(layout, room) {
  const seg = [];
  const kind = [];
  // A point on a wall is drawn a hair inside it, so the run shows on the floor.
  const IN = 1.5;
  const off = ([x, y]) => [x <= 0 ? IN : x >= room.length ? room.length - IN : x, y <= 0 ? IN : y >= room.width ? room.width - IN : y];
  for (const r of cableRuns(layout, room)) {
    for (let i = 1; i < r.points.length && kind.length < MAX_SEGMENTS; i++) {
      const [x1, y1] = off(r.points[i - 1]);
      const [x2, y2] = off(r.points[i]);
      if (Math.hypot(x2 - x1, y2 - y1) < 0.5) continue;
      seg.push(x1, y1, x2, y2);
      kind.push(KIND_INDEX[r.kind]);
    }
  }
  const kind4 = kind.slice();
  while (kind4.length % 4 || kind4.length < MAX_SEGMENTS) kind4.push(0);
  return { seg, kind, kind4 };
}

/** The shopping lines: one per cable, longest first. */
export function cableList(layout, room) {
  return cableRuns(layout, room)
    .map((r) => ({ ...r, cable: KINDS[r.kind] }))
    .sort((a, b) => b.feet - a.feet);
}
