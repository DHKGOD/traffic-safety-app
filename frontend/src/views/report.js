// 路口體檢報告頁：事故數、什麼時候容易出事、時段分布、主要肇因與型態（前 3）、AI 預測、車種與天候、最近事故、附近回報、匯出
import { api } from '../api.js'
import { exportReport } from '../export.js'
import { elderMode } from '../family.js'
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

/** 前 3 名，拿掉「其他…」這種沒有參考價值的分類（使用者回饋：資訊越簡單越好） */
const top3 = (items) => items.filter((i) => !/^其他/.test(i.name)).slice(0, 3)

const HOUR_PART = (h) => (h <= 5 ? '深夜' : h <= 9 ? '早上通勤' : h <= 15 ? '白天' : h <= 19 ? '傍晚下班' : '晚上')

/** 用一句話說「什麼時候容易出事」，取代雨天／夜間百分比（使用者回饋：直接說明就好） */
function whenText(d) {
  const s = d.summary
  // 找事故最多的連續 2 小時
  let best = 0
  for (let i = 0; i < 24; i++) if (d.hourly[i] + d.hourly[(i + 1) % 24] > d.hourly[best] + d.hourly[(best + 1) % 24]) best = i
  const parts = [`最常在<b>${HOUR_PART(best)}（${best}–${(best + 2) % 24} 時）</b>發生事故`]
  const avg = d.weekday.reduce((a, b) => a + b, 0) / 7
  const wmax = Math.max(...d.weekday)
  if (avg > 0 && wmax >= avg * 1.35) parts.push(`<b>星期${WEEK[d.weekday.indexOf(wmax)]}</b>較多`)
  // 天候一定說：晴天或雨天（使用者要求）。優先用 AI 任務 2 的測站雨量校正結果（和同一區預期比，經檢定）；
  // 沒有校正資料時才退回天候欄的舊判斷（台灣整體約一成事故在雨天）
  const extra = []
  // level 是「和同一區比」的相對結果；事故少於 8 件的不檢定（rain_risk.py 的 MIN_N），要說證據不足
  const rr = d.rain_risk
  if (rr && rr.accidents < 8) extra.push('事故還不多，看不出和<b>晴天、雨天</b>的關係')
  else if (rr?.level === 'rain_high') extra.push('<b>雨天</b>出事比附近多，下雨要特別小心')
  else if (rr?.level === 'rain_low') extra.push('<b>雨天</b>出事反而比附近少')
  else if (rr?.level === 'normal') extra.push('<b>晴天、雨天</b>都會發生，雨天沒有比附近多')
  else if (s.rain_ratio >= 0.2) extra.push('<b>雨天</b>特別容易出事，下雨要特別小心')
  else if (s.rain_ratio >= 0.1) extra.push('<b>晴天、雨天</b>都常發生')
  else extra.push('大多發生在<b>晴天</b>')
  if (s.night_ratio >= 0.35 && HOUR_PART(best) !== '晚上' && HOUR_PART(best) !== '深夜') extra.push('<b>晚上</b>也常發生，注意照明與視線')
  return `這裡${parts.join('，')}${extra.length ? '；' + extra.join('；') : ''}。`
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
    p.body.innerHTML = `
      <div class="section stat-grid" style="grid-template-columns:repeat(2,1fr)">
        <div class="stat"><div class="stat-label" style="color:var(--red)">${icon('car')}事故</div><div class="stat-value">${s.accidents}<small>件</small></div></div>
        <div class="stat"><div class="stat-label" style="color:var(--orange)">${icon('person')}受傷</div><div class="stat-value">${s.injuries}<small>人</small></div></div>
      </div>
      <div class="section">
        <div class="card when-card">
          <div class="stat-label" style="color:var(--indigo)">${icon('clock')}什麼時候容易出事</div>
          <div class="when-text">${whenText(d)}</div>
        </div>
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
          <div class="hint">警方研判的主要肇事原因（前 3 名）</div>
          ${hbars(top3(d.causes), 'var(--red)', s.accidents)}
        </div>
        <div class="chart-card">
          <h4>${icon('car')}事故型態</h4>
          <div class="hint">怎麼撞的（前 3 名）</div>
          ${hbars(top3(d.collisions), 'var(--orange)', s.accidents)}
        </div>
      </div>

      <div class="section ai-slot"></div>

      <div class="section charts-2">
        <div class="chart-card">
          <h4>${icon('car')}涉入車種</h4>
          ${stackBar(d.vehicles)}
        </div>
        <div class="chart-card">
          <h4>${icon('sun')}天候</h4>
          ${stackBar(d.weather)}
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
  const scenario = { weather: 'all', period: 'all', vehicle: 'scooter', age: elderMode() ? 'senior' : 'adult' } // 長輩模式預設 65 歲以上
  const AI_SHOWN = ['vehicle', 'weather'] // 畫面上只給這兩個選項；時段用路口常見時段，年齡跟長輩模式
  const short = (k) => {
    const o = AI_OPTS[k].options.find((x) => x.value === scenario[k])
    return k === 'weather' && scenario[k] === 'all' ? '常見天候' : k === 'period' && scenario[k] === 'all' ? '常見時段' : o.label.replace(/（.*）/, '').replace(' 6–9 點', '')
  }

  async function loadAi() {
    const slot = $('.ai-slot', p.el)
    if (!slot) return
    try {
      const q = new URLSearchParams(scenario)
      const ai = await api(`/api/ai/hotspots/${h.id}/causes?${q}`)
      if (!ai?.predictions?.length) return
      // 精簡版（使用者回饋）：只有「交通工具」「天候」兩個選項、結果只列前 3 名、不顯示模型細節。
      // 每次預測仍寫入 prediction 表（含模型版本），編號放在 data-pid 供回查，不顯示在畫面上。
      const top = ai.predictions.slice(0, 3)
      const pct = (x) => `${Math.round(x.probability * 100)}%`
      slot.innerHTML = `
        <div class="chart-card ai-card" data-pid="${ai.prediction_id}" data-age="${esc(scenario.age)}">
          <h4><span style="color:var(--purple)">${icon('sparkles')}</span>AI 預測：最可能的事故原因</h4>
          <div class="chips ai-chips">
            ${AI_SHOWN.map((k) => `<button class="chip on" data-ai="${k}">${esc(short(k))}<span class="caret">${icon('chevronDown')}</span></button>`).join('')}
            ${scenario.age === 'senior' ? '<span class="ai-tag">長輩</span>' : ''}
          </div>
          <div class="ai-top">
            <span class="ai-rank">1</span>
            <span class="ai-top-main"><b class="ai-cause">${esc(top[0].cause)}</b>${top[0].tip ? `<span class="ai-tip">${esc(top[0].tip)}</span>` : ''}</span>
            <span class="ai-pct">${pct(top[0])}</span>
          </div>
          ${top.slice(1).map((x, i) => `
            <div class="ai-row"><span class="ai-rank sm">${i + 2}</span><span class="ai-cause">${esc(x.cause)}</span><span class="ai-pct sm">${pct(x)}</span></div>`).join('')}
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
