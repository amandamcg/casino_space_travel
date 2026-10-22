/**
 * The walkthrough: the room composer's picture on the whole window with the show itself
 * live on the walls, as a page of its own for the casinospacetravel.com site (Amanda,
 * 2026-10-06: the site redo is the composer's full-screen first-person walk, released
 * publicly). No panels, no server: the room is a static file (js/room.json, a copy of the
 * layout designed in the composer), the rocks and the toy are the same pictures, and the
 * fractal is the show's own renderer drawn into a hidden canvas with the show's default
 * settings and no sound, as the experience page does it.
 *
 * It opens with the film (in by the east curtain, along the path, a spin of the wheel, a
 * sit on the bench, out by the north curtain), and any key or touch hands the visitor
 * over: W A S D or the arrows walk, Shift hurries, dragging turns the head, a click takes
 * the mouse for looking round, and on a phone the pad in the corner walks. Space, Enter or
 * 1 to 4 give the wheel a spin (the show answers as it does to the toy).
 */

import {
  BENCH,
  LOOK_KEYS,
  ROCKS,
  ROOM,
  SURFACES,
  easeStill,
  normalizeLayout,
  packScene,
  pathHeading,
  pathPoint,
  referenceRadiance,
  rockFile,
  sitterHead,
  toyPlace,
  walkTo,
} from "./composer/scene.js";
import { Tracer } from "./composer/tracer.js";
import { FlameAnimator, setLikedPalettes } from "./genome.js";
import { FlameRenderer } from "./flame.js";
import { makeRng, randomSeed, clamp } from "./rng.js";
import { defaults } from "./settings.js";
import { SetLooks } from "./setlooks.js";
import { otherRock, rockPool } from "./mapping.js";

const ROOM_FILE = "js/room.json";
const W = 1024;
const H = 768;
const AUTO_EXP_MIN = 0.003;
const AUTO_EXP_MAX = 30;
const ADJUSTED_MEAN = 0.3; // the eyes' middling brightness, as the composer has it
const MOST_ADAPTED = 4;
const WALK_SPEED = 36; // inches a second, a gallery pace
const LOOK_PER_PX = 0.12; // degrees of turn for each pixel the mouse moves with the pointer locked
const ROCK_FADE = 3; // seconds a rock spot takes to become another rock
const WALK_KEYS = { w: [1, 0], s: [-1, 0], a: [0, 1], d: [0, -1], ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, 1], ArrowRight: [0, -1] };
const SPIN_KEYS = new Set([" ", "Enter", "1", "2", "3", "4"]);
// Drawn finely to start (a phone starts one step down); when the frames come slower than
// SLOW_FPS over a few seconds the next level takes fewer pixels and mirror bounces (the
// composer's Quick and Fast), and it never climbs back, so the picture keeps moving.
const QUALITY = [
  { name: "fine", scale: 1, bounces: 12, quick: 0, pixels: 1.4e6 },
  { name: "quick", scale: 1, bounces: 5, quick: 1, pixels: 0.9e6 },
  { name: "fast", scale: 1, bounces: 2, quick: 2, pixels: 0.5e6 },
];
const SLOW_FPS = 22;

const $ = (id) => document.getElementById(id);
const view = $("view");
const hud = $("hud");
const title = $("title");
const pad = $("pad");
const replay = $("replay");
const fallback = $("fallback");
const touch = window.matchMedia("(pointer: coarse)").matches;

function fail(text) {
  fallback.textContent = text;
  fallback.hidden = false;
  title.classList.add("stay");
  hud.hidden = true;
  pad.hidden = true;
  replay.hidden = true;
}

// ------------------------------------------------------------------ the pictures

