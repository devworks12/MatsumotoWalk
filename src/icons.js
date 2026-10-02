// Line icons on a 24×24 grid. Used both as inline SVG (UI) and via Path2D (3D beacon atlas).

export const ICONS = {
  // categories
  soba: 'M3 13h18 M5 13c0 3.5 3 6 7 6s7-2.5 7-6 M7 10c1.7-.9 3.3.9 5 0s3.3-.9 5 0 M16 3l-4.5 7 M19.5 4.5l-5.5 5.5',
  sanzoku: 'M14.5 3.5a6 6 0 0 1 3.6 10.8l-5.1 1.2-3.6 3.6a2.1 2.1 0 1 1-3-3l3.6-3.6 1.2-5.1a6 6 0 0 1 3.3-3.9z M14 8.5l1.5 1.5',
  ramen: 'M3 11h18 M4.2 11a7.8 7 0 0 0 15.6 0 M9 18.5 8.3 21h7.4L15 18.5 M14 2.8l-3.6 8 M18 4l-5 6.5 M7 8.5c.8-.7 1.6.7 2.4 0',
  yoshoku: 'M7 3v8 M5 3v5a2 2 0 0 0 4 0V3 M7 11v10 M17 3c-2.2 0-3.2 3.5-3.2 7.5H17V21',
  washoku: 'M3.5 12h17a8.5 8.5 0 0 1-17 0z M9 21h6 M7.5 12c0-3 2-5.2 4.5-5.2s4.5 2.2 4.5 5.2 M15 2.5l5 5',
  yakiniku: 'M3.5 14h17 M5 11h14 M6.5 14 5.5 20 M17.5 14l1 6 M8 8.5c0-1.6 1.6-1.9 1.6-3.8 M12 8.5c0-1.6 1.6-1.9 1.6-3.8 M16 8.5c0-1.6 1.6-1.9 1.6-3.8',
  izakaya: 'M8 4.5h8 M8 19.5h8 M12 2.5v2 M12 19.5v2 M7 8c0-1.9 2.2-3.5 5-3.5s5 1.6 5 3.5v8c0 1.9-2.2 3.5-5 3.5s-5-1.6-5-3.5z M7 12h10',
  cafe: 'M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z M16 10.5h1.5a2 2 0 0 1 0 4H16 M8 2.5c0 2 1.6 2 1.6 4 M12 2.5c0 2 1.6 2 1.6 4 M3 21h14',
  sweets: 'M3 20h18 M5 20v-7.5h14V20 M5 16c1.8 1 3.2-1 5 0s3.2 1 5 0 2.2-1 4 0 M12 12.5V8.5 M12 5.5v.01 M10.5 8.5h3',
  bakery: 'M4 15.5c0-5 3.6-8.5 8-8.5s8 3.5 8 8.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M9 9.5l1 4 M12.6 8.6V13 M16 9.5l-1 4',
  // ui
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z M15.5 15.5 20.5 20.5',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z',
  sunrise: 'M7 16a5 5 0 0 1 10 0 M3 16h18 M5 20h14 M12 4v4 M9.5 6.5 12 4l2.5 2.5 M4.6 10.6l1.4 1.4 M19.4 10.6 18 12',
  sunset: 'M7 16a5 5 0 0 1 10 0 M3 16h18 M5 20h14 M12 4v4 M9.5 5.5 12 8l2.5-2.5 M4.6 10.6l1.4 1.4 M19.4 10.6 18 12',
  rain: 'M7 14a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.5 8 3.5 3.5 0 0 1 18 15H7 M8 18l-1 2.5 M12 18l-1 2.5 M16 18l-1 2.5',
  snow: 'M12 3v18 M4.2 7.5l15.6 9 M4.2 16.5l15.6-9 M9.5 4.5 12 6l2.5-1.5 M9.5 19.5 12 18l2.5 1.5',
  settings: 'M4 7.5h9 M17 7.5h3 M4 16.5h3 M11 16.5h9 M15 5.5v4 M9 14.5v4',
  close: 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
  walk: 'M13.5 3.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z M9.5 21l2.2-6 2.8 2.8V21 M8.5 12.5 10 8.2l3.8 1 2 3.3 M10 8.2 7 11',
  bike: 'M6 13.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M18 13.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M6 17l3.6-6.5h5.8L18 17 M9.6 10.5 8.6 7.5H6.5 M15.4 10.5 12.5 17H6',
  car: 'M3.5 16.5v-3.2L5.6 8h12.8l2.1 5.3v3.2z M5 16.5V19h2.5v-2.5 M16.5 16.5V19H19v-2.5 M3.5 13.2h17 M7 14.8h.01 M17 14.8h.01',
  explore: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M15.5 8.5l-2 5-5 2 2-5z',
  play: 'M8 5.5l10.5 6.5L8 18.5z',
  overview: 'M12 3.5l8.5 4.6-8.5 4.6-8.5-4.6z M3.5 12.4l8.5 4.6 8.5-4.6 M3.5 16.4 12 21l8.5-4.6',
  sound: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z M15.5 9.5a3.5 3.5 0 0 1 0 5 M18 7a7 7 0 0 1 0 10',
  mute: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z M16 10l4 4 M20 10l-4 4',
  reset: 'M12 3v3.5 M12 17.5V21 M3 12h3.5 M17.5 12H21 M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  train: 'M7.5 3h9a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z M4.5 10h15 M8.5 21l2-4 M15.5 21l-2-4 M8.5 13.5h.01 M15.5 13.5h.01',
  skip: 'M5.5 5.5l9 6.5-9 6.5z M18.5 5.5v13',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z M12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 7v5l3.5 2',
  chevronUp: 'M6 15l6-6 6 6',
};

export function svgIcon(name, { size = 20, stroke = 1.6, cls = '' } = {}) {
  const d = ICONS[name] || '';
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

export const CATEGORY_ORDER = ['soba', 'sanzoku', 'ramen', 'yoshoku', 'washoku', 'yakiniku', 'izakaya', 'cafe', 'sweets', 'bakery'];

/**
 * Texture atlas for 3D beacons: one 128px cell per category.
 * Returns { canvas, cols, rows, index(category) }.
 */
export function buildIconAtlas() {
  const cell = 128, cols = 4, rows = 3;
  const canvas = document.createElement('canvas');
  canvas.width = cell * cols;
  canvas.height = cell * rows;
  const ctx = canvas.getContext('2d');
  CATEGORY_ORDER.forEach((cat, i) => {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 19, 27, 0.92)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(240, 180, 100, 0.95)';
    ctx.stroke();
    const s = (cell * 0.46) / 24;
    ctx.translate(cx - 12 * s, cy - 12 * s);
    ctx.scale(s, s);
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f6ecda';
    ctx.stroke(new Path2D(ICONS[cat]));
    ctx.restore();
  });
  return { canvas, cols, rows, index: (c) => Math.max(0, CATEGORY_ORDER.indexOf(c)) };
}
