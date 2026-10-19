// 全域狀態：天候／時段模式、即時回報輪詢
import { api } from './api.js'

const listeners = new Set()

export const state = {
  weather: 'all',
  period: 'all',
  reports: [],          // 最新的使用者回報（由新到舊）
  lastReportId: 0,
  unseenReports: 0,
  online: null,         // null=未知、true/false
}

export function on(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function emit(type, payload) {
  listeners.forEach((fn) => fn(type, payload))
}

export function setMode(patch) {
  Object.assign(state, patch)
  emit('mode', patch)
}

export const WEATHER_OPTS = [
  { value: 'all', label: '全部' },
  { value: 'clear', label: '晴天', icon: 'sun' },
  { value: 'rain', label: '雨天', icon: 'rain' },
]
export const PERIOD_OPTS = [
  { value: 'all', label: '全天' },
  { value: 'morning', label: '早上' },
  { value: 'day', label: '白天' },
  { value: 'evening', label: '傍晚' },
  { value: 'night', label: '夜間' },
]
export const PERIOD_HINT = { all: '全天', morning: '6–9 點', day: '10–15 點', evening: '16–19 點', night: '20–5 點' }

/* ---------- 即時回報：每 5 秒用 since_id 輪詢 ---------- */
let pollTimer = null
export async function pollReports(initial = false) {
  try {
    if (initial || !state.lastReportId) {
      const rows = await api('/api/reports?limit=50')
      state.reports = rows
      state.lastReportId = rows[0]?.id ?? 0
      setOnline(true)
      emit('reports', { initial: true, fresh: [] })
      return
    }
    const fresh = await api(`/api/reports?since_id=${state.lastReportId}`)
    setOnline(true)
    if (fresh.length) {
      state.lastReportId = fresh.at(-1).id
      state.reports = [...fresh.slice().reverse(), ...state.reports].slice(0, 200)
      state.unseenReports += fresh.length
      emit('reports', { initial: false, fresh })
    }
  } catch {
    setOnline(false)
  }
}
export function startPolling() {
  stopPolling()
  pollReports(true)
  pollTimer = setInterval(() => pollReports(false), 5000)
}
export function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
function setOnline(v) {
  if (state.online !== v) {
    state.online = v
    emit('online', v)
  }
}
