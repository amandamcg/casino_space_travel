// Room composer: the room, the things you can place in it, and the math that
// turns a layout into what the picture needs. No DOM here, so Node can test it
// (tests/js/composer.test.mjs).
//
// Units are inches. +X is east, +Y is north, +Z is up. Angles are degrees,
// counter-clockwise from east when seen from above (0 = east, 90 = north).

import { coverScale, ellipseOutline, LINKS, makeBackground, normalizeCalibration, normalizeVariant, OUTPUT_WIDTH, polygonArea, randomVariant } from "../mapping.js";
import { cableSegments } from "./cables.js";

// The show's picture, in pixels. A spot's look is worked out in these, as the show does.
const SHOW_W = 1024;
const SHOW_H = 768;

// The room itself. EVERY NUMBER IS AN ESTIMATE from photos (docs/room.md);
// change them here when the room is measured and everything else follows.
export const ROOM = {
  length: 132, // west to east: 11 ft (Amanda's call, 2026-10-07, from her counts along the south wall)
  width: 108, // south to north
  height: 108,
  closet: 24, // square closet bump in the north-east corner, full height
  // South-west corner. Its east end is about three folding chairs (3 x 18.5 in) short of
  // the east wall (Amanda, 2026-10-07, from her photos), so 132 - 55: about 77 in, which
  // also fits her count of 5 to 6 laptops along it.
  cabinet: { length: 77, depth: 24, height: 36, shelfDepth: 8, shelfHeight: 45 },
  entry: { from: 0, to: 25, height: 79 }, // doorway on the north wall, measured from the west wall
  eastDoor: { from: 36, to: 72, height: 80 }, // doorway on the east wall, measured from the south wall
  eastWindow: { from: 3, to: 32, sill: 36, head: 80 }, // cutout window on the east wall, from the south wall
  // Curtains, each hanging a little wider than its opening, from the floor. All white for
  // now (Amanda, 2026-10-05); "grey" and "red" are her real ones. The window has its own
  // (Amanda, 2026-10-05), not one curtain across the whole east wall.
  entryCurtain: { color: "white" },
  eastCurtain: { height: 104, color: "white" }, // over the east doorway
  windowCurtain: { height: 84, color: "white" }, // over the cutout window
};

export const CURTAIN_PAST = 2; // how far a curtain hangs past each side of its opening
export const CURTAIN_COLORS = {
  white: [0.82, 0.82, 0.8],
  grey: [0.38, 0.38, 0.39],
  red: [0.42, 0.04, 0.05],
};

export const MAX_PROJECTORS = 4;
export const MAX_MIRRORS = 12;
export const MAX_BOXES = 48;
export const MAX_DISCS = 20; // the wheel's three, and two for each lava lamp
export const MAX_LAVA = 8;
export const MAX_BALLS = 4; // disco balls
export const PATH_STEPS = 24; // straight pieces the path on the floor is drawn and lit as
export const MAX_SPOTS = 12;
export const MAX_REGIONS_DRAWN = MAX_SPOTS * 2; // outlines the picture can show at once, over all projectors
export const LAYOUT_VERSION = 1;

// Projectors offered in the panel: name, throw ratio (distance / picture width), rated
// lumens, and picture shape (height / width: 0.75 is 4:3, 0.625 is 16:10).
// The last three are the used short-throws from the 2026-10-05 price check (SHOPPING.md).
//
// `lift` is how far the middle of the picture sits above the line the lens points along, as
// a share of the picture's height. A projector does not throw its picture centred on where
// it points: it throws it upward, so that standing on a table it clears the table. 0.5
// would put the picture's bottom edge level with the lens; 0 is centred. Only the BenQ's is
// from its manual (bottom edge 15% of the height above the lens, so 0.65). The others are
// the usual figure for this kind of projector and are NOT checked.
//
// `size` is the body: width across, depth front to back, height; inches, rounded from the
// makers' spec sheets as remembered, so about right but not checked against a tape.
export const USUAL_LIFT = 0.6;
export const USUAL_BODY = [12, 9, 4];
export const LENSES = [
  { id: "pa503x", name: "ViewSonic PA503X", tr: 1.96, lm: 3800, aspect: 0.75, lift: USUAL_LIFT, size: [11.6, 8.6, 4.3] },
  { id: "ex5210", name: "Epson EX5210", tr: 1.48, lm: 2800, aspect: 0.75, lift: USUAL_LIFT, size: [11.7, 9.2, 3.1] },
  { id: "short", name: "Short-throw (0.55)", tr: 0.55, lm: 3200, aspect: 0.75, lift: USUAL_LIFT, size: USUAL_BODY },
  { id: "epson520", name: "Epson PowerLite 520", tr: 0.55, lm: 2700, aspect: 0.75, lift: USUAL_LIFT, size: [13.6, 12.4, 3.7] },
  { id: "benq819", name: "BenQ MX819ST", tr: 0.61, lm: 3000, aspect: 0.75, lift: 0.65, size: [11.1, 8.7, 3.7] },
  { id: "infocus126", name: "InFocus IN126STa", tr: 0.52, lm: 3300, aspect: 0.625, lift: USUAL_LIFT, size: [11.9, 8.9, 4] },
];

// Mirror sizes offered in the panel, in inches. The IKEA sizes are from ikea.com/us
// (checked 2026-10-05); the first is also about what a thrifted full-length mirror measures.
export const MIRROR_SIZES = [
  { id: "floor", name: "Floor mirror 16 x 59 (IKEA NISSEDAL, common thrift size)", short: "Floor mirror", width: 15.75, height: 59 },
  { id: "wide", name: "Wide floor mirror 26 x 59 (IKEA NISSEDAL)", short: "Wide mirror", width: 25.625, height: 59 },
  { id: "tall", name: "Large mirror 31 x 77 (IKEA HOVET)", short: "Large mirror", width: 30.75, height: 77.125 },
  // Amanda's 40 by 30 in glass mirror (got 2026-10-06, about 10 lb, to be leaned, not
  // mounted): a Furnbar wall mirror with rounded corners and a thin black metal frame,
  // a slight scratch on one side. Standing on its short side; type width 40 and top edge
  // 30 to lay it the long way. The rounded corners are not drawn.
  { id: "amanda", name: "Amanda's mirror 30 x 40 (glass, leaned)", short: "Amanda's mirror", width: 30, height: 40, frame: 0.6 },
  // Her second mirror (got 2026-10-07, measured 2026-10-12): about 26 by 30, with a 2 in
  // frame. Standing on its short side.
  { id: "amanda2", name: "Amanda's second mirror 26 x 30, 2 in frame", short: "Second mirror", width: 26, height: 30, frame: 2 },
  // Her small mirror (got 2026-10-12): about 8 by 12 with a 1 in frame. Small enough to
  // stand on the cabinet or a shelf; it stands on its short side here.
  { id: "amanda3", name: "Amanda's small mirror 8 x 12, 1 in frame", short: "Small mirror", width: 8, height: 12, frame: 1 },
  // Her convex mirror (found 2026-10-19): about 36 by 24, a bike or child-seat mirror with
  // no frame, its middle standing about 1 in proud of its edge. Laid the long way.
  { id: "convex", name: "Amanda's convex mirror 36 x 24, bulges 1 in", short: "Convex mirror", width: 36, height: 24, bulge: 1 },
  { id: "custom", name: "Custom, starts at 24 x 72", short: "Mirror", width: 24, height: 72 },
  // A small reflector spot. Hung flat on a wall, not leaning: `bottom` is how high it hangs.
  { id: "bath", name: "Small bathroom mirror 16 x 20, hung on a wall", short: "Bathroom mirror", width: 16, height: 20, bottom: 48, onWall: true },
];

// The standard spot (Amanda, 2026-10-07): a rock. The lampshades will be shaped like her
// rocks, so a spot is half a rock fixed to a wall, flat side on the wall, its dome in the
// room: an oval dome `base` wide, `top` tall and `depth` deep, in inches, hung `height` up.
// The sizes are a guess until she has made one.
export const SHADE = { base: 12, top: 9, depth: 6, height: 56, color: [0.86, 0.85, 0.82] };

// A disco ball (Amanda found two 8 in ones, 2026-10-19): a ball of little square mirror
// tiles, hung from the ceiling with its middle `height` up. `tile` is a tile's width.
export const BALL = { size: 8, height: 84, tile: 0.75 };

/** A disco ball: (x, y) under its middle, z the height of its middle, `size` across. */
export function makeBall(place = {}) {
  return { id: newId("b"), name: "Disco ball", x: 66, y: 54, z: BALL.height, size: BALL.size, ...place };
}

// Amanda's scanned rocks (img/rocks/, see its README): each spot wears one, as the
// experience page's stones do, so a rock on the wall looks like a rock and the projection
// lands on its skin. `shapes.json` there gives each one's outline.
export const ROCKS = 25;
export const rockFile = (i) => `img/rocks/rock-${String(i + 1).padStart(2, "0")}.jpg`;

/** How tall a rock is for its width, from its outline (64 radii round the compass). */
export function rockAspect(shape) {
  const r = shape && shape.r;
  if (!r || r.length < 64) return SHADE.top / SHADE.base;
  return (r[16] + r[48]) / (r[0] + r[32]);
}

// Picture shapes offered for a projector.
export const SHAPES = [
  [0.75, "4:3"],
  [0.625, "16:10"],
  [0.5625, "16:9"],
];

const WALL = [0.8, 0.8, 0.78];
const CEILING = [0.74, 0.74, 0.72];
const FLOOR = [0.1, 0.095, 0.09];
const CABINET = [0.7, 0.68, 0.62];
const PEDESTAL = [0.6, 0.6, 0.58];
// The toy on the pedestal, from Amanda's photo of it on a sheet of letter paper
// (2026-10-05, baked into img/toy.png by tools/toy_photo.py). All in inches, in the
// pedestal's own frame: x toward the player, y to the player's left, from the middle of
// the pedestal's top. Widths are read off the photo, give or take a quarter inch. The
// heights are guesses: the photo looks straight down.
export const WHEEL = {
  radius: 2.48,
  rim: 0.6,
  thick: 0.6,
  hub: 0.95,
  spoke: 0.4, // half the width of a spoke
  spokeAngle: 76, // the first spoke; the others are a third of a turn on
  forward: 1.64, // the wheel's middle, from the middle of the base
  side: -0.46,
  lift: 3, // the wheel is this far above the pedestal's top
  turn: 180, // the toy's own turn on the pedestal: 180 puts the wheel on the far side from the visitor (Amanda, 2026-10-05)
  base: { x0: -3.72, x1: 3.72, y0: -4.0, y1: 3.5, height: 2 },
  photo: { x0: -4.11, y0: -4.6, width: 8.69, height: 8.53 }, // where the photo's crop lies
  post: [0.25, 0.5, 0.68], // the blue column under the wheel
};
// A path on the floor from the east doorway to the north doorway, for the visitor to walk
// along (Amanda, 2026-10-06: "the visitor could walk from one door to the other along a
// path on the floor. it should arc between the two doors"; in by the east doorway, out
// by the north one). A curve from the middle of one doorway to the middle of the other,
// bowed into the room (`bulge` inches off the straight line at the middle, toward the
// south-west; below zero bows it the other way).
export const PATH = { width: 24, bulge: 36, color: [0.5, 0.49, 0.45] };