let tracer = null;
let flame = null;
let animator = null;
const flameCanvas = document.createElement("canvas");
const S = defaults();
try {
  tracer = new Tracer(view);
  flame = new FlameRenderer(flameCanvas, W, H, () => location.reload(), () => {});
  animator = new FlameAnimator(makeRng(randomSeed()), S);
} catch (err) {
  fail("This page needs a browser with WebGL2 (Chrome, Firefox, Safari 15 or newer).");
}
fetch("js/liked-palettes.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => j && setLikedPalettes(j.liked, false))
  .catch(() => {});

const cam = { cx: 0, cy: 0, scale: 0.5, rot: 0 };
let autoExp = 1;
let flameTime = 0;
let flameFrames = 0;

/** One step of the show's fractal into the hidden canvas, with the show's auto-exposure. */
function drawFlame(dt) {
  flameTime += dt;
  const genome = animator.update(dt, 0, 0.5);
  Object.assign(cam, { cx: genome.camera.cx, cy: genome.camera.cy, scale: genome.camera.scale, rot: genome.camera.rot });
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
    time: flameTime,
  });
  if (flameFrames++ % 10 === 0) {
    const st = flame.readStats(S.exposure * autoExp, S.floor);
    if (st.coverage > 0 && st.level > 0) {
      const want = Math.max(0.2, 0.42 * (1 - 0.45 * st.coverage));
      const ratio = clamp(Math.min(want / st.level, 0.7 / Math.max(st.p90, 0.01)), 0.5, 2);
      autoExp = clamp(autoExp * Math.pow(ratio, 0.35), AUTO_EXP_MIN, AUTO_EXP_MAX);
    }
  }
}

/** A spin of the wheel: the show answers as it does to the toy. */
function spin(amount = 1) {
  if (animator) animator.kick(S.mutation * amount);
}

