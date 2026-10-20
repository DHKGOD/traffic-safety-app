// 危險路口排行：常駐範圍「附近（GPS）／全國／自訂（使用者選的地區，記在手機）」＋搜尋其他地方
import { Geolocation } from '@capacitor/geolocation'
import { api } from '../api.js'
import { icon } from '../icons.js'
import { PERIOD_HINT, PERIOD_OPTS, WEATHER_OPTS, on, routeOrDemo, setMode, state } from '../store.js'
import { $, LEVEL, actionSheet, disclaimer, emptyState, esc, fmt, makePage, modal, segmented, skeletonList } from '../ui.js'
import { pickWeather, renderWeatherChip } from '../weather.js'
import { L, createMap, meIcon } from '../map-utils.js'

const SCOPES = [
  { value: 'near', label: '附近' },
  { value: 'all', label: '全國' },
  { value: 'custom', label: '自訂' },
]
const NEAR_M = 2000
const RADII = [500, 1000, 2000, 3000, 5000] // 附近範圍可選的距離（後端上限 5 公里）
const rLabel = (r) => (r >= 1000 ? `${r / 1000} 公里` : `${r} 公尺`)

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* 不影響使用 */ } },
}

let areasCache = null
async function loadAreas() {
  areasCache ??= api('/api/hotspots/areas').catch((e) => { areasCache = null; throw e })
  return areasCache
}

/** 目前位置：有權限就用 GPS（使用者主動點「附近」時才詢問權限），否則用路線起點。 */
async function myPosition() {
  try {
    let perm = (await Geolocation.checkPermissions()).location
    if (perm === 'prompt' || perm === 'prompt-with-rationale') perm = (await Geolocation.requestPermissions()).location
    if (perm !== 'granted') throw new Error('no permission')
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 0 })
    return { lat: p.coords.latitude, lon: p.coords.longitude, gps: true }
  } catch {
    const s = routeOrDemo().start
    return { lat: s.lat, lon: s.lon, gps: false, name: s.name }
  }
}

