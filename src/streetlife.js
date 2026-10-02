import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { litMaterial, onNightChange } from './materials.js';
import { mulberry32 } from './util.js';
import { distToSeg } from './city.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** ry: rotation about Y. Local +z ends up pointing along (sin ry, cos ry). */
const compose = (x, y, z, ry, sx = 1, sy = 1, sz = 1) => m4.compose(v.set(x, y, z), q.setFromAxisAngle(UP, ry), s3.set(sx, sy, sz));

/**
 * Street-level detail — the things you only notice at eye height:
 * eaves (庇) and noren on 蔵 / 町家, vending machines, planters, A-board signs,
 * utility poles with sagging wires, and a few Nawate / Nakamachi landmarks.
 * All instanced; the whole layer is hidden when the camera is high above the city.
 */
export class StreetLife {
  constructor(city, restaurants) {
    this.city = city;
    this.group = new THREE.Group();
    city.scene.add(this.group);
    this.rnd = mulberry32(8128);
    this.restaurants = restaurants;
    this.shopSpots = restaurants.map((r) => [r.position.x, r.position.z]);
    this.visibleAmt = 1;
  }

  build() {
    this.fronts = this._findFrontages();
    this.buildEaves();
    this.buildFrontItems();
    this.buildPolesAndWires();
    this.buildLandmarks();
  }

  nearShop(x, z, r = 4) {
    for (const [sx, sz] of this.shopSpots) if ((sx - x) ** 2 + (sz - z) ** 2 < r * r) return true;
    return false;
  }

  /**
   * For every building that stands directly on a street, work out which face looks at the street.
   * Returns [{ i, x, z, w, d, h, type, nx, nz, tx, tz, fx, fz, edge }] — f = facade centre at ground level.
   */
  _findFrontages() {
    const { roads, nodeById, bdata } = this.city;
    const segs = roads.edges
      .filter((e) => e.roadType !== 'plaza' && e.roadType !== 'passage')
      .map((e) => ({ e, a: nodeById.get(e.from), b: nodeById.get(e.to) }));
    const out = [];
    bdata.items.forEach((it, i) => {
      if (bdata.landmarks?.[i]) return;
      const [x, z, w, d, h, rot, type] = it;
      const a = (rot * Math.PI) / 180;
      const ax = Math.cos(a), az = Math.sin(a);     // width axis (along the street)
      const px = -Math.sin(a), pz = Math.cos(a);    // depth axis (towards / away from the street)
      let best = null;
      for (const s of segs) {
        const dist = distToSeg(x, z, s.a.x, s.a.z, s.b.x, s.b.z);
        const lim = d / 2 + s.e.width / 2 + s.e.sidewalk + 3;
        if (dist > lim) continue;
        const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z) || 1;
        const ex = (s.b.x - s.a.x) / len, ez = (s.b.z - s.a.z) / len;
        if (Math.abs(ex * ax + ez * az) < 0.9) continue; // building not aligned with this street
        if (!best || dist < best.dist) best = { s, dist, ex, ez };
      }
      if (!best) return;
      const { s } = best;
      // nearest point on the street → which side of the building faces it
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
      const t = Math.max(0, Math.min(1, ((x - s.a.x) * dx + (z - s.a.z) * dz) / (dx * dx + dz * dz)));
      const qx = s.a.x + dx * t, qz = s.a.z + dz * t;
      const sign = (qx - x) * px + (qz - z) * pz > 0 ? 1 : -1;
      const nx = px * sign, nz = pz * sign;
      out.push({ i, x, z, w, d, h, type, nx, nz, tx: ax, tz: az, fx: x + nx * (d / 2), fz: z + nz * (d / 2), edge: s.e });
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  buildEaves() {
    const R = this.rnd;
    const eaves = [], noren = [], bands = [];
    for (const f of this.fronts) {
      if (f.type !== 2 && f.type !== 3) continue;
      const ry = Math.atan2(f.nx, f.nz);
      // 庇: a tiled eave over the ground floor running the full width of the facade
      const ey = f.type === 2 ? Math.min(3.1, f.h * 0.42) : 2.75;
      eaves.push({ x: f.fx + f.nx * 0.55, z: f.fz + f.nz * 0.55, y: ey, ry, w: f.w + 0.4 });
      // white plaster band under the eave on 蔵 (水切り)
      if (f.type === 2) bands.push({ x: f.fx + f.nx * 0.04, z: f.fz + f.nz * 0.04, y: ey - 0.35, ry, w: f.w });
      // noren hanging in the doorway (most shops, not all)
      if (R() < 0.75) {
        const off = (R() - 0.5) * f.w * 0.3;
        noren.push({ x: f.fx + f.nx * 0.12 + f.tx * off, z: f.fz + f.nz * 0.12 + f.tz * off, ry, c: R() });
      }
    }
    const eaveGeo = new THREE.BoxGeometry(1, 0.16, 1.15).rotateX(-0.28);
    const eaveMesh = new THREE.InstancedMesh(eaveGeo, litMaterial(0x3a3c41, { roughness: 0.7 }), eaves.length);
    eaves.forEach((e, i) => eaveMesh.setMatrixAt(i, compose(e.x, e.y, e.z, e.ry, e.w, 1, 1)));
    const bandMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 0.1), litMaterial(0x26272b), bands.length);
    bands.forEach((b, i) => bandMesh.setMatrixAt(i, compose(b.x, b.y, b.z, b.ry, b.w, 1, 1)));

    // noren: three split cloth panels
    const panel = (x) => new THREE.BoxGeometry(0.5, 0.75, 0.03).translate(x, 0, 0);
    const norenGeo = mergeGeometries([panel(-0.54), panel(0), panel(0.54), new THREE.CylinderGeometry(0.025, 0.025, 1.8, 5).rotateZ(Math.PI / 2).translate(0, 0.4, 0)]);
    const norenMesh = new THREE.InstancedMesh(norenGeo, litMaterial(0xffffff, { roughness: 1 }), noren.length);
    const tones = ['#27324a', '#2b2f36', '#5a2e26', '#e6dfd0', '#3a4a3f'];
    const col = new THREE.Color();
    noren.forEach((n, i) => {
      norenMesh.setMatrixAt(i, compose(n.x, 2.05, n.z, n.ry));
      norenMesh.setColorAt(i, col.set(tones[Math.floor(n.c * tones.length)]));
    });
    for (const m of [eaveMesh, bandMesh, norenMesh]) { m.castShadow = m === eaveMesh; m.computeBoundingSphere(); this.group.add(m); }
  }

