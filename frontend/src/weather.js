// 即時天氣與「自動」天候模式：後端代查中央氣象署（最近雨量站＋鄉鎮降雨機率），下雨時自動切到雨天模式
import { Geolocation } from '@capacitor/geolocation'
import { api } from './api.js'
import { icon } from './icons.js'
import { emit, on, routeOrDemo, setMode, state } from './store.js'
import { actionSheet, toast } from './ui.js'

const REFRESH_MS = 10 * 60 * 1000 // 氣象署每 10 分鐘更新
const KEY = 'weatherAuto'

export const live = { available: null, data: null, at: 0, loading: false }
let timer = null

function savedAuto() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
state.weatherAuto = savedAuto()

async function position() {
  try {
    // 只在已授權時用定位，不在開 App 時跳出權限詢問
    if ((await Geolocation.checkPermissions()).location !== 'granted') throw new Error('no permission')
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 5000, maximumAge: 5 * 60 * 1000 })
    return { lat: p.coords.latitude, lon: p.coords.longitude, from: 'gps' }
  } catch {
    const s = routeOrDemo().start // 沒有定位（平板、網頁）→ 用路線起點（探索模式用 Demo 起點）
    return { lat: s.lat, lon: s.lon, from: 'route' }
  }
}

/** 取得即時天氣；自動模式下依建議切換晴天／雨天。 */
let inflight = null
let wantAnnounce = false
export function refreshLive({ announce = false } = {}) {
  // 已有請求在跑（例如開 App 時的那一次）：共用同一個請求，完成時再依最新的自動模式套用，
  // 不要直接回傳舊資料（Codex 審查：否則剛選「自動」會被誤判為失敗而關掉）
  if (announce) wantAnnounce = true
  inflight ??= doRefresh().finally(() => { inflight = null; wantAnnounce = false })
  return inflight
}

async function doRefresh() {
  live.loading = true
  try {
    const pos = await position()
    const d = await api(`/api/weather/now?lat=${pos.lat.toFixed(4)}&lon=${pos.lon.toFixed(4)}`, { timeout: 25000 })
    live.available = !!d.available
    live.data = d.available ? { ...d, from: pos.from } : null
    live.at = Date.now()
    if (!d.available && state.weatherAuto) setAuto(false, { silent: true })
    else if (state.weatherAuto) apply(wantAnnounce)
    emit('live-weather', live)
    return live.data
  } catch {
    emit('live-weather', live) // 失敗時保留上次結果
    return null
  } finally {
    live.loading = false
  }
}

function apply(announce) {
  const d = live.data
  if (!d) return
  const prev = state.weather
  if (d.suggested_mode !== prev) setMode({ weather: d.suggested_mode })
  if (d.suggested_mode === 'rain' && (prev !== 'rain' || announce)) {
    toast(`${d.reason}，已切換雨天模式`, { icon: 'rain', color: 'var(--indigo)', ms: 4200 })
  } else if (announce) {
    toast(`${d.station.town}目前${d.forecast?.weather || '沒有下雨'}，顯示晴天時的危險路口`, { icon: 'sun', color: 'var(--orange)', ms: 3600 })
  }
}

function setAuto(on, { silent = false } = {}) {
  state.weatherAuto = on
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* 不影響使用 */ }
  clearInterval(timer)
  timer = on ? setInterval(() => refreshLive(), REFRESH_MS) : null
  if (!on && !silent) emit('mode', {})
}

/** 天候膠囊的外觀（地圖頁、排行頁共用）。 */
export function renderWeatherChip(chip) {
  const w = state.weather
  const label = w === 'rain' ? '雨天' : w === 'clear' ? '晴天' : '全部天候'
  chip.className = `chip${w !== 'all' ? ' on' : ''}${w === 'rain' ? ' rain' : ''}`
  chip.innerHTML = `${icon(w === 'rain' ? 'rain' : state.weatherAuto ? 'sparkles' : 'sun')}${state.weatherAuto ? `自動・${label}` : label}<span class="caret">${icon('chevronDown')}</span>`
}

function liveLine() {
  const d = live.data
  if (!d) return ''
  const pop = d.pop_percent != null ? `・降雨機率 ${d.pop_percent}%` : ''
  const rain = d.rain_1h_mm != null ? `・1 小時雨量 ${d.rain_1h_mm} mm` : ''
  return `${d.station.town}${d.forecast?.weather ? ' ' + d.forecast.weather : ''}${pop}${rain}`
}

/** 天候模式動作表（有氣象署資料時多一個「自動」選項）。 */
export async function pickWeather() {
  if (live.available === null && !live.loading) refreshLive() // 背景先查，不擋住動作表
  const auto = live.available !== false
  const options = [
    ...(auto ? [{ value: 'auto', label: '自動（依氣象署即時天氣）', icon: 'sparkles' }] : []),
    { value: 'all', label: '全部天候' },
    { value: 'clear', label: '晴天／陰天', icon: 'sun' },
    { value: 'rain', label: '雨天', icon: 'rain' },
  ]
  const line = liveLine()
  const v = await actionSheet({
    title: '天候模式',
    message: line ? `目前 ${line}` : '依事故發生時的天候篩選危險路口',
    value: state.weatherAuto ? 'auto' : state.weather,
    options,
  })
  if (!v) return
  if (v === 'auto') {
    if (state.weatherAuto) return
    setAuto(true)
    emit('mode', {})
    const d = await refreshLive({ announce: true })
    if (!d) {
      setAuto(false, { silent: true })
      emit('mode', {})
      toast('暫時取不到氣象署資料，請稍後再試', { icon: 'warning', color: 'var(--red)', ms: 3600 })
    }
    return
  }
  const wasAuto = state.weatherAuto
  if (wasAuto) setAuto(false, { silent: true })
  if (v !== state.weather) setMode({ weather: v })
  else if (wasAuto) emit('mode', {})
}

/** App 啟動時呼叫：恢復自動模式、查一次可用性。 */
export function initWeather() {
  if (state.weatherAuto) setAuto(true, { silent: true })
  refreshLive()
  on((type) => { if (type === 'server-changed') refreshLive() })
}
