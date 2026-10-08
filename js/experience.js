/**
 * The experience: a page of its own, for the Casino Space Travel site (Amanda,
 * 2026-10-06). Nothing of the room is shown: only the fractal, live, thrown onto a dark
 * field, and a few round spots floating over it that each show their own piece of it and
 * cast shadows. Moving the mouse, or tilting a phone, moves the light, so the shadows swing.
 *
 * The fractal is the show's own renderer (flame.js, genome.js) drawn into a hidden canvas
 * with the show's default settings and no toy, no sound and no server; this page needs
 * only to be served as files. The field and the spots are a small ray tracer of their own.
 */

import { FlameAnimator, setLikedPalettes } from "./genome.js";
import { FlameRenderer } from "./flame.js";
import { makeRng, randomSeed, clamp } from "./rng.js";
import { defaults } from "./settings.js";
import { cornersToCss } from "./mapping.js";

const W = 1024;
const H = 768;
// Photographs for the spots, when there are some (Amanda, 2026-10-06: her rock
// collection, projection-mapped onto the dots, morphing into each other). File names
// under img/rocks/, listed here; with none, each spot shows its own piece of the fractal.
// Each spot drifts from one photograph to the next, cross-fading over a few seconds.
// A list on the address works too, to try some without editing: ?rocks=img/rocks/a.jpg,img/rocks/b.jpg
// Amanda's rocks, scanned on the flatbed 2026-10-07 and cut apart by tools/scan_rocks.py.
const SCANNED = Array.from({ length: 25 }, (_, i) => `img/rocks/rock-${String(i + 1).padStart(2, "0")}.jpg`);
const asked = (new URLSearchParams(location.search).get("rocks") || "").split(",").filter(Boolean);
const ROCKS = asked.length ? asked : SCANNED;
const ROCK_HOLD = 6; // seconds a spot keeps one photograph
const ROCK_FADE = 3; // seconds it takes to become the next
const AUTO_EXP_MIN = 0.003;
const AUTO_EXP_MAX = 30;

const view = document.getElementById("view");
const hint = document.getElementById("hint");
const enable = document.getElementById("enable");

function fail(text) {
  hint.textContent = text;
  hint.classList.add("stay");
}

// ----------------------------------------------------------------- the fractal

