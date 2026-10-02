import * as THREE from 'three';

/** Uniforms shared by every custom material (one source of truth for time / night / focus). */
export const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },        // 0 = day, 1 = night
  uDim: { value: 0 },          // 0..1 — city darkening while a route is shown
  uFocus: { value: new THREE.Vector3(1e5, 0, 1e5) }, // xz = focused building centre, y = strength
  uStationGlow: { value: 0 },
  uFogColor: { value: new THREE.Color(0xd9d3c8) }, // edge haze colour (follows scene fog)
  uPov: { value: 0 },          // 1 while the camera is at street level
  // atmosphere (driven by src/atmosphere.js)
  uSkyTop: { value: new THREE.Color(0x80a0b8) },
  uSkyHor: { value: new THREE.Color(0xded6ca) },
  uSunDir: { value: new THREE.Vector3(-0.6, 0.5, 0.4).normalize() },
  uSunGlowCol: { value: new THREE.Color(0xffd9a0) },
  uSunGlow: { value: 0.3 },
  uStars: { value: 0 },
  uWet: { value: 0 },          // 0..1 rain-soaked surfaces
  uSnow: { value: 0 },         // 0..1 snow cover on up-facing surfaces
  uMountain: { value: new THREE.Color(0x66727e) }, // mountain body colour
};

// Weather on up-facing surfaces: wet (darker + glossy + faint warm sheen at night) and snow cover.
const WEATHER_VERT = `
#ifdef USE_INSTANCING
  // instances are rotation × non-uniform scale: inverse-transpose = M · S⁻²
  mat3 mfwIM = mat3(instanceMatrix);
  vec3 mfwS2 = vec3(dot(mfwIM[0], mfwIM[0]), dot(mfwIM[1], mfwIM[1]), dot(mfwIM[2], mfwIM[2]));
  vMfwN = normalize(mat3(modelMatrix) * (mfwIM * (objectNormal / mfwS2)));
#else
  vMfwN = normalize(mat3(modelMatrix) * objectNormal);
#endif`;
function weatherFrag(snowK, wetK) {
  return `
{
  float upF = smoothstep(0.45, 0.85, vMfwN.y);
  float nz = fract(sin(dot(floor(vMfwW * 1.7), vec2(12.9898, 78.233))) * 43758.5453);
  float wet = uWet * ${wetK.toFixed(2)} * upF;
  diffuseColor.rgb *= 1.0 - 0.38 * wet;
  roughnessFactor = mix(roughnessFactor, 0.2 + 0.25 * nz, wet);
  float sn = uSnow * ${snowK.toFixed(2)} * upF * (0.78 + 0.22 * nz);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.95), sn);
  roughnessFactor = mix(roughnessFactor, 0.85, sn);
  mfwWetSheen = wet;
}`;
}
export function patchWeather(sh, snowK = 1, wetK = 1) {
  sh.uniforms.uWet = U.uWet;
  sh.uniforms.uSnow = U.uSnow;
  sh.uniforms.uNightW = U.uNight;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vMfwN;')
    .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>' + WEATHER_VERT);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uWet; uniform float uSnow; uniform float uNightW; varying vec3 vMfwN; float mfwWetSheen = 0.0;')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>' + weatherFrag(snowK, wetK))
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mfwWetSheen * uNightW * vec3(0.5, 0.3, 0.16) * 0.05;');
}

// Radial "edge haze": the miniature city melts into the atmosphere instead of ending at a hard edge.
const EDGE_VERT = `
#ifdef USE_INSTANCING
  vec4 mfwWP = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
  vec4 mfwWP = modelMatrix * vec4(transformed, 1.0);
#endif
vMfwW = mfwWP.xz;`;
const EDGE_FRAG = `
{
  // the haze ellipse is centred so that Matsumoto Castle (north) stays inside the clear zone
  vec2 dq = (vMfwW - vec2(380.0, -330.0)) / vec2(1000.0, 1060.0);
  float edge = smoothstep(0.7, 1.04, length(dq));
  outgoingLight = mix(outgoingLight, uFogColor, edge);
}`;
export function patchEdge(sh) {
  sh.uniforms.uFogColor = U.uFogColor;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vMfwW;')
    .replace('#include <project_vertex>', '#include <project_vertex>' + EDGE_VERT);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uFogColor; varying vec2 vMfwW;')
    .replace('#include <opaque_fragment>', EDGE_FRAG + '\n#include <opaque_fragment>');
}

