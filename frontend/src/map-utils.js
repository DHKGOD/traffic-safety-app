// 地圖共用：MapLibre 向量底圖（OpenFreeMap，免金鑰）＋ Leaflet 標記；依深淺色切換樣式
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as maplibregl from 'maplibre-gl'
import '@maplibre/maplibre-gl-leaflet'

import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

// MapLibre 6 的解析圖磚 worker 是獨立檔案，由 Vite 複製到 assets 後告訴 MapLibre 位置
maplibregl.setWorkerUrl(maplibreWorkerUrl)
window.maplibregl = maplibregl // maplibre-gl-leaflet 需要全域變數

// OpenFreeMap：開源、免金鑰的向量圖磚（資料來自 OpenStreetMap）。Liberty 風格接近 Google 地圖
const STYLE = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}
const ATTR = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'

// 地名優先顯示繁體中文
const ZH_NAME = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh-TW'], ['get', 'name']]  // 台灣的 name 本身就是繁體

export function isDark() {
  const t = document.documentElement.dataset.theme
  if (t === 'dark') return true
  if (t === 'light') return false
  return matchMedia('(prefers-color-scheme: dark)').matches
}

function localizeLabels(gl) {
  for (const layer of gl.getStyle()?.layers || []) {
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      try { gl.setLayoutProperty(layer.id, 'text-field', ZH_NAME) } catch { /* 部分圖層不支援 */ }
    }
  }
}

/** 建立地圖（向量底圖），並自動跟隨深淺色模式切換樣式 */
export function createMap(container, opts = {}) {
  const map = L.map(container, { zoomControl: false, attributionControl: true, ...opts })
  map.attributionControl?.setPrefix(false)
  const gl = L.maplibreGL({
    style: isDark() ? STYLE.dark : STYLE.light,
    attribution: ATTR,
    interactive: false,
    // 中日韓文字用裝置內建字型繪製，清晰且不必下載字型
    localIdeographFontFamily: '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif',
  }).addTo(map)
  // MapLibre 地圖要等 Leaflet 設好視野（whenReady）後才會建立
  map.whenReady(() => {
    const glMap = gl.getMaplibreMap()
    glMap?.on('style.load', () => localizeLabels(glMap))
  })
  let dark = isDark()
  const apply = () => {
    if (isDark() === dark) return
    dark = isDark()
    gl.getMaplibreMap()?.setStyle(dark ? STYLE.dark : STYLE.light)
  }
  const mq = matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener?.('change', apply)
  window.addEventListener('themechange', apply)
  map.on('unload', () => { mq.removeEventListener?.('change', apply); window.removeEventListener('themechange', apply) })
  return map
}

/** 危險路口標記（Apple 地圖 POI 風格）：圓形「!」圖示依風險上色，地圖上不放名次數字；選取時放大並顯示路口名稱。 */
export function hotspotIcon(h, rank, selected = false) {
  const size = h.level === 'high' ? 26 : h.level === 'medium' ? 22 : 18
  const label = selected ? `<span class="hs-label">${String(h.name).replace(/[<>&]/g, '')}</span>` : ''
  return L.divIcon({
    className: '',
    html: `<div class="hs-marker ${h.level}${selected ? ' selected' : ''}" style="width:${size}px;height:${size}px">
             <div class="core" style="width:${size}px;height:${size}px">!</div>${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/** 起點（藍點白圈，像「我的位置」）與終點（紅色圓形圖釘）。 */
export function pinIcon(kind) {
  if (kind === 'start') {
    return L.divIcon({ className: '', html: '<div class="start-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] })
  }
  return L.divIcon({ className: '', html: '<div class="end-pin"><span></span></div>', iconSize: [30, 38], iconAnchor: [15, 36] })
}

/** 路線上的時間泡泡（Apple 地圖的「7 分鐘」）。 */
export function routeBubble(text) {
  return L.divIcon({ className: '', html: `<div class="route-bubble">${text}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] })
}

export const reportIcon = (fresh = false) =>
  L.divIcon({ className: '', html: `<div class="report-marker${fresh ? ' fresh' : ''}">!</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })

export const meIcon = () => L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] })
export const walkerIcon = () => L.divIcon({ className: '', html: '<div class="walker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] })

/** 路線（Apple 地圖風格）：淡陰影＋深藍外框＋亮藍中心，比單色線更有「導航」感。 */
export function drawRoute(map, points) {
  const opt = { lineCap: 'round', lineJoin: 'round', interactive: false }
  // 半透明：底下的道路與路名會透出來（使用者回饋：太深像畫上去的線）
  const shadow = L.polyline(points, { ...opt, color: '#000', weight: 17, opacity: 0.06, className: 'route-shadow' })
  const casing = L.polyline(points, { ...opt, color: '#1d5fd1', weight: 12, opacity: 0.5 })
  const line = L.polyline(points, { ...opt, color: '#4b9dff', weight: 7.5, opacity: 0.7 })
  return L.featureGroup([shadow, casing, line]).addTo(map)
}

export { L }