/** The path's ends and its bow: a quadratic curve's three points, in room inches. */
export function pathShape(layout, room = ROOM) {
  const p = layout.path || PATH;
  const a = [room.length, (room.eastDoor.from + room.eastDoor.to) / 2]; // the east doorway, the way in
  const b = [(room.entry.from + room.entry.to) / 2, room.width]; // the north doorway, the way out
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const chord = normalize([b[0] - a[0], b[1] - a[1], 0]);
  // Across the chord, toward the middle of the room (away from the closet corner).
  let inward = [chord[1], -chord[0]];
  if (inward[0] * (room.length / 2 - mid[0]) + inward[1] * (room.width / 2 - mid[1]) < 0) inward = [-inward[0], -inward[1]];
  // The curve passes `bulge` off the chord at its middle, so the control point is twice that out.
  const bulge = num(p.bulge, PATH.bulge);
  const c = [mid[0] + inward[0] * 2 * bulge, mid[1] + inward[1] * 2 * bulge];
  return { a, b, c };
}

/** A point along the path: s from 0 at the east doorway to 1 at the north doorway. */
export function pathPoint(layout, s, room = ROOM) {
  const { a, b, c } = pathShape(layout, room);
  const u = clamp(s, 0, 1);
  const w = 1 - u;
  return [w * w * a[0] + 2 * w * u * c[0] + u * u * b[0], w * w * a[1] + 2 * w * u * c[1] + u * u * b[1]];
}

