// 路口體檢報告頁：事故數、時段分布、主要肇因與型態、改善建議、附近回報、AI 預測、匯出
import { api } from '../api.js'
import { exportReport } from '../export.js'
import { icon } from '../icons.js'
import { L, createMap, hotspotIcon } from '../map-utils.js'
import { $, LEVEL, actionSheet, disclaimer, esc, fmt, makePage, toast, toastError } from '../ui.js'

const PALETTE = ['var(--blue)', 'var(--orange)', 'var(--purple)', 'var(--teal)', 'var(--pink)', 'var(--green)', 'var(--gray)']
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

function hbars(items, color = 'var(--blue)', total) {
  const max = Math.max(1, ...items.map((i) => i.n))
  const sum = total ?? items.reduce((s, i) => s + i.n, 0)
  return `<div class="hbars">${items.map((i, k) => `
    <div>
      <div class="hbar-label"><span>${esc(i.name)}</span><span class="num">${i.n}<span class="c-3" style="font-weight:400"> · ${Math.round((i.n / Math.max(1, sum)) * 100)}%</span></span></div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(i.n / max) * 100}%;background:${typeof color === 'function' ? color(k) : color};animation-delay:${k * 60}ms"></div></div>
    </div>`).join('')}</div>`
}

function stackBar(items) {
  const sum = items.reduce((s, i) => s + i.n, 0) || 1
  return `<div class="stack-bar">${items.map((i, k) => `<span style="flex:${i.n / sum};background:${PALETTE[k % PALETTE.length]}"></span>`).join('')}</div>
    <div class="legend">${items.map((i, k) => `<span><i class="dot" style="background:${PALETTE[k % PALETTE.length]}"></i>${esc(i.name)} ${Math.round((i.n / sum) * 100)}%</span>`).join('')}</div>`
}

