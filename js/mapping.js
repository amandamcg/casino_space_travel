/**
 * Projection-mapping math and the calibration data model. Pure functions,
 * no DOM, so they can be unit tested under Node (tests/js/).
 *
 * Calibration v2 (data/calibration.json):
 *
 *   {
 *     "version": 2,
 *     "stage": { "width": 2048, "height": 768 },
 *     "regions": [
 *       {
 *         "name": "dome left",
 *         "shape": "polygon",                 // "quad" | "polygon" | "ellipse"
 *         "corners": [[x, y], ...],           // meaning depends on the shape
 *         "mask": [[x, y], ...],              // quad only: optional outline
 *         "angle": 20,                        // this region's own turn of the image
 *         "link": "A",                        // "" or A-F: linked spots share a look
 *         "variant": { "hue": 120, "zoom": 1, "panX": 0, "panY": 0, "rotate": 0,
 *                      "flipX": false, "flipY": false, "invert": false,
 *                      "spin": 1, "pulse": 1, // response to the toy, see below
 *                      "source": "main" }     // "main" image or "black" cutout
 *       }
 *     ]
 *   }
 *
 * Shapes, and what `corners` holds for each:
 *   quad     4 points (TL, TR, BR, BL). The image is perspective-fitted to
 *            them; `mask` can cut it to any outline. Best for backgrounds
 *            and flat faces seen at an angle.
 *   polygon  3 or more points: the outline itself. The image fills the
 *            outline (it covers the outline's bounding box, unstretched).
 *   ellipse  3 points: centre, and two rim points a quarter turn apart.
 *            Gives circles and ovals at any tilt.
 *
 * Regions are drawn in list order, so later ones sit on top: backgrounds
 * first, spots after.
 *
 * Every region is a window onto the same image, so when the toy spins or
 * pulses that image, all of them would move in step. `spin` and `pulse`
 * set how much of that motion a region shows: 1 follows, 0 holds steady,
 * -1 goes the opposite way, 2 doubles it. Anything but 1 is done by
 * turning or zooming the region's own copy against the image.
 *
 * The stage is the whole browser window in pixels: every projector output
 * side by side (two XGA projectors = 2048 x 768). All coordinates are
 * stage pixels, so a region can sit on any projector. Each region shows a
 * live copy of the one rendered image, fitted to its four corners with a
 * perspective transform and cut by its mask.
 *
 * The v1 shape ({ matrix, clip } applied to the single canvas) still
 * loads and is used when there are no regions.
 */

export const MAX_REGIONS = 32;
export const MAX_MASK_POINTS = 64;
export const DEFAULT_STAGE = { width: 1024, height: 768 };
export const SHAPES = ["quad", "polygon", "ellipse"];
export const LINKS = ["", "A", "B", "C", "D", "E", "F"];
export const SOURCES = ["main", "black", "rock"]; // the image, a cutout, or one of Amanda's scanned rocks
export const ROCK_COUNT = 25; // img/rocks/rock-01.jpg to rock-25.jpg, see its README
export const rockFile = (i) => `img/rocks/rock-${String(i + 1).padStart(2, "0")}.jpg`;

/**
 * Where the rock sits in its scan, as fractions of the picture: { x, y, w, h }. The scans
 * are square with the rock across the middle; its outline (`shapes.json`, 64 radii round
 * the compass as fractions of the half side) says how far it reaches each way. Drawn from
 * this frame, the rock fills a region's oval edge to edge. Without an outline, the whole
 * picture.
 */
/**
 * The rocks light enough to project: a projector cannot make a dark rock bright, so the
 * show changes rocks only among these (Amanda, 2026-10-08: "only use lighter rocks in the
 * projection"). `shapes` is shapes.json; each rock's `light` is 0 to 1. All of them when
 * the file is missing or too few are light.
 */
export const LIGHT_ENOUGH = 0.44;
export function rockPool(shapes) {
  const all = Array.from({ length: ROCK_COUNT }, (_, i) => i);
  if (!shapes) return all;
  const light = all.filter((i) => Number(shapes[rockFile(i).split("/").pop()]?.light) >= LIGHT_ENOUGH);
  return light.length >= 2 ? light : all;
}