/** Which way the path runs at s, in degrees, heading toward the north doorway. */
export function pathHeading(layout, s, room = ROOM) {
  const { a, b, c } = pathShape(layout, room);
  const u = clamp(s, 0, 1);
  const dx = 2 * (1 - u) * (c[0] - a[0]) + 2 * u * (b[0] - c[0]);
  const dy = 2 * (1 - u) * (c[1] - a[1]) + 2 * u * (b[1] - c[1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** The path as straight pieces, for the plan and the picture. */
export function pathPolyline(layout, room = ROOM, steps = PATH_STEPS) {
  return Array.from({ length: steps + 1 }, (_, i) => pathPoint(layout, i / steps, room));
}

// Walking about: how close to a wall or a thing a person can stand, in inches.
export const WALK_CLEARANCE = 7;

/**
 * Where a walking visitor ends up asking to go from `from` to `to`: inside the room and
 * not inside the cabinet, the closet, the pedestal or the bench. Blocked one way, they
 * slide along the other, as in a game.
 */
export function walkTo(layout, from, to, room = ROOM) {
  const c = WALK_CLEARANCE;
  // Anything above ankle height and below head height is in the way; people are not.
  const solid = sceneBoxes(layout, room).filter((b) => b.kind === 0 && !b.visitor && b.max[2] > 3 && b.min[2] < 60);
  const free = ([x, y]) => {
    if (x < c || x > room.length - c || y < c || y > room.width - c) return false;
    for (const b of solid) {
      const [cx, cy, cs, sn] = b.turn || [0, 0, 1, 0];
      const lx = cs * (x - cx) + sn * (y - cy) + cx;
      const ly = -sn * (x - cx) + cs * (y - cy) + cy;
      if (lx > b.min[0] - c && lx < b.max[0] + c && ly > b.min[1] - c && ly < b.max[1] + c) return false;
    }
    return true;
  };
  if (free(to)) return to;
  if (free([to[0], from[1]])) return [to[0], from[1]];
  if (free([from[0], to[1]])) return [from[0], to[1]];
  return from;
}

/**
 * How many projectors wide a still is: 1 for the usual 4:3 picture, 2 for one drawn
 * across two projectors (8:3), and so on. From the picture's own shape.
 */
export function stillWindows(width, height, aspect = 0.75) {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.max(1, Math.round((width / height) * aspect));
}

/** The visitor, stood on the path at `along` and facing along it; off the path, unchanged. */
export function placeOnPath(layout, room = ROOM) {
  const v = layout.visitor;
  if (!layout.path || !layout.path.on || !(v.along >= 0)) return v;
  const [x, y] = pathPoint(layout, v.along, room);
  return { ...v, x, y, yaw: wrapDeg(pathHeading(layout, v.along, room)) };
}

// Lava lamps (Amanda, 2026-10-06: six on the lower part of the cabinet). Each is a dark
// base with a glowing glass above it, standing on whatever is under it. The glass gives
// light all round like a dim bulb; a lava lamp's 25 to 40 W bulb is mostly swallowed by
// the coloured wax, so `lumens` is what gets out, a guess. Inches.
export const LAVA = {
  base: 2.2, // radius of the metal base
  baseHeight: 5,
  glow: 1.8, // radius of the glass
  glowTop: 15, // from what it stands on to the top of the glass
  lumens: 40,
};
export const LAVA_COLORS = {
  orange: [1, 0.42, 0.08],
  red: [1, 0.12, 0.08],
  pink: [1, 0.3, 0.6],
  purple: [0.62, 0.2, 1],
  blue: [0.2, 0.42, 1],
  green: [0.25, 1, 0.3],
  yellow: [1, 0.85, 0.2],
};

export function makeLava(place = {}) {
  const l = { id: newId("l"), name: "Lava lamp", x: 20, y: 16, color: "orange", lumens: LAVA.lumens, ...place };
  l.z = restingPlace(l.x, l.y, ROOM).top;
  return l;
}

/** A lamp stands on whatever is under it; moving one keeps it on the surface. */
export function moveLava(l, x, y, room = ROOM) {
  return { ...l, x, y, z: restingPlace(x, y, room).top };
}

// The message card on the pedestal and the book light. The card lies flat between the toy
// and the visitor. Sizes are guesses:
// an index card, and a clip-on book light. The words and the brightness are Amanda's to set.
export const CARD = {
  width: 5,
  depth: 3,
  edge: 0.5, // gap between the card and the pedestal's edge
  // The light stands on the far side from the visitor and leans over the toy, so it lights
  // the toy and the card (Amanda, 2026-10-05). How far in from the far edge the light is,
  // how high above the top, and how far past the middle it is aimed.
  lampBack: 2.1,
  lampHeight: 9,
  lampAim: 2.5,
  paper: [0.86, 0.84, 0.78],
  message: "Turn the wheel", // a stand-in until Amanda writes the real words
  lumens: 10,
  warm: [1.0, 0.8, 0.56], // the light's colour
};
const BODY = [0.5, 0.5, 0.54]; // the visitor: plain light grey so they show up in a mirror
const HEAD = [0.66, 0.63, 0.6];
const HEAD_HEIGHT = 10;
const EYE_FORWARD = 3.5; // the eyes sit at the front of the head, not its middle
// The visitor: one person standing at the wheel. A bench for two more can be placed
// anywhere (Amanda, 2026-10-06: "a standing person and or 2 people on a small bench"), and
// the picture can be seen from the wheel or from the bench. Inches, guesses for adults.
export const VISITOR = { wide: 18, deep: 9, headWide: 7 };
// As small as is reasonable for two close friends, or one person (Amanda, 2026-10-06):
// two sets of shoulders just fit along it, and it is shallow and low.
export const BENCH = {
  width: 36, // along the seat: two people, touching
  depth: 12,
  seat: 17, // seat height; the slab is 2 in thick
  eye: 45, // eye height sitting on it; a low lawn chair would be nearer 40
  top: 50, // top of the head
  lap: 21, // the top of the thighs
  knees: 18, // how far the lap reaches in front of the seat's front edge
  people: 2,
  color: [0.45, 0.4, 0.34],
};

/** Where a sitter's head is over the bench: the sitter a quarter of the way in from an end (k = 1 is the left one as they face). */
export function sitterHead(b, k) {
  const a = rad(b.angle);
  const back = -BENCH.depth / 2 + VISITOR.deep / 2; // they sit at the back of the seat
  const off = (k * BENCH.width) / 4;
  return [b.x - Math.sin(a) * off + Math.cos(a) * back, b.y + Math.cos(a) * off + Math.sin(a) * back];
}

/** The bench's eye: the sitter on the left as they face, at the front of their head. */
export function benchEye(b) {
  const [hx, hy] = sitterHead(b, 1);
  return [hx + Math.cos(rad(b.look)) * EYE_FORWARD, hy + Math.sin(rad(b.look)) * EYE_FORWARD, BENCH.eye];
}

/** Where the picture is seen from, and which way: the visitor at the wheel, or the bench. */
export function viewPoint(layout) {
  const b = layout.bench;
  if (layout.view.from === "bench" && b && b.on) return { eye: benchEye(b), yaw: b.look, pitch: b.pitch };
  const v = layout.visitor;
  return { eye: eyePoint(v), yaw: v.yaw, pitch: v.pitch };
}
export const SURFACES = { WALL, CEILING, FLOOR };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const rad = (deg) => (deg * Math.PI) / 180;

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Forward, right and up of something aimed by yaw and pitch (degrees). */
export function aimBasis(yaw, pitch) {
  const y = rad(yaw);
  const p = rad(pitch);
  const f = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];
  const r = normalize([f[1], -f[0], 0]);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}

// How high a projector's lens is above whatever it sits on.
// A projector never floats (Amanda, 2026-10-05): it sits on the floor, or on the cabinet
// when it is over it, or on a pedestal of a typed height standing on one of those. Its
// body is drawn at its real size, so the pedestal it needs can be seen.
const FEET = 0.6; // from what the projector sits on to the bottom of its body

/** The surface under a spot on the plan: { on: "floor" | "cabinet" | "cabinet shelf", top }. */
export function restingPlace(x, y, room = ROOM) {
  const cab = room.cabinet;
  if (x >= 0 && x <= cab.length && y >= 0 && y <= cab.depth) {
    if (y <= cab.shelfDepth) return { on: "cabinet shelf", top: cab.shelfHeight };
    return { on: "cabinet", top: cab.height };
  }
  return { on: "floor", top: 0 };
}

export const SUPPORTS = [
  ["floor", "the floor, or the cabinet when over it"],
  ["pedestal", "a pedestal (type its height below)"],
];

/** How far a projector's lens is above what its feet stand on: halfway up its body. */
export function lensAbove(p) {
  return FEET + num(p.height, USUAL_BODY[2]) / 2;
}

/** The top of whatever a projector's feet stand on. */
export function standTop(p, room = ROOM) {
  const top = restingPlace(p.x, p.y, room).top;
  return p.support === "pedestal" ? top + num(p.stand, room.cabinet.height) : top;
}

/** How high a projector's lens is, given what it sits on. */
export function lensHeight(p, room = ROOM) {
  return standTop(p, room) + lensAbove(p);
}

// Anything shorter than this under a projector is not a pedestal: it rests on the surface.
const NO_PEDESTAL = 4.5;

/**
 * What a projector sits on, as { support, stand }. Older layouts said "auto", "stand" (as
 * high as the cabinet) or "free" (a lens height typed in): those become the floor, or a
 * pedestal just high enough to put the lens where it was.
 */
function supportFor(p, room) {
  const usual = room.cabinet.height;
  if (p.support === "pedestal") return { support: "pedestal", stand: clamp(num(p.stand, usual), 0, room.height) };
  if (p.support === "floor" || p.support === "auto") return { support: "floor", stand: usual };
  const top = restingPlace(p.x, p.y, room).top;
  const wanted = p.support === "stand" ? usual - top : num(p.z, top + lensAbove(p)) - lensAbove(p) - top;
  if (wanted < NO_PEDESTAL) return { support: "floor", stand: usual };
  return { support: "pedestal", stand: clamp(wanted, 0, room.height) };
}

/** Move a projector on the plan; its height follows whatever it sits on. */
export function moveProjector(p, x, y, room = ROOM) {
  const moved = { ...p, x, y };
  return { ...moved, z: lensHeight(moved, room) };
}

/** A few words for where a projector sits, for the plan and the hints. */
export function supportName(p, room = ROOM) {
  const { on } = restingPlace(p.x, p.y, room);
  if (p.support !== "pedestal") return `the ${on}`;
  const tall = Math.round(num(p.stand, room.cabinet.height));
  return on === "floor" ? `a ${tall} in pedestal` : `a ${tall} in pedestal on the ${on}`;
}

let nextId = 1;
const newId = (prefix) => `${prefix}${nextId++}`;

export function makeProjector(lens = LENSES[0], place = {}) {
  const [width, depth, height] = lens.size || USUAL_BODY;
  const p = {
    id: newId("p"),
    name: lens.name,
    x: 72,
    y: 30,
    yaw: 90,
    pitch: 5,
    tr: lens.tr,
    lm: lens.lm,
    aspect: lens.aspect ?? 0.75,
    lift: 0, // centred unless told otherwise; the panel adds one with the lens's own lift
    width,
    depth,
    height,
    stand: ROOM.cabinet.height,
    ...place,
  };
  // On the floor unless told otherwise; a lens height given without a support becomes a
  // pedestal that puts the lens there.
  if (p.support === undefined && p.z === undefined) p.support = "floor";
  Object.assign(p, supportFor(p, ROOM));
  p.z = lensHeight(p);
  return p;
}

/** How far up the picture's middle is from where the lens points, as a slope (rise over run). */
function liftSlope(p) {
  return (num(p.lift, 0) * p.aspect) / p.tr;
}

/**
 * The line from a projector's lens to the middle of its picture: { dir, along }. `dir` is
 * that direction; `along` is how much of each inch along it counts as distance straight
 * out from the lens, which is what sets the picture's size and brightness.
 */
export function pictureAxis(p) {
  const { f, u } = aimBasis(p.yaw, p.pitch);
  const dir = normalize(add(f, scale(u, liftSlope(p))));
  return { dir, along: dot(dir, f) };
}

// How far a mirror leaned against a wall tips back, in degrees, when first added.
export const USUAL_LEAN = 6;

/**
 * A flat mirror standing on its bottom edge. `angle` is the direction its shiny side faces.
 * (x, y) is the middle of the bottom edge. `top - bottom` is the mirror's own height.
 * `tilt` leans it back, away from the way it faces, like a mirror propped against a wall.
 */
export function makeMirror(place = {}) {
  // Unless said, a mirror given a bottom edge off the floor is a hung one.
  return { id: newId("m"), name: "Mirror", x: 100, y: 40, angle: 180, width: 24, bottom: 0, top: 72, tilt: 0, bulge: 0, hung: (place.bottom ?? 0) > 0 ? 1 : 0, ...place };
}

/**
 * A floor-standing mirror stands on whatever is under it: the floor, or the cabinet's
 * counter or shelf when it is over them (Amanda, 2026-10-06: mirrors on the top part of
 * the cabinet). It keeps its own height. A hung mirror keeps the bottom edge it was given.
 */
export function standMirror(m, room = ROOM) {
  if (m.hung) return m;
  // The frame runs round the glass and below it, so a framed mirror's glass stands a
  // frame's width above whatever it rests on (Amanda, 2026-10-07: "it's in the floor").
  const bottom = restingPlace(m.x, m.y, room).top + (m.frame || 0);
  return { ...m, bottom, top: bottom + (m.top - m.bottom) };
}

/**
 * A rock spot on a wall: half a rock, flat side on the wall. (x, y) is the middle of that
 * flat side, z how high it is, `angle` the way the dome points (set by the wall it is on).
 * `base` is how wide the rock is across, `top` how tall, `depth` how far it sticks out.
 */
export function makeSpot(place = {}) {
  return {
    id: newId("s"),
    name: "Rock",
    x: 0,
    y: 54,
    z: SHADE.height,
    angle: 0,
    base: SHADE.base,
    top: SHADE.top,
    depth: SHADE.depth,
    rock: 0, // which scanned rock is projected onto it when the look's source is "rock"
    source: "rock",
    set: "",
    ...place,
  };
}

// A spot's look: which piece of the picture it shows and how it is coloured. These are the
// show's own settings for a mapped region (mapping.js calls them a variant), kept under the
// same names so a spot designed here can be handed to the real show unchanged. `spin` and
// `pulse` (how the piece moves against the wheel) are kept but not drawn here yet.
// A look's keys. `source` says whether the spot shows its rock, plain, or a coloured
// piece of the picture; a set shares it, as it shares the rest, while which rock each
// spot shows (`rock`) stays the spot's own.
export const LOOK_KEYS = ["hue", "zoom", "panX", "panY", "rotate", "flipX", "flipY", "invert", "spin", "pulse", "source"];

// Sets: spots in the same set share one look, as regions in the show do. "" is no set.
export const SETS = LINKS;

/** Give a spot's look to every other spot in its set. Call after changing that spot's look. */
export function spreadLook(layout, spot) {
  if (!spot.set) return;
  for (const other of layout.spots) {
    if (other === spot || other.set !== spot.set) continue;
    for (const k of LOOK_KEYS) other[k] = spot[k];
  }
}

/** A spot that has just been put in a set takes on the look that set already has, if any. */
export function adoptSetLook(layout, spot) {
  const other = spot.set ? layout.spots.find((x) => x !== spot && x.set === spot.set) : null;
  if (other) for (const k of LOOK_KEYS) spot[k] = other[k];
}

/** A look as the show holds it (a variant), from a spot or any object with the look's keys. */
export function spotLook(s) {
  return normalizeVariant({ ...s, flipX: Boolean(s.flipX), flipY: Boolean(s.flipY), invert: Boolean(s.invert) });
}

/** The look's keys as a spot holds them: yes and no are 1 and 0, so the panel can show them. */
function lookFields(variant) {
  const v = normalizeVariant(variant);
  const out = {};
  for (const k of LOOK_KEYS) if (k !== "source") out[k] = typeof v[k] === "boolean" ? Number(v[k]) : v[k];
  return out;
}

/** A look picked by chance, the way the show picks one for a new region. */
export function randomLook(random = Math.random) {
  return lookFields(randomVariant(random));
}

/** A look picked by chance but always the same for the same seed (a spot saved without one). */
function seededLook(seed) {
  let h = 9;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return randomLook(() => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  });
}

/**
 * Where in the picture a place on a spot looks, given the spot's look. (u, v) is the place
 * on the spot, each from 0 to 1 with v upward; the answer is the same for the picture.
 * This follows the show's own drawing (regions.js): crop for zoom and slide, mirror, turn,
 * and enlarge just enough that a turned picture still covers the spot. tracer.js has the
 * same sums.
 */
export function lookSource(look, u, v) {
  const k = spotLook(look);
  const rot = rad(k.rotate);
  const cover = k.rotate ? coverScale(k.rotate, SHOW_W, SHOW_H) : 1;
  const px = (u - 0.5) * SHOW_W; // pixels from the middle, y downward as on a canvas
  const py = (0.5 - v) * SHOW_H;
  const dx = (Math.cos(rot) * px + Math.sin(rot) * py) / ((k.flipX ? -1 : 1) * cover);
  const dy = (-Math.sin(rot) * px + Math.cos(rot) * py) / ((k.flipY ? -1 : 1) * cover);
  const edge = (1 - 1 / k.zoom) / 2;
  const su = edge * (1 + k.panX) + (dx / SHOW_W + 0.5) / k.zoom;
  const sd = edge * (1 + k.panY) + (dy / SHOW_H + 0.5) / k.zoom;
  return [su, 1 - sd];
}

/** The layout Amanda settled on 2026-10-04 (docs/room.md, third layout), with no mirrors. */
export function defaultLayout() {
  return {
    version: LAYOUT_VERSION,
    name: "",
    still: "",
    spotStill: "", // the picture on the spots; "" picks one that differs from the walls
    visitor: { x: 11, y: 45, eye: 63, height: 68, yaw: 31, pitch: 1, along: -1 },
    bench: { on: 0, x: 60, y: 90, angle: -60, look: -60, pitch: 2 },
    path: { on: 0, bulge: PATH.bulge, width: PATH.width },
    cables: { outletY: 40 }, // where the west-wall outlet is (cables.js draws the runs with the lights on)
    lamps: [],
    balls: [],
    pedestal: { x: 26, y: 54, size: 16, height: 34, angle: 0, sign: 1, message: CARD.message, lamp: CARD.lumens },
    projectors: [
      // Aimed as first agreed, when the picture was taken to be centred on the aim. With no
      // lift given, normalizeLayout gives each its lens's lift and tips it to keep the
      // picture where it was.
      makeProjector(LENSES[2], { name: "Short-throw on the cabinet", x: 40, y: 12, yaw: 54, pitch: 9, support: "floor", lift: undefined }),
      makeProjector(LENSES[0], { name: "PA503X on the floor", x: 130, y: 12, yaw: 122, pitch: 18, support: "floor", lift: undefined }),
    ],
    mirrors: [],
    spots: [],
    view: { fov: 100, brightness: 0, from: "visitor" },
  };
}

function wrapDeg(a) {
  const w = ((num(a, 0) % 360) + 360) % 360;
  return w > 180 ? w - 360 : w;
}

/** A clean, in-range copy of whatever was loaded. Unknown keys are dropped. */
export function normalizeLayout(raw, room = ROOM) {
  const base = defaultLayout();
  const src = raw && typeof raw === "object" ? raw : {};
  const inX = (v, d) => clamp(num(v, d), 0, room.length);
  const inY = (v, d) => clamp(num(v, d), 0, room.width);
  const inZ = (v, d) => clamp(num(v, d), 0, room.height);
  const v = src.visitor || {};
  const p = src.pedestal || {};
  const view = src.view || {};
  const b = src.bench || {};
  const out = {
    version: LAYOUT_VERSION,
    name: typeof src.name === "string" ? src.name.slice(0, 40) : "",
    still: typeof src.still === "string" ? src.still.slice(0, 40) : "",
    spotStill: typeof src.spotStill === "string" ? src.spotStill.slice(0, 40) : "",
    visitor: {
      x: inX(v.x, base.visitor.x),
      y: inY(v.y, base.visitor.y),
      eye: clamp(num(v.eye, 63), 30, 80),
      height: clamp(num(v.height, 68), 36, 84),
      yaw: wrapDeg(num(v.yaw, base.visitor.yaw)),
      pitch: clamp(num(v.pitch, 1), -60, 60),
      along: v.along >= 0 ? clamp(num(v.along, 0), 0, 1) : -1, // on the path, this far along; -1 is off it
    },
    path: {
      on: src.path && (src.path.on === 1 || src.path.on === true) ? 1 : 0,
      bulge: clamp(num(src.path?.bulge, PATH.bulge), -20, 70), // further either way leaves the room
      width: clamp(num(src.path?.width, PATH.width), 4, 60),
    },
    cables: { outletY: inY(src.cables?.outletY, base.cables.outletY) },
    pedestal: {
      x: inX(p.x, base.pedestal.x),
      y: inY(p.y, base.pedestal.y),
      size: clamp(num(p.size, 16), 6, 48),
      height: clamp(num(p.height, 34), 6, 60),
      angle: wrapDeg(num(p.angle, 0)),
      // The message card and book light: there or not, its words, and the light's lumens.
      sign: p.sign === 0 || p.sign === false ? 0 : 1,
      message: typeof p.message === "string" ? p.message.slice(0, 60) : CARD.message,
      lamp: clamp(num(p.lamp, CARD.lumens), 0, 200),
    },
    bench: {
      on: b.on === 1 || b.on === true ? 1 : 0,
      x: inX(b.x, base.bench.x),
      y: inY(b.y, base.bench.y),
      angle: wrapDeg(num(b.angle, base.bench.angle)),
      look: wrapDeg(num(b.look, num(b.angle, base.bench.angle))),
      pitch: clamp(num(b.pitch, 2), -60, 60),
    },
    projectors: [],
    mirrors: [],
    spots: [],
    lamps: [],
    balls: [],
    view: {
      fov: clamp(num(view.fov, 100), 40, 130),
      brightness: clamp(num(view.brightness, 0), -4, 4),
      from: view.from === "bench" ? "bench" : "visitor",
    },
  };
  const list = (a) => (Array.isArray(a) ? a : []);
  for (const q of list(src.projectors ?? base.projectors).slice(0, MAX_PROJECTORS)) {
    if (!q || typeof q !== "object") continue;
    const made = {
      id: typeof q.id === "string" && q.id ? q.id : newId("p"),
      name: typeof q.name === "string" ? q.name.slice(0, 40) : "Projector",
      x: inX(q.x, 72),
      y: inY(q.y, 30),
      z: inZ(q.z, 40),
      yaw: wrapDeg(q.yaw),
      pitch: clamp(num(q.pitch, 0), -80, 80),
      tr: clamp(num(q.tr, 1.96), 0.2, 4),
      lm: clamp(num(q.lm, 3000), 50, 20000),
      aspect: clamp(num(q.aspect, 0.75), 0.4, 1),
    };
    // Saved before bodies had sizes: its lens's body, if it is one from the list.
    const lens = LENSES.find((l) => l.tr === made.tr && l.lm === made.lm);
    const body = lens ? lens.size : USUAL_BODY;
    made.width = clamp(num(q.width, body[0]), 4, 30);
    made.depth = clamp(num(q.depth, body[1]), 4, 30);
    made.height = clamp(num(q.height, body[2]), 1.5, 12);
    if (Number.isFinite(q.lift)) {
      made.lift = clamp(q.lift, -1.5, 1.5);
    } else {
      // Saved before lift existed, when the picture was drawn centred on the aim. Give it
      // its lens's lift, and tip it down by the same angle so the picture stays where it
      // was put. The new "aims up" figure is how the real projector would have to sit.
      made.lift = lens ? lens.lift : USUAL_LIFT;
      made.pitch = clamp(made.pitch - (Math.atan(liftSlope(made)) * 180) / Math.PI, -80, 80);
    }
    Object.assign(made, supportFor({ ...made, support: q.support, stand: q.stand }, room));
    made.z = lensHeight(made, room);
    out.projectors.push(made);
  }
  for (const m of list(src.mirrors).slice(0, MAX_MIRRORS)) {
    if (!m || typeof m !== "object") continue;
    const bottom = inZ(m.bottom, 0);
    out.mirrors.push({
      id: typeof m.id === "string" && m.id ? m.id : newId("m"),
      name: typeof m.name === "string" ? m.name.slice(0, 40) : "Mirror",
      x: inX(m.x, 100),
      y: inY(m.y, 40),
      angle: wrapDeg(m.angle),
      width: clamp(num(m.width, 24), 4, 144),
      bottom,
      top: clamp(num(m.top, 72), bottom + 2, room.height),
      tilt: clamp(num(m.tilt, 0), 0, 30),
      frame: clamp(num(m.frame, 0), 0, 4), // a frame round the glass, this wide; 0 is none
      bulge: clamp(num(m.bulge, 0), 0, 12), // a convex mirror: how far its middle stands out past its edge; 0 is flat
      // Hung on a wall, or standing on its bottom edge. Saved before this was recorded, a
      // mirror off the floor was a hung one.
      hung: m.hung === undefined ? (bottom > 0 ? 1 : 0) : m.hung === 1 || m.hung === true ? 1 : 0,
    });
    out.mirrors[out.mirrors.length - 1] = standMirror(out.mirrors[out.mirrors.length - 1], room);
  }
  out.visitor = placeOnPath(out, room);
  for (const l of list(src.lamps).slice(0, MAX_LAVA)) {
    if (!l || typeof l !== "object") continue;
    const made = {
      id: typeof l.id === "string" && l.id ? l.id : newId("l"),
      name: typeof l.name === "string" ? l.name.slice(0, 40) : "Lava lamp",
      x: inX(l.x, 20),
      y: inY(l.y, 16),
      color: LAVA_COLORS[l.color] ? l.color : "orange",
      lumens: clamp(num(l.lumens, LAVA.lumens), 0, 400),
    };
    out.lamps.push(moveLava(made, made.x, made.y, room));
  }
  for (const b of list(src.balls).slice(0, MAX_BALLS)) {
    if (!b || typeof b !== "object") continue;
    const size = clamp(num(b.size, BALL.size), 2, 36);
    out.balls.push({
      id: typeof b.id === "string" && b.id ? b.id : newId("b"),
      name: typeof b.name === "string" ? b.name.slice(0, 40) : "Disco ball",
      x: inX(b.x, 66),
      y: inY(b.y, 54),
      z: clamp(num(b.z, BALL.height), size / 2, room.height - size / 2), // hung: it keeps the height it was given
      size,
    });
  }
  for (const [i, s] of list(src.spots).slice(0, MAX_SPOTS).entries()) {
    if (!s || typeof s !== "object") continue;
    const base = clamp(num(s.base, SHADE.base), 2, 36);
    const top = clamp(num(s.top, SHADE.top), 1, 36);
    const half = Math.max(base, top) / 2;
    const made = {
      id: typeof s.id === "string" && s.id ? s.id : newId("s"),
      name: typeof s.name === "string" ? s.name.slice(0, 40) : "Rock",
      x: inX(s.x, 0),
      y: inY(s.y, 54),
      z: clamp(num(s.z, SHADE.height), half, room.height - half),
      angle: 0,
      base,
      top,
      depth: clamp(num(s.depth, SHADE.depth), 1, 30),
      // Which rock it shows: its own by its place in the list unless it says. Whether it
      // shows the rock or the picture is the look's `source`, rock unless it says.
      rock: clamp(Math.round(num(s.rock, i % ROCKS)), 0, ROCKS - 1),
      source: s.source === "main" ? "main" : "rock",
      set: SETS.includes(s.set) ? s.set : "",
    };
    // Its look: the one it has, or one picked for it (the same one every time).
    const hasLook = LOOK_KEYS.some((k) => s[k] !== undefined);
    Object.assign(made, hasLook ? lookFields(spotLook(s)) : seededLook(`${made.id} ${made.x} ${made.y} ${made.z}`));
    // A spot always sits on a wall: the nearest one.
    out.spots.push(snapSpot(made, room).spot);
  }
  // Spots in a set share one look: the first one's.
  const first = {};
  for (const spot of out.spots) {
    if (!spot.set) continue;
    if (first[spot.set]) for (const k of LOOK_KEYS) spot[k] = first[spot.set][k];
    else first[spot.set] = spot;
  }
  return out;
}

/**
 * The looks in a saved layout, for the show to use: each spot's name and its look as the
 * show holds one (a variant). Only the looks are carried. Where a spot is belongs to the
 * room the layout describes, not to wherever a projector is standing now. A spot saved
 * before looks existed gets the same look the composer shows for it.
 */
export function looksFromLayout(raw, room = ROOM) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.spots)) return [];
  return normalizeLayout(raw, room).spots.map((s) => ({ name: s.name, variant: spotLook(s) }));
}

