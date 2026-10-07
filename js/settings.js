/**
 * Master settings: the knobs that get tuned once before the month starts.
 *
 * SCHEMA drives both the master panel (master.html) and the defaults in
 * the show. Values live in data/settings.json via the server; the show
 * polls them every few seconds so the panel can be used from another
 * machine on the network while the projector shows the result.
 */

export const SCHEMA = [
  { group: "Render" },
  { key: "pointsTex", label: "Points (texture side)", min: 128, max: 1024, step: 64, def: 384,
    note: "points = side squared: 256 = 65k, 512 = 262k, 1024 = 1M. Biggest cost on the Pi." },
  { key: "iters", label: "Iterations per frame", min: 1, max: 4, step: 1, def: 2,
    note: "More = denser image per frame, proportionally more GPU." },
  { key: "decay", label: "Trail decay", min: 0.5, max: 0.995, step: 0.005, def: 0.7,
    note: "How much of last frame survives. Higher = denser, slower to change." },
  { key: "exposure", label: "Exposure bias", min: 0.05, max: 20, step: 0.05, def: 10.45,
    note: "Multiplies the automatic exposure, which keeps sparse and dense designs in range." },
  { key: "gamma", label: "Gamma", min: 1, max: 4, step: 0.05, def: 2.2 },
  { key: "vibrancy", label: "Vibrancy", min: 0, max: 1, step: 0.05, def: 1,
    note: "0 = gamma on color (pastel), 1 = gamma on brightness only (saturated)." },
  { key: "bgMix", label: "Background mix", min: 0, max: 1, step: 0.05, def: 1,
    note: "1 = fractal covers the background where dense, 0 = pure additive." },
  { key: "bgGradient", label: "Background blobs", min: 0, max: 1, step: 0.05, def: 1,
    note: "0 = flat background color, 1 = full drifting color blobs behind the fractal." },
  { key: "bgSpeed", label: "Background motion", min: 0, max: 6, step: 0.1, def: 2.5,
    note: "How fast the background colors drift and flow. 0 = still. The toy speeds it up further." },
  { key: "pointSize", label: "Point size", min: 1, max: 4, step: 1, def: 1 },
  { key: "grain", label: "Grain", min: 0, max: 0.2, step: 0.005, def: 0,
    note: "Multiplies the image, so it stays in the image's own colors." },
  { key: "deBlur", label: "Density blur", min: 0, max: 3, step: 0.05, def: 0,
    note: "Blurs thin, speckly areas and leaves dense ones sharp (flame-style density estimation). Costs some GPU." },
  { key: "floor", label: "Noise floor (hits)", min: 0, max: 4, step: 0.1, def: 0,
    note: "Pixels with fewer accumulated hits than this fade out; cleans stray speckle." },

  { group: "Motion" },
  { key: "morphMin", label: "Morph time min (s)", min: 5, max: 600, step: 5, def: 55,
    note: "Each morph picks a random length between min and max." },
  { key: "morphMax", label: "Morph time max (s)", min: 5, max: 600, step: 5, def: 400 },
  { key: "holdMin", label: "Hold time min (s)", min: 0, max: 600, step: 5, def: 90,
    note: "Time to breathe on a design before the next morph, random between min and max." },
  { key: "holdMax", label: "Hold time max (s)", min: 0, max: 600, step: 5, def: 225 },
  { key: "spanOutputs", label: "One picture across the projectors", type: "toggle", def: 1,
    note: "On: the fractal is drawn as wide as the stage and each projector shows its own part, one design across both walls. Off: each projector shows the same picture, the second mirrored. Costs about twice the drawing; the show restarts when this changes." },
  { key: "setChange", label: "Set looks change", min: 0, max: 12, step: 0.5, def: 4,
    note: "How many new looks each set of mapped spots takes in the time one design lasts (a morph and a hold). 0 = the looks stay as designed. Each set keeps its own pace, and the toy hurries them along with the morph." },
  { key: "wobble", label: "Wobble", min: 0, max: 2, step: 0.05, def: 1.6,
    note: "Constant breathing of the transforms, even while holding." },
  { key: "mutation", label: "Toy mutation", min: 0, max: 1, step: 0.05, def: 0.5,
    note: "How hard a toy spike bends the design in progress." },
  { key: "limitBounce", label: "Limit bounce", min: 0, max: 2, step: 0.05, def: 1,
    note: "Jello wobble of the camera when the toy has used up its mutation budget." },
  { key: "band1", label: "Button band: bend / palette", min: 0.1, max: 0.9, step: 0.01, def: 0.35,
    note: "Toy brightness below this = bend the design; above = new palette. Tune to the real toy's buttons." },
  { key: "band2", label: "Button band: palette / warp", min: 0.1, max: 0.9, step: 0.01, def: 0.55 },
  { key: "band3", label: "Button band: warp / warp+palette", min: 0.1, max: 0.95, step: 0.01, def: 0.78 },
  { key: "autoFrame", label: "Auto-frame", min: 0, max: 1, step: 0.05, def: 0.95,
    note: "Camera drifts to keep the fractal centered and sized. 0 = off." },

  { group: "Heartbeat" },
  { key: "hbMin", label: "Resting heart rate (BPM)", min: 30, max: 200, step: 1, def: 34,
    note: "The pulse idles here and drifts a little." },
  { key: "hbMax", label: "Max heart rate (BPM)", min: 30, max: 220, step: 1, def: 207,
    note: "Toy energy pushes the pulse up toward this; it eases back down after." },
  { key: "hbAmount", label: "Pulse strength", min: 0, max: 2, step: 0.05, def: 1.65,
    note: "Lub-dub on zoom and brightness. 0 = off." },
  { key: "hbTempo", label: "Woodblock tempo follows the heartbeat", type: "toggle", def: 1 },

  { group: "Toy" },
  { key: "toyGain", label: "Toy sensitivity", min: 0, max: 3, step: 0.05, def: 2.3 },
  { key: "toyMorphBoost", label: "Toy speeds morph", min: 0, max: 10, step: 0.5, def: 4,
    note: "At full energy the morph runs this many times faster." },

  { key: "favoriteOdds", label: "Revisit favorites", min: 0, max: 1, step: 0.05, def: 0.2,
    note: "Chance that the next design is one of your saved favorites instead of a new random one." },

  { group: "Design pool (the random worlds generator draws from these ranges)" },
  { key: "xformsMin", label: "Transforms min", min: 2, max: 6, step: 1, def: 3,
    note: "More transforms = busier, more layered designs." },
  { key: "xformsMax", label: "Transforms max", min: 2, max: 6, step: 1, def: 6 },
  { key: "varsMin", label: "Variations per transform min", min: 1, max: 4, step: 1, def: 2,
    note: "1 = clean single-flavor transforms, 3-4 = wilder mixtures." },
  { key: "varsMax", label: "Variations per transform max", min: 1, max: 4, step: 1, def: 3 },
  { key: "scaleMin", label: "Camera zoom min", min: 0.15, max: 1.5, step: 0.05, def: 0.35,
    note: "Starting zoom of a new design; auto-frame adjusts from there." },
  { key: "scaleMax", label: "Camera zoom max", min: 0.15, max: 1.5, step: 0.05, def: 0.6 },
  { key: "streakOdds", label: "Streaky (axis-aligned) design odds", min: 0, max: 1, step: 0.05, def: 0.2 },
  { key: "curatedOdds", label: "Curated palette odds", min: 0, max: 1, step: 0.05, def: 0.75,
    note: "Use a hand-picked palette (js/palettes.js) instead of a random one." },
  { key: "twoHueOdds", label: "Two-hue palette odds (when random)", min: 0, max: 1, step: 0.05, def: 0.75 },
  { key: "bgColored", label: "Colored background odds", min: 0, max: 1, step: 0.05, def: 0.95 },
  { key: "bgAvoidMuddy", label: "Backgrounds avoid blocked hues", type: "toggle", def: 1 },
  { key: "bgBlockedHues", label: "Blocked background hues", type: "hueset",
    def: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    note: "Click a swatch to block or allow that hue as a background. Blocked hues are routed to the nearest allowed one." },
  { key: "famSmooth", label: "Smooth variations", type: "toggle", def: 1 },
  { key: "famBlur", label: "Blur variations", type: "toggle", def: 1 },
  { key: "famSpiky", label: "Spiky variations", type: "toggle", def: 1 },
  { key: "famGeometric", label: "Geometric variations (tiles, blocks)", type: "toggle", def: 1 },

  { group: "Sound (woodblocks over a hurdy-gurdy drone)" },
  { key: "volume", label: "Master volume", min: 0, max: 1, step: 0.05, def: 0.7 },
  { key: "scale", label: "Scale / mode", type: "select", def: "mixolydian",
    options: ["mixolydian", "dorian", "major", "aeolian", "pentatonic major", "pentatonic minor", "drone only (root + fifth + octave)"],
    note: "Modes that ring over a root + fifth drone. Notes are weighted toward root, fifth and octave." },
  { key: "rootNote", label: "Root note (0=C … 7=G … 11=B)", min: 0, max: 11, step: 1, def: 7 },
  { key: "tempo", label: "Tempo (BPM)", min: 30, max: 200, step: 1, def: 84 },
  { key: "density", label: "Hit density", min: 0, max: 2, step: 0.05, def: 0.6,
    note: "How many of the rhythm's hits actually sound. The fractal's size scales this too." },
  { key: "maxLayers", label: "Max rhythm layers", min: 1, max: 6, step: 1, def: 4,
    note: "A small fractal plays one layer; a frame-filling one plays this many." },
  { key: "pad", label: "Bowed pad level", min: 0, max: 1, step: 0.05, def: 0.35,
    note: "Long bowed notes swelling under the blocks." },
  { key: "padMode", label: "Pad pitch", type: "select", def: "432 / 528 Hz window",
    options: ["432 / 528 Hz window", "follow scale root"],
    note: "Window: rests on 432 or 528 Hz, wanders between, occasionally bounces outside. Drone strings sit on 432 and 528 too." },
  { key: "tuning", label: "Block tuning reference", type: "select", def: "A = 432 Hz",
    options: ["A = 432 Hz", "A = 440 Hz"] },
  { key: "drone", label: "Drone level", min: 0, max: 1, step: 0.05, def: 0,
    note: "Constant root + fifth, hurdy-gurdy style. Off by default." },
  { key: "toyPass", label: "Toy pass-through level", min: 0, max: 1, step: 0.05, def: 0,
    note: "How much of the toy's own sound comes out of the speaker. Off: the toy only triggers the show and is not heard." },
];

