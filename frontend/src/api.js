// 伺服器位址與 API 呼叫。位址存在本機（換到雲端不用重新打包 APK，只要在設定頁改位址）。
import { Capacitor } from '@capacitor/core'

const KEY = 'serverUrl'

export const isNative = () => Capacitor.isNativePlatform()

/** 網頁版若由後端提供（http://IP:8000/），預設連同一個來源；App 版需要在設定頁輸入。 */
export function defaultServer() {
  if (!isNative() && location.protocol.startsWith('http') && location.port !== '5173') return location.origin
  return import.meta.env.VITE_DEFAULT_SERVER || ''
}

export function getServer() {
  try {
    return localStorage.getItem(KEY) || defaultServer()
  } catch {
    return defaultServer()
  }
}

export function setServer(url) {
  const clean = normalize(url)
  try {
    localStorage.setItem(KEY, clean)
  } catch { /* 無痕模式等情況 */ }
  return clean
}

export function normalize(url) {
  // 中文輸入法常打出全形「：．／」或「。」，一律轉成半形並去掉空白
  let u = (url || '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[。､、]/g, '.')
    .replace(/\s+/g, '')
    .replace(/\/+$/, '')
  if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u
  // 只輸入 IP 時自動補上預設 port 8000
  if (/^https?:\/\/[\d.]+$/i.test(u)) u += ':8000'
  return u
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body, timeout = 12000, server } = {}) {
  const base = server ?? getServer()
  if (!base) throw new ApiError('尚未設定伺服器位址', 0)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = data?.detail ? (typeof data.detail === 'string' ? data.detail : '資料格式不正確') : `伺服器錯誤（${res.status}）`
      throw new ApiError(msg, res.status)
    }
    return data
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (e.name === 'AbortError') throw new ApiError('連線逾時，請確認手機與電腦在同一個 Wi-Fi', 0)
    throw new ApiError('無法連線到伺服器，請到「設定」確認位址', 0)
  } finally {
    clearTimeout(timer)
  }
}

export function deviceId() {
  try {
    let id = localStorage.getItem('deviceId')
    if (!id) {
      id = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
      localStorage.setItem('deviceId', id)
    }
    return id
  } catch {
    return 'dev-anon'
  }
}