const S = defaults();
// The palettes Amanda has liked in the show, a static copy (js/liked-palettes.json, from
// show 8/data/palettes.json), so the page draws from the same pool as the gallery
// (Amanda, 2026-10-08). Without the file, the built-in palettes alone.
fetch("js/liked-palettes.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => j && setLikedPalettes(j.liked, false))
  .catch(() => {});
const rng = makeRng(randomSeed());
// A different number of shades each time the page is opened (Amanda, 2026-10-07).
const SPOTS = 4 + Math.floor(rng.next() * 6);
const flameCanvas = document.createElement("canvas");
let flame = null;
let animator = null;
try {
  flame = new FlameRenderer(flameCanvas, W, H, () => location.reload(), () => {});
  animator = new FlameAnimator(rng, S);
} catch (err) {
  fail("This needs a browser with WebGL2 (Chrome, Firefox, Safari 15 or newer).");
}
const cam = { cx: 0, cy: 0, scale: 0.5, rot: 0 };
let autoExp = 1;
let frameNo = 0;
let t = 0;

function drawFlame(dt) {
  const genome = animator.update(dt, 0, 0.5);
  const gc = genome.camera;
  cam.cx = gc.cx;
  cam.cy = gc.cy;
  cam.scale = gc.scale;
  cam.rot = gc.rot;
  flame.draw(genome, cam, {
    iters: S.iters,
    decay: S.decay,
    exposure: S.exposure * autoExp,
    gamma: S.gamma,
    vibrancy: S.vibrancy,
    bgMix: S.bgMix,
    bgGradient: S.bgGradient,
    pointSize: S.pointSize,
    grain: S.grain,
    floor: S.floor,
    deBlur: S.deBlur,
    time: t,
  });
  // The show's auto-exposure, in short: keep the covered cells' average in range and the
  // bright end short of white.
  if (frameNo % 10 === 0) {
    const st = flame.readStats(S.exposure * autoExp, S.floor);
    if (st.coverage > 0 && st.level > 0) {
      const want = Math.max(0.2, 0.42 * (1 - 0.45 * st.coverage));
      const ratio = clamp(Math.min(want / st.level, 0.7 / Math.max(st.p90, 0.01)), 0.5, 2);
      autoExp = clamp(autoExp * Math.pow(ratio, 0.35), AUTO_EXP_MIN, AUTO_EXP_MAX);
    }
  }
}

// ---------------------------------------------------------- the field and spots

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
#define N ${SPOTS}
uniform vec2 uRes;
uniform float uPortrait;      // 1 on a tall screen: the field and everything on it turn 90 degrees
uniform vec4 uPlate[2];       // the plates under the words, on the field (unturned units): middle x, y, half width, half height
uniform float uPlateR[2];     // a plate's corner radius in field units
uniform float uPlatePx;       // screen pixels per field unit at the plate, for its rim and shadow sizes
uniform sampler2D uPic;
uniform vec3 uLight;          // toward the light
uniform vec4 uSpot[N];        // x, y, height above the field, radius
uniform vec4 uLook[N];        // zoom, pan x, pan y, hue turn (radians)
uniform float uTime;
uniform sampler2D uRocks;     // the photographs, in a grid on one texture
uniform float uRockN;         // how many; 0 means use the fractal
uniform vec2 uRockGrid;       // columns and rows of that grid
uniform sampler2D uShapes;    // each rock's silhouette: a row of radii round the compass
uniform float uShapeN;        // how many rows; 0 means the stones are smooth lobed domes
uniform vec4 uRock[N];        // this spot's photograph, the next, how far between them, and the rock whose shape it keeps
out vec4 outColor;

const vec2 FIELD = vec2(2.3, 1.725);   // half size of the lit field, the picture's shape; past every edge of the screen

// A point of the field as the picture sees it: on a tall screen the field is turned a
// quarter turn, so the wide picture lies along the long way of the screen.
vec2 unturned(vec2 p) {
  return uPortrait > 0.5 ? vec2(p.y, -p.x) : p;
}

vec3 pic(vec2 p) {   // the picture at a point of the field, p in field units, soft at its edges
  vec2 q = unturned(p);
  vec2 uv = q / FIELD * 0.5 + 0.5;
  if (abs(q.x) > FIELD.x || abs(q.y) > FIELD.y) return vec3(0.0);
  vec2 edge = smoothstep(vec2(0.0), vec2(0.12), FIELD - abs(q));
  return texture(uPic, vec2(uv.x, 1.0 - uv.y)).rgb * edge.x * edge.y;
}

// The picture blurred, for the frosted plate: the texture's coarser levels, which the
// page builds each frame.
vec3 picBlur(vec2 p) {
  vec2 q = unturned(p);
  vec2 uv = q / FIELD * 0.5 + 0.5;
  return textureLod(uPic, vec2(uv.x, 1.0 - uv.y), 2.2).rgb;
}

// How far a point of the field (unturned units) is outside plate i (negative inside), and
// the way out.
float plateDist(int i, vec2 fp, out vec2 outward) {
  vec4 pl = uPlate[i];
  vec2 h = pl.zw;
  vec2 q = fp - pl.xy;
  float r = min(uPlateR[i], min(h.x, h.y));
  if (r >= min(h.x, h.y) - 1e-4) {
    // An oval: the distance scaled by the half sizes, near enough for a rim.
    vec2 e = q / h;
    float m = length(e);
    outward = normalize(vec2(e.x / h.x, e.y / h.y) + 1e-6);
    return (m - 1.0) * min(h.x, h.y);
  }
  // A rounded rectangle.
  vec2 a = abs(q) - (h - r);
  vec2 c = max(a, 0.0);
  float d = length(c) + min(max(a.x, a.y), 0.0) - r;
  outward = normalize(sign(q) * (a.x > a.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) + sign(q) * c / max(length(c), 1e-6) + 1e-6);
  return d;
}

// One photograph from the strip, at uv within it.
vec3 rock(float which, vec2 uv) {
  uv = clamp(uv, 0.004, 0.996);
  float col = mod(which, uRockGrid.x);
  float row = floor(which / uRockGrid.x);
  return texture(uRocks, vec2((uv.x + col) / uRockGrid.x, (uv.y + row) / uRockGrid.y)).rgb;
}

vec3 hueTurn(vec3 c, float a) {
  float hc = cos(a);
  float hs = sin(a);
  mat3 m = mat3(
    0.213 + hc * 0.787 - hs * 0.213, 0.213 - hc * 0.213 + hs * 0.143, 0.213 - hc * 0.213 - hs * 0.787,
    0.715 - hc * 0.715 - hs * 0.715, 0.715 + hc * 0.285 + hs * 0.140, 0.715 - hc * 0.715 + hs * 0.715,
    0.072 - hc * 0.072 + hs * 0.928, 0.072 - hc * 0.072 - hs * 0.283, 0.072 + hc * 0.928 + hs * 0.072);
  return clamp(m * c, 0.0, 1.0);
}

// Rock which's silhouette at angle ang (anticlockwise from the right): how far its
// edge is from the centre, as a fraction of the picture's half side, so the stone's
// outline is the scanned rock's and the picture lands on it edge for edge.
float outlineOf(float which, float ang) {
  return texture(uShapes, vec2(ang / 6.2831853 + 0.5, (which + 0.5) / uShapeN)).r;
}
// The same for spot i: the one rock whose shape it keeps, so it never breathes as the
// pictures cross-fade (Amanda, 2026-10-07).
float outline(int i, float ang) {
  return outlineOf(uRock[i].w, ang);
}
// That rock's mean radius, for the shadow's cone, and its narrowest, for safe marching.
float girth(int i) {
  return texture(uShapes, vec2(0.5, (uRock[i].w + 0.5) / uShapeN)).g;
}
float least(int i) {
  return texture(uShapes, vec2(0.5, (uRock[i].w + 0.5) / uShapeN)).b;
}

// A spot's face: its own piece of the picture, turned its own colour.
vec3 spotFace(int i, vec2 local) {
  vec4 k = uLook[i];
  if (uRockN > 0.5) {
    // A photograph fills the spot; the next one fades in over it. The stone keeps one
    // rock's outline, so another rock's picture is pulled in or out along each compass
    // line until its edge meets the stone's edge.
    vec4 r = uRock[i];
    vec2 uv = local / uSpot[i].w * 0.5;
    if (uShapeN > 0.5) {
      float ang = atan(local.y, local.x);
      float base = outlineOf(r.w, ang);
      vec2 a = uv * outlineOf(r.x, ang) / base + 0.5;
      vec2 b = uv * outlineOf(r.y, ang) / base + 0.5;
      return mix(rock(r.x, vec2(a.x, 1.0 - a.y)), rock(r.y, vec2(b.x, 1.0 - b.y)), r.z);
    }
    uv += 0.5;
    uv.y = 1.0 - uv.y;
    return mix(rock(r.x, uv), rock(r.y, uv), r.z);
  }
  vec2 uv = (local / uSpot[i].w) * 0.5 / k.x + 0.5 + k.yz * (1.0 - 1.0 / k.x) * 0.5;
  vec3 c = texture(uPic, vec2(uv.x, 1.0 - uv.y)).rgb;
  return hueTurn(c, k.w);
}

// A lampshade: a cut-off cone standing on the field, wide end down, the narrow end (the
// cloth) facing out. Radius at height z: the base radius shrinking to half at the top.
#define TOP 0.7

// The ray o + t d meets lampshade i's side at t (the nearest, with 0 < t < tmax), with
// the side's normal n. Standard cone sums: |xy - c| = rb + k z.
bool hitShade(vec3 o, vec3 d, int i, float tmax, out float t, out vec3 n) {
  vec4 s = uSpot[i];
  // The cone is as wide as the rock on average: its outline is too fine for a shadow
  // three lights blur anyway, and marching it for every shadow ray would cost phones.
  s.w *= uShapeN > 0.5 ? girth(i) * 1.05 : 1.08;
  float k = (s.w * TOP - s.w) / s.z;
  vec3 p0 = o - vec3(s.xy, 0.0);
  float A = d.x * d.x + d.y * d.y - k * k * d.z * d.z;
  float B = 2.0 * (p0.x * d.x + p0.y * d.y) - 2.0 * k * (s.w + k * p0.z) * d.z;
  float C = p0.x * p0.x + p0.y * p0.y - (s.w + k * p0.z) * (s.w + k * p0.z);
  float disc = B * B - 4.0 * A * C;
  if (abs(A) < 1e-9 || disc < 0.0) return false;
  float sq = sqrt(disc);
  for (int side = 0; side < 2; side++) {
    float tt = (-B + (side == 0 ? -sq : sq)) / (2.0 * A);
    if (tt <= 1e-4 || tt >= tmax) continue;
    vec3 q = p0 + d * tt;
    if (q.z < 0.0 || q.z > s.z) continue;
    float r = s.w + k * q.z;
    n = normalize(vec3(q.xy / max(r, 1e-4), -k));
    t = tt;
    return true;
  }
  return false;
}

// The shade's real surface is a smooth rock shape (Amanda, 2026-10-07): a rounded,
// slightly squashed stone standing on the field, narrower at the top, with two or three
// slow lobes round it, each shade its own. This is a distance field, and the eye's rays
// march to it.
float bumps(int i, float ang, float v) {
  float k = float(i) * 2.3;
  return 0.07 * sin(2.0 * ang + k) * (0.6 + 0.4 * sin(v * 3.1416 + k * 0.7))
       + 0.05 * sin(3.0 * ang - k * 1.3 + v * 1.5);
}

// How far a point is from lampshade i's surface (negative inside); p from its base.
// The stone is a squashed, slightly oval dome set a little into the field: one smooth
// curve from the field to its top, no ledge and no edge anywhere.
float shadeSdf(int i, vec3 p) {
  vec4 s = uSpot[i];
  vec3 axes = vec3(s.w, s.w * 0.9, s.z * 1.15);
  vec3 q = p - vec3(0.0, 0.0, -s.z * 0.15);
  float ang = atan(q.y, q.x);
  if (uShapeN > 0.5) {
    // The scanned rock's own outline (Amanda, 2026-10-07): a dome whose every level has
    // the rock's silhouette, scaled, so the picture's edge meets the stone's edge all the
    // way round. Only the width follows the outline; the height is the stone's own, so
    // the top stays one smooth point.
    // Toward the crown the outline gives way to a circle: every direction meets at the
    // axis, where the angle means nothing, and the outline's bumps would pinch there.
    // The silhouette seen from above is the widest level, the base, and that keeps the
    // rock's shape in full.
    float w = sqrt(max(1.0 - pow(clamp(q.z / axes.z, 0.0, 1.0), 2.0), 0.0));
    float k = mix(girth(i), outline(i, ang), w);
    // Scaled by the rock's narrowest radius, not this angle's: where the outline curves
    // inward the surface is nearer than this angle says, and a bolder step would land
    // inside the stone and fold it.
    float d = (length(vec3(q.xy / (s.w * k), q.z / axes.z)) - 1.0) * min(s.w * least(i), axes.z);
    return max(d, -p.z);
  }
  float v = clamp(q.z / axes.z, -1.0, 1.0) * 0.5 + 0.5;
  // The lobes go round the stone, so they must fade to nothing at the top, where every
  // direction meets, or they would fold into a crease there.
  float round = sqrt(max(1.0 - pow(clamp(q.z / axes.z, 0.0, 1.0), 2.0), 0.0));
  float k = 1.0 + bumps(i, ang, v) * round;
  float d = (length(q / (axes * k)) - 1.0) * min(axes.x, axes.z) * k;
  return max(d, -p.z);
}

// The shades are cloth with a fine weave in it (Amanda, 2026-10-07: mesh fabric, but not
// see-through). How much darker the weave makes a point, 0.8 to 1.
float weave(vec2 uv) {
  vec2 g = abs(fract(uv * 90.0) - 0.5) * 2.0;   // 0 at a thread, 1 between
  float thread = 1.0 - smoothstep(0.35, 0.75, min(g.x, g.y));
  return 0.8 + 0.2 * thread;
}

// The eye's ray marched to lampshade i's soft surface: t, the normal, and whether it is
// the cloth end on top.
bool marchShade(vec3 o, vec3 d, int i, float tmax, out float t, out vec3 n, out bool top) {
  vec4 s = uSpot[i];
  vec3 c = vec3(s.xy, 0.0);
  // Only rays that pass near it: through a cylinder a little bigger than the shade.
  vec3 p0 = o - c;
  float rb = s.w * 1.3;
  float A = dot(d.xy, d.xy);
  float B = 2.0 * dot(p0.xy, d.xy);
  float C = dot(p0.xy, p0.xy) - rb * rb;
  float disc = B * B - 4.0 * A * C;
  if (A < 1e-9 || disc < 0.0) return false;
  float sq = sqrt(disc);
  float t0 = max((-B - sq) / (2.0 * A), 1e-4);
  float t1 = min((-B + sq) / (2.0 * A), tmax);
  // And only the band of heights the stone fills: from its crown down to the field.
  // Starting high above it wasted most of the march's steps, and a rock's outline
  // needs short steps, so without this the march ran out and bit pieces off.
  if (abs(d.z) > 1e-6) {
    float tTop = (s.z * 1.15 - p0.z) / d.z;
    float tField = -p0.z / d.z;
    if (d.z < 0.0) {
      t0 = max(t0, tTop);
      t1 = min(t1, tField);
    } else {
      t0 = max(t0, tField);
      t1 = min(t1, tTop);
    }
  }
  if (t1 <= t0) return false;
  float tt = t0;
  float lastStep = 0.0;
  for (int k = 0; k < 64; k++) {
    vec3 p = p0 + d * tt;
    float dist = shadeSdf(i, p);
    if (dist < 0.0015) {
      // Settle on the surface between the last step outside and this one.
      if (dist < 0.0 && k > 0) {
        float lo = tt - lastStep;
        float hi = tt;
        for (int j = 0; j < 5; j++) {
          float mid = (lo + hi) * 0.5;
          if (shadeSdf(i, p0 + d * mid) < 0.0) hi = mid; else lo = mid;
        }
        tt = hi;
        p = p0 + d * tt;
      }
      float e = 0.003;
      n = normalize(vec3(
        shadeSdf(i, p + vec3(e, 0.0, 0.0)) - shadeSdf(i, p - vec3(e, 0.0, 0.0)),
        shadeSdf(i, p + vec3(0.0, e, 0.0)) - shadeSdf(i, p - vec3(0.0, e, 0.0)),
        shadeSdf(i, p + vec3(0.0, 0.0, e)) - shadeSdf(i, p - vec3(0.0, 0.0, e))));
      t = tt;
      top = n.z > 0.65; // the crown of the stone is its cloth end
      return true;
    }
    // With a rock's outline the field is only nearly a distance, so step short of it.
    lastStep = max(dist * (uShapeN > 0.5 ? 0.7 : 1.0), 0.003);
    tt += lastStep;
    if (tt > t1) return false;
  }
  return false;
}

// The cloth end of lampshade i: the ray meets its top disc at t, within its rim.
bool hitCloth(vec3 o, vec3 d, int i, float tmax, out float t, out float dist) {
  vec4 s = uSpot[i];
  if (abs(d.z) < 1e-6) return false;
  t = (s.z - o.z) / d.z;
  if (t <= 1e-4 || t >= tmax) return false;
  dist = length(o.xy + d.xy * t - s.xy);
  return dist <= s.w * TOP;
}

// How much of one light reaches a point of the field: the lampshades stand in its way.
float litBy(vec3 o, vec3 L) {
  float keep = 1.0;
  if (L.z <= 0.02) return keep;
  for (int i = 0; i < N; i++) {
    vec4 s = uSpot[i];
    float t;
    float dist;
    if (hitCloth(o, L, i, 1e9, t, dist)) keep *= smoothstep(-0.03, 0.03, dist - s.w * TOP);
    vec3 n;
    if (hitShade(o, L, i, 1e9, t, n)) keep *= 0.0;
  }
  return keep;
}

// The light has some size, so a shadow's edge is soft: three lights a little apart.
float lit(vec2 p) {
  vec3 o = vec3(p, 0.001);
  vec3 a = normalize(cross(uLight, vec3(0.0, 0.0, 1.0)));
  vec3 b = cross(uLight, a);
  return (litBy(o, uLight) + litBy(o, normalize(uLight + a * 0.07)) + litBy(o, normalize(uLight + b * 0.07))) / 3.0;
}

void main() {
  vec2 a = (gl_FragCoord.xy / uRes * 2.0 - 1.0);
  a.x *= uRes.x / uRes.y;
  // The eye: over the field, a little back from its middle, looking nearly straight down,
  // close enough that the field runs off every edge of the screen.
  vec3 eye = vec3(0.0, -0.3, 1.3);
  vec3 f = normalize(vec3(0.0, 0.25, -1.0));
  vec3 r = normalize(cross(f, vec3(0.0, 0.0, 1.0)));
  vec3 u = cross(r, f);
  vec3 d = normalize(f + a.x * r * 0.7 + a.y * u * 0.7);
  vec3 col = vec3(0.0);
  // The lampshades first, nearest the eye: soft lumpy shapes, each wearing its own image
  // all over, lit where they face the light and darker round the back.
  float best = 1e9;
  for (int i = 0; i < N; i++) {
    vec4 s = uSpot[i];
    float tt;
    vec3 n;
    bool top;
    if (!marchShade(eye, d, i, best, tt, n, top)) continue;
    best = tt;
    vec3 q = eye + d * tt;
    float face = max(dot(n, uLight), 0.0);
    // The fabric: its own image, lit where it faces the light, with the weave in it.
    // The image is draped over the whole stone from above, as a projector would throw
    // it: no seam and no pinch at the top. The sides stretch it a little, as cloth does.
    vec2 uv = (q.xy - s.xy) / s.w;
    vec3 own = spotFace(i, q.xy - s.xy) * (0.3 + 0.45 * face);
    // The weave was for the lampshade cloth; a scanned rock has its own grain, and the
    // weave over it read as a mesh (Amanda, 2026-10-07).
    col = uRockN > 0.5 ? own : own * weave(uv * 0.5 + 0.5);
  }
  if (best > 1e8) {
    float tt = -eye.z / d.z;
    if (d.z < 0.0 && tt > 0.0) {
      vec2 p = eye.xy + d.xy * tt;
      col = pic(p);
      // The frosted plates under the words lie flat on the field: the picture blurred and
      // whitened there, a thin lit rim on the light's side and a dark one on the far side,
      // and their own shadow a sliver past the far edge with no gap; the stones' shadows
      // fall across them like the field (Amanda, 2026-10-08).
      // The plates lie on the field, so everything about them is in field units and in
      // the field's perspective, as the stones are (Amanda, 2026-10-08: the perspective
      // was off while the plate was a screen rectangle).
      vec2 fq = unturned(p);
      vec2 L2 = normalize(unturned(uLight.xy) + vec2(1e-6));
      float ppu = max(uPlatePx, 1.0);
      float plateShade = 0.0; // how much the plates' shadows cover this point
      for (int i = 0; i < 2; i++) {
        if (uPlate[i].z <= 0.0) continue;
        vec2 outward;
        float d = plateDist(i, fq, outward);
        if (d > 48.0 / ppu) continue;
        float facing = dot(outward, L2); // 1 on the light's side, -1 on the far side
        float aa = fwidth(d) * 0.7;
        if (d < 0.0) {
          // Grey smoked plexiglass (Amanda, 2026-10-08): the picture blurred and dimmed
          // behind it, greyed a little, with a lit rim on the light's side and a darker
          // one on the far side.
          vec3 frost = mix(picBlur(p) * 0.55, vec3(0.40, 0.45, 0.54), 0.3); // a slightly blue grey
          float rim = smoothstep(-3.0 / ppu, 0.0, d);
          frost += rim * max(facing, 0.0) * 0.18;
          frost *= 1.0 - rim * max(-facing, 0.0) * 0.5;
          col = mix(col, frost, smoothstep(aa, -aa, d)); // a crisp edge, one pixel soft
        } else {
          // The shadow the plate's thickness throws: the plate's outline swept away from
          // the light over its height, longer the lower the light, as the stones' shadows
          // are (Amanda, 2026-10-08: "taller so its shadow is longer"; a copy at the far
          // end alone left a notch at the corners). A point is in it when, moved back
          // toward the light by any part of that height, it lands inside the plate.
          float len = (26.0 / ppu) * clamp(1.0 / max(uLight.z, 0.3), 1.0, 2.6);
          vec2 back;
          float nearest = 1e9;
          for (int k = 1; k <= 12; k++) {
            nearest = min(nearest, plateDist(i, fq + L2 * (len * float(k) / 12.0), back));
          }
          plateShade = max(plateShade, 1.0 - smoothstep(-aa, aa, nearest));
        }
      }
      // The plates' shadows darken the field exactly as the stones' do: one shadow term.
      col *= 0.25 + 0.75 * lit(p) * (1.0 - plateShade);
    }
  }
  // A faint vignette, and the gamma.
  col *= 1.0 - 0.35 * dot(a * 0.5, a * 0.5);
  outColor = vec4(pow(col, vec3(1.0 / 1.1)), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

const gl = view.getContext("webgl2", { antialias: false, alpha: false });
if (!gl) fail("This needs a browser with WebGL2 (Chrome, Firefox, Safari 15 or newer).");
let program = null;
let tex = null;
const loc = new Map();
if (gl && flame) {
  program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) fail(gl.getProgramInfoLog(program));
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
const u = (name) => {
  if (!loc.has(name)) loc.set(name, gl.getUniformLocation(program, name));
  return loc.get(name);
};

// The spots: scattered over the field, each with its own piece of the picture.
const spots = [];
const looks = [];
// No stone under the mark and the words: their shadows pretend they lie on the field,
// and a stone behind them would give that away (Amanda, 2026-10-07). The title block's
// footprint in field units, a little above the middle; on a tall screen the field is
// turned, so the block is tall and narrow in field terms instead.
const tall = window.innerHeight > window.innerWidth; // the canvas is not yet fitted here
// The plate under the words, mark, dates and foot together, is wider than they are:
// no stone may sit under it (Amanda, 2026-10-08). In field units, as it lands on a wide
// screen and on a tall one, where the field is turned.
const PLATES = tall ? [{ cx: 0.05, cy: 0, hx: 0.54, hy: 0.52 }] : [{ cx: 0, cy: 0.05, hx: 0.98, hy: 0.62 }];
const underTitle = (x, y, base) => PLATES.some((p) => Math.abs(x - p.cx) < p.hx + base && Math.abs(y - p.cy) < p.hy + base);
const TITLE = PLATES[0];
for (let i = 0; i < SPOTS; i++) {
  // Anywhere on the screen, not on top of another, not under the title.
  const base = rng.range(0.19, 0.3); // the outline reaches 0.7 to 0.95 of this
  let x = 0;
  let y = 0;
  for (let tries = 0; tries < 80; tries++) {
    x = rng.range(-1.45, 1.45);
    y = rng.range(-0.7, 0.95);
    if (!underTitle(x, y, base) && spots.every((q) => Math.hypot(q[0] - x, q[1] - y) > 0.62)) break;
  }
  if (underTitle(x, y, base)) {
    // Out from under the title's plate, sideways; a spot that then lands under the
    // foot's is rare and goes up instead.
    x = Math.sign(x || 1) * (TITLE.hx + base + 0.05);
    if (underTitle(x, y, base)) y = 0.9;
  }
  spots.push([x, y, base * 0.9, base]); // wide, low stones
  looks.push([rng.range(1.6, 2.6), rng.range(-0.6, 0.6), rng.range(-0.6, 0.6), rng.range(1.0, 5.3)]);
}

// The photographs, when there are any: loaded into one strip, and each spot's slow walk
// through them.
let rocksTex = null;
let rockCount = 0;
let rockGrid = [1, 1];
let shapesTex = null;
let shapeCount = 0;
const rockState = spots.map((_, i) => ({ from: i % Math.max(ROCKS.length, 1), to: (i + 1) % Math.max(ROCKS.length, 1), base: i % Math.max(ROCKS.length, 1), at: rng.range(0, ROCK_HOLD) }));
if (ROCKS.length && gl) {
  Promise.all(
    ROCKS.map(
      (src) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        }),
    ),
  ).then((imgs) => {
    const ok = imgs.filter(Boolean);
    if (!ok.length) return;
    // A grid, not a strip: 25 rocks side by side would be 12800 px, past what many
    // GPUs allow for one texture (8192 on Safari and phones), and then nothing shows.
    const side = 512;
    const cols = Math.ceil(Math.sqrt(ok.length));
    const rows = Math.ceil(ok.length / cols);
    rockGrid = [cols, rows];
    const strip = document.createElement("canvas");
    strip.width = side * cols;
    strip.height = side * rows;
    const ink = strip.getContext("2d");
    ok.forEach((img, i) => {
      // Each photograph cropped square and scaled to fit its slot.
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const x = (i % cols) * side;
      const y = Math.floor(i / cols) * side;
      ink.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, x, y, side, side);
    });
    rocksTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rocksTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, strip);
    rockCount = ok.length;
    loadShapes(ROCKS.filter((_, i) => imgs[i]));
    rockState.forEach((r, i) => {
      r.from = i % rockCount;
      r.to = (i + 1) % rockCount;
      r.base = i % rockCount; // the rock whose shape this stone keeps
    });
  });
}

