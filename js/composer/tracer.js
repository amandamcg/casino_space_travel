// Room composer: draws the room from one point of view on the graphics card.
// For every pixel it follows a line of sight through the room: off mirrors
// (many bounces deep) until it lands on a wall or an object, then works out
// how much projector light reaches that spot, directly or by way of one mirror.
//
// It is a sketch, not a photograph: surfaces are plain matte, and light that
// bounces off walls is one even glow (uAmbient).

import { MAX_SEGMENTS } from "./cables.js";
import { BALL, MAX_BALLS, MAX_BOXES, MAX_DISCS, MAX_LAVA, MAX_MIRRORS, MAX_PROJECTORS, MAX_REGIONS_DRAWN, MAX_SPOTS, OUTLINE_SLICES, PATH_STEPS } from "./scene.js";
import { rockFile, rockFrame } from "../mapping.js";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
#define MAXB ${MAX_BOXES}
#define MAXM ${MAX_MIRRORS}
#define MAXD ${MAX_DISCS}
#define MAXL ${MAX_LAVA}
#define MAXK ${MAX_BALLS}
#define TILE ${BALL.tile.toFixed(3)}  // a disco ball's mirror tiles, this wide
#define PATHN ${PATH_STEPS + 1}
#define CABLEN ${MAX_SEGMENTS}
#define MAXS ${MAX_SPOTS}
#define MAXP ${MAX_PROJECTORS}
#define MAXI ${MAX_PROJECTORS * MAX_MIRRORS}
#define MAXR ${MAX_REGIONS_DRAWN}
#define SLICES ${OUTLINE_SLICES}
#define BOUNCES 12
#define PI 3.14159265
#define KEEP 0.9          // share of light a mirror returns
#define BLACK 0.0015      // a projector's black still leaks this share of white
out vec4 outColor;

uniform vec2 uRes;
uniform vec3 uEye, uF, uR, uU;
uniform float uTan;
uniform vec3 uRoom, uWall, uCeil, uFloor, uAmbient;
uniform float uExposure;
uniform float uRoomLight;      // above 0: the room's own lights are on (projectors off)
uniform float uTime;           // seconds, for the lava lamps' slow wax
uniform float uFade;           // 1: the picture gone to black (the walkthrough's curtain)
uniform int uBounces;          // how many times a ray may bounce off mirrors
uniform float uQuick;          // 0: fine; 1: lava lamps cast no shadows; 2: lava lamps give no light
uniform int uNPath;            // points of the path on the floor (0: none)
uniform vec2 uPathPts[PATHN];
uniform vec3 uPathSpec;        // half width
uniform vec3 uPathCol;
uniform int uNCable;           // straight pieces of cable on the floor, shown with the room lights on
uniform highp sampler2D uCables;  // highp: the texels hold inches, not 0..1. One texel a piece: x1, y1, x2, y2 in the top row; its kind in the next (0 HDMI, 1 mains, 2 USB, 3 audio)
uniform sampler2D uStill;
uniform sampler2D uSpotStill;  // the picture mapped onto the spots, different from the walls
uniform sampler2D uCard;       // the words on the message card
uniform sampler2D uToy;        // the photo of the toy: left half the base, right half with the wheel
uniform vec4 uToyFrame;        // the pedestal: x, y, cos and sin of its turn
uniform vec4 uToyRect;         // where the photo lies in the pedestal's frame: x, y, width, height
uniform vec3 uLampPos, uLampDir, uLampPower;   // the book light over the card

uniform int uNBox;
uniform vec3 uBoxMin[MAXB];
uniform vec3 uBoxMax[MAXB];
uniform vec3 uBoxCol[MAXB];
uniform vec2 uBoxKind[MAXB];   // x: 0 matte, 1 projector lens, 2 message card, 3 toy base, 4 toy wheel, 5 curtain; y: which projector
uniform vec4 uBoxTurn[MAXB];   // a box spun about a vertical line: x, y of the line, cos, sin

uniform int uNDisc;            // round flat things: the steering wheel's rim and hub
uniform vec4 uDiscA[MAXD];     // centre x, y, bottom, top
uniform vec4 uDiscR[MAXD];     // outer radius, inner radius (a ring when above zero), glows (1: lit glass, not shaded)
uniform int uNLava;            // lava lamps: light from the middle of each glass, all round
uniform vec4 uLavaPos[MAXL];   // x, y, z, radius of the glass
uniform vec3 uLavaCol[MAXL];   // light given off, per steradian
uniform vec3 uDiscCol[MAXD];

uniform int uNSpot;            // rocks on the walls: half ellipsoids, flat side on the wall
uniform vec3 uSpotC[MAXS];     // middle of the end on the wall
uniform vec3 uSpotN[MAXS];     // the way it sticks out
uniform vec3 uSpotS[MAXS];     // radius at the wall, radius of the cloth end, how far it sticks out
uniform vec3 uCloth;
uniform sampler2D uRocks;      // the scanned rocks, in a grid on one texture
uniform vec2 uRockGrid;        // columns and rows of that grid
uniform float uSpotRock[MAXS]; // which rock is projected onto each spot; below 0 for a piece of the picture
uniform vec4 uRockFit[25];     // where each rock sits in its scan: x, y, width, height as fractions
uniform float uSpotRockB[MAXS]; // the rock a spot is fading to, in the live show
uniform float uSpotRockMix[MAXS]; // how far along that fade is, 0 to 1
uniform vec4 uSpotLookA[MAXS]; // a spot's look: zoom, slide across, slide down, colour turn (radians)
uniform vec4 uSpotLookB[MAXS]; // the picture's turn (radians), mirror and cover across and down, opposite colours

uniform int uNMir;
uniform vec3 uMirC[MAXM];      // middle of the bottom edge
uniform vec3 uMirN[MAXM];      // the way the shiny side faces (tips up when the mirror leans)
uniform vec4 uMirS[MAXM];      // half width, height of the glass, width of the frame round it (0: none), bulge of a convex one (0: flat)

