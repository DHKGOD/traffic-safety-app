// 危險路口排行：範圍（新莊區／泰山區／全國）＋天候、時段膠囊（與地圖頁一致的 iOS 動作表）
import { api } from '../api.js'
import { icon } from '../icons.js'
import { PERIOD_HINT, PERIOD_OPTS, WEATHER_OPTS, on, setMode, state } from '../store.js'
import { $, LEVEL, actionSheet, disclaimer, emptyState, esc, makePage, segmented, skeletonList } from '../ui.js'
import { pickWeather, renderWeatherChip } from '../weather.js'

const SCOPES = [
  { value: '新莊區', label: '新莊區' },
  { value: '泰山區', label: '泰山區' },
  { value: 'all', label: '全國' },
]

export function rankingView({ openReport }) {
  const p = makePage({ title: '危險路口排行' })
  let scope = '新莊區'
  p.body.innerHTML = `
    <div class="section" style="margin-top:2px">
      <div class="seg-scope"></div>
      <div class="chips" style="margin-top:12px">
        <button class="chip" data-act="weather"></button>
        <button class="chip" data-act="period"></button>
      </div>
    </div>
    <div class="section"><div class="section-header rank-head"></div><div class="rank-list"></div></div>
    ${disclaimer()}`
  $('.seg-scope', p.el).replaceWith(segmented(SCOPES, scope, (v) => { scope = v; load() }))
  let rows = []

  function renderChips() {
    renderWeatherChip($('[data-act="weather"]', p.el))
    const pc = $('[data-act="period"]', p.el)
    pc.className = `chip${state.period !== 'all' ? ' on' : ''}`
    pc.innerHTML = `${icon(state.period === 'night' ? 'moon' : 'clock')}${PERIOD_HINT[state.period]}<span class="caret">${icon('chevronDown')}</span>`
  }

  async function load() {
    renderChips()
    const list = $('.rank-list', p.el)
    list.innerHTML = skeletonList(8)
    const w = WEATHER_OPTS.find((o) => o.value === state.weather).label
    $('.rank-head', p.el).textContent = `${scope === 'all' ? '全國' : '新北市' + scope}・${w === '全部' ? '全部天候' : w}・${PERIOD_HINT[state.period]}`
    try {
      const q = new URLSearchParams({ limit: 30, weather: state.weather, period: state.period })
      if (scope !== 'all') q.set('district', scope)
      rows = (await api(`/api/hotspots/top?${q}`)).hotspots
      list.innerHTML = rows.length ? `<div class="list">${rows.map((h, i) => `
        <button class="cell tappable hs-cell" data-id="${h.id}" style="--sep-inset:62px">
          <span class="rank ${h.level}">${i + 1}</span>
          <span class="cell-main">
            <span class="cell-title" style="display:block">${esc(h.name)}</span>
            <span class="cell-sub" style="display:block">${esc(scope === 'all' ? `${h.city || ''}${h.district || ''}` : h.district || '')}・${LEVEL[h.level].label}・受傷 ${h.injury_count} 人</span>
          </span>
          <span class="hs-count"><span class="num">${h.filtered_count}</span><small>件</small></span>
          <span class="chev">${icon('chevronRight')}</span>
        </button>`).join('')}</div>` : emptyState('checkCircle', '沒有資料')
    } catch (e) {
      list.innerHTML = emptyState('wifi', '無法連線', e.message)
    }
  }

  p.el.addEventListener('click', async (e) => {
    const c = e.target.closest('.hs-cell')
    if (c) return openReport(rows.find((r) => r.id === +c.dataset.id), '排行')
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'weather') pickWeather()
    if (act === 'period') {
      const v = await actionSheet({ title: '時段模式', value: state.period,
        options: PERIOD_OPTS.map((o) => ({ value: o.value, label: o.value === 'all' ? '全天' : `${o.label}（${PERIOD_HINT[o.value]}）` })) })
      if (v && v !== state.period) setMode({ period: v })
    }
  })
  let loaded = false
  on((type) => {
    if (type === 'mode') { renderChips(); if (loaded) load() }
    if (type === 'server-changed' && loaded) load()
  })
  renderChips()
  return { el: p.el, onShow() { if (!loaded) { loaded = true; load() } } }
}