/** Centre, facing direction and edge direction of a mirror, as 3D vectors. */
export function mirrorPlane(m) {
  const a = rad(m.angle);
  const lean = rad(m.tilt || 0);
  const flat = [Math.cos(a), Math.sin(a), 0]; // the way it faces, ignoring the lean
  // Leaning back turns the face a little toward the ceiling.
  const n = [flat[0] * Math.cos(lean), flat[1] * Math.cos(lean), Math.sin(lean)];
  const t = [-flat[1], flat[0], 0]; // along the bottom edge
  const up = [-flat[0] * Math.sin(lean), -flat[1] * Math.sin(lean), Math.cos(lean)]; // up the glass
  // c is the middle of the bottom edge; the glass runs `len` up from there.
  return { c: [m.x, m.y, m.bottom], n, t, up, half: m.width / 2, len: m.top - m.bottom };
}

/**
 * A convex mirror as a piece of a ball: its glass bulges `bulge` in past its edge, so it is
 * the cap of a sphere through its corners. { radius, centre }: the centre lies behind the
 * glass on the axis through its middle. null for a flat mirror. The shader does the same
 * sums (hitMirror in tracer.js).
 */
export function mirrorBulge(m) {
  const b = num(m.bulge, 0);
  if (b <= 0) return null;
  const pl = mirrorPlane(m);
  const reach = Math.hypot(pl.half, pl.len / 2); // the middle of the glass to a corner
  const radius = (reach * reach + b * b) / (2 * b);
  const mid = add(pl.c, scale(pl.up, pl.len / 2));
  return { radius, centre: add(mid, scale(pl.n, b - radius)) };
}

/** Is a point that lies in a mirror's plane within its glass? */
export function onMirror(p, plane) {
  const q = sub(p, plane.c);
  const along = dot(q, plane.up);
  return Math.abs(dot(q, plane.t)) <= plane.half && along >= 0 && along <= plane.len;
}

/** The two ends of a mirror on the floor plan: [[x, y], [x, y]]. */
export function mirrorEnds(m) {
  const { c, t, half } = mirrorPlane(m);
  return [
    [c[0] - t[0] * half, c[1] - t[1] * half],
    [c[0] + t[0] * half, c[1] + t[1] * half],
  ];
}

/** Rebuild a mirror from two floor-plan ends, keeping the side it faces. */
export function mirrorFromEnds(m, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const width = Math.max(4, Math.hypot(dx, dy));
  // The edge direction t = (-n.y, n.x), so the facing direction n = (t.y, -t.x).
  const angle = (Math.atan2(-dx, dy) * 180) / Math.PI;
  return { ...m, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, width, angle: wrapDeg(angle) };
}

/**
 * Make a mirror wider or narrower by dragging one end along its own line. The other end
 * stays put and the mirror does not turn. end: 0 or 1, as in mirrorEnds(); point: [x, y].
 */
export function resizeMirror(m, end, point) {
  const [a, b] = mirrorEnds(m);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const fixed = end === 0 ? b : a;
  const sign = end === 0 ? -1 : 1;
  const reach = ((point[0] - fixed[0]) * t[0] + (point[1] - fixed[1]) * t[1]) * sign;
  const width = Math.min(144, Math.max(4, reach));
  return { ...m, width, x: fixed[0] + (sign * t[0] * width) / 2, y: fixed[1] + (sign * t[1] * width) / 2 };
}

export const reflectPoint = (p, plane) => sub(p, scale(plane.n, 2 * dot(sub(p, plane.c), plane.n)));
export const reflectVector = (v, plane) => sub(v, scale(plane.n, 2 * dot(v, plane.n)));

/** The walls a mirror can sit flat against: a point on the wall, and the way the wall faces. */
export function wallFaces(room = ROOM) {
  const c = room.closet;
  return [
    { name: "west wall", x0: 0, y0: 0, x1: 0, y1: room.width, facing: 0 },
    { name: "south wall", x0: 0, y0: 0, x1: room.length, y1: 0, facing: 90 },
    { name: "north wall", x0: 0, y0: room.width, x1: room.length - c, y1: room.width, facing: -90 },
    // skin: the curtain hanging in front of this wall is this thick.
    { name: "east wall", x0: room.length, y0: 0, x1: room.length, y1: room.width - c, facing: 180, skin: 1 },
    { name: "closet, west face", x0: room.length - c, y0: room.width - c, x1: room.length - c, y1: room.width, facing: 180 },
    { name: "closet, south face", x0: room.length - c, y0: room.width - c, x1: room.length, y1: room.width - c, facing: -90 },
  ];
}