/** Another rock than `now` from the pool, by chance. */
export function otherRock(now, pool, random = Math.random) {
  const rest = pool.filter((i) => i !== now);
  if (!rest.length) return now;
  return rest[Math.min(rest.length - 1, Math.floor(random() * rest.length))];
}

export function rockFrame(shape) {
  const r = shape && shape.r;
  if (!r || r.length < 64) return { x: 0, y: 0, w: 1, h: 1 };
  const hx = (r[0] + r[32]) / 4; // half the width, as a fraction of the picture
  const hy = (r[16] + r[48]) / 4;
  return { x: 0.5 - hx, y: 0.5 - hy, w: hx * 2, h: hy * 2 };
}
export const OUTPUT_WIDTH = 1024; // one projector's share of the stage
const ELLIPSE_STEPS = 64;

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 3x3 homography mapping the rectangle (0,0)-(w,h) onto four corners
 * given as TL, TR, BR, BL. Returned row-major: [a, b, c, d, e, f, g, h, 1]
 * with x' = (a x + b y + c) / (g x + h y + 1), y' likewise with d, e, f.
 */
export function homography(w, h, corners) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = corners;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, hh;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // Parallelogram: plain affine.
    a = x1 - x0;
    b = x3 - x0;
    d = y1 - y0;
    e = y3 - y0;
    g = 0;
    hh = 0;
  } else {
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    g = (sx * dy2 - dx2 * sy) / den;
    hh = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + hh * x3;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + hh * y3;
  }
  c = x0;
  f = y0;
  return [a / w, b / h, c, d / w, e / h, f, g / w, hh / h, 1];
}

/** Apply a homography to a point. */
export function applyHomography(m, x, y) {
  const wq = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / wq, (m[3] * x + m[4] * y + m[5]) / wq];
}

/** The 16 numbers for CSS `matrix3d()` (column-major) from a homography. */
export function toMatrix3d(m) {
  return [m[0], m[3], 0, m[6], m[1], m[4], 0, m[7], 0, 0, 1, 0, m[2], m[5], 0, m[8]];
}

/** CSS transform string fitting a w x h element onto four corners. */
export function cornersToCss(w, h, corners) {
  const m = homography(w, h, corners);
  if (!m) return "none";
  return `matrix3d(${toMatrix3d(m).map((v) => +v.toFixed(10)).join(",")})`;
}

/**
 * Affine map taking three source points onto three destination points,
 * in the same 3x3 row-major form as `homography` (bottom row 0, 0, 1).
 * Returns null when the source points are in a line.
 */
export function affine3(src, dst) {
  const [[x0, y0], [x1, y1], [x2, y2]] = src;
  const [[u0, v0], [u1, v1], [u2, v2]] = dst;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-12) return null;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
  const b = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
  const d = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const e = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  return [a, b, u0 - a * x0 - b * y0, d, e, v0 - d * x0 - e * y0, 0, 0, 1];
}

/** Axis-aligned bounding box of a list of points. */
export function bounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Unsigned area of a polygon (shoelace formula). */
export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

/**
 * Outline of an ellipse region as a polygon. `corners` is the centre and
 * two rim points a quarter turn apart (they need not be perpendicular on
 * screen: a circle seen at an angle is still described exactly).
 */
export function ellipseOutline(corners, steps = ELLIPSE_STEPS) {
  const [[cx, cy], [px, py], [qx, qy]] = corners;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push([cx + c * (px - cx) + s * (qx - cx), cy + c * (py - cy) + s * (qy - cy)]);
  }
  return out;
}

/** The lit outline of a region, as a polygon in stage pixels. */
export function regionOutline(region) {
  if (region.shape === "ellipse") return ellipseOutline(region.corners);
  return region.corners;
}

/**
 * 3x3 matrix placing the w x h image for a region (see the shape notes at
 * the top of this file). Returns null when the shape is degenerate.
 */
