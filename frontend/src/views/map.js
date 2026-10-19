// 地圖首頁：Demo 路線、沿途危險路口、晴雨／時段模式、即時回報、底部抽屜
import { Geolocation } from '@capacitor/geolocation'
import { api } from '../api.js'
import { icon } from '../icons.js'
import { L, createMap, drawRoute, hotspotIcon, meIcon, pinIcon, reportIcon } from '../map-utils.js'
import { PERIOD_HINT, PERIOD_OPTS, WEATHER_OPTS, emit, on, setMode, state } from '../store.js'
import { $, $$, LEVEL, disclaimer, el, emptyState, esc, fmt, haptic, segmented, skeletonList, toast, toastError } from '../ui.js'
import ROUTE from '../data/demo-route.json'

const WIDE = '(min-width: 900px) and (orientation: landscape), (min-width: 1100px)'

export function mapView({ openReport, openSubmit, startWalk }) {
  const page = el(`
    <section class="page map-page">
      <div id="map"></div>
      <div class="map-top">
        <div class="route-card">
          <div class="route-glyph"><i style="background:var(--green)"></i><b></b><i style="background:var(--red)"></i></div>
          <div class="route-texts">
            <div class="from">${esc(ROUTE.start.name)}</div>
            <div class="to">${esc(ROUTE.end.name)}</div>
          </div>
          <div class="route-meta">
            <div class="num">${(ROUTE.distance_m / 1000).toFixed(1)}<small class="t-footnote c-2"> 公里</small></div>
            <div class="t-footnote c-2">步行約 ${Math.round(ROUTE.duration_s / 60)} 分</div>
          </div>
        </div>
        <div class="mode-bar">
          <div class="seg-weather"></div>
          <div class="seg-period"></div>
        </div>
      </div>
      <div class="map-fabs">
        <div class="fab-stack">
          <button class="fab" data-act="locate" aria-label="我的位置">${icon('location')}</button>
          <button class="fab" data-act="route" aria-label="顯示整條路線">${icon('route')}</button>
        </div>
        <div class="fab-stack">
          <button class="fab" data-act="walk" aria-label="模擬行走">${icon('walk')}</button>
        </div>
        <div class="fab-stack">
          <button class="fab" data-act="report" aria-label="回報差點被撞" style="color:var(--purple)">${icon('plus')}</button>
        </div>
      </div>
      <div class="sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-body">
          <div class="sheet-head">
            <div>
              <div class="t-title3"><span class="hs-title">路線上的危險路口</span></div>
              <div class="t-footnote c-2 mode-label">全部天候・全天</div>
            </div>
            <span class="pill gray conn">${icon('wifi')}連線中</span>
          </div>
          <div class="summary-row">
            <div class="mini"><span class="num s-count">–</span><span>危險路口</span></div>
            <div class="mini"><span class="num s-acc">–</span><span>歷史事故</span></div>
            <div class="mini"><span class="num s-rep">–</span><span>使用者回報</span></div>
          </div>
          <div class="hs-list">${skeletonList(5)}</div>
          ${disclaimer()}
        </div>
      </div>
    </section>`)

  const mapEl = $('#map', page)
  const sheet = $('.sheet', page)
  let map, routeLayer, hsLayer, repLayer, meMarker
  let hotspots = []
  let selected = null
  const markers = new Map()

  /* ---------- 模式切換 ---------- */
  const segW = segmented(WEATHER_OPTS, state.weather, (v) => setMode({ weather: v }))
  const segP = segmented(PERIOD_OPTS, state.period, (v) => setMode({ period: v }))
  $('.seg-weather', page).replaceWith(segW)
  $('.seg-period', page).replaceWith(segP)

  /* ---------- 地圖 ---------- */
  function initMap() {
    if (map) return
    map = createMap(mapEl, { zoomSnap: 0.25 })
    routeLayer = drawRoute(map, ROUTE.points)
    L.marker([ROUTE.start.lat, ROUTE.start.lon], { icon: pinIcon('起', 'var(--green)'), zIndexOffset: 500 }).addTo(map)
    L.marker([ROUTE.end.lat, ROUTE.end.lon], { icon: pinIcon('終', 'var(--red)'), zIndexOffset: 500 }).addTo(map)
    hsLayer = L.layerGroup().addTo(map)
    repLayer = L.layerGroup().addTo(map)
    fitRoute(false)
    // 長按地圖 → 在該位置回報
    map.on('contextmenu', (e) => { haptic(15); openSubmit({ lat: e.latlng.lat, lon: e.latlng.lng }) })
    load()
    drawReports()
  }

  function fitRoute(animate = true) {
    const pad = matchMedia(WIDE).matches
      ? { paddingTopLeft: [430, 120], paddingBottomRight: [80, 100] }
      : { paddingTopLeft: [30, 200], paddingBottomRight: [70, 240] }
    map.fitBounds(routeLayer.getBounds(), { ...pad, animate })
  }

  /* ---------- 載入沿途危險路口 ---------- */
  async function load() {
    const w = WEATHER_OPTS.find((o) => o.value === state.weather).label
    $('.mode-label', page).textContent = `${w === '全部' ? '全部天候' : w}・${PERIOD_HINT[state.period]}`
    $('.hs-list', page).innerHTML = skeletonList(5)
    try {
      const filtered = state.weather !== 'all' || state.period !== 'all'
      const r = await api('/api/hotspots/route', {
        method: 'POST',
        body: { points: ROUTE.points, buffer_m: 80, weather: state.weather, period: state.period, min_accidents: filtered ? 1 : 3 },
      })
      hotspots = r.hotspots.map((h, i) => ({ ...h, rank: i + 1 }))
      emit('route-hotspots', hotspots)
      renderList()
      drawHotspots()
      setConn(true)
    } catch (e) {
      setConn(false)
      $('.hs-list', page).innerHTML = emptyState('wifi', '無法連線到伺服器', e.message,
        '<button class="btn btn-tinted btn-small" data-retry style="margin-top:14px">重試</button>')
    }
  }

  function setConn(ok) {
    const c = $('.conn', page)
    c.className = `pill conn ${ok ? 'blue' : 'high'}`
    c.innerHTML = ok ? '<span class="live-dot"></span>即時' : `${icon('warning')}離線`
  }

  function drawHotspots() {
    hsLayer.clearLayers()
    markers.clear()
    selected = null
    hotspots.forEach((h) => {
      const m = L.marker([h.lat, h.lon], { icon: hotspotIcon(h, h.rank), zIndexOffset: h.level === 'high' ? 300 : 100 })
      m.on('click', () => select(h, true))
      m.addTo(hsLayer)
      markers.set(h.id, m)
    })
    $('.s-count', page).textContent = hotspots.length
    $('.s-acc', page).textContent = fmt.n(hotspots.reduce((s, h) => s + h.filtered_count, 0))
  }

  function renderList() {
    const list = $('.hs-list', page)
    if (!hotspots.length) {
      list.innerHTML = emptyState('checkCircle', '這個模式下沒有危險路口', '換個天候或時段看看')
      return
    }
    list.innerHTML = `<div class="list">${hotspots.map((h) => `
      <button class="cell tappable hs-cell" data-id="${h.id}" style="--sep-inset:62px">
        <span class="rank ${h.level}">${h.rank}</span>
        <span class="cell-main">
          <span class="cell-title" style="display:block">${esc(h.name)}</span>
          <span class="cell-sub" style="display:block">${LEVEL[h.level].label}・距起點 ${fmt.dist(h.along_m)}</span>
        </span>
        <span class="hs-count"><span class="num">${h.filtered_count}</span><small>件事故</small></span>
        <span class="chev">${icon('chevronRight')}</span>
      </button>`).join('')}</div>`
  }

  page.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) return load()
    const cell = e.target.closest('.hs-cell')
    if (cell) {
      const h = hotspots.find((x) => x.id === +cell.dataset.id)
      if (selected?.id === h.id) openReport(h)
      else select(h, false)
      return
    }
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act || !map) return
    if (act === 'locate') locate()
    if (act === 'route') fitRoute()
    if (act === 'report') { const c = map.getCenter(); openSubmit({ lat: c.lat, lon: c.lng }) }
    if (act === 'walk') { setSnap(0); startWalk({ map, hotspots }) }
  })

  function select(h, fromMap) {
    haptic(8)
    if (selected) markers.get(selected.id)?.setIcon(hotspotIcon(selected, selected.rank))
    selected = h
    markers.get(h.id)?.setIcon(hotspotIcon(h, h.rank, true))
    map.flyTo([h.lat, h.lon], Math.max(map.getZoom(), 17), { duration: 0.6 })
    L.popup({ offset: [0, -10], closeButton: false, autoPan: false })
      .setLatLng([h.lat, h.lon])
      .setContent(`<div style="min-width:170px"><div style="font-weight:600;font-size:15px">${esc(h.name)}</div>
        <div style="color:var(--label-2);margin:2px 0 8px">${h.filtered_count} 件事故・${LEVEL[h.level].label}</div>
        <button class="btn btn-primary btn-small btn-block" data-open="${h.id}">查看路口體檢報告</button></div>`)
      .openOn(map)
    $$('.hs-cell', page).forEach((c) => { c.style.background = +c.dataset.id === h.id ? 'var(--fill)' : '' })
    if (fromMap) $(`.hs-cell[data-id="${h.id}"]`, page)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  mapEl.addEventListener('click', (e) => {
    const id = e.target.closest('[data-open]')?.dataset.open
    if (id) openReport(hotspots.find((x) => x.id === +id))
  })

  /* ---------- 我的位置（Capacitor 原生定位；平板沒 GPS 時提示） ---------- */
  async function locate() {
    try {
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
      const ll = [p.coords.latitude, p.coords.longitude]
      if (!meMarker) meMarker = L.marker(ll, { icon: meIcon(), zIndexOffset: 1000 }).addTo(map)
      else meMarker.setLatLng(ll)
      map.flyTo(ll, 17)
    } catch {
      toastError('無法取得定位（平板可能沒有 GPS），可改用「模擬行走」')
    }
  }

  /* ---------- 使用者回報標記 ---------- */
  function drawReports(fresh = []) {
    if (!repLayer) return
    repLayer.clearLayers()
    const freshIds = new Set(fresh.map((r) => r.id))
    state.reports.slice(0, 100).forEach((r) => {
      L.marker([r.lat, r.lon], { icon: reportIcon(freshIds.has(r.id)), zIndexOffset: 400 })
        .bindPopup(`<b>${esc(r.category_label)}</b><br>${esc(r.description || '（無描述）')}<br><span style="color:var(--label-2)">${fmt.ago(r.created_at)}</span>`)
        .addTo(repLayer)
    })
    $('.s-rep', page).textContent = fmt.n(state.reports.length)
  }

  /* ---------- 底部抽屜拖曳（三段：收合／一半／全開） ---------- */
  const SNAP_PEEK = 222
  let snapIdx = 0
  const snaps = () => {
    const h = sheet.getBoundingClientRect().height
    return [h - SNAP_PEEK, h * 0.45, 0]
  }
  function setSnap(i) {
    snapIdx = i
    if (matchMedia(WIDE).matches) { sheet.style.transform = ''; return }
    sheet.style.transform = `translateY(${snaps()[i]}px)`
  }
  let drag = null
  sheet.addEventListener('pointerdown', (e) => {
    if (matchMedia(WIDE).matches) return
    const body = $('.sheet-body', page)
    if (snapIdx === 2 && e.target.closest('.sheet-body') && body.scrollTop > 0) return
    drag = { y: e.clientY, base: snaps()[snapIdx], t: Date.now(), pending: true }
  })
  window.addEventListener('pointermove', (e) => {
    if (!drag) return
    const dy = e.clientY - drag.y
    if (drag.pending) {
      if (Math.abs(dy) < 8) return
      drag.pending = false
      const body = $('.sheet-body', page)
      // 全開時往上滑 → 交給清單捲動
      if (snapIdx === 2 && dy < 0 && body.scrollHeight > body.clientHeight) { drag = null; return }
    }
    drag.moved = true
    sheet.classList.add('dragging')
    sheet.style.transform = `translateY(${Math.max(0, drag.base + dy)}px)`
  })
  window.addEventListener('pointerup', (e) => {
    if (!drag) return
    sheet.classList.remove('dragging')
    if (drag.moved) {
      const dy = e.clientY - drag.y
      const v = dy / Math.max(1, Date.now() - drag.t)
      const cur = drag.base + dy
      const s = snaps()
      let i = s.reduce((best, y, j) => (Math.abs(y - cur) < Math.abs(s[best] - cur) ? j : best), 0)
      if (v < -0.5) i = Math.min(2, snapIdx + 1)
      if (v > 0.5) i = Math.max(0, snapIdx - 1)
      setSnap(i)
      // 拖曳結束時不要觸發點擊
      sheet.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true })
    }
    drag = null
  })
  $('.sheet-grabber', page).addEventListener('click', () => setSnap(snapIdx === 0 ? 1 : 0))
  window.addEventListener('resize', () => setSnap(snapIdx))

  /* ---------- 訂閱全域事件 ---------- */
  on((type, payload) => {
    if (type === 'mode') {
      segW.setValue(state.weather)
      segP.setValue(state.period)
      if (map) load()
    }
    if (type === 'reports') {
      drawReports(payload.fresh)
      if (!payload.initial && payload.fresh.length) {
        const r = payload.fresh.at(-1)
        toast(`新回報：${r.category_label}${r.hotspot_name ? '・' + r.hotspot_name : ''}`, {
          icon: 'bubble', color: 'var(--purple)', onClick: () => map?.flyTo([r.lat, r.lon], 17),
        })
      }
    }
    if (type === 'online') setConn(payload)
    if (type === 'server-changed' && map) load()
  })

  return {
    el: page,
    onShow() {
      requestAnimationFrame(() => { initMap(); map.invalidateSize(); setSnap(snapIdx) })
    },
    get map() { return map },
    get hotspots() { return hotspots },
    reload: load,
  }
}
