import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { litMaterial, onNightChange, radialTexture, U } from './materials.js';
import { mulberry32 } from './util.js';
import { distToSeg } from './city.js';
import { WORLD } from './config.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const compose = (x, y, z, ry, sx = 1, sy = 1, sz = 1) => m4.compose(v.set(x, y, z), q.setFromAxisAngle(UP, ry), s3.set(sx, sy, sz));

/**
 * Street furniture: trees, street lights (+ night light pools), traffic signals, benches,
 * shop blade signs and awnings. Everything instanced: ~10 draw calls in total.
 */
export class Props {
  constructor(city, restaurants) {
    this.city = city;
    this.group = new THREE.Group();
    city.scene.add(this.group);
    this.rnd = mulberry32(31);
    this.beaconSpots = restaurants.map((r) => [r.position.x, r.position.z]);
    this.signals = [];
  }

  nearBeacon(x, z, r = 6) {
    for (const [bx, bz] of this.beaconSpots) if ((bx - x) ** 2 + (bz - z) ** 2 < r * r) return true;
    return false;
  }

  nearJunction(x, z, extra = 4) {
    for (const n of this.city.roads.nodes) {
      const j = this.city.junctionR.get(n.id);
      if (j.deg < 3) continue;
      if ((n.x - x) ** 2 + (n.z - z) ** 2 < (j.walk + extra) ** 2) return true;
    }
    return false;
  }

  build() {
    this.buildTrees();
    this.buildLights();
    this.buildSignals();
    this.buildBenches();
    this.buildShopSigns();
  }