/** Each spot's place between its photographs: hold one, fade to the next, and on. */
function stepRocks(dt) {
  if (rockCount < 2) return;
  for (const r of rockState) {
    r.at += dt;
    if (r.at >= ROCK_HOLD + ROCK_FADE) {
      r.at -= ROCK_HOLD + ROCK_FADE;
      r.from = r.to;
      let next = Math.floor(rng.next() * rockCount);
      if (next === r.from) next = (next + 1) % rockCount;
      r.to = next;
    }
  }
}

// --------------------------------------------------------------- the light

// Where the light comes from: an azimuth and a height, eased toward where the mouse or
// the phone's tilt says. Straight above by default.
const light = { az: 0, el: 0.85, wantAz: 0, wantEl: 0.85 };

function aimLight(x, y) {
  // x, y in -1..1 across the screen: left and right swing the light round, up and down
  // raise and lower it.
  light.wantAz = x * 1.1;
  light.wantEl = clamp(0.85 - y * 0.5, 0.3, 1.35);
}

window.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch") return;
  aimLight((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
});
window.addEventListener("touchmove", (e) => {
  const tch = e.touches[0];
  if (tch) aimLight((tch.clientX / window.innerWidth) * 2 - 1, (tch.clientY / window.innerHeight) * 2 - 1);
});