/**
 * Does dragging this mirror near a wall put it on the wall? Only a mirror that hangs
 * (its bottom edge off the floor). A floor mirror stays wherever it is put (Amanda,
 * 2026-10-05).
 */
export const snapsToWall = (m) => Boolean(m.hung);

/**
 * If a mirror is nearly flat against a wall, put it exactly on the wall, facing into the room.
 * Returns the mirror (snapped or unchanged) and the name of the wall, if any.
 */
export function snapMirror(m, room = ROOM, reach = 5, slack = 14) {
  for (const w of wallFaces(room)) {
    const n = [Math.cos(rad(w.facing)), Math.sin(rad(w.facing))];
    const away = (m.x - w.x0) * n[0] + (m.y - w.y0) * n[1];
    // A leaning mirror's foot stands out from the wall so that its top edge touches.
    const foot = 0.6 + (m.top - m.bottom) * Math.sin(rad(m.tilt || 0));
    // Flat against the wall either way round: a mirror on a wall can only face the room.
    const turn = Math.min(Math.abs(wrapDeg(m.angle - w.facing)), Math.abs(wrapDeg(m.angle - w.facing - 180)));
    if (away < -reach || away > foot + reach || turn > slack) continue;
    const len = Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
    const dir = [(w.x1 - w.x0) / len, (w.y1 - w.y0) / len];
    const half = Math.min(m.width, len) / 2;
    const pos = clamp((m.x - w.x0) * dir[0] + (m.y - w.y0) * dir[1], half, len - half);
    return {
      mirror: {
        ...m,
        width: half * 2,
        angle: w.facing,
        x: w.x0 + dir[0] * pos + n[0] * foot,
        y: w.y0 + dir[1] * pos + n[1] * foot,
      },
      wall: w.name,
    };
  }
  return { mirror: m, wall: "" };
}

/**
 * Put a spot on the nearest wall, sticking straight out into the room. Returns the spot and
 * the name of the wall.
 */
export function snapSpot(s, room = ROOM) {
  let best = null;
  for (const w of wallFaces(room)) {
    const len = Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
    const dir = [(w.x1 - w.x0) / len, (w.y1 - w.y0) / len];
    const half = Math.min(Math.max(s.base, s.top), len) / 2;
    const pos = clamp((s.x - w.x0) * dir[0] + (s.y - w.y0) * dir[1], half, len - half);
    const x = w.x0 + dir[0] * pos;
    const y = w.y0 + dir[1] * pos;
    const far = Math.hypot(s.x - x, s.y - y);
    if (!best || far < best.far) best = { far, x, y, wall: w };
  }
  const { wall } = best;
  const skin = wall.skin || 0;
  return {
    spot: {
      ...s,
      x: best.x + Math.cos(rad(wall.facing)) * skin,
      y: best.y + Math.sin(rad(wall.facing)) * skin,
      angle: wall.facing,
    },
    wall: wall.name,
  };
}

/**
 * The place on a wall the visitor is looking at: { x, y, facing, name }. New things that
 * hang on a wall start there, so they show up in the picture straight away.
 */
export function wallAhead(layout, room = ROOM) {
  const v = layout.visitor;
  const d = [Math.cos(rad(v.yaw)), Math.sin(rad(v.yaw))];
  let best = null;
  for (const w of wallFaces(room)) {
    const ex = w.x1 - w.x0;
    const ey = w.y1 - w.y0;
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((w.x0 - v.x) * ey - (w.y0 - v.y) * ex) / den;
    const u = ((w.x0 - v.x) * d[1] - (w.y0 - v.y) * d[0]) / den;
    if (t <= 0 || u < 0 || u > 1) continue;
    if (!best || t < best.t) best = { t, x: v.x + d[0] * t, y: v.y + d[1] * t, wall: w };
  }
  if (!best) return { x: 0, y: room.width / 2, facing: 0, name: "west wall" };
  return { x: best.x, y: best.y, facing: best.wall.facing, name: best.wall.name };
}

/**
 * Solid things in the room as boxes: { min, max, albedo, kind, ref, turn }.
 * turn = [x, y, cos, sin] spins a box about a vertical line through (x, y); the min and max
 * are where the box sits before it is spun.
 */
export function sceneBoxes(layout, room = ROOM) {
  const { length: L, width: W, height: H, closet: c, cabinet: cab } = room;
  const boxes = [];
  const push = (min, max, albedo, kind = 0, ref = 0, turn = [0, 0, 1, 0]) => boxes.push({ min, max, albedo, kind, ref, turn });
  push([L - c, W - c, 0], [L, W, H], WALL);
  push([0, 0, 0], [cab.length, cab.depth, cab.height], CABINET);
  push([0, 0, cab.height], [cab.length, cab.shelfDepth, cab.shelfHeight], CABINET);
  const curtain = (name) => CURTAIN_COLORS[name] || CURTAIN_COLORS.white;
  const { eastDoor: door, eastWindow: win } = room;
  // Curtains are kind 5: cloth, drawn with soft folds and a little darker than the wall,
  // so they show on the wall whatever the light (Amanda, 2026-10-06).
  push([L - 1, door.from - CURTAIN_PAST, 0], [L, door.to + CURTAIN_PAST, room.eastCurtain.height], curtain(room.eastCurtain.color), 5);
  push([L - 1, win.from - CURTAIN_PAST, 0], [L, win.to + CURTAIN_PAST, room.windowCurtain.height], curtain(room.windowCurtain.color), 5);
  push([room.entry.from, W - 1, 0], [room.entry.to + 1, W, room.entry.height + 1], curtain(room.entryCurtain.color), 5);
  for (const b of boxes.slice(-3)) b.curtain = true;
  const p = layout.pedestal;
  const spin = [p.x, p.y, Math.cos(rad(p.angle)), Math.sin(rad(p.angle))];
  push([p.x - p.size / 2, p.y - p.size / 2, 0], [p.x + p.size / 2, p.y + p.size / 2, p.height], PEDESTAL, 0, 0, spin);
  // The toy's base (kind 3: the photo shows on it, and the pedestal's colour where the
  // photo is cut away), then the wheel's three spokes from the hub out to the rim (kind 4:
  // coloured from the photo).
  const base = WHEEL.base;
  const toySpin = [p.x, p.y, Math.cos(rad(p.angle + WHEEL.turn)), Math.sin(rad(p.angle + WHEEL.turn))];
  push([p.x + base.x0, p.y + base.y0, p.height], [p.x + base.x1, p.y + base.y1, p.height + base.height], PEDESTAL, 3, 0, toySpin);
  const toy = toyPlace(p);
  for (let k = 0; k < 3; k++) {
    const a = rad(p.angle + WHEEL.turn + WHEEL.spokeAngle + k * 120);
    push(
      [toy.wheel[0] + WHEEL.hub - 0.1, toy.wheel[1] - WHEEL.spoke, toy.z + 0.05],
      [toy.wheel[0] + WHEEL.radius - WHEEL.rim + 0.1, toy.wheel[1] + WHEEL.spoke, toy.z + WHEEL.thick - 0.05],
      PEDESTAL,
      4,
      0,
      [toy.wheel[0], toy.wheel[1], Math.cos(a), Math.sin(a)],
    );
  }
  if (p.sign) {
    // The message card (kind 2: its top shows the words), and the book light's stem and head.
    const sign = signPlace(p);
    push(sign.card.min, sign.card.max, CARD.paper, 2, 0, spin);
    push(sign.stem.min, sign.stem.max, [0.05, 0.05, 0.05], 0, 0, spin);
    push(sign.head.min, sign.head.max, [0.05, 0.05, 0.05], 0, 0, spin);
  }
  const v = layout.visitor;
  // The visitor, as a body and a head turned the way they look, so a mirror shows a figure.
  // The eye sits inside the head; a box is not seen from inside itself.
  const facing = [v.x, v.y, Math.cos(rad(v.yaw)), Math.sin(rad(v.yaw))];
  const neck = v.height - HEAD_HEIGHT;
  const back = VISITOR.deep / 2;
  push([v.x - back, v.y - VISITOR.wide / 2, 0], [v.x + back, v.y + VISITOR.wide / 2, neck], BODY, 0, 0, facing);
  push([v.x - 4, v.y - VISITOR.headWide / 2, neck], [v.x + 4, v.y + VISITOR.headWide / 2, v.height], HEAD, 0, 0, facing);
  for (const b of boxes.slice(-2)) b.visitor = true; // people: they stand in the light
  const bench = layout.bench;
  if (bench && bench.on) {
    // The bench: a slab on legs is just a slab here, with two people on it facing the way
    // it faces, laps out in front, heads turned the way they look.
    const bx = bench.x;
    const by = bench.y;
    const sit = [bx, by, Math.cos(rad(bench.angle)), Math.sin(rad(bench.angle))];
    const half = BENCH.depth / 2;
    push([bx - half, by - BENCH.width / 2, BENCH.seat - 2], [bx + half, by + BENCH.width / 2, BENCH.seat], BENCH.color, 0, 0, sit);
    const seatNeck = BENCH.top - HEAD_HEIGHT;
    for (const k of [1, -1]) {
      const off = (k * BENCH.width) / 4; // each sitter a quarter of the way in from an end
      push([bx - half, by + off - VISITOR.wide / 2, BENCH.seat], [bx - half + VISITOR.deep, by + off + VISITOR.wide / 2, seatNeck], BODY, 0, 0, sit);
      push([bx - half + VISITOR.deep, by + off - VISITOR.wide / 2, BENCH.seat], [bx - half + VISITOR.deep + BENCH.knees, by + off + VISITOR.wide / 2, BENCH.lap], BODY, 0, 0, sit);
      // The head sits over the body's middle and turns on its own, the way they look.
      const [hx, hy] = sitterHead(bench, k);
      const look = [hx, hy, Math.cos(rad(bench.look)), Math.sin(rad(bench.look))];
      push([hx - 4, hy - VISITOR.headWide / 2, seatNeck], [hx + 4, hy + VISITOR.headWide / 2, BENCH.top], HEAD, 0, 0, look);
    }
    for (const b of boxes.slice(-6)) b.visitor = true;
  }
  layout.projectors.forEach((q, i) => {
    // The body at its real size, turned the way it aims, lens in the middle of its front;
    // under it, its pedestal if it has one, an inch bigger all round than the body.
    const spin = [q.x, q.y, Math.cos(rad(q.yaw)), Math.sin(rad(q.yaw))];
    const wide = num(q.width, USUAL_BODY[0]) / 2;
    const deep = num(q.depth, USUAL_BODY[1]);
    const tall = num(q.height, USUAL_BODY[2]);
    const top = standTop(q, room);
    const stand = top - restingPlace(q.x, q.y, room).top;
    if (stand > 0.5) push([q.x - deep - 1, q.y - wide - 1, top - stand], [q.x + 1, q.y + wide + 1, top], [0.3, 0.3, 0.32], 0, 0, spin);
    push([q.x - deep - 0.3, q.y - wide, top + FEET], [q.x - 0.3, q.y + wide, top + FEET + tall], [0.24, 0.24, 0.25], 0, 0, spin);
    const { f } = aimBasis(q.yaw, q.pitch);
    const cx = q.x + f[0] * 1.6;
    const cy = q.y + f[1] * 1.6;
    const cz = q.z + f[2] * 1.6;
    // The lens: glares when seen from inside the beam (kind 1, ref = which projector).
    push([cx - 1.5, cy - 1.5, cz - 1.5], [cx + 1.5, cy + 1.5, cz + 1.5], [0, 0, 0], 1, i);
  });
  return boxes.slice(0, MAX_BOXES);
}

