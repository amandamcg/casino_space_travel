/**
 * Curated palettes. Each is a list of key colors that already look good
 * together and carry real hue contrast; the generator loops through them
 * smoothly to build a 256-entry palette, with a random start offset.
 *
 * To add one: paste hex colors in order. Photos work too: pull four or
 * five dominant colors and list them dark to light. `weight` is how often
 * it gets picked relative to the others (1 = punchy favorites, 0.35 = the
 * softer ones that are nice occasionally but flatten a whole sheet).
 */

export function pickWeighted(rng, list) {
  let total = 0;
  for (const p of list) total += p.weight ?? 1;
  let r = rng.next() * total;
  for (const p of list) {
    r -= p.weight ?? 1;
    if (r <= 0) return p;
  }
  return list[list.length - 1];
}

export const CURATED = [
  { name: "lagoon", weight: 0.1, colors: ["#0b3d4a", "#1fb5b0", "#f2c14e", "#e8e0c8"] },
  { name: "nebula", weight: 1.3, colors: ["#12063a", "#5b2a86", "#c34fa8", "#58c7f3"] },
  { name: "ember", weight: 1, colors: ["#1a0b0b", "#ff4e1a", "#ffb347", "#fff1c1"] },
  { name: "sherbet", weight: 1, colors: ["#ff6f91", "#ff9671", "#ffc75f", "#f9f871"] },
  { name: "forest", weight: 1, colors: ["#0a2e1f", "#1e8a4a", "#a8e05f", "#f0e68c"] },
  { name: "midnight", weight: 1, colors: ["#050a1f", "#1b3b8f", "#4bb1ff", "#ffffff"] },
  { name: "coral reef", weight: 1, colors: ["#003049", "#d62828", "#f77f00", "#fcbf49", "#eae2b7"] },
  { name: "bruise", weight: 1.3, colors: ["#2b0a3d", "#7a1f7a", "#e04f9a", "#ffd166"] },
  { name: "ice", weight: 0.35, colors: ["#0b1c2c", "#3a6ea5", "#9fd3f5", "#ffffff", "#ffd9a0"] },
  { name: "rust teal", weight: 1.3, colors: ["#124e5c", "#2ec4b6", "#e36414", "#9a031e"] },
  { name: "peach ink", weight: 1.3, colors: ["#1d1e2c", "#f0a6ca", "#efc3e6", "#f7d488", "#59656f"] },
  { name: "gold navy", weight: 0.1, colors: ["#0a1128", "#1c3f8f", "#f4c542", "#ffffff"] },
  { name: "magenta cyan", weight: 1.3, colors: ["#3d0066", "#ff00a8", "#ffb3e6", "#00ffd5"] },
  { name: "dusk", weight: 1, colors: ["#2d1b4e", "#b34a8a", "#ff8c69", "#ffd8a8"] },
  { name: "moss copper", weight: 0.35, colors: ["#1e2d24", "#6b8e23", "#b87333", "#f5e6c8"] },
  { name: "cyan crimson", weight: 1.3, colors: ["#001219", "#005f73", "#0a9396", "#94d2bd", "#ae2012", "#bb3e03"] },
  { name: "plum sky", weight: 1, colors: ["#1b1f3b", "#4b3f72", "#ffc857", "#e9724c", "#c5283d"] },
  { name: "teal rose", weight: 1, colors: ["#1f6f78", "#f2b5d4", "#ef476f", "#ffd166", "#06d6a0"] },
  { name: "violet gold", weight: 1, colors: ["#240046", "#7b2cbf", "#e0aaff", "#ffb703", "#fb8500"] },

  // From Amanda's So Cal desert photos (Joshua Tree, Mojave, the coast).
  { name: "joshua dusk", weight: 0.35, colors: ["#2a2f6b", "#5a4f8c", "#3b3a2a", "#c9a15a", "#d9b48f"] },
  { name: "sunset beach", weight: 1.3, colors: ["#2b1f2e", "#5a3b5c", "#b2607a", "#f26b4f", "#f4a03a"] },
  { name: "pink cloud", weight: 0.35, colors: ["#6f8fd1", "#b7a4d8", "#e87c8a", "#f4a0a6", "#f7e3d0"] },
  { name: "desert noon", weight: 0.35, colors: ["#1c6fd8", "#4aa3e8", "#6a6b3f", "#d9c39a", "#f2efe6"] },
  { name: "golden road", weight: 0.35, colors: ["#4c4f52", "#7a5a3a", "#2d8fb8", "#e0a832", "#f2d27a"] },
  { name: "cactus bloom", weight: 1, colors: ["#7f8f6f", "#b9b3a2", "#d8c7a0", "#e83c9e", "#ff7ac8"] },
  { name: "storm palms", weight: 0.35, colors: ["#2c2f33", "#4b5a6b", "#8a97a6", "#c8bfae", "#cfd6dc"] },
  { name: "magenta sky", weight: 1.3, colors: ["#1a1233", "#3e2a7a", "#7a3aa8", "#c8267a", "#ff2d75"] },
  { name: "cracked mud", weight: 0.35, colors: ["#3a3229", "#6f5f4d", "#a89273", "#d8c7a8", "#f0e6d2"] },
  { name: "ocotillo", weight: 1.3, colors: ["#2f5aa8", "#6fb3e0", "#8c8f4a", "#e0562a", "#f28c3a"] },
  { name: "night bloom", weight: 0.35, colors: ["#1c2b4a", "#6e7f6a", "#9fb3b8", "#c9572e", "#e39b5a"] },
  { name: "prickly pear", weight: 1, colors: ["#4a4d3a", "#6b3f7a", "#a86aa6", "#e94fa0", "#d9bf8f"] },
  { name: "wet sand", weight: 0.35, colors: ["#2a2530", "#5c4a55", "#9d7f7b", "#d9a98a", "#f6d3b3"] },
  { name: "blue hour", weight: 1.3, colors: ["#0f1a3a", "#243b7a", "#4d6fb5", "#c48a5a", "#f0c98a"] },
  { name: "milky way", weight: 1, colors: ["#0b1030", "#1f2a5c", "#5a4a8a", "#8fb3c8", "#f2ead7"] },
  { name: "cholla", weight: 1.3, colors: ["#3a3b2a", "#7c8c6a", "#c7c9a8", "#e9b44c", "#b5532a"] },
  { name: "desert flowers", weight: 1.3, colors: ["#6f7f5c", "#d8c99a", "#f7e56b", "#f5b8d0", "#e8399a"] },
  { name: "beavertail", weight: 1, colors: ["#4e5a3c", "#8ea07a", "#e04e9c", "#ff8fc7", "#fff0d6"] },
  // Voted for in the palette picker, 2026-09-13.
  { name: "amanda 01", weight: 1.2, colors: ["#2b3517", "#b9480a", "#48d4f2", "#c9bdf5"] },
  { name: "amanda 02", weight: 1.2, colors: ["#434d28", "#b26307", "#3bc1fc", "#cbaff3"] },
  { name: "amanda 03", weight: 1.2, colors: ["#333b11", "#735d33", "#b44ba6", "#eda86c", "#cadfe8"] },
  { name: "amanda 04", weight: 1.2, colors: ["#085353", "#299d6a", "#da0c24", "#9f095c"] },
  { name: "amanda 05", weight: 1.2, colors: ["#12213b", "#472086", "#ad9552", "#e375aa", "#f6d6bc"] },
  { name: "amanda 06", weight: 1.2, colors: ["#3a2812", "#1c438a", "#e71872", "#d4b584", "#cdcae7"] },
  { name: "amanda 07", weight: 1.2, colors: ["#0f5452", "#21e192", "#b44215", "#8c0027"] },
  { name: "amanda 08", weight: 1.2, colors: ["#0f1638", "#201b59", "#5c4395", "#b111a9", "#f33cca"] },
  { name: "amanda 09", weight: 1.2, colors: ["#473906", "#8b5e38", "#d961c7", "#c9dbe8"] },
  { name: "amanda 10", weight: 1.2, colors: ["#1c438a", "#e71872", "#d4b584", "#f5b8d0"] },
  { name: "amanda 11", weight: 1.2, colors: ["#533013", "#1a617f", "#ec35b7", "#e4bc98", "#e2e3f0"] },
  { name: "amanda 12", weight: 1.2, colors: ["#085353", "#472086", "#ad9552", "#e375aa"] },
  { name: "amanda 13", weight: 1.2, colors: ["#030924", "#4336ac", "#a72eca", "#5df0d9"] },
  { name: "amanda 14", weight: 1.2, colors: ["#3f2c08", "#0e4a75", "#e469b9", "#e1b46e", "#d1cfdd"] },
  { name: "amanda 15", weight: 1.2, colors: ["#1a225d", "#373069", "#664da0", "#d43f9c", "#f54ab0"] },
  { name: "amanda 16", weight: 1.2, colors: ["#292a07", "#1b4a86", "#ea7f92", "#d9c86e", "#d1cbdd"] },
  { name: "amanda 17", weight: 1.2, colors: ["#030924", "#0e4a75", "#4336ac", "#e469b9", "#d1cfdd"] },
  { name: "amanda 18", weight: 1.2, colors: ["#06124c", "#5e4dac", "#bf28db", "#32f7da"] },
  { name: "amanda 19", weight: 1.2, colors: ["#210c41", "#582680", "#ae44bb", "#e474c5", "#f9b8f4"] },
  { name: "amanda 20", weight: 1.2, colors: ["#085353", "#9f095c", "#da0c24", "#e474c5", "#f9b8f4"] },
  { name: "amanda 21", weight: 1.2, colors: ["#741b19", "#f94642", "#6ebce4", "#bae7ec", "#36b9bb"] },
  { name: "amanda 22", weight: 1.2, colors: ["#121a64", "#3e3f74", "#7254a0", "#d836ae", "#ff20c1"] },
  { name: "amanda 23", weight: 1.2, colors: ["#040b19", "#1b4394", "#4b679a", "#d57251", "#f8d6b5"] },
  { name: "amanda 24", weight: 1.2, colors: ["#1c438a", "#e71872", "#e8399a", "#d4b584"] },
  { name: "amanda 25", weight: 1.2, colors: ["#0f1a3a", "#085353", "#4d6fb5", "#e474c5", "#f9b8f4"] },
  { name: "amanda 26", weight: 1.2, colors: ["#3f2c08", "#d961c7", "#e1b46e", "#d1cfdd"] },
  { name: "amanda 27", weight: 1.2, colors: ["#001219", "#0f1638", "#0a9396", "#b111a9", "#5c4395"] },
  { name: "amanda 28", weight: 1.2, colors: ["#0c3a40", "#33792d", "#e5aa1a", "#9874e4", "#f3cfbe"] },
  { name: "amanda 29", weight: 1.2, colors: ["#124e5c", "#5b2a86", "#2ec4b6", "#c34fa8"] },
  { name: "amanda 30", weight: 1.2, colors: ["#001219", "#1d1e2c", "#5c4395", "#f7d488", "#efc3e6"] },
  { name: "amanda 31", weight: 1.2, colors: ["#3f2c08", "#741b19", "#36b9bb", "#f94642"] },
  { name: "amanda 32", weight: 1.2, colors: ["#080c18", "#44287f", "#919141", "#d76ba2", "#f9cc98"] },
  { name: "amanda 33", weight: 1.2, colors: ["#3c1c11", "#89673a", "#df5bab", "#bbd4f7"] },
  { name: "amanda 34", weight: 1.2, colors: ["#3f2c08", "#1c438a", "#d961c7", "#e1b46e", "#d1cfdd"] },
  { name: "amanda 35", weight: 1.2, colors: ["#010218", "#0a4277", "#422d83", "#e480ad", "#d4d2da"] },
  { name: "amanda 36", weight: 1.2, colors: ["#3d1910", "#a5561f", "#dcd55e", "#f1fcb6"] },
  { name: "amanda 37", weight: 1.2, colors: ["#082776", "#597dd7", "#e265a0", "#e8c1cc", "#947830"] },
];

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}
