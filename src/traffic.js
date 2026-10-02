import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { litMaterial, onNightChange } from './materials.js';
import { mulberry32, damp, wrapAngle } from './util.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p3 = new THREE.Vector3();
const s3 = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Tiny moving cars, people and trains — the "miniature city" is alive, but never busy. */
export class Traffic {
  constructor(city) {
    this.city = city;
    this.group = new THREE.Group();
    city.scene.add(this.group);
    this.rnd = mulberry32(404);
    const nodes = city.nodeById;
    this.halves = { car: new Map(), walk: new Map() };
    for (const id of nodes.keys()) { this.halves.car.set(id, []); this.halves.walk.set(id, []); }
    for (const e of city.roads.edges) {
      const a = nodes.get(e.from), b = nodes.get(e.to);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const f = { e, a, b, len, dx, dz, to: e.to };
      const r = { e, a: b, b: a, len, dx: -dx, dz: -dz, to: e.from };
      if (e.car && e.roadType !== 'plaza') {
        this.halves.car.get(e.from).push(f);
        if (e.oneway !== 'forward') this.halves.car.get(e.to).push(r);
      }
      if (e.walk && e.roadType !== 'passage') {
        this.halves.walk.get(e.from).push(f);
        this.halves.walk.get(e.to).push(r);
      }
    }
  }

  build() {
    this.buildCars(34);
    this.buildPeople(170);
    this.buildTrains();
  }

  _spawn(kind) {
    const R = this.rnd;
    const all = [...this.halves[kind].values()].flat();
    const h = all[Math.floor(R() * all.length)];
    return { h, s: R() * h.len, yaw: -Math.atan2(h.dz, h.dx) };
  }

  _advance(agent, kind, dist) {
    agent.s += dist;
    let guard = 0;
    while (agent.s > agent.h.len && guard++ < 4) {
      agent.s -= agent.h.len;
      const opts = this.halves[kind].get(agent.h.to).filter((n) => n.e !== agent.h.e);
      const list = opts.length ? opts : this.halves[kind].get(agent.h.to);
      if (!list.length) { agent.s = 0; break; }
      // prefer going straight a little
      const straight = list.filter((n) => n.dx * agent.h.dx + n.dz * agent.h.dz > 0.9);
      const pool = straight.length && this.rnd() < 0.55 ? straight : list;
      agent.h = pool[Math.floor(this.rnd() * pool.length)];
    }
  }