// How bright the projected picture is, on average and at its brightest, read off the
// fractal a few times a second so the room's exposure follows it without pumping.
let still = { mean: [1, 1, 1], level: 1 };
const meter = document.createElement("canvas");
meter.width = 64;
meter.height = 48;
const meterInk = meter.getContext("2d", { willReadFrequently: true });
function measureStill(img) {
  meterInk.drawImage(img, 0, 0, 64, 48);
  const px = meterInk.getImageData(0, 0, 64, 48).data;
  const mean = [0, 0, 0];
  const lum = [];
  for (let i = 0; i < px.length; i += 4) {
    const rgb = [px[i], px[i + 1], px[i + 2]].map((v) => (v / 255) ** 2.2);
    rgb.forEach((v, k) => (mean[k] += v));
    lum.push(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
  }
  lum.sort((a, b) => a - b);
  return { mean: mean.map((v) => v / lum.length), level: Math.max(0.05, lum[Math.floor(lum.length * 0.95)]) };
}

// The eyes adjust to however much light is in the room, as in the composer: the average
// brightness of the last picture nudges the next one toward a middling level.
let adapted = 1;
const eye = document.createElement("canvas");
eye.width = 32;
eye.height = 20;
const eyeInk = eye.getContext("2d", { willReadFrequently: true });
function adapt() {
  eyeInk.drawImage(view, 0, 0, eye.width, eye.height);
  const d = eyeInk.getImageData(0, 0, eye.width, eye.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const mean = Math.max(sum / (255 * (d.length / 4)), 0.002);
  const wanted = Math.min(Math.max(adapted * (ADJUSTED_MEAN / mean) ** 0.7, 1 / MOST_ADAPTED), MOST_ADAPTED);
  adapted += (wanted - adapted) * 0.12;
}

// ------------------------------------------------------------------ the room

let layout = null;
let qualityLevel = touch ? 1 : 0;
let quality = QUALITY[qualityLevel];
let fade = 0; // 0 to 1: how far the picture has gone to black (the curtains)

// The sets take new looks of their own as they do in the show, at the show's default pace;
// a rock set's new look is each spot fading to another rock.
const setLooks = new SetLooks();
const liveLooks = new Map(); // set letter -> the look it has taken for now
const liveRocks = new Map(); // spot id -> { from, to, start }
let rockShapes = {};
let looksAt = 0;

function driftLooks(now) {
  const dt = looksAt ? Math.min((now - looksAt) / 1000, 0.1) : 0;
  looksAt = now;
  setLooks.setRegions(layout.spots.map((s) => ({ link: s.set })));
  for (const { link, variant } of setLooks.update(dt, S)) {
    const members = layout.spots.filter((s) => s.set === link);
    if (members.length && members.every((s) => s.source !== "main")) {
      for (const s of members) {
        const was = liveRocks.get(s.id);
        const from = was ? was.to : s.rock;
        liveRocks.set(s.id, { from, to: otherRock(from, rockPool(rockShapes)), start: now });
      }
      continue;
    }
    liveLooks.set(link, variant);
  }
}

function withLiveLooks(now) {
  if (!liveLooks.size && !liveRocks.size) return layout;
  const pick = (variant) => Object.fromEntries(LOOK_KEYS.map((k) => [k, variant[k]]));
  return {
    ...layout,
    spots: layout.spots.map((s) => {
      if (s.source !== "main" && liveRocks.has(s.id)) {
        const f = liveRocks.get(s.id);
        return { ...s, rock: f.from, rockTo: f.to, rockMix: Math.min(1, (now - f.start) / (ROCK_FADE * 1000)) };
      }
      return liveLooks.has(s.set) ? { ...s, ...pick(liveLooks.get(s.set)) } : s;
    }),
  };
}

/** Size the canvas to the window, within the quality level's pixel budget. */
function fit() {
  quality = QUALITY[qualityLevel];
  const budget = quality.pixels;
  const k = Math.min(window.devicePixelRatio || 1, Math.sqrt(budget / (window.innerWidth * window.innerHeight)));
  view.width = Math.max(320, Math.round(window.innerWidth * k));
  view.height = Math.max(200, Math.round(window.innerHeight * k));
}

function draw(now) {
  const area = 2 * (ROOM.length * ROOM.width + ROOM.length * ROOM.height + ROOM.width * ROOM.height);
  const lumens = layout.projectors.reduce((sum, p) => sum + p.lm, 0);
  const ambient = still.mean.map((c) => (0.82 * lumens * c) / area);
  const ref = referenceRadiance(layout, ROOM, still.level);
  const nudge = adapted * 2 ** layout.view.brightness;
  const packed = packScene(withLiveLooks(now));
  tracer.render(packed, { ambient, exposure: (ref > 0 ? 1.97 / ref : 1) * nudge, surfaces: SURFACES, time: now / 1000, fade, ...quality });
  if (fade < 1) adapt();
}

// ------------------------------------------------------------------ the film

// The walk through the room as the composer plays it (Amanda, 2026-10-06): in through the
// east doorway's curtain, along the path, a stop to face the wheel and spin it, a sit on
// the bench, the rest of the path and out through the north doorway's curtain, to black.
const STROLL = 20; // inches a second
const TURN_SECS = 1.6;
const CURTAIN_SECS = 1.5;
const WHEEL_PLAY = [0.3, 1.8, 3.4]; // seconds into the stop at the wheel when it is spun
const WHEEL_SECS = 4.6;
const WHEEL_LOOK_SECS = 1.4;
let film = null; // { steps, i, t0 }

function applyState(st) {
  const v = layout.visitor;
  Object.assign(v, { x: st.x, y: st.y, yaw: st.yaw, pitch: st.pitch, eye: st.eye, along: st.along });
  layout.view.from = st.from;
  layout.bench.look = st.look;
  layout.bench.pitch = st.lookPitch;
  fade = st.fade || 0;
}

function filmSteps() {
  const hasPath = Boolean(layout.path.on);
  const hasBench = Boolean(layout.bench.on);
  const ped = layout.pedestal;
  const heading = (from, to) => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
  const doorIn = [ROOM.length - 1, (ROOM.eastDoor.from + ROOM.eastDoor.to) / 2];
  const doorOut = [(ROOM.entry.from + ROOM.entry.to) / 2, ROOM.width - 1];
  const at = (s) => (hasPath ? pathPoint(layout, s) : [doorIn[0] + (doorOut[0] - doorIn[0]) * s, doorIn[1] + (doorOut[1] - doorIn[1]) * s]);
  const facing = (s) => (hasPath ? pathHeading(layout, s) : heading(at(0), at(1)));
  const nearest = (point) => {
    let best = 0.5;
    let bestD = Infinity;
    for (let i = 0; i <= 60; i++) {
      const p = at(i / 60);
      const d = Math.hypot(p[0] - point[0], p[1] - point[1]);
      if (d < bestD) {
        bestD = d;
        best = i / 60;
      }
    }
    return best;
  };
  const sWheel = nearest([ped.x, ped.y]);
  const sBench = hasBench ? nearest([layout.bench.x, layout.bench.y]) : sWheel;
  const base = { eye: layout.visitor.eye, pitch: 0, from: "visitor", along: -1, look: layout.bench.look, lookPitch: layout.bench.pitch, fade: 0 };
  const stand = (s, yaw, extra = {}) => ({ ...base, x: at(s)[0], y: at(s)[1], yaw, s, ...extra });
  const walkSecs = (s0, s1) => {
    let len = 0;
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = at(s0 + ((s1 - s0) * i) / n);
      const b = at(s0 + ((s1 - s0) * (i + 1)) / n);
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return Math.max(0.5, len / STROLL);
  };
  const steps = [];
  let here = stand(0.02, facing(0.02), { fade: 1 });
  const go = (next, secs, kind = "turn", extra = {}) => {
    steps.push({ from: here, to: next, secs, kind, ...extra });
    here = next;
  };
  go(stand(0.02, facing(0.02)), CURTAIN_SECS, "fade");
  go({ ...here }, 1, "hold");
  const first = Math.min(sWheel, sBench);
  const second = Math.max(sWheel, sBench);
  const visit = (s) => {
    if (s === sWheel) {
      const [px, py] = at(s);
      const yaw = heading([px, py], [ped.x, ped.y]);
      const wheel = toyPlace(ped);
      const down = (Math.atan2(wheel.z + 2 - base.eye, Math.max(Math.hypot(ped.x - px, ped.y - py), 1)) * 180) / Math.PI;
      go(stand(s, yaw, { pitch: Math.max(-60, down) }), TURN_SECS);
      go({ ...here }, WHEEL_LOOK_SECS, "play", { offset: 0 });
      go({ ...here, pitch: 12 }, WHEEL_SECS - WHEEL_LOOK_SECS, "play", { offset: WHEEL_LOOK_SECS });
      go({ ...here }, 0.8, "hold");
    } else if (hasBench) {
      const b = layout.bench;
      const [sx, sy] = sitterHead(b, 1);
      const [px, py] = at(s);
      go(stand(s, heading([px, py], [sx, sy])), TURN_SECS);
      const stride = Math.hypot(sx - px, sy - py);
      go({ ...here, x: sx, y: sy, s: undefined }, Math.max(0.6, stride / STROLL), "walk");
      go({ ...here, yaw: b.look, pitch: b.pitch }, TURN_SECS);
      const seated = { ...here, eye: BENCH.eye };
      go(seated, 1.4);
      const [ex, ey] = [ROOM.length - 12, (ROOM.eastDoor.from + ROOM.eastDoor.to) / 2];
      go({ ...seated, from: "bench", x: ex, y: ey, yaw: 0 }, 0.5, "cut");
      go({ ...here }, 5, "hold");
      go({ ...seated, from: "visitor", x: sx, y: sy, yaw: here.yaw }, 0.5, "cut");
      go({ ...seated, eye: base.eye }, 1.4);
      go({ ...here, yaw: heading([sx, sy], [px, py]) }, TURN_SECS);
      go(stand(s, heading([sx, sy], [px, py])), Math.max(0.6, stride / STROLL), "walk");
    }
  };
  go(stand(first, facing(first)), walkSecs(0, first), "walk");
  visit(first);
  if (second > first + 0.01) {
    go(stand(first, facing(first)), TURN_SECS);
    go(stand(second, facing(second)), walkSecs(first, second), "walk");
    visit(second);
  }
  go(stand(second, facing(second)), TURN_SECS);
  go(stand(0.97, facing(0.97)), walkSecs(second, 0.97), "walk");
  go(stand(1, facing(1), { fade: 1 }), CURTAIN_SECS, "fade");
  go({ ...here }, 1, "hold");
  return steps;
}

const ease = (u) => u * u * (3 - 2 * u);
const lerpDeg = (a, b, u) => a + (((((b - a) % 360) + 540) % 360) - 180) * u;

function filmStep(now) {
  const step = film.steps[film.i];
  if (!step) return endFilm(true);
  const u = Math.min((now - film.t0) / 1000 / step.secs, 1);
  const e = step.kind === "walk" ? u : ease(u);
  if (step.kind === "play") {
    const secs = u * step.secs + (step.offset || 0);
    if (step.sent === undefined) step.sent = WHEEL_PLAY.findIndex((t) => t >= (step.offset || 0));
    if (step.sent < 0) step.sent = WHEEL_PLAY.length;
    while (step.sent < WHEEL_PLAY.length && WHEEL_PLAY[step.sent] <= secs) {
      step.sent++;
      spin(1.4);
    }
  }
  const { from, to } = step;
  const st = { ...to };
  if (step.kind !== "cut") {
    if (step.kind === "walk" && from.s !== undefined && to.s !== undefined && layout.path.on) {
      const s = from.s + (to.s - from.s) * e;
      [st.x, st.y] = pathPoint(layout, s);
      st.yaw = pathHeading(layout, s);
    } else {
      st.x = from.x + (to.x - from.x) * e;
      st.y = from.y + (to.y - from.y) * e;
      st.yaw = lerpDeg(from.yaw, to.yaw, e);
    }
    st.pitch = from.pitch + (to.pitch - from.pitch) * e;
    st.eye = from.eye + (to.eye - from.eye) * e;
    st.fade = (from.fade || 0) + ((to.fade || 0) - (from.fade || 0)) * u;
  }
  applyState(st);
  if (u >= 1) {
    film.i++;
    film.t0 = now;
  }
}

function startFilm() {
  film = { steps: filmSteps(), i: 0, t0: performance.now() };
  title.classList.remove("stay");
  replay.hidden = true;
  pad.hidden = true;
  say("The walk. Any key or a touch takes over.");
}

/** The film ends: at its end the visitor is back inside the door, or where the hand took over. */
function endFilm(finished) {
  film = null;
  if (finished) {
    const steps = filmSteps();
    applyState({ ...steps[1].to, fade: 0 });
  }
  layout.view.from = "visitor";
  layout.visitor.along = -1;
  fade = 0;
  replay.hidden = false;
  pad.hidden = !touch;
  say(touch ? "Drag to look round; the pad walks. Tap the wheel button for a spin." : "W A S D or the arrows walk, Shift hurries, drag or click to look round. Space spins the wheel. h hides this.");
}

// ------------------------------------------------------------------ the hand

let hudTimer = 0;
function say(text) {
  hud.textContent = text;
  hud.hidden = false;
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => (hud.hidden = true), 7000);
}

function takeOver() {
  if (film) endFilm(false);
  title.classList.remove("stay");
}

const keys = new Set();
const padVec = [0, 0]; // ahead, left from the touch pad
window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "h") {
    hud.hidden = !hud.hidden;
    return;
  }
  if (key === "i") {
    title.classList.toggle("stay");
    return;
  }
  if (key === "p") {
    if (film) endFilm(false);
    else startFilm();
    return;
  }
  if (key === "Escape") return;
  if (SPIN_KEYS.has(e.key)) {
    takeOver();
    if (!e.repeat) spin(1);
    e.preventDefault();
    return;
  }
  if (!(key in WALK_KEYS) && key !== "Shift") return;
  takeOver();
  keys.add(key);
  e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys.delete(key);
});
window.addEventListener("blur", () => keys.clear());