function onTilt(e) {
  if (e.gamma === null || e.beta === null) return;
  // gamma: left and right tilt, -90 to 90; beta: front and back, with the phone upright at 90.
  aimLight(clamp(e.gamma / 45, -1, 1), clamp((e.beta - 55) / 40, -1, 1));
}
function startTilt() {
  window.addEventListener("deviceorientation", onTilt);
  enable.hidden = true;
}
if (window.DeviceOrientationEvent) {
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    // iPhones ask first, and only on a tap.
    enable.hidden = false;
    enable.addEventListener("click", () => {
      DeviceOrientationEvent.requestPermission()
        .then((state) => state === "granted" && startTilt())
        .catch(() => {});
      enable.hidden = true;
    });
  } else if ("ontouchstart" in window) {
    startTilt();
  }
}

// Space (or r), a click, or a tap: reseed. A fresh seed, a whole new run of designs, and
// the first of them arriving at once.
function reseed() {
  if (!animator) return;
  animator = new FlameAnimator(makeRng(randomSeed()), S);
  animator.newFlame(true);
}
window.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "r" || e.key === "R") {
    e.preventDefault();
    reseed();
  }
});
// A tap is a press that neither moves much nor lasts long: a finger dragged across the
// page is moving the light, not asking for a new design. Links and buttons keep their
// own clicks (Amanda, 2026-10-07).
let press = null;
const onControl = (e) => e.target instanceof Element && e.target.closest("a, button");
window.addEventListener("pointerdown", (e) => {
  if (onControl(e)) return;
  press = { x: e.clientX, y: e.clientY, at: performance.now() };
});
window.addEventListener("pointerup", (e) => {
  if (!press || onControl(e)) return;
  const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
  const held = performance.now() - press.at;
  press = null;
  if (moved < 12 && held < 400) reseed();
});
window.addEventListener("pointercancel", () => {
  press = null;
});

