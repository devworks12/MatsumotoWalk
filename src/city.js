import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { U, createBuildingMaterial, litMaterial, createWaterMaterial, createMountainMaterial, onNightChange, patchDim } from './materials.js';
import { mulberry32 } from './util.js';
import { WORLD } from './config.js';

const Y = { ground: 0, sidewalk: 0.06, water: 0.09, paving: 0.11, road: 0.12, mark: 0.17 };

// -----------------------------------------------------------------------------
// Flat geometry builder (all road layers are merged into a handful of draw calls)
// -----------------------------------------------------------------------------
class Flat {
  constructor() { this.p = []; }
  tri(a, b, c, y) { this.p.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]); }
  quad(a, b, c, d, y) { this.tri(a, b, c, y); this.tri(a, c, d, y); }
  /** Oriented rectangle centred on (cx,cz), length along `ang`. */
  rect(cx, cz, len, w, ang, y) {
    const c = Math.cos(ang), s = Math.sin(ang), hl = len / 2, hw = w / 2;
    const P = (u, v) => [cx + u * c - v * s, cz + u * s + v * c];
    this.quad(P(-hl, -hw), P(-hl, hw), P(hl, hw), P(hl, -hw), y);
  }
  ribbon(ax, az, bx, bz, w, y) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return;
    this.rect((ax + bx) / 2, (az + bz) / 2, len, w, Math.atan2(bz - az, bx - ax), y);
  }
  disc(cx, cz, r, y, seg = 20) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri([cx, cz], [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], y);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    // make every triangle face up (+y): fix winding where needed
    const p = this.p;
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vz = p[i + 8] - p[i + 2];
      const ny = uz * vx - ux * vz;
      if (ny < 0) {
        for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const n = new Float32Array(p.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.computeBoundingSphere();
    return g;
  }
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function compose(x, y, z, ry, sx, sy, sz) {
  tmpQ.setFromAxisAngle(UP, ry);
  return tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
}

// -----------------------------------------------------------------------------
export class City {
  constructor(stage, data) {
    this.stage = stage;
    this.scene = stage.scene;
    this.roads = data.roads;
    this.bdata = data.buildings;
    this.restaurants = data.restaurants;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.nodeById = new Map(this.roads.nodes.map((n) => [n.id, n]));
    this.shopBuildings = new Map();
    this.labels = [];
    this.rng = mulberry32(7);
    // Computed helpers shared with props
    this.junctionR = new Map();
    for (const n of this.roads.nodes) this.junctionR.set(n.id, { road: 0, walk: 0, deg: 0, kinds: new Set() });
    for (const e of this.roads.edges) {
      for (const id of [e.from, e.to]) {
        const j = this.junctionR.get(id);
        j.road = Math.max(j.road, e.width / 2);
        j.walk = Math.max(j.walk, e.width / 2 + e.sidewalk);
        j.deg++;
        j.kinds.add(e.roadType);
      }
    }
  }

  /** Build in steps so the loader can show progress. */
  steps() {
    return [
      ['Laying the ground…', () => this.buildGround()],
      ['Paving streets…', () => this.buildRoads()],
      ['Filling the river…', () => this.buildRiver()],
      ['Laying the tracks…', () => this.buildRailway()],
      ['Raising buildings…', () => this.buildBuildings()],
      ['Building Matsumoto Station…', () => this.buildStation()],
      ['Restoring the castle…', () => this.buildCastle()],
      ['Drawing the Alps…', () => this.buildMountains()],
      ['Painting street names…', () => this.buildStreetNames()],
    ];
  }

  // ---------------------------------------------------------------------------
  buildGround() {
    // Soft "blob" shadow / AO map baked from building footprints into the ground texture.
    const X0 = -520, Z0 = -1520, W = 2080, H = 2380;
    this.groundRect = { X0, Z0, W, H };
    const scale = 0.5; // px per metre
    const tex = canvasTexture(Math.round(W * scale), Math.round(H * scale), (g, cw, ch) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, cw, ch);
      g.fillStyle = 'rgba(40,36,30,0.11)';
      for (const b of this.bdata.items) {
        const [x, z, w, d, h, rot] = b;
        const grow = Math.min(5, 1.5 + h * 0.06);
        g.save();
        g.translate((x - X0) * scale, (z - Z0) * scale);
        g.rotate((rot * Math.PI) / 180);
        for (let k = 3; k >= 0; k--) {
          const e = grow * (k / 3);
          g.fillRect((-w / 2 - e) * scale, (-d / 2 - e) * scale, (w + 2 * e) * scale, (d + 2 * e) * scale);
        }
        g.restore();
      }
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = litMaterial(0xcfc8bb, { map: tex });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(X0 + W / 2, Y.ground, Z0 + H / 2);
    plane.receiveShadow = true;
    this.group.add(plane);
    // Endless outer ground (same colour, no texture)
    const outer = new THREE.Mesh(new THREE.CircleGeometry(9000, 48), litMaterial(0xcfc8bb));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(380, -0.03, -200);
    this.group.add(outer);
    this.groundMat = mat;
    this.outerGroundMat = outer.material;
  }

  // ---------------------------------------------------------------------------
  buildRoads() {
    const sidewalk = new Flat(), road = new Flat(), paving = new Flat(), plaza = new Flat(), marks = new Flat(), grass = new Flat();
    const nodes = this.nodeById;
    const PAVED = new Set(['pedestrian', 'shotengai', 'passage']);

    for (const e of this.roads.edges) {
      const a = nodes.get(e.from), b = nodes.get(e.to);
      if (e.roadType === 'plaza') {
        plaza.ribbon(a.x, a.z, b.x, b.z, e.width, Y.paving);
        continue;
      }
      if (e.sidewalk > 0) sidewalk.ribbon(a.x, a.z, b.x, b.z, e.width + e.sidewalk * 2, Y.sidewalk);
      (PAVED.has(e.roadType) ? paving : road).ribbon(a.x, a.z, b.x, b.z, e.width, PAVED.has(e.roadType) ? Y.paving : Y.road);
    }
    for (const n of this.roads.nodes) {
      const j = this.junctionR.get(n.id);
      if (j.walk > j.road) sidewalk.disc(n.x, n.z, j.walk, Y.sidewalk, 24);
      const onlyPaved = [...j.kinds].every((k) => PAVED.has(k) || k === 'plaza');
      if (j.kinds.has('plaza') && onlyPaved) continue;
      (onlyPaved ? paving : road).disc(n.x, n.z, j.road, onlyPaved ? Y.paving : Y.road, 24);
    }
    // Decorative outskirts streets
    for (const [x0, z0, x1, z1, w] of this.roads.decor) {
      sidewalk.ribbon(x0, z0, x1, z1, w + 3, Y.sidewalk);
      road.ribbon(x0, z0, x1, z1, w, Y.road);
    }

    // Lane markings + crosswalks
    for (const e of this.roads.edges) {
      if (e.roadType !== 'avenue' && e.roadType !== 'street') continue;
      const a = nodes.get(e.from), b = nodes.get(e.to);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len, nx = -dz, nz = dx;
      const ja = this.junctionR.get(e.from), jb = this.junctionR.get(e.to);
      const trimA = ja.deg >= 3 ? ja.walk + 5.5 : 0, trimB = jb.deg >= 3 ? jb.walk + 5.5 : 0;
      const ang = Math.atan2(dz, dx);
      // centre line + lane dashes
      for (let s = trimA; s < len - trimB; s += 6) {
        const l = Math.min(3, len - trimB - s);
        const cx = a.x + dx * (s + l / 2), cz = a.z + dz * (s + l / 2);
        if (e.roadType === 'avenue') {
          marks.rect(cx + nx * 0.18, cz + nz * 0.18, l + 3, 0.16, ang, Y.mark);
          marks.rect(cx - nx * 0.18, cz - nz * 0.18, l + 3, 0.16, ang, Y.mark);
          marks.rect(cx + nx * 5, cz + nz * 5, l, 0.15, ang, Y.mark);
          marks.rect(cx - nx * 5, cz - nz * 5, l, 0.15, ang, Y.mark);
        } else {
          marks.rect(cx, cz, l, 0.15, ang, Y.mark);
        }
      }
      // zebra crossings at signalised junction ends
      for (const [node, j, sign] of [[a, ja, 1], [b, jb, -1]]) {
        if (!node.signal) continue;
        const off = j.walk + 2.6;
        const cx = node.x + dx * off * sign, cz = node.z + dz * off * sign;
        const stripes = Math.floor(e.width / 1.0);
        for (let k = 0; k < stripes; k++) {
          const lat = -e.width / 2 + 0.6 + k * 1.0;
          if (lat > e.width / 2 - 0.4) break;
          marks.rect(cx + nx * lat, cz + nz * lat, 3.6, 0.48, ang, Y.mark);
        }
        // stop line
        const sl = off + 3.2;
        marks.rect(node.x + dx * sl * sign + nx * (e.width / 4) * sign, node.z + dz * sl * sign + nz * (e.width / 4) * sign, 0.35, e.width / 2, ang, Y.mark);
      }
    }

    // Station forecourt & bus/taxi rotary
    plaza.quad([0, -62], [110, -62], [110, 62], [0, 62], Y.paving);
    plaza.quad([-150, -36], [-112, -36], [-112, 36], [-150, 36], Y.paving);
    const RT = WORLD.rotary;
    road.disc(RT.x, RT.z, RT.r, Y.road + 0.005, 40);
    road.ribbon(RT.x + RT.r - 4, RT.z, 110, RT.z, 9, Y.road + 0.005); // rotary exit to 駅前東通り
    grass.disc(RT.x, RT.z, RT.r - 10, Y.road + 0.02, 40);
    // park and castle lawns
    grass.quad([232, 122], [358, 122], [358, 258], [232, 258], Y.sidewalk + 0.01);

    const plazaTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 2;
      for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke(); }
    });
    plazaTex.wrapS = plazaTex.wrapT = THREE.RepeatWrapping;
    const plazaGeo = plaza.geometry();
    // world-space UVs for the tile texture (one tile = 1.5 m)
    const pp = plazaGeo.attributes.position;
    const uv = new Float32Array(pp.count * 2);
    for (let i = 0; i < pp.count; i++) { uv[i * 2] = pp.getX(i) / 12; uv[i * 2 + 1] = pp.getZ(i) / 12; }
    plazaGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    const add = (geo, mat, receive = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = receive;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      return m;
    };
    this.mats = {
      sidewalk: litMaterial(0xb7b0a4, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      road: litMaterial(0x3c3e43, { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      paving: litMaterial(0xa89f90, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      plaza: litMaterial(0xc4bcad, { map: plazaTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      marks: litMaterial(0xe8e1d2, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      grass: litMaterial(0x9ca486, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    };
    add(sidewalk.geometry(), this.mats.sidewalk);
    add(road.geometry(), this.mats.road);
    add(paving.geometry(), this.mats.paving);
    add(plazaGeo, this.mats.plaza);
    add(marks.geometry(), this.mats.marks);
    add(grass.geometry(), this.mats.grass);

    // Rotary island details: fountain + low ring wall
    const fountain = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.6, 0.8, 32), litMaterial(0xd9d2c4));
    fountain.position.set(WORLD.rotary.x, 0.4, WORLD.rotary.z);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3.6, 32), createWaterMaterial());
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(WORLD.rotary.x, 0.82, WORLD.rotary.z);
    this.group.add(fountain, pool);
  }

  // ---------------------------------------------------------------------------
  buildRiver() {
    const { points, width } = this.roads.river;
    const water = new Flat(), bank = new Flat();
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      water.ribbon(ax, az, bx, bz, width, Y.water);
      bank.ribbon(ax, az, bx, bz, width + 5, Y.water - 0.01);
      if (i > 0) { water.disc(ax, az, width / 2, Y.water, 16); bank.disc(ax, az, width / 2 + 2.5, Y.water - 0.01, 16); }
    }
    const wm = new THREE.Mesh(water.geometry(), createWaterMaterial());
    wm.material.polygonOffset = true; wm.material.polygonOffsetFactor = -1.5; wm.material.polygonOffsetUnits = -1.5;
    const bm = new THREE.Mesh(bank.geometry(), litMaterial(0x8f8a80, { polygonOffset: true, polygonOffsetFactor: -1.2, polygonOffsetUnits: -1.2 }));
    wm.receiveShadow = bm.receiveShadow = true;
    this.group.add(bm, wm);

    // Low parapets along both banks, skipped where streets cross (those read as bridges)
    const crossing = (x, z) => {
      for (const e of this.roads.edges) {
        const a = this.nodeById.get(e.from), b = this.nodeById.get(e.to);
        if (distToSeg(x, z, a.x, a.z, b.x, b.z) < e.width / 2 + e.sidewalk + 1.2) return true;
      }
      for (const [x0, z0, x1, z1, w] of this.roads.decor) if (distToSeg(x, z, x0, z0, x1, z1) < w / 2 + 2.5) return true;
      return false;
    };
    const posts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let s = 2; s < len - 2; s += 5) {
        for (const side of [-1, 1]) {
          const x = ax + dx * s - dz * side * (width / 2 + 1.6);
          const z = az + dz * s + dx * side * (width / 2 + 1.6);
          if (!crossing(x, z)) posts.push([x, z, -Math.atan2(dz, dx)]);
        }
      }
    }
    const pg = new THREE.BoxGeometry(5.1, 0.85, 0.35).translate(0, 0.42, 0);
    const pm = new THREE.InstancedMesh(pg, litMaterial(0xa59f93), posts.length);
    posts.forEach(([x, z, r], i) => pm.setMatrixAt(i, compose(x, 0, z, r, 1, 1, 1)));
    pm.computeBoundingSphere();
    this.group.add(pm);
    // bridge rails where streets cross the river
    this.riverCrossings = [];
  }

  // ---------------------------------------------------------------------------
  buildRailway() {
    const ballast = new Flat();
    ballast.quad([-108, -2600], [-26, -2600], [-26, 2600], [-108, 2600], Y.sidewalk);
    const bm = new THREE.Mesh(ballast.geometry(), litMaterial(0x77706a, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    bm.receiveShadow = true;
    this.group.add(bm);
    this.trackX = [-96, -80, -54, -38];
    const rail = new THREE.BoxGeometry(0.12, 0.16, 5200).translate(0, 0.24, 0);
    const rails = new THREE.InstancedMesh(rail, litMaterial(0x8d8f94, { metalness: 0.5, roughness: 0.4 }), this.trackX.length * 2);
    let k = 0;
    for (const x of this.trackX) for (const o of [-0.54, 0.54]) rails.setMatrixAt(k++, compose(x + o, 0, 0, 0, 1, 1, 1));
    rails.computeBoundingSphere();
    this.group.add(rails);
    // island platforms
    const plat = litMaterial(0xcbc4b6);
    for (const x of [-88, -46]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(9, 1.1, 300).translate(0, 0.55, 0), plat);
      p.position.set(x, 0, 0);
      p.castShadow = p.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.35, 190).translate(0, 4.6, 0), litMaterial(0x8a8d93));
      roof.position.set(x, 0, 0);
      roof.castShadow = true;
      this.group.add(p, roof);
      const postG = new THREE.CylinderGeometry(0.15, 0.15, 3.6, 6).translate(0, 2.9, 0);
      const posts = new THREE.InstancedMesh(postG, litMaterial(0x6c6f75), 20);
      for (let i = 0; i < 20; i++) posts.setMatrixAt(i, compose(x, 0, -90 + i * 9.5, 0, 1, 1, 1));
      posts.computeBoundingSphere();
      this.group.add(posts);
    }
    // catenary masts
    const mastG = mergeGeometries([
      new THREE.BoxGeometry(0.3, 7.5, 0.3).translate(0, 3.75, 0),
      new THREE.BoxGeometry(70, 0.25, 0.25).translate(35, 7.3, 0),
    ]);
    const n = Math.floor(5000 / 55);
    const masts = new THREE.InstancedMesh(mastG, litMaterial(0x6f7176), n);
    for (let i = 0; i < n; i++) {
      const z = -2500 + i * 55;
      if (Math.abs(z) < 160) masts.setMatrixAt(i, compose(0, -1000, 0, 0, 0.0001, 0.0001, 0.0001));
      else masts.setMatrixAt(i, compose(-102, 0, z, 0, 1, 1, 1));
    }
    masts.computeBoundingSphere();
    this.group.add(masts);
  }

  // ---------------------------------------------------------------------------
  buildBuildings() {
    const items = this.bdata.items;
    const shops = this.bdata.shops || {};
    const landmarks = this.bdata.landmarks || {};
    const COLORS = {
      modern: ['#e9e3d7', '#ddd6c9', '#d1cabd', '#e4dccd', '#c4bdb0', '#d8d0c1', '#ebe7df', '#b9b3a8'],
      shop: ['#e6ddcc', '#d9cfbd', '#efe8db', '#cfc6b6'],
      kura: ['#f1ece2', '#ece6da', '#f4f0e8'],
      wood: ['#4a3d33', '#55463a', '#3f342c'],
      accent: ['#5d5f63', '#6e6c68', '#8b8f95'],
    };
    const bg = [], detail = [], roofs = [];
    const rnd = mulberry32(99);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    for (let i = 0; i < items.length; i++) {
      const [x, z, w, d, h, rotDeg, type, seed] = items[i];
      const ry = -(rotDeg * Math.PI) / 180;
      const shopId = shops[i];
      if (landmarks[i]) { this._landmark(landmarks[i], items[i], detail); continue; }
      let color;
      if (type === 2) color = pick(COLORS.kura);
      else if (type === 3) color = pick(COLORS.wood);
      else if (type === 1) color = pick(COLORS.shop);
      else color = rnd() < 0.08 ? pick(COLORS.accent) : pick(COLORS.modern);
      const entry = { x, z, w, d, h, ry, type, seed, color };
      if (shopId || type === 2 || type === 3) detail.push(entry);
      else bg.push(entry);
      if (type === 2 || type === 3) {
        const along = w >= d;
        roofs.push({ x, z, y: h, ry: ry + (along ? 0 : Math.PI / 2), len: (along ? w : d) + 0.9, dep: (along ? d : w) + 0.9, rh: Math.min(w, d) * (type === 2 ? 0.3 : 0.24), color: type === 2 ? '#3a3c41' : '#2f2925' });
      }
      if (shopId) this.shopBuildings.set(shopId, { x, z, w, d, h, ry });
      // rooftop plant on taller modern buildings
      if (!shopId && type === 0 && h > 14 && rnd() < 0.45) {
        const pw = Math.min(w * 0.35, 6), pd = Math.min(d * 0.35, 5);
        const ox = (rnd() - 0.5) * (w - pw) * 0.6, oz = (rnd() - 0.5) * (d - pd) * 0.6;
        const c = Math.cos(-ry), s = Math.sin(-ry);
        bg.push({ x: x + ox * c - oz * s, z: z + ox * s + oz * c, w: pw, d: pd, h: h + 2.2, ry, type: 0, seed: seed + 1, color: '#a9a49b', base: h });
      }
    }
    const mat = createBuildingMaterial();
    this.buildingMaterial = mat;
    const make = (list, cast) => {
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const aType = new Float32Array(list.length), aSeed = new Float32Array(list.length);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const col = new THREE.Color();
      list.forEach((b, i) => {
        const base = b.base ?? 0;
        mesh.setMatrixAt(i, compose(b.x, base, b.z, b.ry, b.w, b.h - base, b.d));
        mesh.setColorAt(i, col.set(b.color));
        aType[i] = b.type;
        aSeed[i] = b.seed;
      });
      geo.setAttribute('aType', new THREE.InstancedBufferAttribute(aType, 1));
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      return mesh;
    };
    this.bgBuildings = make(bg, true); // static shadows: rendered once, cheap afterwards
    this.detailBuildings = make(detail, true);

    // Gable roofs for 蔵 and 町家
    const roofGeo = gableGeometry();
    const roofMesh = new THREE.InstancedMesh(roofGeo, litMaterial(0xffffff, { flatShading: true, roughness: 0.75 }), roofs.length);
    const col = new THREE.Color();
    roofs.forEach((r, i) => {
      roofMesh.setMatrixAt(i, compose(r.x, r.y, r.z, r.ry, r.len, r.rh, r.dep));
      roofMesh.setColorAt(i, col.set(r.color));
    });
    roofMesh.castShadow = true;
    roofMesh.computeBoundingSphere();
    this.group.add(roofMesh);
  }

  _landmark(info, item, out) {
    const [x, z, w, d, h, rotDeg, , seed] = item;
    const ry = -(rotDeg * Math.PI) / 180;
    const P = (dx, dz, pw, pd, ph, base = 0, color = '#e2dcd0', type = 0) => out.push({ x: x + dx, z: z + dz, w: pw, d: pd, h: ph, base, ry, type, seed: seed + out.length, color });
    switch (info.kind) {
      case 'tower': // station hotel: podium + slender glass tower + crown
        P(0, 0, w, d, 9, 0, '#d9d2c5', 0);
        P(-3, 0, w - 14, d - 8, h, 9, '#8f979f', 4);
        P(-3, 0, w - 18, d - 12, h + 4, h, '#2f3237', 0);
        break;
      case 'dept': // station department store
        P(0, 0, w, d, h, 0, '#e8e2d6', 0);
        P(0, 0, w + 1, d + 1, 3.2, h - 3.2, '#b48a5a', 0);
        P(8, 8, 14, 12, h + 5, h, '#cfc9be', 0);
        break;
      case 'mall':
        P(0, 0, w, d, h, 0, '#ddd7cb', 0);
        P(w / 2 - 8, -d / 2 + 8, 16, 16, h + 6, 0, '#86909a', 4);
        break;
      case 'hall': // civic hall with a deep flat roof
        P(0, 0, w - 8, d - 8, h - 1.2, 0, '#c9c2b5', 4);
        P(0, 0, w + 4, d + 4, h, h - 1.2, '#efebe3', 0);
        break;
      default:
        P(0, 0, w, d, h);
    }
  }

  // ---------------------------------------------------------------------------
  buildStation() {
    const g = new THREE.Group();
    const concrete = litMaterial(0xe7e1d5);
    const darkStone = litMaterial(0x77736c);
    const glass = new THREE.MeshStandardMaterial({ color: 0x5a6672, roughness: 0.16, metalness: 0.35, emissive: 0xffd2a0, emissiveIntensity: 0 });
    patchDim(glass, 0.3);
    const canopyMat = litMaterial(0xd8d1c4);
    const box = (w, h, d, x, y, z, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y + h / 2, z);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    // main hall (east / お城口)
    box(34, 19, 120, 12, 0, 0, concrete);
    box(36, 1.2, 122, 12, 19, 0, darkStone);
    // glazed atrium facing the plaza
    const atrium = box(10, 17, 42, 31, 0, 0, glass);
    // mullions
    for (let i = -4; i <= 4; i++) box(0.35, 17, 0.35, 36.1, 0, i * 4.8, darkStone);
    box(0.4, 0.4, 42, 36.2, 8.4, 0, darkStone);
    // big cantilevered canopy over the entrance
    box(22, 0.9, 58, 45, 6.4, 0, canopyMat);
    for (const zz of [-24, -8, 8, 24]) box(0.6, 6.4, 0.6, 54, 0, zz, darkStone);
    // clock tower
    box(14, 32, 12, 14, 0, -40, concrete);
    box(15, 1.2, 13, 14, 32, -40, darkStone);
    // elevated concourse over the tracks
    box(108, 6, 30, -58, 7.5, 0, concrete);
    const corridorGlass = box(108.4, 3, 30.4, -58, 9.2, 0, glass);
    // west (アルプス口) entrance
    box(18, 14, 52, -118, 0, 0, concrete);
    box(4, 11, 28, -128, 0, 0, glass);
    // rooftop equipment
    box(8, 3, 14, 6, 20.2, 30, darkStone);
    box(6, 2.5, 8, 18, 20.2, -12, darkStone);

    // Signage (canvas text — original typography)
    const sign = canvasTexture(1024, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#f4efe6';
      c.textAlign = 'center';
      c.font = '600 132px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
      c.fillText('松本駅', w / 2, 150);
      c.font = '500 38px "Avenir Next","Helvetica Neue",Arial,sans-serif';
      c.letterSpacing = '14px';
      c.fillText('MATSUMOTO STATION', w / 2, 222);
    });
    const signMat = new THREE.MeshBasicMaterial({ map: sign, transparent: true, depthWrite: false, toneMapped: true });
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(24, 6), signMat);
    signMesh.position.set(36.6, 14.2, 0);
    signMesh.rotation.y = Math.PI / 2;
    g.add(signMesh);
    const signBack = new THREE.Mesh(new THREE.PlaneGeometry(26, 7), new THREE.MeshBasicMaterial({ color: 0x23262b }));
    signBack.position.set(36.45, 14.2, 0);
    signBack.rotation.y = Math.PI / 2;
    g.add(signBack);
    const west = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), signMat);
    west.position.set(-127.2, 12.2, 0);
    west.rotation.y = -Math.PI / 2;
    g.add(west);
    // clock face
    const clock = canvasTexture(256, 256, (c, w) => {
      c.fillStyle = '#f2ede4'; c.beginPath(); c.arc(w / 2, w / 2, 120, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#2b2d31'; c.lineWidth = 6;
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.beginPath(); c.moveTo(128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); c.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); c.stroke(); }
    });
    const clockMesh = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshBasicMaterial({ map: clock }));
    clockMesh.position.set(21.1, 25, -40);
    clockMesh.rotation.y = Math.PI / 2;
    g.add(clockMesh);
    const hands = new THREE.Group();
    const handMat = new THREE.MeshBasicMaterial({ color: 0x24262a });
    const hourH = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.05).translate(0, 1.1, 0), handMat);
    const minH = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.05).translate(0, 1.6, 0), handMat);
    hands.add(hourH, minH);
    hands.position.set(21.2, 25, -40);
    hands.rotation.y = Math.PI / 2;
    g.add(hands);
    this.clockHands = { hourH, minH };

    this.group.add(g);
    this.station = g;
    onNightChange((t) => {
      signMat.color.setScalar(1 + t * 0.9);
      glass.emissiveIntensity = 0.05 + t * 0.85;
      clockMesh.material.color.setScalar(1 + t * 0.4);
    });
    this.stationGlass = glass;
    this.stationAtrium = atrium;
    this.corridorGlass = corridorGlass;
  }

  // ---------------------------------------------------------------------------
  buildCastle() {
    const { x: cx, z: cz } = WORLD.castle;
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    const lawn = new Flat();
    lawn.quad([-140, -130], [140, -130], [140, 130], [-140, 130], Y.sidewalk);
    const moat = new Flat();
    moat.quad([-115, -105], [115, -105], [115, 105], [-115, 105], Y.water);
    const lawnMesh = new THREE.Mesh(lawn.geometry(), litMaterial(0x9ca486));
    const moatMesh = new THREE.Mesh(moat.geometry(), createWaterMaterial());
    g.add(lawnMesh, moatMesh);
    // island with stone walls
    const stone = litMaterial(0x8b867d);
    const island = new THREE.Mesh(new THREE.BoxGeometry(170, 3, 150).translate(0, 1.5, 0), stone);
    const islandTop = new THREE.Mesh(new THREE.BoxGeometry(168, 0.1, 148).translate(0, 3.05, 0), litMaterial(0xa4ab8f));
    island.receiveShadow = islandTop.receiveShadow = true;
    g.add(island, islandTop);
    // keep (天守): black walls, white bands, layered hip roofs
    const black = litMaterial(0x232427);
    const white = litMaterial(0xece8df);
    const roof = litMaterial(0x3b3e44, { flatShading: true });
    const keep = new THREE.Group();
    keep.position.set(-14, 3, -8);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(15, 19, 8, 4, 1).rotateY(Math.PI / 4).translate(0, 4, 0), stone);
    base.scale.set(1, 1, 0.85);
    keep.add(base);
    let y = 8;
    const tiers = [[24, 20, 6.2], [21, 17, 5.2], [17.5, 14, 4.8], [14, 11, 4.4], [10.5, 8.5, 4.6]];
    tiers.forEach(([w, d, h], i) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), black);
      body.position.y = y;
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h * 0.3, d + 0.1).translate(0, h * 0.85, 0), white);
      band.position.y = y;
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.6, Math.SQRT1_2 * (w + 5), i === tiers.length - 1 ? 5.5 : 2.6, 4, 1).rotateY(Math.PI / 4).translate(0, 1.3, 0), roof);
      r.scale.set(1, 1, (d + 5) / (w + 5));
      r.position.y = y + h - 0.6;
      [body, band, r].forEach((m) => { m.castShadow = true; keep.add(m); });
      y += h;
    });
    // smaller turret (乾小天守) linked by a corridor
    const turret = new THREE.Group();
    turret.position.set(-38, 3, -20);
    const tb = new THREE.Mesh(new THREE.BoxGeometry(12, 13, 10).translate(0, 6.5, 0), black);
    const tbBand = new THREE.Mesh(new THREE.BoxGeometry(12.1, 3, 10.1).translate(0, 11.5, 0), white);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 11, 4.5, 4, 1).rotateY(Math.PI / 4).translate(0, 15, 0), roof);
    turret.add(tb, tbBand, tr);
    const corridor = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 6).translate(-26, 6.5, -14), black);
    g.add(keep, turret, corridor);
    // red bridge (埋橋) over the moat
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(5, 0.8, 30).translate(30, 1.6, 90), litMaterial(0x9c3b2e));
    g.add(bridge);
    this.group.add(g);
    this.castle = g;
    // Night illumination: castle walls glow softly
    onNightChange((t) => {
      white.emissive.setRGB(0.9, 0.82, 0.68).multiplyScalar(t * 0.55);
      black.emissive.setRGB(0.25, 0.18, 0.1).multiplyScalar(t * 0.35);
    });
  }

  // ---------------------------------------------------------------------------
  buildMountains() {
    const cx = 380, cz = -200;
    const rnd = mulberry32(2857);
    const phases = Array.from({ length: 8 }, () => rnd() * Math.PI * 2);
    const noise = (a, f0) => {
      let v = 0, amp = 1, f = f0;
      for (let i = 0; i < 5; i++) { v += amp * (1 - Math.abs(Math.sin(a * f + phases[i]))); amp *= 0.5; f *= 2.1; }
      return v / 1.94;
    };
    const layers = [
      { R: 5600, N: 900, layer: 1, height: (a) => {
        // Northern Alps to the west (a≈π), with a pointed 常念岳-like peak slightly north of west.
        const west = Math.pow(Math.max(0, -Math.cos(a)), 0.7);
        const east = Math.pow(Math.max(0, Math.cos(a)), 1.2);
        const peak = 520 * Math.exp(-Math.pow((wrapA(a - (Math.PI + 0.22))) / 0.05, 2));
        const alps = (650 + 520 * noise(a, 9)) * west + peak;
        const plateau = (420 + 60 * noise(a, 22)) * east; // 美ヶ原-like flat top
        return 240 + 120 * noise(a, 14) + Math.max(alps, plateau);
      } },
      { R: 3900, N: 700, layer: 0, height: (a) => 120 + 240 * noise(a + 1.3, 17) * (0.6 + 0.4 * Math.abs(Math.cos(a))) },
    ];
    for (const L of layers) {
      const pos = [], hs = [], idx = [];
      for (let i = 0; i <= L.N; i++) {
        const a = (i / L.N) * Math.PI * 2;
        const h = L.height(a);
        const x = cx + Math.cos(a) * L.R, z = cz + Math.sin(a) * L.R;
        const xb = cx + Math.cos(a) * (L.R - 400), zb = cz + Math.sin(a) * (L.R - 400);
        pos.push(xb, -60, zb, x, h, z);
        hs.push(h, h);
        if (i < L.N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aH', new THREE.Float32BufferAttribute(hs, 1));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, createMountainMaterial(L.layer));
      mesh.material.side = THREE.DoubleSide;
      mesh.frustumCulled = false;
      mesh.renderOrder = -5;
      this.group.add(mesh);
    }
  }

  // ---------------------------------------------------------------------------
  buildStreetNames() {
    const names = [
      ['駅前大通り', 'EKIMAE-ODORI', 300, 0, 0],
      ['駅前大通り', 'EKIMAE-ODORI', 640, 0, 0],
      ['本町通り', 'HONMACHI', 520, 150, Math.PI / 2],
      ['中町通り', 'NAKAMACHI', 600, -300, 0],
      ['縄手通り', 'NAWATE', 605, -396, 0],
      ['伊勢町通り', 'ISEMACHI', 300, -180, 0],
      ['大名町通り', 'DAIMYOCHO', 520, -720, Math.PI / 2],
      ['女鳥羽川', 'METOBA RIVER', 460, -371, 0],
      ['深志通り', 'FUKASHI', 300, 260, 0],
    ];
    for (const [ja, en, x, z, ang] of names) {
      const tex = canvasTexture(1024, 160, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.fillStyle = '#ffffff';
        c.textAlign = 'center';
        c.font = '500 78px "Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
        c.fillText(ja, w / 2, 86);
        c.font = '500 30px "Avenir Next","Helvetica Neue",Arial,sans-serif';
        c.letterSpacing = '10px';
        c.fillText(en, w / 2, 140);
      });
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0x2c2e33 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(36, 5.6), mat);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.set(-Math.PI / 2, -ang, 0);
      mesh.position.set(x, 0.3, z);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.labels.push(mesh);
    }
    onNightChange((t) => {
      for (const m of this.labels) m.material.color.setRGB(0.17 + 0.75 * t, 0.18 + 0.72 * t, 0.2 + 0.66 * t);
    });
  }

  update(dt, camera, camDist) {
    // Street names fade in when zoomed in, fade out in POV (they would read as huge decals)
    const fade = camDist > 520 ? 0 : camDist > 380 ? (520 - camDist) / 140 : camDist < 25 ? 0 : 1;
    for (const m of this.labels) m.material.opacity = fade * 0.55;
    // Station clock shows Japan time
    if (this.clockHands) {
      const d = new Date(Date.now() + (540 + new Date().getTimezoneOffset()) * 60000);
      const mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
      this.clockHands.minH.rotation.z = -((mins % 60) / 60) * Math.PI * 2;
      this.clockHands.hourH.rotation.z = -((mins % 720) / 720) * Math.PI * 2;
    }
    this.stationGlass.emissiveIntensity = 0.05 + U.uNight.value * 0.85 + U.uStationGlow.value * (0.18 + 0.5 * U.uNight.value) * (0.8 + 0.2 * Math.sin(U.uTime.value * 2.2));
  }
}

function wrapA(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Unit gable roof: footprint 1×1 centred, ridge along x, height 1. */
function gableGeometry() {
  const v = [];
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], E = [-0.5, 1, 0], F = [0.5, 1, 0];
  const tri = (a, b, c) => v.push(...a, ...b, ...c);
  tri(A, E, F); tri(A, F, B);   // north slope
  tri(D, C, F); tri(D, F, E);   // south slope
  tri(A, D, E); tri(B, F, C);   // gables
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