uniform int uNBall;
uniform vec4 uBall[MAXK];      // a disco ball: its middle x, y, z and its radius

uniform int uNProj;
uniform vec3 uPPos[MAXP];
uniform vec3 uPF[MAXP];
uniform vec3 uPR[MAXP];
uniform vec3 uPU[MAXP];
uniform vec4 uPSpec[MAXP];     // throw ratio, lumens, picture height / width, 1 if its background is mirrored
uniform float uPWin[MAXP];     // which part of a wide still this projector shows (0, 1, ...)
uniform float uStillN;         // how many projectors wide the still is (1: every projector shows all of it)
uniform float uSpotStillN;     // the same for the spots' picture
uniform float uPLift[MAXP];    // how far above the aim the picture's middle is, as a share of its height

// What the show gives each projector besides the plain picture: an oval for each spot.
uniform int uNReg;
uniform vec4 uRegA[MAXR];      // the wide end's oval: middle and first arm, in picture units (-1 to 1)
uniform vec4 uRegB[MAXR];      // its second arm; projector x 100 + spot + 1 (+ 0: black); fit size (0: plain oval)
uniform vec4 uRegC[MAXR];      // the cloth end's oval: middle and first arm
uniform vec4 uRegD[MAXR];      // its second arm; the middle the picture is fitted on

uniform int uNImg;             // projectors as seen in mirrors
uniform vec3 uIPos[MAXI];
uniform vec3 uIF[MAXI];
uniform vec3 uIR[MAXI];
uniform vec3 uIU[MAXI];
uniform vec3 uIReal[MAXI];
uniform vec4 uISpec[MAXI];     // throw ratio, lumens, picture height / width, which mirror
uniform float uIProj[MAXI];    // which projector this is the mirror image of

vec3 safe(vec3 d) {
  // A direction with an exact zero in it breaks the divisions below.
  return d + vec3(1e-6) * (1.0 - step(vec3(1e-6), abs(d)));
}

bool hitBox(vec3 o, vec3 d, vec3 bmin, vec3 bmax, float tmax, out float t, out vec3 n) {
  vec3 inv = 1.0 / d;
  vec3 a = (bmin - o) * inv;
  vec3 b = (bmax - o) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  float t0 = max(max(lo.x, lo.y), lo.z);
  float t1 = min(min(hi.x, hi.y), hi.z);
  if (t0 > t1 || t0 < 1e-3 || t0 > tmax) return false;
  t = t0;
  if (lo.x >= lo.y && lo.x >= lo.z) n = vec3(-sign(d.x), 0.0, 0.0);
  else if (lo.y >= lo.z) n = vec3(0.0, -sign(d.y), 0.0);
  else n = vec3(0.0, 0.0, -sign(d.z));
  return true;
}

// Box number i, which may be spun: turn the ray the other way, test the box where it sat
// before, then turn the surface direction back.
bool hitSolid(vec3 o, vec3 d, int i, float tmax, out float t, out vec3 n) {
  vec4 q = uBoxTurn[i];
  if (q.w == 0.0) return hitBox(o, d, uBoxMin[i], uBoxMax[i], tmax, t, n);
  vec2 po = o.xy - q.xy;
  vec3 lo = vec3(q.z * po.x + q.w * po.y + q.x, -q.w * po.x + q.z * po.y + q.y, o.z);
  vec3 ld = safe(vec3(q.z * d.x + q.w * d.y, -q.w * d.x + q.z * d.y, d.z));
  if (!hitBox(lo, ld, uBoxMin[i], uBoxMax[i], tmax, t, n)) return false;
  n = vec3(q.z * n.x - q.w * n.y, q.w * n.x + q.z * n.y, n.z);
  return true;
}

// A flat ring or disc lying level: its top face and its outer edge.
bool hitDisc(vec3 o, vec3 d, int i, float tmax, out float t, out vec3 n) {
  vec4 a = uDiscA[i];
  vec2 r = uDiscR[i].xy;
  bool found = false;
  t = tmax;
  if (d.z < 0.0) {
    float tt = (a.w - o.z) / d.z;
    if (tt > 1e-3 && tt < t) {
      vec2 q = o.xy + d.xy * tt - a.xy;
      float rr = dot(q, q);
      if (rr <= r.x * r.x && rr >= r.y * r.y) {
        t = tt;
        n = vec3(0.0, 0.0, 1.0);
        found = true;
      }
    }
  }
  vec2 oc = o.xy - a.xy;
  float qa = dot(d.xy, d.xy);
  float qb = 2.0 * dot(oc, d.xy);
  float qc = dot(oc, oc) - r.x * r.x;
  float disc = qb * qb - 4.0 * qa * qc;
  if (qa > 1e-9 && disc >= 0.0) {
    float tt = (-qb - sqrt(disc)) / (2.0 * qa);
    float z = o.z + d.z * tt;
    if (tt > 1e-3 && tt < t && z >= a.z && z <= a.w) {
      t = tt;
      n = vec3(normalize(o.xy + d.xy * tt - a.xy), 0.0);
      found = true;
    }
  }
  return found;
}

// A rock: the front half of an ellipsoid on the wall, s = (half its width, half its
// height, how far out it comes). In those units it is the unit sphere, so the ray is
// scaled into them. The same sums are in scene.js (hitSpot), where they are tested.
bool hitSpot(vec3 o, vec3 d, int i, float tmax, out float t, out vec3 n) {
  vec3 ax = uSpotN[i];
  vec3 s = uSpotS[i];
  vec3 edge = vec3(-ax.y, ax.x, 0.0);
  vec3 oc = o - uSpotC[i];
  vec3 P = vec3(dot(oc, edge) / s.x, oc.z / s.y, dot(oc, ax) / s.z);
  vec3 D = vec3(dot(d, edge) / s.x, d.z / s.y, dot(d, ax) / s.z);
  float qa = dot(D, D);
  float qb = 2.0 * dot(P, D);
  float qc = dot(P, P) - 1.0;
  float disc = qb * qb - 4.0 * qa * qc;
  if (qa < 1e-12 || disc < 0.0) return false;
  float sq = sqrt(disc);
  for (int j = 0; j < 2; j++) {
    float tt = (-qb + (j == 0 ? -sq : sq)) / (2.0 * qa);
    if (tt <= 1e-3 || tt >= tmax) continue;
    vec3 q = P + D * tt;
    if (q.z < 0.0) continue; // the half inside the wall
    t = tt;
    n = normalize(edge * (q.x / s.x) + vec3(0.0, 0.0, q.y / s.y) + ax * (q.z / s.z));
    return true;
  }
  return false;
}

