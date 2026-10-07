/**
 * Fractal genomes: random generation, interpolation, mutation, animation.
 *
 * A genome is one fractal design in the Chaotica / flam3 sense: up to
 * MAX_XFORMS transforms, each an affine map plus a weighted mix of the
 * variations listed in VARIATIONS (the order matters, it matches the
 * shader), plus a 256-entry palette, a background color and a camera.
 *
 * Every genome is padded to MAX_XFORMS so two genomes can always be
 * interpolated field by field. That is what makes continuous morphing
 * possible: the show is always somewhere between design A and design B.
 */

import { clamp, lerp } from "./rng.js";
import { CURATED, hexToRgb, rgbToHsl, pickWeighted } from "./palettes.js";

export const MAX_XFORMS = 6;
export const NVAR = 40;
export const NPRM = 24;
export const PALETTE_SIZE = 256;

export const VARIATIONS = [
  "linear", "sinusoidal", "spherical", "swirl", "horseshoe", "polar",
  "handkerchief", "heart", "disc", "spiral", "hyperbolic", "diamond", "ex",
  "julia", "bent", "waves", "fisheye", "eyefish", "bubble", "cylinder",
  "blur", "gaussian", "curl", "tangent", "arch", "blade", "rays", "secant",
  "cross", "pdj", "julian", "popcorn",
  "moebius", "rings2", "fan2", "ngon", "rectangles", "splits", "log", "unused",
];

// Parameter slots per transform (prm[NPRM]):
//   0-3 waves / pdj      4-5 curl        6-7 julian power, dist
//   8-11 moebius b, c    12 rings2 val   13-14 fan2 x, y
//   15-18 ngon sides, power, circle, corners
//   19-20 rectangles x, y   21-22 splits x, y   23 spare

// Families the master panel can switch on and off.
export const FAMILIES = {
  smooth: [
    "sinusoidal", "spherical", "swirl", "horseshoe", "polar", "handkerchief",
    "heart", "disc", "spiral", "hyperbolic", "diamond", "ex", "julia", "bent",
    "waves", "fisheye", "eyefish", "bubble", "cylinder", "curl", "tangent",
    "pdj", "julian", "popcorn", "moebius", "rings2", "fan2", "log",
  ],
  blur: ["blur", "gaussian"],
  spiky: ["arch", "blade", "rays", "secant", "cross"],
  geometric: ["ngon", "rectangles", "splits"],
};

const VI = Object.fromEntries(VARIATIONS.map((n, i) => [n, i]));

// ------------------------------------------------------------ helpers

function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function emptyXform() {
  return {
    weight: 0,
    color: 0.5,
    colorSpeed: 0.5,
    aff: [1, 0, 0, 0, 1, 0],
    post: [1, 0, 0, 0, 1, 0],
    vars: new Float32Array(NVAR),
    prm: new Float32Array(NPRM),
    animRate: 0.1,
    animPhase: 0,
    animAmp: 1,
  };
}

function paletteFromKeys(keys, offset = 0) {
  const nKeys = keys.length;
  const pal = new Float32Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const u = (((i / PALETTE_SIZE + offset) % 1) + 1) % 1 * nKeys;
    const k = Math.floor(u);
    const f = u - k;
    const t = f * f * (3 - 2 * f);
    const a = keys[k % nKeys];
    const b = keys[(k + 1) % nKeys];
    pal[i * 3] = lerp(a[0], b[0], t);
    pal[i * 3 + 1] = lerp(a[1], b[1], t);
    pal[i * 3 + 2] = lerp(a[2], b[2], t);
  }
  return pal;
}

let likedPalettes = [];
let likedOnly = false;

/** Palettes voted for in palettes.html; used alongside or instead of CURATED. */
export function setLikedPalettes(list, only) {
  likedPalettes = (list || []).filter((p) => Array.isArray(p.colors) && p.colors.length >= 2);
  likedOnly = !!only && likedPalettes.length > 0;
}

function curatedKeys(rng) {
  const pool = likedOnly ? likedPalettes : likedPalettes.length ? CURATED.concat(likedPalettes) : CURATED;
  const p = pickWeighted(rng, pool);
  const keys = p.colors.map(hexToRgb);
  // Random rotation of the key order keeps the same combo from always
  // starting on the same color.
  const start = rng.int(0, keys.length - 1);
  return { name: p.name, keys: keys.slice(start).concat(keys.slice(0, start)) };
}

