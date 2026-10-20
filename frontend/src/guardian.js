// 背景守護模式（Android 原生外掛 Guardian 的 JS 介面）。網頁版沒有背景定位，提供說明而不報錯。
import { registerPlugin } from '@capacitor/core'
import { getServer, isNative } from './api.js'
import { emit, on } from './store.js'
import { elderMode } from './family.js'

const Native = registerPlugin('Guardian')

export const GUARDIAN_MODES = [
  { value: 'auto', label: '自動判斷（依速度）' },
  { value: 'foot', label: '步行', icon: 'walk' },
  { value: 'bike', label: '騎機車／自行車', icon: 'bike' },
  { value: 'car', label: '開車', icon: 'car' },
  { value: 'transit', label: '搭公車／捷運（不提醒）' },
]

export const guardianState = { running: false, simulating: false, nearest: null, nearestM: null, lastAlert: '', hotspots: 0 }

function apply(s) {
  Object.assign(guardianState, { running: false, simulating: false, nearest: null, nearestM: null }, s || {})
  emit('guardian', guardianState)
}

export function guardianMode() {
  try { return localStorage.getItem('guardianMode') || 'auto' } catch { return 'auto' }
}
export function setGuardianMode(m) {
  try { localStorage.setItem('guardianMode', m) } catch { /* ignore */ }
  if (guardianState.running && !guardianState.simulating) startGuardian() // 套用新的交通方式
}

export const guardianAvailable = () => isNative()

// 守護中切換長輩模式：重新啟動服務讓新的提醒距離與語速生效（Codex 審查）。展示模擬不受影響。
on((type) => {
  if (type === 'elder' && guardianState.running && !guardianState.simulating) startGuardian().catch(() => {})
})

export async function initGuardian() {
  if (!isNative()) return
  await Native.addListener('guardianStatus', apply)
  apply(await Native.status())
}

/** 開始守護。simulate 為路線座標時，服務會沿路線模擬移動（展示用，平板沒有 GPS 也能用）。 */
export async function startGuardian({ simulate, simSpeed, mode } = {}) {
  if (!isNative()) throw new Error('背景守護需要安裝 Android App')
  const opts = { server: getServer(), mode: mode || guardianMode(), elder: elderMode() }
  if (simulate) Object.assign(opts, { simulate, simSpeed: simSpeed || 6 })
  const r = await Native.start(opts)
  apply({ ...guardianState, ...r, simulating: !!simulate })
  return r
}

export async function stopGuardian() {
  if (!isNative()) return
  apply(await Native.stop())
}

/** App 內模擬行走接近危險路口：跳出系統通知＋靈動島＋震動（網頁版沒有，略過）。 */
export async function walkAlert(h, meters, tip) {
  if (!isNative()) return
  try {
    await Native.walkAlert({ id: h.id, name: h.name, level: h.level, meters: Math.round(meters / 10) * 10,
      accidents: h.filtered_count ?? h.accident_count ?? 0, tip })
  } catch { /* 沒有通知權限時仍有 App 內紅框與語音 */ }
}

/**
 * App 切到背景時，把模擬行走交給原生服務繼續（WebView 在背景會暫停）。
 * points：剩下的路線；hotspots：路線上還沒經過的危險路口；skip：已提醒過的編號。
 */
export async function handoffWalk({ points, speed, mode, hotspots, skip }) {
  if (!isNative()) return false
  await Native.start({
    server: getServer(), mode, elder: elderMode(), source: 'walk', simulate: points, simSpeed: speed,
    simHotspots: hotspots.map((h) => ({ id: h.id, name: h.name, lat: h.lat, lon: h.lon, level: h.level, accident_count: h.filtered_count })),
    simSkip: skip,
  })
  return true
}

/** App 回到前景：取回背景模擬的進度並停止服務。回傳背景走了幾公尺；服務已走完（自動結束）時回傳 null。 */
export async function takeBackWalk() {
  if (!isNative()) return 0
  const s = await Native.status()
  if (!s.running || s.source !== 'walk') return null
  await stopGuardian()
  return s.simDist || 0
}

/** 導航護航：打開 Google 地圖導航到 dest（{lat, lon}），mode：foot / bike / car。 */
export async function openNavigation(dest, mode) {
  if (!isNative()) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}&travelmode=${mode === 'foot' ? 'walking' : mode === 'bike' ? 'two-wheeler' : 'driving'}`, '_blank')
    return { app: 'web' }
  }
  return Native.openNavigation({ lat: dest.lat, lon: dest.lon, mode })
}

/** 開發者選項顯示用：定位、通知、懸浮視窗權限。 */
export async function guardianPermissions() {
  if (!isNative()) return {}
  const p = await Native.checkPermissions()
  return { ...p, overlay: (await Native.overlayStatus()).allowed }
}

export async function testGuardianAlert() {
  if (!isNative()) throw new Error('通知測試需要安裝 Android App')
  return Native.testAlert()
}

/** 「靈動島」懸浮提醒需要「顯示在其他應用程式上層」權限（使用者在系統設定頁開啟）。 */
export async function overlayAllowed() {
  if (!isNative()) return false
  return (await Native.overlayStatus()).allowed
}
export async function requestOverlay() {
  if (!isNative()) throw new Error('靈動島提醒需要安裝 Android App')
  return Native.requestOverlay()
}
