// Converts a graph route into a smooth, densely sampled path that sits where the traveller
// actually is: on the sidewalk (walk), at the left road edge (bike), in the left lane (car).

import { MODES } from './config.js';

function lateral(e, mode) {
  const w = e.width, sw = e.sidewalk;
  if (e.roadType === 'plaza' || e.roadType === 'passage') return mode === 'car' ? 3 : 0;
  if (mode === 'walk') return sw > 0 ? w / 2 + sw * 0.5 : Math.max(0, w / 2 - 1.1);
  if (mode === 'bike') return sw > 0 ? w / 2 - 1.0 : Math.max(0, w / 2 - 1.5);
  return w / 4; // car: middle of the left lane
}

function offsetPolyline(segs, offsets) {
  const pts = [];
  const n = segs.length;
  const norm = (s) => {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const l = Math.hypot(dx, dz) || 1;
    return { dx: dx / l, dz: dz / l, nx: dz / l, nz: -dx / l }; // n = left normal (x east, z south)
  };
  const D = segs.map(norm);
  pts.push([segs[0].ax + D[0].nx * offsets[0], segs[0].az + D[0].nz * offsets[0]]);
  for (let i = 1; i < n; i++) {
    const a = D[i - 1], b = D[i];
    const px = segs[i].ax, pz = segs[i].az;
    const p1 = [px + a.nx * offsets[i - 1], pz + a.nz * offsets[i - 1]];
    const p2 = [px + b.nx * offsets[i], pz + b.nz * offsets[i]];
    const cross = a.dx * b.dz - a.dz * b.dx;
    if (Math.abs(cross) < 0.08) {
      // (almost) collinear: keep both offset points if they differ (width change)
      pts.push(p1);
      if (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) > 0.3) pts.push(p2);
      continue;
    }
    // intersection of the two offset lines
    const t = ((p2[0] - p1[0]) * b.dz - (p2[1] - p1[1]) * b.dx) / cross;
    const ix = p1[0] + a.dx * t, iz = p1[1] + a.dz * t;
    const lim = 3 * Math.max(Math.abs(offsets[i - 1]), Math.abs(offsets[i]), 1);
    if (Math.hypot(ix - px, iz - pz) > lim) { pts.push(p1); pts.push(p2); } else pts.push([ix, iz]);
  }
  const last = segs[n - 1], dl = D[n - 1];
  pts.push([last.bx + dl.nx * offsets[n - 1], last.bz + dl.nz * offsets[n - 1]]);
  return pts;
}

