// 家人模式的狀態：常用路線（存在手機）、長輩模式（字放大、提早提醒、語音放慢）
import { emit } from './store.js'

export function savedRoutes() {
  try { return JSON.parse(localStorage.getItem('savedRoutes') || '[]') } catch { return [] }
}
export function saveRoute(route, name) {
  const list = savedRoutes().filter((r) => r.name !== name)
  list.unshift({ ...route, name, demo: false, savedAt: Date.now() })
  try { localStorage.setItem('savedRoutes', JSON.stringify(list.slice(0, 20))) } catch { /* 空間不足 */ }
  emit('saved-routes')
}
export function deleteRoute(name) {
  try { localStorage.setItem('savedRoutes', JSON.stringify(savedRoutes().filter((r) => r.name !== name))) } catch { /* ignore */ }
  emit('saved-routes')
}

export function elderMode() {
  try { return localStorage.getItem('elderMode') === '1' } catch { return false }
}
export function setElderMode(on) {
  try { localStorage.setItem('elderMode', on ? '1' : '0') } catch { /* ignore */ }
  applyElderMode()
  emit('elder', on)
}
export function applyElderMode() {
  document.documentElement.classList.toggle('elder', elderMode())
}