// Full screen on the f key.
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}
window.addEventListener("keydown", (e) => {
  if (e.key === "f" || e.key === "F") toggleFull();
});

// The mark and the words lie on the field like thin stickers, and their shadows fall the
// way the stones' do: away from the light, longer when it is low. The field's y points up
// the screen; in portrait the field is turned, so the vector turns with it. Set as CSS
// variables the stylesheet uses, only when they move enough to see.
// The words' shadow (Amanda, 2026-10-08: "take the plexiglass off and put this shadow on
// the letters"): black copies of the title block, stepped away from the light over the
// letters' height, in one group at the stones' shadow darkness behind the words. The
// group has the block's own perspective transform, so the steps foreshorten on the field
// as the stones' shadows do. Offsets in the block's own pixels, moved only for a change
// one can see.
const GHOSTS = 10;
const ghost = document.createElement("div");
ghost.id = "ghost";
const ghostCopies = [];
function makeGhosts() {
  const title = document.getElementById("title");
  if (!title || ghostCopies.length) return;
  for (let k = 0; k < GHOSTS; k++) {
    const copy = title.cloneNode(true);
    copy.removeAttribute("id");
    copy.classList.add("ghost-copy");
    copy.setAttribute("aria-hidden", "true");
    for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
    ghost.append(copy);
    ghostCopies.push(copy);
  }
  title.before(ghost);
}
const shadow = { x: NaN, y: NaN };
function castTextShadow(lx, ly, lz) {
  makeGhosts();
  // The letters stand off the field like the plate did: the shadow's length, longer the
  // lower the light.
  const len = 26 * Math.min(Math.max(1 / Math.max(lz, 0.3), 1), 2.6);
  let dx = -lx * len;
  let dy = ly * len; // CSS y points down
  if (view.height > view.width) [dx, dy] = [ly * len, lx * len]; // portrait: the field is turned
  if (Math.abs(dx - shadow.x) < 0.5 && Math.abs(dy - shadow.y) < 0.5) return;
  shadow.x = dx;
  shadow.y = dy;
  ghostCopies.forEach((copy, k) => {
    const f = (k + 1) / GHOSTS;
    copy.style.setProperty("--gx", `${(dx * f).toFixed(1)}px`);
    copy.style.setProperty("--gy", `${(dy * f).toFixed(1)}px`);
  });
}