function makePalette(rng, twoHueOdds = 0.4, curatedOdds = 0.75) {
  // Curated combos most of the time; otherwise either two hues far
  // apart or 3-5 keys clustered around one base hue.
  if (rng.next() < curatedOdds) {
    const { name, keys } = curatedKeys(rng);
    return { palette: paletteFromKeys(keys, rng.next()), keys, name };
  }
  const keys = [];
  let nKeys;
  if (rng.next() < twoHueOdds) {
    nKeys = 4;
    const a = rng.next();
    const b = a + rng.range(0.3, 0.6);
    keys.push(hsl(a, rng.range(0.7, 1), rng.range(0.4, 0.7)));
    keys.push(hsl(a + rng.range(-0.05, 0.05), rng.range(0.6, 1), rng.range(0.25, 0.5)));
    keys.push(hsl(b, rng.range(0.7, 1), rng.range(0.45, 0.75)));
    keys.push(hsl(b + rng.range(-0.05, 0.05), rng.range(0.5, 0.9), rng.range(0.3, 0.6)));
  } else {
    nKeys = rng.int(3, 5);
    const base = rng.next();
    const width = rng.range(0.08, 0.45);
    for (let i = 0; i < nKeys; i++) {
      const h = base + rng.range(-width, width) + (rng.next() < 0.2 ? 0.5 : 0);
      keys.push(hsl(h, rng.range(0.5, 1), rng.range(0.35, 0.8)));
    }
  }
  return { palette: paletteFromKeys(keys, 0), keys, name: "random" };
}

/**
 * Background gradient colors derived from the palette keys so they
 * relate to the design instead of fighting it. Colored backgrounds sit
 * at mid lightness, dark ones are tinted near-black.
 */
