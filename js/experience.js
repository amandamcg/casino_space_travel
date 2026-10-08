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

import { FlameAnimator } from "./genome.js";
import { FlameRenderer } from "./flame.js";
import { makeRng, randomSeed, clamp } from "./rng.js";
import { defaults } from "./settings.js";

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
uniform sampler2D uPic;
uniform vec3 uLight;          // toward the light
uniform vec4 uSpot[N];        // x, y, height above the field, radius
uniform vec4 uLook[N];        // zoom, pan x, pan y, hue turn (radians)
uniform float uTime;
uniform sampler2D uRocks;     // the photographs, side by side in one strip
uniform float uRockN;         // how many; 0 means use the fractal
uniform vec3 uRock[N];        // this spot's photograph, the next, and how far between them
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

// One photograph from the strip, at uv within it.
vec3 rock(float which, vec2 uv) {
  uv = clamp(uv, 0.004, 0.996);
  return texture(uRocks, vec2((uv.x + which) / uRockN, uv.y)).rgb;
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

// A spot's face: its own piece of the picture, turned its own colour.
vec3 spotFace(int i, vec2 local) {
  vec4 k = uLook[i];
  if (uRockN > 0.5) {
    // A photograph fills the spot; the next one fades in over it.
    vec2 uv = local / uSpot[i].w * 0.5 + 0.5;
    uv.y = 1.0 - uv.y;
    vec3 r = uRock[i];
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
  s.w *= 1.08; // the soft shape's lumps stick out past the cone
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
  float v = clamp(q.z / axes.z, -1.0, 1.0) * 0.5 + 0.5;
  // The lobes go round the stone, so they must fade to nothing at the top, where every
  // direction meets, or they would fold into a crease there.
  float round = sqrt(max(1.0 - pow(clamp(q.z / axes.z, 0.0, 1.0), 2.0), 0.0));
  float k = 1.0 + bumps(i, atan(q.y, q.x), v) * round;
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
  if (t1 <= t0) return false;
  float tt = t0;
  for (int k = 0; k < 48; k++) {
    vec3 p = p0 + d * tt;
    float dist = shadeSdf(i, p);
    if (dist < 0.0015) {
      float e = 0.003;
      n = normalize(vec3(
        shadeSdf(i, p + vec3(e, 0.0, 0.0)) - shadeSdf(i, p - vec3(e, 0.0, 0.0)),
        shadeSdf(i, p + vec3(0.0, e, 0.0)) - shadeSdf(i, p - vec3(0.0, e, 0.0)),
        shadeSdf(i, p + vec3(0.0, 0.0, e)) - shadeSdf(i, p - vec3(0.0, 0.0, e))));
      t = tt;
      top = n.z > 0.65; // the crown of the stone is its cloth end
      return true;
    }
    tt += max(dist, 0.003);
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
    col = own * weave(uv * 0.5 + 0.5);
  }
  if (best > 1e8) {
    float tt = -eye.z / d.z;
    if (d.z < 0.0 && tt > 0.0) {
      vec2 p = eye.xy + d.xy * tt;
      col = pic(p) * (0.25 + 0.75 * lit(p));
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
for (let i = 0; i < SPOTS; i++) {
  // Anywhere on the screen, not on top of another.
  let x = 0;
  let y = 0;
  for (let tries = 0; tries < 40; tries++) {
    x = rng.range(-1.45, 1.45);
    y = rng.range(-0.7, 0.95);
    if (spots.every((q) => Math.hypot(q[0] - x, q[1] - y) > 0.62)) break;
  }
  const base = rng.range(0.16, 0.26);
  spots.push([x, y, base * 0.9, base]); // wide, low stones
  looks.push([rng.range(1.6, 2.6), rng.range(-0.6, 0.6), rng.range(-0.6, 0.6), rng.range(1.0, 5.3)]);
}

// The photographs, when there are any: loaded into one strip, and each spot's slow walk
// through them.
let rocksTex = null;
let rockCount = 0;
const rockState = spots.map((_, i) => ({ from: i % Math.max(ROCKS.length, 1), to: (i + 1) % Math.max(ROCKS.length, 1), at: rng.range(0, ROCK_HOLD) }));
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
    const side = 512;
    const strip = document.createElement("canvas");
    strip.width = side * ok.length;
    strip.height = side;
    const ink = strip.getContext("2d");
    ok.forEach((img, i) => {
      // Each photograph cropped square and scaled to fit its slot.
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      ink.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, i * side, 0, side, side);
    });
    rocksTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rocksTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, strip);
    rockCount = ok.length;
    rockState.forEach((r, i) => {
      r.from = i % rockCount;
      r.to = (i + 1) % rockCount;
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

// Space (or r): reseed. A fresh seed, a whole new run of designs, and the first of them
// arriving at once.
window.addEventListener("keydown", (e) => {
  if (!animator) return;
  if (e.key === " " || e.key === "r" || e.key === "R") {
    e.preventDefault();
    animator = new FlameAnimator(makeRng(randomSeed()), S);
    animator.newFlame(true);
  }
});

// Full screen on the f key.
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}
window.addEventListener("keydown", (e) => {
  if (e.key === "f" || e.key === "F") toggleFull();
});

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

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (!gl || !flame || !program) return;
  const dt = clamp((now - last) / 1000, 0.001, 0.1);
  last = now;
  t += dt;
  frameNo++;
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
  gl.viewport(0, 0, view.width, view.height);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, flameCanvas);
  gl.uniform1i(u("uPic"), 0);
  gl.uniform2f(u("uRes"), view.width, view.height);
  const portrait = view.height > view.width;
  gl.uniform1f(u("uPortrait"), portrait ? 1 : 0);
  gl.uniform3f(u("uLight"), lx, ly, lz);
  // On a tall screen the stones turn with the field: (x, y) on the wide field becomes (-y, x).
  gl.uniform4fv(u("uSpot"), spots.flatMap((q) => (portrait ? [-q[1], q[0], q[2], q[3]] : q)));
  gl.uniform4fv(u("uLook"), looks.flat());
  gl.uniform1f(u("uTime"), t);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, rocksTex || tex);
  gl.uniform1i(u("uRocks"), 1);
  gl.uniform1f(u("uRockN"), rockCount);
  gl.uniform3fv(
    u("uRock"),
    rockState.flatMap((r) => [r.from, r.to, clamp((r.at - ROCK_HOLD) / ROCK_FADE, 0, 1)]),
  );
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
requestAnimationFrame(frame);