// The rocks' silhouettes, from img/rocks/shapes.json (the scanner tool writes it): one
// row per rock, 64 radii round the compass in red and the mean in green. Rocks without
// a shape get a circle, so the picture still lands where the stone is.
function loadShapes(names) {
  fetch("img/rocks/shapes.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((shapes) => {
      if (!shapes || !gl) return;
      const angles = 64;
      const data = new Uint8Array(angles * names.length * 4);
      names.forEach((name, row) => {
        const shape = shapes[name.split("/").pop()];
        const radii = shape ? shape.r : Array(angles).fill(0.8);
        const mean = shape ? shape.mean : 0.8;
        for (let k = 0; k < angles; k++) {
          const at = (row * angles + k) * 4;
          data[at] = Math.round(Math.min(1, Math.max(0, radii[k])) * 255);
          data[at + 1] = Math.round(mean * 255);
          data[at + 2] = Math.round(Math.min(...radii) * 255);
          data[at + 3] = 255;
        }
      });
      shapesTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, shapesTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); // the compass goes round
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, angles, names.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      shapeCount = names.length;
    })
    .catch(() => {});
}


// ------------------------------------------------- the plate lies on the field

// The camera, as the shader has it, so the page can put a point of the field on the
// screen and back.
const CAM = (() => {
  const norm = (v) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const f = norm([0, 0.25, -1]);
  const r = norm([f[1], -f[0], 0]); // cross(f, up)
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]; // cross(r, f)
  return { eye: [0, -0.3, 1.3], f, r, u };
})();
function screenToField(sx, sy) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const ax = ((sx / W) * 2 - 1) * (W / H);
  const ay = -((sy / H) * 2 - 1);
  const d = [0, 1, 2].map((k) => CAM.f[k] + ax * CAM.r[k] * 0.7 + ay * CAM.u[k] * 0.7);
  const t = -CAM.eye[2] / d[2];
  return [CAM.eye[0] + d[0] * t, CAM.eye[1] + d[1] * t];
}
function fieldToScreen(px, py) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const v = [px - CAM.eye[0], py - CAM.eye[1], -CAM.eye[2]];
  const dot = (a) => a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  const z = dot(CAM.f);
  const ax = dot(CAM.r) / z / 0.7;
  const ay = dot(CAM.u) / z / 0.7;
  return [((ax / (W / H) + 1) / 2) * W, ((1 - ay) / 2) * H];
}
// The field's "unturned" units: on a tall screen the field is turned 90 degrees, and the
// plate and the words are laid out in the turned frame so they stay upright.
const unturn = (p, portrait) => (portrait ? [p[1], -p[0]] : p);
const turn = (q, portrait) => (portrait ? [-q[1], q[0]] : q);