// A colour that means "take the colour from the photo of the toy" (red below zero).
export const FROM_PHOTO = [-1, 0, 0];

/** A point given in the pedestal's own frame (x toward its marked side), in room inches. */
function fromPedestal(p, x, y) {
  const cs = Math.cos(rad(p.angle));
  const sn = Math.sin(rad(p.angle));
  return [p.x + cs * x - sn * y, p.y + sn * x + cs * y];
}

/** Where the toy's wheel is: { wheel: [x, y] its middle, z: the height of its underside }. */
export function toyPlace(p) {
  return { wheel: fromPedestal({ ...p, angle: p.angle + WHEEL.turn }, WHEEL.forward, WHEEL.side), z: p.height + WHEEL.lift };
}

/**
 * The message card and the book light. The boxes are given as they sit before the pedestal
 * is turned (sceneBoxes spins them); the light's place and aim are in room inches.
 * { card, stem, head: { min, max }, lamp: { pos, dir } }
 */
export function signPlace(p) {
  const x1 = p.size / 2 - CARD.edge;
  const x0 = x1 - CARD.depth;
  const top = p.height;
  const far = -p.size / 2; // the edge away from the visitor
  const lx = far + CARD.lampBack;
  const h = CARD.lampHeight;
  const at = fromPedestal(p, lx, 0);
  const down = normalize([CARD.lampAim - lx, 0, -h]); // aimed between the toy and the card
  const cs = Math.cos(rad(p.angle));
  const sn = Math.sin(rad(p.angle));
  return {
    card: { min: [p.x + x0, p.y - CARD.width / 2, top], max: [p.x + x1, p.y + CARD.width / 2, top + 0.12] },
    stem: { min: [p.x + far + 0.4, p.y - 0.2, top], max: [p.x + far + 0.8, p.y + 0.2, top + h + 0.6] },
    head: { min: [p.x + far + 0.4, p.y - 0.5, top + h + 0.15], max: [p.x + lx + 0.5, p.y + 0.5, top + h + 0.6] },
    lamp: { pos: [at[0], at[1], top + h], dir: [cs * down[0] - sn * down[1], sn * down[0] + cs * down[1], down[2]] },
  };
}

/**
 * Round, flat things: { c: [x, y], z0, z1, outer, inner, albedo }. A ring when inner > 0.
 * The toy's wheel: its rim and hub, lying level above the base, and the post they sit on.
 */
export function sceneDiscs(layout) {
  const p = layout.pedestal;
  const { wheel, z } = toyPlace(p);
  const z1 = z + WHEEL.thick;
  const discs = [
    { c: wheel, z0: z, z1, outer: WHEEL.radius, inner: WHEEL.radius - WHEEL.rim, albedo: FROM_PHOTO },
    { c: wheel, z0: z, z1: z1 + 0.2, outer: WHEEL.hub, inner: 0, albedo: FROM_PHOTO },
    { c: wheel, z0: p.height + WHEEL.base.height, z1: z, outer: WHEEL.hub * 0.8, inner: 0, albedo: WHEEL.post },
  ];
  // Lava lamps: a dark base, then the glass, which glows with its own light (glow is the
  // light it gives off per square inch of glass, see lavaLights).
  for (const l of layout.lamps || []) {
    const { radiance } = lavaLight(l);
    discs.push({ c: [l.x, l.y], z0: l.z, z1: l.z + LAVA.baseHeight, outer: LAVA.base, inner: 0, albedo: [0.12, 0.12, 0.13] });
    discs.push({ c: [l.x, l.y], z0: l.z + LAVA.baseHeight, z1: l.z + LAVA.glowTop, outer: LAVA.glow, inner: 0, albedo: radiance, glow: 1 });
  }
  return discs;
}

/**
 * What a lava lamp gives off: { pos: the middle of the glass, candle: light in every
 * direction, radiance: how bright the glass itself looks }. Lumens spread over a whole
 * sphere; the glass's own brightness is that spread over its side.
 */
export function lavaLight(l) {
  const color = LAVA_COLORS[l.color] || LAVA_COLORS.orange;
  const candle = num(l.lumens, 0) / (4 * Math.PI);
  const side = 2 * LAVA.glow * (LAVA.glowTop - LAVA.baseHeight);
  const glowMid = l.z + (LAVA.baseHeight + LAVA.glowTop) / 2;
  return { pos: [l.x, l.y, glowMid], candle: color.map((c) => c * candle), radiance: color.map((c) => (c * candle) / side) };
}

/**
 * Rock spots as half ellipsoids on the wall: { c: middle of the flat side on the wall, n:
 * the way the dome points, r0: half the width across, r1: half the height, depth }.
 */
export function sceneSpots(layout) {
  return (layout.spots || []).map((s) => ({
    c: [s.x, s.y, s.z],
    n: [Math.cos(rad(s.angle)), Math.sin(rad(s.angle)), 0],
    r0: s.base / 2,
    r1: s.top / 2,
    depth: s.depth,
    rock: s.source === "rock" ? (s.rock ?? 0) : -1,
    // While the live show fades a spot to another rock: that rock, and how far along.
    rockTo: s.source === "rock" ? (s.rockTo ?? s.rock ?? 0) : -1,
    rockMix: s.rockMix ?? 0,
    look: spotLook(s),
  }));
}

/**
 * Where a ray first meets a rock (from sceneSpots): { t, n } with n the way the surface
 * faces there, or null. The rock is the front half of an ellipsoid: across the wall r0,
 * up it r1, out of it depth. In those units it is the unit sphere, so the ray is scaled
 * into them and meets a sphere. The same sums are in tracer.js for the picture.
 */
export function hitSpot(o, d, spot) {
  const { c, n: ax, r0, r1, depth } = spot;
  const edge = [-ax[1], ax[0], 0]; // across the wall, to the right seen from in front
  const oc = sub(o, c);
  const P = [dot(oc, edge) / r0, oc[2] / r1, dot(oc, ax) / depth];
  const D = [dot(d, edge) / r0, d[2] / r1, dot(d, ax) / depth];
  const A = dot(D, D);
  const B = 2 * dot(P, D);
  const C = dot(P, P) - 1;
  const disc = B * B - 4 * A * C;
  if (A < 1e-12 || disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t <= 1e-4) continue;
    const q = [P[0] + D[0] * t, P[1] + D[1] * t, P[2] + D[2] * t];
    if (q[2] < 0) continue; // the half inside the wall
    const n = normalize(add(add(scale(edge, q[0] / r0), [0, 0, q[1] / r1]), scale(ax, q[2] / depth)));
    return { t, n };
  }
  return null;
}

/**
 * A picture for the spots that differs from the one on the walls: one of `ids` other than
 * `avoid`, or "" when there is no other. Any one will do, but it is the same pick each time
 * for the same wall picture, so a layout looks the same when it is opened again.
 */
export function otherStill(ids, avoid) {
  const rest = ids.filter((id) => id !== avoid);
  if (!rest.length) return "";
  let h = 7;
  for (const ch of String(avoid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return rest[h % rest.length];
}

/**
 * A picture chosen by chance: one of `ids` that is not in `avoid`, or "" when none is left.
 * `rand` gives a number from 0 up to 1, so a test can decide the draw.
 */
export function randomStill(ids, avoid = [], rand = Math.random) {
  const rest = ids.filter((id) => !avoid.includes(id));
  if (!rest.length) return "";
  return rest[Math.min(rest.length - 1, Math.floor(rand() * rest.length))];
}

/**
 * Move a measure of the projected picture ({ mean: [r, g, b], level }) part of the way
 * toward a newer one. Used while the live show is projected, so the picture's overall
 * brightness follows the show smoothly instead of jumping from frame to frame.
 */
export function easeStill(prev, next, k = 0.2) {
  const mix = (a, b) => a + (b - a) * k;
  return { mean: prev.mean.map((v, i) => mix(v, next.mean[i])), level: mix(prev.level, next.level) };
}

/** Is a point inside a projector's picture (ignoring anything in the way)? */
export function inPicture(projector, point) {
  const { f, r, u } = aimBasis(projector.yaw, projector.pitch);
  const d = sub(point, [projector.x, projector.y, projector.z]);
  const z = dot(d, f);
  if (z < 1) return false;
  const up = dot(d, u) / z - liftSlope(projector);
  return Math.abs(dot(d, r) / z) < 0.5 / projector.tr && Math.abs(up) < (0.5 * projector.aspect) / projector.tr;
}

/**
 * Which projectors light a spot's cloth end: [{ name, lit, square }]. `square` is 1 when
 * the light arrives straight on and falls toward 0 as it arrives more from the side.
 */
export function spotLight(layout, spot, room = ROOM) {
  const boxes = sceneBoxes(layout, room).filter((b) => b.kind === 0);
  const spots = sceneSpots(layout);
  const [me] = sceneSpots({ spots: [spot] });
  const face = add(me.c, scale(me.n, me.depth + 0.3)); // just in front of the cloth
  return layout.projectors.map((q) => {
    const lens = [q.x, q.y, q.z];
    const d = sub(face, lens);
    const far = Math.hypot(...d);
    const square = -dot(d, me.n) / far;
    const clear = castRay(lens, scale(d, 1 / far), boxes, layout.mirrors, room, spots).t >= far - 0.05;
    // How much light lands there: the lumens spread over the picture at that distance
    // (a short throw spreads them wide), times how squarely they arrive.
    const wash = (q.lm * q.tr * q.tr * Math.max(0, square)) / (far * far);
    return { name: q.name, lit: square > 0 && inPicture(q, face) && clear, square, wash };
  });
}

// ---- the calibration the show would use for this room ----
//
// The show sends one wide picture, a share for each projector side by side, and inside
// each share it draws regions: a background, and an oval for each spot with its look.
// The composer works out those ovals from where things stand, shows the room lit that way,
// and can hand the result to the show as a starting calibration.

/**
 * Where a point in the room falls in a projector's picture: [s, t], each from -1 to 1
 * across the picture (s to the right, t upward), or null when it is behind the lens.
 */
export function toPicture(projector, point) {
  const { f, r, u } = aimBasis(projector.yaw, projector.pitch);
  const d = sub(point, [projector.x, projector.y, projector.z]);
  const z = dot(d, f);
  if (z < 1) return null;
  const up = dot(d, u) / z - liftSlope(projector);
  return [dot(d, r) / z / (0.5 / projector.tr), up / ((0.5 * projector.aspect) / projector.tr)];
}

/**
 * The projectors in the order of the show's outputs, left to right, as places in
 * layout.projectors. The show sends one wide picture and each projector gets a slice of
 * it. Which slice is worked out from the room: the projector whose picture is furthest to
 * the visitor's left gets the left slice, and so on. (The computer's screens are then
 * arranged to match; the list order of the projectors does not matter.)
 */
export function outputOrder(layout, room = ROOM) {
  if (!layout.projectors.length) return [];
  const eye = eyePoint(layout.visitor);
  const yaw = rad(layout.visitor.yaw);
  const leftness = layout.projectors.map((q) => {
    const lens = [q.x, q.y, q.z];
    const { dir } = pictureAxis(q);
    const { t } = castRay(lens, dir, [], [], room);
    const lands = add(lens, scale(dir, Number.isFinite(t) ? t : 100)); // the middle of its picture
    const turn = Math.atan2(lands[1] - eye[1], lands[0] - eye[0]) - yaw;
    return Math.atan2(Math.sin(turn), Math.cos(turn)); // more is further to the visitor's left
  });
  return layout.projectors.map((_, i) => i).sort((i, j) => leftness[j] - leftness[i] || i - j);
}

/**
 * The outline a rock makes in a projector's picture: { c, a, b, tip, simple }.
 * c, a, b are the oval of its flat side on the wall: the middle, and the two arms that the
 * picture's right and top are fitted to, in picture units. `tip` is the dome's crown, a
 * point. Seen straight on, the crown sits inside the base and the outline is just that
 * oval (`simple`). Seen from the side the dome sticks out, and the outline is the hull of
 * its slices from the wall to the crown: see regionHull().
 */
function spotOutline(projector, cone) {
  const edge = [-cone.n[1], cone.n[0], 0]; // to the right, seen from in front
  const ring = (centre, across, up) => {
    const c = toPicture(projector, centre);
    const a = toPicture(projector, add(centre, scale(edge, across)));
    const b = toPicture(projector, add(centre, [0, 0, up]));
    return c && a && b ? { c, a: [a[0] - c[0], a[1] - c[1]], b: [b[0] - c[0], b[1] - c[1]] } : null;
  };
  const base = ring(cone.c, cone.r0, cone.r1);
  const tip = ring(add(cone.c, scale(cone.n, cone.depth)), 0, 0);
  if (!base || !tip) return null;
  const det = base.a[0] * base.b[1] - base.a[1] * base.b[0];
  if (Math.abs(det) < 1e-12) return null;
  // The cloth end, measured in the wide end's own arms: where its middle is, how big it is.
  const inBase = (v) => [(v[0] * base.b[1] - v[1] * base.b[0]) / det, (base.a[0] * v[1] - base.a[1] * v[0]) / det];
  // The crown, measured in the base's own arms: how far from the middle it lands. The
  // outline is a plain oval only if no slice of the dome sticks out of the base's oval:
  // each slice sits a fraction of the way to the crown and is the base shrunk by its size.
  const off = Math.hypot(...inBase([tip.c[0] - base.c[0], tip.c[1] - base.c[1]]));
  let simple = true;
  for (let k = 0; k < OUTLINE_SLICES; k++) {
    const h = sliceAt(k);
    if (h * off + sliceSize(h) > 1 + 1e-9) simple = false;
  }
  return { ...base, tip, simple };
}

// How many slices of the rock, from the wall to its crown, stand in for its outline, and
// how far out each one is (0 the wall, 1 the crown; the last stops short of the crown,
// which is a point). A slice's oval is the base's, shrunk as the dome narrows.
// tracer.js uses the same slices.
export const OUTLINE_SLICES = 5;
export const sliceAt = (k) => (k / (OUTLINE_SLICES - 1)) * 0.97;
export const sliceSize = (h) => Math.sqrt(Math.max(1 - h * h, 0));

/**
 * The outline of a region from designPlan() as a polygon, in picture units: the hull of
 * the rock's slices from the wall to its crown. It hugs the rock as that projector sees
 * it, so the look does not spill onto the wall beside it.
 */
export function regionHull(r, steps = 24) {
  const mix = (p, q, h) => [p[0] + (q[0] - p[0]) * h, p[1] + (q[1] - p[1]) * h];
  const points = [];
  for (let k = 0; k < OUTLINE_SLICES; k++) {
    const h = sliceAt(k);
    const c = mix(r.c, r.tip.c, h);
    const a = [r.a[0] * sliceSize(h), r.a[1] * sliceSize(h)];
    const b = [r.b[0] * sliceSize(h), r.b[1] * sliceSize(h)];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      points.push([c[0] + Math.cos(t) * a[0] + Math.sin(t) * b[0], c[1] + Math.cos(t) * a[1] + Math.sin(t) * b[1]]);
    }
  }
  // The hull, going round once (Andrew's monotone chain).
  points.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const turn = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(points), ...half([...points].reverse())];
}

