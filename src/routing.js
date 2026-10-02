// Offline routing on the static road graph.
// Edge-based A* (state = the half-edge we arrived on) so turn and signal penalties are exact.

import { MODES, MODE_ORDER } from './config.js';
import { formatMinutes, formatDistance } from './util.js';

const STRAIGHT = (32 * Math.PI) / 180;
const UTURN = (150 * Math.PI) / 180;
const MAJOR = new Set(['avenue', 'street']);

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function project(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - a.x) * dx + (pz - a.z) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + dx * t, z = a.z + dz * t;
  return { t, x, z, dist: Math.hypot(px - x, pz - z) };
}

export class RoadGraph {
  constructor(roads, restaurants) {
    this.nodes = new Map();
    for (const n of roads.nodes) this.nodes.set(n.id, { ...n });
    this.edges = roads.edges.map((e) => ({ ...e }));
    this.stationId = roads.stationNodeId;
    this.streetName = Object.fromEntries(roads.streets.map((s) => [s.id, s.name]));
    this.shopNode = new Map();
    this._insertShops(restaurants);
    this._build();
    this.cache = new Map();
  }

  /** Split edges so every restaurant gets its own routing node on the street in front of it. */
  _insertShops(restaurants) {
    const byEdge = new Map();
    for (const r of restaurants) {
      if (r.nodeId && this.nodes.has(r.nodeId)) { this.shopNode.set(r.id, r.nodeId); continue; }
      let best = null;
      for (const e of this.edges) {
        if (e.roadType === 'passage' || e.roadType === 'plaza') continue;
        const pr = project(r.position.x, r.position.z, this.nodes.get(e.from), this.nodes.get(e.to));
        if (!best || pr.dist < best.pr.dist) best = { e, pr };
      }
      const { e, pr } = best;
      if (pr.t * e.distance < 2) { this.shopNode.set(r.id, e.from); continue; }
      if ((1 - pr.t) * e.distance < 2) { this.shopNode.set(r.id, e.to); continue; }
      if (!byEdge.has(e)) byEdge.set(e, []);
      byEdge.get(e).push({ r, t: pr.t, x: pr.x, z: pr.z });
    }
    for (const [e, list] of byEdge) {
      list.sort((p, q) => p.t - q.t);
      this.edges.splice(this.edges.indexOf(e), 1);
      let prev = e.from, k = 0, prevT = 0;
      for (const item of list) {
        if ((item.t - prevT) * e.distance < 1 && prev !== e.from) { this.shopNode.set(item.r.id, prev); continue; }
        const id = 'shop:' + item.r.id;
        this.nodes.set(id, { id, x: item.x, z: item.z, shop: item.r.id });
        this.shopNode.set(item.r.id, id);
        this.edges.push(this._sub(e, prev, id, k++));
        prev = id;
        prevT = item.t;
      }
      this.edges.push(this._sub(e, prev, e.to, k));
    }
  }

  _sub(e, from, to, k) {
    const a = this.nodes.get(from), b = this.nodes.get(to);
    return { ...e, id: `${e.id}.${k}`, from, to, distance: Math.hypot(b.x - a.x, b.z - a.z) };
  }

  _build() {
    this.out = new Map();
    this.halves = [];
    const neighbours = new Map();
    for (const id of this.nodes.keys()) { this.out.set(id, []); neighbours.set(id, new Set()); }
    for (const e of this.edges) {
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      const len = Math.max(0.01, Math.hypot(b.x - a.x, b.z - a.z));
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const fwd = { i: this.halves.length, e, from: e.from, to: e.to, fwd: true, dx, dz, len };
      this.halves.push(fwd);
      const back = { i: this.halves.length, e, from: e.to, to: e.from, fwd: false, dx: -dx, dz: -dz, len };
      this.halves.push(back);
      this.out.get(e.from).push(fwd);
      this.out.get(e.to).push(back);
      neighbours.get(e.from).add(e.to);
      neighbours.get(e.to).add(e.from);
    }
    for (const [id, set] of neighbours) this.nodes.get(id).deg = set.size;
  }

  allowed(h, mode) {
    if (!h.e[mode]) return false;
    if (mode === 'car' && h.e.oneway === 'forward' && !h.fwd) return false;
    return true;
  }

  speed(h, M) {
    return M.speed[h.e.roadType] || M.speed.street || 1;
  }