const nightListeners = new Set();
export function onNightChange(fn) { nightListeners.add(fn); fn(U.uNight.value); }
export function emitNight(v) { for (const fn of nightListeners) fn(v); }

/** Adds the global "dim" uniform (plus edge haze and weather) to any lit material. */
export function patchDim(material, strength = 0.6, { snow = 0.9, wet = 1 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    if (snow > 0 || wet > 0) patchWeather(sh, snow, wet);
    sh.uniforms.uDim = U.uDim;
    sh.fragmentShader = 'uniform float uDim;\n' + sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `outgoingLight *= 1.0 - uDim * ${strength.toFixed(2)};\n#include <opaque_fragment>`,
    );
    patchEdge(sh);
  };
  material.customProgramCacheKey = () => `dim${strength}s${snow}w${wet}`;
  return material;
}

const HASH = /* glsl */ `
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
`;

/**
 * Instanced building material. Unit box (0..1 in y) scaled per instance.
 * Instance attributes: aType (0 modern, 1 shop, 2 kura, 3 wood, 4 landmark), aSeed (0..1000)
 */
export function createBuildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uDim = U.uDim;
    sh.uniforms.uFocus = U.uFocus;
    sh.uniforms.uPov = U.uPov;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aType;
attribute float aSeed;
varying vec3 vLocal; varying vec3 vScale; varying vec3 vLN; varying float vType; varying float vSeed; varying vec2 vCenter;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vLocal = position; vLN = normal; vType = aType; vSeed = aSeed;
#ifdef USE_INSTANCING
  vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vCenter = instanceMatrix[3].xz;
