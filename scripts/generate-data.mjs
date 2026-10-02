#!/usr/bin/env node
/**
 * MATSUMOTO FOOD WALK — data generator
 *
 *   node scripts/generate-data.mjs
 *
 * Reads the hand-authored street layout below plus data/restaurants.json and writes:
 *   data/roads.json      … road graph (nodes / edges / streets / river)
 *   data/buildings.json  … procedural building lots (Level B shop buildings + Level C background)
 *   data/restaurants.json… restaurant positions snapped to the nearest street frontage
 *
 * Coordinates: metres, origin = 松本駅お城口 (east exit). +x = east, +z = south, -z = north.
 * The layout is a stylised abstraction of the real streets around Matsumoto Station
 * (駅前大通り, 伊勢町, 本町, 中町, 縄手, 大名町 …), not a survey-accurate map.
 * Everything is deterministic (seeded RNG), so re-running produces identical files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

// ---------------------------------------------------------------------------
// Road types: geometry + which modes may use them
// ---------------------------------------------------------------------------
const ROAD_TYPES = {
  avenue:     { width: 20, sidewalk: 4.5, walk: true, bike: true, car: true },
  street:     { width: 12, sidewalk: 3.0, walk: true, bike: true, car: true },
  lane:       { width: 8,  sidewalk: 1.5, walk: true, bike: true, car: true },
  shotengai:  { width: 9,  sidewalk: 0,   walk: true, bike: true, car: true },
  pedestrian: { width: 6,  sidewalk: 0,   walk: true, bike: true, car: false },
  plaza:      { width: 16, sidewalk: 0,   walk: true, bike: true, car: true }, // taxi & pick-up rotary
  passage:    { width: 7,  sidewalk: 0,   walk: true, bike: false, car: false },
};

// ---------------------------------------------------------------------------
// Streets (polylines). scenic: 0..1 — how pleasant the street is to walk.
// ---------------------------------------------------------------------------
const STREETS = [
  { id: 'ekimae',    name: '駅前大通り',     type: 'avenue',     pts: [[110, 0], [900, 0]], scenic: 0.35 },
  { id: 'plaza',     name: '松本駅前広場',   type: 'plaza',      pts: [[36, 0], [110, 0]], scenic: 0.5 },
  { id: 'passage',   name: '駅自由通路',     type: 'passage',    pts: [[-112, 0], [36, 0]], scenic: 0.2 },
  { id: 'alps-gate', name: 'アルプス口広場', type: 'plaza',      pts: [[-150, 0], [-112, 0]], scenic: 0.4 },
  { id: 'alps',      name: 'アルプス口通り', type: 'lane',       pts: [[-150, -520], [-150, 520]], scenic: 0.15 },
  { id: 'honmachi',  name: '本町通り',       type: 'street',     pts: [[520, 420], [520, -396]], scenic: 0.45 },
  { id: 'daimyo',    name: '大名町通り',     type: 'street',     pts: [[520, -396], [520, -900]], scenic: 0.75 },
  { id: 'isemachi',  name: '伊勢町通り',     type: 'street',     pts: [[110, -180], [820, -180]], scenic: 0.3 },
  { id: 'nakamachi', name: '中町通り',       type: 'shotengai',  pts: [[520, -300], [820, -300]], scenic: 1.0, oneway: true },
  { id: 'riverside', name: '女鳥羽川沿い',   type: 'lane',       pts: [[360, -355], [820, -355]], scenic: 0.85 },
  { id: 'nawate',    name: '縄手通り',       type: 'pedestrian', pts: [[520, -396], [690, -396]], scenic: 1.0 },
  { id: 'eki-east',  name: '駅前東通り',     type: 'street',     pts: [[110, 420], [110, -460]], scenic: 0.1 },
  { id: 'chuo2',     name: '中央二丁目通り', type: 'lane',       pts: [[230, 420], [230, -460]], scenic: 0.2 },
  { id: 'chuo',      name: '中央通り',       type: 'street',     pts: [[360, 420], [360, -355]], scenic: 0.25 },
  { id: 'nishiki',   name: '錦通り',         type: 'lane',       pts: [[690, 420], [690, -560]], scenic: 0.35 },
  { id: 'agata',     name: 'あがた通り',     type: 'street',     pts: [[820, 420], [820, -355]], scenic: 0.2 },
  { id: 'koji',      name: '中央小路',       type: 'lane',       pts: [[110, -90], [820, -90]], scenic: 0.3 },
  { id: 'fukashi1',  name: '深志一丁目通り', type: 'street',     pts: [[110, 120], [820, 120]], scenic: 0.2 },
  { id: 'fukashi',   name: '深志通り',       type: 'street',     pts: [[110, 260], [820, 260]], scenic: 0.2 },
  { id: 'minami',    name: '南小路',         type: 'lane',       pts: [[110, 400], [820, 400]], scenic: 0.15 },
  { id: 'kita',      name: '北小路',         type: 'lane',       pts: [[110, -460], [230, -460]], scenic: 0.3 },
  { id: 'joto',      name: '城東通り',       type: 'street',     pts: [[520, -560], [820, -560]], scenic: 0.4 },
  { id: 'urakoji',   name: '裏町小径',       type: 'pedestrian', pts: [[360, -180], [440, -240], [520, -300]], scenic: 0.9 },
  { id: 'park',      name: '公園の小径',     type: 'pedestrian', pts: [[230, 120], [295, 190], [360, 260]], scenic: 0.9 },
  { id: 'sando',     name: 'お城の参道',     type: 'pedestrian', pts: [[520, -900], [520, -936]], scenic: 1.0 },
];

const RIVER = {
  name: '女鳥羽川',
  width: 22,
  points: [[1150, -373], [820, -374], [600, -373], [380, -370], [270, -392], [190, -440], [120, -520], [20, -640], [-90, -770]],
};

const STATION_POS = [36, 0];

// Reserved areas (no procedural buildings). [x0, z0, x1, z1]
const RESERVED = [
  [-112, -2000, -22, 2000],   // railway
  [-40, -150, 36, 150],       // station building + forecourt
  [36, -62, 110, 62],         // station plaza
  [232, 122, 358, 258],       // park
  [380, -1240, 720, -936],    // castle grounds
  [500, -948, 540, -900],     // sando
];

// Level A landmark buildings (rendered with extra detail by the client)
const LANDMARKS = [
  { id: 'hotel',  x: 175, z: -44, w: 46, d: 30, h: 58, rot: 0, kind: 'tower' },
  { id: 'dept',   x: 70,  z: -104, w: 56, d: 64, h: 30, rot: 0, kind: 'dept' },
  { id: 'mall',   x: 468, z: -50, w: 50, d: 62, h: 34, rot: 0, kind: 'mall' },
  { id: 'museum', x: 600, z: 190, w: 64, d: 44, h: 18, rot: 0, kind: 'hall' },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(19470);
const rand = (a, b) => a + (b - a) * rng();
const r1 = (v) => Math.round(v * 10) / 10;

function segIntersect(a, b, c, d) {
  const rx = b[0] - a[0], rz = b[1] - a[1];
  const sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = c[0] - a[0], qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  const eps = 1e-6;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) };
}

function projectOnSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + dx * t, z = a[1] + dz * t;
  return { t, x, z, dist: Math.hypot(p[0] - x, p[1] - z) };
}

// Oriented rectangle → 4 corners
function rectCorners(cx, cz, w, d, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
}
function polyAxes(p) {
  const axes = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const l = Math.hypot(ex, ez) || 1;
    axes.push([-ez / l, ex / l]);
  }
  return axes;
}
function overlap(pa, pb, margin = 0) {
  for (const ax of [...polyAxes(pa), ...polyAxes(pb)]) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const p of pa) { const v = p[0] * ax[0] + p[1] * ax[1]; amin = Math.min(amin, v); amax = Math.max(amax, v); }
    for (const p of pb) { const v = p[0] * ax[0] + p[1] * ax[1]; bmin = Math.min(bmin, v); bmax = Math.max(bmax, v); }
    if (amax + margin <= bmin || bmax + margin <= amin) return false;
  }
  return true;
}
function bbox(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}

// Spatial hash of obstacle polygons
const CELL = 40;
const grid = new Map();
function gridAdd(poly) {
  const [x0, z0, x1, z1] = bbox(poly);
  for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
    for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
      const k = gx + ',' + gz;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(poly);
    }
}
function collides(poly, margin = 0.6) {
  const [x0, z0, x1, z1] = bbox(poly);
  const seen = new Set();
  for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
    for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
      const arr = grid.get(gx + ',' + gz);
      if (!arr) continue;
      for (const o of arr) {
        if (seen.has(o)) continue;
        seen.add(o);
        if (overlap(poly, o, margin)) return true;
      }
    }
  return false;
}
// Corridor polygon around a segment (extended by `cap` at both ends)
function corridor(a, b, half, cap = 0) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  return rectCorners((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len + cap * 2, half * 2, ang);
}

// ---------------------------------------------------------------------------
// 1. Road graph
// ---------------------------------------------------------------------------
const segments = [];
for (const st of STREETS) {
  for (let i = 0; i < st.pts.length - 1; i++) segments.push({ st, a: st.pts[i], b: st.pts[i + 1], splits: [0, 1] });
}
for (let i = 0; i < segments.length; i++) {
  for (let j = i + 1; j < segments.length; j++) {
    const s1 = segments[i], s2 = segments[j];
    const hit = segIntersect(s1.a, s1.b, s2.a, s2.b);
    if (hit) { s1.splits.push(hit.t); s2.splits.push(hit.u); }
  }
}

const nodes = [];
const nodeKey = new Map();
function getNode(x, z) {
  const k = Math.round(x) + ',' + Math.round(z);
  if (nodeKey.has(k)) return nodeKey.get(k);
  for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < 1.0) { nodeKey.set(k, n); return n; }
  const n = { id: 'n' + String(nodes.length + 1).padStart(3, '0'), x: r1(x), z: r1(z), streets: new Set(), types: new Set() };
  nodes.push(n);
  nodeKey.set(k, n);
  return n;
}

const edges = [];
for (const seg of segments) {
  const ts = [...new Set(seg.splits.map((t) => Math.round(t * 1e6) / 1e6))].sort((p, q) => p - q);
  const pts = ts.map((t) => [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t]);
  for (let i = 0; i < pts.length - 1; i++) {
    const na = getNode(pts[i][0], pts[i][1]);
    const nb = getNode(pts[i + 1][0], pts[i + 1][1]);
    if (na === nb) continue;
    const rt = ROAD_TYPES[seg.st.type];
    na.streets.add(seg.st.id); nb.streets.add(seg.st.id);
    na.types.add(seg.st.type); nb.types.add(seg.st.type);
    edges.push({
      id: 'e' + String(edges.length + 1).padStart(3, '0'),
      from: na.id,
      to: nb.id,
      distance: r1(Math.hypot(nb.x - na.x, nb.z - na.z)),
      walk: rt.walk,
      bike: rt.bike,
      car: rt.car,
      oneway: seg.st.oneway ? 'forward' : undefined,
      roadType: seg.st.type,
      width: rt.width,
      sidewalk: rt.sidewalk,
      street: seg.st.id,
      scenic: seg.st.scenic ?? 0.2,
    });
  }
}

const MAJOR = new Set(['avenue', 'street']);
const degree = new Map();
for (const e of edges) { degree.set(e.from, (degree.get(e.from) || 0) + 1); degree.set(e.to, (degree.get(e.to) || 0) + 1); }
const streetType = Object.fromEntries(STREETS.map((s) => [s.id, s.type]));
const outNodes = nodes.map((n) => {
  const majorStreets = [...n.streets].filter((s) => MAJOR.has(streetType[s])).length;
  const deg = degree.get(n.id) || 0;
  const signal = deg >= 3 && majorStreets >= 2;
  const crossesAvenue = n.types.has('avenue') && deg >= 3;
  return { id: n.id, x: n.x, z: n.z, signal: signal || undefined, major: crossesAvenue || undefined };
});
const stationNode = nodes.find((n) => Math.hypot(n.x - STATION_POS[0], n.z - STATION_POS[1]) < 1);

// ---------------------------------------------------------------------------
// 2. Obstacles: roads, river, reserved zones, landmarks
// ---------------------------------------------------------------------------
const nodeById = new Map(nodes.map((n) => [n.id, n]));

// Decorative (non-routable) streets that continue the grid into the outskirts.
const X_LINES = [[-400, 7], [-280, 7], [-150, 8], [110, 12], [230, 8], [360, 12], [520, 12], [690, 8], [820, 12], [960, 8], [1100, 10], [1240, 7], [1380, 7]];
const Z_LINES = [[-1320, 7], [-1180, 8], [-1040, 7], [-820, 8], [-690, 7], [-560, 12], [-460, 8], [-180, 12], [-90, 7], [0, 20], [120, 10], [260, 12], [400, 8], [540, 8], [680, 7]];
const DECOR_CLIP = [[100, -470, 832, 432], [-112, -2000, -22, 2000], [-22, -160, 110, 160], [370, -1250, 730, -930], [500, -930, 840, -350]];
const decor = [];
function nearRealStreet(x, z) {
  for (const e of edges) {
    const a = nodeById.get(e.from), b = nodeById.get(e.to);
    if (projectOnSeg([x, z], [a.x, a.z], [b.x, b.z]).dist < e.width / 2 + 6) return true;
  }
  return false;
}
function addDecorLine(x0, z0, x1, z1, width) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.ceil(len / 10);
  let run = null;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const mx = x0 + (x1 - x0) * (t0 + t1) / 2, mz = z0 + (z1 - z0) * (t0 + t1) / 2;
    const clipped = DECOR_CLIP.some(([a, b, c, d]) => mx > a && mx < c && mz > b && mz < d) || nearRealStreet(mx, mz);
    if (!clipped) {
      if (!run) run = [x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0];
      run[2] = x0 + (x1 - x0) * t1; run[3] = z0 + (z1 - z0) * t1;
    } else if (run) { if (Math.hypot(run[2] - run[0], run[3] - run[1]) > 15) decor.push([...run.map(r1), width]); run = null; }
  }
  if (run && Math.hypot(run[2] - run[0], run[3] - run[1]) > 15) decor.push([...run.map(r1), width]);
}
for (const [x, w] of X_LINES) addDecorLine(x, -1440, x, 780, w);
for (const [z, w] of Z_LINES) addDecorLine(-440, z, 1420, z, w);
for (const [x0, z0, x1, z1, w] of decor) gridAdd(corridor([x0, z0], [x1, z1], w / 2 + 1.6, 0));

for (const e of edges) {
  const a = nodeById.get(e.from), b = nodeById.get(e.to);
  gridAdd(corridor([a.x, a.z], [b.x, b.z], e.width / 2 + e.sidewalk + 0.4, e.width / 2 + e.sidewalk));
}
for (let i = 0; i < RIVER.points.length - 1; i++) {
  gridAdd(corridor(RIVER.points[i], RIVER.points[i + 1], RIVER.width / 2 + 3, 8));
}
for (const [x0, z0, x1, z1] of RESERVED) gridAdd([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);

const TYPE_INDEX = { modern: 0, shop: 1, kura: 2, wood: 3, landmark: 4 };
const buildings = []; // [x, z, w, d, h, rotDeg, type, seed]
const shopIndex = {};
const landmarkIndex = {};

for (const L of LANDMARKS) {
  const poly = rectCorners(L.x, L.z, L.w, L.d, (L.rot * Math.PI) / 180);
  gridAdd(poly);
  landmarkIndex[buildings.length] = { id: L.id, kind: L.kind };
  buildings.push([L.x, L.z, L.w, L.d, L.h, L.rot, TYPE_INDEX.landmark, Math.floor(rng() * 1000)]);
}

function zoneOf(x, z) {
  if (x > 505 && x < 840 && z > -345 && z < -258) return 'nakamachi';
  if (x > 505 && x < 705 && z > -450 && z < -398) return 'nawate';
  if (Math.abs(z) < 48 && x > 100 && x < 920) return 'avenue';
  if (Math.hypot(x - 60, z) < 320) return 'core';
  if (x > -40 && x < 860 && z > -620 && z < 440) return 'town';
  return 'outer';
}
function typeFor(zone) {
  if (zone === 'nakamachi') return rng() < 0.85 ? 'kura' : 'wood';
  if (zone === 'nawate') return 'wood';
  return 'modern';
}
function heightFor(zone, x, z) {
  switch (zone) {
    case 'nakamachi': return rand(6.5, 9.5);
    case 'nawate': return rand(5.5, 8.5);
    case 'avenue': return rand(16, 40);
    case 'core': return rng() < 0.15 ? rand(26, 44) : rand(10, 26);
    case 'town': return rng() < 0.08 ? rand(18, 30) : rand(6, 16);
    default: {
      const d = Math.hypot(x - 360, z + 200);
      const f = Math.max(0.35, 1 - (d - 600) / 1400);
      return (rng() < 0.06 ? rand(16, 28) : rand(5, 13)) * f + 2;
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Restaurants: snap to street frontage + dedicated Level B building
// ---------------------------------------------------------------------------
const restaurantsFile = JSON.parse(fs.readFileSync(path.join(DATA, 'restaurants.json'), 'utf8'));
const streetName = Object.fromEntries(STREETS.map((s) => [s.id, s.name]));
let missingShopBuildings = 0;
for (const r of restaurantsFile.restaurants) {
  const p = [r.position.x, r.position.z];
  let best = null;
  for (const e of edges) {
    if (e.roadType === 'passage' || e.roadType === 'plaza') continue;
    const a = nodeById.get(e.from), b = nodeById.get(e.to);
    const pr = projectOnSeg(p, [a.x, a.z], [b.x, b.z]);
    if (!best || pr.dist < best.pr.dist) best = { e, a, b, pr };
  }
  const { e, a, b, pr } = best;
  const tx = (b.x - a.x) / e.distance, tz = (b.z - a.z) / e.distance;
  let nx = -tz, nz = tx;
  if ((p[0] - pr.x) * nx + (p[1] - pr.z) * nz < 0) { nx = -nx; nz = -nz; }
  const half = e.width / 2;
  const beaconOff = e.sidewalk > 0 ? half + e.sidewalk * 0.55 : half - 0.8;
  r.position = { x: r1(pr.x + nx * beaconOff), z: r1(pr.z + nz * beaconOff) };
  r.facing = Math.round((Math.atan2(-nz, -nx) * 180) / Math.PI); // direction the shop front faces (toward the street)
  r.street = streetName[e.street];
  delete r.nodeId;

  const zone = zoneOf(pr.x + nx * 15, pr.z + nz * 15);
  const type = zone === 'nakamachi' ? 'kura' : zone === 'nawate' ? 'wood' : 'shop';
  let placed = false;
  for (const shift of [0, 4, -4, 8, -8, 12, -12]) {
    const w = type === 'kura' ? rand(10, 13) : rand(11, 16);
    const d = rand(12, 18);
    const off = half + e.sidewalk + 1.0 + d / 2;
    const cx = pr.x + tx * shift + nx * off;
    const cz = pr.z + tz * shift + nz * off;
    const ang = Math.atan2(tz, tx);
    const poly = rectCorners(cx, cz, w, d, ang);
    if (collides(poly, 0.3)) continue;
    gridAdd(poly);
    const h = type === 'kura' ? rand(7, 9) : type === 'wood' ? rand(6, 8) : Math.min(heightFor(zone, cx, cz), 22);
    shopIndex[buildings.length] = r.id;
    buildings.push([r1(cx), r1(cz), r1(w), r1(d), r1(h), Math.round((ang * 180) / Math.PI), TYPE_INDEX[type], Math.floor(rng() * 1000)]);
    placed = true;
    break;
  }
  if (!placed) missingShopBuildings++;
}

// ---------------------------------------------------------------------------
// 4. Street-front lots
// ---------------------------------------------------------------------------
function tryAdd(cx, cz, w, d, ang, zone) {
  const poly = rectCorners(cx, cz, w, d, ang);
  if (collides(poly)) return false;
  gridAdd(poly);
  const type = typeFor(zone);
  let h = heightFor(zone, cx, cz);
  if (type === 'kura') h = Math.min(h, 9.5);
  buildings.push([r1(cx), r1(cz), r1(w), r1(d), r1(h), Math.round((ang * 180) / Math.PI), TYPE_INDEX[type], Math.floor(rng() * 1000)]);
  return true;
}

for (const e of edges) {
  if (e.roadType === 'plaza' || e.roadType === 'passage') continue;
  const a = nodeById.get(e.from), b = nodeById.get(e.to);
  const tx = (b.x - a.x) / e.distance, tz = (b.z - a.z) / e.distance;
  const ang = Math.atan2(tz, tx);
  for (const side of [-1, 1]) {
    const nx = -tz * side, nz = tx * side;
    let s = 4;
    while (s < e.distance - 4) {
      const mid = [a.x + tx * s, a.z + tz * s];
      const zone = zoneOf(mid[0] + nx * 20, mid[1] + nz * 20);
      const big = zone === 'avenue' || zone === 'core';
      const w = zone === 'nakamachi' ? rand(7, 11) : big ? rand(12, 24) : rand(8, 16);
      const d = zone === 'nakamachi' ? rand(12, 20) : big ? rand(14, 28) : rand(10, 20);
      const off = e.width / 2 + e.sidewalk + 0.7 + d / 2 + (zone === 'nakamachi' ? 0 : rand(0, 1.2));
      const cx = a.x + tx * (s + w / 2) + nx * off;
      const cz = a.z + tz * (s + w / 2) + nz * off;
      if (s + w < e.distance + 2) tryAdd(cx, cz, w, d, ang, zone);
      s += w + (zone === 'nakamachi' ? rand(0.3, 1.2) : rand(0.8, 3));
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Block interiors and the outskirts (fades into the fog)
// ---------------------------------------------------------------------------
for (let x = -420; x <= 1400; x += 15) {
  for (let z = -1420; z <= 760; z += 15) {
    const zone = zoneOf(x, z);
    if (zone === 'outer') {
      const d = Math.max(Math.abs((x - 360) / 1100), Math.abs((z + 300) / 1000));
      if (rng() < (d - 0.75) * 1.6 + 0.12) continue; // sparser toward the edge
    }
    const w = rand(9, 18), d = rand(9, 18);
    tryAdd(x + rand(-4, 4), z + rand(-4, 4), w, d, 0, zone);
  }
}

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------
const roads = {
  note: 'Generated by scripts/generate-data.mjs — edit STREETS there and re-run. Units: metres. +x east, +z south.',
  stationNodeId: stationNode.id,
  streets: STREETS.map(({ id, name, type, scenic }) => ({ id, name, type, scenic })),
  nodes: outNodes,
  edges,
  river: RIVER,
  decor, // [x0, z0, x1, z1, width] — visual only, not part of the routing graph

};
fs.writeFileSync(path.join(DATA, 'roads.json'), JSON.stringify(roads, null, 1));

const bfile = {
  note: 'Generated by scripts/generate-data.mjs. item = [x, z, width, depth, height, rotationDeg, typeIndex, seed]',
  types: Object.keys(TYPE_INDEX),
  shops: shopIndex,
  landmarks: landmarkIndex,
  items: buildings,
};
fs.writeFileSync(path.join(DATA, 'buildings.json'), '{\n' +
  Object.entries(bfile).map(([k, v]) => k === 'items'
    ? ` "items": [\n${v.map((b) => '  ' + JSON.stringify(b)).join(',\n')}\n ]`
    : ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');

fs.writeFileSync(path.join(DATA, 'restaurants.json'), '{\n' +
  ` "note": ${JSON.stringify(restaurantsFile.note)},\n "restaurants": [\n` +
  restaurantsFile.restaurants.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n ]\n}\n');

console.log(`roads: ${outNodes.length} nodes, ${edges.length} edges (station node ${stationNode.id})`);
console.log(`buildings: ${buildings.length} (${Object.keys(shopIndex).length} shop buildings, ${missingShopBuildings} shops without a building)`);
console.log(`restaurants: ${restaurantsFile.restaurants.length}`);