// A disco ball: a ball of little square mirror tiles. n is the tile's own normal, the
// ball's snapped to rows and columns about TILE in apart, so the ball throws the room
// back in pieces, each tile a different piece.
bool hitBall(vec3 o, vec3 d, int i, float tmax, out float t, out vec3 n) {
  vec4 b = uBall[i];
  vec3 oc = o - b.xyz;
  float qb = 2.0 * dot(oc, d);
  float qc = dot(oc, oc) - b.w * b.w;
  float disc = qb * qb - 4.0 * qc;
  if (disc < 0.0) return false;
  float tt = (-qb - sqrt(disc)) / 2.0;
  if (tt <= 1e-3 || tt >= tmax) return false;
  t = tt;
  vec3 m = normalize(oc + d * tt);
  float step = TILE / b.w;   // one tile, as an angle round the ball
  float lat = floor(asin(clamp(m.z, -1.0, 1.0)) / step + 0.5) * step;
  float lon = floor(atan(m.y, m.x) / step + 0.5) * step;
  n = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  if (dot(n, d) >= 0.0) n = m;   // a tile turned away from the ray: the ball's own curve instead
  return true;
}

// Is this point in the mirror's plane on its glass (grow = 0), or on the glass or its frame (grow = frame width)?
bool onMirror(vec3 p, int i, float grow) {
  vec3 n = uMirN[i];
  vec3 edge = normalize(vec3(-n.y, n.x, 0.0));   // along the bottom edge
  vec3 up = cross(n, edge);                      // up the glass
  vec3 q = p - uMirC[i];
  float along = dot(q, up);
  return abs(dot(q, edge)) <= uMirS[i].x + grow && along >= -grow && along <= uMirS[i].y + grow;
}

bool onMirror(vec3 p, int i) {
  return onMirror(p, i, 0.0);
}

// A mirror, glass or frame. rim says the hit is on the frame, not the glass; mn is the
// glass's normal where it was hit (the mirror's own, unless it bulges).
bool hitMirror(vec3 o, vec3 d, int i, float tmax, out float t, out bool front, out bool rim, out vec3 mn) {
  vec3 pn = uMirN[i];
  mn = pn;
  float den = dot(d, pn);
  if (abs(den) < 1e-6) return false;
  float bulge = uMirS[i].w;
  if (bulge > 0.0 && den < 0.0) {
    // A convex mirror seen from the front: the cap of a ball through its corners, the
    // middle 'bulge' in proud of the edge (mirrorBulge in scene.js does the same sums).
    vec3 edge = normalize(vec3(-pn.y, pn.x, 0.0));
    vec3 up = cross(pn, edge);
    float reach2 = uMirS[i].x * uMirS[i].x + 0.25 * uMirS[i].y * uMirS[i].y;
    float R = (reach2 + bulge * bulge) / (2.0 * bulge);
    vec3 C = uMirC[i] + up * (0.5 * uMirS[i].y) + pn * (bulge - R);
    vec3 oc = o - C;
    float qb = 2.0 * dot(oc, d);
    float qc = dot(oc, oc) - R * R;
    float disc = qb * qb - 4.0 * qc;
    if (disc < 0.0) return false;
    t = (-qb - sqrt(disc)) / 2.0;
    if (t < 1e-3 || t > tmax) return false;
    vec3 p = o + d * t;
    if (dot(p - uMirC[i], pn) < 0.0 || !onMirror(p, i)) return false;
    mn = normalize(p - C);
    rim = false;
    front = true;
    return true;
  }
  t = dot(uMirC[i] - o, pn) / den;
  if (t < 1e-3 || t > tmax) return false;
  vec3 p = o + d * t;
  if (!onMirror(p, i, uMirS[i].z)) return false;
  rim = !onMirror(p, i);
  front = den < 0.0;
  return true;
}

bool hitMirror(vec3 o, vec3 d, int i, float tmax, out float t, out bool front) {
  bool rim;
  vec3 mn;
  return hitMirror(o, d, i, tmax, t, front, rim, mn);
}

// Is anything in the way between two points? skip: a mirror to ignore.
bool blocked(vec3 a, vec3 b, int skip) {
  vec3 d = b - a;
  float dist = length(d);
  if (dist < 1e-4) return false;
  d = safe(d / dist);
  float t;
  vec3 n;
  bool front;
  for (int i = 0; i < MAXB; i++) {
    if (i >= uNBox) break;
    if (uBoxKind[i].x > 0.5 && uBoxKind[i].x < 1.5) continue;   // a lens does not block its own light
    if (hitSolid(a, d, i, dist - 0.05, t, n)) return true;
  }
  for (int i = 0; i < MAXD; i++) {
    if (i >= uNDisc) break;
    if (hitDisc(a, d, i, dist - 0.05, t, n)) return true;
  }
  for (int i = 0; i < MAXS; i++) {
    if (i >= uNSpot) break;
    if (hitSpot(a, d, i, dist - 0.05, t, n)) return true;
  }
  for (int i = 0; i < MAXM; i++) {
    if (i >= uNMir) break;
    if (i == skip) continue;
    if (hitMirror(a, d, i, dist - 0.05, t, front)) return true;
  }
  for (int i = 0; i < MAXK; i++) {
    if (i >= uNBall) break;
    if (hitBall(a, d, i, dist - 0.05, t, n)) return true;
  }
  return false;
}