// Background hues to stay out of, as 24 bins around the wheel (set from
// the master panel). Default: yellow through green.
let blockedBins = [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function binOf(h) {
  return Math.floor((((h % 1) + 1) % 1) * 24) % 24;
}

function inAvoid(h) {
  return !!blockedBins[binOf(h)];
}

/**
 * A contrasting background hue for a palette: prefer the opposite hue,
 * fall back to the triadic ones, and never land in an avoided band.
 */
function contrastHue(rng, meanH, avoid) {
  const cands = [meanH + 0.5, meanH + 0.33, meanH - 0.33, meanH + 0.42, meanH - 0.42];
  for (const c of cands) {
    const h = c + rng.range(-0.06, 0.06);
    if (!avoid || !inAvoid(h)) return h;
  }
  // Everything nearby is off limits: take any allowed bin.
  const allowed = [];
  blockedBins.forEach((v, i) => { if (!v) allowed.push((i + 0.5) / 24); });
  return allowed.length ? rng.pick(allowed) : meanH + 0.5;
}

let avoidMuddyBg = true;
export function setBackgroundRules({ avoid, blocked }) {
  avoidMuddyBg = !!avoid;
  if (Array.isArray(blocked) && blocked.length === 24 && blocked.some((b) => !b)) {
    blockedBins = blocked.map((b) => (b ? 1 : 0));
  }
}

/** Move a blocked hue to the center of the nearest allowed bin. */
function safeHue(h) {
  if (!avoidMuddyBg) return h;
  const b = binOf(h);
  if (!blockedBins[b]) return h;
  for (let d = 1; d < 24; d++) {
    for (const cand of [b + d, b - d]) {
      const k = ((cand % 24) + 24) % 24;
      if (!blockedBins[k]) return (k + 0.5) / 24;
    }
  }
  return h;
}

function backgroundPair(rng, keys, colored) {
  // Mean hue of the palette (circular), so the background can sit
  // opposite it and the fractal pops instead of sinking in.
  let sx = 0;
  let sy = 0;
  let meanL = 0;
  for (const k of keys) {
    const [h, , l] = rgbToHsl(k);
    sx += Math.cos(h * Math.PI * 2);
    sy += Math.sin(h * Math.PI * 2);
    meanL += l / keys.length;
  }
  const meanH = (Math.atan2(sy, sx) / (Math.PI * 2) + 1) % 1;
  const opposite = contrastHue(rng, meanH, avoidMuddyBg);
  let near = meanH + rng.range(-0.06, 0.06);
  if (avoidMuddyBg && inAvoid(near)) near = opposite + rng.range(0.08, 0.14);
  if (colored && meanL > 0.42) {
    // Bright palette on a colored ground: use the opposite hue, mid-dark.
    return [
      hsl(safeHue(opposite), rng.range(0.35, 0.7), rng.range(0.22, 0.34)),
      hsl(safeHue(opposite + rng.range(0.05, 0.12)), rng.range(0.35, 0.7), rng.range(0.26, 0.4)),
    ];
  }
  if (colored) {
    return [
      hsl(safeHue(near), rng.range(0.3, 0.6), rng.range(0.3, 0.42)),
      hsl(safeHue(opposite), rng.range(0.3, 0.6), rng.range(0.28, 0.4)),
    ];
  }
  // Dark backgrounds: deep, tinted toward the opposite hue, never black.
  return [
    hsl(safeHue(opposite), rng.range(0.3, 0.6), rng.range(0.04, 0.09)),
    hsl(safeHue(near), rng.range(0.3, 0.6), rng.range(0.06, 0.13)),
  ];
}

function randomAffine(rng, spread, streaky) {
  // Streaky: axis-aligned and strongly stretched, for the rectilinear
  // line fields. Otherwise a free rotation with mild anisotropy.
  const ang = streaky
    ? (Math.PI / 2) * rng.int(0, 3) + rng.range(-0.03, 0.03)
    : rng.range(0, Math.PI * 2);
  const sx = (streaky ? rng.range(0.7, 1.15) : rng.range(0.35, 1.05)) * (rng.next() < 0.15 ? -1 : 1);
  const sy = streaky ? rng.range(0.05, 0.3) : rng.range(0.35, 1.05);
  const shear = streaky ? 0 : rng.range(-0.25, 0.25);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [
    c * sx, -s * sy + shear, rng.range(-spread, spread),
    s * sx, c * sy, rng.range(-spread, spread),
  ];
}

function enabledVariations(settings, { mains = false } = {}) {
  const out = [];
  if (settings.famSmooth) out.push(...FAMILIES.smooth);
  if (settings.famBlur && !mains) out.push(...FAMILIES.blur);
  if (settings.famSpiky) out.push(...FAMILIES.spiky);
  if (settings.famGeometric) out.push(...FAMILIES.geometric);
  return out.length ? out : FAMILIES.smooth;
}

/**
 * Re-derive a genome's background from its palette under the current
 * rules (used when the blocked-hue set changes mid-design).
 */
export function rederiveBackground(rng, g) {
  const keys = [];
  for (let i = 0; i < 5; i++) {
    const k = Math.floor((i / 5) * PALETTE_SIZE) * 3;
    keys.push([g.palette[k], g.palette[k + 1], g.palette[k + 2]]);
  }
  const lum = (g.bg[0] + g.bg[1] + g.bg[2]) / 3;
  const [bg, bg2] = backgroundPair(rng, keys, lum > 0.18);
  g.bg = bg;
  g.bg2 = bg2;
}

/** A fresh palette and matching background pair (for palette swaps). */
export function randomPaletteSet(rng, settings) {
  const colored = rng.next() < (settings.bgColored ?? 0.5);
  const pal = makePalette(rng, settings.twoHueOdds ?? 0.4, settings.curatedOdds ?? 0.75);
  const [bg, bg2] = backgroundPair(rng, pal.keys, colored);
  return { palette: pal.palette, paletteName: pal.name, bg, bg2 };
}

// ------------------------------------------------------------- genome

/**
 * Design archetypes. Each has its own pool of lead variations and layout
 * rules, so the generator produces distinct species of design instead of
 * one average look. Weights are relative pick odds.
 */
const ARCHETYPES = [
  { name: "wisps", weight: 1, nx: [2, 3], linearOdds: 0.6,
    mains: ["spherical", "julia", "swirl", "horseshoe", "polar", "spiral", "hyperbolic", "ex", "curl", "handkerchief"] },
  { name: "bubbles", weight: 1, nx: [2, 4], linearOdds: 0.3,
    mains: ["bubble", "eyefish", "fisheye", "spherical", "disc", "julian", "rings2"] },
  { name: "streaks", weight: 0.9, nx: [2, 4], linearOdds: 0.7, streaky: true,
    mains: ["linear", "blade", "rays", "arch", "secant", "cross", "splits"] },
  { name: "tiles", weight: 0.7, nx: [2, 3], linearOdds: 0.5,
    mains: ["ngon", "rectangles", "splits", "rings2", "fan2", "cylinder"] },
  { name: "mandala", weight: 0.8, nx: [2, 3], linearOdds: 0.4, symmetry: [3, 6],
    mains: ["spherical", "julia", "swirl", "disc", "heart", "diamond", "bubble", "julian", "sinusoidal"] },
  { name: "storm", weight: 0.8, nx: [4, 6], linearOdds: 0.4, blurOdds: 0.5,
    mains: ["sinusoidal", "swirl", "curl", "pdj", "waves", "popcorn", "tangent", "bent", "rays", "blade"] },
  { name: "bold", weight: 0.7, nx: [2, 4], linearOdds: 0.3, dominant: true, postOdds: 0.8,
    mains: ["spherical", "julia", "ngon", "bubble", "ex", "polar", "log", "moebius", "fan2"] },
  { name: "warp", weight: 0.6, nx: [2, 3], linearOdds: 0.5, postOdds: 0.6,
    mains: ["moebius", "log", "julian", "pdj", "waves", "exponential", "cosine"] },
];

function pickArchetype(rng) {
  let total = 0;
  for (const a of ARCHETYPES) total += a.weight;
  let r = rng.next() * total;
  for (const a of ARCHETYPES) {
    r -= a.weight;
    if (r <= 0) return a;
  }
  return ARCHETYPES[0];
}

export function randomGenome(rng, settings) {
  const pool = enabledVariations(settings);
  const arch = pickArchetype(rng);
  // Lead variations: the archetype's list filtered by what the panel allows.
  let mains = arch.mains.filter((n) => pool.includes(n) || n === "linear");
  if (!mains.length) mains = enabledVariations(settings, { mains: true });
  const symK = arch.symmetry ? rng.int(arch.symmetry[0], arch.symmetry[1]) : 0;
  const symCount = symK ? Math.min(symK - 1, 3) : 0;
  const minX = clamp(Math.round(settings.xformsMin ?? 2), 2, MAX_XFORMS);
  const maxX = clamp(Math.round(settings.xformsMax ?? 5), minX, MAX_XFORMS);
  const lo = clamp(Math.max(minX, arch.nx[0]), 2, MAX_XFORMS - symCount);
  const hi = clamp(Math.min(maxX, arch.nx[1]), lo, MAX_XFORMS - symCount);
  const nx = rng.int(lo, hi);
  const vMin = clamp(Math.round(settings.varsMin ?? 1), 1, 4);
  const vMax = clamp(Math.round(settings.varsMax ?? 3), vMin, 4);
  const streakyDesign = arch.streaky || rng.next() < (settings.streakOdds ?? 0.2) * 0.5;
  const dominantIdx = arch.dominant ? rng.int(0, nx - 1) : -1;
  const xforms = [];
  for (let i = 0; i < MAX_XFORMS; i++) {
    const x = emptyXform();
    if (i < nx) {
      x.weight = dominantIdx < 0 ? rng.range(0.25, 1) : i === dominantIdx ? 1 : rng.range(0.05, 0.3);
      x.color = ((i / nx + rng.range(0, 0.6 / nx)) % 1 + 1) % 1;
      x.colorSpeed = rng.range(0.45, 0.9);
      x.aff = randomAffine(rng, rng.range(0.6, 1.6), streakyDesign && rng.next() < 0.7);
      if (rng.next() < (arch.postOdds ?? 0.15)) x.post = randomAffine(rng, 0.3, false);
      const nv = rng.int(vMin, vMax);
      for (let k = 0; k < nv; k++) {
        const name = k === 0 ? rng.pick(mains) : rng.pick(pool);
        const isBlur = FAMILIES.blur.includes(name);
        const w = k === 0 ? rng.range(0.4, 1.5) : isBlur ? rng.range(0.03, 0.15) : rng.range(0.1, 0.7);
        x.vars[VI[name]] += w;
      }
      if (arch.blurOdds && rng.next() < arch.blurOdds) x.vars[VI.gaussian] += rng.range(0.02, 0.08);
      if (rng.next() < arch.linearOdds) x.vars[VI.linear] += rng.range(0.2, 0.9);
      // Parameters used by waves/pdj (0-3), curl (4-5), julian (6-7).
      x.prm[0] = rng.range(-2.5, 2.5);
      x.prm[1] = rng.range(-2.5, 2.5);
      x.prm[2] = rng.range(-2.5, 2.5);
      x.prm[3] = rng.range(-2.5, 2.5);
      x.prm[4] = rng.range(-1, 1);
      x.prm[5] = rng.range(-1, 1);
      x.prm[6] = rng.int(2, 6) * rng.sign();
      x.prm[7] = rng.range(0.7, 1.3);
      x.prm[8] = rng.range(-0.6, 0.6);
      x.prm[9] = rng.range(-0.6, 0.6);
      x.prm[10] = rng.range(-0.6, 0.6);
      x.prm[11] = rng.range(-0.6, 0.6);
      x.prm[12] = rng.range(0.2, 1.0);
      x.prm[13] = rng.range(0.3, 1.5);
      x.prm[14] = rng.range(-1, 1);
      x.prm[15] = rng.int(3, 8);
      x.prm[16] = rng.range(1, 3);
      x.prm[17] = rng.range(0.5, 1.5);
      x.prm[18] = rng.range(0.5, 2);
      x.prm[19] = rng.range(0.1, 0.8);
      x.prm[20] = rng.range(0.1, 0.8);
      x.prm[21] = rng.range(-0.5, 0.5);
      x.prm[22] = rng.range(-0.5, 0.5);
      x.animRate = rng.range(0.03, 0.15);
      x.animPhase = rng.range(0, Math.PI * 2);
      x.animAmp = rng.range(0.4, 1.2);
    } else if (symCount && i < nx + symCount) {
      // Rotational symmetry: pure rotations by 2pi/k that don't shift color.
      const j = i - nx + 1;
      const ang = (Math.PI * 2 * j) / symK;
      let total = 0;
      for (let q = 0; q < nx; q++) total += xforms[q].weight;
      x.weight = total / symCount;
      x.color = 0.5;
      x.colorSpeed = 0;
      x.aff = [Math.cos(ang), -Math.sin(ang), 0, Math.sin(ang), Math.cos(ang), 0];
      x.vars[VI.linear] = 1;
      x.animRate = 0.02;
      x.animAmp = 0.15;
    }
    xforms.push(x);
  }
  const colored = rng.next() < (settings.bgColored ?? 0.5);
  const pal = makePalette(rng, settings.twoHueOdds ?? 0.4, settings.curatedOdds ?? 0.75);
  const [bg, bg2] = backgroundPair(rng, pal.keys, colored);
  return {
    xforms,
    archetype: arch.name + (symK ? ` ${symK}x` : ""),
    palette: pal.palette,
    paletteName: pal.name,
    bg,
    bg2,
    bgAngle: rng.range(0, Math.PI * 2),
    camera: {
      cx: rng.range(-0.3, 0.3),
      cy: rng.range(-0.3, 0.3),
      scale: rng.range(settings.scaleMin ?? 0.35, Math.max(settings.scaleMin ?? 0.35, settings.scaleMax ?? 0.6)),
      rot: rng.range(0, Math.PI * 2),
    },
  };
}

/** Plain-JSON form of a genome (typed arrays become arrays). */
export function genomeToJSON(g) {
  return {
    xforms: g.xforms.map((x) => ({
      ...x,
      aff: [...x.aff],
      post: [...x.post],
      vars: [...x.vars],
      prm: [...x.prm],
    })),
    palette: [...g.palette],
    paletteName: g.paletteName,
    archetype: g.archetype,
    bg: [...g.bg],
    bg2: [...g.bg2],
    bgAngle: g.bgAngle,
    camera: { ...g.camera },
  };
}

/** Rebuild a genome from JSON; returns null if it doesn't look right. */
export function genomeFromJSON(j) {
  try {
    if (!j || !Array.isArray(j.xforms) || !Array.isArray(j.palette)) return null;
    const xforms = [];
    for (let i = 0; i < MAX_XFORMS; i++) {
      const x = emptyXform();
      const src = j.xforms[i];
      if (src) {
        x.weight = +src.weight || 0;
        x.color = +src.color || 0;
        x.colorSpeed = src.colorSpeed === 0 ? 0 : +src.colorSpeed || 0.5;
        x.aff = (src.aff || x.aff).slice(0, 6).map(Number);
        x.post = (src.post || x.post).slice(0, 6).map(Number);
        x.vars.set((src.vars || []).slice(0, NVAR).map(Number));
        x.prm.set((src.prm || []).slice(0, NPRM).map(Number));
        x.animRate = +src.animRate || 0.1;
        x.animPhase = +src.animPhase || 0;
        x.animAmp = +src.animAmp || 1;
      }
      xforms.push(x);
    }
    const palette = new Float32Array(PALETTE_SIZE * 3);
    palette.set(j.palette.slice(0, PALETTE_SIZE * 3).map(Number));
    return {
      xforms,
      palette,
      paletteName: j.paletteName || "favorite",
      archetype: j.archetype || "favorite",
      bg: (j.bg || [0.05, 0.05, 0.08]).map(Number),
      bg2: (j.bg2 || j.bg || [0.05, 0.05, 0.08]).map(Number),
      bgAngle: +j.bgAngle || 0,
      camera: {
        cx: +(j.camera && j.camera.cx) || 0,
        cy: +(j.camera && j.camera.cy) || 0,
        scale: +(j.camera && j.camera.scale) || 0.5,
        rot: +(j.camera && j.camera.rot) || 0,
      },
    };
  } catch (_) {
    return null;
  }
}

export function cloneGenome(g) {
  return {
    xforms: g.xforms.map((x) => ({
      ...x,
      aff: [...x.aff],
      post: [...x.post],
      vars: new Float32Array(x.vars),
      prm: new Float32Array(x.prm),
    })),
    palette: new Float32Array(g.palette),
    paletteName: g.paletteName,
    archetype: g.archetype,
    bg: [...g.bg],
    bg2: [...(g.bg2 || g.bg)],
    bgAngle: g.bgAngle || 0,
    camera: { ...g.camera },
  };
}

/** out = a*(1-t) + b*t, written into out (reuse to avoid garbage). */
export function lerpGenome(a, b, t, out) {
  for (let i = 0; i < MAX_XFORMS; i++) {
    const xa = a.xforms[i];
    const xb = b.xforms[i];
    const xo = out.xforms[i];
    xo.weight = lerp(xa.weight, xb.weight, t);
    xo.color = lerp(xa.color, xb.color, t);
    xo.colorSpeed = lerp(xa.colorSpeed, xb.colorSpeed, t);
    for (let k = 0; k < 6; k++) {
      xo.aff[k] = lerp(xa.aff[k], xb.aff[k], t);
      xo.post[k] = lerp(xa.post[k], xb.post[k], t);
    }
    for (let k = 0; k < NVAR; k++) xo.vars[k] = lerp(xa.vars[k], xb.vars[k], t);
    for (let k = 0; k < NPRM; k++) xo.prm[k] = lerp(xa.prm[k], xb.prm[k], t);
    xo.animRate = lerp(xa.animRate, xb.animRate, t);
    xo.animPhase = t < 0.5 ? xa.animPhase : xb.animPhase;
    xo.animAmp = lerp(xa.animAmp, xb.animAmp, t);
  }
  for (let i = 0; i < PALETTE_SIZE * 3; i++) {
    out.palette[i] = lerp(a.palette[i], b.palette[i], t);
  }
  for (let i = 0; i < 3; i++) {
    out.bg[i] = lerp(a.bg[i], b.bg[i], t);
    out.bg2[i] = lerp(a.bg2[i], b.bg2[i], t);
  }
  out.bgAngle = lerp(a.bgAngle, b.bgAngle, t);
  out.paletteName = t < 0.5 ? a.paletteName : b.paletteName;
  out.archetype = t < 0.5 ? a.archetype : b.archetype;
  out.camera.cx = lerp(a.camera.cx, b.camera.cx, t);
  out.camera.cy = lerp(a.camera.cy, b.camera.cy, t);
  out.camera.scale = lerp(a.camera.scale, b.camera.scale, t);
  out.camera.rot = lerp(a.camera.rot, b.camera.rot, t);
  return out;
}

/**
 * Keep a transform inside the range the generator itself produces, so
 * repeated mutations can't send points to infinity or collapse them.
 */
function boundXform(x) {
  const [a, b, c, d, e, f] = x.aff;
  const norm = Math.max(Math.abs(a) + Math.abs(b), Math.abs(d) + Math.abs(e));
  const k = norm > 1.25 ? 1.25 / norm : norm < 0.2 ? 0.2 / Math.max(norm, 1e-6) : 1;
  x.aff = [a * k, b * k, clamp(c, -1.8, 1.8), d * k, e * k, clamp(f, -1.8, 1.8)];
  let total = 0;
  for (let i = 0; i < NVAR; i++) {
    x.vars[i] = clamp(x.vars[i], 0, 2);
    total += x.vars[i];
  }
  if (total < 0.3) x.vars[0] += 0.3 - total; // fall back toward linear
  if (total > 3) for (let i = 0; i < NVAR; i++) x.vars[i] *= 3 / total;
}

/** Nudge a genome in place. amount 0..1. */
export function mutateGenome(rng, g, amount, settings) {
  const pool = enabledVariations(settings);
  for (const x of g.xforms) {
    if (x.weight <= 0 || x.colorSpeed === 0) continue;
    const ang = rng.range(-0.6, 0.6) * amount;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const [a, b, cc, d, e, f] = x.aff;
    x.aff = [
      c * a - s * d, c * b - s * e, cc + rng.range(-0.3, 0.3) * amount,
      s * a + c * d, s * b + c * e, f + rng.range(-0.3, 0.3) * amount,
    ];
    x.weight = clamp(x.weight + rng.range(-0.3, 0.3) * amount, 0.1, 1.2);
    x.color = ((x.color + rng.range(-0.2, 0.2) * amount) % 1 + 1) % 1;
    for (let k = 0; k < NVAR; k++) {
      if (x.vars[k] > 0) x.vars[k] = Math.max(0, x.vars[k] + rng.range(-0.3, 0.3) * amount);
    }
    if (rng.next() < 0.25 * amount) {
      x.vars[VI[rng.pick(pool)]] += rng.range(0.2, 0.7);
    }
    boundXform(x);
    for (let k = 0; k < 6; k++) x.prm[k] += rng.range(-0.4, 0.4) * amount;
    for (let k = 8; k < 15; k++) x.prm[k] += rng.range(-0.2, 0.2) * amount;
    for (let k = 19; k < 23; k++) x.prm[k] += rng.range(-0.1, 0.1) * amount;
  }
  g.camera.rot += rng.range(-0.5, 0.5) * amount;
  g.camera.scale = clamp(g.camera.scale * (1 + rng.range(-0.25, 0.25) * amount), 0.2, 1.2);
  return g;
}

/** Sum of active weights, and cumulative bounds for the shader. */
export function cumulativeWeights(g, out) {
  let total = 0;
  for (const x of g.xforms) total += Math.max(0, x.weight);
  let acc = 0;
  for (let i = 0; i < MAX_XFORMS; i++) {
    acc += Math.max(0, g.xforms[i].weight);
    out[i] = total > 0 ? acc / total : 1;
  }
  return total;
}

// ----------------------------------------------------------- animator

/**
 * Owns the current design (A), the design being morphed toward (B), the
 * morph clock and the per-transform "breathing". current() is what the
 * renderer draws each frame.
 */
export class FlameAnimator {
  constructor(rng, settings) {
    this.rng = rng;
    this.settings = settings;
    this.a = randomGenome(rng, settings);
    this.b = randomGenome(rng, settings);
    this.cur = cloneGenome(this.a);
    this.out = cloneGenome(this.a); // with wobble applied
    this.s = 0; // morph progress 0..1
    this.phase = "morph";
    this.hold = 0;
    this.morphSpeedMul = 1;
    this.generation = 0;
    this.t = 0;
    this.cw = new Float32Array(MAX_XFORMS);
    this.paletteShift = 0;
    this.morphSecs = this.pickMorphSecs();
    this.holdSecs = this.pickHoldSecs();
    this.kickBudget = 0; // recent mutation, decays; caps how far mashing can push
    this.favorites = []; // genomes saved as favorites; see nextTarget()
  }

  /** Where to go next: usually random, sometimes a saved favorite. */
  nextTarget() {
    const odds = this.settings.favoriteOdds ?? 0.2;
    if (this.favorites.length && this.rng.next() < odds) {
      const g = cloneGenome(this.rng.pick(this.favorites));
      g.archetype = `fav ${g.archetype || ""}`.trim();
      return g;
    }
    return randomGenome(this.rng, this.settings);
  }

  pickMorphSecs() {
    const S = this.settings;
    const lo = Math.max(2, S.morphMin ?? 60);
    return this.rng.range(lo, Math.max(lo, S.morphMax ?? 150));
  }

  pickHoldSecs() {
    const S = this.settings;
    const lo = Math.max(0, S.holdMin ?? 20);
    return this.rng.range(lo, Math.max(lo, S.holdMax ?? 90));
  }

  /** Morph toward a specific genome (a world picked from the contact sheet). */
  aimAt(genome, fast = false, speedMul = null) {
    this.a = cloneGenome(this.cur);
    this.b = genome;
    this.s = 0;
    this.phase = "morph";
    this.morphSpeedMul = speedMul ?? (fast ? 4 : 1);
    this.morphSecs = this.pickMorphSecs();
    this.generation++;
  }

  /** Warp speed: a new design, arriving in a few seconds. */
  warp(newPalette = false) {
    const g = randomGenome(this.rng, this.settings);
    if (!newPalette) {
      // Keep the current colors so the warp reads as travel, not a reset.
      g.palette = new Float32Array(this.cur.palette);
      g.paletteName = this.cur.paletteName;
      g.bg = [...this.cur.bg];
      g.bg2 = [...this.cur.bg2];
    }
    this.aimAt(g, true, 12);
  }

  /** Backgrounds of the live designs, re-picked under the current rules. */
  refreshBackgrounds() {
    for (const g of [this.a, this.b]) rederiveBackground(this.rng, g);
  }

  /** Swap to a fresh palette (and matching background) on the spot. */
  swapPalette() {
    const p = randomPaletteSet(this.rng, this.settings);
    for (const g of [this.a, this.b, this.cur]) {
      g.palette = new Float32Array(p.palette);
      g.paletteName = p.paletteName;
      g.bg = [...p.bg];
      g.bg2 = [...p.bg2];
    }
    this.paletteShift = this.rng.next();
  }

  /** Force a new target and a quick morph (toy spike, dead flame, panel). */
  newFlame(fast = false) {
    this.aimAt(this.nextTarget(), fast);
  }

  /** Kick from the toy: mutate the target so the morph changes course. */
  /**
   * Returns how much of the kick got through (0..1 of what was asked).
   * Near 0 means the limit was hit; main.js turns that into a bounce.
   */
  kick(amount) {
    // Each kick spends budget; a hammered toy bends the design less and
    // less instead of tearing it apart.
    const room = Math.max(0, 1 - this.kickBudget / 2.5);
    const asked = amount;
    amount *= room;
    this.kickBudget += Math.max(amount, asked * 0.15);
    if (amount < 0.02) return 0;
    // Abrupt: the mutation lands on where we are now (a) as well as where
    // we're heading (b), so the picture jumps instead of easing.
    if (this.phase === "hold") {
      this.a = cloneGenome(this.cur);
      this.s = 0;
      this.phase = "morph";
    } else {
      this.a = cloneGenome(this.cur);
      this.s = 0;
    }
    mutateGenome(this.rng, this.a, amount * 0.8, this.settings);
    mutateGenome(this.rng, this.b, amount, this.settings);
    // Flavor by the toy's brightness: dark presses shove the palette,
    // bright presses spin it the other way.
    const c = this.centroid ?? 0.5;
    this.paletteShift += (c < 0.4 ? -0.18 : c > 0.7 ? 0.18 : this.rng.range(-0.08, 0.08)) * amount;
    return room;
  }

  update(dt, energy, centroid = 0.5) {
    const S = this.settings;
    this.t += dt;
    this.centroid = centroid;
    this.kickBudget = Math.max(0, this.kickBudget - dt * 0.25);
    const boost = 1 + energy * (S.toyMorphBoost ?? 4);
    if (this.phase === "morph") {
      const secs = this.morphSecs / this.morphSpeedMul;
      this.s += (dt / secs) * boost;
      if (this.s >= 1) {
        this.s = 1;
        this.a = cloneGenome(this.b);
        this.phase = "hold";
        this.hold = 0;
        this.morphSpeedMul = 1;
        this.holdSecs = this.pickHoldSecs();
      }
    } else {
      this.hold += dt * boost;
      if (this.hold >= this.holdSecs) {
        this.b = this.nextTarget();
        this.s = 0;
        this.phase = "morph";
        this.morphSecs = this.pickMorphSecs();
        this.generation++;
      }
    }
    const e = this.s * this.s * (3 - 2 * this.s);
    lerpGenome(this.a, this.b, e, this.cur);
    this.applyWobble(energy);
    return this.out;
  }

  /** Slow breathing of every transform, stronger when the toy is active. */
  applyWobble(energy) {
    const S = this.settings;
    const amp = (S.wobble ?? 0.6) * (0.12 + energy * 0.9);
    // Toy shimmer: a fast shared rotation of every transform while the
    // toy is active, so the whole design visibly reacts.
    const shimmer = energy * 0.35 * Math.sin(this.t * 4.0);
    const g = this.cur;
    const o = this.out;
    for (let i = 0; i < MAX_XFORMS; i++) {
      const x = g.xforms[i];
      const y = o.xforms[i];
      y.weight = x.weight;
      y.color = x.color;
      y.colorSpeed = x.colorSpeed;
      y.vars.set(x.vars);
      y.prm.set(x.prm);
      for (let k = 0; k < 6; k++) y.post[k] = x.post[k];
      const ph = this.t * x.animRate * (1 + energy * 3) + x.animPhase;
      const ang = amp * x.animAmp * Math.sin(ph) + (x.colorSpeed === 0 ? 0 : shimmer);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const [a, b, cc, d, e, f] = x.aff;
      y.aff[0] = c * a - s * d;
      y.aff[1] = c * b - s * e;
      y.aff[2] = cc + 0.15 * amp * Math.sin(ph * 0.7 + 1.3);
      y.aff[3] = s * a + c * d;
      y.aff[4] = s * b + c * e;
      y.aff[5] = f + 0.15 * amp * Math.cos(ph * 0.6 + 0.4);
    }
    // Palette rotates slowly; the toy pushes it, and the toy's brightness
    // (centroid) steers which way.
    const dir = (this.centroid ?? 0.5) - 0.5;
    this.paletteShift += 0.002 * (0.2 + energy * 2) * (S.wobble ?? 0.6) + energy * dir * 0.004;
    const shift = Math.floor((((this.paletteShift % 1) + 1) % 1) * PALETTE_SIZE);
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const j = (i + shift) % PALETTE_SIZE;
      o.palette[i * 3] = g.palette[j * 3];
      o.palette[i * 3 + 1] = g.palette[j * 3 + 1];
      o.palette[i * 3 + 2] = g.palette[j * 3 + 2];
    }
    for (let i = 0; i < 3; i++) {
      o.bg[i] = g.bg[i];
      o.bg2[i] = g.bg2[i];
    }
    // The background turns, drifts and flows, so something is always
    // moving, even in a region that shows only background. The toy pushes it.
    o.bgAngle = g.bgAngle + 0.35 * Math.sin(this.t * 0.02);
    const step = Math.min(0.1, Math.max(0, this.t - (this.bgT ?? this.t)));
    this.bgT = this.t;
    this.bgPhase = (this.bgPhase || 0) + step * 0.08 * (S.bgSpeed ?? 2.5) * (1 + energy * 2);
    o.bgShift = this.bgPhase;
    o.paletteName = g.paletteName;
    o.archetype = g.archetype;
    o.camera.cx = g.camera.cx;
    o.camera.cy = g.camera.cy;
    o.camera.scale = g.camera.scale;
    o.camera.rot = g.camera.rot + 0.02 * Math.sin(this.t * 0.05);
  }
}