// A projector counts as showing a spot only if its light meets the cloth end at least this
// squarely (1 is straight on): a look seen at a skim is a long sliver. Whether another
// projector gets a black cutout on a spot is a matter of light, not angle (Amanda,
// 2026-10-15, idea 24): one that drops at least WASH_CUT of the owner's light there would
// wash the look out and is cut out, however it meets the spot; one that drops less is left
// alone, because a cutout seen from anywhere but its own lens is a black smear on the wall
// beside the rock, and a faint wash does less harm than that.
// 0.25 until 2026-10-19; lowered so a rock on the south wall, which the projectors on the
// east wall only skim (0.24 at its best place), still gets its scan (Amanda: "try lowering").
export const REACH_SQUARE = 0.2;
export const WASH_CUT = 0.3;

/**
 * Which projector shows each spot, and where: { outputs, regions, skipped }.
 * - outputs: the projectors in output order (places in layout.projectors).
 * - regions: one per spot and projector that reaches it: { spot, projector, output, black,
 *   c, a, b }. The projector that meets the spot most squarely shows its look. Any other
 *   projector that reaches it gets a black cutout there, so it does not wash the look out.
 * - skipped: names of spots no projector reaches squarely enough.
 */
export function designPlan(layout, room = ROOM) {
  const outputs = outputOrder(layout, room);
  const cones = sceneSpots(layout);
  const regions = [];
  const skipped = [];
  layout.spots.forEach((spot, si) => {
    const lights = spotLight(layout, spot, room);
    let owner = -1;
    lights.forEach((l, pi) => {
      if (l.lit && l.square >= REACH_SQUARE && (owner < 0 || l.square > lights[owner].square)) owner = pi;
    });
    if (owner < 0) {
      // No projector meets it squarely enough to show a look: it is left out and named,
      // and whatever light lands on it stays (a slice of the picture, which Amanda
      // prefers for now to the black smear a skimmed cutout makes, 2026-10-15).
      skipped.push(spot.name);
      return;
    }
    lights.forEach((l, pi) => {
      if (!l.lit) return;
      // Another projector gets a cutout only if it drops enough light to wash the look out.
      if (pi !== owner && l.wash < WASH_CUT * lights[owner].wash) return;
      const oval = spotOutline(layout.projectors[pi], cones[si]);
      if (oval) regions.push({ spot: si, projector: pi, output: outputs.indexOf(pi), black: pi !== owner, ...oval });
      else if (pi !== owner) skipped.push(`${spot.name} (no outline from ${layout.projectors[pi].name})`);
    });
  });
  return { outputs, regions, skipped };
}

/** The part of a polygon inside a box: clipped against each side in turn. */
function clipToBox(points, x0, y0, x1, y1) {
  const sides = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  let out = points;
  for (const [isIn, cross] of sides) {
    const next = [];
    out.forEach((p, i) => {
      const prev = out[(i + out.length - 1) % out.length];
      if (isIn(p) !== isIn(prev)) next.push(cross(prev, p));
      if (isIn(p)) next.push(p);
    });
    out = next;
    if (!out.length) break;
  }
  return out;
}

/**
 * The plan as a calibration the show can load: a background for each output, then an oval
 * for each spot with its look, and the black cutouts. A starting point: the room's sizes
 * are estimates, so the ovals are nudged into place in the real room.
 */
export function planCalibration(layout, plan = designPlan(layout)) {
  const count = Math.max(1, plan.outputs.length);
  const stage = { width: OUTPUT_WIDTH * count, height: SHOW_H };
  const regions = Array.from({ length: count }, (_, k) => makeBackground(stage, k));
  const round = (v) => Math.round(v * 10) / 10;
  const px = (k, s, t) => [round(k * OUTPUT_WIDTH + ((s + 1) / 2) * OUTPUT_WIDTH), round(((1 - t) / 2) * SHOW_H)];
  for (const r of plan.regions) {
    const spot = layout.spots[r.spot];
    const oval = [px(r.output, r.c[0], r.c[1]), px(r.output, r.c[0] + r.a[0], r.c[1] + r.a[1]), px(r.output, r.c[0] + r.b[0], r.c[1] + r.b[1])];
    // Seen straight on, the shade's outline is a plain oval. Seen from the side it is the
    // hull of the shade, so nothing lands on the wall beside it.
    const whole = r.simple ? ellipseOutline(oval, 48) : regionHull(r).map(([s, t]) => px(r.output, s, t));
    // A projector cannot throw past the edge of its own picture, and on the stage the next
    // projector's share starts there. An outline that runs over the edge is cut off at it.
    const left = r.output * OUTPUT_WIDTH;
    const inside = clipToBox(whole, left, 0, left + OUTPUT_WIDTH, SHOW_H).map(([x, y]) => [round(x), round(y)]);
    const cut = inside.length !== whole.length || inside.some((p, i) => Math.abs(p[0] - whole[i][0]) > 0.06 || Math.abs(p[1] - whole[i][1]) > 0.06);
    if ((cut || !r.simple) && (inside.length < 3 || polygonArea(inside) < 16)) continue; // nothing of it is in the picture
    regions.push({
      name: r.black ? `${spot.name} cutout` : spot.name,
      shape: cut || !r.simple ? "polygon" : "ellipse",
      corners: cut || !r.simple ? inside : oval,
      mask: [],
      angle: 0,
      link: r.black ? "" : spot.set || "",
      variant: r.black ? normalizeVariant({ source: "black" }) : spotLook(spot), // a rock look carries its rock
    });
  }
  return normalizeCalibration({ version: 2, stage, regions });
}

/** The calibration a saved layout calls for, straight from the saved file; null if it is not a layout. */
export function calibrationFromLayout(raw, room = ROOM) {
  if (!raw || typeof raw !== "object") return null;
  return planCalibration(normalizeLayout(raw, room));
}

/** Where a ray first meets the room shell, a box, a mirror or a spot: { t, what, index }. */
export function castRay(o, d, boxes, mirrors, room = ROOM, spots = []) {
  const size = [room.length, room.width, room.height];
  let best = { t: Infinity, what: "room", index: -1 };
  for (let i = 0; i < 3; i++) {
    if (d[i] > 1e-9) best.t = Math.min(best.t, (size[i] - o[i]) / d[i]);
    else if (d[i] < -1e-9) best.t = Math.min(best.t, -o[i] / d[i]);
  }
  boxes.forEach((b, index) => {
    let t0 = -Infinity;
    let t1 = Infinity;
    // A spun box: turn the ray the other way and test the box where it sat before.
    const [cx, cy, cs, sn] = b.turn || [0, 0, 1, 0];
    const ro = sn === 0 ? o : [cs * (o[0] - cx) + sn * (o[1] - cy) + cx, -sn * (o[0] - cx) + cs * (o[1] - cy) + cy, o[2]];
    const rd = sn === 0 ? d : [cs * d[0] + sn * d[1], -sn * d[0] + cs * d[1], d[2]];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(rd[i]) < 1e-12) {
        if (ro[i] < b.min[i] || ro[i] > b.max[i]) return;
        continue;
      }
      let a = (b.min[i] - ro[i]) / rd[i];
      let c = (b.max[i] - ro[i]) / rd[i];
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
    if (t0 > 1e-4 && t0 <= t1 && t0 < best.t) best = { t: t0, what: "box", index };
  });
  mirrors.forEach((m, index) => {
    const pl = mirrorPlane(m);
    const denom = dot(d, pl.n);
    if (Math.abs(denom) < 1e-9) return;
    const t = dot(sub(pl.c, o), pl.n) / denom;
    if (t < 1e-4 || t >= best.t) return;
    if (onMirror(add(o, scale(d, t)), pl)) best = { t, what: "mirror", index };
  });
  spots.forEach((s, index) => {
    const hit = hitSpot(o, d, s);
    if (hit && hit.t < best.t) best = { t: hit.t, what: "spot", index };
  });
  return best;
}

