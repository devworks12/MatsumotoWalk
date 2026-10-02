import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Stage } from './scene.js';
import { City } from './city.js';
import { Props } from './props.js';
import { StreetLife } from './streetlife.js';
import { Traffic } from './traffic.js';
import { ShopLayer } from './restaurants.js';
import { RoadGraph } from './routing.js';
import { buildRoutePath } from './pathgeo.js';
import { RouteLine } from './routeLine.js';
import { CameraDirector, defaultView } from './cameraTour.js';
import { UI } from './ui.js';
import { Ambience } from './audio.js';
import { Precipitation } from './weather.js';
import { TIME_PRESETS, TIME_ORDER } from './atmosphere.js';
import { renderFallback } from './fallback2d.js';
import { U } from './materials.js';
import { CATEGORIES, FILTERS, WORLD } from './config.js';
import { clamp, damp, formatMinutes, openStatus, prefersReducedMotion, store, tokyoNow } from './util.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

class App {
  constructor() {
    this.state = { filter: 'all', selected: null, mode: 'walk', variant: 'fastest', routes: null, path: null, query: '' };
    this.settings = {
      quality: store.get('quality', 'auto'),
      labels: store.get('labels', 'auto'),
      motion: store.get('motion', 'system'),
      sound: 'off',
      time: store.get('time', 'auto'),
      weather: store.get('weather', 'clear'),
    };
    this.dimTarget = 0;
    this.glowTarget = 0;
    this.focusAmt = 0;
    this.running = false;
    this.timeScale = 1; // debugging aid: window.__mfw.timeScale = 4
  }

  get reduced() {
    return this.settings.motion === 'reduce' || (this.settings.motion === 'system' && prefersReducedMotion());
  }

