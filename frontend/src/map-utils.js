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

export function hotspotIcon(h, rank, selected = false) {
  const size = Math.round(Math.min(34, 20 + Math.sqrt(h.filtered_count ?? h.accident_count) * 3))
  return L.divIcon({
    className: '',
    html: `<div class="hs-marker ${h.level}${selected ? ' selected' : ''}" style="width:${size}px;height:${size}px">
             <div class="core" style="width:${size}px;height:${size}px">${rank ?? ''}</div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

export function pinIcon(text, color) {
  return L.divIcon({
    className: '',
    html: `<div class="pin" style="background:${color}"><span>${text}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  })
}

export const reportIcon = (fresh = false) =>
  L.divIcon({ className: '', html: `<div class="report-marker${fresh ? ' fresh' : ''}">!</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })

export const meIcon = () => L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] })
export const walkerIcon = () => L.divIcon({ className: '', html: '<div class="walker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] })

export function drawRoute(map, points) {
  const casing = L.polyline(points, { color: '#ffffff', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round' })
  const line = L.polyline(points, { color: '#0a84ff', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' })
  return L.featureGroup([casing, line]).addTo(map)
}

export { L }
