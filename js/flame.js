/**
 * Fractal flame renderer, WebGL2.
 *
 * Four passes per frame:
 *   1. iterate   every point (one texel of the state texture) is pushed
 *                through one randomly chosen transform; ping-pong.
 *   2. decay     previous accumulation buffer * decay -> new buffer.
 *   3. splat     every point drawn as an additive GL_POINT into the
 *                accumulation buffer, colored through the palette.
 *   4. tonemap   log-density, gamma, vibrancy, background, grain -> screen.
 *
 * A fifth, occasional pass downsamples the accumulation to 32x32 and reads
 * it back so the show can auto-frame the camera and notice dead designs.
 *
 * Requires WebGL2 + EXT_color_buffer_float (or the half-float variant).
 * The constructor throws if the GPU can't do it; main.js then falls back
 * to the simple shape renderer.
 */

import { MAX_XFORMS, NVAR, NPRM, PALETTE_SIZE, cumulativeWeights } from "./genome.js";

const STATS_SIZE = 32;
// Frames to give the GPU for a stats read before reading the old, waiting way.
const STATS_STALL = 12;

const QUAD_VS = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID & 1) * 2, (gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const ITER_FS = `#version 300 es
precision highp float;
precision highp int;
#define MAXX ${MAX_XFORMS}
#define PI 3.14159265358979
#define TAU 6.28318530717959
uniform sampler2D u_state;
uniform float u_frame;
uniform int u_nx;
uniform float u_cw[MAXX];
uniform vec3 u_aff[MAXX * 2];
uniform vec3 u_post[MAXX * 2];
uniform vec2 u_col[MAXX];
uniform vec4 u_var[MAXX * 10];
uniform vec4 u_prm[MAXX * 6];
out vec4 o;

#define V(i, v) u_var[(i) * 10 + (v) / 4][(v) % 4]
#define PRM(i, k) u_prm[(i) * 6 + (k) / 4][(k) % 4]

uint h(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
float rnd(inout uint s) { s = h(s); return float(s) / 4294967296.0; }

vec2 applyVars(int i, vec2 p, inout uint seed) {
  vec2 q = vec2(0.0);
  float x = p.x, y = p.y;
  float r2 = x * x + y * y;
  float r = sqrt(r2);
  float th = atan(x, y);
  float ph = atan(y, x);
  float w;
  w = V(i, 0); if (w != 0.0) q += w * p;
  w = V(i, 1); if (w != 0.0) q += w * sin(p);
  w = V(i, 2); if (w != 0.0) q += w * p / (r2 + 1e-6);
  w = V(i, 3); if (w != 0.0) { float s = sin(r2), c = cos(r2); q += w * vec2(x * s - y * c, x * c + y * s); }
  w = V(i, 4); if (w != 0.0) q += w * vec2((x - y) * (x + y), 2.0 * x * y) / (r + 1e-6);
  w = V(i, 5); if (w != 0.0) q += w * vec2(th / PI, r - 1.0);
  w = V(i, 6); if (w != 0.0) q += w * r * vec2(sin(th + r), cos(th - r));
  w = V(i, 7); if (w != 0.0) q += w * r * vec2(sin(th * r), -cos(th * r));
  w = V(i, 8); if (w != 0.0) q += w * (th / PI) * vec2(sin(PI * r), cos(PI * r));
  w = V(i, 9); if (w != 0.0) q += w * vec2(cos(th) + sin(r), sin(th) - cos(r)) / (r + 1e-6);
  w = V(i, 10); if (w != 0.0) q += w * vec2(sin(th) / (r + 1e-6), r * cos(th));
  w = V(i, 11); if (w != 0.0) q += w * vec2(sin(th) * cos(r), cos(th) * sin(r));
  w = V(i, 12); if (w != 0.0) { float p0 = sin(th + r), p1 = cos(th - r); float a = p0 * p0 * p0, b = p1 * p1 * p1; q += w * r * vec2(a + b, a - b); }
  w = V(i, 13); if (w != 0.0) { float om = rnd(seed) < 0.5 ? 0.0 : PI; float a = th * 0.5 + om; q += w * sqrt(r) * vec2(cos(a), sin(a)); }
  w = V(i, 14); if (w != 0.0) q += w * vec2(x < 0.0 ? 2.0 * x : x, y < 0.0 ? 0.5 * y : y);
  w = V(i, 15); if (w != 0.0) q += w * vec2(x + PRM(i, 0) * sin(y / (PRM(i, 1) * PRM(i, 1) + 1e-3)), y + PRM(i, 2) * sin(x / (PRM(i, 3) * PRM(i, 3) + 1e-3)));
  w = V(i, 16); if (w != 0.0) q += w * 2.0 / (r + 1.0) * vec2(y, x);
  w = V(i, 17); if (w != 0.0) q += w * 2.0 / (r + 1.0) * p;
  w = V(i, 18); if (w != 0.0) q += w * 4.0 / (r2 + 4.0) * p;
  w = V(i, 19); if (w != 0.0) q += w * vec2(sin(x), y);
  w = V(i, 20); if (w != 0.0) { float a = rnd(seed) * TAU, rr = rnd(seed); q += w * rr * vec2(cos(a), sin(a)); }
  w = V(i, 21); if (w != 0.0) { float a = rnd(seed) * TAU; float rr = rnd(seed) + rnd(seed) + rnd(seed) + rnd(seed) - 2.0; q += w * rr * vec2(cos(a), sin(a)); }
  w = V(i, 22); if (w != 0.0) { float c1 = PRM(i, 4), c2 = PRM(i, 5); float t1 = 1.0 + c1 * x + c2 * (x * x - y * y); float t2 = c1 * y + 2.0 * c2 * x * y; q += w * vec2(x * t1 + y * t2, y * t1 - x * t2) / (t1 * t1 + t2 * t2 + 1e-6); }
  w = V(i, 23); if (w != 0.0) q += w * vec2(sin(x) / (cos(y) + 1e-3), tan(y));
  w = V(i, 24); if (w != 0.0) { float a = rnd(seed) * PI * w; float s = sin(a); q += w * vec2(s, s * s / (cos(a) + 1e-3)); }
  w = V(i, 25); if (w != 0.0) { float a = rnd(seed) * r * w; float c = cos(a), s = sin(a); q += w * vec2(x * (c + s), x * (c - s)); }
  w = V(i, 26); if (w != 0.0) { float a = w * rnd(seed) * PI; float rr = w / (r2 + 1e-6); float tr = w * tan(a) * rr; q += tr * vec2(cos(x), sin(y)); }
  w = V(i, 27); if (w != 0.0) { float rr = w * r; float cr = cos(rr); float icr = 1.0 / (abs(cr) + 1e-3); q += w * vec2(x, cr < 0.0 ? -(icr + 1.0) : icr - 1.0); }
  w = V(i, 28); if (w != 0.0) { float s = min(1.0 / (abs(x * x - y * y) + 1e-4), 60.0); q += w * s * p; }
  w = V(i, 29); if (w != 0.0) q += w * vec2(sin(PRM(i, 0) * y) - cos(PRM(i, 1) * x), sin(PRM(i, 2) * x) - cos(PRM(i, 3) * y));
  w = V(i, 30); if (w != 0.0) { float pw = PRM(i, 6); float ap = max(abs(pw), 1.0); float tr = (ph + TAU * floor(rnd(seed) * ap)) / pw; float rr = w * pow(r2 + 1e-9, PRM(i, 7) / pw * 0.5); q += rr * vec2(cos(tr), sin(tr)); }
  w = V(i, 31); if (w != 0.0) q += w * vec2(x + u_aff[i * 2].z * sin(tan(3.0 * y)), y + u_aff[i * 2 + 1].z * sin(tan(3.0 * x)));
  // 32 moebius: (z + b) / (c z + 1)
  w = V(i, 32); if (w != 0.0) { vec2 b = vec2(PRM(i, 8), PRM(i, 9)); vec2 c = vec2(PRM(i, 10), PRM(i, 11)); vec2 num = p + b; vec2 den = vec2(c.x * x - c.y * y + 1.0, c.x * y + c.y * x); float dd = dot(den, den) + 1e-6; q += w * vec2(num.x * den.x + num.y * den.y, num.y * den.x - num.x * den.y) / dd; }
  // 33 rings2
  w = V(i, 33); if (w != 0.0) { float dx = PRM(i, 12) * PRM(i, 12) + 1e-6; float rr = r - 2.0 * dx * floor((r + dx) / (2.0 * dx)) + r * (1.0 - dx); q += w * rr * vec2(sin(th), cos(th)); }
  // 34 fan2
  w = V(i, 34); if (w != 0.0) { float dy = PRM(i, 14); float dx = PI * (PRM(i, 13) * PRM(i, 13) + 1e-6); float dx2 = dx * 0.5; float a = th; float tt = a + dy - dx * floor((a + dy) / dx); a += (tt > dx2) ? -dx2 : dx2; q += w * r * vec2(sin(a), cos(a)); }
  // 35 ngon
  w = V(i, 35); if (w != 0.0) { float sides = max(PRM(i, 15), 3.0); float pw = PRM(i, 16); float circle = PRM(i, 17); float corners = PRM(i, 18); float rf = pow(r2 + 1e-9, pw * 0.5); float b = TAU / sides; float phi = ph - b * floor(ph / b); if (phi > b * 0.5) phi -= b; float amp = corners * (1.0 / (cos(phi) + 1e-3) - 1.0) + circle; amp /= (rf + 1e-6); q += w * amp * p; }
  // 36 rectangles
  w = V(i, 36); if (w != 0.0) { float rx = PRM(i, 19), ry = PRM(i, 20); q += w * vec2(rx == 0.0 ? x : (2.0 * floor(x / rx) + 1.0) * rx - x, ry == 0.0 ? y : (2.0 * floor(y / ry) + 1.0) * ry - y); }
  // 37 splits
  w = V(i, 37); if (w != 0.0) q += w * vec2(x + (x >= 0.0 ? PRM(i, 21) : -PRM(i, 21)), y + (y >= 0.0 ? PRM(i, 22) : -PRM(i, 22)));
  // 38 log
  w = V(i, 38); if (w != 0.0) q += w * vec2(0.5 * log(r2 + 1e-9), ph);
  return q;
}

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(u_state, tc, 0);
  uint seed = h(uint(tc.x) * 1973u + uint(tc.y) * 9277u + uint(u_frame) * 26699u + 7u);
  float r = rnd(seed);
  int i = u_nx - 1;
  for (int k = 0; k < MAXX; k++) {
    if (k < u_nx && r < u_cw[k]) { i = k; break; }
  }
  vec2 p = s.xy;
  vec3 A = u_aff[i * 2], B = u_aff[i * 2 + 1];
  p = vec2(A.x * p.x + A.y * p.y + A.z, B.x * p.x + B.y * p.y + B.z);
  vec2 q = applyVars(i, p, seed);
  vec3 PA = u_post[i * 2], PB = u_post[i * 2 + 1];
  q = vec2(PA.x * q.x + PA.y * q.y + PA.z, PB.x * q.x + PB.y * q.y + PB.z);
  float cs = u_col[i].y;
  float c = s.z * (1.0 - cs) + u_col[i].x * cs;
  float age = s.w + 1.0;
  bool bad = any(isnan(q)) || any(isinf(q)) || dot(q, q) > 1e6;
  if (bad || rnd(seed) < 0.001) {
    q = vec2(rnd(seed), rnd(seed)) * 2.0 - 1.0;
    c = rnd(seed);
    age = 0.0;
  }
  o = vec4(q, c, min(age, 1000.0));
}`;

const DECAY_FS = `#version 300 es
precision highp float;
uniform sampler2D u_prev;
uniform float u_decay;
in vec2 v_uv;
out vec4 o;
void main() { o = texture(u_prev, v_uv) * u_decay; }`;

const SPLAT_VS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_state;
uniform sampler2D u_pal;
uniform int u_w;
uniform vec2 u_cen;
uniform float u_scale;
uniform float u_rot;
uniform float u_aspect;
uniform float u_pt;
uniform float u_fuse;
out vec3 v_col;
void main() {
  int id = gl_VertexID;
  ivec2 tc = ivec2(id % u_w, id / u_w);
  vec4 s = texelFetch(u_state, tc, 0);
  if (s.w < u_fuse) {
    gl_Position = vec4(4.0, 4.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    v_col = vec3(0.0);
    return;
  }
  vec2 p = s.xy - u_cen;
  float c = cos(u_rot), sn = sin(u_rot);
  p = vec2(c * p.x - sn * p.y, sn * p.x + c * p.y) * u_scale;
  p.x *= u_aspect;
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = u_pt;
  v_col = texture(u_pal, vec2(s.z, 0.5)).rgb;
}`;

const SPLAT_FS = `#version 300 es
precision highp float;
in vec3 v_col;
uniform float u_pt;
out vec4 o;
void main() {
  float a = 1.0;
  if (u_pt > 1.5) {
    vec2 d = gl_PointCoord - 0.5;
    a = clamp(1.2 - dot(d, d) * 5.0, 0.0, 1.0);
  }
  o = vec4(v_col * a, a);
}`;

const TONE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_acc;
uniform vec3 u_bg, u_bg2;
uniform float u_bgAngle, u_bgShift, u_bgGrad;
uniform float u_exposure, u_gamma, u_vib, u_bgMix, u_grain, u_time, u_floor;
uniform vec2 u_res;
uniform float u_deBlur;
in vec2 v_uv;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec4 a0 = textureLod(u_acc, v_uv, 0.0);
  vec4 a = a0;
  if (u_deBlur > 0.0) {
    // Density estimation on the cheap: the accumulation buffer has
    // mipmaps, so a blurrier level is one fetch away. Thin areas read a
    // wide level, dense areas read the sharp one.
    vec4 b1 = textureLod(u_acc, v_uv, 1.0);
    float dens = max(b1.a, a0.a);
    float k = clamp(dens / (16.0 * u_deBlur), 0.0, 1.0);
    float lod = mix(3.2, 0.0, smoothstep(0.0, 1.0, k)) * min(u_deBlur * 1.25, 1.4);
    a = textureLod(u_acc, v_uv, lod);
  }
  // Background: soft blobs of the second color (and a third derived from
  // both) drifting over the first, so it reads as a shifting cloud rather
  // than a flat gradient.
  vec2 c = (v_uv - 0.5) * vec2(1.333, 1.0);
  vec3 bg3 = mix(u_bg, u_bg2, 0.5) * 1.25 + vec3(0.02);
  vec3 bgc = u_bg;
  float s = u_bgShift;
  // A slow flow bends the blobs like colored smoke, so the background is
  // never a still picture. Gentle and low-contrast: nothing here flickers.
  c += 0.08 * vec2(sin(c.y * 4.3 + s * 1.9) + 0.5 * sin(c.y * 9.1 - s * 1.3),
                   cos(c.x * 3.7 - s * 1.6) + 0.5 * cos(c.x * 8.3 + s * 1.1));
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float a = u_bgAngle + fi * 1.7;
    vec2 ctr = 0.42 * vec2(sin(s * (0.7 + fi * 0.13) + a), cos(s * (0.55 + fi * 0.11) + a * 1.3));
    float r = 0.28 + 0.12 * sin(s * 0.4 + fi * 2.1);
    float d = length(c - ctr) / r;
    float w = exp(-d * d) * u_bgGrad;
    bgc = mix(bgc, (i % 2 == 0) ? u_bg2 : bg3, w);
  }
  // Noise floor: pixels with only a stray hit or two fade out instead of
  // speckling the whole frame.
  float cnt = a.a * smoothstep(u_floor * 0.5, u_floor * 1.5, a.a);
  float d = cnt * u_exposure;
  float lum = log(1.0 + d);
  vec3 avg = cnt > 0.0 ? a.rgb / cnt : vec3(0.0);
  float g = 1.0 / u_gamma;
  vec3 colG = pow(max(avg * lum, 0.0), vec3(g));
  float lumG = pow(lum, g);
  // Cap the brightness multiplier so dense areas stay the palette's hue
  // instead of bleaching to white; a soft roll-off handles the rest.
  vec3 col = mix(colG, avg * min(lumG, 1.9), u_vib);
  // Hue-preserving roll-off: scale the whole color by how its brightest
  // channel compresses, so a dense pink core brightens to pink, not white.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.0) col *= (1.0 - exp(-m * 1.5)) / m;
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.3);
  float alpha = clamp(lumG, 0.0, 1.0);
  vec3 outc = bgc * (1.0 - alpha * u_bgMix) + col;
  // Grain multiplies, so it is texture in the image's own color, not white dust.
  outc *= 1.0 + (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) * u_grain * 2.5;
  o = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`;

const STATS_FS = `#version 300 es
precision highp float;
uniform sampler2D u_acc;
uniform float u_exposure, u_floor;
in vec2 v_uv;
out vec4 o;
void main() {
  // Average density over the source cell (a few taps is enough), with the
  // same noise floor the tonemap applies so exposure sees what is drawn.
  float sum = 0.0;
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    vec2 uv = v_uv + (vec2(i, j) - 1.0) * (1.0 / ${STATS_SIZE}.0) * 0.3;
    float c = texture(u_acc, uv).a;
    sum += c * smoothstep(u_floor * 0.5, u_floor * 1.5, c);
  }
  float d = clamp(log(1.0 + (sum / 9.0) * u_exposure) / 3.0, 0.0, 1.0);
  o = vec4(d, 0.0, 0.0, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("shader compile failed: " + info);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("program link failed: " + gl.getProgramInfoLog(p));
  }
  return p;
}

function uniforms(gl, prog, names) {
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return u;
}

export class FlameRenderer {
  /**
   * `pointSide` is the point texture's side to start with (points = side squared). The
   * show passes the one its settings ask for, so the state is not made twice at boot.
   */
  constructor(canvas, width, height, onContextLost, log, pointSide = 512) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.log = log || (() => {});
    canvas.width = width;
    canvas.height = height;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      onContextLost();
    });
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    this.floatExt = gl.getExtension("EXT_color_buffer_float");
    this.halfExt = this.floatExt ? null : gl.getExtension("EXT_color_buffer_half_float");
    if (!this.floatExt && !this.halfExt) {
      throw new Error("no float render targets (EXT_color_buffer_float)");
    }
    this.stateFormat = this.floatExt ? gl.RGBA32F : gl.RGBA16F;
    this.log(`flame renderer: ${this.floatExt ? "RGBA32F" : "RGBA16F"} state, RGBA16F accumulation`);

    this.pIter = program(gl, QUAD_VS, ITER_FS);
    this.uIter = uniforms(gl, this.pIter, [
      "u_state", "u_frame", "u_nx", "u_cw", "u_aff", "u_post", "u_col", "u_var", "u_prm",
    ]);
    this.pDecay = program(gl, QUAD_VS, DECAY_FS);
    this.uDecay = uniforms(gl, this.pDecay, ["u_prev", "u_decay"]);
    this.pSplat = program(gl, SPLAT_VS, SPLAT_FS);
    this.uSplat = uniforms(gl, this.pSplat, [
      "u_state", "u_pal", "u_w", "u_cen", "u_scale", "u_rot", "u_aspect", "u_pt", "u_fuse",
    ]);
    this.pTone = program(gl, QUAD_VS, TONE_FS);
    this.uTone = uniforms(gl, this.pTone, [
      "u_acc", "u_bg", "u_bg2", "u_bgAngle", "u_bgShift", "u_bgGrad",
      "u_exposure", "u_gamma", "u_vib", "u_bgMix", "u_grain", "u_time", "u_floor",
      "u_res", "u_deBlur",
    ]);
    this.pStats = program(gl, QUAD_VS, STATS_FS);
    this.uStats = uniforms(gl, this.pStats, ["u_acc", "u_exposure", "u_floor"]);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // Palette texture.
    this.palTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.palTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.palBytes = new Uint8Array(PALETTE_SIZE * 4);

    // Accumulation ping-pong (mipmapped so the tonemap can read blurred levels).
    this.acc = [this.makeTarget(width, height, gl.RGBA16F), this.makeTarget(width, height, gl.RGBA16F)];
    for (const t of this.acc) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    this.accIdx = 0;

    // Stats target, read back through a buffer so the page never waits for the GPU
    // (see readStats); `statsSync` is the fence of a read in flight.
    this.stats = this.makeTarget(STATS_SIZE, STATS_SIZE, gl.RGBA8);
    this.statsBytes = new Uint8Array(STATS_SIZE * STATS_SIZE * 4);
    this.statsPbo = gl.createBuffer();
    this.statsSync = null;
    this.statsWait = 0;
    this.lastStats = null;
    this.statsFallbacks = 0; // times the fence was too slow and the page waited

    // Uniform scratch.
    this.cw = new Float32Array(MAX_XFORMS);
    this.aff = new Float32Array(MAX_XFORMS * 6);
    this.post = new Float32Array(MAX_XFORMS * 6);
    this.col = new Float32Array(MAX_XFORMS * 2);
    this.varBuf = new Float32Array(MAX_XFORMS * NVAR);
    this.prm = new Float32Array(MAX_XFORMS * NPRM);

    this.frame = 0;
    this.texW = 0;
    this.setPointTexture(pointSide);
  }

  makeTarget(w, h, internal) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const type = internal === gl.RGBA8 ? gl.UNSIGNED_BYTE : gl.FLOAT;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`framebuffer incomplete (${status}) for format ${internal}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  /** Point count = size*size. Re-creates the state textures. */
  setPointTexture(size) {
    size = Math.max(64, Math.min(1024, Math.round(size / 64) * 64));
    if (size === this.texW) return;
    const gl = this.gl;
    if (this.state) {
      for (const t of this.state) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
    }
    this.texW = size;
    this.pointCount = size * size;
    const init = new Float32Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      init[i * 4] = Math.random() * 2 - 1;
      init[i * 4 + 1] = Math.random() * 2 - 1;
      init[i * 4 + 2] = Math.random();
      init[i * 4 + 3] = 0;
    }
    this.state = [];
    for (let k = 0; k < 2; k++) {
      const t = this.makeTarget(size, size, this.stateFormat);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, this.stateFormat, size, size, 0, gl.RGBA, gl.FLOAT, init);
      this.state.push(t);
    }
    this.stateIdx = 0;
    this.log(`flame points: ${this.pointCount}`);
  }

  uploadGenome(g) {
    const gl = this.gl;
    const nx = cumulativeWeights(g, this.cw) > 0 ? g.xforms.filter((x) => x.weight > 0).length : 1;
    for (let i = 0; i < MAX_XFORMS; i++) {
      const x = g.xforms[i];
      this.aff.set(x.aff, i * 6);
      this.post.set(x.post, i * 6);
      this.col[i * 2] = x.color;
      this.col[i * 2 + 1] = x.colorSpeed;
      this.varBuf.set(x.vars, i * NVAR);
      this.prm.set(x.prm, i * NPRM);
    }
    gl.useProgram(this.pIter);
    gl.uniform1i(this.uIter.u_nx, Math.max(1, nx));
    gl.uniform1fv(this.uIter.u_cw, this.cw);
    gl.uniform3fv(this.uIter.u_aff, this.aff);
    gl.uniform3fv(this.uIter.u_post, this.post);
    gl.uniform2fv(this.uIter.u_col, this.col);
    gl.uniform4fv(this.uIter.u_var, this.varBuf);
    gl.uniform4fv(this.uIter.u_prm, this.prm);

    for (let i = 0; i < PALETTE_SIZE; i++) {
      this.palBytes[i * 4] = Math.round(Math.min(1, Math.max(0, g.palette[i * 3])) * 255);
      this.palBytes[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, g.palette[i * 3 + 1])) * 255);
      this.palBytes[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, g.palette[i * 3 + 2])) * 255);
      this.palBytes[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.palTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.palBytes);
  }

  /**
   * @param {object} g     genome (from FlameAnimator.update)
   * @param {object} cam   { cx, cy, scale, rot } final camera (auto-frame applied)
   * @param {object} o     { iters, decay, exposure, gamma, vibrancy, bgMix,
   *                          pointSize, grain, time }
   */
  draw(g, cam, o) {
    const gl = this.gl;
    this.uploadGenome(g);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    // Decay pass into the other accumulation buffer.
    const prev = this.acc[this.accIdx];
    const next = this.acc[1 - this.accIdx];
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.pDecay);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.uniform1i(this.uDecay.u_prev, 0);
    gl.uniform1f(this.uDecay.u_decay, o.decay);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const iters = Math.max(1, Math.min(8, Math.round(o.iters)));
    for (let k = 0; k < iters; k++) {
      // Iterate points.
      const src = this.state[this.stateIdx];
      const dst = this.state[1 - this.stateIdx];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, this.texW, this.texW);
      gl.useProgram(this.pIter);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.uIter.u_state, 0);
      gl.uniform1f(this.uIter.u_frame, this.frame++);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.stateIdx = 1 - this.stateIdx;

      // Splat points additively.
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.pSplat);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dst.tex);
      gl.uniform1i(this.uSplat.u_state, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.palTex);
      gl.uniform1i(this.uSplat.u_pal, 1);
      gl.uniform1i(this.uSplat.u_w, this.texW);
      gl.uniform2f(this.uSplat.u_cen, cam.cx, cam.cy);
      gl.uniform1f(this.uSplat.u_scale, cam.scale);
      gl.uniform1f(this.uSplat.u_rot, cam.rot);
      gl.uniform1f(this.uSplat.u_aspect, this.height / this.width);
      gl.uniform1f(this.uSplat.u_pt, o.pointSize);
      gl.uniform1f(this.uSplat.u_fuse, 12);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, this.pointCount);
      gl.disable(gl.BLEND);
    }
    this.accIdx = 1 - this.accIdx;

    // Blurred levels for the density blur.
    if ((o.deBlur ?? 0) > 0) {
      gl.bindTexture(gl.TEXTURE_2D, next.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    // Tonemap to screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.pTone);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, next.tex);
    gl.uniform1i(this.uTone.u_acc, 0);
    gl.uniform3fv(this.uTone.u_bg, g.bg);
    gl.uniform3fv(this.uTone.u_bg2, g.bg2 || g.bg);
    gl.uniform1f(this.uTone.u_bgAngle, g.bgAngle || 0);
    gl.uniform1f(this.uTone.u_bgShift, g.bgShift || 0);
    gl.uniform1f(this.uTone.u_bgGrad, o.bgGradient ?? 0.7);
    gl.uniform1f(this.uTone.u_exposure, o.exposure);
    gl.uniform1f(this.uTone.u_gamma, o.gamma);
    gl.uniform1f(this.uTone.u_vib, o.vibrancy);
    gl.uniform1f(this.uTone.u_bgMix, o.bgMix);
    gl.uniform1f(this.uTone.u_grain, o.grain);
    gl.uniform1f(this.uTone.u_time, o.time);
    gl.uniform1f(this.uTone.u_floor, o.floor ?? 0);
    gl.uniform2f(this.uTone.u_res, this.width, this.height);
    gl.uniform1f(this.uTone.u_deBlur, o.deBlur ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draw the 32 x 32 density picture of the accumulation buffer; leaves its target bound. */
  drawStats(exposure, floor) {
    const gl = this.gl;
    const acc = this.acc[this.accIdx];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stats.fbo);
    gl.viewport(0, 0, STATS_SIZE, STATS_SIZE);
    gl.useProgram(this.pStats);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, acc.tex);
    // Shrinking the image to 32x32 makes the GPU sample its blurred
    // (mipmap) levels. draw() only rebuilds those when the density blur is
    // on, so rebuild them here or the reading is all zeros with the blur
    // off, and every design looks dead.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(this.uStats.u_acc, 0);
    gl.uniform1f(this.uStats.u_exposure, exposure);
    gl.uniform1f(this.uStats.u_floor, floor);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Start a stats read that does not wait: the pixels go into a buffer on the GPU and a
   * fence says when they are there. pollStats picks them up on a later frame.
   */
  startStats(exposure, floor) {
    const gl = this.gl;
    this.drawStats(exposure, floor);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.statsPbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.statsBytes.byteLength, gl.STREAM_READ);
    gl.readPixels(0, 0, STATS_SIZE, STATS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.statsSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.statsWait = 0;
    gl.flush();
  }

  /** Read the stats now, waiting for the GPU: the first time, and when a fence is too slow. */
  readStatsNow(exposure, floor) {
    const gl = this.gl;
    this.dropStats();
    this.drawStats(exposure, floor);
    gl.readPixels(0, 0, STATS_SIZE, STATS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, this.statsBytes);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lastStats = this.summarizeStats();
  }

  /** Forget a read in flight. */
  dropStats() {
    if (!this.statsSync) return;
    this.gl.deleteSync(this.statsSync);
    this.statsSync = null;
  }

  /**
   * Once a frame: if the GPU has finished the read in flight, take its numbers.
   * Costs a fence check, never a wait. Returns true when new numbers arrived.
   */
  pollStats() {
    if (!this.statsSync) return false;
    const gl = this.gl;
    const status = gl.clientWaitSync(this.statsSync, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) {
      this.statsWait++;
      return false;
    }
    if (status === gl.WAIT_FAILED) {
      this.statsWait = STATS_STALL; // readStats will read the waiting way
      return false;
    }
    this.dropStats();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.statsPbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.statsBytes);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.lastStats = this.summarizeStats();
    return true;
  }

  /**
   * The density reading: { cx, cy, spread, coverage, level, p90 } in normalized device
   * coords. Called every few dozen frames. The numbers are from the read started the
   * time before (half a second old at 60 fps; the auto-framing does not mind), so the
   * page never stalls on the GPU; a new read is started each time. The first call, and
   * any time a read has not finished within STATS_STALL frames, reads the old waiting
   * way, so the reading can never go dead.
   */
  readStats(exposure, floor = 0) {
    this.pollStats();
    if (this.lastStats === null || (this.statsSync && this.statsWait >= STATS_STALL)) {
      if (this.lastStats !== null) this.statsFallbacks++;
      this.readStatsNow(exposure, floor);
    }
    if (!this.statsSync) this.startStats(exposure, floor);
    return this.lastStats;
  }

  /** The numbers in statsBytes: where the density is, how spread, how much of the frame. */
  summarizeStats() {
    let total = 0;
    let sx = 0;
    let sy = 0;
    let covered = 0;
    let rawSum = 0;
    const hist = new Uint16Array(32);
    const n = STATS_SIZE;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const raw = this.statsBytes[(j * n + i) * 4] / 255;
        if (raw > 0.02) {
          covered++;
          rawSum += raw;
          hist[Math.min(31, Math.floor(raw * 32))]++;
        }
        const d = raw * raw;
        const x = ((i + 0.5) / n) * 2 - 1;
        const y = ((j + 0.5) / n) * 2 - 1;
        total += d;
        sx += d * x;
        sy += d * y;
      }
    }
    if (total < 1e-4) return { cx: 0, cy: 0, spread: 0, coverage: 0, level: 0, p90: 0 };
    const cx = sx / total;
    const cy = sy / total;
    let var2 = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const raw = this.statsBytes[(j * n + i) * 4] / 255;
        const d = raw * raw;
        const x = ((i + 0.5) / n) * 2 - 1;
        const y = ((j + 0.5) / n) * 2 - 1;
        var2 += d * ((x - cx) * (x - cx) + (y - cy) * (y - cy));
      }
    }
    // 90th percentile of density over covered cells: what the bright
    // parts are doing, so dense cores don't get pushed into white.
    let p90 = 0;
    if (covered) {
      let acc = 0;
      for (let b = 0; b < 32; b++) {
        acc += hist[b];
        if (acc >= covered * 0.95) {
          p90 = (b + 0.5) / 32;
          break;
        }
      }
    }
    return {
      cx,
      cy,
      spread: Math.sqrt(var2 / total),
      coverage: covered / (n * n),
      level: covered ? rawSum / covered : 0,
      p90,
    };
  }
}
