import * as THREE from 'three';
import { U, radialTexture } from './materials.js';
import { easeInOutCubic, clamp } from './util.js';
import { MODES } from './config.js';

/**
 * Glowing route ribbon laid on the street. Grows from the station to the shop,
 * with light pulses travelling along it. Car routes show the final walk leg dashed.
 */
export class RouteLine {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.reveal = 0;
    this.revealDur = 1.8;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      // keep clear of the road / marking layers at grazing angles (they use polygonOffset too)
      polygonOffset: true,
      polygonOffsetFactor: -12,
      polygonOffsetUnits: -12,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uReveal: { value: 0 }, uLen: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.6, 0.24) },
          uLegBreak: { value: -1 }, uOpacity: { value: 1 }, uNight: { value: 0 }, uTime: { value: 0 },
          uHalfWidth: { value: 1 },
        },
      ]),
      vertexShader: /* glsl */ `
        attribute float aAlong; attribute float aSide; attribute vec2 aNormal;
        uniform float uHalfWidth;
        varying float vAlong; varying float vSide; varying float vDepth;
        #include <fog_pars_vertex>
        void main(){
          vAlong = aAlong; vSide = aSide;
          // centre line + sideways offset: width is a uniform so the line keeps its weight when zoomed out
          vec3 p = position + vec3(aNormal.x, 0.0, aNormal.y) * aSide * uHalfWidth;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          vDepth = -mvPosition.z;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uReveal; uniform float uLen; uniform vec3 uColor; uniform float uLegBreak;
        uniform float uOpacity; uniform float uNight; uniform float uTime;
        varying float vAlong; varying float vSide; varying float vDepth;
        #include <fog_pars_fragment>
        void main(){
          float head = uReveal * uLen;
          if (vAlong > head) discard;
          float d = abs(vSide);
          float core = 1.0 - smoothstep(0.0, 0.28, d);
          float body = 1.0 - smoothstep(0.45, 1.0, d);
          float flow = fract((vAlong - uTime * 11.0) / 14.0);
          float pulse = smoothstep(0.0, 0.05, flow) * (1.0 - smoothstep(0.05, 0.3, flow));
          float headGlow = smoothstep(head - 16.0, head, vAlong) * (1.0 - step(0.999, uReveal));
          float walkLeg = uLegBreak >= 0.0 ? step(uLegBreak, vAlong) : 0.0;
          float dash = mix(1.0, step(0.45, fract(vAlong / 3.2)), walkLeg);
          float start = smoothstep(0.0, 6.0, vAlong);
          float near = smoothstep(1.5, 16.0, vDepth); // never flare right under a street-level camera
          float a = (body * 0.32 + core * 0.62 + pulse * body * 0.55 + headGlow * body * 0.7) * dash * start * near;
          vec3 col = uColor * (0.85 + core * 1.1 + pulse * 1.7 + headGlow * 1.8) * mix(1.0, 1.25, uNight);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.headSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture(64, 'rgba(255,215,160,1)', 'rgba(255,150,60,0)'),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    this.headSprite.scale.set(9, 9, 1);
    this.headSprite.visible = false;
    this.headSprite.renderOrder = 6;
    scene.add(this.headSprite);
    this.path = null;
  }

  show(path, { instant = false } = {}) {
    this.hide();
    const width = MODES[path.mode].tour.line;
    const n = path.x.length;
    const pos = new Float32Array(n * 2 * 3);
    const nrm = new Float32Array(n * 2 * 2);
    const along = new Float32Array(n * 2);
    const side = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      let dx = path.x[i1] - path.x[i0], dz = path.z[i1] - path.z[i0];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      for (let k = 0; k < 2; k++) {
        const sg = k === 0 ? -1 : 1;
        const o = (i * 2 + k) * 3;
        pos[o] = path.x[i];
        pos[o + 1] = 0.42;
        pos[o + 2] = path.z[i];
        nrm[(i * 2 + k) * 2] = nx;
        nrm[(i * 2 + k) * 2 + 1] = nz;
        along[i * 2 + k] = path.s[i];
        side[i * 2 + k] = sg;
      }
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 2));
    this.baseHalf = width / 2;
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.path = path;
    this.mat.uniforms.uLen.value = path.length;
    this.mat.uniforms.uLegBreak.value = path.legBreak ?? -1;
    this.reveal = instant ? 1 : 0;
    this.revealDur = clamp(path.length / 450, 1.3, 2.6);
    this.mat.uniforms.uReveal.value = instant ? 1 : 0;
    this.headSprite.visible = !instant;
  }

  hide() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.headSprite.visible = false;
    this.path = null;
  }

  setOpacity(o) { this.mat.uniforms.uOpacity.value = o; }

  /** camDist: distance from camera to its orbit target (≈ zoom level); pov: 0..1 street-level blend. */
  update(dt, camDist = 0, pov = 0) {
    const zoomW = clamp(camDist / 260, 1, 7);
    this.mat.uniforms.uHalfWidth.value = (this.baseHalf || 1) * (zoomW + (0.6 - zoomW) * pov);
    this.mat.uniforms.uTime.value = U.uTime.value;
    this.mat.uniforms.uNight.value = U.uNight.value;
    if (!this.mesh) return;
    if (this.reveal < 1) {
      this.reveal = Math.min(1, this.reveal + dt / this.revealDur);
      const e = easeInOutCubic(this.reveal);
      this.mat.uniforms.uReveal.value = e;
      const p = this.path;
      const s = e * p.length;
      const i = Math.min(p.x.length - 1, Math.floor(s));
      this.headSprite.position.set(p.x[i], 1.2, p.z[i]);
      if (this.reveal >= 1) this.headSprite.visible = false;
    }
  }
}