function walkStep(dt) {
  let ahead = padVec[0];
  let left = padVec[1];
  for (const k of keys) if (k in WALK_KEYS) {
    ahead += WALK_KEYS[k][0];
    left += WALK_KEYS[k][1];
  }
  if (!ahead && !left) return;
  const v = layout.visitor;
  const a = (v.yaw * Math.PI) / 180;
  const speed = WALK_SPEED * (keys.has("Shift") ? 2 : 1) * dt;
  const dx = (Math.cos(a) * ahead - Math.sin(a) * left) * speed;
  const dy = (Math.sin(a) * ahead + Math.cos(a) * left) * speed;
  const [x, y] = walkTo(layout, [v.x, v.y], [v.x + dx, v.y + dy]);
  v.x = x;
  v.y = y;
  v.along = -1;
  layout.view.from = "visitor";
}

// Dragging the picture turns the head; a click without a drag takes the mouse for looking
// round (desktop), and Esc gives it back.
let turning = null;
view.addEventListener("pointerdown", (e) => {
  if (document.pointerLockElement === view) return;
  takeOver();
  const who = layout.view.from === "bench" && layout.bench.on ? layout.bench : layout.visitor;
  const yawKey = who === layout.bench ? "look" : "yaw";
  turning = { id: e.pointerId, x: e.clientX, y: e.clientY, who, yawKey, yaw: who[yawKey], pitch: who.pitch, moved: false };
  try {
    view.setPointerCapture(e.pointerId);
  } catch (_) {
    /* a scripted pointer */
  }
});
view.addEventListener("pointermove", (e) => {
  if (!turning || e.pointerId !== turning.id) return;
  const perPx = layout.view.fov / view.clientWidth;
  const dx = e.clientX - turning.x;
  const dy = e.clientY - turning.y;
  if (Math.hypot(dx, dy) > 4) turning.moved = true;
  turning.who[turning.yawKey] = turning.yaw + dx * perPx;
  turning.who.pitch = Math.min(60, Math.max(-60, turning.pitch + dy * perPx));
});
function stopTurning(e) {
  if (!turning || e.pointerId !== turning.id) return;
  const { moved } = turning;
  turning = null;
  if (view.hasPointerCapture(e.pointerId)) view.releasePointerCapture(e.pointerId);
  if (!moved && !touch && e.pointerType === "mouse" && view.requestPointerLock) view.requestPointerLock().catch?.(() => {});
}
view.addEventListener("pointerup", stopTurning);
view.addEventListener("pointercancel", stopTurning);
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== view) return;
  const who = layout.view.from === "bench" && layout.bench.on ? layout.bench : layout.visitor;
  const yawKey = who === layout.bench ? "look" : "yaw";
  who[yawKey] -= e.movementX * LOOK_PER_PX;
  who.pitch = Math.min(60, Math.max(-60, who.pitch - e.movementY * LOOK_PER_PX));
});

