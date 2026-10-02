import * as THREE from 'three';
import { U, emitNight } from './materials.js';
import { clamp, tokyoNow } from './util.js';

/**
 * Time of day × weather → lights, fog, sky, exposure, bloom and surface uniforms.
 *
 * - Time is a clock hour (0–24). Presets (DAWN / DAY / DUSK / NIGHT) are just hours;
 *   AUTO follows the current time in Matsumoto.
 * - Everything eases toward its target, so switching presets is a slow, cinematic change.
 */

const C = (hex) => new THREE.Color(hex);

// Key frames by hour. night = how much windows, lamps and signs glow (0..1).
const KEYS = [
  { h: 0.0,  skyTop: C(0x05080f), skyHor: C(0x101624), sun: C(0x9fb4e0), sunI: 0.42, hemiSky: C(0x2a3b63), hemiGround: C(0x0b0d14), hemi: 0.42, fog: C(0x0f1628), exposure: 1.05, bloom: 0.5, threshold: 0.88, night: 1, stars: 1, glowCol: C(0x000000), glow: 0, mountain: C(0x0b1222) },
  { h: 4.6,  skyTop: C(0x05080f), skyHor: C(0x101624), sun: C(0x9fb4e0), sunI: 0.42, hemiSky: C(0x2a3b63), hemiGround: C(0x0b0d14), hemi: 0.42, fog: C(0x0f1628), exposure: 1.05, bloom: 0.5, threshold: 0.88, night: 1, stars: 1, glowCol: C(0x000000), glow: 0, mountain: C(0x0b1222) },
  // blue hour before sunrise
  { h: 5.4,  skyTop: C(0x16233f), skyHor: C(0x5a5b75), sun: C(0x9aa8d0), sunI: 0.5, hemiSky: C(0x52607f), hemiGround: C(0x1c1e26), hemi: 0.6, fog: C(0x3c4256), exposure: 1.02, bloom: 0.42, threshold: 0.88, night: 0.75, stars: 0.35, glowCol: C(0xff8a5c), glow: 0.35, mountain: C(0x1d2236) },
  // sunrise
  { h: 6.2,  skyTop: C(0x4d6a92), skyHor: C(0xf0a978), sun: C(0xffb886), sunI: 2.5, hemiSky: C(0xc4c3cf), hemiGround: C(0x6a5a4e), hemi: 1.0, fog: C(0xd9b49a), exposure: 0.98, bloom: 0.32, threshold: 0.9, night: 0.3, stars: 0, glowCol: C(0xffa060), glow: 1, mountain: C(0x4a4d63) },
  // morning
  { h: 7.6,  skyTop: C(0x7a9cbc), skyHor: C(0xe3dccf), sun: C(0xffe6c8), sunI: 2.6, hemiSky: C(0xdfe6ec), hemiGround: C(0x91877a), hemi: 1.1, fog: C(0xdcd7cd), exposure: 0.95, bloom: 0.22, threshold: 0.95, night: 0, stars: 0, glowCol: C(0xffe2b0), glow: 0.35, mountain: C(0x66727e) },
  // day
  { h: 12.0, skyTop: C(0x80a0b8), skyHor: C(0xded6ca), sun: C(0xfff0dc), sunI: 2.9, hemiSky: C(0xe7ebef), hemiGround: C(0x9a8e7c), hemi: 1.15, fog: C(0xd8d2c7), exposure: 0.95, bloom: 0.22, threshold: 0.95, night: 0, stars: 0, glowCol: C(0xfff4dc), glow: 0.25, mountain: C(0x66727e) },
  // late afternoon
  { h: 15.8, skyTop: C(0x7b97b0), skyHor: C(0xe6d6bf), sun: C(0xffdcae), sunI: 2.6, hemiSky: C(0xe6e2dc), hemiGround: C(0x978773), hemi: 1.05, fog: C(0xdccfbc), exposure: 0.95, bloom: 0.24, threshold: 0.95, night: 0, stars: 0, glowCol: C(0xffd29a), glow: 0.45, mountain: C(0x67707a) },
  // sunset (Matsumoto, autumn: the sun drops behind the Northern Alps)
  { h: 17.0, skyTop: C(0x3f5a82), skyHor: C(0xf09a62), sun: C(0xffa466), sunI: 2.6, hemiSky: C(0xc2b6bd), hemiGround: C(0x6a5446), hemi: 0.95, fog: C(0xcf9f86), exposure: 0.98, bloom: 0.34, threshold: 0.9, night: 0.35, stars: 0, glowCol: C(0xff8a48), glow: 1, mountain: C(0x2e3047) },
  // dusk / blue hour
  { h: 17.8, skyTop: C(0x162443), skyHor: C(0x6b5a72), sun: C(0xa79ccc), sunI: 0.6, hemiSky: C(0x54618a), hemiGround: C(0x1a1b24), hemi: 0.6, fog: C(0x353b55), exposure: 1.03, bloom: 0.46, threshold: 0.88, night: 0.85, stars: 0.3, glowCol: C(0xff7a58), glow: 0.4, mountain: C(0x161b2e) },
  { h: 18.8, skyTop: C(0x05080f), skyHor: C(0x101624), sun: C(0x9fb4e0), sunI: 0.42, hemiSky: C(0x2a3b63), hemiGround: C(0x0b0d14), hemi: 0.42, fog: C(0x0f1628), exposure: 1.05, bloom: 0.5, threshold: 0.88, night: 1, stars: 1, glowCol: C(0x000000), glow: 0, mountain: C(0x0b1222) },
  { h: 24.0, skyTop: C(0x05080f), skyHor: C(0x101624), sun: C(0x9fb4e0), sunI: 0.42, hemiSky: C(0x2a3b63), hemiGround: C(0x0b0d14), hemi: 0.42, fog: C(0x0f1628), exposure: 1.05, bloom: 0.5, threshold: 0.88, night: 1, stars: 1, glowCol: C(0x000000), glow: 0, mountain: C(0x0b1222) },
];
const COLOR_KEYS = ['skyTop', 'skyHor', 'sun', 'hemiSky', 'hemiGround', 'fog', 'glowCol', 'mountain'];
const NUM_KEYS = ['sunI', 'hemi', 'exposure', 'bloom', 'threshold', 'night', 'stars', 'glow'];

