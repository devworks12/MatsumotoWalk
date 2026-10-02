// Small shared helpers (no three.js dependency so routing can run anywhere, incl. the 2D fallback).

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatMinutes(sec) {
  return Math.max(1, Math.round(sec / 60));
}
export function formatDistance(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** Current weekday / minutes-of-day in Japan time, regardless of the viewer's timezone. */
export function tokyoNow(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
  } catch {
    return { day: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes() };
  }
}

const toMin = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const DAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

export function hoursText(r) {
  const h = (r.hours || []).map(([a, b]) => `${a}–${b}`).join(' / ');
  const c = r.closed && r.closed.length ? `${r.closed.map((d) => DAY_JA[d]).join('・')}曜定休` : '無休';
  return { hours: h || '—', closed: c };
}

/** { open, label, soon } — label is short Japanese status text. */
export function openStatus(r, now = tokyoNow()) {
  if (r.closed?.includes(now.day)) return { open: false, label: '本日定休' };
  const slots = (r.hours || []).map(([a, b]) => [toMin(a), toMin(b) === 0 ? 1440 : toMin(b)]);
  for (const [a, b] of slots) {
    if (now.minutes >= a && now.minutes < b) {
      const left = b - now.minutes;
      return { open: true, label: left <= 45 ? `まもなく閉店 · ${fmt(b)}まで` : `営業中 · ${fmt(b)}まで` };
    }
  }
  const next = slots.find(([a]) => a > now.minutes);
  if (next) return { open: false, label: `準備中 · ${fmt(next[0])}から` };
  return { open: false, label: '本日の営業は終了' };
}
const fmt = (m) => `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const store = {
  get(k, fallback = null) {
    try {
      const v = localStorage.getItem('mfw:' + k);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('mfw:' + k, JSON.stringify(v));
    } catch {
      /* private mode etc. */
    }
  },
};
