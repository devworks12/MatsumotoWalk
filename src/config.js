// Static configuration: categories, filters and travel-mode models.

export const CATEGORIES = {
  soba:     { label: '信州そば',   en: 'SOBA',     aliases: ['そば', '蕎麦', 'ソバ', 'soba', '信州そば', 'ざる', 'せいろ'] },
  sanzoku:  { label: '山賊焼',     en: 'SANZOKU',  aliases: ['山賊焼', '山賊', 'さんぞく', 'サンゾク', '唐揚げ', 'からあげ', '鶏', 'とり'] },
  ramen:    { label: 'ラーメン',   en: 'RAMEN',    aliases: ['ラーメン', 'らーめん', 'らぁ麺', '中華そば', 'つけ麺', 'ramen', '麺'] },
  yoshoku:  { label: '洋食',       en: 'YOSHOKU',  aliases: ['洋食', 'ハンバーグ', 'オムライス', 'ビストロ', 'シチュー', 'グリル'] },
  washoku:  { label: '和食',       en: 'WASHOKU',  aliases: ['和食', '定食', '割烹', '会席', '日本料理'] },
  yakiniku: { label: '焼肉',       en: 'YAKINIKU', aliases: ['焼肉', 'やきにく', '焼き肉', '肉', '牛', 'ホルモン', 'すき焼き'] },
  izakaya:  { label: '居酒屋',     en: 'IZAKAYA',  aliases: ['居酒屋', '酒', '飲み', '地酒', '日本酒', '酒場', '立ち呑み'] },
  cafe:     { label: 'カフェ',     en: 'CAFE',     aliases: ['カフェ', '喫茶', '珈琲', 'コーヒー', 'cafe', 'coffee'] },
  sweets:   { label: 'スイーツ',   en: 'SWEETS',   aliases: ['スイーツ', '甘味', '和菓子', 'ケーキ', 'たい焼き', 'デザート', 'おやつ'] },
  bakery:   { label: 'ベーカリー', en: 'BAKERY',   aliases: ['パン', 'ベーカリー', 'bakery', 'ブーランジェリー'] },
};

export const FILTERS = [
  { id: 'all',     label: 'ALL',     ja: 'すべて',     match: () => true },
  { id: 'local',   label: 'LOCAL',   ja: '松本名物',   match: (r) => r.tags.includes('松本名物') || r.category === 'soba' || r.category === 'sanzoku' },
  { id: 'soba',    label: 'SOBA',    ja: 'そば',       match: (r) => r.category === 'soba' },
  { id: 'ramen',   label: 'RAMEN',   ja: 'ラーメン',   match: (r) => r.category === 'ramen' },
  { id: 'meat',    label: 'MEAT',    ja: '肉・山賊焼', match: (r) => r.category === 'yakiniku' || r.category === 'sanzoku' },
  { id: 'dining',  label: 'DINING',  ja: '洋食・和食', match: (r) => r.category === 'yoshoku' || r.category === 'washoku' },
  { id: 'cafe',    label: 'CAFE',    ja: 'カフェ',     match: (r) => r.category === 'cafe' },
  { id: 'sweets',  label: 'SWEETS',  ja: '甘味・パン', match: (r) => r.category === 'sweets' || r.category === 'bakery' },
  { id: 'izakaya', label: 'IZAKAYA', ja: '居酒屋',     match: (r) => r.category === 'izakaya' },
];

/**
 * Travel models. Speeds in m/s by road type. Penalties in seconds.
 * The goal is "feels right" rather than navigation-grade accuracy.
 */
export const MODES = {
  walk: {
    id: 'walk', label: 'WALK', ja: '徒歩',
    speed: { avenue: 1.25, street: 1.25, lane: 1.25, shotengai: 1.15, pedestrian: 1.2, plaza: 1.2, passage: 1.2 },
    turn: { left: 2, right: 2 },
    signal: 26,        // expected wait at a signalised crossing
    majorCross: 14,    // crossing a big road without a signal
    start: 0, end: 0,
    tour: { eye: 1.7, speed: 12, corner: 0.42, lookAhead: 14, radius: 3.5, maxDuration: 30, minDuration: 9, line: 2.0 },
  },
  bike: {
    id: 'bike', label: 'BIKE', ja: '自転車',
    speed: { avenue: 4.2, street: 4.0, lane: 3.6, shotengai: 2.4, pedestrian: 2.0, plaza: 2.0, passage: 1.0 },
    turn: { left: 4, right: 5 },
    signal: 24,
    majorCross: 10,
    start: 25, end: 25, // unlock / park
    tour: { eye: 2.05, speed: 19, corner: 0.38, lookAhead: 20, radius: 6, maxDuration: 24, minDuration: 8, line: 2.4 },
  },
  car: {
    id: 'car', label: 'CAR', ja: '車',
    speed: { avenue: 7.5, street: 6.2, lane: 4.4, shotengai: 3.0 },
    turn: { left: 7, right: 14 }, // drive on the left: right turns cross traffic
    signal: 22,
    majorCross: 0,
    start: 60, end: 120,  // get out of the car park / find a space and park
    tour: { eye: 1.3, speed: 24, corner: 0.33, lookAhead: 26, radius: 9, maxDuration: 22, minDuration: 8, line: 2.8 },
  },
};

export const MODE_ORDER = ['walk', 'bike', 'car'];
export const VARIANTS = [
  { id: 'fastest', label: 'FASTEST', ja: '最短' },
  { id: 'easy',    label: 'EASY',    ja: 'わかりやすい' },
  { id: 'scenic',  label: 'SCENIC',  ja: '街歩き' },
];

// Visual palette (linear values are derived in materials)
export const PALETTE = {
  amber: 0xf0a24a,
  gold: 0xe9c27a,
  ember: 0xff8a3d,
  ivory: 0xece6da,
  charcoal: 0x16181c,
  navy: 0x0d1424,
};

// World anchor points
export const WORLD = {
  station: { x: 36, z: 0 },
  rotary: { x: 80, z: -35, r: 23 }, // bus & taxi rotary, north half of the plaza (keeps the walking axis clear)
  castle: { x: 560, z: -1085 },
  bounds: { minX: -400, maxX: 1300, minZ: -1250, maxZ: 650 },
  defaultTarget: { x: 420, z: -170 },
};