// What spot i's look shows at uv (0 to 1 across the picture, v upward): its own piece of
// the picture, coloured its own way. These are the show's sums for a mapped region (regions.js, and lookSource in scene.js, which is
// tested): crop, mirror, turn; then the colour filters, opposite colours before the turn.
// Rock which at sq, 0 to 1 across the square an oval takes from the picture, v upward.
vec3 rockPic(int which, vec2 sq) {
  vec4 fit = uRockFit[which];
  vec2 inPic = vec2(fit.x + sq.x * fit.z, fit.y + (1.0 - sq.y) * fit.w);
  float col = mod(float(which), uRockGrid.x);
  float row = floor(float(which) / uRockGrid.x);
  return texture(uRocks, vec2((inPic.x + col) / uRockGrid.x, (inPic.y + row) / uRockGrid.y)).rgb;
}

vec3 spotPaint(vec2 uv, int i, int proj) {
  if (uSpotRock[i] >= 0.0) {
    // The rock projected, plain (Amanda, 2026-10-07): the show paints the rock's scan,
    // cropped to its outline, over the whole of what the oval takes from the picture, so
    // it fills the oval edge to edge; and it cross-fades to another rock when its set
    // takes a new look.
    vec2 sq = clamp(uv, 0.0, 1.0);
    vec3 now = rockPic(int(uSpotRock[i] + 0.5), sq);
    float m = uSpotRockMix[i];
    if (m <= 0.0) return now;
    return mix(now, rockPic(int(uSpotRockB[i] + 0.5), sq), m);
  }
  vec4 a = uSpotLookA[i];
  vec4 b = uSpotLookB[i];
  vec2 size = vec2(1024.0, 768.0);
  vec2 p = vec2(uv.x - 0.5, 0.5 - uv.y) * size;
  float c = cos(b.x);
  float s = sin(b.x);
  vec2 d = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) / b.yz;
  vec2 src = vec2((1.0 - 1.0 / a.x) * 0.5) * (1.0 + a.yz) + (d / size + 0.5) / a.x;
  if (uSpotStillN > 1.5) src.x = (src.x + min(uPWin[proj], uSpotStillN - 1.0)) / uSpotStillN;   // its projector's part of a wide picture
  vec3 col = texture(uSpotStill, vec2(src.x, 1.0 - src.y)).rgb;
  if (b.w > 0.5) col = 1.0 - col;
  float hc = cos(a.w);
  float hs = sin(a.w);
  mat3 turn = mat3(
    0.213 + hc * 0.787 - hs * 0.213, 0.213 - hc * 0.213 + hs * 0.143, 0.213 - hc * 0.213 - hs * 0.787,
    0.715 - hc * 0.715 - hs * 0.715, 0.715 + hc * 0.285 + hs * 0.140, 0.715 - hc * 0.715 + hs * 0.715,
    0.072 - hc * 0.072 + hs * 0.928, 0.072 - hc * 0.072 - hs * 0.283, 0.072 + hc * 0.928 + hs * 0.072);
  return clamp(turn * col, 0.0, 1.0);
}

// What projector number proj shows at place (s, t) of its picture: the look of a spot where
// one of its outlines is, black in a cutout, and the plain picture everywhere else. This is
// the show's calibration at work. The last outline listed is on top, as in the show.
// An outline is the rock as that projector sees it: slices of it from the wall to its
// crown, each the base's oval shrunk as the dome narrows (scene.js, regionHull, has the
// same slices).
vec3 pictureAt(int proj, float s, float t) {
  vec2 p = vec2(s, t);
  for (int k = 0; k < MAXR; k++) {
    int i = uNReg - 1 - k;
    if (i < 0) break;
    vec4 a = uRegA[i];
    vec4 b = uRegB[i];
    int code = int(b.z + 0.5);
    if (code / 100 != proj) continue;
    vec4 c2 = uRegC[i];
    vec4 d2 = uRegD[i];
    bool plain = b.w <= 0.0;        // a plain oval: only the wide end counts
    bool inside = false;
    vec2 at = vec2(0.0);
    for (int j = 0; j < SLICES; j++) {
      float h = float(j) / float(SLICES - 1) * 0.97;
      float size = sqrt(max(1.0 - h * h, 0.0));
      vec2 c = mix(a.xy, c2.xy, h);
      vec2 ea = a.zw * size;
      vec2 eb = b.xy * size;
      float det = ea.x * eb.y - ea.y * eb.x;
      if (abs(det) > 1e-9) {
        vec2 d = p - c;
        float x = (d.x * eb.y - d.y * eb.x) / det;   // along the first arm (the picture's right)
        float y = (ea.x * d.y - ea.y * d.x) / det;   // along the second (the picture's top)
        if (x * x + y * y <= 1.0) {
          inside = true;
          at = vec2(x, y);
          break;
        }
      }
      if (plain) break;
    }
    if (!inside) continue;
    int spot = code - (code / 100) * 100 - 1;
    if (spot < 0) return vec3(0.0);
    // A plain oval takes the circle that fits the picture's height; a hull takes the
    // picture centred on its bounds and scaled to cover them. Both as the show does it.
    vec2 uv = plain ? vec2(0.5 + 0.375 * at.x, 0.5 + 0.5 * at.y) : 0.5 + (p - d2.zw) / b.w;
    return spotPaint(uv, spot, proj);
  }
  if (uStillN > 1.5) {
    // One picture across the projectors: this one's own part, never mirrored.
    float x = (s * 0.5 + 0.5 + min(uPWin[proj], uStillN - 1.0)) / uStillN;
    return texture(uStill, vec2(x, t * 0.5 + 0.5)).rgb;
  }
  return texture(uStill, vec2(uPSpec[proj].w > 0.5 ? -s : s, t) * 0.5 + 0.5).rgb;
}