export const TIME_PRESETS = {
  dawn: { h: 6.2, label: 'DAWN', ja: '朝焼け' },
  day: { h: 13.0, label: 'DAY', ja: '昼' },
  dusk: { h: 17.0, label: 'DUSK', ja: '夕焼け' },
  night: { h: 21.0, label: 'NIGHT', ja: '夜' },
};
export const TIME_ORDER = ['dawn', 'day', 'dusk', 'night'];

function sample(h) {
  h = ((h % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((h - a.h) / (b.h - a.h), 0, 1);
  const s = t * t * (3 - 2 * t);
  const out = {};
  for (const k of COLOR_KEYS) out[k] = a[k].clone().lerp(b[k], s);
  for (const k of NUM_KEYS) out[k] = a[k] + (b[k] - a[k]) * s;
  return out;
}

/** Sun (or moon at night) direction for a clock hour. +x east, +z south. */
function sunDirection(h) {
  // daytime arc: rises in the east, culminates in the south, sets in the west (behind the Alps)
  const day = clamp((h - 5.8) / (17.4 - 5.8), 0, 1);
  if (h > 5.0 && h < 18.4) {
    const az = Math.PI * day;                 // 0 → east, π/2 → south, π → west
    const el = Math.max(0.05, Math.sin(Math.PI * day)) * 0.95; // radians, max ≈ 54°
    return new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el) * 0.85 + 0.3).normalize();
  }
  return new THREE.Vector3(0.35, 0.85, 0.45).normalize(); // moonlight from the south-east, high
}

const WEATHER = {
  clear: { sky: 0, sunK: 1, hemiK: 1, fogK: 1, glowK: 1, starsK: 1, wet: 0, snow: 0, tint: null },
  rain:  { sky: 0.75, sunK: 0.18, hemiK: 1.12, fogK: 0.42, glowK: 0.15, starsK: 0, wet: 1, snow: 0, tint: C(0x8f979e) },
  snow:  { sky: 0.7, sunK: 0.3, hemiK: 1.3, fogK: 0.5, glowK: 0.2, starsK: 0, wet: 0.2, snow: 1, tint: C(0xc9ced4) },
};

export class Atmosphere {
  constructor(stage) {
    this.stage = stage;
    this.mode = 'auto';      // auto | dawn | day | dusk | night
    this.weather = 'clear';  // clear | rain | snow
    this.cur = null;
    this.target = null;
    this.shadowTimer = 0;
    this.lastShadowDir = new THREE.Vector3();
    this.autoTimer = 0;
  }

  /** The hour currently being shown (AUTO uses Japan time). */
  get hour() {
    if (this.mode === 'auto') return tokyoNow().minutes / 60;
    return TIME_PRESETS[this.mode].h;
  }

  /** Which preset the current hour is closest to, for the UI icon. */
  get phase() {
    const h = this.hour;
    if (h >= 5 && h < 7.2) return 'dawn';
    if (h >= 7.2 && h < 16.4) return 'day';
    if (h >= 16.4 && h < 18.3) return 'dusk';
    return 'night';
  }