  // ---------------------------------------------------------------------------
  buildFrontItems() {
    const R = this.rnd;
    const vending = [], planters = [], boards = [], bikes = [];
    for (const f of this.fronts) {
      const ry = Math.atan2(f.nx, f.nz);
      const side = f.edge.sidewalk;
      const ped = f.edge.roadType === 'pedestrian' || f.edge.roadType === 'shotengai';
      const room = side > 1 || ped; // only where there is pavement in front
      if (!room) continue;
      const at = (along, out) => [f.fx + f.tx * along + f.nx * out, f.fz + f.tz * along + f.nz * out];
      // vending machines: modern buildings, at a corner of the facade
      if (f.type === 0 && R() < 0.12 && f.w > 6) {
        const n = R() < 0.4 ? 2 : 1;
        const base = (R() < 0.5 ? -1 : 1) * (f.w / 2 - 0.9 - n * 0.5);
        for (let k = 0; k < n; k++) {
          const [x, z] = at(base + k * 1.05, 0.45);
          if (!this.nearShop(x, z, 3)) vending.push({ x, z, ry, c: R() });
        }
      }
      // planters by shop doors and old houses
      if ((f.type !== 0 || R() < 0.08) && R() < 0.7) {
        for (const s of [-1, 1]) {
          if (R() < 0.35) continue;
          const [x, z] = at(s * (f.w / 2 - 0.7), 0.35);
          planters.push({ x, z, ry, k: 0.8 + R() * 0.5 });
        }
      }
      // parked bicycles in front of some modern buildings on wide sidewalks
      if (f.type === 0 && side >= 3 && R() < 0.1) {
        const n = 2 + Math.floor(R() * 3);
        for (let k = 0; k < n; k++) {
          const [x, z] = at(-f.w / 2 + 1.5 + k * 0.75, 1.1);
          bikes.push({ x, z, ry: ry + Math.PI / 2 + (R() - 0.5) * 0.15 });
        }
      }
    }
    // A-board menu signs right next to every restaurant beacon
    for (const r of this.restaurants) {
      const b = this.city.shopBuildings.get(r.id);
      if (!b) continue;
      let nx = r.position.x - b.x, nz = r.position.z - b.z;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      boards.push({ x: r.position.x - nz * 1.6 - nx * 0.6, z: r.position.z + nx * 1.6 - nz * 0.6, ry: Math.atan2(nx, nz) });
    }

    // vending machine: body + glowing front panel
    const vBody = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 1.85, 0.75).translate(0, 0.925, 0), litMaterial(0xffffff, { roughness: 0.5 }), vending.length);
    const vFrontMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const vFront = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 1.15).translate(0, 1.2, 0.381), vFrontMat, vending.length);
    const bodyTones = ['#e8e4dc', '#c33b2c', '#2f5d9a', '#d8d4cc', '#3d3f44'];
    const col = new THREE.Color();
    vending.forEach((m, i) => {
      vBody.setMatrixAt(i, compose(m.x, 0.06, m.z, m.ry));
      vBody.setColorAt(i, col.set(bodyTones[Math.floor(m.c * bodyTones.length)]));
      vFront.setMatrixAt(i, compose(m.x, 0.06, m.z, m.ry));
    });
    onNightChange((t) => vFrontMat.color.setRGB(0.55 + 1.6 * t, 0.6 + 1.6 * t, 0.62 + 1.55 * t));

    // planter: concrete box + leafy top
    const pBox = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.45, 0.45).translate(0, 0.225, 0), litMaterial(0x9a948a), planters.length);
    const pLeaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.75, 0.6).translate(0, 0.72, 0), litMaterial(0x7e8c66, { flatShading: true }), planters.length);
    planters.forEach((p, i) => {
      pBox.setMatrixAt(i, compose(p.x, 0.06, p.z, p.ry));
      pLeaf.setMatrixAt(i, compose(p.x, 0.06, p.z, p.ry, p.k, p.k, p.k));
    });

    // A-board: two slanted boards
    const aGeo = mergeGeometries([
      new THREE.BoxGeometry(0.55, 0.85, 0.03).rotateX(0.2).translate(0, 0.42, 0.09),
      new THREE.BoxGeometry(0.55, 0.85, 0.03).rotateX(-0.2).translate(0, 0.42, -0.09),
    ]);
    const aBoard = new THREE.InstancedMesh(aGeo, litMaterial(0x2b2d31), boards.length);
    boards.forEach((b, i) => aBoard.setMatrixAt(i, compose(b.x, 0.06, b.z, b.ry)));

    // bicycle: two rings + a bar
    const bikeGeo = mergeGeometries([
      new THREE.TorusGeometry(0.33, 0.025, 4, 12).rotateY(Math.PI / 2).translate(0, 0.35, 0.52),
      new THREE.TorusGeometry(0.33, 0.025, 4, 12).rotateY(Math.PI / 2).translate(0, 0.35, -0.52),
      new THREE.BoxGeometry(0.04, 0.04, 1.0).rotateX(0.15).translate(0, 0.62, 0),
      new THREE.BoxGeometry(0.04, 0.45, 0.04).translate(0, 0.6, -0.3),
    ]);
    const bikeMesh = new THREE.InstancedMesh(bikeGeo, litMaterial(0x45474c, { metalness: 0.3, roughness: 0.5 }), bikes.length);
    bikes.forEach((b, i) => bikeMesh.setMatrixAt(i, compose(b.x, 0.06, b.z, b.ry)));

    for (const m of [vBody, vFront, pBox, pLeaf, aBoard, bikeMesh]) { m.computeBoundingSphere(); this.group.add(m); }
    this.counts = { vending: vending.length, planters: planters.length, boards: boards.length, bikes: bikes.length };
  }

  // ---------------------------------------------------------------------------
  /** 電柱と電線: wooden-grey poles along lanes and side streets, wires that sag between them. */
  buildPolesAndWires() {
    const { roads, nodeById, junctionR } = this.city;
    const poles = [];
    const wire = [];
    const SAG = 0.55;
    const HEIGHTS = [7.6, 7.15, 6.7];
    for (const e of roads.edges) {
      if (e.roadType !== 'lane' && e.roadType !== 'street') continue;
      const a = nodeById.get(e.from), b = nodeById.get(e.to);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const ja = junctionR.get(e.from), jb = junctionR.get(e.to);
      const s0 = ja.walk + 3, s1 = len - jb.walk - 3;
      if (s1 - s0 < 12) continue;
      const n = Math.max(1, Math.round((s1 - s0) / 32));
      const off = e.width / 2 + Math.max(0.35, e.sidewalk * 0.15);
      const side = e.id.charCodeAt(e.id.length - 1) % 2 ? 1 : -1; // one side of the street, deterministic
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const s = s0 + ((s1 - s0) * k) / n;
        const x = a.x + dx * s - dz * off * side, z = a.z + dz * s + dx * off * side;
        if (this.nearShop(x, z, 2.5)) { prev = null; continue; }
        const ry = Math.atan2(dx, dz);
        poles.push({ x, z, ry });
        if (prev) {
          for (let h = 0; h < 3; h++) {
            const y = HEIGHTS[h];
            const lat = h === 0 ? 0 : (h === 1 ? -0.5 : 0.5);
            const ax = prev.x - dz * lat, az = prev.z + dx * lat, bx = x - dz * lat, bz = z + dx * lat;
            const SEG = 8;
            for (let i = 0; i < SEG; i++) {
              const t0 = i / SEG, t1 = (i + 1) / SEG;
              const y0 = y - SAG * 4 * t0 * (1 - t0), y1 = y - SAG * 4 * t1 * (1 - t1);
              wire.push(ax + (bx - ax) * t0, y0, az + (bz - az) * t0, ax + (bx - ax) * t1, y1, az + (bz - az) * t1);
            }
          }
        }
        prev = { x, z };
      }
    }
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.12, 0.17, 8.2, 6).translate(0, 4.1, 0),
      new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, 7.15, 0).rotateY(Math.PI / 2),
      new THREE.CylinderGeometry(0.22, 0.22, 0.6, 8).translate(0.32, 6.0, 0), // transformer
    ]);
    const poleMesh = new THREE.InstancedMesh(poleGeo, litMaterial(0x8a857c), poles.length);
    poles.forEach((p, i) => poleMesh.setMatrixAt(i, compose(p.x, 0, p.z, p.ry)));
    poleMesh.computeBoundingSphere();
    poleMesh.castShadow = true;
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const wireMat = new THREE.LineBasicMaterial({ color: 0x2a2b2e, transparent: true, opacity: 0.75, fog: true });
    const wires = new THREE.LineSegments(wireGeo, wireMat);
    wires.frustumCulled = false;
    onNightChange((t) => wireMat.color.setRGB(0.165 - 0.08 * t, 0.17 - 0.08 * t, 0.18 - 0.07 * t));
    this.group.add(poleMesh, wires);
    this.wireMat = wireMat;
    this.counts.poles = poles.length;
  }

  // ---------------------------------------------------------------------------
  /** Small symbols that make the streets recognisable at eye level. */
  buildLandmarks() {
    const stone = litMaterial(0x8f8b83, { flatShading: true });
    // Nawate: a stone frog greets you at the west entrance of the street (generic, stylised)
    const frog = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8).scale(1, 0.72, 1.15), stone);
    body.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), stone);
    head.position.set(0, 0.95, 0.42);
    const eyeG = new THREE.SphereGeometry(0.12, 8, 6);
    const e1 = new THREE.Mesh(eyeG, stone); e1.position.set(-0.2, 1.22, 0.52);
    const e2 = new THREE.Mesh(eyeG, stone); e2.position.set(0.2, 1.22, 0.52);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.3, 10), litMaterial(0x6f6b64));
    plinth.position.y = 0.15;
    frog.add(plinth, body, head, e1, e2);
    frog.position.set(527, 0.1, -392);
    frog.rotation.y = Math.PI / 2;
    frog.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    // Nawate: a stone torii at the east end (the shrine side of the street)
    const torii = new THREE.Group();
    const pillar = new THREE.CylinderGeometry(0.22, 0.26, 4.6, 10);
    const p1 = new THREE.Mesh(pillar, stone); p1.position.set(-1.9, 2.3, 0);
    const p2 = new THREE.Mesh(pillar, stone); p2.position.set(1.9, 2.3, 0);
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.36, 0.5), stone); kasagi.position.y = 4.75;
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.22, 0.3), stone); nuki.position.y = 4.0;
    torii.add(p1, p2, kasagi, nuki);
    torii.position.set(686, 0, -396);
    torii.rotation.y = Math.PI / 2;
    torii.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    // Nakamachi: paper lanterns on the eaves at both ends of the street
    const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lanternGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10);
    const spots = [];
    for (let x = 530; x <= 810; x += 14) for (const s of [-1, 1]) spots.push([x + (s > 0 ? 7 : 0), -300 + s * 4.1]);
    const lanterns = new THREE.InstancedMesh(lanternGeo, lanternMat, spots.length);
    spots.forEach(([x, z], i) => lanterns.setMatrixAt(i, compose(x, 2.55, z, 0)));
    lanterns.computeBoundingSphere();
    onNightChange((t) => lanternMat.color.setRGB(0.92 + 1.5 * t, 0.86 + 0.75 * t, 0.74 + 0.15 * t));

    this.group.add(frog, torii, lanterns);
  }

  /** Hide the whole layer when it would be sub-pixel anyway. */
  update(camDist, pov) {
    const want = pov > 0.01 || camDist < 520 ? 1 : 0;
    this.group.visible = want === 1;
    if (this.wireMat) this.wireMat.opacity = 0.75 * Math.max(pov, camDist < 260 ? 1 : (520 - camDist) / 260);
  }
}
