import { svgIcon } from './icons.js';
import { CATEGORIES, FILTERS, MODES, MODE_ORDER, VARIANTS } from './config.js';
import { escapeHtml, formatDistance, formatMinutes, hoursText, openStatus } from './util.js';

const $ = (id) => document.getElementById(id);
const foodArt = (cat) => `assets/food/${cat}.svg`;

/**
 * DOM layer. Pure view + event wiring; all decisions are delegated to `handlers` (the App).
 */
export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.app = $('app');
    this.sheet = $('sheet');
    this.sheetBody = $('sheet-body');
    this.sheetState = 'hidden';
    this._icons();
    this._wire();
    this._sheetDrag();
  }

  _icons() {
    $('btn-search').innerHTML = svgIcon('search');
    $('btn-settings').innerHTML = svgIcon('settings');
    $('btn-home').innerHTML = svgIcon('reset');
    document.querySelector('.search-icon').innerHTML = svgIcon('search', { size: 18 });
    for (const id of ['search-close', 'settings-close', 'explore-close', 'tour-exit']) $(id).innerHTML = svgIcon('close', { size: 18 });
    $('tour-skip').innerHTML = svgIcon('skip', { size: 18 });
    document.querySelector('.explore-icon').innerHTML = svgIcon('explore', { size: 18 });
  }

  _wire() {
    const h = this.h;
    $('btn-search').addEventListener('click', () => this.toggleSearch());
    $('search-close').addEventListener('click', () => this.toggleSearch(false));
    const input = $('search-input');
    input.addEventListener('input', () => h.onSearch(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = $('search-results').querySelector('.result'); first?.click(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); $('search-results').querySelector('.result')?.focus(); }
    });
    $('search-results').addEventListener('keydown', (e) => {
      const items = [...$('search-results').querySelectorAll('.result')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) input.focus(); else items[i - 1].focus(); }
    });
    $('search-hints').innerHTML = ['そば', '山賊焼', 'ラーメン', 'カフェ', '地酒', '中町通り', 'テイクアウト']
      .map((t) => `<button type="button" class="hint">${t}</button>`).join('');
    $('search-hints').addEventListener('click', (e) => {
      const b = e.target.closest('.hint');
      if (!b) return;
      input.value = b.textContent;
      h.onSearch(input.value);
      input.focus();
    });

    $('btn-daynight').addEventListener('click', () => h.onDayNight());
    $('btn-settings').addEventListener('click', () => this.toggleSettings());
    $('settings-close').addEventListener('click', () => this.toggleSettings(false));
    document.querySelectorAll('.seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        this.setSetting(seg.dataset.setting, b.dataset.value);
        h.onSetting(seg.dataset.setting, b.dataset.value);
      });
    });
    $('btn-reset-view').addEventListener('click', () => { this.toggleSettings(false); h.onResetView(); });
    $('btn-replay-intro').addEventListener('click', () => { this.toggleSettings(false); h.onReplayIntro(); });
    $('brand').addEventListener('click', () => h.onResetView());
    $('btn-home').addEventListener('click', () => h.onHome());

    $('btn-explore').addEventListener('click', () => h.onExplore());
    $('explore-close').addEventListener('click', () => this.hideExplore());

    $('tour-exit').addEventListener('click', () => h.onExitTour());
    $('tour-skip').addEventListener('click', () => h.onSkipTour());
    $('arrival-overview').addEventListener('click', () => h.onExitTour());
    $('arrival-replay').addEventListener('click', () => h.onPreview());
    $('intro-skip').addEventListener('click', (e) => { e.stopPropagation(); h.onSkipIntro(); });
    $('intro').addEventListener('click', () => h.onSkipIntro());

    // Sheet delegated clicks
    this.sheetBody.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const a = t.dataset.action;
      if (a === 'close') h.onCloseSheet();
      else if (a === 'mode') h.onMode(t.dataset.mode);
      else if (a === 'variant') h.onVariant(t.dataset.variant);
      else if (a === 'preview') h.onPreview();
      else if (a === 'overview') h.onOverview();
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.matches?.('input')) {
        if (e.key === 'Escape') this.toggleSearch(false);
        return;
      }
      if (e.key === 'Escape') h.onEscape();
      else if (e.key === '/') { e.preventDefault(); this.toggleSearch(true); }
    });
  }

  // ------------------------------------------------------------------ loading / intro
  setLoading(p, msg) {
    $('loading-bar').style.width = `${Math.round(p * 100)}%`;
    $('loading').setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (msg) $('loading-status').textContent = msg;
  }
  finishLoading() {
    $('loading').classList.add('done');
    this.app.classList.remove('is-loading');
  }
  showIntro() {
    const el = $('intro');
    el.hidden = false;
    el.classList.remove('out');
    this.app.classList.add('is-intro');
  }
  hideIntro() {
    const el = $('intro');
    if (el.hidden) return;
    el.classList.add('out');
    this.app.classList.remove('is-intro');
    setTimeout(() => { el.hidden = true; }, 650);
  }

  // ------------------------------------------------------------------ filters
  renderFilters(activeId, counts) {
    const nav = $('filters');
    nav.innerHTML = FILTERS.map((f) => `
      <button type="button" class="tab" role="tab" data-filter="${f.id}" aria-selected="${f.id === activeId}" aria-label="${f.ja}（${counts[f.id]}件）">
        ${f.label}<span class="count">${counts[f.id]}</span>
      </button>`).join('');
    nav.onclick = (e) => {
      const b = e.target.closest('.tab');
      if (b) this.h.onFilter(b.dataset.filter);
    };
    nav.onkeydown = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = [...nav.querySelectorAll('.tab')];
      const i = tabs.indexOf(document.activeElement);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      n.focus();
      n.click();
    };
  }
  setActiveFilter(id) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.filter === id;
      t.setAttribute('aria-selected', String(on));
      if (on) t.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    });
  }

  // ------------------------------------------------------------------ search
  toggleSearch(force) {
    const el = $('search');
    const open = force ?? el.hidden;
    if (open) { this.toggleSettings(false); this.hideExplore(); }
    el.hidden = !open;
    $('btn-search').setAttribute('aria-expanded', String(open));
    $('filters').classList.toggle('hidden', open);
    if (open) setTimeout(() => $('search-input').focus(), 30);
    else {
      $('search-input').value = '';
      this.h.onSearch('');
      $('search-input').blur();
    }
  }
  get searchOpen() { return !$('search').hidden; }

  renderSearchResults(q, results, walkTimeFor) {
    const ul = $('search-results');
    $('search-hints').hidden = !!q;
    if (!q) { ul.innerHTML = ''; return; }
    if (!results.length) { ul.innerHTML = `<li class="search-empty">「${escapeHtml(q)}」に一致するお店はありません</li>`; return; }
    ul.innerHTML = results.slice(0, 8).map((r) => `
      <li><button type="button" class="result" data-id="${r.id}" role="option">
        <img src="${foodArt(r.category)}" alt="" width="34" height="34" />
        <span><span class="result-name">${escapeHtml(r.name)}</span><span class="result-meta">${CATEGORIES[r.category].label} · ${escapeHtml(r.street || '')}</span></span>
        <span class="result-time">徒歩 ${formatMinutes(walkTimeFor(r.id))}分</span>
      </button></li>`).join('');
    ul.onclick = (e) => {
      const b = e.target.closest('.result');
      if (b) this.h.onSelectShop(b.dataset.id, { from: 'search' });
    };
  }

  // ------------------------------------------------------------------ settings
  toggleSettings(force) {
    const el = $('settings');
    const open = force ?? el.hidden;
    el.hidden = !open;
    $('btn-settings').setAttribute('aria-expanded', String(open));
    if (open) { this.hideExplore(); }
  }
  setSetting(key, value) {
    document.querySelectorAll(`.seg[data-setting="${key}"] button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
  }
  /** phase: dawn | day | dusk | night; auto: following the real clock. */
  setTimeIcon(phase, auto, weather = 'clear') {
    const b = $('btn-daynight');
    const icon = weather !== 'clear' ? weather : { dawn: 'sunrise', day: 'sun', dusk: 'sunset', night: 'moon' }[phase];
    b.innerHTML = svgIcon(icon) + (auto ? '<span class="auto-dot" aria-hidden="true"></span>' : '');
    const ja = { dawn: '朝焼け', day: '昼', dusk: '夕焼け', night: '夜' }[phase];
    b.setAttribute('aria-label', `時間帯を切り替え（現在：${auto ? '自動・' : ''}${ja}）`);
    b.classList.toggle('on', phase === 'night' || phase === 'dusk');
  }

  // ------------------------------------------------------------------ explore
  showExplore(subtitle, cards) {
    this.toggleSettings(false);
    $('explore-sub').textContent = subtitle;
    $('explore-cards').innerHTML = cards.map((c) => `
      <button type="button" class="xcard" data-id="${c.r.id}">
        <span class="xcard-top"><span class="xcard-ctx">${c.ctx}</span><img src="${foodArt(c.r.category)}" alt="" width="40" height="40" /></span>
        <span class="xcard-name">${escapeHtml(c.r.name)}</span>
        <span class="xcard-meta">${CATEGORIES[c.r.category].label} · 徒歩 ${formatMinutes(c.walk)}分 · ${escapeHtml(c.status)}</span>
        <span class="xcard-why">${escapeHtml(c.why)}</span>
      </button>`).join('');
    $('explore-cards').onclick = (e) => {
      const b = e.target.closest('.xcard');
      if (b) this.h.onSelectShop(b.dataset.id, { from: 'explore' });
    };
    $('explore').hidden = false;
    $('btn-explore').setAttribute('aria-expanded', 'true');
    this.app.classList.add('explore-open');
    $('explore-cards').scrollLeft = 0;
  }
  hideExplore() {
    if ($('explore').hidden) return;
    $('explore').hidden = true;
    $('btn-explore').setAttribute('aria-expanded', 'false');
    this.app.classList.remove('explore-open');
    this.h.onExploreClosed?.();
  }
  get exploreOpen() { return !$('explore').hidden; }

  // ------------------------------------------------------------------ sheet
  renderSheet(r, routes, state) {
    const cat = CATEGORIES[r.category];
    const st = openStatus(r);
    const ht = hoursText(r);
    const best = routes.best;
    const cur = routes[state.mode][state.variant];
    const modeBtn = (m) => {
      const rr = routes[m].fastest;
      return `<button type="button" class="mode" data-action="mode" data-mode="${m}" aria-pressed="${state.mode === m}" aria-label="${MODES[m].ja} ${formatMinutes(rr.time)}分 ${formatDistance(rr.distance)}">
        ${best.mode === m ? '<span class="best-tag">BEST</span>' : ''}
        <span class="mode-label">${MODES[m].label}</span>
        ${svgIcon(m, { size: 22 })}
        <span class="mode-time">${formatMinutes(rr.time)}<small>MIN</small></span>
        <span class="mode-dist">${formatDistance(rr.distance)}</span>
      </button>`;
    };
    const variantDesc = (v, rr) => {
      if (!rr) return '—';
      const parts = [];
      if (v === 'fastest') parts.push('最も早く着く道');
      if (v === 'easy') parts.push(rr.sameAsFastest ? '最短ルートと同じ' : '曲がり角の少ない道');
      if (v === 'scenic') parts.push(rr.sameAsFastest ? '最短ルートと同じ' : '街並みを楽しめる道');
      parts.push(`曲がり角 ${rr.turns}回`);
      if (rr.signals) parts.push(`信号 ${rr.signals}`);
      const nice = rr.streets.filter((s) => /中町|縄手|川|小径|大名町/.test(s));
      if (v === 'scenic' && nice.length && !rr.sameAsFastest) parts.push(nice.slice(0, 2).join('・'));
      return parts.join(' · ');
    };
    const fastest = routes[state.mode].fastest;
    const variantBtn = (v) => {
      const rr = routes[state.mode][v.id];
      const diff = rr ? Math.round((rr.time - fastest.time) / 60) : 0;
      return `<button type="button" class="variant" data-action="variant" data-variant="${v.id}" aria-pressed="${state.variant === v.id}">
        <span class="variant-id">${v.label}${best.mode === state.mode && best.variant === v.id ? ' <span class="best-eyebrow">· BEST</span>' : ''}</span>
        <span class="variant-desc">${variantDesc(v.id, rr)}</span>
        <span class="variant-time">${rr ? formatMinutes(rr.time) + '分' : '—'}<small>${rr ? (diff > 0 ? `+${diff}分` : formatDistance(rr.distance)) : ''}</small></span>
      </button>`;
    };
    const carNote = state.mode === 'car' && cur?.walkDistance > 20 ? `<p class="note">車で近くまで行き、最後の ${formatDistance(cur.walkDistance)} は歩きます（地図上の点線）。</p>` : '';
    this.sheetBody.innerHTML = `
      <div class="shop-head">
        <img class="shop-art" src="${foodArt(r.category)}" alt="${cat.label}のイラスト" width="56" height="56" />
        <div>
          <div class="shop-cat">${cat.en}<span class="shop-status ${st.open ? 'open' : ''}">${escapeHtml(st.label)}</span></div>
          <h2 class="shop-name" id="sheet-name">${escapeHtml(r.name)}</h2>
          <div class="shop-meta">${cat.label} · ${escapeHtml(r.priceText)} · 駅から ${formatDistance(routes.walk.fastest.distance)}</div>
        </div>
        <button type="button" class="icon-btn small" data-action="close" aria-label="閉じる">${svgIcon('close', { size: 18 })}</button>
      </div>
      <div class="modes" role="group" aria-label="移動手段">${MODE_ORDER.map(modeBtn).join('')}</div>
      <div class="actions">
        <button type="button" class="btn" data-action="preview">${svgIcon('play', { size: 16 })}ROUTE PREVIEW</button>
        <button type="button" class="btn ghost" data-action="overview" aria-label="ルート全体を表示">${svgIcon('overview', { size: 18 })}</button>
      </div>
      <div class="best">
        <div class="best-row"><span class="best-eyebrow">BEST CHOICE</span>
          <span class="best-main">${MODES[best.mode].ja} ${formatMinutes(best.route.time)}分 · ${formatDistance(best.route.distance)}${best.variant !== 'fastest' ? ` · ${VARIANTS.find((v) => v.id === best.variant).label}` : ''}</span></div>
        <p class="best-reason">${escapeHtml(best.reason)}</p>
      </div>
      <div class="variants">
        <p class="section-title">ROUTES · ${MODES[state.mode].label}</p>
        <div class="variant-list" role="group" aria-label="ルート候補">${VARIANTS.map(variantBtn).join('')}</div>
        ${carNote}
      </div>
      <p class="shop-desc">${escapeHtml(r.description)}</p>
      <div class="tags">${r.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      <dl class="facts">
        <dt>おすすめ</dt><dd>${r.menu.map(escapeHtml).join('、')}</dd>
        <dt>営業時間</dt><dd>${escapeHtml(ht.hours)}（${escapeHtml(ht.closed)}）</dd>
        <dt>場所</dt><dd>${escapeHtml(r.street || '')}沿い</dd>
        <dt>価格帯</dt><dd>${'¥'.repeat(r.priceLevel)}<span style="opacity:.35">${'¥'.repeat(3 - r.priceLevel)}</span>　${escapeHtml(r.priceText)}</dd>
      </dl>
      <p class="note">所要時間は信号待ち・右左折・駐車を考慮した目安です。店舗情報は架空のサンプルです。</p>`;
  }

  openSheet(state = 'peek') {
    this.app.classList.add('sheet-open');
    this.sheet.setAttribute('aria-hidden', 'false');
    this.setSheetState(state);
  }
  setSheetState(state) {
    this.sheetState = state;
    this.sheet.classList.toggle('peek', state === 'peek');
    this.sheet.classList.toggle('full', state === 'full');
    this.sheet.style.transform = '';
    if (state === 'peek') this.sheetBody.scrollTop = 0;
  }
  closeSheet() {
    this.app.classList.remove('sheet-open');
    this.sheet.setAttribute('aria-hidden', 'true');
    this.sheet.classList.remove('peek', 'full');
    this.sheetState = 'hidden';
  }

  _sheetDrag() {
    const grab = $('sheet-grab');
    const sheet = this.sheet;
    let start = null;
    const mobile = () => matchMedia('(max-width: 899px) and (orientation: portrait), (max-width: 899px) and (min-height: 560px)').matches;
    const onDown = (e) => {
      if (!mobile() || this.sheetState === 'hidden') return;
      // allow dragging from the grab bar, or from the header while peeking
      const fromBody = e.currentTarget === this.sheetBody;
      if (fromBody && (this.sheetState === 'full' && this.sheetBody.scrollTop > 0)) return;
      const rect = sheet.getBoundingClientRect();
      start = { y: e.clientY, top: rect.top, t: e.timeStamp, id: e.pointerId, moved: false, fromBody };
    };
    const onMove = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.abs(dy) < 6) return;
      if (!start.moved) {
        start.moved = true;
        this._suppressClick = true; // a drag that began on a button must not also press it
        sheet.classList.add('dragging');
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      const h = sheet.offsetHeight;
      const vh = window.innerHeight;
      const top = Math.max(vh - h, start.top + dy);
      sheet.style.transform = `translateY(${top - (vh - h)}px)`;
      e.preventDefault();
    };
    const onUp = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      sheet.classList.remove('dragging');
      if (!s.moved) return;
      setTimeout(() => { this._suppressClick = false; }, 0);
      if (e.type === 'pointercancel') { this.setSheetState(this.sheetState); return; } // the browser took over (scroll)
      const dy = e.clientY - s.y;
      const v = dy / Math.max(1, e.timeStamp - s.t);
      const vh = window.innerHeight;
      if (v > 0.6 || (this.sheetState === 'peek' && dy > 90)) {
        if (this.sheetState === 'full' && dy < vh * 0.35) this.setSheetState('peek');
        else this.h.onCloseSheet();
      } else if (v < -0.4 || dy < -60) this.setSheetState('full');
      else if (dy > 60) this.setSheetState('peek');
      else this.setSheetState(this.sheetState);
    };
    for (const el of [grab, this.sheetBody]) {
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove, { passive: false });
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    }
    this.sheetBody.addEventListener('click', (e) => {
      if (this._suppressClick) { e.stopPropagation(); e.preventDefault(); this._suppressClick = false; }
    }, true);
    grab.addEventListener('click', () => this.setSheetState(this.sheetState === 'full' ? 'peek' : 'full'));
  }

  // ------------------------------------------------------------------ tour
  enterTour(r, mode) {
    this.app.classList.add('in-tour');
    this.app.classList.remove('tour-arrived');
    this.toggleSearch(false);
    this.toggleSettings(false);
    this.hideExplore();
    $('tour-hud').hidden = false;
    $('tour-mode').innerHTML = `${svgIcon(mode, { size: 16 })}${MODES[mode].label}`;
    $('tour-title').textContent = `→ ${r.name}`;
    $('tour-bar').style.width = '0%';
    $('arrival').hidden = true;
  }
  updateTour(progress, remaining) {
    $('tour-bar').style.width = `${(progress * 100).toFixed(1)}%`;
    $('tour-remaining').textContent = `残り ${formatDistance(remaining)}`;
  }
  showArrival(r, route) {
    this.app.classList.add('tour-arrived');
    $('arrival-name').textContent = r.name;
    $('arrival-meta').textContent = `${MODES[route.mode].ja} ${formatMinutes(route.time)}分 · ${formatDistance(route.distance)} · 松本駅から`;
    $('arrival').hidden = false;
    $('tour-bar').style.width = '100%';
    $('tour-remaining').textContent = 'DESTINATION';
  }
  exitTour() {
    this.app.classList.remove('in-tour', 'tour-arrived');
    $('tour-hud').hidden = true;
    $('arrival').hidden = true;
  }

  toast(msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  fade(on) { $('fade').classList.toggle('on', on); }
}
