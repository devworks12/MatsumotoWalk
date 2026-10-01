import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { U, emitNight, createSkyMaterial } from './materials.js';
import { damp, clamp } from './util.js';

const DAY = {
  hemiSky: new THREE.Color(0xe7ebef), hemiGround: new THREE.Color(0x9a8e7c), hemi: 1.15,
  sun: new THREE.Color(0xfff0dc), sunI: 2.9,
  fog: new THREE.Color(0xd8d2c7), fogNear: 1500, fogFar: 6500,
  exposure: 0.95, bloom: 0.22, threshold: 0.95,
};
const NIGHT = {
  hemiSky: new THREE.Color(0x2a3b63), hemiGround: new THREE.Color(0x0b0d14), hemi: 0.42,
  sun: new THREE.Color(0x9fb4e0), sunI: 0.42,
  fog: new THREE.Color(0x0f1628), fogNear: 1100, fogFar: 4800,
  exposure: 1.05, bloom: 0.5, threshold: 0.88,
};

/**
 * Renderer, camera, lights, sky, post-processing, day/night and adaptive resolution.
 */
export class Stage {
  constructor(canvas, { quality = 'auto' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = DAY.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // PCF (not PCFSoft) on phones: noticeably cheaper per pixel at high DPR
    this.renderer.shadowMap.type = Math.min(window.innerWidth, window.innerHeight) < 600 ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // static city: render shadows on demand only

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(DAY.fog.clone(), DAY.fogNear, DAY.fogFar);
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);
    this.camera.position.set(800, 600, 500);

    // Lights
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
    this.sunOffset = new THREE.Vector3(-700, 600, 430);
    this.sun.target.position.set(380, 0, -220);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -760; sc.right = 760; sc.top = 760; sc.bottom = -760; sc.near = 100; sc.far = 2400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.8;
    this.scene.add(this.sun, this.sun.target);

    // Sky dome
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), createSkyMaterial());
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    this.nightTarget = 0;
    this.dpr = 1;
    this.fpsSamples = [];
    this.lastAdapt = 0;
    this.useBloom = true;
    this._setupComposer();
    this.setQuality(quality);
    this.resize();
  }

  _setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // Low-DPR screens (most desktops) get 4× MSAA on the HDR target; retina phones don't need it.
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: (window.devicePixelRatio || 1) < 1.5 ? 4 : 0,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), DAY.bloom, 0.55, DAY.threshold);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
  }

  setQuality(q) {
    this.quality = q;
    const native = window.devicePixelRatio || 1;
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    if (q === 'high') this.maxDpr = Math.min(native, 2);
    else if (q === 'low') this.maxDpr = Math.min(native, 1);
    else this.maxDpr = Math.min(native, small ? 2 : 1.75);
    this.dpr = this.maxDpr;
    this.useBloom = q !== 'low';
    const mapSize = q === 'low' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = w; this.height = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    // bloom works on a reduced buffer — plenty for a soft glow and cheap on phones
    this.bloom.setSize(Math.round((w * this.dpr) / 2), Math.round((h * this.dpr) / 2));
    this.camera.aspect = w / h;
    this.baseFov = w < h ? 52 : 42; // portrait phones need a wider vertical field of view
    this.povFov = w < h ? 70 : 56;  // street level wants a wider lens (esp. narrow portrait screens)
    this.applyFov(this.povAmt ?? 0);
  }

  applyFov(povAmt) {
    this.povAmt = povAmt;
    const fov = this.baseFov + (this.povFov - this.baseFov) * povAmt;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setNight(on) { this.nightTarget = on ? 1 : 0; }
  get isNight() { return this.nightTarget > 0.5; }

  _applyNight(t) {
    const L = (a, b) => a + (b - a) * t;
    this.hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, t);
    this.hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, t);
    this.hemi.intensity = L(DAY.hemi, NIGHT.hemi);
    this.sun.color.copy(DAY.sun).lerp(NIGHT.sun, t);
    this.sun.intensity = L(DAY.sunI, NIGHT.sunI);
    this.scene.fog.color.copy(DAY.fog).lerp(NIGHT.fog, t);
    U.uFogColor.value.copy(this.scene.fog.color);
    this.scene.fog.near = L(DAY.fogNear, NIGHT.fogNear);
    this.scene.fog.far = L(DAY.fogFar, NIGHT.fogFar);
    this.renderer.toneMappingExposure = L(DAY.exposure, NIGHT.exposure);
    this.bloomBase = L(DAY.bloom, NIGHT.bloom);
    this.bloom.strength = this.bloomBase * (this.bloomScale ?? 1);
    this.bloom.threshold = L(DAY.threshold, NIGHT.threshold);
    U.uNight.value = t;
    emitNight(t);
  }

  /** Adaptive resolution: drop DPR when frames are slow, recover slowly when fast. */
  _adapt(dt, now) {
    if (this.quality !== 'auto') return;
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length < 50 || now - this.lastAdapt < 1500) return;
    const sorted = [...this.fpsSamples].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    this.fpsSamples.length = 0;
    this.lastAdapt = now;
    const fps = 1 / Math.max(1e-4, p50);
    let next = this.dpr;
    if (fps < 40) next = Math.max(0.75, this.dpr - 0.25);
    else if (fps > 57 && this.dpr < this.maxDpr) next = Math.min(this.maxDpr, this.dpr + 0.125);
    if (fps < 26 && this.useBloom && this.dpr <= 1) this.useBloom = false;
    if (next !== this.dpr) { this.dpr = next; this.resize(); }
  }

  update(dt, now) {
    U.uTime.value += dt;
    const cur = U.uNight.value;
    if (Math.abs(cur - this.nightTarget) > 0.001) {
      const t = clamp(cur + Math.sign(this.nightTarget - cur) * dt / 1.6, 0, 1);
      this._applyNight(t);
      if (Math.abs(t - this.nightTarget) < 0.001) this.renderer.shadowMap.needsUpdate = true;
    }
    // Near plane follows zoom level: keeps depth precision high (no z-fighting on road layers).
    this.sky.position.copy(this.camera.position);
    this._adapt(dt, now);
  }

  setNearForDistance(dist) {
    const near = clamp(dist * 0.025, 0.25, 30);
    if (Math.abs(near - this.camera.near) > 0.01) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  render() {
    if (this.bloomBase !== undefined) this.bloom.strength = this.bloomBase * (this.bloomScale ?? 1);
    if (this.useBloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  applyNightImmediately(on) {
    this.nightTarget = on ? 1 : 0;
    this._applyNight(this.nightTarget);
    this.renderer.shadowMap.needsUpdate = true;
  }
}