  // ---------------------------------------------------------------------------
  buildCars(n) {
    const body = new THREE.BoxGeometry(4.3, 0.85, 1.75).translate(0, 0.62, 0);
    const cabin = new THREE.BoxGeometry(2.3, 0.62, 1.55).translate(-0.25, 1.35, 0);
    const geo = mergeGeometries([body, cabin]);
    this.carMesh = new THREE.InstancedMesh(geo, litMaterial(0xffffff, { roughness: 0.5, metalness: 0.2 }), n);
    this.carMesh.frustumCulled = false;
    // head & tail lights (night only)
    const lightGeo = mergeGeometries([
      new THREE.BoxGeometry(0.06, 0.16, 0.34).translate(2.16, 0.78, 0.6),
      new THREE.BoxGeometry(0.06, 0.16, 0.34).translate(2.16, 0.78, -0.6),
    ]);
    const tailGeo = mergeGeometries([
      new THREE.BoxGeometry(0.06, 0.14, 0.3).translate(-2.16, 0.82, 0.62),
      new THREE.BoxGeometry(0.06, 0.14, 0.3).translate(-2.16, 0.82, -0.62),
    ]);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3a24 });
    this.carHead = new THREE.InstancedMesh(lightGeo, headMat, n);
    this.carTail = new THREE.InstancedMesh(tailGeo, tailMat, n);
    this.carHead.frustumCulled = this.carTail.frustumCulled = false;
    onNightChange((t) => {
      headMat.color.setRGB(1, 0.92, 0.78).multiplyScalar(0.6 + t * 3.2);
      tailMat.color.setRGB(1, 0.18, 0.1).multiplyScalar(0.5 + t * 2.4);
      this.carHead.visible = this.carTail.visible = t > 0.05;
    });
    const colors = ['#ebe7df', '#e3dfd6', '#2c2e33', '#8c9096', '#b9bcc0', '#3c4a63', '#7b3d33', '#d8d2c4'];
    const c = new THREE.Color();
    this.cars = [];
    for (let i = 0; i < n; i++) {
      const a = this._spawn('car');
      a.speed = 6.5 + this.rnd() * 3;
      this.cars.push(a);
      this.carMesh.setColorAt(i, c.set(colors[i % colors.length]));
    }
    // no castShadow on moving things: the shadow map is static (rendered on demand only)
    this.group.add(this.carMesh, this.carHead, this.carTail);
  }

  // ---------------------------------------------------------------------------
  buildPeople(n) {
    const geo = mergeGeometries([
      new THREE.CylinderGeometry(0.2, 0.25, 1.15, 6).translate(0, 0.6, 0),
      new THREE.SphereGeometry(0.17, 8, 6).translate(0, 1.38, 0),
    ]);
    this.peopleMesh = new THREE.InstancedMesh(geo, litMaterial(0xffffff), n);
    this.peopleMesh.frustumCulled = false;
    const tones = ['#3b3e45', '#5a4c42', '#8a7f72', '#2f3a4f', '#a59b8c', '#6d5a4c', '#c8bfb1', '#404a3e'];
    const c = new THREE.Color();
    this.people = [];
    for (let i = 0; i < n; i++) {
      const a = this._spawn('walk');
      a.speed = 1.0 + this.rnd() * 0.5;
      a.side = this.rnd() < 0.5 ? -1 : 1;
      a.jitter = (this.rnd() - 0.5) * 1.2;
      this.people.push(a);
      this.peopleMesh.setColorAt(i, c.set(tones[i % tones.length]));
    }
    this.group.add(this.peopleMesh);
  }

  // ---------------------------------------------------------------------------
  buildTrains() {
    const car = mergeGeometries([new THREE.BoxGeometry(2.9, 3.3, 19.6).translate(0, 2.25, 0)]);
    const windows = new THREE.BoxGeometry(2.96, 0.95, 18.4).translate(0, 2.65, 0);
    const stripe = new THREE.BoxGeometry(2.97, 0.22, 19.4).translate(0, 1.45, 0);
    const count = 12;
    this.trainBody = new THREE.InstancedMesh(car, litMaterial(0xe9e6df, { roughness: 0.45 }), count);
    const winMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.2, emissive: 0xffd9a8, emissiveIntensity: 0 });
    this.trainWin = new THREE.InstancedMesh(windows, winMat, count);
    this.trainStripe = new THREE.InstancedMesh(stripe, litMaterial(0x4a4f78), count);
    [this.trainBody, this.trainWin, this.trainStripe].forEach((m) => { m.frustumCulled = false; this.group.add(m); });
    onNightChange((t) => { winMat.emissiveIntensity = t * 1.4; });
    // parked train on the east track
    for (let i = 0; i < 6; i++) this._setTrainCar(6 + i, -38, 70 - i * 20.3);
    this.trainClock = 18;
  }

  _setTrainCar(i, x, z) {
    m4.compose(p3.set(x, 0.1, z), q.identity(), s3.set(1, 1, 1));
    this.trainBody.setMatrixAt(i, m4);
    this.trainWin.setMatrixAt(i, m4);
    this.trainStripe.setMatrixAt(i, m4);
  }

  _updateTrain(dt) {
    // 120 s loop: arrive (decelerate) → dwell → depart (accelerate) → off-screen
    this.trainClock = (this.trainClock + dt) % 120;
    const t = this.trainClock;
    let head;
    if (t < 30) head = -2600 + (2600 + 70) * (1 - Math.pow(1 - t / 30, 2.2));
    else if (t < 55) head = 70;
    else if (t < 90) head = 70 + 2700 * Math.pow((t - 55) / 35, 2.2);
    else head = 9999;
    for (let i = 0; i < 6; i++) {
      const z = head - i * 20.3;
      this._setTrainCar(i, -96, Math.abs(z) > 3000 ? 99999 : z);
    }
    this.trainBody.instanceMatrix.needsUpdate = this.trainWin.instanceMatrix.needsUpdate = this.trainStripe.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  update(dt) {
    dt = Math.min(dt, 0.1);
    for (let i = 0; i < this.cars.length; i++) {
      const a = this.cars[i];
      this._advance(a, 'car', a.speed * dt);
      const h = a.h;
      const lane = h.e.width / 4;
      const x = h.a.x + h.dx * a.s + h.dz * lane;
      const z = h.a.z + h.dz * a.s - h.dx * lane;
      const target = -Math.atan2(h.dz, h.dx);
      a.yaw += wrapAngle(target - a.yaw) * (1 - Math.exp(-8 * dt));
      q.setFromAxisAngle(UP, a.yaw);
      m4.compose(p3.set(x, 0.12, z), q, s3.set(1, 1, 1));
      this.carMesh.setMatrixAt(i, m4);
      this.carHead.setMatrixAt(i, m4);
      this.carTail.setMatrixAt(i, m4);
    }
    this.carMesh.instanceMatrix.needsUpdate = true;
    if (this.carHead.visible) { this.carHead.instanceMatrix.needsUpdate = true; this.carTail.instanceMatrix.needsUpdate = true; }

    for (let i = 0; i < this.people.length; i++) {
      const a = this.people[i];
      this._advance(a, 'walk', a.speed * dt);
      const h = a.h;
      const off = h.e.sidewalk > 0 ? h.e.width / 2 + h.e.sidewalk * 0.5 : Math.max(0.5, h.e.width / 2 - 1.2);
      const o = (off + a.jitter * (h.e.sidewalk > 0 ? 0.4 : 1)) * a.side;
      const x = h.a.x + h.dx * a.s + h.dz * o;
      const z = h.a.z + h.dz * a.s - h.dx * o;
      a.yaw = damp(a.yaw, a.yaw + wrapAngle(-Math.atan2(h.dz, h.dx) - a.yaw), 10, dt);
      q.setFromAxisAngle(UP, a.yaw);
      m4.compose(p3.set(x, 0.08, z), q, s3.set(1, 1, 1));
      this.peopleMesh.setMatrixAt(i, m4);
    }
    this.peopleMesh.instanceMatrix.needsUpdate = true;
    this._updateTrain(dt);
  }
}

