import * as THREE from 'three';
import { buildIconAtlas } from './icons.js';
import { CATEGORIES } from './config.js';
import { radialTexture, U } from './materials.js';
import { clamp, damp, escapeHtml } from './util.js';

const AMBER = new THREE.Color(1.0, 0.62, 0.26);
const GOLD = new THREE.Color(1.0, 0.82, 0.48);
const v = new THREE.Vector3();

/**
 * Restaurant beacons: a floating ring around a category glyph, a hairline stem to the street,
 * and — when selected — a slowly turning ring, a light shaft and a pulse on the ground.
 * Labels are DOM elements, shown only for nearby / selected / highlighted shops.
 */
export class ShopLayer {
  constructor(stage, restaurants, labelRoot) {
    this.stage = stage;
    this.scene = stage.scene;
    this.list = restaurants;
    this.labelRoot = labelRoot;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.items = [];
    this.selected = null;
    this.hovered = null;
    this.highlight = new Set();
    this.filter = () => true;
    this.labelMode = 'auto';
    this._build();
  }

  _build() {
    const atlas = buildIconAtlas();
    const baseTex = new THREE.CanvasTexture(atlas.canvas);
    baseTex.colorSpace = THREE.SRGBColorSpace;
    baseTex.anisotropy = 4;
    const ringGeo = new THREE.TorusGeometry(1.55, 0.085, 6, 48);
    const stemGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 4).translate(0, 0.5, 0);
    const dotGeo = new THREE.CircleGeometry(0.8, 24).rotateX(-Math.PI / 2);
    const glowTex = radialTexture(64, 'rgba(255,190,110,1)', 'rgba(255,160,80,0)');
    const texCache = new Map();
    const texFor = (cat) => {
      if (texCache.has(cat)) return texCache.get(cat);
      const t = baseTex.clone();
      t.needsUpdate = true;
      const i = atlas.index(cat);
      t.repeat.set(1 / atlas.cols, 1 / atlas.rows);
      t.offset.set((i % atlas.cols) / atlas.cols, 1 - (Math.floor(i / atlas.cols) + 1) / atlas.rows);
      texCache.set(cat, t);
      return t;
    };