export function defaults() {
  const d = {};
  for (const s of SCHEMA) if (s.key) d[s.key] = Array.isArray(s.def) ? [...s.def] : s.def;
  return d;
}

const RANGE_PAIRS = [
  ["morphMin", "morphMax"], ["holdMin", "holdMax"], ["xformsMin", "xformsMax"],
  ["varsMin", "varsMax"], ["scaleMin", "scaleMax"], ["hbMin", "hbMax"],
  ["band1", "band2"], ["band2", "band3"],
];

/** Merge a loaded object onto defaults, dropping anything out of range. */
export function sanitize(obj) {
  const out = defaults();
  if (!obj || typeof obj !== "object") return out;
  for (const s of SCHEMA) {
    if (!s.key) continue;
    const v = obj[s.key];
    if (s.type === "select") {
      if (typeof v === "string" && s.options.includes(v)) out[s.key] = v;
      continue;
    }
    if (s.type === "hueset") {
      if (Array.isArray(v) && v.length === 24) out[s.key] = v.map((x) => (x ? 1 : 0));
      continue;
    }
    if (typeof v !== "number" || Number.isNaN(v)) continue;
    if (s.type === "toggle") out[s.key] = v ? 1 : 0;
    else out[s.key] = Math.min(s.max, Math.max(s.min, v));
  }
  for (const [lo, hi] of RANGE_PAIRS) {
    if (out[lo] > out[hi]) out[hi] = out[lo];
  }
  if (obj.command && typeof obj.command === "object") out.command = obj.command;
  return out;
}

/**
 * Polls /api/settings. onChange(settings) is called with the sanitized
 * object whenever it changes; onCommand(cmd) whenever a new command id
 * shows up (the panel's "new design" and "reseed" buttons).
 */
export class SettingsPoller {
  constructor(onChange, onCommand, intervalMs = 3000) {
    this.onChange = onChange;
    this.onCommand = onCommand;
    this.interval = intervalMs;
    this.lastJson = "";
    this.lastCommandId = null;
    this.current = defaults();
  }

  start() {
    this.poll();
    setInterval(() => this.poll(), this.interval);
  }

  async poll() {
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      if (!r.ok) return;
      const raw = await r.json();
      const s = sanitize(raw);
      const cmd = s.command;
      delete s.command;
      const json = JSON.stringify(s);
      if (json !== this.lastJson) {
        this.lastJson = json;
        this.current = s;
        this.onChange(s);
      }
      if (cmd && cmd.id && cmd.id !== this.lastCommandId) {
        // Ignore commands from before this page loaded.
        const fresh = this.lastCommandId !== null || Date.now() - cmd.id < 15000;
        this.lastCommandId = cmd.id;
        if (fresh) this.onCommand(cmd);
      }
    } catch (_) {
      /* server absent: keep current settings */
    }
  }
}