export function regionMatrix(region, w, h) {
  if (region.shape === "ellipse") {
    // The circle inscribed in the image's central square lands on the oval.
    const src = [[w / 2, h / 2], [w / 2 + h / 2, h / 2], [w / 2, 0]];
    return affine3(src, region.corners);
  }
  if (region.shape === "polygon") {
    const b = bounds(region.corners);
    const s = Math.max(b.w / w, b.h / h);
    if (!(s > 0)) return null;
    return [s, 0, b.x + (b.w - w * s) / 2, 0, s, b.y + (b.h - h * s) / 2, 0, 0, 1];
  }
  return homography(w, h, region.corners);
}

/** CSS transform string placing the image for a region. */
export function regionCss(region, w, h) {
  const m = regionMatrix(region, w, h);
  if (!m) return "none";
  return `matrix3d(${toMatrix3d(m).map((v) => +v.toFixed(10)).join(",")})`;
}

/** CSS clip-path for a region: its own outline, or a quad's optional mask. */
export function regionClip(region) {
  if (region.shape === "quad") return maskToClipPath(region.mask);
  return maskToClipPath(regionOutline(region));
}

/** False when a region's points cannot make a usable shape. */
export function isRegionValid(region) {
  if (region.shape === "quad") return isConvexQuad(region.corners);
  if (region.shape === "ellipse") {
    const [[cx, cy], [px, py], [qx, qy]] = region.corners;
    return Math.abs((px - cx) * (qy - cy) - (qx - cx) * (py - cy)) > 1;
  }
  return region.corners.length >= 3 && polygonArea(region.corners) > 1;
}

/**
 * How much a w x h image must grow so that, turned by `degrees`, it still
 * covers a w x h frame with no empty corners.
 */
export function coverScale(degrees, w, h) {
  const t = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return Math.max(c + (h / w) * s, c + (w / h) * s);
}

/**
 * True when the four corners form a convex quad with a consistent winding.
 * A concave or self-crossing quad has no sensible perspective fit.
 */
export function isConvexQuad(corners) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    const [cx, cy] = corners[(i + 2) % 4];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** CSS `clip-path` value for a mask polygon in stage pixels ("none" if empty). */
export function maskToClipPath(mask) {
  if (!Array.isArray(mask) || mask.length < 3) return "none";
  return `polygon(${mask.map(([x, y]) => `${+x.toFixed(2)}px ${+y.toFixed(2)}px`).join(", ")})`;
}

/** Squared distance from point p to segment a-b. */
function segDist2(p, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2 : 0;
  t = clampNum(t, 0, 1);
  const dx = p[0] - (a[0] + t * vx);
  const dy = p[1] - (a[1] + t * vy);
  return dx * dx + dy * dy;
}

/**
 * Insert a point into a mask polygon on its nearest edge, so the outline
 * stays in order. Returns { mask, index } with a new array.
 */
