// 地圖首頁（Apple 地圖版面）：全螢幕地圖、右上角控制鈕、底部抽屜（搜尋列＋天候時段膠囊＋危險路口清單）
import { Geolocation } from '@capacitor/geolocation'
import { api } from '../api.js'
import { icon } from '../icons.js'
import { L, createMap, drawRoute, hotspotIcon, meIcon, pinIcon, reportIcon, routeBubble } from '../map-utils.js'
import { DEMO, MODE_LABEL, PERIOD_HINT, PERIOD_OPTS, emit, on, setMode, setRoute, state } from '../store.js'
import { live, pickWeather } from '../weather.js'
import { $, $$, LEVEL, actionSheet, disclaimer, el, emptyState, esc, fmt, haptic, skeletonList, toast, toastError } from '../ui.js'
import { guardianAvailable, guardianState, openNavigation, overlayAllowed, startGuardian, stopGuardian } from '../guardian.js'
import { openPlanner } from './planner.js'

const WIDE = '(min-width: 900px) and (orientation: landscape), (min-width: 1100px)'
const BUFFER = { foot: 70, bike: 60, car: 45 }
const MODE_ICON = { foot: 'walk', bike: 'bike', car: 'car' }
const MODE_MPS = { foot: 1.25, bike: 4.5, car: 9 } // 沒有路線時間時用一般速度估算

/** 路線所需時間（「28 分鐘」「1 小時 12 分」）。 */
function routeTime(r) {
  const s = r.duration_s || r.distance_m / (MODE_MPS[r.mode] || 1.25)
  const m = Math.max(1, Math.round(s / 60))
  return m < 60 ? `${m} 分鐘` : `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}`
}

/** 路線長度一半的位置（放時間泡泡）。 */
function midpoint(points) {
  const d = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180))
  const total = points.slice(1).reduce((s, p, i) => s + d(points[i], p), 0)
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const seg = d(points[i - 1], points[i])
    if (acc + seg >= total / 2) {
      const t = seg ? (total / 2 - acc) / seg : 0
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t]
    }
    acc += seg
  }
  return points[0]
}