#else
  vScale = vec3(1.0); vCenter = vec2(0.0);
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight; uniform float uDim; uniform vec3 uFocus; uniform float uPov;
varying vec3 vLocal; varying vec3 vScale; varying vec3 vLN; varying float vType; varying float vSeed; varying vec2 vCenter;
${HASH}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float wMask = 0.0;
vec3 wGlow = vec3(0.0);
float focus = (length(vCenter - uFocus.xz) < 0.6) ? uFocus.y : 0.0;
{
  float H = vScale.y;
  float y = vLocal.y * H;
  int type = int(vType + 0.5);
  float seed = vSeed;
  diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(0.0, 7.0, y)); // ground contact darkening
  vec3 warm = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.82, 0.6), h13(vec3(seed, 3.1, 7.7)));
  if (abs(vLN.y) > 0.5) {
    float ex = (0.5 - abs(vLocal.x)) * vScale.x;
    float ez = (0.5 - abs(vLocal.z)) * vScale.z;
    float rim = 1.0 - step(0.5, min(ex, ez));
    diffuseColor.rgb *= mix(0.82, 1.06, rim);
  } else {
    bool fx = abs(vLN.x) > 0.5;
    float faceW = fx ? vScale.z : vScale.x;
    float u = (fx ? vLocal.z : vLocal.x) * faceW + faceW * 0.5;
    float face = fx ? (vLN.x > 0.0 ? 1.0 : 2.0) : (vLN.z > 0.0 ? 3.0 : 4.0);
    float edge = min(u, faceW - u);
    float ground = 0.0;
    float lit = 0.0;
    float dC = length(vCenter - vec2(380.0, -200.0));
    float litRatio = mix(0.34, 0.12, smoothstep(500.0, 1300.0, dC));
    if (type == 2) {
      // 蔵造り: white plaster, namako (diagonal lattice) base, small shuttered windows
      if (y < 1.6) {
        // なまこ壁: dark square tiles set diagonally, raised white plaster joints (~25 cm grid)
        float a = fract((u + y) * 2.9), b = fract((u - y) * 2.9);
        float l = min(min(a, 1.0 - a), min(b, 1.0 - b));
        float nw = fwidth((u + y) * 2.9);
        float line = mix(1.0 - smoothstep(0.07, 0.13 + nw, l), 0.3, smoothstep(0.3, 0.7, nw));
        diffuseColor.rgb = mix(vec3(0.26, 0.27, 0.28), vec3(0.88, 0.86, 0.82), line);
      } else if (y < 1.85) {
        diffuseColor.rgb *= 0.45;
      }
      float cu = abs(u - faceW * 0.5);
      if (cu < 0.7 && y > H * 0.58 && y < H * 0.58 + 1.2) { wMask = 1.0; lit = step(h13(vec3(face, seed, 1.0)), 0.55); }
      if (cu < faceW * 0.3 && y > 0.2 && y < 2.4 && edge > 0.8) { ground = 1.0; }
    } else if (type == 3) {
      // 町家: dark timber slats, a fine 格子 (koshi) lattice over the lantern-lit ground floor
      float sq = u / 0.15, sw = fwidth(sq);
      float slat = mix(smoothstep(0.5 - sw, 0.5 + sw, fract(sq)), 0.5, smoothstep(0.25, 0.6, sw));
      diffuseColor.rgb *= 0.82 + 0.18 * slat;
      if (y > 0.3 && y < 2.4 && edge > 0.7) {
        // anti-aliased lattice: fades to its average brightness where it would shimmer
        float kq = u / 0.16, kw = fwidth(kq);
        float koshi = mix(smoothstep(0.42 - kw, 0.42 + kw, fract(kq)), 0.58, smoothstep(0.25, 0.6, kw));
        ground = koshi;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.12, 0.09), 1.0 - koshi);
      }
      float cu = fract(u / 2.4);
      if (y > 3.4 && y < 4.6 && cu > 0.2 && cu < 0.8 && edge > 0.7) { wMask = 1.0; lit = step(h13(vec3(floor(u / 2.4), face, seed)), 0.5); }
    } else {
      float bays = max(1.0, floor(faceW / 3.2 + 0.5));
      float bw = faceW / bays;
      float cu = fract(u / bw);
      float fl = 3.4;
      float curtain = (type == 4 || h13(vec3(seed, 9.0, 2.0)) > 0.84) ? 1.0 : 0.0;
      float cv = fract((y - 0.2) / fl);
      float x0 = mix(0.17, 0.05, curtain);
      float v0 = mix(0.3, 0.1, curtain);
      if (y > 4.0 && y < H - 1.1 && edge > 0.6) {
        wMask = step(x0, cu) * step(cu, 1.0 - x0) * step(v0, cv) * step(cv, 0.86);
        vec3 wid = vec3(floor(u / bw), floor((y - 0.2) / fl), face + seed);
        lit = step(h13(wid), litRatio);
      }
      // floor slab lines give every block a sense of scale
      float slab = 1.0 - step(0.06, fract((y - 0.2) / fl) * fl);
      if (y > 3.6 && y < H - 0.8) diffuseColor.rgb *= 1.0 - slab * 0.18;
      // ground floor: glass shopfront / rolling shutter / wall with a door, plus a fascia sign band
      float gv = type == 1 ? 0.1 : h13(vec3(seed, face, 11.0)); // restaurants always show a lit shopfront
      if (y > 0.3 && y < 3.0 && edge > 0.9) {
        if (gv < 0.62) {
          float mullion = step(0.06, fract(u / 2.2)) * step(0.05, fract((y - 0.3) / 2.7));
          ground = mullion;
          diffuseColor.rgb *= mix(0.35, 1.0, mullion);
        } else if (gv < 0.82) {
          float rq = y / 0.09, rw = fwidth(rq);
          float rib = 0.82 + 0.18 * mix(smoothstep(0.5 - rw, 0.5 + rw, fract(rq)), 0.5, smoothstep(0.25, 0.6, rw));
          diffuseColor.rgb = vec3(0.58, 0.59, 0.6) * rib;
        } else {
          float door = step(abs(u - faceW * 0.5), 0.6) * step(y, 2.3);
          ground = door;
        }
      }
      if (y > 3.0 && y < 3.75 && edge > 0.5 && gv < 0.9) {
        vec3 signs[4] = vec3[4](vec3(0.15, 0.16, 0.18), vec3(0.11, 0.15, 0.26), vec3(0.42, 0.14, 0.1), vec3(0.86, 0.83, 0.76));
        int si = int(floor(h13(vec3(seed, face, 13.0)) * 3.99));
        diffuseColor.rgb = signs[si];
        float letters = step(0.55, h13(vec3(floor(u / 0.55), face, seed))) * step(0.25, fract((y - 3.0) / 0.75)) * step(fract((y - 3.0) / 0.75), 0.75);
        float lb = step(1.2, edge);
        wGlow += letters * lb * mix(vec3(1.0, 0.9, 0.75), vec3(1.0, 0.7, 0.4), float(si == 3)) * 0.9 * uNight * mix(1.0, 0.6, uPov);
        diffuseColor.rgb = mix(diffuseColor.rgb, si == 3 ? vec3(0.2) : vec3(0.9, 0.88, 0.82), letters * lb * 0.6);
      }
    }
    float shopFront = (type == 1 || type == 2 || type == 3) ? 1.0 : 0.0;
    float groundLit = shopFront > 0.5 ? step(h13(vec3(seed, face, 5.0)), 0.92) : step(h13(vec3(seed, face, 9.0)), 0.35);
    groundLit = max(groundLit, focus);
    // daytime glass
    vec3 glass = vec3(0.27, 0.31, 0.36) * (0.85 + 0.3 * h13(vec3(seed, face, 2.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, max(wMask, ground * (type == 2 ? 0.0 : 0.85)));
    if (type == 2 && ground > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.1, 0.09), 0.85);
    // night glow
    float povK = mix(1.0, 0.5, uPov);
    float mull = shopFront > 0.5 ? 0.55 + 0.45 * step(0.12, fract(u / 1.8)) * step(0.1, fract((y - 0.3) / 1.4)) : 1.0;
    wGlow += wMask * lit * warm * warm * 0.95 * uNight * povK;
    wGlow += wMask * (1.0 - lit) * vec3(0.012, 0.018, 0.035) * uNight;
    wGlow += ground * groundLit * mull * vec3(1.0, 0.56, 0.24) * (shopFront > 0.5 ? 1.15 : 0.6) * uNight * povK;
    wGlow += ground * focus * mull * vec3(1.0, 0.6, 0.28) * 0.55;
  }
  wGlow += focus * vec3(0.9, 0.55, 0.25) * 0.06 * (0.5 + uNight);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.3, wMask * (1.0 - uNight));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += wGlow;`)
      .replace('#include <opaque_fragment>', `outgoingLight *= 1.0 - uDim * 0.5 * (1.0 - focus);