// The pad: a thumb on it walks the visitor in that direction.
let padTouch = null;
pad.addEventListener("pointerdown", (e) => {
  takeOver();
  padTouch = e.pointerId;
  try {
    pad.setPointerCapture(e.pointerId);
  } catch (_) {
    /* a scripted pointer */
  }
  padMove(e);
  e.preventDefault();
});
function padMove(e) {
  if (padTouch !== e.pointerId) return;
  const r = pad.getBoundingClientRect();
  const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const len = Math.hypot(dx, dy);
  const k = len > 1 ? 1 / len : 1;
  padVec[0] = -dy * k * 1.2;
  padVec[1] = -dx * k * 1.2;
  pad.style.setProperty("--kx", `${dx * k * 30}px`);
  pad.style.setProperty("--ky", `${dy * k * 30}px`);
}
pad.addEventListener("pointermove", padMove);
function padUp(e) {
  if (padTouch !== e.pointerId) return;
  padTouch = null;
  padVec[0] = 0;
  padVec[1] = 0;
  pad.style.setProperty("--kx", "0px");
  pad.style.setProperty("--ky", "0px");
}
pad.addEventListener("pointerup", padUp);
pad.addEventListener("pointercancel", padUp);
$("spin").addEventListener("click", () => {
  takeOver();
  spin(1);
});
replay.addEventListener("click", () => startFilm());
$("mark-button").addEventListener("click", () => title.classList.toggle("stay"));