// Heights in the picture at which the plan's fan looks for people, from its bottom edge
// (-1) to its top (1).
const FAN_RISES = [-1, -0.5, 0, 0.5, 1];

/**
 * The outline of a projector's light on the floor plan: a fan of points from the lens out
 * to whatever each ray meets first. Rays are cast level, so it shows width, not height;
 * except for the visitors, who cut the fan wherever any height of the picture meets them.
 */
export function beamFan(projector, layout, room = ROOM, steps = 48) {
  const all = sceneBoxes(layout, room);
  const boxes = all.filter((b) => b.kind === 0);
  const people = all.filter((b) => b.visitor);
  const origin = [projector.x, projector.y, clamp(projector.z, 1, room.height - 1)];
  const half = Math.atan(0.5 / projector.tr);
  const { f, r, u } = aimBasis(projector.yaw, projector.pitch);
  const lift = num(projector.lift, 0);
  const fan = [];
  for (let i = 0; i <= steps; i++) {
    const a = rad(projector.yaw) - half + (2 * half * i) / steps;
    const d = [Math.cos(a), Math.sin(a), 0];
    let { t: reach } = castRay(origin, d, boxes, layout.mirrors, room);
    let point = [origin[0] + d[0] * reach, origin[1] + d[1] * reach];
    // People stand in the light whatever height it passes at, not only the lens's: try
    // this slice of the picture from its bottom edge to its top, and stop at them.
    const across = 1 - (2 * i) / steps; // +1 is the picture's right edge, which is this fan's first ray
    for (const rise of FAN_RISES) {
      const dir = normalize(
        add(add(f, scale(r, (across * 0.5) / projector.tr)), scale(u, ((rise + 2 * lift) * 0.5 * projector.aspect) / projector.tr)),
      );
      const hit = castRay(origin, dir, people, [], room);
      if (hit.what !== "box") continue;
      const flat = hit.t * Math.hypot(dir[0], dir[1]);
      if (flat >= reach) continue;
      reach = flat;
      point = [origin[0] + dir[0] * hit.t, origin[1] + dir[1] * hit.t];
    }
    fan.push(point);
  }
  return fan;
}

/**
 * Each projector seen in each mirror: a mirror-image projector behind the glass, which is
 * how light that bounces off one mirror is drawn.
 */
export function mirrorImages(layout) {
  const out = [];
  layout.projectors.forEach((q, pi) => {
    const { f, r, u } = aimBasis(q.yaw, q.pitch);
    const pos = [q.x, q.y, q.z];
    layout.mirrors.forEach((m, mi) => {
      if (num(m.bulge, 0) > 0) return; // a convex mirror: the light it spreads is not drawn yet (2026-10-19)
      const pl = mirrorPlane(m);
      if (dot(sub(pos, pl.c), pl.n) <= 0) return; // the projector is behind this mirror
      out.push({
        pos: reflectPoint(pos, pl),
        f: reflectVector(f, pl),
        r: reflectVector(r, pl),
        u: reflectVector(u, pl),
        real: pos,
        tr: q.tr,
        lm: q.lm,
        aspect: q.aspect,
        mirror: mi,
        projector: pi,
      });
    });
  });
  return out;
}

/** Where the visitor's eyes are: at the front of the head, at eye height. */
export function eyePoint(v) {
  return [v.x + Math.cos(rad(v.yaw)) * EYE_FORWARD, v.y + Math.sin(rad(v.yaw)) * EYE_FORWARD, v.eye];
}

/** Everything the picture needs, as flat number arrays for the graphics card. */
export function packScene(layout, room = ROOM) {
  const boxes = sceneBoxes(layout, room);
  const discs = sceneDiscs(layout).slice(0, MAX_DISCS);
  const spots = sceneSpots(layout).slice(0, MAX_SPOTS);
  const balls = (layout.balls || []).slice(0, MAX_BALLS);
  const images = mirrorImages(layout);
  const flat = (rows) => new Float32Array(rows.flat());
  // What each projector is given to show, as the show's calibration would have it.
  const plan = designPlan(layout, room);
  const drawn = plan.regions.slice(0, MAX_REGIONS_DRAWN).map((r) => {
    if (r.simple) return { ...r, fit: [0, 0, 0] };
    // Where the picture is fitted over a hull, as the show fits one over a polygon: centred
    // on the outline's bounds and scaled to cover them.
    const pts = regionHull(r);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { ...r, fit: [(x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0, 1e-6)] };
  });
  const projectors = layout.projectors.map((q, pi) => ({
    ...aimBasis(q.yaw, q.pitch),
    pos: [q.x, q.y, q.z],
    tr: q.tr,
    lm: q.lm,
    aspect: q.aspect,
    // The show mirrors the background on every second output (mapping.js, makeBackground).
    flip: plan.outputs.indexOf(pi) % 2 === 1 ? 1 : 0,
  }));
  const planes = layout.mirrors.map(mirrorPlane);
  const ped = layout.pedestal;
  const seen = viewPoint(layout);
  const lamps = (layout.lamps || []).slice(0, MAX_LAVA).map(lavaLight);
  const lamp = signPlace(ped).lamp;
  // A cone of light about 45 degrees to each side: lumens spread over that much of a sphere.
  const candle = ped.sign ? ped.lamp / (2 * Math.PI * (1 - Math.SQRT1_2)) : 0;
  return {
    toyFrame: [ped.x, ped.y, Math.cos(rad(ped.angle + WHEEL.turn)), Math.sin(rad(ped.angle + WHEEL.turn))],
    toyRect: [WHEEL.photo.x0, WHEEL.photo.y0, WHEEL.photo.width, WHEEL.photo.height],
    lampPos: lamp.pos,
    lampDir: lamp.dir,
    lampPower: CARD.warm.map((c) => c * candle),
    room: [room.length, room.width, room.height],
    nBox: boxes.length,
    boxMin: flat(boxes.map((b) => b.min)),
    boxMax: flat(boxes.map((b) => b.max)),
    boxCol: flat(boxes.map((b) => b.albedo)),
    boxKind: flat(boxes.map((b) => [b.kind, b.ref])),
    boxTurn: flat(boxes.map((b) => b.turn)),
    nDisc: discs.length,
    discA: flat(discs.map((d) => [d.c[0], d.c[1], d.z0, d.z1])),
    discR: flat(discs.map((d) => [d.outer, d.inner, d.glow ? 1 : 0, 0])),
    nCable: cableSegments(layout, room).kind.length,
    cableSeg: cableSegments(layout, room).seg,
    cableKind: cableSegments(layout, room).kind,
    nPath: layout.path && layout.path.on ? PATH_STEPS + 1 : 0,
    pathPts: flat(layout.path && layout.path.on ? pathPolyline(layout, room) : []),
    pathSpec: [num(layout.path?.width, PATH.width) / 2, 0, 0],
    pathCol: PATH.color,
    nLava: lamps.length,
    lavaPos: flat(lamps.map((l) => [...l.pos, LAVA.glow])),
    lavaCol: flat(lamps.map((l) => l.candle)),
    discCol: flat(discs.map((d) => d.albedo)),
    nSpot: spots.length,
    spotC: flat(spots.map((s) => s.c)),
    spotN: flat(spots.map((s) => s.n)),
    spotS: flat(spots.map((s) => [s.r0, s.r1, s.depth])),
    spotRock: spots.map((s) => s.rock),
    spotRockB: spots.map((s) => s.rockTo),
    spotRockMix: spots.map((s) => s.rockMix),
    // Each spot's look, ready for the picture: zoom, slide across, slide down, colour turn;
    // then the picture's turn, mirror and cover (across, down), and opposite colours.
    spotLookA: flat(spots.map((s) => [s.look.zoom, s.look.panX, s.look.panY, rad(s.look.hue)])),
    spotLookB: flat(
      spots.map((s) => {
        const cover = s.look.rotate ? coverScale(s.look.rotate, SHOW_W, SHOW_H) : 1;
        return [rad(s.look.rotate), (s.look.flipX ? -1 : 1) * cover, (s.look.flipY ? -1 : 1) * cover, s.look.invert ? 1 : 0];
      }),
    ),
    cloth: SHADE.color,
    nMir: planes.length,
    mirC: flat(planes.map((p) => p.c)),
    mirN: flat(planes.map((p) => p.n)),
    mirS: flat(planes.map((p, i) => [p.half, p.len, num(layout.mirrors[i].frame, 0), num(layout.mirrors[i].bulge, 0)])),
    nBall: balls.length,
    ballA: flat(balls.map((b) => [b.x, b.y, b.z, b.size / 2])),
    nProj: projectors.length,
    pPos: flat(projectors.map((p) => p.pos)),
    pF: flat(projectors.map((p) => p.f)),
    pR: flat(projectors.map((p) => p.r)),
    pU: flat(projectors.map((p) => p.u)),
    pSpec: flat(projectors.map((p) => [p.tr, p.lm, p.aspect, p.flip])),
    pWin: new Float32Array(layout.projectors.map((q, pi) => Math.max(0, plan.outputs.indexOf(pi)))),
    pLift: new Float32Array(layout.projectors.map((q) => num(q.lift, 0))),
    // The ovals: middle and first arm; then second arm, which projector, and which spot's
    // look it shows (-1 for a black cutout).
    nReg: drawn.length,
    // Wide end: middle and first arm; then second arm, a code (projector x 100, plus the
    // spot's number + 1, or + 0 for a black cutout), and the size the picture is fitted to
    // (0: a plain oval). Cloth end: middle and first arm; then second arm and the middle
    // the picture is fitted on.
    regA: flat(drawn.map((r) => [r.c[0], r.c[1], r.a[0], r.a[1]])),
    regB: flat(drawn.map((r) => [r.b[0], r.b[1], r.projector * 100 + (r.black ? 0 : r.spot + 1), r.fit[2]])),
    regC: flat(drawn.map((r) => [r.tip.c[0], r.tip.c[1], r.tip.a[0], r.tip.a[1]])),
    regD: flat(drawn.map((r) => [r.tip.b[0], r.tip.b[1], r.fit[0], r.fit[1]])),
    iProj: new Float32Array(images.map((p) => p.projector)),
    nImg: images.length,
    iPos: flat(images.map((p) => p.pos)),
    iF: flat(images.map((p) => p.f)),
    iR: flat(images.map((p) => p.r)),
    iU: flat(images.map((p) => p.u)),
    iReal: flat(images.map((p) => p.real)),
    iSpec: flat(images.map((p) => [p.tr, p.lm, p.aspect, p.mirror])),
    eye: seen.eye,
    look: aimBasis(seen.yaw, seen.pitch),
    tan: Math.tan(rad(layout.view.fov) / 2),
  };
}

/**
 * How much light the brightest projector puts on the wall it faces, as the eye would see it
 * off a white wall. Used to set how bright the picture is drawn.
 */
export function referenceRadiance(layout, room = ROOM, level = 0.5) {
  const boxes = sceneBoxes(layout, room).filter((b) => b.kind === 0);
  let best = 0;
  for (const q of layout.projectors) {
    const { dir, along } = pictureAxis(q); // toward the middle of its picture
    const { t } = castRay([q.x, q.y, q.z], dir, boxes, layout.mirrors, room);
    if (!Number.isFinite(t) || t < 1) continue;
    const out = t * along; // distance straight out from the lens
    const lit = (q.lm * q.tr * q.tr) / (q.aspect * out * out); // lumens per square inch, full white
    best = Math.max(best, (0.8 * lit * level) / Math.PI);
  }
  return best;
}