// Light projector number proj (or its mirror image at pos, f, r, u) throws on point q of a
// surface facing n, ignoring anything in the way. x < 0 means the point is outside the picture.
vec3 thrown(vec3 pos, vec3 f, vec3 r, vec3 u, vec3 spec, vec3 q, vec3 n, int proj) {
  vec3 d = q - pos;
  float z = dot(d, f);
  if (z < 1.0) return vec3(-1.0);
  float s = dot(d, r) / z / (0.5 / spec.x);
  float t = dot(d, u) / z / (0.5 * spec.z / spec.x) - 2.0 * uPLift[proj];
  if (abs(s) >= 1.0 || abs(t) >= 1.0) return vec3(-1.0);
  float c = -dot(d, n) / length(d);
  if (c <= 0.0) return vec3(-1.0);
  vec3 tex = pow(pictureAt(proj, s, t), vec3(2.2)) + BLACK;
  return tex * (spec.y * spec.x * spec.x / (spec.z * z * z) * c);
}

// The words on the message card, as seen on the top of box i by someone on its marked side.
vec3 cardInk(vec3 p, int i) {
  vec4 q = uBoxTurn[i];
  vec2 po = p.xy - q.xy;
  vec2 l = vec2(q.z * po.x + q.w * po.y + q.x, -q.w * po.x + q.z * po.y + q.y);
  vec2 a = (l - uBoxMin[i].xy) / (uBoxMax[i].xy - uBoxMin[i].xy);
  return pow(texture(uCard, vec2(a.y, 1.0 - a.x)).rgb, vec3(2.2));
}

// The photo of the toy, laid flat over the pedestal and seen from above. which: 0 for the
// base (wheel painted out, see-through around the toy), 1 for the picture with the wheel.
vec4 toyPhoto(vec3 p, float which) {
  vec2 po = p.xy - uToyFrame.xy;
  vec2 l = vec2(uToyFrame.z * po.x + uToyFrame.w * po.y, -uToyFrame.w * po.x + uToyFrame.z * po.y);
  vec2 a = clamp((l - uToyRect.xy) / uToyRect.zw, 0.004, 0.996);
  vec4 c = texture(uToy, vec2((a.x + which) * 0.5, a.y));
  return vec4(pow(c.rgb, vec3(2.2)), c.a);
}

vec3 shade(vec3 p, vec3 n, vec3 albedo) {
  vec3 q = p + n * 0.05;
  vec3 light = uAmbient;
  // Lights on: an even glow, plus one lamp in the middle of the ceiling so that shapes
  // have a lit side and cast shadows.
  if (uRoomLight > 0.0) {
    vec3 lamp = vec3(uRoom.x * 0.5, uRoom.y * 0.5, uRoom.z - 3.0);
    vec3 ld = lamp - q;
    float far = length(ld);
    float c = max(dot(ld / far, n), 0.0);
    float direct = c > 0.0 && !blocked(lamp, q, -1) ? c * 4200.0 / (far * far) : 0.0;
    light += uRoomLight * vec3(0.38 + direct);
  }
  // The book light: a small warm cone, soft at its edge.
  if (uLampPower.x > 0.0) {
    vec3 ld = q - uLampPos;
    float far = length(ld);
    ld /= far;
    float cone = smoothstep(0.55, 0.8, dot(ld, uLampDir));
    float c = -dot(ld, n);
    if (cone > 0.0 && c > 0.0 && !blocked(uLampPos, q, -1)) light += uLampPower * (cone * c / (far * far));
  }
  // Lava lamps: a dim glow from the middle of each glass. The light starts just outside
  // the glass, so the glass does not shadow its own light.
  for (int i = 0; i < MAXL; i++) {
    if (i >= uNLava || uQuick > 1.5) break;
    vec3 ld = uLavaPos[i].xyz - q;
    float far = length(ld);
    ld /= far;
    float c = dot(ld, n);
    if (c <= 0.0) continue;
    vec3 from = uLavaPos[i].xyz - ld * (uLavaPos[i].w + 0.3);
    if (uQuick > 0.5 || !blocked(from, q, -1)) light += uLavaCol[i] * (c / (far * far));
  }
  for (int i = 0; i < MAXP; i++) {
    if (i >= uNProj) break;
    vec3 e = thrown(uPPos[i], uPF[i], uPR[i], uPU[i], uPSpec[i].xyz, q, n, i);
    if (e.x >= 0.0 && !blocked(uPPos[i], q, -1)) light += e;
  }
  for (int i = 0; i < MAXI; i++) {
    if (i >= uNImg) break;
    int mi = int(uISpec[i].w + 0.5);
    vec3 mn = uMirN[mi];
    if (dot(q - uMirC[mi], mn) <= 0.0) continue;          // behind the glass
    vec3 e = thrown(uIPos[i], uIF[i], uIR[i], uIU[i], uISpec[i].xyz, q, n, int(uIProj[i] + 0.5));
    if (e.x < 0.0) continue;
    vec3 d = q - uIPos[i];
    float k = dot(uMirC[mi] - uIPos[i], mn) / dot(d, mn);
    if (k <= 0.0 || k >= 1.0) continue;
    vec3 m = uIPos[i] + d * k;                              // where the light meets the glass
    if (!onMirror(m, mi)) continue;
    if (blocked(uIReal[i], m, mi) || blocked(m, q, mi)) continue;
    light += e * KEEP;
  }
  return albedo * light / PI;
}

// Which cable, if any, lies under this spot on the floor: its kind, or -1.
int onCable(vec2 p) {
  float best = 2.5; // drawn 5 in wide, far fatter than life, so they read from across the room
  int kind = -1;
  for (int i = 0; i < CABLEN; i++) {
    if (i >= uNCable) break;
    vec4 s = texelFetch(uCables, ivec2(i, 0), 0);
    vec2 a = s.xy;
    vec2 ab = s.zw - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = length(p - a - ab * h);
    if (d < best) { best = d; kind = int(texelFetch(uCables, ivec2(i, 1), 0).x + 0.5); }
  }
  return kind;
}
vec3 cableColor(int kind) {
  if (kind == 0) return vec3(0.45, 0.40, 1.0);   // HDMI
  if (kind == 1) return vec3(0.95, 0.55, 0.15);  // mains
  if (kind == 2) return vec3(0.75, 0.45, 0.85);  // USB
  return vec3(0.15, 0.80, 0.75);                  // audio
}