  // -------------------------------------------------------------------------
  buildTrees() {
    const R = this.rnd;
    const trees = [];
    const { roads, nodeById } = this.city;
    const add = (x, z, size = 1, kind = 0) => trees.push({ x, z, size: size * (0.85 + R() * 0.35), kind });
    for (const e of roads.edges) {
      const a = nodeById.get(e.from), b = nodeById.get(e.to);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      let step = 0, off = 0, prob = 0, size = 1;
      if (e.roadType === 'avenue') { step = 12; off = e.width / 2 + e.sidewalk * 0.62; prob = 1; size = 1.05; }
      else if (e.roadType === 'street') { step = 17; off = e.width / 2 + e.sidewalk * 0.6; prob = 0.75; }
      else if (e.street === 'park') { step = 7; off = 4.5; prob = 1; size = 1.1; }
      else continue;
      for (let s = 6; s < len - 6; s += step) {
        for (const side of [-1, 1]) {
          if (R() > prob) continue;
          const x = a.x + dx * s - dz * side * off, z = a.z + dz * s + dx * side * off;
          if (this.nearJunction(x, z, 3) || this.nearBeacon(x, z, 7)) continue;
          add(x, z, size);
        }
      }
    }
    // park canopy
    for (let i = 0; i < 70; i++) {
      const x = 238 + R() * 114, z = 128 + R() * 124;
      if (distToSeg(x, z, 230, 120, 295, 190) < 5 || distToSeg(x, z, 295, 190, 360, 260) < 5) continue;
      add(x, z, 1.25 + R() * 0.5);
    }
    // willows along the 女鳥羽川 banks
    const pts = roads.river.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let s = 4; s < len - 4; s += 8.5) {
        for (const side of [-1, 1]) {
          const o = roads.river.width / 2 + 3.6;
          const x = ax + dx * s - dz * side * o, z = az + dz * s + dx * side * o;
          if (this.onRoad(x, z, 1.5) || this.nearBeacon(x, z, 7)) continue;
          add(x, z, 1.05, 1);
        }
      }
    }
    // castle grounds
    const { x: cx, z: cz } = { x: this.city.castle.position.x, z: this.city.castle.position.z };
    for (let i = 0; i < 90; i++) {
      const a = R() * Math.PI * 2;
      const rx = 125 + R() * 10, rz = 116 + R() * 10;
      add(cx + Math.cos(a) * rx, cz + Math.sin(a) * rz, 1.3);
    }
    for (let i = 0; i < 30; i++) add(cx + 20 + R() * 55, cz + 20 + R() * 45, 1.15);
    // station plaza ring
    const RT = WORLD.rotary;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      add(RT.x + Math.cos(a) * 8.5, RT.z + Math.sin(a) * 8.5, 0.75);
    }
    // forecourt trees on the south half of the plaza
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) add(52 + i * 16, 26 + j * 18, 0.85);

    const crownGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 1, 5).translate(0, 0.5, 0);
    const crowns = new THREE.InstancedMesh(crownGeo, litMaterial(0xffffff, { flatShading: true, roughness: 0.95 }), trees.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, litMaterial(0x5d5149), trees.length);
    const palette = ['#a7b192', '#b7bb9d', '#98a487', '#c3c5aa', '#8f9c80'];
    const willow = ['#a9b58e', '#b6bf98'];
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      const r = 2.1 * t.size;
      const th = t.kind === 1 ? 2.4 : 3.1 * t.size;
      const ry = R() * Math.PI;
      if (t.kind === 1) crowns.setMatrixAt(i, compose(t.x, th + r * 1.2, t.z, ry, r * 0.95, r * 1.55, r * 0.95));
      else crowns.setMatrixAt(i, compose(t.x, th + r * 0.85, t.z, ry, r, r * 1.12, r));
      crowns.setColorAt(i, col.set((t.kind === 1 ? willow : palette)[Math.floor(R() * (t.kind === 1 ? 2 : 5))]));
      trunks.setMatrixAt(i, compose(t.x, 0, t.z, 0, t.size, th + r * 0.3, t.size));
    });
    crowns.castShadow = true;
    crowns.computeBoundingSphere();
    trunks.computeBoundingSphere();
    this.group.add(crowns, trunks);
    this.treeCount = trees.length;
  }

  onRoad(x, z, margin = 0) {
    for (const e of this.city.roads.edges) {
      const a = this.city.nodeById.get(e.from), b = this.city.nodeById.get(e.to);
      if (distToSeg(x, z, a.x, a.z, b.x, b.z) < e.width / 2 + e.sidewalk + margin) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  buildLights() {
    const { roads, nodeById } = this.city;
    const lights = [];
    for (const e of roads.edges) {
      if (e.roadType === 'passage') continue;
      const a = nodeById.get(e.from), b = nodeById.get(e.to);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const ped = e.roadType === 'pedestrian' || e.roadType === 'shotengai';
      const step = ped ? 16 : e.roadType === 'avenue' ? 24 : 30;
      const off = e.sidewalk > 0 ? e.width / 2 + 0.6 : e.width / 2 - 0.5;
      let side = 1;
      for (let s = step / 2; s < len - 4; s += step) {
        const sides = e.roadType === 'avenue' || ped ? [-1, 1] : [side];
        for (const sd of sides) {
          const x = a.x + dx * s - dz * sd * off, z = a.z + dz * s + dx * sd * off;
          if (this.nearBeacon(x, z, 3)) continue;
          lights.push({ x, z, h: ped ? 3.4 : 6.5, ry: -Math.atan2(dz, dx), side: sd });
        }
        side = -side;
      }
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      lights.push({ x: WORLD.rotary.x + Math.cos(a) * (WORLD.rotary.r + 3), z: WORLD.rotary.z + Math.sin(a) * (WORLD.rotary.r + 3), h: 6, ry: 0, side: 1 });
    }
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 1, 6).translate(0, 0.5, 0);
    const headGeo = new THREE.BoxGeometry(0.42, 0.22, 0.9);
    const poles = new THREE.InstancedMesh(poleGeo, litMaterial(0x4a4c51), lights.length);
    const headMat = new THREE.MeshBasicMaterial({ color: 0x5a5c60 });
    const heads = new THREE.InstancedMesh(headGeo, headMat, lights.length);
    const poolTex = radialTexture(128, 'rgba(255,190,120,0.9)', 'rgba(255,170,90,0)');
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, lights.length);
    lights.forEach((L, i) => {
      poles.setMatrixAt(i, compose(L.x, 0, L.z, 0, 1, L.h, 1));
      heads.setMatrixAt(i, compose(L.x, L.h, L.z, L.ry, 1, 1, 1));
      const r = L.h > 5 ? 15 : 9;
      pools.setMatrixAt(i, compose(L.x, 0.22, L.z, 0, r, 1, r));
    });
    [poles, heads, pools].forEach((m) => { m.computeBoundingSphere(); this.group.add(m); });
    pools.renderOrder = 1;
    onNightChange((t) => {
      headMat.color.setRGB(0.36 + 1.7 * t, 0.36 + 1.15 * t, 0.37 + 0.55 * t);
      pools.visible = t > 0.02;
    });
    this.poolMat = poolMat;
    this.lightCount = lights.length;
  }

  // -------------------------------------------------------------------------
  buildSignals() {
    const { roads, nodeById, junctionR } = this.city;
    const poles = [];
    for (const n of roads.nodes) {
      if (!n.signal) continue;
      const j = junctionR.get(n.id);
      for (const e of roads.edges) {
        if (e.from !== n.id && e.to !== n.id) continue;
        if (e.roadType !== 'avenue' && e.roadType !== 'street') continue;
        const o = nodeById.get(e.from === n.id ? e.to : e.from);
        const len = Math.hypot(o.x - n.x, o.z - n.z);
        const dx = (o.x - n.x) / len, dz = (o.z - n.z) / len;
        const d = j.walk + 0.6, lat = e.width / 2 + 0.7;
        poles.push({ x: n.x + dx * d + dz * lat, z: n.z + dz * d - dx * lat, ry: -Math.atan2(dz, dx), node: n.id, axis: Math.abs(dx) > 0.5 ? 0 : 1 });
      }
    }
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 5.2, 6).translate(0, 2.6, 0), litMaterial(0x55575c), poles.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.45, 1.5), litMaterial(0x2a2c30), poles.length);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lamp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 8, 6), lampMat, poles.length);
    poles.forEach((p, i) => {
      pole.setMatrixAt(i, compose(p.x, 0, p.z, p.ry));
      head.setMatrixAt(i, compose(p.x, 5.1, p.z, p.ry + Math.PI / 2));
      lamp.setMatrixAt(i, compose(p.x - Math.sin(p.ry + Math.PI / 2) * 0.0, 5.1, p.z, 0, 1, 1, 1));
      lamp.setColorAt(i, new THREE.Color(0x5fbf8f));
    });
    [pole, head, lamp].forEach((m) => { m.computeBoundingSphere(); this.group.add(m); });
    this.signalLamp = lamp;
    this.signalPoles = poles;
    this.signalTimer = 0;
  }

  updateSignals(dt) {
    // light pools: softer at street level so the POV never washes out
    if (this.poolMat) this.poolMat.opacity = U.uNight.value * 0.3 * (1 - 0.45 * U.uPov.value) * (1 + 0.9 * U.uWet.value); // wet streets mirror the lamps
    this.signalTimer -= dt;
    if (this.signalTimer > 0 || !this.signalLamp) return;
    this.signalTimer = 0.5;
    const t = U.uTime.value;
    const glow = 1 + U.uNight.value * 1.6;
    const c = new THREE.Color();
    this.signalPoles.forEach((p, i) => {
      // two-phase cycle per junction: one axis green while the other is red
      const phase = (t + (p.node.charCodeAt(p.node.length - 1) % 7) * 3) % 36;
      const greenAxis = phase < 16 ? 0 : phase < 18 ? -1 : 1;
      if (greenAxis === -1) c.setRGB(0.95, 0.62, 0.2);
      else if (greenAxis === p.axis) c.setRGB(0.36, 0.78, 0.58);
      else c.setRGB(0.86, 0.3, 0.24);
      c.multiplyScalar(glow);
      this.signalLamp.setColorAt(i, c);
    });
    this.signalLamp.instanceColor.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  buildBenches() {
    const R = this.rnd;
    const spots = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) spots.push([60 + i * 16, 26 + j * 18, j ? Math.PI : 0]);
    for (let i = 0; i < 9; i++) { const t = i / 9; spots.push([232 + t * 126 + 3, 122 + t * 136 - 3, -Math.PI / 4]); }
    // along the 縄手 riverbank, facing the water
    for (let i = 0; i < 8; i++) {
      const x = 532 + i * 21;
      if (this.nearBeacon(x, -389, 4)) continue;
      spots.push([x, -389.5, 0]);
    }
    const seat = new THREE.BoxGeometry(1.8, 0.1, 0.5).translate(0, 0.45, 0);
    const back = new THREE.BoxGeometry(1.8, 0.45, 0.08).translate(0, 0.72, -0.22);
    const legs = new THREE.BoxGeometry(1.6, 0.42, 0.4).translate(0, 0.21, 0);
    const geo = mergeGeometries([seat, back, legs]);
    const mesh = new THREE.InstancedMesh(geo, litMaterial(0x7b6a5a), spots.length);
    spots.forEach(([x, z, r], i) => mesh.setMatrixAt(i, compose(x, 0.06, z, r)));
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  // -------------------------------------------------------------------------
  buildShopSigns() {
    const shops = [...this.city.shopBuildings.entries()];
    const signMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const blades = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.7, 0.75), signMat, shops.length);
    const awnings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 1.3), litMaterial(0xffffff), shops.length);
    const c = new THREE.Color();
    const tones = ['#2e3035', '#4b3a2e', '#3d4652', '#6b3b2e'];
    shops.forEach(([id, b], i) => {
      // facade facing the street = local -z side (building depth axis points away from the road)
      const r = this.city.restaurants.find((x) => x.id === id);
      const fx = r ? r.position.x - b.x : 0, fz = r ? r.position.z - b.z : 1;
      const fl = Math.hypot(fx, fz) || 1;
      const nx = fx / fl, nz = fz / fl;
      const half = b.d / 2;
      const tx = -nz, tz = nx; // along the facade
      const bx = b.x + nx * (half + 0.45) + tx * (b.w / 2 - 1.2);
      const bz = b.z + nz * (half + 0.45) + tz * (b.w / 2 - 1.2);
      blades.setMatrixAt(i, compose(bx, Math.min(b.h - 1.2, 4.6), bz, -Math.atan2(tz, tx)));
      blades.setColorAt(i, c.set('#f3ead9'));
      awnings.setMatrixAt(i, compose(b.x + nx * (half + 0.6), 2.9, b.z + nz * (half + 0.6), -Math.atan2(tz, tx), b.w * 0.78, 1, 1));
      awnings.setColorAt(i, c.set(tones[i % tones.length]));
    });
    blades.computeBoundingSphere();
    awnings.computeBoundingSphere();
    awnings.castShadow = true;
    this.group.add(blades, awnings);
    onNightChange((t) => signMat.color.setRGB(0.85 + t * 0.75, 0.82 + t * 0.6, 0.76 + t * 0.4));
  }
}