    for (const r of this.list) {
      const g = new THREE.Group();
      g.position.set(r.position.x, 0, r.position.z);
      const ringMat = new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(1.6), transparent: true, opacity: 1, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFor(r.category), transparent: true, depthWrite: false, opacity: 1 }));
      icon.scale.set(2.5, 2.5, 1);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.0 }));
      halo.scale.set(7, 7, 1);
      const stemMat = new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.45, depthWrite: false });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      const dotMat = new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(1.3), transparent: true, opacity: 0.7, depthWrite: false });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.y = 0.24;
      ring.renderOrder = icon.renderOrder = 5;
      halo.renderOrder = 4;
      g.add(stem, dot, halo, ring, icon);
      this.group.add(g);

      const label = document.createElement('div');
      label.className = 'shop-label';
      label.innerHTML = `<span class="sl-cat">${CATEGORIES[r.category]?.en ?? ''}</span><span class="sl-name">${escapeHtml(r.name)}</span>`;
      this.labelRoot.appendChild(label);

      this.items.push({
        r, g, ring, icon, halo, stem, dot, ringMat, stemMat, dotMat, label,
        phase: Math.random() * Math.PI * 2,
        vis: 1, scale: 1, y: 7, labelOn: false, screen: { x: 0, y: 0, ok: false },
      });
    }
    this.byId = new Map(this.items.map((it) => [it.r.id, it]));

    // Shared selection effects
    const shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(1.0, 0.66, 0.3) }, uTime: U.uTime, uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying vec2 vUv;
        void main(){ float a = pow(1.0 - vUv.y, 1.6) * 0.55 + 0.05; a *= 0.75 + 0.25 * sin(vUv.y * 18.0 - uTime * 3.0);
        gl_FragColor = vec4(uColor * 1.4, a * uAlpha); }`,
    });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.6, 1, 32, 1, true).translate(0, 0.5, 0), shaftMat);
    this.shaft.visible = false;
    this.shaft.renderOrder = 3;
    const pulseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.65, 0.3).multiplyScalar(1.6), transparent: true, depthWrite: false, opacity: 0 });
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 64).rotateX(-Math.PI / 2), pulseMat);
    this.pulse.visible = false;
    this.pulse.position.y = 0.3;
    this.group.add(this.shaft, this.pulse);
    this.selAmt = 0;

    // Fixed landmark labels
    this.pois = [
      { x: 36, y: 30, z: 0, ja: '松本駅', en: 'MATSUMOTO STA.', cls: 'poi-station' },
      { x: 546, y: 48, z: -1093, ja: '松本城', en: 'MATSUMOTO CASTLE', cls: '' },
    ].map((p) => {
      const el = document.createElement('div');
      el.className = `poi-label ${p.cls}`;
      el.innerHTML = `<span class="poi-ja">${p.ja}</span><span class="poi-en">${p.en}</span>`;
      this.labelRoot.appendChild(el);
      return { ...p, el };
    });
  }

  setFilter(fn) { this.filter = fn; }
  setHighlight(ids) { this.highlight = new Set(ids); }
  setLabelMode(mode) { this.labelMode = mode; }

  select(id) {
    this.selected = id ? this.byId.get(id) : null;
    if (this.selected) {
      this.shaft.visible = this.pulse.visible = true;
      this.shaft.position.set(this.selected.r.position.x, 0, this.selected.r.position.z);
      this.pulse.position.set(this.selected.r.position.x, 0.3, this.selected.r.position.z);
      this.selAmt = 0;
    }
  }

  setHover(id) { this.hovered = id ? this.byId.get(id) : null; }

  /** Screen-space picking: nearest beacon within a finger-sized radius. */
  pick(clientX, clientY, radius = 34) {
    let best = null, bestD = radius * radius;
    for (const it of this.items) {
      if (!it.screen.ok || it.vis < 0.5) continue;
      const dx = it.screen.x - clientX, dy = it.screen.y - clientY;
      const d = dx * dx + dy * dy;
      // the stem below the ring is also tappable
      const dyStem = clientY - it.screen.y;
      const stemHit = dyStem > 0 && dyStem < it.screen.stem && Math.abs(dx) < 14;
      const dd = stemHit ? Math.min(d, 100) : d;
      if (dd < bestD || (best && dd === bestD && it.screen.depth < best.screen.depth)) { best = it; bestD = dd; }
    }
    return best ? best.r : null;
  }

  update(dt, camera, opts = {}) {
    const t = U.uTime.value;
    const cam = camera.position;
    const w = this.stage.width, h = this.stage.height;
    const pov = !!opts.pov;
    const candidates = [];
    for (const it of this.items) {
      const r = it.r;
      const active = this.filter(r);
      const isSel = this.selected === it;
      const isHi = this.highlight.has(r.id);
      const isHover = this.hovered === it;
      const dist = Math.hypot(cam.x - r.position.x, cam.y, cam.z - r.position.z);
      // Size grows with distance so beacons stay readable from the overview, but never huge
      let target = pov ? clamp(dist / 38, 0.42, 1.3) : clamp(dist / 110, 1, 8);
      if (isSel) target *= 1.25;
      else if (isHi) target *= 1.15;
      else if (!active) target *= 0.6;
      it.scale = damp(it.scale, target, 6, dt);
      const visTarget = isSel || isHi ? 1 : active ? (this.selected && !isSel ? 0.55 : 1) : 0.12;
      it.vis = damp(it.vis, visTarget, 6, dt);
      const s = it.scale;
      const y = (pov ? 3.6 : 5.2) + 1.7 * s + Math.sin(t * 1.4 + it.phase) * 0.25 * s;
      it.y = y;
      it.ring.position.y = it.icon.position.y = it.halo.position.y = y;
      it.ring.scale.setScalar(s);
      it.icon.scale.set(2.5 * s, 2.5 * s, 1);
      it.halo.scale.set(8 * s, 8 * s, 1);
      it.stem.scale.set(Math.sqrt(s), y - 1.5 * s, Math.sqrt(s));
      it.dot.scale.setScalar(Math.sqrt(s));
      if (isSel) {
        it.ring.rotation.set(0, t * 0.9, 0);
      } else {
        it.ring.rotation.set(0, Math.atan2(cam.x - r.position.x, cam.z - r.position.z), 0);
      }
      const col = isSel || isHi || isHover ? GOLD : AMBER;
      it.ringMat.color.copy(col).multiplyScalar(isSel ? 2.2 : 1.6);
      it.ringMat.opacity = it.vis;
      it.icon.material.opacity = Math.min(1, it.vis * 1.1);
      it.stemMat.opacity = 0.45 * it.vis;
      it.dotMat.opacity = 0.7 * it.vis;
      it.halo.material.opacity = (isSel ? 0.5 : isHi ? 0.32 : 0.1 + 0.12 * U.uNight.value) * it.vis * (pov ? 0.35 : 1);

      // project for labels & picking
      v.set(r.position.x, y, r.position.z).project(camera);
      const onScreen = v.z < 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2;
      it.screen.ok = onScreen;
      it.screen.x = (v.x * 0.5 + 0.5) * w;
      it.screen.y = (-v.y * 0.5 + 0.5) * h;
      it.screen.depth = dist;
      if (onScreen) {
        v.set(r.position.x, 0, r.position.z).project(camera);
        it.screen.stem = Math.max(0, (-v.y * 0.5 + 0.5) * h - it.screen.y);
      }
      const ringPx = onScreen ? (1.55 * s * h) / (dist * Math.tan((camera.fov * Math.PI) / 360) * 2) : 0;
      it.screen.ringPx = ringPx;
      if (onScreen && it.vis > 0.3) candidates.push({ it, dist, forced: isSel || isHi || isHover });
    }

    // Labels: selected / highlighted / hovered always; otherwise only a few nearest when zoomed in
    candidates.sort((a, b) => a.dist - b.dist);
    let free = this.labelMode === 'all' ? 60 : this.labelMode === 'off' ? 0 : 8;
    const near = pov ? 140 : 300;
    for (const it of this.items) it._want = false;
    for (const c of candidates) {
      if (c.forced) { c.it._want = true; continue; }
      if (free > 0 && (this.labelMode === 'all' || c.dist < near)) { c.it._want = true; free--; }
    }
    for (const it of this.items) {
      if (it._want !== it.labelOn) {
        it.labelOn = it._want;
        it.label.classList.toggle('show', it._want);
      }
      it.label.classList.toggle('sel', this.selected === it);
      if (it.labelOn) {
        const lift = Math.max(18, it.screen.ringPx + 10);
        it.label.style.transform = `translate3d(${it.screen.x.toFixed(1)}px, ${(it.screen.y - lift).toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
    }

    // POI labels
    for (const p of this.pois) {
      v.set(p.x, p.y, p.z).project(camera);
      const ok = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && !pov;
      p.el.classList.toggle('show', ok);
      if (ok) p.el.style.transform = `translate3d(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px, 0) translate(-50%, -100%)`;
    }

    // Selection FX
    if (this.selected) {
      this.selAmt = damp(this.selAmt, 1, 3, dt);
      const it = this.selected;
      this.shaft.scale.set(it.scale, it.y, it.scale);
      this.shaft.material.uniforms.uAlpha.value = this.selAmt * (opts.dimShaft ? 0.3 : 1);
      const k = (t * 0.6) % 1;
      this.pulse.scale.setScalar(1 + k * 9 * Math.sqrt(it.scale));
      this.pulse.material.opacity = (1 - k) * 0.8 * this.selAmt;
    } else if (this.shaft.visible) {
      this.selAmt = damp(this.selAmt, 0, 6, dt);
      this.shaft.material.uniforms.uAlpha.value = this.selAmt;
      this.pulse.material.opacity = 0;
      if (this.selAmt < 0.02) this.shaft.visible = this.pulse.visible = false;
    }
  }
}
