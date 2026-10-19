// 地圖首頁（Apple 地圖版面）：全螢幕地圖、右上角控制鈕、底部抽屜（搜尋列＋天候時段膠囊＋危險路口清單）
import { Geolocation } from '@capacitor/geolocation'
import { api } from '../api.js'
import { icon } from '../icons.js'
import { L, createMap, drawRoute, hotspotIcon, meIcon, pinIcon, reportIcon } from '../map-utils.js'
import { DEMO, MODE_LABEL, PERIOD_HINT, PERIOD_OPTS, WEATHER_OPTS, emit, on, setMode, setRoute, state } from '../store.js'
import { $, $$, LEVEL, actionSheet, disclaimer, el, emptyState, esc, fmt, haptic, skeletonList, toast, toastError } from '../ui.js'
import { guardianAvailable, guardianState, overlayAllowed, startGuardian, stopGuardian } from '../guardian.js'
import { openPlanner } from './planner.js'

const WIDE = '(min-width: 900px) and (orientation: landscape), (min-width: 1100px)'
const BUFFER = { foot: 70, bike: 60, car: 45 }
const MODE_ICON = { foot: 'walk', bike: 'bike', car: 'car' }

export function mapView({ openReport, openSubmit, startWalk }) {
  const page = el(`
    <section class="page map-page">
      <div id="map"></div>
      <div class="status-scrim"></div>
      <button class="guardian-pill" data-act="guardian" hidden>
        <span class="g-ic">${icon('shield')}</span>
        <span class="g-text"><b>守護中</b><span class="g-sub"></span></span>
      </button>
      <div class="map-fabs">
        <div class="fab-stack">
          <button class="fab" data-act="locate" aria-label="我的位置">${icon('location')}</button>
          <button class="fab" data-act="fit" aria-label="顯示整條路線">${icon('route')}</button>
        </div>
        <div class="fab-stack">
          <button class="fab" data-act="guardian" aria-label="背景守護模式">${icon('shield')}</button>
          <button class="fab" data-act="walk" aria-label="模擬行走">${icon('walk')}</button>
          <button class="fab" data-act="report" aria-label="回報差點被撞" style="color:var(--purple)">${icon('plus')}</button>
        </div>
      </div>
      <div class="sheet-clip"><div class="sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-body">
          <button class="search-field" data-act="plan">
            ${icon('search')}
            <span class="q route-q"></span>
          </button>
          <div class="chips">
            <button class="chip" data-act="weather"></button>
            <button class="chip" data-act="period"></button>
            <button class="chip" data-act="demo" hidden>${icon('route')}回到 Demo 路線</button>
          </div>
          <div class="sheet-head">
            <div class="t-title3">路線上的危險路口</div>
            <span class="pill gray conn">${icon('wifi')}連線中</span>
          </div>
          <div class="summary-row">
            <div class="mini"><span class="num s-count">–</span><span>危險路口</span></div>
            <div class="mini"><span class="num s-acc">–</span><span>歷史事故</span></div>
            <div class="mini"><span class="num s-rep">–</span><span>附近回報</span></div>
          </div>
          <div class="hs-list">${skeletonList(5)}</div>
          ${disclaimer()}
        </div>
      </div></div>
    </section>`)

  const mapEl = $('#map', page)
  const sheet = $('.sheet', page)
  let map, routeLayer, pinsLayer, hsLayer, repLayer, meMarker
  let hotspots = []
  let selected = null
  let loadSeq = 0
  const markers = new Map()

  /* ---------- 底部抽屜上方：路線與模式 ---------- */
  function renderHeader() {
    const r = state.route
    $('.route-q', page).innerHTML = `${esc(r.start.name)} → ${esc(r.end.name)} <small>・${icon(MODE_ICON[r.mode] || 'walk')} ${fmt.dist(r.distance_m)}</small>`
    const w = WEATHER_OPTS.find((o) => o.value === state.weather)
    const wc = $('[data-act="weather"]', page)
    wc.className = `chip${state.weather !== 'all' ? ' on' : ''}${state.weather === 'rain' ? ' rain' : ''}`
    wc.innerHTML = `${icon(state.weather === 'rain' ? 'rain' : 'sun')}${state.weather === 'all' ? '全部天候' : w.label}<span class="caret">${icon('chevronDown')}</span>`
    const pc = $('[data-act="period"]', page)
    pc.className = `chip${state.period !== 'all' ? ' on' : ''}`
    pc.innerHTML = `${icon(state.period === 'night' ? 'moon' : 'clock')}${PERIOD_HINT[state.period]}<span class="caret">${icon('chevronDown')}</span>`
    $('[data-act="demo"]', page).hidden = !!r.demo
  }

  /* ---------- 地圖 ---------- */
  function initMap() {
    if (map) return
    map = createMap(mapEl, { zoomSnap: 0.25 })
    hsLayer = L.layerGroup().addTo(map)
    repLayer = L.layerGroup().addTo(map)
    drawRouteLayer(false)
    // 長按地圖 → 在該位置回報
    map.on('contextmenu', (e) => { haptic(15); openSubmit({ lat: e.latlng.lat, lon: e.latlng.lng }) })
    load()
    drawReports()
  }

  function drawRouteLayer(animate = true) {
    const r = state.route
    routeLayer?.remove()
    pinsLayer?.remove()
    routeLayer = drawRoute(map, r.points)
    pinsLayer = L.layerGroup([
      L.marker([r.start.lat, r.start.lon], { icon: pinIcon('起', 'var(--green)'), zIndexOffset: 500 }),
      L.marker([r.end.lat, r.end.lon], { icon: pinIcon('終', 'var(--red)'), zIndexOffset: 500 }),
    ]).addTo(map)
    fitRoute(animate)
  }

  function fitRoute(animate = true) {
    const pad = matchMedia(WIDE).matches
      ? { paddingTopLeft: [440, 60], paddingBottomRight: [80, 60] }
      : { paddingTopLeft: [30, 60], paddingBottomRight: [70, 300] }
    map.fitBounds(routeLayer.getBounds(), { ...pad, animate, maxZoom: 17 })
  }

  /* ---------- 載入沿途危險路口 ---------- */
  async function load() {
    renderHeader()
    const my = ++loadSeq
    $('.hs-list', page).innerHTML = skeletonList(5)
    try {
      const r = state.route
      const filtered = state.weather !== 'all' || state.period !== 'all'
      const res = await api('/api/hotspots/route', {
        method: 'POST',
        timeout: 30000,
        body: { points: r.points, buffer_m: BUFFER[r.mode] || 70, weather: state.weather, period: state.period, min_accidents: filtered ? 1 : 3 },
      })
      if (my !== loadSeq) return // 已有較新的請求
      hotspots = res.hotspots.map((h, i) => ({ ...h, rank: i + 1 }))
      emit('route-hotspots', hotspots)
      renderList()
      drawHotspots()
      drawReports()
      setConn(true)
    } catch (e) {
      if (my !== loadSeq) return
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

  page.addEventListener('click', async (e) => {
    if (e.target.closest('[data-retry]')) return load()
    const cell = e.target.closest('.hs-cell')
    if (cell) {
      const h = hotspots.find((x) => x.id === +cell.dataset.id)
      if (selected?.id === h.id) openReport(h)
      else select(h, false)
      return
    }
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return
    if (act === 'plan') return openPlanner()
    if (act === 'guardian') return guardianMenu()
    if (act === 'demo') return setRoute(DEMO)
    if (act === 'weather') {
      const v = await actionSheet({ title: '天候模式', message: '依事故發生時的天候篩選危險路口', value: state.weather,
        options: [{ value: 'all', label: '全部天候' }, { value: 'clear', label: '晴天／陰天', icon: 'sun' }, { value: 'rain', label: '雨天', icon: 'rain' }] })
      if (v && v !== state.weather) setMode({ weather: v })
      return
    }
    if (act === 'period') {
      const v = await actionSheet({ title: '時段模式', message: '依事故發生的時段篩選危險路口', value: state.period,
        options: PERIOD_OPTS.map((o) => ({ value: o.value, label: o.value === 'all' ? '全天' : `${o.label}（${PERIOD_HINT[o.value]}）` })) })
      if (v && v !== state.period) setMode({ period: v })
      return
    }
    if (!map) return
    if (act === 'locate') locate()
    if (act === 'fit') fitRoute()
    if (act === 'report') { const c = map.getCenter(); openSubmit({ lat: c.lat, lon: c.lng }) }
    if (act === 'walk' && !document.querySelector('.walk-panel')) {
      map.closePopup()
      page.classList.add('walking')
      startWalk({ map, hotspots, route: state.route, onStop: () => page.classList.remove('walking') })
    }
  })

  function select(h, fromMap) {
    haptic(8)
    if (selected) markers.get(selected.id)?.setIcon(hotspotIcon(selected, selected.rank))
    selected = h
    markers.get(h.id)?.setIcon(hotspotIcon(h, h.rank, true))
    map.flyTo([h.lat, h.lon], Math.max(map.getZoom(), 17), { duration: 0.6 })
    L.popup({ offset: [0, -10], closeButton: false, autoPan: true, autoPanPaddingTopLeft: [16, 70], autoPanPaddingBottomRight: [70, 290] })
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

  /* ---------- 背景守護模式（切到 Google 地圖或滑手機時也會提醒） ---------- */
  async function guardianMenu() {
    if (!guardianAvailable()) {
      toast('背景守護需要安裝 Android App；網頁版可用「模擬行走」體驗提醒', { icon: 'shield', color: 'var(--blue)', ms: 4000 })
      return
    }
    if (guardianState.running) {
      const v = await actionSheet({ title: '背景守護中', message: guardianState.simulating ? '正在沿路線展示模擬' : '接近危險路口時會跳出通知並語音提醒',
        options: [{ value: 'stop', label: '停止守護' }] })
      if (v === 'stop') { await stopGuardian(); toast('已停止背景守護', { icon: 'shield', color: 'var(--gray)' }) }
      return
    }
    const v = await actionSheet({
      title: '背景守護模式',
      message: '開啟後可以切到 Google 地圖或其他 App，接近危險路口時會跳出通知、語音與震動提醒',
      options: [
        { value: 'gps', label: '開始守護（使用 GPS）', icon: 'shield' },
        { value: 'sim', label: '展示：沿目前路線模擬', icon: 'route' },
      ],
    })
    if (!v) return
    try {
      if (v === 'gps') await startGuardian()
      else await startGuardian({ simulate: state.route.points, simSpeed: state.route.mode === 'car' ? 14 : state.route.mode === 'bike' ? 6 : 4 })
      toast(v === 'gps' ? '背景守護已開啟，可以切到其他 App 了' : '展示模擬已開始，可以按主畫面鍵切到其他 App 觀看提醒', { icon: 'shield', color: 'var(--blue)', ms: 4500 })
      if (!(await overlayAllowed())) setTimeout(() => toast('建議到「設定」開啟靈動島懸浮提醒，在其他 App 上也看得到', { icon: 'sparkles', color: '#000', ms: 5000 }), 1500)
    } catch (e) {
      toastError(e.message || '無法開啟守護模式')
    }
  }

  function renderGuardian(g) {
    const pill = $('.guardian-pill', page)
    pill.hidden = !g.running
    $('[data-act="guardian"].fab', page)?.classList.toggle('on', !!g.running)
    if (g.running) {
      $('.g-sub', page).textContent = g.nearest ? `最近：${g.nearest}・${fmt.dist(g.nearestM)}` : (g.simulating ? '展示模擬中' : '取得位置中…')
    }
  }

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
    state.reports.slice(0, 150).forEach((r) => {
      L.marker([r.lat, r.lon], { icon: reportIcon(freshIds.has(r.id)), zIndexOffset: 400 })
        .bindPopup(`<b>${esc(r.category_label)}</b><br>${esc(r.description || '（無描述）')}<br><span style="color:var(--label-2)">${fmt.ago(r.created_at)}</span>`)
        .addTo(repLayer)
    })
    // 「附近回報」：路線範圍內的回報數
    const b = routeLayer?.getBounds().pad(0.05)
    $('.s-rep', page).textContent = b ? state.reports.filter((r) => b.contains([r.lat, r.lon])).length : '–'
  }

  /* ---------- 底部抽屜拖曳（三段：收合／一半／全開） ---------- */
  const SNAP_PEEK = 268
  let snapIdx = 0
  const snaps = () => {
    const h = sheet.getBoundingClientRect().height
    return [Math.max(0, h - SNAP_PEEK), h * 0.42, 0]
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
    if (e.target.closest('.chips')) return // 膠囊列可左右滑
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
  const endDrag = (e) => {
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
  }
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
  $('.sheet-grabber', page).addEventListener('click', () => setSnap(snapIdx === 0 ? 1 : 0))
  window.addEventListener('resize', () => setSnap(snapIdx))

  /* ---------- 訂閱全域事件 ---------- */
  on((type, payload) => {
    if (type === 'mode') { renderHeader(); if (map) load() }
    if (type === 'route' && map) { drawRouteLayer(); load(); setSnap(0) }
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
    if (type === 'guardian') renderGuardian(payload)
  })

  renderHeader()
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

export { MODE_LABEL }
