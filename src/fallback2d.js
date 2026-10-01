import { CATEGORIES } from './config.js';
import { formatDistance, formatMinutes, openStatus, escapeHtml } from './util.js';

/**
 * Lightweight 2D experience for browsers without WebGL2: an SVG map of the same road graph,
 * the same offline routing, and the same recommendation logic. Never a blank screen.
 */
export function renderFallback(root, { roads, restaurants, graph }, reason) {
  root.hidden = false;
  document.getElementById('loading')?.classList.add('done');
  const X0 = -180, X1 = 880, Z0 = -960, Z1 = 460;
  const nodes = new Map(roads.nodes.map((n) => [n.id, n]));
  const edges = roads.edges.map((e) => {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    return `<line x1="${a.x}" y1="${a.z}" x2="${b.x}" y2="${b.z}" stroke="${e.roadType === 'pedestrian' || e.roadType === 'shotengai' ? '#6d6556' : '#3d4048'}" stroke-width="${Math.max(4, e.width)}" stroke-linecap="round"/>`;
  }).join('');
  const river = `<polyline points="${roads.river.points.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#24394a" stroke-width="${roads.river.width}" stroke-linecap="round"/>`;
  const dots = restaurants.map((r) => `<circle class="fb-dot" data-id="${r.id}" cx="${r.position.x}" cy="${r.position.z}" r="7" fill="#f0a24a" stroke="#111318" stroke-width="2"><title>${escapeHtml(r.name)}</title></circle>`).join('');
  root.innerHTML = `
    <div class="fb-wrap">
      <h2>MATSUMOTO FOOD WALK</h2>
      <p>${escapeHtml(reason)}<br />簡易2Dマップで表示しています。お店を選ぶと松本駅からのルートと所要時間を表示します。</p>
      <svg class="fb-map" viewBox="${X0} ${Z0} ${X1 - X0} ${Z1 - Z0}" role="img" aria-label="松本駅周辺の簡易マップ">
        <rect x="${X0}" y="${Z0}" width="${X1 - X0}" height="${Z1 - Z0}" fill="#16191f"/>
        <rect x="-108" y="${Z0}" width="82" height="${Z1 - Z0}" fill="#211f1d"/>
        ${river}${edges}
        <polyline id="fb-route" fill="none" stroke="#ffb35c" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>
        <rect x="-10" y="-60" width="40" height="120" rx="4" fill="#e7e1d5"/>
        <text x="10" y="-72" fill="#ece6da" font-size="30" text-anchor="middle">松本駅</text>
        ${dots}
      </svg>
      <div class="fb-info" id="fb-info">地図上の点、または下のリストからお店を選んでください。</div>
      <div class="fb-list">${restaurants.map((r) => `<button type="button" class="fb-item" data-id="${r.id}" aria-pressed="false"><span>${escapeHtml(r.name)}<br /><small style="color:#a1998c">${CATEGORIES[r.category].label} · ${escapeHtml(r.street || '')}</small></span><span>徒歩 ${formatMinutes(graph.routesFor(r.id).walk.fastest.time)}分</span></button>`).join('')}</div>
    </div>`;
  const select = (id) => {
    const r = restaurants.find((x) => x.id === id);
    const rt = graph.routesFor(id);
    const best = rt.best;
    const pts = [];
    for (const leg of best.route.legs) for (const h of leg.halves) {
      const a = graph.nodes.get(h.from), b = graph.nodes.get(h.to);
      if (!pts.length) pts.push([a.x, a.z]);
      pts.push([b.x, b.z]);
    }
    pts.push([r.position.x, r.position.z]);
    root.querySelector('#fb-route').setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    root.querySelectorAll('.fb-item').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    const m = (k, label) => `${label} ${formatMinutes(rt[k].fastest.time)}分（${formatDistance(rt[k].fastest.distance)}）`;
    root.querySelector('#fb-info').innerHTML = `<strong>${escapeHtml(r.name)}</strong> — ${escapeHtml(openStatus(r).label)}<br />${m('walk', '徒歩')} / ${m('bike', '自転車')} / ${m('car', '車')}<br />BEST CHOICE：${escapeHtml(best.reason)}<br /><span style="color:#a1998c">${escapeHtml(r.description)}</span>`;
  };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-id]');
    if (t) select(t.dataset.id);
  });
}