// Is this spot on the floor within the path? Distance to the nearest of its straight pieces.
bool onPath(vec2 p) {
  float best = 1e9;
  for (int i = 0; i + 1 < PATHN; i++) {
    if (i + 1 >= uNPath) break;
    vec2 a = uPathPts[i];
    vec2 ab = uPathPts[i + 1] - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    best = min(best, length(p - a - ab * h));
  }
  return best <= uPathSpec.x;
}

// A lava lamp's glass at this point: wax blobs rising and sinking, each lamp on its own
// slow clock, each blob sitting more on one side and drifting round. About 1 on average.
float lava(vec3 p, int i) {
  vec4 a = uDiscA[i];
  float h = clamp((p.z - a.z) / max(a.w - a.z, 1e-3), 0.0, 1.0);
  float ang = atan(p.y - a.y, p.x - a.x);
  float seed = float(i) * 1.7;
  float glow = 0.35;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float y = 0.5 + 0.42 * sin(uTime * (0.11 + 0.04 * fk) + seed + fk * 2.1);
    float side = 0.6 + 0.4 * cos(ang - uTime * 0.2 - seed - fk * 2.4);
    float dd = (h - y) / (0.14 + 0.05 * fk);
    glow += 1.1 * side * exp(-dd * dd);
  }
  return glow;
}

vec3 trace(vec3 o, vec3 d) {
  float keep = 1.0;
  for (int bounce = 0; bounce <= BOUNCES; bounce++) {
    if (bounce > uBounces) break;
    vec3 inv = 1.0 / d;
    vec3 wallT = max(-o * inv, (uRoom - o) * inv);
    float t = min(min(wallT.x, wallT.y), wallT.z);
    vec3 n;
    if (t == wallT.x) n = vec3(-sign(d.x), 0.0, 0.0);
    else if (t == wallT.y) n = vec3(0.0, -sign(d.y), 0.0);
    else n = vec3(0.0, 0.0, -sign(d.z));
    vec3 albedo = n.z > 0.5 ? uFloor : (n.z < -0.5 ? uCeil : uWall);
    if (n.z > 0.5 && uNPath > 0 && onPath(o.xy + d.xy * t)) albedo = uPathCol;   // the path on the floor
    if (n.z > 0.5 && uRoomLight > 0.0 && uNCable > 0) {                            // the cables, with the lights on
      int ck = onCable(o.xy + d.xy * t);
      if (ck >= 0) albedo = cableColor(ck);
    }
    float kind = 0.0;
    float ref = 0.0;
    int box = -1;
    float th;
    vec3 nh;
    for (int i = 0; i < MAXB; i++) {
      if (i >= uNBox) break;
      if (hitSolid(o, d, i, t, th, nh)) {
        t = th;
        n = nh;
        albedo = uBoxCol[i];
        kind = uBoxKind[i].x;
        ref = uBoxKind[i].y;
        box = i;
      }
    }
    for (int i = 0; i < MAXD; i++) {
      if (i >= uNDisc) break;
      if (hitDisc(o, d, i, t, th, nh)) {
        t = th;
        n = nh;
        albedo = uDiscCol[i];
        kind = uDiscR[i].z > 0.5 ? 6.0 : albedo.x < 0.0 ? 4.0 : 0.0;   // lit glass; the wheel takes its colour from the photo
        box = i;   // which disc, for the lava
      }
    }
    for (int i = 0; i < MAXS; i++) {
      if (i >= uNSpot) break;
      if (hitSpot(o, d, i, t, th, nh)) {
        t = th;
        n = nh;
        albedo = uCloth;
        kind = 0.0;
      }
    }
    int ball = -1;
    for (int i = 0; i < MAXK; i++) {
      if (i >= uNBall) break;
      if (hitBall(o, d, i, t, th, nh)) {
        t = th;
        n = nh;
        ball = i;
      }
    }
    int glass = -1;
    bool shiny = false;
    bool framed = false;
    bool front;
    bool rim;
    vec3 mn = vec3(0.0);
    vec3 mnh;
    for (int i = 0; i < MAXM; i++) {
      if (i >= uNMir) break;
      if (hitMirror(o, d, i, t, th, front, rim, mnh)) {
        t = th;
        glass = i;
        shiny = front;
        framed = rim;
        mn = mnh;
        ball = -1;
      }
    }
    vec3 p = o + d * t;
    if (glass >= 0) {
      if (framed) return keep * shade(p, shiny ? mn : -mn, vec3(0.04));   // the frame: thin, dark, matte
      if (!shiny) return keep * shade(p, -mn, vec3(0.12));   // the back of a mirror
      d = safe(reflect(d, mn));
      o = p + mn * 0.02;
      keep *= KEEP;
      continue;
    }
    if (ball >= 0) {
      // A disco ball's tile: the room thrown back off a little mirror, a touch darker for
      // the grout between the tiles. The dots it scatters from a projector are not drawn.
      d = safe(reflect(d, n));
      o = p + n * 0.02;
      keep *= KEEP * 0.8;
      continue;
    }
    if (kind > 5.5) return keep * albedo * lava(p, box);   // the glass of a lava lamp: its own light, whatever falls on it
    if (kind > 4.5) {
      // A curtain: cloth hanging in folds, a fold every 6 in along the wall, and a
      // little darker than the wall it is on.
      float along = abs(n.x) > 0.5 ? p.y : p.x;
      albedo *= 0.78 + 0.16 * sin(along * (6.2832 / 6.0)) * (1.0 - 0.6 * abs(n.z));
      kind = 0.0;
    }
    if (kind > 3.5) {
      albedo = toyPhoto(p, 1.0).rgb;
      kind = 0.0;
    } else if (kind > 2.5) {
      vec4 c = toyPhoto(p, 0.0);
      albedo = mix(albedo, c.rgb, c.a);
      kind = 0.0;
    } else if (kind > 1.5) {
      // The message card: paper, with its words on the top.
      if (n.z > 0.5) albedo *= cardInk(p, box);
      kind = 0.0;
    }
    if (kind > 0.5) {
      // Looking into a projector: blinding from inside its beam, a dull box from outside.
      int pi = int(ref + 0.5);
      vec3 v = -d;
      float z = dot(v, uPF[pi]);
      if (z > 0.0) {
        float s = dot(v, uPR[pi]) / z / (0.5 / uPSpec[pi].x);
        float tt = dot(v, uPU[pi]) / z / (0.5 * uPSpec[pi].z / uPSpec[pi].x) - 2.0 * uPLift[pi];
        if (abs(s) < 1.0 && abs(tt) < 1.0) return vec3(keep * 1e6);
      }
      return vec3(keep * 0.0004);
    }
    return keep * shade(p, n, albedo);
  }
  return vec3(0.0);
}