  async start() {
    this.ui = new UI(this._handlers());
    for (const k of ['quality', 'labels', 'motion', 'sound', 'time', 'weather']) this.ui.setSetting(k, this.settings[k]);
    this.ui.setLoading(0.04, 'Fetching the map…');

    const data = await this._load();
    this.data = data;
    this.restaurants = data.restaurants.restaurants;
    this.graph = new RoadGraph(data.roads, this.restaurants);

    const canvas = document.getElementById('scene');
    const gl2 = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
    if (!gl2) {
      renderFallback(document.getElementById('fallback'), { roads: data.roads, restaurants: this.restaurants, graph: this.graph },
        'お使いのブラウザでは WebGL2 が利用できないため、3D表示を行えません。');
      return;
    }

    this.stage = new Stage(canvas, { quality: this.settings.quality });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ui.toast('グラフィックスを再初期化しています…', 4000); });
    canvas.addEventListener('webglcontextrestored', () => location.reload());

    this.controls = this._controls(canvas);
    this.city = new City(this.stage, { roads: data.roads, buildings: data.buildings, restaurants: this.restaurants });
    const steps = [
      ...this.city.steps(),
      ['Planting trees…', () => { this.props = new Props(this.city, this.restaurants); this.props.build(); }],
      ['Hanging noren…', () => { this.street = new StreetLife(this.city, this.restaurants); this.street.build(); }],
      ['Waking up the streets…', () => { this.traffic = new Traffic(this.city); this.traffic.build(); }],
      ['Lighting the restaurants…', () => {
        this.shops = new ShopLayer(this.stage, this.restaurants, document.getElementById('labels'));
        this.shops.setLabelMode(this.settings.labels);
        this.routeLine = new RouteLine(this.stage.scene);
      }],
    ];
    for (let i = 0; i < steps.length; i++) {
      this.ui.setLoading(0.12 + (0.78 * i) / steps.length, steps[i][0]);
      await nextFrame();
      steps[i][1]();
    }
    this.director = new CameraDirector(this.stage, this.controls);
    this.ambience = new Ambience();

    // Time of day (AUTO follows the clock in Matsumoto) and weather
    this.precip = new Precipitation(this.stage.scene);
    this.stage.atmo.set(this.settings.time, this.settings.weather);
    this.stage.atmo.snap();
    this.precip.setWeather(this.settings.weather);
    this._syncTimeIcon();

    this.ui.renderFilters('all', this._counts());
    this._applyView(defaultView(this.stage));

    this.ui.setLoading(0.94, 'Compiling shaders…');
    await nextFrame();
    try { this.stage.renderer.compile(this.stage.scene, this.stage.camera); } catch { /* optional */ }
    this.stage.render();
    this.ui.setLoading(1, 'Welcome to Matsumoto');
    this._input(canvas);
    this._lifecycle();
    this.clock = performance.now();
    this.running = true;
    this.stage.renderer.setAnimationLoop((t) => this._frame(t));
    await nextFrame();
    this.ui.finishLoading();
    this._opening();
  }

  async _load() {
    const files = ['data/roads.json', 'data/buildings.json', 'data/restaurants.json'];
    let done = 0;
    const out = await Promise.all(files.map(async (f) => {
      const res = await fetch(f);
      if (!res.ok) throw new Error(`${f}: ${res.status}`);
      const json = await res.json();
      done++;
      this.ui.setLoading(0.04 + 0.08 * (done / files.length), 'Reading the streets…');
      return json;
    }));
    return { roads: out[0], buildings: out[1], restaurants: out[2] };
  }

  _controls(canvas) {
    const c = new OrbitControls(this.stage.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.075;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.9;
    c.minDistance = 28;
    c.maxDistance = 2600;
    c.minPolarAngle = 0.1;
    c.maxPolarAngle = 1.36;
    c.screenSpacePanning = false;
    c.zoomToCursor = true;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    const B = WORLD.bounds;
    c.addEventListener('change', () => {
      c.target.x = clamp(c.target.x, B.minX, B.maxX);
      c.target.z = clamp(c.target.z, B.minZ, B.maxZ);
      c.target.y = 0;
    });
    c.addEventListener('start', () => { if (this.introRunning) this._endIntro(true); });
    return c;
  }

  _applyView(v) {
    const t = v.target;
    this.camera.position.set(t.x + v.r * Math.sin(v.phi) * Math.sin(v.theta), v.r * Math.cos(v.phi), t.z + v.r * Math.sin(v.phi) * Math.cos(v.theta));
    this.controls.target.copy(t);
    this.camera.lookAt(t);
    this.controls.update();
  }

  get camera() { return this.stage.camera; }

  // ---------------------------------------------------------------- opening
  _opening() {
    const deep = decodeURIComponent(location.hash.replace(/^#/, ''));
    const deepShop = this.restaurants.find((r) => r.id === deep);
    if (!store.get('seenIntro', false) && !this.reduced && !deepShop) {
      this._playIntro();
    } else {
      const v = { ...defaultView(this.stage), r: defaultView(this.stage).r * 1.35, phi: 1.05 };
      this._applyView(v);
      this.director.flyTo(defaultView(this.stage), this.reduced ? 0.01 : 1.6).then(() => {
        if (deepShop) this.selectShop(deepShop.id);
      });
    }
  }

  _playIntro() {
    this.introRunning = true;
    this.ui.showIntro();
    this.director.playOpening(4.2).then(() => this._endIntro(false));
  }

  _endIntro(skip) {
    if (!this.introRunning) return;
    this.introRunning = false;
    if (skip) this.director.skip();
    this.ui.hideIntro();
    store.set('seenIntro', true);
  }

  // ---------------------------------------------------------------- input
  _input(canvas) {
    let down = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.introRunning) { this._endIntro(true); return; }
      if (down && down.id !== e.pointerId) { down.multi = true; return; }
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, multi: false };
    });
    const up = (e) => {
      if (!down || down.id !== e.pointerId) return;
      const d = down;
      down = null;
      if (d.multi || e.type === 'pointercancel') return;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (moved > 8) return; // a drag, not a tap (no time limit: slow frames must not eat taps)
      if (this.director.inTour) return;
      const rect = canvas.getBoundingClientRect();
      const hit = this.shops.pick(e.clientX - rect.left, e.clientY - rect.top, e.pointerType === 'touch' ? 42 : 28);
      if (hit) this.selectShop(hit.id);
      else if (this.ui.searchOpen && !this.state.query) this.ui.toggleSearch(false);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons || this.director?.inTour) return;
      const rect = canvas.getBoundingClientRect();
      const hit = this.shops.pick(e.clientX - rect.left, e.clientY - rect.top, 22);
      this.shops.setHover(hit?.id);
      canvas.classList.toggle('hovering', !!hit);
    });
    canvas.addEventListener('pointerleave', () => { this.shops.setHover(null); canvas.classList.remove('hovering'); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard orbit when the map has focus
    canvas.addEventListener('keydown', (e) => {
      if (this.director.busy) return;
      const s = this.director._sph(this.camera.position, this.controls.target);
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') this.director.flyTo({ theta: s.theta + (k === 'ArrowLeft' ? -0.35 : 0.35) }, 0.35);
      else if (k === 'ArrowUp' || k === 'ArrowDown') this.director.flyTo({ phi: clamp(s.phi + (k === 'ArrowUp' ? -0.12 : 0.12), 0.15, 1.3) }, 0.35);
      else if (k === '+' || k === '=') this.director.flyTo({ r: s.r * 0.75 }, 0.35);
      else if (k === '-') this.director.flyTo({ r: s.r * 1.3 }, 0.35);
      else return;
      e.preventDefault();
    });
  }

  _lifecycle() {
    // #app is overflow:hidden; focus / scrollIntoView inside panels must never shift the whole layout
    const app = document.getElementById('app');
    app.addEventListener('scroll', () => { app.scrollTop = 0; app.scrollLeft = 0; });
    const resize = () => this.stage.resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.stage.renderer.setAnimationLoop(null); this.running = false; }
      else if (!this.running) { this.clock = performance.now(); this.running = true; this.stage.renderer.setAnimationLoop((t) => this._frame(t)); }
    });
  }

  // ---------------------------------------------------------------- frame
  _frame(now) {
    const dt = clamp((now - this.clock) / 1000, 0, 0.05) * this.timeScale;
    this.clock = now;
    this.director.update(dt);
    // Title fades out with the camera move itself (frame-synced, not wall-clock)
    if (this.introRunning && this.director.anim && this.director.anim.t / this.director.anim.dur > 0.74) this.ui.hideIntro();
    if (this.director.mode === 'orbit') {
      this.controls.update();
      this.stage.setNearForDistance(this.camera.position.distanceTo(this.controls.target));
    }
    U.uDim.value = damp(U.uDim.value, this.director.inTour ? Math.min(this.dimTarget, 0.18) : this.dimTarget, 3, dt);
    U.uStationGlow.value = damp(U.uStationGlow.value, this.glowTarget, 2.5, dt);
    U.uPov.value = damp(U.uPov.value, this.director.inTour && this.director.mode !== 'tour-intro' ? 1 : 0, 4, dt);
    this.stage.bloomScale = 1 - 0.4 * U.uPov.value;
    this.stage.applyFov(U.uPov.value);
    this.focusAmt = damp(this.focusAmt, this.state.selected ? 1 : 0, 3, dt);
    U.uFocus.value.y = this.focusAmt;
    const camDist = this.director.inTour ? Math.max(10, this.camera.position.y * 1.5) : this.camera.position.distanceTo(this.controls.target);
    this.camDist = camDist;
    this.city.update(dt, this.camera, camDist);
    this.props.updateSignals(dt);
    this.street.update(camDist, U.uPov.value);
    this.precip.update(dt, this.camera, camDist, this.stage.height * this.stage.dpr);
    if (this.settings.time === 'auto' && (this._iconT = (this._iconT || 0) - dt) < 0) { this._iconT = 30; this._syncTimeIcon(); }
    this.traffic.update(dt);
    this.shops.update(dt, this.camera, { pov: this.director.inTour, dimShaft: this.director.inTour });
    this.routeLine.update(dt, camDist, U.uPov.value);
    this.stage.update(dt, now);
    this.stage.render();
  }

  // ---------------------------------------------------------------- selection & routes
  selectShop(id, { from } = {}) {
    const r = this.restaurants.find((x) => x.id === id);
    if (!r) return;
    if (this.director.inTour) this._leaveTour(false);
    if (from === 'explore') this.ui.hideExplore();
    if (from === 'search') this.ui.toggleSearch(false);
    const routes = this.graph.routesFor(id);
    this.state.selected = id;
    this.state.routes = routes;
    this.state.mode = routes.best.mode;
    this.state.variant = routes.best.variant;
    this.shops.select(id);
    this.shops.setHighlight([]);
    const b = this.city.shopBuildings.get(id);
    if (b) U.uFocus.value.set(b.x, this.focusAmt, b.z);
    this.ui.renderSheet(r, routes, this.state);
    this.ui.openSheet('peek');
    try { history.replaceState(null, '', `#${id}`); } catch { /* file:// */ }
    this._showRoute(true);
  }

  _showRoute(fly) {
    const { routes, mode, variant, selected } = this.state;
    const r = this.restaurants.find((x) => x.id === selected);
    const route = routes[mode][variant] || routes[mode].fastest;
    const path = buildRoutePath(this.graph, route, r);
    this.state.path = path;
    this.state.route = route;
    this.routeLine.show(path, { instant: this.reduced });
    this.dimTarget = 1;
    this.glowTarget = 1;
    if (fly) this._overviewRoute();
  }

  _overviewRoute(dur = 1.7) {
    const p = this.state.path;
    if (!p) return Promise.resolve();
    const pts = [];
    for (let i = 0; i < p.x.length; i += 8) pts.push([p.x[i], p.z[i]]);
    pts.push([p.end.x, p.end.z], [WORLD.station.x, WORLD.station.z]);
    return this.director.flyTo(this.director.viewFor(pts, { minR: 160, phi: 0.82, panel: this._panelInset() }), this.reduced ? 0.3 : dur);
  }

  _setTime(mode) {
    this.settings.time = mode;
    store.set('time', mode);
    this.ui.setSetting('time', mode);
    this.stage.atmo.set(mode);
    this.ambience?.setNight(this.stage.isNight);
    this._syncTimeIcon();
  }

  _setWeather(w) {
    this.settings.weather = w;
    store.set('weather', w);
    this.ui.setSetting('weather', w);
    this.stage.atmo.set(null, w);
    this.precip.setWeather(w);
    this.ambience?.setWeather(w);
    this._syncTimeIcon();
  }

  _syncTimeIcon() {
    this.ui.setTimeIcon(this.stage.atmo.phase, this.settings.time === 'auto', this.settings.weather);
  }

  /** Screen pixels covered by the side panel (desktop / landscape), so routes are framed in the free area. */
  _panelInset() {
    if (!this.state.selected) return 0;
    const w = window.innerWidth;
    // mirrors the layouts in styles/main.css (the panel may still be sliding in, so don't measure it)
    if (matchMedia('(min-width: 900px) and (min-height: 560px)').matches) return 392 + 16 + 8;
    if (matchMedia('(orientation: landscape) and (max-height: 559px)').matches) return Math.min(360, w * 0.46) + 16;
    return 0;
  }

  deselect() {
    if (this.director.inTour) this._leaveTour(false);
    this.state.selected = null;
    this.state.path = null;
    this.shops.select(null);
    this.routeLine.hide();
    this.dimTarget = this.state.query ? 0.35 : 0;
    this.glowTarget = 0;
    this.ui.closeSheet();
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  }

  setMode(mode) {
    if (!this.state.selected) return;
    if (this.director.inTour) this._leaveTour(false);
    this.state.mode = mode;
    const best = this.state.routes.best;
    this.state.variant = best.mode === mode ? best.variant : 'fastest';
    this._rerender();
    this._showRoute(false);
    this._overviewRoute(1.1);
  }

  setVariant(v) {
    if (!this.state.selected) return;
    if (this.director.inTour) this._leaveTour(false);
    this.state.variant = v;
    this._rerender();
    this._showRoute(false);
  }

  _rerender() {
    const r = this.restaurants.find((x) => x.id === this.state.selected);
    const scroll = document.getElementById('sheet-body').scrollTop;
    this.ui.renderSheet(r, this.state.routes, this.state);
    document.getElementById('sheet-body').scrollTop = scroll;
  }

  // ---------------------------------------------------------------- tour
  preview() {
    const { path, selected } = this.state;
    if (!path) return;
    const r = this.restaurants.find((x) => x.id === selected);
    if (this.director.inTour) this.director.stopTour();
    this.routeLine.show(path, { instant: true });
    this.ui.enterTour(r, path.mode);
    this.ui.closeSheet();
    const focus = new THREE.Vector3(r.position.x, 5, r.position.z);
    const arrival = this._arrivalPose(r, path);
    if (arrival) focus.copy(arrival.look);
    const go = () => this.director.startTour(path, {
      reduced: this.reduced,
      focus,
      arrival,
      onProgress: (p, rem) => this.ui.updateTour(p, rem),
      onArrive: () => this._arrived(r),
    });
    if (this.reduced) {
      this.ui.fade(true);
      setTimeout(() => { go(); this.ui.fade(false); }, 320);
    } else go();
  }

  /** Where to stand on arrival: across the street from the shop front, slightly back along the approach. */
  _arrivalPose(r, path) {
    const b = this.city.shopBuildings.get(r.id);
    if (!b) return null;
    let nx = r.position.x - b.x, nz = r.position.z - b.z;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    let tx = -nz, tz = nx;
    const n = path.x.length;
    const ax = path.x[n - 1] - path.x[Math.max(0, n - 12)], az = path.z[n - 1] - path.z[Math.max(0, n - 12)];
    if (tx * ax + tz * az > 0) { tx = -tx; tz = -tz; } // stay on the side we came from
    const back = path.mode === 'car' ? 5.5 : 4.5;
    const look = new THREE.Vector3(b.x + nx * (b.d / 2) - tx * 1.0, Math.min(3.0, b.h * 0.36 + 0.4), b.z + nz * (b.d / 2) - tz * 1.0);
    // oblique view: a few metres into the street and back along it, so facade, beacon and street all read.
    // Try a few stand-off distances and keep the first one with a clear line of sight.
    const items = this.data.buildings.items;
    const near = items.filter((it) => Math.abs(it[0] - b.x) < 60 && Math.abs(it[1] - b.z) < 60 && !(it[0] === b.x && it[1] === b.z));
    const inside = (px, pz, it, m) => {
      const a = (it[5] * Math.PI) / 180, c = Math.cos(a), s2 = Math.sin(a);
      const dx = px - it[0], dz = pz - it[1];
      return Math.abs(dx * c + dz * s2) < it[2] / 2 + m && Math.abs(-dx * s2 + dz * c) < it[3] / 2 + m;
    };
    const clear = (px, pz) => {
      if (near.some((it) => inside(px, pz, it, 0.8))) return false;
      for (let k = 1; k < 18; k++) {
        const t = k / 20, sx = px + (look.x - px) * t, sz = pz + (look.z - pz) * t;
        if (near.some((it) => inside(sx, sz, it, 0.1))) return false;
      }
      return true;
    };
    let pos = null;
    for (const along of [12, 9, 6, -9, -12, 3]) {
      const px = r.position.x + nx * back + tx * along, pz = r.position.z + nz * back + tz * along;
      if (clear(px, pz)) { pos = new THREE.Vector3(px, path.mode === 'car' ? 1.4 : 1.7, pz); break; }
    }
    if (!pos) pos = new THREE.Vector3(r.position.x + nx * back, 1.7, r.position.z + nz * back);
    return { pos, look };
  }

  _arrived(r) {
    this.ui.showArrival(r, this.state.route);
    setTimeout(() => {
      if (!this.director.inTour) return;
      this._rerender();
      this.ui.openSheet('peek');
    }, 1300);
  }

  _leaveTour(fly = true) {
    this.director.stopTour();
    this.ui.exitTour();
    this.controls.enabled = true;
    if (this.state.selected) {
      this._rerender();
      this.ui.openSheet(this.ui.sheetState === 'full' ? 'full' : 'peek');
    }
    if (fly) this._overviewRoute(1.6);
    else {
      // jump the orbit camera to a sane spot immediately
      this.controls.update();
    }
  }

  // ---------------------------------------------------------------- filters, search, explore
  _counts() {
    const c = {};
    for (const f of FILTERS) c[f.id] = this.restaurants.filter(f.match).length;
    return c;
  }

  setFilter(id) {
    const f = FILTERS.find((x) => x.id === id);
    this.state.filter = id;
    this.shops.setFilter(f.match);
    this.ui.setActiveFilter(id);
    const list = this.restaurants.filter(f.match);
    if (!this.state.selected && list.length && id !== 'all') {
      this.director.flyTo(this.director.viewFor(list.map((r) => [r.position.x, r.position.z]), { minR: 240, phi: 0.86 }), this.reduced ? 0.3 : 1.3);
    }
    this.ui.toast(`${f.ja} · ${list.length}件`, 1400);
  }

  search(q) {
    this.state.query = q.trim();
    const norm = toHira(this.state.query.toLowerCase());
    if (!norm) {
      this.shops.setHighlight([]);
      this.ui.renderSearchResults('', []);
      if (!this.state.selected) this.dimTarget = 0;
      return;
    }
    const scored = [];
    for (const r of this.restaurants) {
      const cat = CATEGORIES[r.category];
      let s = 0;
      if (toHira(r.name.toLowerCase()).includes(norm)) s += 5;
      if (cat.aliases.some((a) => { const h = toHira(a.toLowerCase()); return h.includes(norm) || norm.includes(h); }) || toHira(cat.label).includes(norm)) s += 3;
      if (r.menu.some((m) => toHira(m).includes(norm))) s += 2;
      if (r.tags.some((t) => toHira(t).includes(norm)) || toHira(r.street || '').includes(norm)) s += 1.5;
      if (toHira(r.description).includes(norm)) s += 0.5;
      if (s > 0) scored.push({ r, s });
    }
    const walk = (id) => this.graph.routesFor(id).walk.fastest.time;
    scored.sort((a, b) => b.s - a.s || walk(a.r.id) - walk(b.r.id));
    const results = scored.map((x) => x.r);
    this.ui.renderSearchResults(this.state.query, results, walk);
    this.shops.setHighlight(results.map((r) => r.id));
    if (!this.state.selected) this.dimTarget = results.length ? 0.35 : 0;
    clearTimeout(this._searchFly);
    if (results.length && !this.state.selected) {
      this._searchFly = setTimeout(() => {
        this.director.flyTo(this.director.viewFor(results.map((r) => [r.position.x, r.position.z]), { minR: 220, phi: 0.84 }), this.reduced ? 0.3 : 1.2);
      }, 380);
    }
  }

  explore() {
    const now = tokyoNow();
    const hour = now.minutes / 60;
    const walk = (r) => this.graph.routesFor(r.id).walk;
    const isOpen = (r) => openStatus(r, now).open;
    const opened = this.restaurants.filter(isOpen);
    const pool = opened.length >= 5 ? opened : this.restaurants;
    const day = new Date().toISOString().slice(0, 10);
    let seed = [...day].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const used = new Set();
    const take = (list) => { const l = list.filter((r) => !used.has(r.id)); if (!l.length) return null; const r = l[Math.floor(rand() * Math.min(l.length, 4))]; used.add(r.id); return r; };
    const byWalk = (list) => [...list].sort((a, b) => walk(a).fastest.time - walk(b).fastest.time);
    const cards = [];
    const add = (ctx, r, why) => r && cards.push({ ctx, r, why, walk: walk(r).fastest.time, status: openStatus(r, now).label });

    const local = take(byWalk(pool.filter((r) => r.category === 'soba' || r.category === 'sanzoku')));
    add('LOCAL PICK', local, local?.category === 'soba' ? '松本に来たらまず信州そば。香りの立つ一枚を。' : '松本名物の山賊焼。にんにく醤油の鶏もも一枚揚げ。');
    const near = byWalk(pool).find((r) => !used.has(r.id));
    if (near) { used.add(near.id); add('NEARBY', near, `駅から最も近い${isOpen(near) ? '営業中の' : ''}お店。歩いて${formatMinutes(walk(near).fastest.time)}分。`); }
    const late = hour >= 21 || hour < 5;
    if (late) {
      const lateOpen = (r) => (r.hours || []).some(([, b]) => b === '24:00' || b === '00:00' || Number(b.split(':')[0]) >= 23);
      const night = take(byWalk(this.restaurants.filter((r) => lateOpen(r) && !used.has(r.id))));
      add('LATE NIGHT', night, night ? `${night.hours.at(-1)[1]}まで営業。${night.menu[0]}でシメの一杯を。` : '');
      const morning = take(byWalk(this.restaurants.filter((r) => r.tags.includes('朝から営業'))));
      add('MORNING', morning, morning ? `朝${morning.hours[0][0]}から。${morning.menu[0]}で一日をはじめる。` : '');
    } else if (hour < 17.5) {
      const cafe = take(byWalk(pool.filter((r) => r.category === 'cafe' || r.category === 'sweets' || r.category === 'bakery')));
      add('CAFE', cafe, cafe ? `${cafe.tags.slice(0, 2).join('・')}。街歩きの合間にひと休み。` : '');
    } else {
      const bar = take(byWalk(pool.filter((r) => r.category === 'izakaya')));
      add('ONE MORE', bar, bar ? `地酒で締めくくる夜。${bar.tags.slice(0, 2).join('・')}。` : '');
    }
    const meal = late ? null : hour < 15
      ? take(pool.filter((r) => ['ramen', 'soba', 'yoshoku', 'washoku'].includes(r.category)))
      : take(pool.filter((r) => ['izakaya', 'yakiniku', 'washoku', 'yoshoku', 'sanzoku'].includes(r.category)));
    if (meal) add(hour < 15 ? 'LUNCH' : 'DINNER', meal, `${meal.menu[0]}が看板。${meal.priceText}。`);
    const scenic = [...pool].filter((r) => !used.has(r.id) && walk(r).scenic && walk(r).scenic.time < 17 * 60)
      .sort((a, b) => walk(b).scenic.scenic - walk(a).scenic.scenic)[0];
    if (scenic) {
      used.add(scenic.id);
      const nice = walk(scenic).scenic.streets.filter((s) => /中町|縄手|川|小径|大名町/.test(s));
      add('SCENIC WALK', scenic, `${nice.slice(0, 2).join('・') || '街並み'}を歩いて${formatMinutes(walk(scenic).scenic.time)}分。道のりも楽しみのひとつ。`);
    }
    const label = `${['日', '月', '火', '水', '木', '金', '土'][now.day]}曜 ${Math.floor(hour)}:${String(now.minutes % 60).padStart(2, '0')} · ${opened.length >= 5 ? 'いま開いているお店から' : '営業時間外のため全店から'}`;
    this.ui.showExplore(label, cards);
    this.shops.setHighlight(cards.map((c) => c.r.id));
    if (!this.state.selected) {
      this.dimTarget = 0.35;
      this.director.flyTo(this.director.viewFor(cards.map((c) => [c.r.position.x, c.r.position.z]).concat([[WORLD.station.x, WORLD.station.z]]), { minR: 260, phi: 0.86 }), this.reduced ? 0.3 : 1.4);
    }
  }

  // ---------------------------------------------------------------- handlers
  _handlers() {
    return {
      onFilter: (id) => this.setFilter(id),
      onSearch: (q) => this.search(q),
      onSelectShop: (id, o) => this.selectShop(id, o),
      onCloseSheet: () => this.deselect(),
      onMode: (m) => this.setMode(m),
      onVariant: (v) => this.setVariant(v),
      onPreview: () => this.preview(),
      onOverview: () => {
        if (this.director.inTour) this._leaveTour(true);
        else this._overviewRoute(1.2);
        if (this.ui.sheetState === 'full') this.ui.setSheetState('peek');
      },
      onExitTour: () => this._leaveTour(true),
      onSkipTour: () => {
        const T = this.director.tour;
        if (!T) return;
        if (this.director.mode === 'tour-intro') { this.director.mode = 'tour'; T.time = T.prof.T; }
        else if (this.director.mode === 'tour') T.time = T.prof.T;
      },
      onExplore: () => this.explore(),
      onExploreClosed: () => {
        this.shops.setHighlight([]);
        if (!this.state.selected) this.dimTarget = 0;
      },
      onDayNight: () => {
        // cycle the presets, starting from whatever is on screen now
        const cur = this.stage.atmo.phase;
        const next = TIME_ORDER[(TIME_ORDER.indexOf(cur) + 1) % TIME_ORDER.length];
        this._setTime(next);
        this.ui.toast(`${TIME_PRESETS[next].ja} · ${TIME_PRESETS[next].label}`, 1400);
      },
      onSetting: (k, v) => {
        this.settings[k] = v;
        if (k !== 'sound') store.set(k, v);
        if (k === 'quality') this.stage?.setQuality(v);
        if (k === 'labels') this.shops?.setLabelMode(v);
        if (k === 'sound') { this.ambience?.setEnabled(v === 'on'); this.ambience?.setNight(this.stage?.isNight); this.ambience?.setWeather(this.settings.weather); }
        if (k === 'time') this._setTime(v);
        if (k === 'weather') this._setWeather(v);
      },
      onResetView: () => {
        if (this.director?.inTour) this._leaveTour(false);
        this.deselect();
        this.director?.flyTo(defaultView(this.stage), this.reduced ? 0.3 : 1.5);
      },
      onHome: () => {
        if (this.state.selected) this._overviewRoute(1.3);
        else this.director.flyTo(defaultView(this.stage), this.reduced ? 0.3 : 1.4);
      },
      onReplayIntro: () => {
        if (this.director.inTour) this._leaveTour(false);
        this.deselect();
        this._playIntro();
      },
      onSkipIntro: () => this._endIntro(true),
      onEscape: () => {
        if (this.introRunning) return this._endIntro(true);
        if (this.director.inTour) return this._leaveTour(true);
        if (!document.getElementById('settings').hidden) return this.ui.toggleSettings(false);
        if (this.ui.searchOpen) return this.ui.toggleSearch(false);
        if (this.ui.exploreOpen) return this.ui.hideExplore();
        if (this.state.selected) return this.deselect();
      },
    };
  }
}

/** カタカナ → ひらがな for forgiving search. */
function toHira(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const app = new App();
window.__mfw = app; // handy for debugging in the console
app.start().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading-status');
  if (el) el.textContent = '読み込みに失敗しました。ページを再読み込みしてください。';
  const fb = document.getElementById('fallback');
  if (fb && app.graph && app.data) {
    renderFallback(fb, { roads: app.data.roads, restaurants: app.restaurants, graph: app.graph }, `3D表示の初期化中にエラーが発生しました（${err.message}）。`);
  }
});