#include <opaque_fragment>`);
    patchEdge(sh);
    patchWeather(sh, 1, 0.6);
  };
  m.customProgramCacheKey = () => 'mfw-building';
  return m;
}

/** Simple lit material with the dim patch. */
export function litMaterial(color, opts = {}) {
  const { dimStrength = 0.6, snow = 0.9, wet = 1, ...rest } = opts;
  return patchDim(new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...rest }), dimStrength, { snow, wet });
}

/** River water: dark, slightly glossy, with drifting sheen lines and warm night reflections. */
export function createWaterMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x3f5664, roughness: 0.18, metalness: 0.1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uDim = U.uDim;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uNight; uniform float uDim; varying vec2 vW;\n${HASH}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float flow = vW.x * 0.08 + uTime * 0.35;
  float ripple = sin(flow * 6.0 + sin(vW.y * 0.9 + uTime * 0.6) * 1.4);
  float sheen = smoothstep(0.86, 1.0, ripple);
  totalEmissiveRadiance += sheen * mix(vec3(0.06, 0.08, 0.09), vec3(0.5, 0.3, 0.14), uNight);
  float specks = step(0.995, h13(vec3(floor(vW * 1.6), floor(uTime * 2.0))));
  totalEmissiveRadiance += specks * vec3(1.0, 0.7, 0.4) * 0.8 * uNight;
}`)
      .replace('#include <opaque_fragment>', 'outgoingLight *= 1.0 - uDim * 0.5;\n#include <opaque_fragment>');
    patchEdge(sh);
  };
  m.customProgramCacheKey = () => 'mfw-water';
  return m;
}

/** Sky dome: gradient + sun glow + stars, all driven by the atmosphere uniforms. */
export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNight: U.uNight, uTime: U.uTime, uSkyTop: U.uSkyTop, uSkyHor: U.uSkyHor,
      uSunDir: U.uSunDir, uSunGlowCol: U.uSunGlowCol, uSunGlow: U.uSunGlow, uStars: U.uStars,
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */ `
      uniform float uNight; uniform float uTime; uniform vec3 uSkyTop; uniform vec3 uSkyHor;
      uniform vec3 uSunDir; uniform vec3 uSunGlowCol; uniform float uSunGlow; uniform float uStars;
      varying vec3 vDir;
      ${HASH}
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        float g = pow(smoothstep(-0.02, 0.55, h), 0.75);
        vec3 c = mix(uSkyHor, uSkyTop, g);
        // sun: a wide warm wash low on the horizon toward the sun + a soft disc
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        float horizon = 1.0 - smoothstep(0.0, 0.42, h);
        c += uSunGlowCol * uSunGlow * (pow(sd, 6.0) * 0.55 * (0.35 + horizon) + pow(sd, 64.0) * 0.6 + pow(sd, 900.0) * 2.0);
        // city glow on the horizon at night
        c += vec3(0.16, 0.09, 0.04) * uNight * (1.0 - smoothstep(0.0, 0.18, h));
        vec3 cell = floor(d * 220.0);
        float s = h13(cell);
        float tw = 0.6 + 0.4 * sin(uTime * 1.5 + s * 40.0);
        float star = step(0.9965, s) * smoothstep(0.08, 0.35, h) * tw;
        c += vec3(0.85, 0.88, 1.0) * star * uStars * 0.9;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Distant mountain silhouettes. Colour by height, haze from the current fog colour, rim light at dawn / dusk. */