void main() {
  vec2 a = (gl_FragCoord.xy / uRes * 2.0 - 1.0) * uTan;
  a.y *= uRes.y / uRes.x;
  vec3 d = safe(normalize(uF + a.x * uR + a.y * uU));
  vec3 c = trace(uEye, d);
  c = 1.0 - exp(-uExposure * c);
  c *= 1.0 - uFade;
  outColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`composer shader: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

export class Tracer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("This browser cannot draw the room view (WebGL2 is missing).");
    this.gl = gl;
    this.canvas = canvas;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`composer shader: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    this.locations = new Map();
    this.vao = gl.createVertexArray();
    this.texture = gl.createTexture();
    this.spotTexture = gl.createTexture();
    this.cardTexture = gl.createTexture();
    this.toyTexture = gl.createTexture();
    this.rocksTexture = gl.createTexture();
    this.cablesTexture = gl.createTexture();
    this.cablesKey = "";
    this.setCables([0, 0, 0, 0], [0]); // a complete texture even before there are cables
    this.rockGrid = [1, 1];
    this.setRocks([]);
    this.setToy(null);
    this.setStill(null);
    this.setSpotStill(null);
    this.setCard(null);
  }

  loc(name) {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name);
  }

  /**
   * The picture the projectors show. null gives plain white. `windows` is how many
   * projectors wide it is: 1 shows all of it on every projector, 2 or more gives each its
   * own part (see stillWindows).
   */
  setStill(image, windows = 1) {
    this.stillN = windows;
    this.fill(this.texture, image);
  }

  /** The picture mapped onto the spots. null gives plain white. */
  setSpotStill(image, windows = 1) {
    this.spotStillN = windows;
    this.fill(this.spotTexture, image);
  }

  /**
   * The scanned rocks the spots wear, as loaded images in rock order, packed into a grid
   * on one texture (a strip would pass many GPUs' width). None gives plain cloth.
   */
  setRocks(images, shapes = {}) {
    const gl = this.gl;
    this.rockFit = new Float32Array(25 * 4).fill(0);
    images.forEach((img, i) => {
      const f = rockFrame(shapes[rockFile(i).split("/").pop()]);
      this.rockFit.set([f.x, f.y, f.w, f.h], i * 4);
    });
    const ok = images.filter(Boolean);
    if (!ok.length) {
      this.rockGrid = [1, 1];
      return this.fill(this.rocksTexture, null);
    }
    const side = 512;
    const cols = Math.ceil(Math.sqrt(ok.length));
    const rows = Math.ceil(ok.length / cols);
    const grid = document.createElement("canvas");
    grid.width = side * cols;
    grid.height = side * rows;
    const ink = grid.getContext("2d");
    ok.forEach((img, i) => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      ink.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, (i % cols) * side, Math.floor(i / cols) * side, side, side);
    });
    this.rockGrid = [cols, rows];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rocksTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, grid);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    grid.width = 0;
  }

  /** The message card's face: a canvas with the words drawn on it. null gives a blank card. */
  /** The cable pieces as a two-row float texture (the shader's uniform budget is full). */
  setCables(seg, kind) {
    const key = seg.join(",") + "|" + kind.join(",");
    if (key === this.cablesKey) return;
    this.cablesKey = key;
    const gl = this.gl;
    const n = kind.length;
    const data = new Float32Array(n * 4 * 2);
    data.set(seg.slice(0, n * 4), 0);
    for (let i = 0; i < n; i++) data[n * 4 + i * 4] = kind[i];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cablesTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // the pictures are uploaded flipped; this is data, row 0 first
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 2, 0, gl.RGBA, gl.FLOAT, data);
  }

  setCard(image) {
    this.fill(this.cardTexture, image);
  }

  /** The photo of the toy (img/toy.png). null gives a plain grey base and a dark wheel. */
  setToy(image) {
    if (image) return this.fill(this.toyTexture, image);
    const gl = this.gl;
    this.fill(this.toyTexture, null);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([150, 150, 154, 255, 80, 80, 84, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  fill(texture, image) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * Draw one picture.
   * @param {object} s  from packScene()
   * @param {object} look  { ambient: [r, g, b], exposure, surfaces: { WALL, CEILING, FLOOR }, roomLight }
   */
  render(s, look) {
    const gl = this.gl;
    const { canvas } = this;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const v3 = (name, a) => a.length && gl.uniform3fv(this.loc(name), a);
    const v2 = (name, a) => a.length && gl.uniform2fv(this.loc(name), a);
    gl.uniform2f(this.loc("uRes"), canvas.width, canvas.height);
    v3("uEye", s.eye);
    v3("uF", s.look.f);
    v3("uR", s.look.r);
    v3("uU", s.look.u);
    gl.uniform1f(this.loc("uTan"), s.tan);
    v3("uRoom", s.room);
    v3("uWall", look.surfaces.WALL);
    v3("uCeil", look.surfaces.CEILING);
    v3("uFloor", look.surfaces.FLOOR);
    v3("uAmbient", look.ambient);
    gl.uniform1f(this.loc("uExposure"), look.exposure);
    gl.uniform1f(this.loc("uRoomLight"), look.roomLight || 0);
    gl.uniform1f(this.loc("uTime"), look.time || 0);
    gl.uniform1f(this.loc("uFade"), look.fade || 0);
    gl.uniform1i(this.loc("uBounces"), look.bounces ?? 12);
    gl.uniform1f(this.loc("uQuick"), look.quick || 0);
    gl.uniform1i(this.loc("uNPath"), s.nPath);
    if (s.pathPts.length) gl.uniform2fv(this.loc("uPathPts"), s.pathPts);
    v3("uPathSpec", s.pathSpec);
    v3("uPathCol", s.pathCol);
    gl.uniform1i(this.loc("uNCable"), s.nCable || 0);
    if (s.nCable) this.setCables(s.cableSeg, s.cableKind);
    gl.uniform1i(this.loc("uNBox"), s.nBox);
    v3("uBoxMin", s.boxMin);
    v3("uBoxMax", s.boxMax);
    v3("uBoxCol", s.boxCol);
    v2("uBoxKind", s.boxKind);
    if (s.boxTurn.length) gl.uniform4fv(this.loc("uBoxTurn"), s.boxTurn);
    gl.uniform1i(this.loc("uNDisc"), s.nDisc);
    if (s.discA.length) gl.uniform4fv(this.loc("uDiscA"), s.discA);
    if (s.discR.length) gl.uniform4fv(this.loc("uDiscR"), s.discR);
    gl.uniform1i(this.loc("uNLava"), s.nLava);
    if (s.lavaPos.length) gl.uniform4fv(this.loc("uLavaPos"), s.lavaPos);
    v3("uLavaCol", s.lavaCol);
    v3("uDiscCol", s.discCol);
    gl.uniform1i(this.loc("uNSpot"), s.nSpot);
    v3("uSpotC", s.spotC);
    v3("uSpotN", s.spotN);
    v3("uSpotS", s.spotS);
    v3("uCloth", s.cloth);
    if (s.spotLookA.length) gl.uniform4fv(this.loc("uSpotLookA"), s.spotLookA);
    if (s.spotLookB.length) gl.uniform4fv(this.loc("uSpotLookB"), s.spotLookB);
    gl.uniform1i(this.loc("uNMir"), s.nMir);
    v3("uMirC", s.mirC);
    v3("uMirN", s.mirN);
    if (s.mirS.length) gl.uniform4fv(this.loc("uMirS"), s.mirS);
    gl.uniform1i(this.loc("uNBall"), s.nBall || 0);
    if (s.ballA && s.ballA.length) gl.uniform4fv(this.loc("uBall"), s.ballA);
    gl.uniform1i(this.loc("uNProj"), s.nProj);
    v3("uPPos", s.pPos);
    v3("uPF", s.pF);
    v3("uPR", s.pR);
    v3("uPU", s.pU);
    if (s.pSpec.length) gl.uniform4fv(this.loc("uPSpec"), s.pSpec);
    if (s.pWin.length) gl.uniform1fv(this.loc("uPWin"), s.pWin);
    gl.uniform1f(this.loc("uStillN"), this.stillN || 1);
    gl.uniform1f(this.loc("uSpotStillN"), this.spotStillN || 1);
    if (s.pLift.length) gl.uniform1fv(this.loc("uPLift"), s.pLift);
    gl.uniform1i(this.loc("uNReg"), s.nReg);
    if (s.regA.length) gl.uniform4fv(this.loc("uRegA"), s.regA);
    if (s.regB.length) gl.uniform4fv(this.loc("uRegB"), s.regB);
    if (s.regC.length) gl.uniform4fv(this.loc("uRegC"), s.regC);
    if (s.regD.length) gl.uniform4fv(this.loc("uRegD"), s.regD);
    if (s.iProj.length) gl.uniform1fv(this.loc("uIProj"), s.iProj);
    gl.uniform1i(this.loc("uNImg"), s.nImg);
    v3("uIPos", s.iPos);
    v3("uIF", s.iF);
    v3("uIR", s.iR);
    v3("uIU", s.iU);
    v3("uIReal", s.iReal);
    if (s.iSpec.length) gl.uniform4fv(this.loc("uISpec"), s.iSpec);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.loc("uStill"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.spotTexture);
    gl.uniform1i(this.loc("uSpotStill"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.cardTexture);
    gl.uniform1i(this.loc("uCard"), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.toyTexture);
    gl.uniform1i(this.loc("uToy"), 3);
    gl.uniform4fv(this.loc("uToyFrame"), s.toyFrame);
    gl.uniform4fv(this.loc("uToyRect"), s.toyRect);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.rocksTexture);
    gl.uniform1i(this.loc("uRocks"), 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.cablesTexture);
    gl.uniform1i(this.loc("uCables"), 5);
    gl.uniform2f(this.loc("uRockGrid"), this.rockGrid[0], this.rockGrid[1]);
    if (this.rockFit) gl.uniform4fv(this.loc("uRockFit"), this.rockFit);
    if (s.spotRock.length) {
      gl.uniform1fv(this.loc("uSpotRock"), new Float32Array(s.spotRock));
      gl.uniform1fv(this.loc("uSpotRockB"), new Float32Array(s.spotRockB));
      gl.uniform1fv(this.loc("uSpotRockMix"), new Float32Array(s.spotRockMix));
    }
    gl.activeTexture(gl.TEXTURE0);
    v3("uLampPos", s.lampPos);
    v3("uLampDir", s.lampDir);
    v3("uLampPower", s.lampPower);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
