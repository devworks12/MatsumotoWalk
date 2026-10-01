import * as THREE from 'three';
import { MODES, WORLD } from './config.js';
import { samplePath } from './pathgeo.js';
import { clamp, damp, easeInOutCubic, wrapAngle, smoothstep, lerp } from './util.js';

export const DEFAULT_VIEW = { target: new THREE.Vector3(WORLD.defaultTarget.x, 0, WORLD.defaultTarget.z), r: 820, theta: 0.42, phi: 0.98 };
/** Portrait screens see less horizontally: back off and look down a little more. */
export function defaultView(stage) {
  if (stage && stage.height > stage.width) return { ...DEFAULT_VIEW, target: DEFAULT_VIEW.target.clone().add(new THREE.Vector3(-40, 0, 60)), r: 1080, phi: 0.82 };
  return DEFAULT_VIEW;
}

/**
 * Owns the camera whenever it is not under direct user control:
 * eased fly-tos (spherical interpolation around a moving target), the opening shot,
 * and the POV route preview with a physically-shaped speed profile.
 */
export class CameraDirector {
  constructor(stage, controls) {
    this.stage = stage;
    this.camera = stage.camera;
    this.controls = controls;
    this.mode = 'orbit';
    this.anim = null;
    this.tour = null;
    this.look = new THREE.Vector3();
    this.roll = 0;
  }

  get busy() { return this.mode !== 'orbit'; }
  get inTour() { return this.mode === 'tour-intro' || this.mode === 'tour' || this.mode === 'arrive' || this.mode === 'arrived'; }

  _sph(pos, target) {
    const o = pos.clone().sub(target);
    const r = o.length();
    return { r, theta: Math.atan2(o.x, o.z), phi: Math.acos(clamp(o.y / r, -1, 1)) };
  }

  /** Eased orbit-space flight. Returns a promise resolved on arrival. */
  flyTo(view, dur = 1.6) {
    this._finishAnim(false);
    const t0 = this.controls.target.clone();
    const s0 = this._sph(this.camera.position, t0);
    const t1 = view.target ? view.target.clone() : t0.clone();
    const r1 = view.r ?? s0.r;
    const th1 = view.theta ?? s0.theta;
    const ph1 = view.phi ?? s0.phi;
    const dTh = wrapAngle(th1 - s0.theta);
    this.mode = 'flying';
    this.controls.enabled = false;
    return new Promise((resolve) => {
      this.anim = {
        t: 0, dur: Math.max(0.01, dur), resolve,
        step: (k) => {
          const e = easeInOutCubic(k);
          const tg = t0.clone().lerp(t1, e);
          const r = s0.r * Math.pow(r1 / s0.r, e);
          const th = s0.theta + dTh * e;
          const ph = lerp(s0.phi, ph1, e);
          this.camera.position.set(
            tg.x + r * Math.sin(ph) * Math.sin(th),
            tg.y + r * Math.cos(ph),
            tg.z + r * Math.sin(ph) * Math.cos(th),
          );
          this.camera.up.set(0, 1, 0);
          this.camera.lookAt(tg);
          this.controls.target.copy(tg);
        },
      };
    });
  }

  _finishAnim(jump) {
    if (!this.anim) return;
    const a = this.anim;
    this.anim = null;
    if (jump) a.step(1);
    this.mode = 'orbit';
    this.controls.enabled = true;
    this.controls.update();
    a.resolve();
  }

  /** Skip whatever flight is running (opening shot, fly-to). */
  skip() { if (this.anim) this._finishAnim(true); }

  /** View that frames a set of xz points. */
  viewFor(points, { minR = 140, maxR = 2400, phi, keepTheta = true, panel = 0 } = {}) {
    const portrait = this.stage.height > this.stage.width;
    phi = phi ?? 0.84;
    if (portrait) phi = Math.min(phi, 0.62); // steeper on phones so routes fill the narrow screen
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of points) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const size = Math.max(x1 - x0, z1 - z0, 60);
    const vf = (this.camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const free = panel > 0 ? Math.max(0.35, 1 - panel / this.stage.width) : 1;
    const f = Math.min(vf, 2 * Math.atan(Math.tan(hf / 2) * free));
    const r = clamp((size * (portrait ? 0.56 : 0.66)) / Math.tan(f / 2), minR, maxR);
    const cur = this._sph(this.camera.position, this.controls.target);
    // On phones the bottom sheet covers the lower part: shift the target slightly "down-screen"
    const target = new THREE.Vector3(cx, 0, cz);
    if (this.stage.height > this.stage.width) {
      const th = keepTheta ? cur.theta : 0.42;
      target.x += Math.sin(th) * size * 0.22;
      target.z += Math.cos(th) * size * 0.22;
    }
    if (panel > 0) {
      // slide the target right (screen space) so the content centres in the area left of the panel
      const th = keepTheta ? cur.theta : 0.42;
      const worldW = 2 * r * Math.tan(hf / 2);
      const shift = (panel / 2 / this.stage.width) * worldW;
      target.x += Math.cos(th) * shift;
      target.z += -Math.sin(th) * shift;
    }
    return { target, r, theta: keepTheta ? cur.theta : 0.42, phi };
  }