export function createMountainMaterial(layer) {
  return new THREE.ShaderMaterial({
    uniforms: { uNight: U.uNight, uLayer: { value: layer }, uFogColor: U.uFogColor, uMountain: U.uMountain, uSnow: U.uSnow, uSunGlowCol: U.uSunGlowCol, uSunGlow: U.uSunGlow, uSunDir: U.uSunDir },
    fog: false,
    vertexShader: /* glsl */ `
      attribute float aH; varying float vH; varying float vY; varying vec3 vW;
      void main(){ vH = aH; vY = position.y; vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uNight; uniform float uLayer; uniform vec3 uFogColor; uniform vec3 uMountain; uniform float uSnow;
      uniform vec3 uSunGlowCol; uniform float uSunGlow; uniform vec3 uSunDir;
      varying float vH; varying float vY; varying vec3 vW;
      void main(){
        float t = clamp(vY / 1500.0, 0.0, 1.0);
        vec3 base = uMountain * mix(0.82, 1.08, uLayer);
        vec3 c = mix(uFogColor, base, (0.3 + 0.7 * pow(t, 0.7)) * mix(1.0, 0.55, uLayer));
        // snow caps on the high peaks (more in snowy weather)
        float capStart = mix(0.8, 0.45, uSnow);
        float snow = smoothstep(capStart, capStart + 0.14, vY / max(vH, 1.0)) * smoothstep(mix(1100.0, 500.0, uSnow), mix(1500.0, 800.0, uSnow), vH);
        vec3 snowCol = mix(vec3(0.94, 0.94, 0.95), vec3(0.2, 0.24, 0.33), uNight);
        snowCol = mix(snowCol, uFogColor, 0.25 * uLayer);
        c = mix(c, snowCol, snow * 0.85);
        // alpenglow: peaks facing the low sun pick up its colour
        vec2 toSun = normalize(uSunDir.xz + 1e-4);
        vec2 fromCity = normalize(vW.xz - vec2(380.0, -200.0));
        float facing = smoothstep(-0.2, 0.9, -dot(fromCity, toSun));
        c += uSunGlowCol * uSunGlow * facing * smoothstep(0.35, 1.0, vY / max(vH, 1.0)) * 0.35;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Radial gradient texture used for light pools, blob shadows and beacon glows. */
export function radialTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
