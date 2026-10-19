// 規劃路線：起點（目前位置或搜尋）、終點（搜尋）、交通方式；類似 Apple 地圖的路線面板
import { Geolocation } from '@capacitor/geolocation'
import { api } from '../api.js'
import { icon } from '../icons.js'
import { DEMO, MODE_LABEL, setRoute, state } from '../store.js'
import { $, $$, el, esc, fmt, haptic, modal, segmented, toastError } from '../ui.js'

const HERE = { name: '目前位置', here: true }

function recent() {
  try { return JSON.parse(localStorage.getItem('recentPlaces') || '[]') } catch { return [] }
}
function remember(p) {
  if (!p || p.here) return
  const list = [p, ...recent().filter((x) => x.name !== p.name)].slice(0, 6)
  try { localStorage.setItem('recentPlaces', JSON.stringify(list)) } catch { /* ignore */ }
}

async function currentPlace() {
  const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
  return { name: '目前位置', lat: pos.coords.latitude, lon: pos.coords.longitude, here: true }
}

export function openPlanner() {
  const cur = state.route
  let from = cur.demo ? { ...HERE } : { ...cur.start }
  let to = cur.demo ? null : { ...cur.end }
  let mode = cur.mode || 'foot'
  let active = to ? null : 'to'
  let timer = null
  let seq = 0

  const content = el(`
    <div>
      <div class="list" style="margin-top:6px">
        <div class="cell" style="--sep-inset:44px">
          <span class="dot" style="background:var(--green);width:11px;height:11px"></span>
          <input type="text" class="in-from" placeholder="起點" autocomplete="off" spellcheck="false">
          <button class="nav-btn swap" aria-label="交換起訖點" style="padding:4px">${icon('arrowSwap')}</button>
        </div>
        <div class="cell" style="--sep-inset:44px">
          <span class="dot" style="background:var(--red);width:11px;height:11px"></span>
          <input type="text" class="in-to" placeholder="要去哪裡？例如 苗栗車站" autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div class="section" style="margin-top:12px"><div class="seg-mode"></div></div>
      <div class="section results" style="margin-top:16px"></div>
      <div style="position:sticky;bottom:0;padding:14px 0 4px;background:linear-gradient(transparent, var(--bg-grouped) 30%)">
        <button class="btn btn-primary btn-block go">${icon('route')}規劃路線並找出危險路口</button>
      </div>
    </div>`)
  const m = modal({ title: '規劃路線', content })
  const inFrom = $('.in-from', content)
  const inTo = $('.in-to', content)
  const results = $('.results', content)
  const go = $('.go', content)

  $('.seg-mode', content).replaceWith(segmented(
    [{ value: 'foot', label: '步行', icon: 'walk' }, { value: 'bike', label: '自行車', icon: 'bike' }, { value: 'car', label: '汽機車', icon: 'car' }],
    mode, (v) => { mode = v }))

  function sync() {
    inFrom.value = from?.name || ''
    inTo.value = to?.name || ''
    go.disabled = !(from && to)
  }

  function placeCell(p, i, kind) {
    const ic = p.here ? 'location' : p.demo ? 'route' : kind === 'recent' ? 'clock' : 'mappin'
    const color = p.here ? 'var(--blue)' : p.demo ? 'var(--green)' : kind === 'recent' ? 'var(--gray)' : 'var(--red)'
    return `<button class="cell tappable" data-k="${kind}" data-i="${i}" style="--sep-inset:58px">
      <span class="cell-icon" style="background:${color};border-radius:50%">${icon(ic)}</span>
      <span class="cell-main"><span class="cell-title" style="display:block">${esc(p.name)}</span>
      ${p.area || p.sub ? `<span class="cell-sub" style="display:block">${esc(p.area || p.sub)}</span>` : ''}</span></button>`
  }

  let lastResults = []
  function showDefaults() {
    const rec = recent()
    const items = []
    if (active === 'from') items.push(placeCell(HERE, 0, 'here'))
    items.push(placeCell({ name: DEMO.name, sub: `Demo 路線・步行 ${fmt.dist(DEMO.distance_m)}`, demo: true }, 0, 'demo'))
    results.innerHTML = `<div class="section-header">${active === 'from' ? '選擇起點' : '建議'}</div><div class="list">${items.join('')}</div>
      ${rec.length ? `<div class="section-header" style="margin-top:18px">最近</div><div class="list">${rec.map((p, i) => placeCell(p, i, 'recent')).join('')}</div>` : ''}`
  }

  async function search(q) {
    const my = ++seq
    results.innerHTML = '<div class="section-header">搜尋中…</div>'
    try {
      const near = state.route?.start
      const rows = await api(`/api/geo/search?q=${encodeURIComponent(q)}${near ? `&lat=${near.lat}&lon=${near.lon}` : ''}`, { timeout: 15000 })
      if (my !== seq) return
      lastResults = rows
      results.innerHTML = rows.length
        ? `<div class="section-header">搜尋結果</div><div class="list">${rows.map((p, i) => placeCell(p, i, 'result')).join('')}</div>`
        : '<div class="section-header">找不到這個地點，換個關鍵字試試（例如「苗栗車站」）</div>'
    } catch (e) {
      if (my === seq) results.innerHTML = `<div class="section-header" style="color:var(--red)">${esc(e.message)}</div>`
    }
  }

  function onInput(which, e) {
    active = which
    if (which === 'from') from = null
    else to = null
    go.disabled = true
    clearTimeout(timer)
    const q = e.target.value.trim()
    if (!q) return showDefaults()
    timer = setTimeout(() => search(q), 450)
  }
  inFrom.addEventListener('input', (e) => onInput('from', e))
  inTo.addEventListener('input', (e) => onInput('to', e))
  inFrom.addEventListener('focus', () => { active = 'from'; inFrom.select(); if (!inFrom.value || from) showDefaults() })
  inTo.addEventListener('focus', () => { active = 'to'; inTo.select(); if (!inTo.value || to) showDefaults() })

  $('.swap', content).addEventListener('click', () => { [from, to] = [to, from]; haptic(6); sync() })

  results.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-k]')
    if (!b) return
    const k = b.dataset.k
    if (k === 'demo') { setRoute(DEMO); m.close(); return }
    let p
    if (k === 'here') {
      try { p = await currentPlace() } catch { return toastError('無法取得目前位置，請改用搜尋') }
    } else p = k === 'recent' ? recent()[+b.dataset.i] : lastResults[+b.dataset.i]
    if (active === 'from') from = p
    else to = p
    haptic(6)
    sync()
    if (!from) { active = 'from'; inFrom.focus() } else if (!to) { active = 'to'; inTo.focus() } else { results.innerHTML = ''; document.activeElement?.blur() }
  })

  go.addEventListener('click', async () => {
    go.disabled = true
    go.innerHTML = '計算路線中…'
    try {
      if (from.here && from.lat == null) from = await currentPlace()
      const r = await api(`/api/geo/route?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}&mode=${mode}`, { timeout: 40000 })
      remember(from); remember(to)
      setRoute({
        name: `${from.name} → ${to.name}`,
        start: { name: from.name, lat: from.lat, lon: from.lon },
        end: { name: to.name, lat: to.lat, lon: to.lon },
        points: r.points, distance_m: r.distance_m, duration_s: r.duration_s, mode, demo: false,
      })
      m.close()
    } catch (e) {
      toastError(e.message)
      go.disabled = false
      go.innerHTML = `${icon('route')}規劃路線並找出危險路口`
    }
  })

  sync()
  showDefaults()
  if (active === 'to') setTimeout(() => inTo.focus(), 450)
  return m
}

export { MODE_LABEL }