export function mapView({ openReport, openSubmit, startWalk }) {
  const page = el(`
    <section class="page map-page">
      <div id="map"></div>
      <div class="status-scrim"></div>
      <!-- Apple 地圖風格：左上天氣膠囊；抽屜上方左圓鈕、右直式膠囊（跟著抽屜移動） -->
      <button class="wx-pill" data-act="weather" aria-label="天候模式"></button>
      <button class="guardian-pill" data-act="guardian" hidden>
        <span class="g-ic">${icon('shield')}</span>
        <span class="g-text"><b>守護中</b><span class="g-sub"></span></span>
      </button>
      <div class="sheet-clip"><div class="sheet">
        <div class="sheet-ctrls">
          <div class="map-brand" aria-label="有路安"><span class="mb-t">有路安</span></div>
          <div class="fab-capsule">
            <button class="fab" data-act="fit" aria-label="顯示整條路線">${icon('map')}</button>
            <button class="fab" data-act="locate" aria-label="我的位置">${icon('location')}</button>
            <button class="fab fab-guard" data-act="guardian" aria-label="背景守護模式">${icon('shield')}</button>
          </div>
        </div>
        <div class="sheet-grabber"></div>
        <div class="sheet-body">
          <button class="search-field ap-search" data-act="plan">
            ${icon('search')}<span class="q route-q"></span><span class="ap-mode"></span><span class="ap-clear" data-act="explore" role="button" aria-label="清除路線，自由瀏覽">${icon('xmark')}</span>
          </button>
          <div class="ap-sec sec-sum">路線摘要</div>
          <div class="ap-card">
            <span class="ap-card-ic">${icon('warningFill')}</span>
            <span class="ap-card-main">
              <span class="ap-card-t"><b class="s-count">–</b> 個危險路口<span class="conn-wrap"><span class="pill conn high" hidden>${icon('warning')}離線</span></span></span>
              <span class="ap-card-s">事故 <b class="s-acc">–</b> 件・回報 <b class="s-rep">–</b> 則</span>
              <span class="ap-card-note">依 115 年 1–10 月官方事故統計</span>
            </span>
            <button class="ap-more" data-act="more" aria-label="更多">${icon('ellipsis')}</button>
          </div>
          <div class="ap-sec">快捷</div>
          <div class="ap-quick">
            <button data-act="walk"><span class="qi" style="background:var(--blue)">${icon('walk')}</span><b>模擬行走</b><small class="q-walk">沿路線</small></button>
            <button data-act="guardian"><span class="qi" style="background:var(--teal)">${icon('shield')}</span><b>背景守護</b><small class="q-guard">未開啟</small></button>
            <button data-act="report"><span class="qi" style="background:var(--purple)">${icon('plus')}</span><b>回報</b><small>差點被撞</small></button>
            <button data-act="period"><span class="qi" style="background:var(--orange)">${icon('clock')}</span><b>時段</b><small class="q-period">全天</small></button>
          </div>
          <div class="ap-sec sheet-head"><span class="sec-list">路線上的危險路口</span><span class="head-count"></span><button class="link-btn" data-act="demo" hidden>回到 Demo 路線</button></div>
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
  let skipMove = false // 探索模式：點選路口造成的地圖移動不重新查詢
  const markers = new Map()

  /* ---------- 底部抽屜上方：路線與模式 ---------- */
  function renderHeader() {
    const r = state.route
    page.classList.toggle('exploring', !r)
    if (r) {
      $('.route-q', page).innerHTML = `${esc(r.start.name)} → ${esc(r.end.name)}`
      $('.ap-mode', page).innerHTML = `${icon(MODE_ICON[r.mode] || 'walk')}${fmt.dist(r.distance_m)}`
    } else {
      $('.route-q', page).innerHTML = '<span class="c-2">搜尋地點或規劃路線</span>'
      $('.ap-mode', page).innerHTML = ''
    }
    $('.sec-sum', page).textContent = r ? '路線摘要' : '這個範圍'
    $('.sec-list', page).textContent = r ? '路線上的危險路口' : '地圖範圍內的危險路口'
    $('.q-walk', page).textContent = r ? '沿路線' : '需要路線'
    renderWeatherPill()
    $('.q-period', page).textContent = PERIOD_HINT[state.period]
    $('[data-act="period"] .qi', page).innerHTML = icon(state.period === 'night' ? 'moon' : 'clock')
    $('[data-act="demo"]', page).hidden = !r || !!r.demo
  }

  /* 左上天氣膠囊（Apple 地圖風格）：氣溫＋天氣；篩選模式不是「全部」時多一個標籤 */
  function renderWeatherPill() {
    const d = live.data
    const w = state.weather
    const rainy = d?.raining || /雨/.test(d?.forecast?.weather || '')
    const ic = rainy || w === 'rain' ? 'rain' : 'sun'
    const temp = d?.temperature != null ? `${Math.round(d.temperature)}°` : d?.forecast?.weather || '天氣'
    const tag = state.weatherAuto ? `自動・${w === 'rain' ? '雨天' : '晴天'}` : w === 'rain' ? '雨天模式' : w === 'clear' ? '晴天模式' : ''
    const pill = $('.wx-pill', page)
    pill.className = `wx-pill${rainy ? ' rainy' : ''}${w !== 'all' ? ' filtered on' : ''}${w === 'rain' ? ' rain' : ''}`
    pill.innerHTML = `<span class="wx-ic">${icon(ic)}</span><span class="wx-t">${esc(temp)}</span>${tag ? `<span class="wx-tag">${esc(tag)}</span>` : ''}`
  }

  /* ---------- 地圖 ---------- */
  function initMap() {
    if (map) return
    map = createMap(mapEl, { zoomSnap: 0.25 })
    hsLayer = L.layerGroup().addTo(map)
    repLayer = L.layerGroup().addTo(map)
    // 地圖拉遠時危險點縮成小圓點（像 Apple 地圖），拉近才顯示完整圖示，避免擠成一團
    const zoomClass = () => mapEl.classList.toggle('far', map.getZoom() < 15.5)
    map.on('zoomend', zoomClass)
    zoomClass()
    drawRouteLayer(false)
    // 探索模式：移動或縮放地圖後，重新載入範圍內的危險路口（停下來 0.4 秒後才查，避免一直發請求）
    let moveTimer = 0
    map.on('moveend', () => {
      if (state.route || page.classList.contains('walking')) return
      const c = map.getCenter()
      try { localStorage.setItem('exploreView', JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })) } catch { /* 不影響 */ }
      if (skipMove) { skipMove = false; return } // 點選路口時地圖移過去，不要重新整理清單
      clearTimeout(moveTimer)
      moveTimer = setTimeout(load, 400)
    })
    // 長按地圖 → 在該位置回報
    map.on('contextmenu', (e) => { haptic(15); openSubmit({ lat: e.latlng.lat, lon: e.latlng.lng }) })
    load()
    drawReports()
  }

  function drawRouteLayer(animate = true) {
    const r = state.route
    routeLayer?.remove()
    pinsLayer?.remove()
    routeLayer = pinsLayer = null
    if (!r) {
      // 探索模式：地圖停在原處；剛打開 App 還沒有視野時，回到上次瀏覽的位置（沒有就用 Demo 起點附近）
      if (!map._loaded) {
        let v = null
        try { v = JSON.parse(localStorage.getItem('exploreView') || 'null') } catch { /* 用預設 */ }
        if (v?.lat && v?.lon) map.setView([v.lat, v.lon], v.zoom || 15, { animate: false })
        else map.setView([DEMO.start.lat, DEMO.start.lon], 15, { animate: false })
      }
      return
    }
    routeLayer = drawRoute(map, r.points)
    pinsLayer = L.layerGroup([
      L.marker([r.start.lat, r.start.lon], { icon: pinIcon('start'), zIndexOffset: 500, interactive: false }),
      L.marker([r.end.lat, r.end.lon], { icon: pinIcon('end'), zIndexOffset: 500, interactive: false }),
      L.marker(midpoint(r.points), { icon: routeBubble(routeTime(r)), zIndexOffset: -200, interactive: false }),
    ]).addTo(map)
    fitRoute(animate)
  }

  function fitRoute(animate = true) {
    // 下方留白＝抽屜目前蓋住的高度（手機尺寸不同，不寫死）；右邊留給直式膠囊，終點不被蓋住
    // （用抽屜的目標段位計算，不用目前位置：抽屜可能正在滑動動畫中）
    const mapH = mapEl.getBoundingClientRect().height
    const visible = sheet.getBoundingClientRect().height - snaps()[snapIdx] + (mapH - sheet.parentElement.getBoundingClientRect().height) + 8
    const bottom = visible > 60 && visible < mapH - 120 ? Math.round(visible + 20) : Math.round(mapH * 0.45)
    const pad = matchMedia(WIDE).matches
      ? { paddingTopLeft: [440, 60], paddingBottomRight: [80, 60] }
      : { paddingTopLeft: [30, 76], paddingBottomRight: [74, bottom] }
    if (routeLayer) map.fitBounds(routeLayer.getBounds(), { ...pad, animate, maxZoom: 17 })
  }

  /** 探索模式查詢範圍：地圖中心、到角落的距離（最多 5 公里）；太遠時不查，請使用者放大。 */
  const EXPLORE_MIN_ZOOM = 12.5
  function exploreQuery() {
    const c = map.getCenter()
    const radius = Math.round(Math.min(5000, Math.max(300, map.distance(c, map.getBounds().getNorthEast()))))
    return { lat: c.lat, lon: c.lng, radius, tooFar: map.getZoom() < EXPLORE_MIN_ZOOM }
  }

  /* ---------- 載入沿途危險路口 ---------- */
  async function load() {
    renderHeader()
    const my = ++loadSeq
    $('.hs-list', page).innerHTML = skeletonList(5)
    try {
      const r = state.route
      let res
      if (r) {
        const filtered = state.weather !== 'all' || state.period !== 'all'
        res = await api('/api/hotspots/route', {
          method: 'POST',
          timeout: 30000,
          body: { points: r.points, buffer_m: BUFFER[r.mode] || 70, weather: state.weather, period: state.period, min_accidents: filtered ? 1 : 3 },
        })
      } else {
        // 探索模式：地圖範圍內事故最多的路口（最多 120 處，避免標記太密）
        if (!map) return
        const q = exploreQuery()
        if (q.tooFar) {
          hotspots = []
          drawHotspots()
          $('.hs-list', page).innerHTML = emptyState('search', '放大地圖看危險路口', '範圍太大時不顯示，拉近到街區就會出現')
          return
        }
        const qs = new URLSearchParams({ lat: q.lat.toFixed(5), lon: q.lon.toFixed(5), radius: q.radius, weather: state.weather, period: state.period, limit: 120 })
        res = await api(`/api/hotspots/near?${qs}`, { timeout: 30000 })
      }
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
    // 只在連不上伺服器時提示；事故資料是歷史統計，不標「即時」以免誤會成即時路況
    const c = $('.conn', page)
    c.hidden = ok
    c.className = 'pill conn high'
    c.innerHTML = `${icon('warning')}離線`
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
    $('.head-count', page).textContent = hotspots.length
    $('.s-acc', page).textContent = fmt.n(hotspots.reduce((s, h) => s + h.filtered_count, 0))
  }

  function renderList() {
    const list = $('.hs-list', page)
    if (!hotspots.length) {
      list.innerHTML = state.route ? emptyState('checkCircle', '這個模式下沒有危險路口', '換個天候或時段看看') : emptyState('checkCircle', '這個範圍沒有危險路口', '移動地圖看看其他地方')
      return
    }
    list.innerHTML = `<div class="list">${hotspots.map((h) => `
      <button class="cell tappable hs-cell" data-id="${h.id}" style="--sep-inset:62px">
        <span class="rank ${h.level}">${h.rank}</span>
        <span class="cell-main">
          <span class="cell-title" style="display:block">${esc(h.name)}</span>
          <span class="cell-sub" style="display:block">${LEVEL[h.level].label}・${state.route ? `距起點 ${fmt.dist(h.along_m)}` : esc(h.district || '')}</span>
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
    if (act === 'explore') { setRoute(null); toast('已清除路線：移動地圖看範圍內的危險路口', { icon: 'map', color: 'var(--blue)', ms: 3000 }); return }
    if (act === 'weather') return pickWeather()
    if (act === 'more') {
      const r = state.route
      const v = await actionSheet({ title: r ? `${r.start.name} → ${r.end.name}` : '探索模式', options: r ? [
        { value: 'plan', label: '更改路線', icon: 'route' },
        { value: 'fit', label: '顯示整條路線', icon: 'map' },
        { value: 'explore', label: '清除路線，自由瀏覽', icon: 'xmark' },
        ...(r.demo ? [] : [{ value: 'demo', label: '回到 Demo 路線', icon: 'refresh' }]),
      ] : [
        { value: 'plan', label: '規劃路線', icon: 'route' },
        { value: 'demo', label: 'Demo 路線（輔大 → 新莊捷運站）', icon: 'refresh' },
      ] })
      if (v === 'plan') openPlanner()
      if (v === 'fit' && map) fitRoute()
      if (v === 'explore') setRoute(null)
      if (v === 'demo') setRoute(DEMO)
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
    if (act === 'fit') { if (state.route) fitRoute(); else locate() }
    if (act === 'report') { const c = map.getCenter(); openSubmit({ lat: c.lat, lon: c.lng }) }
    if (act === 'walk' && !document.querySelector('.walk-panel')) {
      if (!state.route) { toast('先規劃路線，才能沿路線模擬行走', { icon: 'walk', color: 'var(--blue)' }); return openPlanner() }
      beginWalk()
    }
  })

  /** 把某個點移到「抽屜上方可見範圍」的中間（地圖正中央常被浮動抽屜蓋住）。 */
  function focusPoint(ll, zoom) {
    const size = map.getSize()
    let visibleBottom = size.y
    if (!matchMedia(WIDE).matches) {
      const top = sheet.getBoundingClientRect().top - mapEl.getBoundingClientRect().top
      if (top > 120 && top < size.y) visibleBottom = top
    }
    const dy = size.y / 2 - visibleBottom / 2 // 往下推移中心，讓點出現在可見範圍中間
    if (!state.route) skipMove = true
    const target = map.unproject(map.project(ll, zoom).add([0, dy]), zoom)
    map.flyTo(target, zoom, { duration: 0.6 })
  }

  /** 開始模擬行走；speed 為初始倍速（開發者選項用）。出錯時一定還原畫面，不會卡在「行走中」。 */
  function beginWalk(speed) {
    if (!map || document.querySelector('.walk-panel')) return
    try { map.closePopup() } catch { /* 地圖動畫中偶爾會丟例外，不影響 */ }
    page.classList.add('walking')
    try {
      startWalk({ map, hotspots, route: state.route, speed, onStop: () => page.classList.remove('walking') })
    } catch (e) {
      page.classList.remove('walking')
      document.querySelector('.walk-panel')?.remove()
      toastError(`模擬行走無法開始：${e.message}`)
    }
  }

  function select(h, fromMap) {
    haptic(8)
    if (selected) markers.get(selected.id)?.setIcon(hotspotIcon(selected, selected.rank))
    selected = h
    markers.get(h.id)?.setIcon(hotspotIcon(h, h.rank, true))
    focusPoint([h.lat, h.lon], Math.max(map.getZoom(), 17))
    L.popup({ offset: [0, -10], closeButton: false, autoPan: true, autoPanPaddingTopLeft: [16, 80], autoPanPaddingBottomRight: [16, 380] })
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
      message: '開啟後可以切到 Google 地圖或其他 App：畫面邊緣會有護航小圖示，接近危險路口時跳出提醒、語音與震動',
      // 探索模式沒有路線：只能用 GPS 守護（導航護航與展示模擬都需要路線）
      options: state.route ? [
        { value: 'nav', label: `導航護航（開 Google 地圖到${state.route.end.name}）`, icon: 'route' },
        { value: 'gps', label: '開始守護（使用 GPS）', icon: 'shield' },
        { value: 'sim', label: '展示：沿目前路線模擬', icon: 'play' },
      ] : [
        { value: 'gps', label: '開始守護（使用 GPS）', icon: 'shield' },
      ],
    })
    if (!v) return
    try {
      const r = state.route
      if (v === 'gps') await startGuardian()
      else if (v === 'nav') await startGuardian({ mode: r.mode })
      else await startGuardian({ simulate: r.points, simSpeed: r.mode === 'car' ? 14 : r.mode === 'bike' ? 6 : 4 })
      const overlay = await overlayAllowed()
      if (v === 'nav') {
        toast('護航已開啟，正在打開 Google 地圖導航', { icon: 'shield', color: 'var(--blue)', ms: 3000 })
        setTimeout(() => openNavigation(r.end, r.mode).catch((e) => toastError(e.message || '無法打開地圖')), overlay ? 600 : 2600)
      } else {
        toast(v === 'gps' ? '背景守護已開啟，可以切到其他 App 了' : '展示模擬已開始，可以按主畫面鍵切到其他 App 觀看提醒', { icon: 'shield', color: 'var(--blue)', ms: 4500 })
      }
      if (!overlay) setTimeout(() => toast('到「設定」開啟靈動島懸浮提醒，在 Google 地圖上才看得到護航小圖示', { icon: 'sparkles', color: '#000', ms: 5000 }), v === 'nav' ? 0 : 1500)
    } catch (e) {
      toastError(e.message || '無法開啟守護模式')
    }
  }

  function renderGuardian(g) {
    const pill = $('.guardian-pill', page)
    pill.hidden = !g.running
    $('[data-act="guardian"].fab', page)?.classList.toggle('on', !!g.running)
    $('.q-guard', page).textContent = g.running ? (g.simulating ? '模擬中' : '守護中') : '未開啟'
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
      focusPoint(ll, 17)
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
    const b = routeLayer ? routeLayer.getBounds().pad(0.05) : map?.getBounds() // 探索模式：地圖範圍內
    $('.s-rep', page).textContent = b ? state.reports.filter((r) => b.contains([r.lat, r.lon])).length : '–'
  }

  /* ---------- 底部抽屜拖曳（四段：最小（只剩搜尋列）／預設／一半／全開） ----------
     觸控用 touch 事件自己處理：未全開時整個抽屜跟著手指走（清單不捲動）；全開時清單可捲動，
     清單已在最上方再往下拉就改成拖抽屜。位移用 requestAnimationFrame 更新，避免卡頓。 */
  const MINI = 0, PEEK = 1, FULL = 3
  let snapIdx = PEEK
  const body = $('.sheet-body', page)
  // 露出高度依內容量測（Apple 地圖：最小只剩搜尋列；預設到「快捷」那排圓鈕）
  const bottomOf = (sel, fallback) => {
    const f = $(sel, page)
    return f && f.offsetHeight ? f.offsetTop + f.offsetHeight + 14 : fallback
  }
  const snaps = () => {
    const h = sheet.getBoundingClientRect().height
    return [Math.max(0, h - bottomOf('.ap-search', 76)), Math.max(0, h - bottomOf('.ap-quick', 300)), h * 0.4, 0]
  }
  function setSnap(i) {
    snapIdx = i
    sheet.classList.toggle('full', i === FULL)
    sheet.classList.toggle('mini', i === MINI)
    if (matchMedia(WIDE).matches) { sheet.style.transform = ''; return }
    if (i !== FULL) body.scrollTop = 0
    sheet.style.transform = `translateY(${snaps()[i]}px)`
  }

  let drag = null
  let raf = 0
  const render = () => { raf = 0; if (drag?.moving) sheet.style.transform = `translateY(${drag.cur}px)` }
  function dragStart(y, target) {
    if (matchMedia(WIDE).matches) return
    drag = { y0: y, base: snaps()[snapIdx], cur: snaps()[snapIdx], moving: false, decided: false, samples: [[performance.now(), y]] }
  }
  /** 回傳 true 表示這次移動由抽屜處理（呼叫端要阻止預設捲動）。 */
  function dragMove(y) {
    if (!drag) return false
    const dy = y - drag.y0
    if (!drag.decided) {
      if (Math.abs(dy) < 4) return snapIdx !== FULL
      drag.decided = true
      // 全開時：往上滑、或清單不在最上方 → 交給清單捲動
      if (snapIdx === FULL && (dy < 0 || body.scrollTop > 0)) { drag = null; return false }
      drag.moving = true
      drag.y0 = y // 從這裡開始算，避免一開始跳動
      sheet.classList.add('dragging')
    }
    const s = snaps()
    let cur = drag.base + (y - drag.y0)
    if (cur < 0) cur = cur / 3 // 超過全開時加阻尼
    if (cur > s[MINI]) cur = s[MINI] + (cur - s[MINI]) / 3
    drag.cur = cur
    drag.samples.push([performance.now(), y])
    if (drag.samples.length > 6) drag.samples.shift()
    if (!raf) raf = requestAnimationFrame(render)
    return true
  }
  function dragEnd() {
    if (!drag) return
    const d = drag
    drag = null
    sheet.classList.remove('dragging')
    if (!d.moving) return
    const [t0, y0] = d.samples[0]
    const [t1, y1] = d.samples.at(-1)
    const v = (y1 - y0) / Math.max(1, t1 - t0) // px/ms，正值＝往下
    const s = snaps()
    let i = s.reduce((best, y, j) => (Math.abs(y - d.cur) < Math.abs(s[best] - d.cur) ? j : best), 0)
    if (v < -0.4) i = s.findLastIndex((y) => y < d.cur - 4) // 快速往上甩：到上一段
    if (v > 0.4) i = s.findIndex((y) => y > d.cur + 4)     // 快速往下甩：到下一段
    if (i < 0) i = v > 0 ? MINI : FULL
    setSnap(i)
    // 拖曳結束時不要觸發點擊
    sheet.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true })
  }
  // 觸控（手機）
  sheet.addEventListener('touchstart', (e) => dragStart(e.touches[0].clientY, e.target), { passive: true })
  sheet.addEventListener('touchmove', (e) => { if (dragMove(e.touches[0].clientY) && e.cancelable) e.preventDefault() }, { passive: false })
  sheet.addEventListener('touchend', dragEnd)
  sheet.addEventListener('touchcancel', dragEnd)
  // 滑鼠（電腦瀏覽器）
  sheet.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') dragStart(e.clientY, e.target) })
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') dragMove(e.clientY) })
  window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') dragEnd() })
  // 點把手：最小 ↔ 預設
  $('.sheet-grabber', page).addEventListener('click', () => setSnap(snapIdx === MINI ? PEEK : MINI))
  window.addEventListener('resize', () => setSnap(snapIdx))

  /* ---------- 訂閱全域事件 ---------- */
  on((type, payload) => {
    if (type === 'mode') { renderHeader(); if (map) load() }
    if (type === 'route' && map) { drawRouteLayer(); load(); setSnap(PEEK) }
    if (type === 'reports') {
      drawReports(payload.fresh)
      if (!payload.initial && payload.fresh.length) {
        const r = payload.fresh.at(-1)
        toast(`新回報：${r.category_label}${r.hotspot_name ? '・' + r.hotspot_name : ''}`, {
          icon: 'bubble', color: 'var(--purple)', onClick: () => map && focusPoint([r.lat, r.lon], 17),
        })
      }
    }
    if (type === 'online') setConn(payload)
    if (type === 'live-weather') renderWeatherPill()
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
    beginWalk,
  }
}

export { MODE_LABEL }