  playOpening(duration = 3.6) {
    const end = defaultView(this.stage);
    const t = end.target;
    // Start low on the far side of the city with the Northern Alps on the horizon, then rise toward the station.
    const r0 = 1650, th0 = 1.32, ph0 = 1.34;
    this.camera.position.set(t.x + r0 * Math.sin(ph0) * Math.sin(th0), r0 * Math.cos(ph0), t.z + r0 * Math.sin(ph0) * Math.cos(th0));
    this.controls.target.copy(t);
    this.camera.lookAt(t);
    return this.flyTo(end, duration);
  }

  // ---------------------------------------------------------------------------
  // POV route preview
  // ---------------------------------------------------------------------------
  _profile(path, M, stopS) {
    const n = Math.max(2, Math.floor(stopS) + 1);
    const heading = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = samplePath(path, i); heading[i] = Math.atan2(p.dz, p.dx); }
    const desiredT = clamp(stopS / M.speed, M.minDuration, M.maxDuration);
    const base = (stopS / desiredT) * 1.3;
    const vmax = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.abs(wrapAngle(heading[Math.min(n - 1, i + 3)] - heading[Math.max(0, i - 3)])) / 6;
      let f = clamp(1 - k * 2.6, M.corner, 1);
      for (const sj of path.junctions) {
        const dj = Math.abs(i - sj);
        if (dj < 14) f = Math.min(f, 0.68 + 0.32 * (dj / 14));
      }
      vmax[i] = base * f;
    }
    const accD = Math.max(14, base * 2.0), decD = Math.max(20, base * 2.8);
    const a = (base * base) / (2 * accD), b = (base * base) / (2 * decD);
    const v = new Float32Array(n);
    v[0] = Math.min(vmax[0], 0.9);
    for (let i = 1; i < n; i++) v[i] = Math.min(vmax[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * a));
    v[n - 1] = Math.min(v[n - 1], 0.35);
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * b));
    const t = new Float32Array(n);
    for (let i = 1; i < n; i++) t[i] = t[i - 1] + 2 / Math.max(0.25, v[i] + v[i - 1]);
    let T = t[n - 1];
    const cap = M.maxDuration * 1.1;
    if (T > cap) { const f = cap / T; for (let i = 0; i < n; i++) t[i] *= f; T = cap; }
    return { t, n, T, heading };
  }

  _sAt(prof, time) {
    const { t, n } = prof;
    if (time <= 0) return 0;
    if (time >= t[n - 1]) return n - 1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= time) lo = m; else hi = m; }
    return lo + (time - t[lo]) / Math.max(1e-6, t[hi] - t[lo]);
  }

  /**
   * @param path   from buildRoutePath
   * @param opts   { reduced, focus:{x,y,z}, onArrive, onProgress }
   */
  startTour(path, opts = {}) {
    this._finishAnim(false);
    const M = MODES[path.mode].tour;
    const stopDist = path.mode === 'car' ? 3 : path.mode === 'bike' ? 10 : 8.5;
    const stopS = Math.max(2, path.length - stopDist);
    const prof = this._profile(path, M, stopS);
    const focus = opts.focus ?? new THREE.Vector3(path.shop.x, 5, path.shop.z);
    this.tour = { path, M, stopS, prof, focus, opts, time: 0, intro: 0, introDur: opts.reduced ? 0.01 : 1.8, arrive: 0, arrived: false };
    this.controls.enabled = false;
    this.stage.setNearForDistance(0); // POV near plane
    this.tour.fromPos = this.camera.position.clone();
    this.tour.fromLook = this.controls.target.clone();
    const p0 = samplePath(path, 0);
    const pl = samplePath(path, Math.min(path.length, M.lookAhead));
    this.tour.startPos = new THREE.Vector3(p0.x, M.eye, p0.z);
    this.tour.startLook = new THREE.Vector3(pl.x, M.eye * 0.75, pl.z);
    this.roll = 0;
    if (opts.reduced) {
      // Reduced motion: no travelling shot — cut straight to the arrival view.
      const ps = samplePath(path, stopS);
      if (opts.arrival) this.camera.position.copy(opts.arrival.pos);
      else this.camera.position.set(ps.x, M.eye, ps.z);
      this.look.copy(focus);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.look);
      this.mode = 'arrived';
      this.tour.arrived = true;
      opts.onProgress?.(1, 0);
      opts.onArrive?.();
      return;
    }
    this.mode = 'tour-intro';
  }

  stopTour() {
    // Re-anchor the orbit target on what the camera is looking at, so the next fly-to rises smoothly.
    if (this.tour) this.controls.target.copy(this.look).setY(0);
    this.tour = null;
    this.camera.up.set(0, 1, 0);
    this.mode = 'orbit';
  }

  /** Called while orbiting to keep a look vector consistent for later transitions. */
  update(dt) {
    if (this.anim) {
      this.anim.t += dt;
      const k = Math.min(1, this.anim.t / this.anim.dur);
      this.anim.step(k);
      if (k >= 1) this._finishAnim(false);
      return;
    }
    const T = this.tour;
    if (!T) return;
    const cam = this.camera;
    if (this.mode === 'tour-intro') {
      T.intro += dt;
      const k = Math.min(1, T.intro / T.introDur);
      const e = easeInOutCubic(k);
      const pos = T.fromPos.clone().lerp(T.startPos, e);
      pos.y += Math.sin(Math.PI * e) * T.fromPos.distanceTo(T.startPos) * 0.08;
      cam.position.copy(pos);
      this.look.copy(T.fromLook).lerp(T.startLook, easeInOutCubic(Math.min(1, k * 1.15)));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      this.stage.setNearForDistance(lerp(cam.position.distanceTo(T.fromLook) * 0.5, 0, e));
      if (k >= 1) { this.mode = 'tour'; T.time = 0; }
      return;
    }
    if (this.mode === 'tour') {
      T.time += dt;
      const s = this._sAt(T.prof, T.time);
      const p = samplePath(T.path, s);
      const M = T.M;
      const bob = T.path.mode === 'walk' ? Math.sin(s * (Math.PI * 2) / 1.45) * 0.035 : T.path.mode === 'bike' ? Math.sin(s * 0.9) * 0.012 : 0;
      cam.position.set(p.x, M.eye + bob, p.z);
      const q = samplePath(T.path, Math.min(T.path.length, s + M.lookAhead));
      const desired = new THREE.Vector3(q.x, M.eye * 0.72, q.z);
      const w = smoothstep(T.stopS - 26, T.stopS, s);
      desired.lerp(T.focus, w);
      this.look.lerp(desired, 1 - Math.exp(-dt * (T.path.mode === 'car' ? 3.2 : 4.2)));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      if (T.path.mode === 'bike') {
        const h0 = samplePath(T.path, Math.max(0, s - 4)), h1 = samplePath(T.path, Math.min(T.path.length, s + 4));
        const turn = wrapAngle(Math.atan2(h1.dz, h1.dx) - Math.atan2(h0.dz, h0.dx));
        this.roll = damp(this.roll, clamp(-turn * 0.35, -0.12, 0.12), 3, dt);
        cam.rotateZ(this.roll);
      }
      T.opts.onProgress?.(s / T.stopS, Math.max(0, T.path.length - s));
      if (T.time >= T.prof.T) {
        this.mode = 'arrive';
        T.arrive = 0;
        T.arrivePos = cam.position.clone();
        T.opts.onArrive?.();
      }
      return;
    }
    if (this.mode === 'arrive') {
      T.arrive += dt;
      const k = Math.min(1, T.arrive / 2.0);
      const e = easeInOutCubic(k);
      this.roll = damp(this.roll, 0, 4, dt);
      if (T.opts.arrival) {
        // glide sideways into the street to frame the shop front
        cam.position.copy(T.arrivePos).lerp(T.opts.arrival.pos, e);
      } else {
        cam.position.copy(T.arrivePos);
        cam.position.y += e * 0.6;
      }
      this.look.lerp(T.focus, 1 - Math.exp(-dt * 3.2));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      if (k >= 1 && this.look.distanceTo(T.focus) < 0.05) this.mode = 'arrived';
    }
  }
}