  /** Real-time penalty for passing through `nodeId` from half-edge `a` into `b`. */
  nodePenalty(a, b, nodeId, M) {
    const n = this.nodes.get(nodeId);
    const cross = a.dx * b.dz - a.dz * b.dx;
    const dot = a.dx * b.dx + a.dz * b.dz;
    const ang = Math.atan2(cross, dot); // >0 : right turn (x east, z south)
    const turning = Math.abs(ang) > STRAIGHT && (n.deg || 0) >= 3;
    const bend = Math.abs(ang) > STRAIGHT && !turning; // the street itself bends
    let t = 0;
    if (turning) t += ang > 0 ? M.turn.right : M.turn.left;
    if (Math.abs(ang) > UTURN) t += 40;
    if (n.signal) {
      let f = 0.5;
      if (turning) f = M.id === 'car' ? (ang > 0 ? 1.1 : 0.6) : 0.9;
      t += M.signal * f;
    } else if (n.major && M.majorCross && a.e.roadType !== 'avenue' && b.e.roadType !== 'avenue') {
      t += M.majorCross; // crossing the avenue without lights
    }
    return { t, turning, bend, signal: !!n.signal };
  }

  /** A* search. profile: fastest | easy | scenic. Returns array of half-edges or null. */
  search(fromId, toId, mode, profile = 'fastest') {
    if (fromId === toId) return [];
    const M = MODES[mode];
    const target = this.nodes.get(toId);
    const vmax = Math.max(...Object.values(M.speed));
    const hScale = profile === 'scenic' ? 0.5 : 1;
    const heur = (id) => {
      const n = this.nodes.get(id);
      return (Math.hypot(n.x - target.x, n.z - target.z) / vmax) * hScale;
    };
    const best = new Map();
    const parent = new Map();
    const heap = new MinHeap();
    heap.push({ key: -1, node: fromId, half: null, g: 0, f: heur(fromId) });
    best.set(-1, 0);
    while (heap.size) {
      const cur = heap.pop();
      if (cur.g > (best.get(cur.key) ?? Infinity)) continue;
      if (cur.node === toId) {
        const path = [];
        let k = cur.key;
        while (k !== -1) { path.push(this.halves[k]); k = parent.get(k); }
        return path.reverse();
      }
      for (const h of this.out.get(cur.node)) {
        if (!this.allowed(h, mode)) continue;
        if (cur.half && h.e === cur.half.e) continue; // no U-turn on the same street segment
        const real = h.len / this.speed(h, M);
        let cost = real;
        if (profile === 'easy') cost = real * (MAJOR.has(h.e.roadType) ? 1 : 1.15);
        else if (profile === 'scenic') cost = real * (1.3 - 0.75 * (h.e.scenic ?? 0.2));
        if (cur.half) {
          const p = this.nodePenalty(cur.half, h, cur.node, M);
          cost += p.t;
          if (profile === 'easy') cost += (p.turning ? 50 : 0) + (p.signal ? 6 : 0);
          else if (p.turning) cost += 5; // tie-break: among equal grid paths prefer fewer turns
        }
        const g = cur.g + cost;
        if (g < (best.get(h.i) ?? Infinity)) {
          best.set(h.i, g);
          parent.set(h.i, cur.key);
          heap.push({ key: h.i, node: h.to, half: h, g, f: g + heur(h.to) });
        }
      }
    }
    return null;
  }

  evaluateLeg(halves, mode) {
    const M = MODES[mode];
    let time = 0, distance = 0, turns = 0, signals = 0, scenic = 0;
    for (let i = 0; i < halves.length; i++) {
      const h = halves[i];
      time += h.len / this.speed(h, M);
      distance += h.len;
      scenic += h.len * (h.e.scenic ?? 0.2);
      if (i > 0) {
        const p = this.nodePenalty(halves[i - 1], h, h.from, M);
        time += p.t;
        if (p.turning) turns++;
        if (p.signal) signals++;
      }
    }
    return { time, distance, turns, signals, scenicSum: scenic };
  }

  _buildRoute(legs, mode, profile) {
    const M = MODES[mode];
    let time = M.start + M.end, distance = 0, turns = 0, signals = 0, scenicSum = 0, walkDistance = 0;
    const streets = [];
    for (const leg of legs) {
      const ev = this.evaluateLeg(leg.halves, leg.mode);
      time += ev.time;
      distance += ev.distance;
      turns += ev.turns;
      signals += ev.signals;
      scenicSum += ev.scenicSum;
      if (leg.mode === 'walk' && mode === 'car') walkDistance += ev.distance;
      for (const h of leg.halves) {
        const name = this.streetName[h.e.street];
        if (name && streets[streets.length - 1] !== name) streets.push(name);
      }
    }
    if (legs.length > 1) turns += 1;
    return {
      mode, profile, legs, time, distance, turns, signals, walkDistance,
      scenic: distance ? scenicSum / distance : 0,
      streets,
      key: legs.map((l) => l.halves.map((h) => h.i).join(',')).join('|'),
    };
  }

