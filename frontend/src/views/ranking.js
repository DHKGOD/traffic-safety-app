// 危險路口排行：新莊區／全國，依天候與時段模式
import { api } from '../api.js'
import { icon } from '../icons.js'
import { PERIOD_HINT, PERIOD_OPTS, WEATHER_OPTS, on, setMode, state } from '../store.js'
import { $, LEVEL, disclaimer, emptyState, esc, makePage, segmented, skeletonList } from '../ui.js'

const SCOPES = [
  { value: '新莊區', label: '新莊區' },
  { value: '泰山區', label: '泰山區' },
  { value: 'all', label: '全國' },
]

export function rankingView({ openReport }) {
  const p = makePage({ title: '危險路口排行' })
  let scope = '新莊區'
  p.body.innerHTML = `
    <div class="section" style="margin-top:4px;display:flex;flex-direction:column;gap:8px">
      <div class="seg-scope"></div><div class="seg-w"></div><div class="seg-p"></div>
    </div>
    <div class="section"><div class="section-header rank-head"></div><div class="rank-list"></div></div>
    ${disclaimer()}`
  const segW = segmented(WEATHER_OPTS, state.weather, (v) => setMode({ weather: v }))
  const segP = segmented(PERIOD_OPTS, state.period, (v) => setMode({ period: v }))
  $('.seg-scope', p.el).replaceWith(segmented(SCOPES, scope, (v) => { scope = v; load() }))
  $('.seg-w', p.el).replaceWith(segW)
  $('.seg-p', p.el).replaceWith(segP)
  let rows = []

  async function load() {
    const list = $('.rank-list', p.el)
    list.innerHTML = skeletonList(8)
    $('.rank-head', p.el).textContent = `${scope === 'all' ? '全國' : '新北市' + scope}・${WEATHER_OPTS.find((o) => o.value === state.weather).label}・${PERIOD_HINT[state.period]}`
    try {
      const q = new URLSearchParams({ limit: 30, weather: state.weather, period: state.period })
      if (scope !== 'all') q.set('district', scope)
      rows = (await api(`/api/hotspots/top?${q}`)).hotspots
      list.innerHTML = rows.length ? `<div class="list">${rows.map((h, i) => `
        <button class="cell tappable hs-cell" data-id="${h.id}" style="--sep-inset:62px">
          <span class="rank ${h.level}">${i + 1}</span>
          <span class="cell-main">
            <span class="cell-title" style="display:block">${esc(h.name)}</span>
            <span class="cell-sub" style="display:block">${esc(h.district || '')}・${LEVEL[h.level].label}・受傷 ${h.injury_count} 人</span>
          </span>
          <span class="hs-count"><span class="num">${h.filtered_count}</span><small>件</small></span>
          <span class="chev">${icon('chevronRight')}</span>
        </button>`).join('')}</div>` : emptyState('checkCircle', '沒有資料')
    } catch (e) {
      list.innerHTML = emptyState('wifi', '無法連線', e.message)
    }
  }
  p.el.addEventListener('click', (e) => {
    const c = e.target.closest('.hs-cell')
    if (c) openReport(rows.find((r) => r.id === +c.dataset.id), '排行')
  })
  on((type) => {
    if (type === 'mode') { segW.setValue(state.weather); segP.setValue(state.period); if (loaded) load() }
    if (type === 'server-changed' && loaded) load()
  })
  let loaded = false
  return { el: p.el, onShow() { if (!loaded) { loaded = true; load() } } }
}