// The plate: a rounded rectangle on the field under the title block, a little wider and
// taller than the words, and the words laid onto the field by a perspective transform so
// they lie on the plate, as the stones lie on the field. Worked out from the block's own
// size, which changes only with the window.
const PLATE_ON = false;
let laid = { key: "", rect: [0, 0, 0, 0], radius: 0, ppu: 1 };
function layPlate(portrait) {
  const el = document.getElementById("title");
  if (!el) return laid;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const key = `${W}x${H}:${w}x${h}:${portrait}`;
  if (key === laid.key || !w) return laid;
  // The block's own place, as the stylesheet puts it before any transform: centred, a
  // little above the middle.
  const cx = W / 2;
  const cy = H / 2 - 0.08 * h;
  const q = (sx, sy) => unturn(screenToField(sx, sy), portrait);
  const extent = (halfW, halfH) => {
    const pts = [q(cx - halfW, cy), q(cx + halfW, cy), q(cx, cy - halfH), q(cx, cy + halfH)];
    const xs = pts.map((v) => v[0]);
    const ys = pts.map((v) => v[1]);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, hx: (Math.max(...xs) - Math.min(...xs)) / 2, hy: (Math.max(...ys) - Math.min(...ys)) / 2 };
  };
  // The plate, padded; the words, exact.
  const padW = portrait ? 0.49 * W : (w / 2) * 1.1;
  const padH = portrait ? h / 2 + 44 : (h / 2) * 1.5;
  const plate = extent(padW, padH);
  const words = extent(w / 2, h / 2);
  const ppu = 1 / Math.hypot(...[0, 1].map((k) => q(cx + 1, cy)[k] - q(cx, cy)[k]));
  // The words' rectangle on the field, back to the screen as four corners, and the block
  // fitted onto them.
  const corners = [
    [words.x - words.hx, words.y + words.hy],
    [words.x + words.hx, words.y + words.hy],
    [words.x + words.hx, words.y - words.hy],
    [words.x - words.hx, words.y - words.hy],
  ].map((c) => fieldToScreen(...turn(c, portrait)));
  const tl = corners.reduce((a, b) => (a[0] + a[1] <= b[0] + b[1] ? a : b));
  const br = corners.reduce((a, b) => (a[0] + a[1] >= b[0] + b[1] ? a : b));
  const tr = corners.reduce((a, b) => (a[0] - a[1] >= b[0] - b[1] ? a : b));
  const bl = corners.reduce((a, b) => (a[0] - a[1] <= b[0] - b[1] ? a : b));
  const lie = cornersToCss(w, h, [tl, tr, br, bl]);
  el.style.left = "0";
  el.style.top = "0";
  el.style.transformOrigin = "0 0";
  el.style.transform = lie;
  ghost.style.width = `${w}px`;
  ghost.style.height = `${h}px`;
  ghost.style.transform = lie;
  // The plate is off (Amanda, 2026-10-08: the shadow is on the letters instead); its
  // size is kept so it can come back.
  laid = { key, rect: PLATE_ON ? [plate.x, plate.y, plate.hx, plate.hy] : [0, 0, 0, 0], radius: 14 / ppu, ppu };
  return laid;
}

