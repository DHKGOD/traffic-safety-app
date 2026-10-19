// 後台：資料筆數、資料表關係、各月事故件數（證明資料都在資料庫裡）
import { api } from '../api.js'
import { icon } from '../icons.js'
import { $, esc, fmt, makePage } from '../ui.js'

const COLORS = { accident: 'var(--red)', party: 'var(--orange)', hotspot: 'var(--pink)', cause_code: 'var(--teal)', collision_type: 'var(--teal)',
  import_batch: 'var(--gray)', user_report: 'var(--purple)', model_version: 'var(--indigo)', prediction: 'var(--indigo)' }

export function adminView() {
  const p = makePage({ title: '後台', back: '設定' })
  p.body.innerHTML = '<div class="section"><div class="skeleton" style="height:300px;border-radius:14px"></div></div>'
  async function load() {
    try {
      const s = await api('/api/admin/stats')
      const max = Math.max(1, ...s.monthly.map((m) => m.n))
      const acc = s.tables.find((t) => t.table === 'accident').rows
      const party = s.tables.find((t) => t.table === 'party').rows
      p.body.innerHTML = `
        <div class="section stat-grid">
          <div class="stat"><div class="stat-label" style="color:var(--red)">${icon('car')}事故件數</div><div class="stat-value">${fmt.n(acc)}</div></div>
          <div class="stat"><div class="stat-label" style="color:var(--orange)">${icon('person')}當事人列數</div><div class="stat-value">${fmt.n(party)}</div></div>
        </div>
        <div class="section">
          <div class="section-header">資料表筆數（即時以 SQL count(*) 查詢）</div>
          <div class="list">${s.tables.map((t) => `
            <div class="cell" style="--sep-inset:58px">
              <span class="cell-icon" style="background:${COLORS[t.table] || 'var(--gray)'}">${icon('database')}</span>
              <span class="cell-main"><span class="cell-title" style="display:block">${esc(t.label)}</span><span class="cell-sub" style="display:block;font-family:ui-monospace,monospace">${esc(t.table)}</span></span>
              <span class="cell-value num">${fmt.n(t.rows)}</span>
            </div>`).join('')}</div>
          <div class="section-footer">空間查詢：${s.postgis ? 'PostGIS' : '一般 SQL（haversine）替代查詢'}</div>
        </div>
        <div class="section chart-card">
          <h4>${icon('chart')}各月事故件數</h4>
          <div class="bars" style="height:110px">${s.monthly.map((m, i) => `<div class="bar" style="height:${(m.n / max) * 100}%;animation-delay:${i * 40}ms" title="${m.label}：${m.n}"></div>`).join('')}</div>
          <div class="bar-axis">${s.monthly.map((m) => `<span>${m.label.split('/')[1]}</span>`).join('')}</div>
        </div>
        <div class="section chart-card">
          <h4>${icon('layers')}資料表關係（外鍵）</h4>
          <div class="er">${s.relations.map((r) => `
            <div class="er-row"><code>${esc(r.child)}.${esc(r.column)}</code><span class="arrow">${icon('chevronRight')}</span><code>${esc(r.parent)}</code></div>`).join('')}</div>
          <div class="hint" style="margin-top:12px">一件事故（accident）有多位當事人（party）；事故對應到危險路口（hotspot）、主要肇因（cause_code）與事故型態（collision_type）。</div>
        </div>
        <div class="section-footer">${esc(s.data_source)}</div>`
    } catch (e) {
      p.body.innerHTML = `<div class="empty">${icon('wifi')}<div class="t-title3">讀取失敗</div><div>${esc(e.message)}</div></div>`
    }
  }
  return { el: p.el, onShow: load }
}