function roundCorners(pts, radius) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1], P = pts[i], B = pts[i + 1];
    const la = Math.hypot(A[0] - P[0], A[1] - P[1]);
    const lb = Math.hypot(B[0] - P[0], B[1] - P[1]);
    if (la < 0.05 || lb < 0.05) continue;
    const ua = [(A[0] - P[0]) / la, (A[1] - P[1]) / la];
    const ub = [(B[0] - P[0]) / lb, (B[1] - P[1]) / lb];
    if (ua[0] * ub[0] + ua[1] * ub[1] < -0.996) { out.push(P); continue; }
    const d = Math.min(radius, la * 0.45, lb * 0.45);
    const p1 = [P[0] + ua[0] * d, P[1] + ua[1] * d];
    const p2 = [P[0] + ub[0] * d, P[1] + ub[1] * d];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10, it = 1 - t;
      out.push([it * it * p1[0] + 2 * it * t * P[0] + t * t * p2[0], it * it * p1[1] + 2 * it * t * P[1] + t * t * p2[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function resample(pts, step) {
  const xs = [pts[0][0]], zs = [pts[0][1]], ss = [0];
  let s = 0, carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 1e-6) continue;
    let d = step - carry;
    while (d <= l) {
      const t = d / l;
      xs.push(ax + (bx - ax) * t); zs.push(az + (bz - az) * t);
      ss.push(s + d);
      d += step;
    }
    carry = l - (d - step);
    s += l;
  }
  if (s - ss[ss.length - 1] > 0.05) {
    const [lx, lz] = pts[pts.length - 1];
    xs.push(lx); zs.push(lz); ss.push(s);
  }
  return { x: Float32Array.from(xs), z: Float32Array.from(zs), s: Float32Array.from(ss), length: s };
}

/**
 * @returns {{x, z, s, length, junctions:number[], legBreak:number|null, end:{x,z}, shop:{x,z}}}
 */
export function buildRoutePath(graph, route, restaurant) {
  const mode = route.mode;
  const segs = [];
  for (const leg of route.legs) {
    for (const h of leg.halves) {
      const a = graph.nodes.get(h.from), b = graph.nodes.get(h.to);
      segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, e: h.e, legMode: leg.mode, deg: b.deg || 0, nodeX: b.x, nodeZ: b.z });
    }
  }
  const shop = { x: restaurant.position.x, z: restaurant.position.z };
  const station = graph.nodes.get(graph.stationId);
  if (!segs.length) segs.push({ ax: station.x, az: station.z, bx: shop.x, bz: shop.z, e: { width: 6, sidewalk: 0, roadType: 'plaza' }, legMode: 'walk', deg: 0 });

  const build = (side) => {
    const offs = segs.map((s) => {
      const m = s.legMode;
      const o = lateral(s.e, m);
      if (m === 'car') return o;                 // keep left
      if (m === 'bike' && mode === 'bike') return o; // bikes keep left too
      return o * side;
    });
    return offsetPolyline(segs, offs);
  };
  let pts;
  if (mode === 'walk' || route.legs.some((l) => l.mode === 'walk')) {
    const L = build(1), R = build(-1);
    const dL = Math.hypot(L.at(-1)[0] - shop.x, L.at(-1)[1] - shop.z);
    const dR = Math.hypot(R.at(-1)[0] - shop.x, R.at(-1)[1] - shop.z);
    pts = dL <= dR ? L : R;
  } else {
    pts = build(1);
  }
  // Start exactly at the station exit; walkers finish under the shop's beacon.
  pts.unshift([station.x, station.z]);
  const lastLeg = route.legs[route.legs.length - 1]?.mode ?? 'walk';
  if (lastLeg !== 'car') pts.push([shop.x, shop.z]);
  // drop near-duplicate points
  pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.25);

  const radius = MODES[mode].tour.radius;
  const smooth = roundCorners(pts, radius);
  const path = resample(smooth, 1);

  const nearestS = (x, z) => {
    let best = Infinity, bs = 0;
    for (let i = 0; i < path.x.length; i++) {
      const d = (path.x[i] - x) ** 2 + (path.z[i] - z) ** 2;
      if (d < best) { best = d; bs = path.s[i]; }
    }
    return bs;
  };
  path.junctions = segs.filter((s) => s.deg >= 3).map((s) => nearestS(s.nodeX, s.nodeZ));
  path.legBreak = null;
  if (route.legs.length > 1) {
    const firstWalk = segs.findIndex((s) => s.legMode === 'walk');
    if (firstWalk > 0) path.legBreak = nearestS(segs[firstWalk].ax, segs[firstWalk].az);
  }
  path.end = { x: path.x[path.x.length - 1], z: path.z[path.z.length - 1] };
  path.shop = shop;
  path.mode = mode;
  return path;
}

/** Sample position/tangent at arc length s. */
export function samplePath(path, s) {
  const n = path.s.length;
  if (s <= 0) return at(path, 0, 0);
  if (s >= path.length) return at(path, n - 2, 1);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (path.s[m] <= s) lo = m; else hi = m;
  }
  const t = (s - path.s[lo]) / Math.max(1e-6, path.s[hi] - path.s[lo]);
  return at(path, lo, t);
}
function at(path, i, t) {
  const j = Math.min(i + 1, path.x.length - 1);
  const x = path.x[i] + (path.x[j] - path.x[i]) * t;
  const z = path.z[i] + (path.z[j] - path.z[i]) * t;
  let dx = path.x[j] - path.x[i], dz = path.z[j] - path.z[i];
  const l = Math.hypot(dx, dz) || 1;
  return { x, z, dx: dx / l, dz: dz / l };
}
