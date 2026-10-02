/**
 * Very quiet procedural ambience (no audio files): filtered noise as wind / distant city,
 * occasional birds by day, autumn insects by night. Off by default; starts on user gesture.
 */
export class Ambience {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.night = false;
    this.weather = 'clear';
    this.timer = null;
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    // brown-ish noise buffer
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 650;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    src.connect(this.filter).connect(this.noiseGain).connect(this.master).connect(ctx.destination);
    src.start();
    // slow "gust" modulation
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(this.noiseGain.gain);
    lfo.start();
    return true;
  }

  _chirp() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || this.weather !== 'clear') return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g).connect(this.master);
    if (this.night) {
      // cricket: short trains of high pulses
      o.type = 'sine';
      o.frequency.value = 4200 + Math.random() * 600;
      g.gain.setValueAtTime(0, now);
      for (let i = 0; i < 6; i++) {
        g.gain.setValueAtTime(0.006, now + i * 0.07);
        g.gain.setValueAtTime(0, now + i * 0.07 + 0.035);
      }
      o.start(now);
      o.stop(now + 0.5);
    } else {
      o.type = 'sine';
      const f = 2600 + Math.random() * 1400;
      o.frequency.setValueAtTime(f, now);
      o.frequency.exponentialRampToValueAtTime(f * 1.35, now + 0.08);
      o.frequency.exponentialRampToValueAtTime(f * 0.9, now + 0.16);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.012, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      o.start(now);
      o.stop(now + 0.22);
    }
  }

  _schedule() {
    clearTimeout(this.timer);
    if (!this.enabled) return;
    this.timer = setTimeout(() => { this._chirp(); this._schedule(); }, (this.night ? 1800 : 5000) + Math.random() * 6000);
  }

  _apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rain = this.weather === 'rain', snow = this.weather === 'snow';
    // rain: a broad hiss; snow: an almost silent, muffled town
    const gain = rain ? 0.075 : snow ? 0.008 : this.night ? 0.016 : 0.03;
    this.noiseGain.gain.setTargetAtTime(this.enabled ? gain : 0, t, 0.8);
    this.filter.frequency.setTargetAtTime(rain ? 2600 : snow ? 240 : this.night ? 320 : 700, t, 0.8);
  }

  setEnabled(on) {
    this.enabled = on;
    if (on && !this.ctx && !this._init()) return;
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    this._apply();
    this._schedule();
  }

  setNight(night) {
    this.night = night;
    this._apply();
  }

  setWeather(w) {
    this.weather = w;
    this._apply();
  }
}