export function insertMaskPoint(mask, pt) {
  if (!Array.isArray(mask) || mask.length < 2) {
    const out = [...(mask || []), [pt[0], pt[1]]];
    return { mask: out, index: out.length - 1 };
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < mask.length; i++) {
    const d = segDist2(pt, mask[i], mask[(i + 1) % mask.length]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const out = mask.map((p) => [p[0], p[1]]);
  out.splice(best + 1, 0, [pt[0], pt[1]]);
  return { mask: out, index: best + 1 };
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > pt[1] !== yj > pt[1];
    if (crosses && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Centre of a list of points (the middle of their bounding box). */
export function centreOf(points) {
  const b = bounds(points);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** Points turned by `degrees` (clockwise on screen) and scaled, about a centre. */
export function transformPoints(points, centre, degrees = 0, scale = 1) {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t) * scale;
  const s = Math.sin(t) * scale;
  const [cx, cy] = centre;
  return points.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

/**
 * Turn and/or resize a whole region in place, about the middle of its
 * outline. The image turns with the shape: an oval and a 4-corner region
 * carry it in their points; a polygon's image is placed by its bounding
 * box, so its own `angle` is turned to match.
 */
export function transformRegion(region, degrees = 0, scale = 1) {
  const centre = centreOf(regionOutline(region));
  region.corners = transformPoints(region.corners, centre, degrees, scale);
  region.mask = transformPoints(region.mask || [], centre, degrees, scale);
  if (region.shape === "polygon") region.angle = wrap360((region.angle || 0) + degrees);
  return region;
}

/** Corners of an axis-aligned rectangle, TL, TR, BR, BL. */
/** Which projector a region is on: 0 for the first OUTPUT_WIDTH of the stage, 1 for the next. */
export function outputOf(region, outputs = Infinity) {
  const [cx] = centreOf(region.corners);
  return Math.max(0, Math.min(outputs - 1, Math.floor(cx / OUTPUT_WIDTH)));
}

/**
 * The point texture's side for a picture `span` projectors wide. The flame's density per
 * cell is what sets its colours, and a picture twice as wide has twice the cells, so a wide
 * picture draws `span` times the points: the side grows by the square root of `span`, in
 * the renderer's steps of 64, up to its 1024 cap (Amanda, 2026-10-07: the wide picture's
 * colours had shifted).
 */
export function pointSide(side, span = 1) {
  const wanted = side * Math.sqrt(Math.max(1, span));
  return Math.max(64, Math.min(1024, Math.ceil(wanted / 64) * 64));
}

/** Where the w x h image lands on the stage for a region: the bounds of its placed corners. */
export function regionImageBounds(region, w, h) {
  const m = regionMatrix(region, w, h);
  if (!m) return null;
  return bounds([[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => applyHomography(m, x, y)));
}

/** The smallest a spot's own canvas goes, as a fraction of the w x h image (1/8 of 1024 x 768 is 128 x 96). */
export const LEAST_CANVAS = 1 / 8;

/**
 * How big a region's own canvas needs to be, as a fraction of the w x h image: a power of
 * two giving it about twice its size on the stage, down to LEAST_CANVAS. A lampshade spot
 * 30 px tall used to get a full 1024 x 768 copy of the picture every frame, and its hue
 * filter ran over all of it; the compositor then shrank it 30 times. Backgrounds keep the
 * whole image, and a cutout (painted black once) needs almost nothing.
 */
export function canvasFraction(region, w, h, least = LEAST_CANVAS) {
  if (isBackground(region)) return 1;
  if (region.variant && region.variant.source === "black") return least / 4;
  const b = regionImageBounds(region, w, h);
  if (!b) return 1;
  const need = 2 * Math.max(b.w / w, b.h / h);
  let f = 1;
  while (f / 2 >= need && f / 2 >= least) f /= 2;
  return f;
}

/** A background, as makeBackground makes one: a quad filling one projector's share of the stage. */
export function isBackground(region) {
  if (region.shape !== "quad" || region.corners.length !== 4) return false;
  const b = bounds(region.corners);
  const k = Math.round(b.x / OUTPUT_WIDTH);
  return Math.abs(b.x - k * OUTPUT_WIDTH) < 2 && Math.abs(b.w - OUTPUT_WIDTH) < 2 && Math.abs(b.y) < 2;
}

/**
 * A background that shows its projector's part of the picture just as drawn: an exact
 * rectangle on its share of the stage, no mask, no turn, and a look that changes nothing
 * (a mirrored second background counts when the picture spans the projectors, since the
 * layer drops the mirror then). Such a background is the same as the canvas itself.
 */
export function isPlainBackground(region, span = 1) {
  if (!isBackground(region) || (region.mask && region.mask.length) || region.angle) return false;
  const b = bounds(region.corners);
  const rect = rectCorners(b.x, b.y, b.w, b.h);
  if (region.corners.some(([x, y], i) => Math.abs(x - rect[i][0]) > 0.5 || Math.abs(y - rect[i][1]) > 0.5)) return false;
  const v = normalizeVariant(region.variant);
  const mirrored = v.flipX && span <= 1;
  return (
    v.source === "main" && !v.hue && v.zoom === 1 && !v.panX && !v.panY && !v.rotate &&
    !v.flipY && !v.invert && v.spin === 1 && v.pulse === 1 && !mirrored
  );
}

/**
 * True when the regions start with one plain background per projector and nothing else
 * covers the stage: then the canvas can show as it is, underneath the spots, and the
 * backgrounds need no copies at all. The canvas is `span` projectors wide and `h` tall.
 */
export function canPassThrough(regions, stage, span = 1, h = DEFAULT_STAGE.height) {
  if (!stage || stage.width !== span * OUTPUT_WIDTH || stage.height !== h) return false;
  if (regions.length < span) return false;
  const seen = new Set();
  for (let i = 0; i < span; i++) {
    const r = regions[i];
    if (!isPlainBackground(r, span) || Math.abs(bounds(r.corners).h - h) > 2) return false;
    seen.add(outputOf(r, span));
  }
  if (seen.size !== span) return false;
  return !regions.slice(span).some(isBackground);
}

export function rectCorners(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function normalizePoint(p) {
  if (!Array.isArray(p) || p.length < 2) return null;
  const x = Number(p[0]);
  const y = Number(p[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function wrap360(v) {
  return ((num(Number(v), 0) % 360) + 360) % 360;
}

export function normalizeVariant(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    hue: wrap360(o.hue),
    zoom: clampNum(num(Number(o.zoom), 1), 1, 4),
    panX: clampNum(num(Number(o.panX), 0), -1, 1),
    panY: clampNum(num(Number(o.panY), 0), -1, 1),
    rotate: wrap360(o.rotate),
    flipX: !!o.flipX,
    flipY: !!o.flipY,
    invert: !!o.invert,
    spin: clampNum(num(Number(o.spin ?? 1), 1), -2, 2),
    pulse: clampNum(num(Number(o.pulse ?? 1), 1), -2, 2),
    source: SOURCES.includes(o.source) ? o.source : "main",
    // Only a rock region says which rock, so every other region is as it always was.
    ...(o.source === "rock" ? { rock: clampNum(Math.round(num(Number(o.rock ?? 0), 0)), 0, ROCK_COUNT - 1) } : {}),
  };
}

/**
 * A random look for a spot: a different part of the same image, turned,
 * recolored, sometimes inverted. Spots made this way are each unique but
 * clearly from one family, and they contrast with an untouched background.
 */
/**
 * Add regions designed elsewhere (the room composer) to a calibration. Only regions whose
 * names are not already there are added: backgrounds go with the other backgrounds,
 * underneath; everything else goes on top. Nothing already there is moved, restyled or
 * removed, so outlines fitted by hand are safe. The stage grows if the design is wider
 * (more projectors); it never shrinks.
 * Returns { cal, added, backgrounds, widened, dropped, already }.
 */
export function addDesignedRegions(cal, designed) {
  const base = normalizeCalibration(cal);
  const extra = normalizeCalibration(designed);
  const out = { ...base, stage: { ...base.stage }, regions: base.regions.map((r) => ({ ...r })) };
  const result = { cal: out, added: 0, backgrounds: 0, widened: false, dropped: 0, already: 0 };
  if (extra.stage.width > out.stage.width) {
    out.stage.width = extra.stage.width;
    result.widened = true;
  }
  for (const r of extra.regions) {
    const isBackground = r.name.startsWith("background");
    if (out.regions.some((x) => x.name === r.name)) {
      if (!isBackground) result.already++;
    } else if (out.regions.length >= MAX_REGIONS) {
      result.dropped++;
    } else if (isBackground) {
      out.regions.splice(out.regions.filter((x) => x.name.startsWith("background")).length, 0, r);
      result.backgrounds++;
    } else {
      out.regions.push(r);
      result.added++;
    }
  }
  return result;
}

/**
 * Bring looks and sets across from a design (the room composer) without touching any
 * outline. Each region here that has a namesake in the design takes that one's look and
 * set; its shape, corners and own angle stay as they are. Backgrounds are left alone.
 * Returns { cal, updated, missing }: `missing` counts designed spots with no region here.
 */
export function updateDesignedLooks(cal, designed) {
  const base = normalizeCalibration(cal);
  const extra = normalizeCalibration(designed);
  const out = { ...base, regions: base.regions.map((r) => ({ ...r })) };
  const result = { cal: out, updated: 0, missing: 0 };
  for (const r of extra.regions) {
    if (r.name.startsWith("background")) continue;
    const mine = out.regions.find((x) => x.name === r.name);
    if (!mine) {
      result.missing++;
      continue;
    }
    mine.variant = { ...r.variant };
    mine.link = r.link;
    result.updated++;
  }
  return result;
}

export function randomVariant(random = Math.random) {
  // The show keeps the fractal framed around the middle of the image, so a
  // crop far from the middle is mostly empty background. Keep the middle of
  // each crop within CONTENT of the image centre (as a fraction of the half
  // width), whatever the zoom, so a spot always has pattern in it.
  const CONTENT = 0.28;
  const zoom = Math.round((1.3 + random() * 1.1) * 20) / 20;
  const reach = 1 - 1 / zoom; // how far a crop's middle can slide at this zoom
  const pan = () => {
    const offset = (random() * 2 - 1) * CONTENT;
    return Math.round(clampNum(offset / reach, -1, 1) * 50) / 50;
  };
  return normalizeVariant({
    hue: Math.round(60 + random() * 240), // keep well away from the background's own colors
    zoom,
    panX: pan(),
    panY: pan(),
    rotate: Math.round(random() * 359),
    flipX: random() < 0.5,
    flipY: false,
    invert: random() < 0.25,
    // Mostly not in step with the background when the toy is played.
    spin: [-1, -1, 0, 2, -2, 1][Math.floor(random() * 6)],
    pulse: [-1, -1, 0, 2, 1][Math.floor(random() * 5)],
    source: "main",
  });
}

/** How many points a shape's `corners` must hold: [min, max]. */
export function cornerLimits(shape) {
  if (shape === "polygon") return [3, MAX_MASK_POINTS];
  if (shape === "ellipse") return [3, 3];
  return [4, 4];
}

/** A fresh region near the middle of the stage. */
export function makeRegion(stage, index = 0, shape = "quad") {
  const off = (index % 6) * 24;
  const cx = stage.width / 2 + off;
  const cy = stage.height / 2 + off;
  const r = Math.min(stage.width, stage.height) * 0.2;
  let corners;
  if (shape === "polygon") {
    corners = [[cx, cy - r], [cx + r, cy + r * 0.8], [cx - r, cy + r * 0.8]];
  } else if (shape === "ellipse") {
    corners = [[cx, cy], [cx + r, cy], [cx, cy - r]];
  } else {
    const w = Math.min(stage.width, 512);
    const h = Math.min(stage.height, 384);
    corners = rectCorners(cx - w / 2, cy - h / 2, w, h);
  }
  const label = { quad: "region", polygon: "spot", ellipse: "oval" }[shape] || "region";
  return {
    name: `${label} ${index + 1}`,
    shape: SHAPES.includes(shape) ? shape : "quad",
    corners,
    mask: [],
    angle: 0,
    link: "",
    variant: normalizeVariant({ hue: (index * 67) % 360 }),
  };
}

/**
 * A full-frame background for one projector output (0 = leftmost).
 * Every second output is mirrored, so neighbouring projectors meet on a
 * matching edge instead of a hard seam.
 */
export function makeBackground(stage, output = 0) {
  const x = Math.min(output * OUTPUT_WIDTH, Math.max(0, stage.width - OUTPUT_WIDTH));
  const w = Math.min(OUTPUT_WIDTH, stage.width - x);
  return {
    name: `background ${output + 1}`,
    shape: "quad",
    corners: rectCorners(x, 0, w, stage.height),
    mask: [],
    angle: 0,
    link: "",
    variant: normalizeVariant({ flipX: output % 2 === 1 }),
  };
}

function normalizeRegion(r, index) {
  if (!r || typeof r !== "object") return null;
  const shape = SHAPES.includes(r.shape) ? r.shape : "quad";
  const [min, max] = cornerLimits(shape);
  if (!Array.isArray(r.corners) || r.corners.length < min || r.corners.length > max) return null;
  const corners = r.corners.map(normalizePoint);
  if (corners.some((p) => !p)) return null;
  const mask = (shape === "quad" && Array.isArray(r.mask) ? r.mask : [])
    .map(normalizePoint)
    .filter(Boolean)
    .slice(0, MAX_MASK_POINTS);
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 60) : `region ${index + 1}`;
  const link = LINKS.includes(r.link) ? r.link : "";
  return { name, shape, corners, mask, angle: wrap360(r.angle), link, variant: normalizeVariant(r.variant) };
}

/**
 * Coerce anything loaded from the server into a safe calibration object.
 * Unknown or broken parts fall back to defaults; legacy v1 keys pass through.
 */
export function normalizeCalibration(obj) {
  const o = obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  const st = o.stage && typeof o.stage === "object" ? o.stage : {};
  const stage = {
    width: Math.round(clampNum(num(Number(st.width), DEFAULT_STAGE.width), 320, 16384)),
    height: Math.round(clampNum(num(Number(st.height), DEFAULT_STAGE.height), 240, 8192)),
  };
  const regions = (Array.isArray(o.regions) ? o.regions : [])
    .map(normalizeRegion)
    .filter(Boolean)
    .slice(0, MAX_REGIONS);
  const out = { version: 2, stage, regions };
  if (Array.isArray(o.matrix) && o.matrix.length === 16 && o.matrix.every((v) => Number.isFinite(v))) {
    out.matrix = o.matrix.slice();
  }
  if (typeof o.clip === "string" && o.clip) out.clip = o.clip;
  return out;
}

/** The scale that keeps a w x h frame covered at any rotation at all. */
export function maxCoverScale(w, h) {
  return Math.hypot(w, h) / Math.min(w, h);
}

/**
 * How to draw a variant: which part of the w x h rendered image a region
 * shows (zoom picks the size of the crop, pan slides it from edge to
 * edge), flips, and a rotation with the extra scale that keeps the frame
 * covered. `angle` is the region's own turn, added to the look's turn so
 * regions sharing a look can each show it at a different angle.
 * Returns { sx, sy, sw, sh, fx, fy, rot, cover, black } plus what
 * `frameSource` needs to apply the region's own response to the toy.
 */
export function variantSource(variant, w, h, angle = 0) {
  const v = normalizeVariant(variant);
  const sw = w / v.zoom;
  const sh = h / v.zoom;
  const fx = v.flipX ? -1 : 1;
  const fy = v.flipY ? -1 : 1;
  // The set's turn plus this region's own angle.
  const turn = wrap360(v.rotate + num(Number(angle), 0));
  return {
    sx: ((w - sw) / 2) * (1 + v.panX),
    sy: ((h - sh) / 2) * (1 + v.panY),
    sw,
    sh,
    fx,
    fy,
    rot: (turn * Math.PI) / 180,
    cover: turn ? coverScale(turn, w, h) : 1,
    black: v.source === "black",
    rock: v.source === "rock" ? v.rock : -1, // painted once, like black; never blitted
    // For frameSource:
    zoom: v.zoom,
    panX: v.panX,
    panY: v.panY,
    spin: v.spin,
    pulse: v.pulse,
    parity: fx * fy, // a mirrored copy already appears to turn the other way
    maxCover: maxCoverScale(w, h),
    dynamic: v.spin !== 1 || v.pulse !== 1,
    live: { sx: 0, sy: 0, sw: 0, sh: 0, fx, fy, rot: 0, cover: 1 },
  };
}

/** The toy doing nothing: no turn, no zoom. */
export const STILL = Object.freeze({ rot: 0, mag: 1 });

/**
 * This frame's drawing values for a region, given how the toy is moving
 * the image right now: `motion.rot` is how far it has turned the image
 * (radians, clockwise as drawn on a canvas) and `motion.mag` how much it
 * has magnified it. Regions that simply follow get `src` back unchanged.
 * The returned object is reused between calls.
 */
export function frameSource(src, motion, w, h) {
  if (!src.dynamic) return src;
  const live = src.live;
  // Turn the copy by the difference between what it should show and what
  // the image already does. A constant cover scale avoids a zoom that
  // pumps as it turns.
  live.rot = src.rot + (src.spin - 1) * src.parity * motion.rot;
  live.cover = src.spin !== 1 ? src.maxCover : src.cover;
  // Zoom the crop the same way. It cannot go wider than the whole image.
  const mag = Math.max(motion.mag, 0.05);
  const zoom = Math.max(1, src.zoom * Math.pow(mag, src.pulse - 1));
  live.sw = w / zoom;
  live.sh = h / zoom;
  live.sx = ((w - live.sw) / 2) * (1 + src.panX);
  live.sy = ((h - live.sh) / 2) * (1 + src.panY);
  return live;
}
