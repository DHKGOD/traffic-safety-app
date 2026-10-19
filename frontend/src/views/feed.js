// 即時回報動態：所有裝置的回報，每 5 秒更新
import { icon } from '../icons.js'
import { on, state } from '../store.js'
import { $, emptyState, esc, fmt, makePage } from '../ui.js'

const CAT = { near_miss: ['var(--red)', 'hand'], hazard: ['var(--orange)', 'cone'], other: ['var(--gray)', 'ellipsis'] }

export function feedView({ openSubmit, getCenter, focusReport }) {
  const p = makePage({ title: '即時回報', right: `<button class="nav-btn" data-new aria-label="新增回報">${icon('plusCircle')}</button>` })
  p.body.innerHTML = `
    <div class="section" style="margin-top:4px">
      <div class="card" style="display:flex;gap:14px;align-items:center">
        <span class="cell-icon" style="background:var(--purple);width:44px;height:44px;border-radius:12px;font-size:24px">${icon('bubble')}</span>
        <div style="flex:1">
          <div class="t-headline">差點被撞了嗎？</div>
          <div class="t-subhead c-2">回報後會存進資料庫，其他手機與電腦即時看到</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" data-new style="margin-top:12px">${icon('plus')}新增回報</button>
    </div>
    <div class="section">
      <div class="section-header" style="display:flex;align-items:center;gap:8px"><span class="live-dot"></span><span class="feed-status">即時更新中</span></div>
      <div class="feed-list"></div>
    </div>`

  function render(freshIds = new Set()) {
    const list = $('.feed-list', p.el)
    if (!state.reports.length) {
      list.innerHTML = `<div class="list">${emptyState('bubble', '還沒有回報', '成為第一個回報的人')}</div>`
      return
    }
    list.innerHTML = `<div class="list">${state.reports.map((r) => {
      const [color, ic] = CAT[r.category] || CAT.other
      return `
      <button class="cell tappable${freshIds.has(r.id) ? ' feed-new' : ''}" data-id="${r.id}" style="--sep-inset:58px">
        <span class="cell-icon" style="background:${color}">${icon(ic)}</span>
        <span class="cell-main">
          <span class="cell-title" style="display:block">${esc(r.description || r.category_label)}</span>
          <span class="cell-sub" style="display:block">${esc(r.category_label)}${r.hotspot_name ? `・${esc(r.hotspot_name)}` : ''}・#${r.id}</span>
        </span>
        <span class="feed-time">${fmt.ago(r.created_at)}</span>
      </button>`
    }).join('')}</div>`
  }

  p.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) openSubmit(getCenter())
    const c = e.target.closest('.cell[data-id]')
    if (c) focusReport(state.reports.find((r) => r.id === +c.dataset.id))
  })

  on((type, payload) => {
    if (type === 'reports') render(new Set(payload.fresh.map((r) => r.id)))
    if (type === 'online') $('.feed-status', p.el).textContent = payload ? '即時更新中' : '離線，稍後自動重試'
  })
  render()
  // 每 30 秒刷新「幾分鐘前」
  setInterval(() => { if (p.el.isConnected) render() }, 30000)
  return { el: p.el }
}