  route(shopId, mode, profile = 'fastest') {
    const to = this.shopNode.get(shopId);
    const from = this.stationId;
    if (mode !== 'car') {
      const halves = this.search(from, to, mode, profile);
      if (!halves) return null;
      return this._buildRoute([{ mode, halves }], mode, profile);
    }
    // Car: drive to the best car-accessible node near the shop, then walk the rest (e.g. 縄手通り).
    const target = this.nodes.get(to);
    const candidates = [];
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - target.x, n.z - target.z);
      if (d > 320) continue;
      if (!this.out.get(n.id).some((h) => this.allowed(h, 'car') || this.allowed(this.halves[h.i ^ 1], 'car'))) continue;
      candidates.push(n.id);
    }
    let best = null;
    for (const c of candidates) {
      const drive = this.search(from, c, 'car', profile);
      if (!drive) continue;
      const walk = c === to ? [] : this.search(c, to, 'walk', 'fastest');
      if (!walk) continue;
      const legs = [{ mode: 'car', halves: drive }];
      if (walk.length) legs.push({ mode: 'walk', halves: walk });
      const r = this._buildRoute(legs, 'car', profile);
      const score = r.time + (profile === 'easy' ? r.turns * 40 : 0) - (profile === 'scenic' ? r.scenic * 120 : 0);
      if (!best || score < best.score) best = { r, score };
    }
    return best ? best.r : null;
  }

  /** All modes × variants for one shop (memoised). */
  routesFor(shopId) {
    if (this.cache.has(shopId)) return this.cache.get(shopId);
    const out = {};
    for (const mode of MODE_ORDER) {
      out[mode] = {};
      for (const v of ['fastest', 'easy', 'scenic']) out[mode][v] = this.route(shopId, mode, v);
      // A variant that is slower than "fastest" while saving nothing is pointless — fall back.
      const f = out[mode].fastest;
      for (const v of ['easy', 'scenic']) {
        const r = out[mode][v];
        if (!r || !f) continue;
        r.sameAsFastest = r.key === f.key;
        if (v === 'easy' && r.turns >= f.turns && r.time > f.time) { out[mode][v] = { ...f, profile: 'easy', sameAsFastest: true }; }
      }
    }
    out.best = recommend(out);
    this.cache.set(shopId, out);
    return out;
  }
}

/** Rule-based recommendation (no AI). Returns { mode, variant, reason }. */
export function recommend(routes) {
  const w = routes.walk.fastest, b = routes.bike.fastest, c = routes.car.fastest;
  const W = w?.time ?? Infinity, B = b?.time ?? Infinity, C = c?.time ?? Infinity;
  let mode, reason;
  if (W <= 8 * 60) {
    mode = 'walk';
    reason = w.turns <= 1 ? '駅からほぼ一直線。歩いてすぐの距離です。' : '歩いてすぐの距離。乗り物は準備の手間のほうが大きくなります。';
  } else if (C >= W * 0.72) {
    mode = 'walk';
    reason = w.turns <= 2 ? '車との差が小さく、駅からほぼ一直線です。' : '車との差が小さく、駐車の手間を考えると歩きが快適です。';
  } else if (W <= 16 * 60) {
    if (W > 12 * 60 && B <= W * 0.55) {
      mode = 'bike';
      reason = `歩くと少し距離があります。自転車なら約${formatMinutes(W - B)}分短縮できます。`;
    } else {
      mode = 'walk';
      reason = '街並みを眺めながら歩くのにちょうどいい距離です。';
    }
  } else if (B <= C + 90) {
    mode = 'bike';
    reason = '車と同じくらいの時間で、駐車の心配もありません。';
  } else {
    mode = 'car';
    reason = '距離があるので車が便利です。近くに停めて少し歩きます。';
  }
  if (mode === 'car' && c?.walkDistance > 30) reason = `車で近くまで行き、最後の${formatDistance(c.walkDistance)}を歩きます。`;

  // Pick the variant inside the recommended mode.
  const set = routes[mode];
  let variant = 'fastest';
  const f = set.fastest;
  if (mode !== 'car' && set.scenic && !set.scenic.sameAsFastest && set.scenic.time <= f.time * 1.18 + 30 && set.scenic.scenic > f.scenic + 0.12) {
    variant = 'scenic';
    const nice = set.scenic.streets.filter((s) => /中町|縄手|川|小径|大名町/.test(s));
    const extra = formatMinutes(set.scenic.time - f.time + 1) - 1;
    const verb = mode === 'bike' ? '走れる' : '歩ける';
    reason = `${extra > 0 ? `+${extra}分で` : '同じくらいの時間で'}${nice.length ? nice.slice(0, 2).join('・') + 'を' : '街並みを'}${verb}ルートです。`;
  } else if (set.easy && !set.easy.sameAsFastest && set.easy.turns < f.turns && set.easy.time <= f.time * 1.12 + 20) {
    variant = 'easy';
    reason += ` 曲がり角が${f.turns - set.easy.turns}回少ない道を推奨。`;
  }
  return { mode, variant, reason, route: set[variant] };
}
