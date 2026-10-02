import * as THREE from 'three';
import { U } from './materials.js';
import { damp } from './util.js';

/**
 * Rain streaks and snowflakes in a box that travels with the camera.
 * Positions wrap in the vertex shader (no CPU work per frame).
 * The box scales with zoom so precipitation reads both from the street and from above.
 */
export class Precipitation {
  constructor(scene) {
    this.scene = scene;
    this.rainAmt = 0;
    this.snowAmt = 0;
    this.target = { rain: 0, snow: 0 };
    this.uni = {
      uTime: U.uTime,
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(120, 80, 120) },
      uAmt: { value: 0 },
      uNight: U.uNight,
      uFogColor: U.uFogColor,
    };
    this._rain();
    this._snow();
  }

  _rain() {
    const N = 4200;
    const pos = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      for (let k = 0; k < 2; k++) {
        pos[(i * 2 + k) * 3] = x; pos[(i * 2 + k) * 3 + 1] = y; pos[(i * 2 + k) * 3 + 2] = z;
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const uni = { ...this.uni, uAmt: { value: 0 }, uCenter: this.uni.uCenter, uBox: this.uni.uBox };
    this.rainU = uni;
    const m = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform float uAmt;
        attribute float aEnd; varying float vA;
        void main(){
          vec3 p = position;
          float speed = 0.55 + 0.25 * fract(p.x * 91.7);
          p.y = fract(p.y - uTime * speed * (34.0 / uBox.y));
          vec3 w = uCenter + (p - 0.5) * uBox;
          // wrap horizontally around the camera
          w.xz = uCenter.xz + (fract((w.xz - uCenter.xz) / uBox.xz + 0.5) - 0.5) * uBox.xz;
          float len = uBox.y * 0.018;
          w += vec3(0.25, -1.0, 0.12) * len * aEnd; // slight wind slant
          w.y = max(w.y, 0.05);
          vA = (0.35 + 0.65 * fract(p.z * 37.3)) * step(fract(p.x * 13.1), uAmt);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight; varying float vA;
        void main(){
          vec3 c = mix(vec3(0.78, 0.82, 0.88), vec3(0.75, 0.68, 0.58), uNight);
          gl_FragColor = vec4(c, vA * 0.38);
        }`,
    });
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 8;
    this.scene.add(this.rain);
  }

  _snow() {
    const N = 5200;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const uni = { ...this.uni, uAmt: { value: 0 }, uCenter: this.uni.uCenter, uBox: this.uni.uBox, uPx: { value: 1 } };
    this.snowU = uni;
    const m = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform float uAmt; uniform float uPx;
        varying float vA;
        void main(){
          vec3 p = position;
          float speed = 0.5 + 0.5 * fract(p.x * 71.3);
          p.y = fract(p.y - uTime * speed * (1.6 / uBox.y) * (uBox.y / 80.0));
          vec3 w = uCenter + (p - 0.5) * uBox;
          float ph = uTime * (0.6 + p.z) + p.x * 40.0;
          w.x += sin(ph) * uBox.x * 0.006;
          w.z += cos(ph * 0.8) * uBox.z * 0.006;
          w.xz = uCenter.xz + (fract((w.xz - uCenter.xz) / uBox.xz + 0.5) - 0.5) * uBox.xz;
          w.y = max(w.y, 0.05);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = (0.06 + 0.06 * fract(p.z * 53.1)) * (uBox.y / 80.0);
          gl_PointSize = clamp(size * uPx / -mv.z, 1.0, 14.0);
          vA = step(fract(p.x * 13.1), uAmt);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight; varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - smoothstep(0.2, 0.5, length(c));
          vec3 col = mix(vec3(0.97, 0.98, 1.0), vec3(0.85, 0.82, 0.78), uNight);
          gl_FragColor = vec4(col, d * vA * 0.9);
        }`,
    });
    this.snow = new THREE.Points(g, m);
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.snow.renderOrder = 8;
    this.scene.add(this.snow);
  }

  setWeather(w) {
    this.target.rain = w === 'rain' ? 1 : 0;
    this.target.snow = w === 'snow' ? 1 : 0;
  }

  /** camDist ≈ zoom level; drives the size of the precipitation box. */
  update(dt, camera, camDist, viewportH) {
    this.rainAmt = damp(this.rainAmt, this.target.rain, 1.2, dt);
    this.snowAmt = damp(this.snowAmt, this.target.snow, 1.2, dt);
    const s = Math.min(Math.max(camDist, 25) * 1.1, 900);
    this.uni.uBox.value.set(s * 1.6, s * 0.9, s * 1.6);
    // centre the box slightly in front of the camera
    const dir = camera.getWorldDirection(this._d || (this._d = new THREE.Vector3()));
    this.uni.uCenter.value.copy(camera.position).addScaledVector(dir, s * 0.35);
    this.uni.uCenter.value.y = Math.max(s * 0.45, camera.position.y * 0.6);
    this.rainU.uAmt.value = this.rainAmt;
    this.snowU.uAmt.value = this.snowAmt;
    this.snowU.uPx.value = viewportH * 0.9;
    this.rain.visible = this.rainAmt > 0.01;
    this.snow.visible = this.snowAmt > 0.01;
  }
}
