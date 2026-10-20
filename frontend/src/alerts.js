// 危險路口提醒偏好（設定頁「危險通知」）：App 內模擬行走、背景守護、導航護航共用。
// 存在手機（localStorage），並同步到原生服務（SharedPreferences），App 關掉後背景提醒也照設定。
import { registerPlugin } from '@capacitor/core'
import { isNative } from './api.js'

const Native = registerPlugin('Guardian')
const KEY = 'alertPrefs'

export const ALERT_STYLES = [
  { value: 'bubble', label: '小球旁邊（推薦）', hint: '從護航小球旁邊彈出，自動選左邊或右邊有空間的一側，不擋導航提示；沒有小球時改在螢幕上方' },
  { value: 'island', label: '螢幕上方（靈動島）', hint: '狀態列下方的黑色膠囊；通知欄只留靜音紀錄' },
  { value: 'both', label: '靈動島＋通知橫幅', hint: '兩種都跳（三星「簡要」彈出樣式下橫幅可能不會彈出）' },
  { value: 'banner', label: '只用通知橫幅', hint: '使用 Android 系統通知' },
]
export const ALERT_LEVELS = [
  { value: 'low', label: '所有危險路口' },
  { value: 'medium', label: '中風險以上' },
  { value: 'high', label: '只有高風險' },
]
export const ALERT_DISTANCES = [
  { value: 1, label: '標準', hint: '步行 60 公尺・騎車 120・開車 220' },
  { value: 1.3, label: '提早', hint: '距離 ×1.3' },
  { value: 1.6, label: '更早', hint: '距離 ×1.6' },
]

const DEFAULTS = { style: 'bubble', level: 'low', distance: 1, voice: true, sound: true, vibrate: true }

export function alertPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEFAULTS } }
}

export async function setAlertPrefs(patch) {
  const p = { ...alertPrefs(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* 不影響使用 */ }
  await syncAlertPrefs()
  return p
}

/** 把偏好送到原生端（App 啟動時也呼叫一次）。 */
export async function syncAlertPrefs() {
  // 一次性遷移：舊版預設「靈動島」改成新預設「小球旁邊」（之後使用者自己選的會保留）
  try {
    if (!localStorage.getItem('alertStyleV2')) {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (saved?.style === 'island') localStorage.setItem(KEY, JSON.stringify({ ...saved, style: 'bubble' }))
      localStorage.setItem('alertStyleV2', '1')
    }
  } catch { /* 不影響使用 */ }
  if (!isNative()) return
  try { await Native.setAlertPrefs(alertPrefs()) } catch { /* 舊版 App 沒有這個方法 */ }
}

const RANK = { low: 0, medium: 1, high: 2 }
/** 這個等級的路口要不要提醒。 */
export const levelPasses = (level, prefs = alertPrefs()) => (RANK[level] ?? 0) >= (RANK[prefs.level] ?? 0)