export function reportView(h, { back = '地圖' } = {}) {
  const p = makePage({ title: h.name, back, largeTitle: false, right: `<button class="nav-btn" data-export aria-label="匯出報告">${icon('share')}</button>` })
  p.body.parentElement.insertAdjacentHTML('afterbegin', `
    <div class="report-hero">
      <div class="t-footnote c-2" style="font-weight:600;letter-spacing:.04em">路口體檢報告</div>
      <div class="t-title1" style="margin-top:4px">${esc(h.name)}</div>
      <div class="sub">
        <span class="pill ${h.level}">${icon('warningFill')}${LEVEL[h.level].label}</span>
        <span class="t-subhead c-2">${esc([h.city, h.district].filter(Boolean).join(' '))}</span>
      </div>
      <div class="mini-map"></div>
    </div>`)
  p.body.innerHTML = '<div class="section"><div class="skeleton" style="height:220px;border-radius:14px"></div></div>'
  let data = null

  async function load() {
    try {
      data = await api(`/api/hotspots/${h.id}/report`)
      render(data)
      loadAi()
    } catch (e) {
      p.body.innerHTML = `<div class="empty">${icon('wifi')}<div class="t-title3">讀取失敗</div><div class="t-subhead">${esc(e.message)}</div></div>`
    }
  }

  function render(d) {
    const s = d.summary
    const max = Math.max(1, ...d.hourly)
    const peak = d.hourly.indexOf(Math.max(...d.hourly))
    const wmax = Math.max(1, ...d.weekday)
    p.body.innerHTML = `
      <div class="section stat-grid">
        <div class="stat"><div class="stat-label" style="color:var(--red)">${icon('car')}事故</div><div class="stat-value">${s.accidents}<small>件</small></div></div>
        <div class="stat"><div class="stat-label" style="color:var(--orange)">${icon('person')}受傷</div><div class="stat-value">${s.injuries}<small>人</small></div></div>
        <div class="stat"><div class="stat-label" style="color:var(--blue)">${icon('rain')}雨天占比</div><div class="stat-value">${fmt.pct(s.rain_ratio)}</div></div>
        <div class="stat"><div class="stat-label" style="color:var(--indigo)">${icon('moon')}夜間占比</div><div class="stat-value">${fmt.pct(s.night_ratio)}</div></div>
      </div>

      <div class="section chart-card">
        <h4>${icon('clock')}時段分布</h4>
        <div class="hint">最常發生在 <b style="color:var(--blue)">${peak}:00–${peak + 1}:00</b></div>
        <div class="bars">${d.hourly.map((n, i) => `<div class="bar${i === peak ? ' peak' : ''}" title="${i} 時：${n} 件" style="height:${(n / max) * 100}%;animation-delay:${i * 18}ms"></div>`).join('')}</div>
        <div class="bar-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23 時</span></div>
      </div>

      <div class="section charts-2">
        <div class="chart-card">
          <h4>${icon('warning')}主要肇因</h4>
          <div class="hint">警方研判的主要肇事原因</div>
          ${hbars(d.causes, 'var(--red)', s.accidents)}
        </div>
        <div class="chart-card">
          <h4>${icon('car')}事故型態</h4>
          <div class="hint">怎麼撞的</div>
          ${hbars(d.collisions, 'var(--orange)', s.accidents)}
        </div>
      </div>

      <div class="section ai-slot"></div>

      <div class="section">
        <div class="section-header big">改善建議</div>
        <div class="card">
          ${d.advice.road_user.map((t) => `<div class="advice-item"><span style="color:var(--blue)">${icon('lightbulb')}</span><span>${esc(t)}</span></div>`).join('')}
        </div>
        ${d.advice.authority.length ? `
        <div class="section-header" style="margin-top:18px">給道路管理單位</div>
        <div class="card">
          ${d.advice.authority.map((t) => `<div class="advice-item"><span style="color:var(--teal)">${icon('building')}</span><span>${esc(t)}</span></div>`).join('')}
        </div>` : ''}
      </div>

      <div class="section charts-2">
        <div class="chart-card">
          <h4>${icon('car')}涉入車種</h4>
          ${stackBar(d.vehicles)}
        </div>
        <div class="chart-card">
          <h4>${icon('person')}當事人年齡</h4>
          ${stackBar(d.ages)}
          ${s.elderly_party_ratio >= 0.1 ? `<div class="hint" style="margin-top:10px">65 歲以上占 ${fmt.pct(s.elderly_party_ratio)}，適合用「家人模式」提醒長輩</div>` : ''}
        </div>
      </div>

      <div class="section charts-2">
        <div class="chart-card">
          <h4>${icon('sun')}天候</h4>
          ${stackBar(d.weather)}
        </div>
        <div class="chart-card">
          <h4>${icon('chart')}星期分布</h4>
          <div class="bars" style="height:80px">${d.weekday.map((n, i) => `<div class="bar" style="height:${(n / wmax) * 100}%;animation-delay:${i * 40}ms"></div>`).join('')}</div>
          <div class="bar-axis">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">最近的事故紀錄</div>
        <div class="list">
          ${d.recent_accidents.map((a) => `
            <div class="cell" style="--sep-inset:58px">
              <span class="cell-icon" style="background:${a.weather === '雨' ? 'var(--blue)' : 'var(--orange)'}">${icon(a.weather === '雨' ? 'rain' : 'car')}</span>
              <span class="cell-main"><span class="cell-title" style="display:block">${esc(a.collision || '事故')}・${esc(a.cause || '')}</span>
              <span class="cell-sub" style="display:block">${fmt.dt(a.occurred_at)}・${esc(a.weather || '')}・受傷 ${a.injuries} 人</span></span>
            </div>`).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-header">附近的使用者回報（120 公尺內）</div>
        <div class="list">
          ${d.user_reports.length ? d.user_reports.map((r) => `
            <div class="cell" style="--sep-inset:58px">
              <span class="cell-icon" style="background:var(--purple)">${icon('bubble')}</span>
              <span class="cell-main"><span class="cell-title" style="display:block">${esc(r.description || '差點被撞')}</span>
              <span class="cell-sub" style="display:block">${fmt.ago(r.created_at)}</span></span>
            </div>`).join('') : '<div class="cell"><span class="cell-sub">目前沒有回報</span></div>'}
        </div>
      </div>
      ${disclaimer(d.disclaimer)}`
  }

  /* ---------- AI 肇因情境預測（模型尚未訓練時不顯示） ---------- */
  const AI_OPTS = {
    weather: { title: '天候', options: [{ value: 'all', label: '依路口常見天候' }, { value: 'clear', label: '晴天', icon: 'sun' }, { value: 'rain', label: '雨天', icon: 'rain' }] },
    period: { title: '時段', options: [{ value: 'all', label: '依路口常見時段' }, { value: 'morning', label: '早上 6–9 點' }, { value: 'day', label: '白天 10–15 點' }, { value: 'evening', label: '傍晚 16–19 點' }, { value: 'night', label: '夜間 20–5 點' }] },
    vehicle: { title: '交通工具', options: [{ value: 'scooter', label: '騎機車' }, { value: 'car', label: '開汽車', icon: 'car' }, { value: 'bike', label: '騎自行車', icon: 'bike' }] },
    age: { title: '年齡', options: [{ value: 'young', label: '18–24 歲' }, { value: 'adult', label: '25–44 歲' }, { value: 'middle', label: '45–64 歲' }, { value: 'senior', label: '65 歲以上（長輩）' }] },
  }
  const scenario = { weather: 'all', period: 'all', vehicle: 'scooter', age: 'adult' }
  const short = (k) => {
    const o = AI_OPTS[k].options.find((x) => x.value === scenario[k])
    return k === 'weather' && scenario[k] === 'all' ? '常見天候' : k === 'period' && scenario[k] === 'all' ? '常見時段' : o.label.replace(/（.*）/, '')
  }

  async function loadAi() {
    const slot = $('.ai-slot', p.el)
    if (!slot) return
    try {
      const q = new URLSearchParams(scenario)
      const ai = await api(`/api/ai/hotspots/${h.id}/causes?${q}`)
      if (!ai?.predictions?.length) return
      const m = ai.model
      slot.innerHTML = `
        <div class="chart-card ai-card">
          <h4><span style="color:var(--purple)">${icon('sparkles')}</span>AI 情境預測</h4>
          <div class="hint">如果你在這個路口……最可能因為什麼發生事故？</div>
          <div class="chips" style="margin:12px -16px 0;padding:0 16px">
            ${Object.keys(AI_OPTS).map((k) => `<button class="chip${(k === 'weather' || k === 'period') && scenario[k] === 'all' ? '' : ' on'}" data-ai="${k}" style="${(k === 'weather' || k === 'period') && scenario[k] === 'all' ? '' : 'background:var(--purple)'}">${esc(short(k))}<span class="caret">${icon('chevronDown')}</span></button>`).join('')}
          </div>
          ${hbars(ai.predictions.map((x) => ({ name: x.cause, n: Math.round(x.probability * 100) })), (k) => (k === 0 ? 'var(--purple)' : 'color-mix(in srgb, var(--purple) 45%, transparent)'), 100).replace(/<span class="num">(\d+)<span class="c-3"[^>]*>[^<]*<\/span><\/span>/g, '<span class="num">$1%</span>')}
          ${ai.predictions[0].tip ? `<div class="advice-item" style="padding-bottom:2px"><span style="color:var(--purple)">${icon('lightbulb')}</span><span><b>最該注意：</b>${esc(ai.predictions[0].tip)}</span></div>` : ''}
          <div class="legend" style="margin-top:10px;line-height:1.5"><span>${icon('info')}模型：${esc({ hist_gradient_boosting: '梯度提升決策樹', logistic_regression: '邏輯迴歸' }[m.algorithm] || m.algorithm)}（v${esc(m.version)}），以 ${esc(m.test_range)} 測試：前 3 名猜中率 ${fmt.pct(m.metrics.top3_accuracy)}（基準 ${fmt.pct(m.baseline.top3_accuracy)}）、macro-F1 ${m.metrics.macro_f1.toFixed(2)}（基準 ${m.baseline.macro_f1.toFixed(2)}）。預測編號 #${ai.prediction_id}</span></div>
        </div>`
    } catch { /* 尚未有模型：不顯示 */ }
  }

  p.el.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-ai]')?.dataset.ai
    if (!k) return
    const v = await actionSheet({ title: `AI 情境：${AI_OPTS[k].title}`, value: scenario[k], options: AI_OPTS[k].options })
    if (v && v !== scenario[k]) {
      scenario[k] = v
      $('.ai-card', p.el)?.classList.add('loading')
      loadAi()
    }
  })

  $('[data-export]', p.el).addEventListener('click', async () => {
    if (!data) return
    try {
      const how = await exportReport(data)
      toast(how === 'shared' ? '已開啟分享' : '報告已下載')
    } catch (e) {
      if (e?.name !== 'AbortError' && !/cancel/i.test(e?.message || '')) toastError('匯出失敗：' + e.message)
    }
  })

  let mini
  return {
    el: p.el,
    onShow() {
      if (mini) return
      requestAnimationFrame(() => {
        mini = createMap($('.mini-map', p.el), { dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, attributionControl: false })
        mini.setView([h.lat, h.lon], 17)
        L.marker([h.lat, h.lon], { icon: hotspotIcon(h, '!') }).addTo(mini)
        L.circle([h.lat, h.lon], { radius: 40, color: LEVEL[h.level].hex, weight: 1, fillOpacity: 0.12 }).addTo(mini)
      })
      load()
    },
  }
}
