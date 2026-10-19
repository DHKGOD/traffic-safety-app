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
export async function startGuardian({ simulate, simSpeed } = {}) {
  if (!isNative()) throw new Error('背景守護需要安裝 Android App')
  const opts = { server: getServer(), mode: guardianMode(), elder: elderMode() }
  if (simulate) Object.assign(opts, { simulate, simSpeed: simSpeed || 6 })
  const r = await Native.start(opts)
  apply({ ...guardianState, ...r, simulating: !!simulate })
  return r
}

export async function stopGuardian() {
  if (!isNative()) return
  apply(await Native.stop())
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