// ----------------------------------------------------------------- the frames

function fit() {
  // Enough pixels to look sharp, not so many that a phone or a big screen crawls.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(2.2e6 / (window.innerWidth * window.innerHeight)));
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (view.width !== w || view.height !== h) {
    view.width = w;
    view.height = h;
  }
}
window.addEventListener("resize", fit);

// Thirty frames a second is plenty for a picture that changes this slowly, and half
// the battery of sixty (a quarter on a 120 Hz screen); and nothing at all while the tab
// is hidden (the audit of 2026-10-07).
const FRAME_MS = 1000 / 30;
let last = performance.now();
let drawnAt = -1e9;
function frame(now) {
  requestAnimationFrame(frame);
  if (!gl || !flame || !program || document.hidden) return;
  if (now - drawnAt < FRAME_MS - 1) return;
  drawnAt = now;
  const dt = clamp((now - last) / 1000, 0.001, 0.1);
  last = now;
  t += dt;
  frameNo++;
  // The first frame: a few turns of the flame first, so the picture is already there
  // rather than building up from black over the first second.
  if (frameNo === 1) {
    for (let k = 0; k < 8; k++) drawFlame(1 / 30);
    performance.mark("first-frame");
  }
  drawFlame(dt);
  stepRocks(dt);
  // Ease the light toward where it is wanted.
  const k = 1 - Math.exp(-dt / 0.25);
  light.az += (light.wantAz - light.az) * k;
  light.el += (light.wantEl - light.el) * k;
  const lx = Math.sin(light.az) * Math.cos(light.el);
  const ly = -Math.cos(light.az) * Math.cos(light.el);
  const lz = Math.sin(light.el);
  fit();
  castTextShadow(lx, ly, lz);
  gl.viewport(0, 0, view.width, view.height);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, flameCanvas);
  gl.generateMipmap(gl.TEXTURE_2D); // the coarser levels blur the picture under the plates
  gl.uniform1i(u("uPic"), 0);
  gl.uniform2f(u("uRes"), view.width, view.height);
  const portrait = view.height > view.width;
  gl.uniform1f(u("uPortrait"), portrait ? 1 : 0);
  const plate = layPlate(portrait);
  gl.uniform4fv(u("uPlate"), [...plate.rect, 0, 0, 0, 0]);
  gl.uniform1fv(u("uPlateR"), [plate.radius, 0]);
  gl.uniform1f(u("uPlatePx"), plate.ppu * (view.width / window.innerWidth));
  gl.uniform3f(u("uLight"), lx, ly, lz);
  // On a tall screen the stones turn with the field: (x, y) on the wide field becomes (-y, x).
  gl.uniform4fv(u("uSpot"), spots.flatMap((q) => (portrait ? [-q[1], q[0], q[2], q[3]] : q)));
  gl.uniform4fv(u("uLook"), looks.flat());
  gl.uniform1f(u("uTime"), t);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, rocksTex || tex);
  gl.uniform1i(u("uRocks"), 1);
  gl.uniform1f(u("uRockN"), rockCount);
  gl.uniform2f(u("uRockGrid"), rockGrid[0], rockGrid[1]);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, shapesTex || tex);
  gl.uniform1i(u("uShapes"), 2);
  gl.uniform1f(u("uShapeN"), shapeCount);
  gl.uniform4fv(
    u("uRock"),
    rockState.flatMap((r) => [r.from, r.to, clamp((r.at - ROCK_HOLD) / ROCK_FADE, 0, 1), r.base]),
  );
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
requestAnimationFrame(frame);