export function rankingView({ openReport }) {
  const p = makePage({ title: '危險路口排行' })
  let scope = store.get('rankScope', 'near')
  if (!SCOPES.some((s) => s.value === scope)) scope = 'near'
  let custom = store.get('rankCustom', null)   // { city, district? }
  let searched = null                          // 搜尋結果（暫時）：{ kind:'area', city, district } 或 { kind:'place', name, lat, lon }
  p.body.innerHTML = `
    <div class="section" style="margin-top:2px">
      <button class="search-field rank-search">${icon('search')}<span class="q-ph">搜尋地區或地點</span></button>
      <div class="seg-scope" style="margin-top:12px"></div>
      <div class="chips rank-chips">
        <span class="rank-act"></span>
        <button class="chip" data-act="weather"></button>
        <button class="chip" data-act="period"></button>
      </div>
    </div>
    <div class="section"><div class="section-header rank-head"></div><div class="rank-list"></div></div>
    ${disclaimer()}`
  const seg = segmented(SCOPES, scope, (v) => { scope = v; searched = null; store.set('rankScope', v); if (v === 'custom' && !custom) pickCustom(); else load() })
  seg.classList.add('rank-seg') // replaceWith 會丟掉原本 div 的間距，改用 class
  $('.seg-scope', p.el).replaceWith(seg)
  let rows = []
  let seq = 0

  function renderChips() {
    renderWeatherChip($('[data-act="weather"]', p.el))
    const pc = $('[data-act="period"]', p.el)
    pc.className = `chip${state.period !== 'all' ? ' on' : ''}`
    pc.innerHTML = `${icon(state.period === 'night' ? 'moon' : 'clock')}${PERIOD_HINT[state.period]}<span class="caret">${icon('chevronDown')}</span>`
  }

  const areaName = (a) => `${a.city}${a.district || ''}`
  const radiusM = () => { const r = +store.get('rankRadius', NEAR_M); return RADII.includes(r) ? r : NEAR_M }
  let lastPos = null

  /* ---------- 附近範圍（類似 FB Marketplace）：選距離＋小地圖同步顯示範圍內的危險點（不顯示路名） ---------- */
  async function pickRadius() {
    let r = radiusM()
    const m = modal({ title: '附近範圍', right: '套用', onRight: (close) => { store.set('rankRadius', r); close(); load() }, content: `
      <div class="rp-wrap">
        <div class="rp-map"></div>
        <div class="rp-count"><span class="rp-num">–</span><span class="rp-text">個危險路口</span></div>
        <div class="rp-levels"></div>
        <div class="rp-seg"></div>
        <div class="t-footnote c-2 rp-where" style="text-align:center;margin-top:12px"></div>
      </div>` })
    const pos = lastPos || await myPosition()
    $('.rp-where', m.body).textContent = pos.gps ? '以目前位置為中心' : `以${pos.name || '路線起點'}為中心（未開啟定位）`
    const segEl = segmented(RADII.map((v) => ({ value: String(v), label: v >= 1000 ? `${v / 1000}km` : `${v}m` })), String(r), (v) => { r = +v; draw() })
    $('.rp-seg', m.body).replaceWith(segEl)
    const map = createMap($('.rp-map', m.body), { dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, attributionControl: false, zoomSnap: 0.1 })
    map.setView([pos.lat, pos.lon], 14)
    const circle = L.circle([pos.lat, pos.lon], { radius: r, color: '#0a84ff', weight: 2, fillColor: '#0a84ff', fillOpacity: 0.08 }).addTo(map)
    L.marker([pos.lat, pos.lon], { icon: meIcon(), interactive: false }).addTo(map)
    const dots = L.layerGroup().addTo(map)
    let all = null
    function draw() {
      circle.setRadius(r)
      map.fitBounds(circle.getBounds(), { padding: [14, 14], animate: true })
      if (!all) return // 資料還沒載入時保持「–」，避免把載入中誤顯示為零處。
      dots.clearLayers()
      const inside = all.filter((h) => h.distance_m <= r)
      inside.forEach((h) => L.circleMarker([h.lat, h.lon], {
        radius: h.level === 'high' ? 5 : 4, stroke: true, color: '#fff', weight: 1,
        fillColor: LEVEL[h.level].hex, fillOpacity: 0.95, interactive: false,
      }).addTo(dots))
      const n = (lv) => inside.filter((h) => h.level === lv).length
      $('.rp-num', m.body).textContent = inside.length
      $('.rp-levels', m.body).innerHTML = ['high', 'medium', 'low'].map((lv) =>
        `<span class="rp-lv"><i style="background:${LEVEL[lv].hex}"></i>${LEVEL[lv].label} ${n(lv)}</span>`).join('')
    }
    setTimeout(() => { map.invalidateSize(); draw() }, 420) // 等彈出動畫結束
    try {
      const q = new URLSearchParams({ lat: pos.lat.toFixed(5), lon: pos.lon.toFixed(5), radius: Math.max(...RADII), complete: true, weather: state.weather, period: state.period })
      all = (await api(`/api/hotspots/near?${q}`)).hotspots
      draw()
    } catch (e) {
      $('.rp-text', m.body).textContent = `無法載入：${e.message}`
    }
  }

  async function load() {
    renderChips()
    if (scope === 'custom' && !custom) { scope = 'near'; seg.setValue('near'); store.set('rankScope', 'near') }
    const my = ++seq
    const list = $('.rank-list', p.el)
    const act = $('.rank-act', p.el)
    list.innerHTML = skeletonList(8)
    const w = WEATHER_OPTS.find((o) => o.value === state.weather).label
    const mode = `${w === '全部' ? '全部天候' : w}・${PERIOD_HINT[state.period]}`
    const q = new URLSearchParams({ limit: 30, weather: state.weather, period: state.period })
    let head = ''
    let url = ''
    act.innerHTML = ''
    try {
      const view = searched || (scope === 'custom' ? { kind: 'area', ...custom } : { kind: scope })
      const radius = radiusM()
      // 範圍膠囊（和天候、時段同一列）：附近→距離、自訂→地區、搜尋→搜尋內容＋清除
      if (view.kind === 'near') {
        act.innerHTML = `<button class="chip on scope-chip" data-radius>${icon('location')}${rLabel(radius)}<span class="caret">${icon('chevronDown')}</span></button>`
      } else if (searched) {
        act.innerHTML = `<button class="chip on scope-chip" data-clear>${icon('search')}<span class="sc-t">${esc(searched.kind === 'area' ? searched.district || searched.city : searched.name)}</span>${icon('xmark')}</button>${searched.kind === 'area' ? `<button class="chip" data-pin>${icon('mappin')}設為常駐</button>` : ''}`
      } else if (scope === 'custom') {
        act.innerHTML = `<button class="chip on scope-chip" data-change>${icon('mappin')}<span class="sc-t">${esc(custom.district || custom.city)}</span><span class="caret">${icon('chevronDown')}</span></button>`
      }
      if (view.kind === 'near' || view.kind === 'place') {
        const pos = view.kind === 'place' ? view : await myPosition()
        if (my !== seq) return
        lastPos = pos
        const r = view.kind === 'place' ? NEAR_M : radius
        q.set('lat', pos.lat.toFixed(5)); q.set('lon', pos.lon.toFixed(5)); q.set('radius', r)
        url = `/api/hotspots/near?${q}`
        head = view.kind === 'place' ? `${view.name} ${rLabel(r)}內`
          : pos.gps ? `目前位置 ${rLabel(r)}內` : `${pos.name || '路線起點'} ${rLabel(r)}內（未開啟定位）`
      } else if (view.kind === 'area' && view.city) {
        q.set('city', view.city)
        if (view.district) q.set('district', view.district)
        url = `/api/hotspots/top?${q}`
        head = areaName(view)
      } else {
        url = `/api/hotspots/top?${q}`
        head = '全國'
      }
      $('.rank-head', p.el).textContent = `${head}・${mode}`
      const res = await api(url)
      if (my !== seq) return
      rows = res.hotspots
      // 第二行只放 2 項，避免被截斷：附近→距離＋區；地區→區（同區時改受傷人數）；全國→縣市區
      const sub = (h) => {
        const place = view.kind === 'all' ? `${h.city || ''}${h.district || ''}` : h.district || ''
        if (h.distance_m != null) return `${fmt.dist(h.distance_m)}・${place}`
        if (view.kind === 'area' && view.district) return `${LEVEL[h.level].label}・受傷 ${h.injury_count} 人`
        return `${place}・受傷 ${h.injury_count} 人`
      }
      list.innerHTML = rows.length ? `<div class="list">${rows.map((h, i) => `
        <button class="cell tappable hs-cell rank-cell" data-id="${h.id}">
          <span class="rank ${h.level}">${i + 1}</span>
          <span class="cell-main">
            <span class="cell-title">${esc(h.name)}</span>
            <span class="cell-sub">${esc(sub(h))}</span>
          </span>
          <span class="hs-count"><span class="num">${h.filtered_count}</span><small>件</small></span>
          <span class="chev">${icon('chevronRight')}</span>
        </button>`).join('')}</div>` : emptyState('checkCircle', '這個範圍沒有危險路口', '換個範圍或天候時段看看')
    } catch (e) {
      if (my === seq) list.innerHTML = emptyState('wifi', '無法連線', e.message)
    }
  }

  /* ---------- 自訂地區：先選縣市、再選行政區（或整個縣市） ---------- */
  async function pickCustom() {
    const m = modal({ title: '選擇常駐地區', content: `<div class="area-pick">${skeletonList(6)}</div>` })
    const box = $('.area-pick', m.body)
    let areas
    try { areas = await loadAreas() } catch (e) { box.innerHTML = emptyState('wifi', '無法連線', e.message); return }
    const done = (a) => {
      custom = a
      store.set('rankCustom', a)
      scope = 'custom'; searched = null
      store.set('rankScope', 'custom'); seg.setValue('custom')
      m.close()
      load()
    }
    const cities = () => {
      box.innerHTML = `<div class="section-header">縣市</div><div class="list">${areas.map((c, i) => `
        <button class="cell tappable" data-city="${i}"><span class="cell-main"><span class="cell-title">${esc(c.city)}</span></span>
          <span class="cell-value c-2">${c.hotspots} 個路口</span><span class="chev">${icon('chevronRight')}</span></button>`).join('')}</div>`
    }
    const districts = (c) => {
      box.innerHTML = `<button class="link-btn" data-back-city style="margin:4px 0 10px">${icon('chevronLeft')}所有縣市</button>
        <div class="section-header">${esc(c.city)}</div><div class="list">
        <button class="cell tappable" data-pick-city><span class="cell-main"><span class="cell-title">整個${esc(c.city)}</span></span><span class="cell-value c-2">${c.hotspots} 個路口</span></button>
        ${c.districts.map((d, i) => `<button class="cell tappable" data-dist="${i}"><span class="cell-main"><span class="cell-title">${esc(d.district)}</span></span><span class="cell-value c-2">${d.hotspots} 個路口</span></button>`).join('')}</div>`
      box.onclick = (e) => {
        if (e.target.closest('[data-back-city]')) { box.onclick = cityClick; return cities() }
        if (e.target.closest('[data-pick-city]')) return done({ city: c.city })
        const d = e.target.closest('[data-dist]')
        if (d) done({ city: c.city, district: c.districts[+d.dataset.dist].district })
      }
    }
    const cityClick = (e) => { const b = e.target.closest('[data-city]'); if (b) districts(areas[+b.dataset.city]) }
    box.onclick = cityClick
    // 已選過：直接打開那個縣市
    const cur = custom && areas.find((c) => c.city === custom.city)
    if (cur) districts(cur)
    else cities()
    // 取消時若還沒有自訂地區，退回「附近」
    m.el.querySelector('[data-close]').addEventListener('click', () => {
      if (!custom) { scope = 'near'; store.set('rankScope', 'near'); seg.setValue('near'); load() }
    })
  }

  /* ---------- 搜尋：行政區名稱即時比對＋地名搜尋（OpenStreetMap） ---------- */
  function openSearch() {
    const m = modal({ title: '搜尋地區或地點', content: `
      <div class="search-field" style="margin-bottom:12px">${icon('search')}<input class="rs-in" type="search" placeholder="例如 板橋、西屯區、台中車站" autocomplete="off" spellcheck="false" style="flex:1;min-width:0;border:0;background:none;font:inherit;color:var(--label);outline:none"></div>
      <div class="rs-results"></div>` })
    const input = $('.rs-in', m.body)
    const out = $('.rs-results', m.body)
    let areaHits = []
    let places = []
    let timer = 0
    let qseq = 0
    setTimeout(() => input.focus(), 350)
    const render = (loading) => {
      out.innerHTML = `
        ${areaHits.length ? `<div class="section-header">地區</div><div class="list">${areaHits.map((a, i) => `
          <button class="cell tappable" data-area="${i}"><span class="cell-icon" style="background:var(--blue)">${icon('building')}</span>
            <span class="cell-main"><span class="cell-title">${esc(areaName(a))}</span></span><span class="cell-value c-2">${a.hotspots} 個路口</span></button>`).join('')}</div>` : ''}
        ${places.length ? `<div class="section-header" style="margin-top:14px">地點（附近 2 公里）</div><div class="list">${places.map((x, i) => `
          <button class="cell tappable" data-place="${i}"><span class="cell-icon" style="background:var(--red)">${icon('mappin')}</span>
            <span class="cell-main"><span class="cell-title" style="display:block">${esc(x.name)}</span><span class="cell-sub" style="display:block">${esc(x.area || x.address)}</span></span></button>`).join('')}</div>` : ''}
        ${loading ? skeletonList(3) : !areaHits.length && !places.length && input.value.trim() ? emptyState('search', '找不到符合的地方') : ''}`
    }
    input.addEventListener('input', async () => {
      const q = input.value.trim().replace(/台/g, '臺')
      clearTimeout(timer)
      const my = ++qseq
      places = []
      if (!q) { areaHits = []; render(false); return }
      try {
        const areas = await loadAreas()
        if (my !== qseq) return
        areaHits = []
        for (const c of areas) {
          if (c.city.includes(q)) areaHits.push({ city: c.city, hotspots: c.hotspots })
          for (const d of c.districts) if (d.district.includes(q) || `${c.city}${d.district}`.includes(q)) areaHits.push({ city: c.city, district: d.district, hotspots: d.hotspots })
        }
        areaHits = areaHits.slice(0, 8)
      } catch { areaHits = [] }
      render(true)
      timer = setTimeout(async () => {
        try {
          const rows = await api(`/api/geo/search?q=${encodeURIComponent(input.value.trim())}`, { timeout: 15000 })
          if (my !== qseq) return
          const seen = new Set() // 同名同區的結果（例如車站的多個出口）只留一個
          places = rows.filter((x) => { const k = `${x.name}|${x.area}`; return !seen.has(k) && seen.add(k) }).slice(0, 6)
        } catch { places = [] }
        if (my === qseq) render(false)
      }, 450)
    })
    out.addEventListener('click', (e) => {
      const a = e.target.closest('[data-area]')
      const pl = e.target.closest('[data-place]')
      if (a) { const x = areaHits[+a.dataset.area]; searched = { kind: 'area', city: x.city, district: x.district } }
      else if (pl) { const x = places[+pl.dataset.place]; searched = { kind: 'place', name: x.name, lat: x.lat, lon: x.lon } }
      else return
      m.close()
      $('.rank-search .q-ph', p.el).textContent = searched.kind === 'area' ? areaName(searched) : searched.name
      $('.rank-search', p.el).classList.add('has-q')
      load()
    })
  }

  function clearSearch() {
    searched = null
    $('.rank-search .q-ph', p.el).textContent = '搜尋地區或地點'
    $('.rank-search', p.el).classList.remove('has-q')
    load()
  }

  p.el.addEventListener('click', async (e) => {
    const c = e.target.closest('.hs-cell')
    if (c) return openReport(rows.find((r) => r.id === +c.dataset.id), '排行')
    if (e.target.closest('.rank-search')) return openSearch()
    if (e.target.closest('[data-clear]')) return clearSearch()
    if (e.target.closest('[data-change]')) return pickCustom()
    if (e.target.closest('[data-radius]')) return pickRadius()
    if (e.target.closest('[data-pin]')) {
      custom = { city: searched.city, district: searched.district }
      store.set('rankCustom', custom)
      scope = 'custom'; store.set('rankScope', 'custom'); seg.setValue('custom')
      return clearSearch()
    }
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
    if (type === 'server-changed' && loaded) { areasCache = null; load() }
  })
  renderChips()
  return {
    el: p.el,
    onShow() {
      if (loaded && (scope !== 'near' || searched)) return
      loaded = true
      if (scope === 'custom' && !custom) { scope = 'near'; seg.setValue('near') }
      load()
    },
  }
}