// ------------------------------------------------------------------ the loop

let last = 0;
let flameEvery = 1; // draw the fractal every frame, or every other at the lowest level
let frames = 0;
let paceAt = 0; // the start of the stretch of frames being timed
let paceFrames = 0;
let slowStretches = 0; // stretches in a row that came slow; the first stretch is warm-up
let stretches = 0;
function pace(now) {
  paceFrames++;
  if (!paceAt) paceAt = now;
  if (now - paceAt < 4000) return;
  const fps = (paceFrames * 1000) / (now - paceAt);
  paceAt = now;
  paceFrames = 0;
  stretches++;
  slowStretches = fps < SLOW_FPS && stretches > 1 ? slowStretches + 1 : 0;
  if (slowStretches >= 2 && qualityLevel < QUALITY.length - 1) {
    qualityLevel++;
    slowStretches = 0;
    fit();
    flameEvery = qualityLevel === QUALITY.length - 1 ? 2 : 1;
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (!layout || document.hidden) {
    last = now;
    paceAt = 0;
    paceFrames = 0;
    return;
  }
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  frames++;
  pace(now);
  if (frames % flameEvery === 0) {
    drawFlame(dt * flameEvery);
    if (frames % 10 === 0) still = frames > 10 ? easeStill(still, measureStill(flameCanvas)) : measureStill(flameCanvas);
    tracer.setStill(flameCanvas, 1);
    tracer.setSpotStill(flameCanvas, 1);
  }
  driftLooks(now);
  if (film) filmStep(now);
  else walkStep(dt);
  draw(now);
}

// ------------------------------------------------------------------ boot

if (tracer) {
  fit();
  window.addEventListener("resize", fit);
  const shapesReady = fetch("img/rocks/shapes.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((shapes) => {
      rockShapes = shapes || {};
    })
    .catch(() => {});
  const rocksReady = Promise.all([
    shapesReady,
    ...Array.from({ length: ROCKS }, (_, i) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = rockFile(i);
      });
    }),
  ]).then(([, ...imgs]) => tracer.setRocks(imgs, rockShapes));
  const toyPhoto = new Image();
  toyPhoto.onload = () => tracer.setToy(toyPhoto);
  toyPhoto.src = "img/toy.png";
  const roomReady = fetch(ROOM_FILE)
    .then((r) => {
      if (!r.ok) throw new Error(`${ROOM_FILE}: ${r.status}`);
      return r.json();
    })
    .then((raw) => normalizeLayout(raw));
  Promise.all([roomReady, rocksReady])
    .then(([room]) => {
      layout = room;
      layout.visitor.along = -1;
      layout.view.from = "visitor";
      startFilm();
      requestAnimationFrame((t) => {
        last = t;
        requestAnimationFrame(frame);
      });
    })
    .catch((err) => {
      fail(`The room could not be loaded (${err.message}).`);
    });
}

// For checking the page from the browser console and in tests.
window.walkthrough = {
  get layout() {
    return layout;
  },
  get film() {
    return film;
  },
  get quality() {
    return quality;
  },
  spin,
  startFilm,
  endFilm,
};