  _build() {
    const h = this.hour;
    const p = sample(h);
    const W = WEATHER[this.weather];
    if (W.tint) {
      // overcast: wash the sky toward a soft grey that keeps a hint of the time of day
      const grey = W.tint.clone().multiplyScalar(0.25 + 0.75 * (1 - p.night));
      p.skyTop.lerp(grey, W.sky);
      p.skyHor.lerp(grey.clone().multiplyScalar(1.1), W.sky);
      p.fog.lerp(grey, W.sky * 0.85);
      p.mountain.lerp(grey.clone().multiplyScalar(0.8), W.sky * 0.6);
    }
    p.sunI *= W.sunK;
    p.hemi *= W.hemiK;
    p.glow *= W.glowK;
    p.stars *= W.starsK;
    p.fogNear = (p.night > 0.5 ? 1100 : 1500) * W.fogK;
    p.fogFar = (p.night > 0.5 ? 4800 : 6500) * W.fogK;
    p.wet = W.wet;
    p.snow = W.snow;
    p.sunDir = sunDirection(h);
    return p;
  }

  set(mode, weather) {
    if (mode) this.mode = mode;
    if (weather) this.weather = weather;
    this.target = this._build();
    if (!this.cur) this._snap();
  }

  _snap() {
    const t = this.target;
    this.cur = {};
    for (const k of COLOR_KEYS) this.cur[k] = t[k].clone();
    for (const k of [...NUM_KEYS, 'fogNear', 'fogFar', 'wet', 'snow']) this.cur[k] = t[k];
    this.cur.sunDir = t.sunDir.clone();
    this._apply(true);
  }

  snap() { this.target = this._build(); this._snap(); }

  _apply(forceShadow = false) {
    const st = this.stage, c = this.cur;
    st.hemi.color.copy(c.hemiSky);
    st.hemi.groundColor.copy(c.hemiGround);
    st.hemi.intensity = c.hemi;
    st.sun.color.copy(c.sun);
    st.sun.intensity = c.sunI;
    st.sun.position.copy(st.sun.target.position).addScaledVector(c.sunDir, 1050);
    st.scene.fog.color.copy(c.fog);
    st.scene.fog.near = c.fogNear;
    st.scene.fog.far = c.fogFar;
    U.uFogColor.value.copy(c.fog);
    st.renderer.toneMappingExposure = c.exposure;
    st.bloomBase = c.bloom;
    st.bloom.threshold = c.threshold;
    U.uSkyTop.value.copy(c.skyTop);
    U.uSkyHor.value.copy(c.skyHor);
    U.uSunDir.value.copy(c.sunDir);
    U.uSunGlowCol.value.copy(c.glowCol);
    U.uSunGlow.value = c.glow;
    U.uStars.value = c.stars;
    U.uMountain.value.copy(c.mountain);
    U.uWet.value = c.wet;
    U.uSnow.value = c.snow;
    if (Math.abs(U.uNight.value - c.night) > 1e-4 || forceShadow) {
      U.uNight.value = c.night;
      emitNight(c.night);
    }
    // the shadow map is static: refresh it only when the sun has really moved
    if (forceShadow || this.lastShadowDir.angleTo(c.sunDir) > 0.01) {
      this.wantShadow = true;
    }
  }

  update(dt) {
    if (!this.target) return;
    // AUTO: re-evaluate the clock every 30 s (the change itself is eased)
    if (this.mode === 'auto') {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) { this.autoTimer = 30; this.target = this._build(); }
    }
    const k = 1 - Math.exp(-dt * 1.4);
    const c = this.cur, t = this.target;
    let moving = false;
    for (const key of COLOR_KEYS) {
      const a = c[key], b = t[key];
      if (Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) > 1e-3) { a.lerp(b, k); moving = true; }
    }
    for (const key of [...NUM_KEYS, 'fogNear', 'fogFar', 'wet', 'snow']) {
      if (Math.abs(c[key] - t[key]) > 1e-3) { c[key] += (t[key] - c[key]) * k; moving = true; }
    }
    if (c.sunDir.angleTo(t.sunDir) > 1e-3) { c.sunDir.lerp(t.sunDir, k).normalize(); moving = true; }
    if (moving) this._apply();
    // throttle shadow re-renders to a few per second while the sun is moving
    this.shadowTimer -= dt;
    if (this.wantShadow && this.shadowTimer <= 0) {
      this.stage.renderer.shadowMap.needsUpdate = true;
      this.lastShadowDir.copy(c.sunDir);
      this.wantShadow = false;
      this.shadowTimer = 0.35;
    }
  }

  get isNight() { return (this.target?.night ?? 0) > 0.5; }
}
