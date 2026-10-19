// 共用 UI：頁面堆疊導覽、導覽列、分段控制、提示訊息、彈出視窗、格式化
import { icon } from './icons.js'

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function el(html) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}

export const fmt = {
  n: (v) => Number(v ?? 0).toLocaleString('zh-TW'),
  pct: (v) => `${Math.round((v ?? 0) * 100)}%`,
  dist: (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.round(m)} 公尺`),
  ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
    if (s < 60) return '剛剛'
    if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`
    if (s < 86400) return `${Math.floor(s / 3600)} 小時前`
    return new Date(iso).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
  },
  dt(iso) {
    const d = new Date(iso)
    return `${d.getFullYear() - 1911}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  },
}

export const LEVEL = {
  high: { label: '高風險', color: 'var(--red)', hex: '#ff3b30' },
  medium: { label: '中風險', color: 'var(--orange)', hex: '#ff9500' },
  low: { label: '注意', color: '#f5b800', hex: '#f5b800' },
}

/* ---------- 輕觸回饋 ---------- */
export function haptic(ms = 10) {
  try { navigator.vibrate?.(ms) } catch { /* 平板常沒有震動 */ }
}

/* ---------- 提示訊息 ---------- */
let toastWrap
export function toast(text, { icon: ic = 'checkmark', color = 'var(--green)', ms = 2600, onClick } = {}) {
  toastWrap ??= document.body.appendChild(el('<div class="toast-wrap"></div>'))
  const t = el(`<div class="toast"><span class="t-icon" style="background:${color}">${icon(ic)}</span><span>${esc(text)}</span></div>`)
  if (onClick) t.addEventListener('click', () => { onClick(); close() })
  toastWrap.appendChild(t)
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300) }
  setTimeout(close, ms)
}
export const toastError = (text) => toast(text, { icon: 'warning', color: 'var(--red)', ms: 3600 })

/* ---------- 頁面與導覽堆疊 ---------- */
export class Stack {
  constructor(root) {
    this.root = root
    this.pages = []
  }
  setRoot(page) {
    this.root.innerHTML = ''
    this.pages = [page]
    this.root.appendChild(page.el)
    page.onShow?.()
  }
  push(page) {
    const prev = this.pages.at(-1)
    this.pages.push(page)
    page.el.classList.add('enter')
    this.root.appendChild(page.el)
    if (prev) { prev.el.classList.remove('uncover'); prev.el.classList.add('cover') }
    page.el.addEventListener('animationend', () => page.el.classList.remove('enter'), { once: true })
    page.onShow?.()
    haptic(6)
  }
  pop() {
    if (this.pages.length <= 1) return false
    const page = this.pages.pop()
    const prev = this.pages.at(-1)
    page.el.classList.add('leave')
    prev.el.classList.remove('cover')
    prev.el.classList.add('uncover')
    page.onHide?.()
    setTimeout(() => { page.el.remove(); prev.el.classList.remove('uncover') }, 340)
    prev.onShow?.()
    return true
  }
  get depth() { return this.pages.length }
}

/** 建立有大標題＋可縮的導覽列的頁面 */
export function makePage({ title, largeTitle = true, back, right = '', cls = '' }) {
  const page = el(`
    <section class="page ${cls}">
      <header class="navbar">
        <div class="navbar-inner">
          <div class="nav-left">${back ? `<button class="nav-btn back" data-back>${icon('chevronLeft')}<span>${esc(back)}</span></button>` : ''}</div>
          <div class="nav-title">${esc(title)}</div>
          <div class="nav-right">${right}</div>
        </div>
      </header>
      <div class="scroll">
        ${largeTitle ? `<div class="large-title-wrap"><div class="t-large-title">${esc(title)}</div></div>` : ''}
        <div class="content page-body"></div>
      </div>
    </section>`)
  const scroll = $('.scroll', page)
  const nav = $('.navbar', page)
  scroll.addEventListener('scroll', () => nav.classList.toggle('scrolled', scroll.scrollTop > (largeTitle ? 36 : 4)), { passive: true })
  return { el: page, body: $('.page-body', page), scroll, nav }
}

/* ---------- 分段控制 ---------- */
export function segmented(options, value, onChange) {
  const wrap = el(`<div class="segmented" role="tablist"><span class="thumb"></span>${options
    .map((o) => `<button role="tab" data-v="${esc(o.value)}">${o.icon ? icon(o.icon) : ''}${esc(o.label)}</button>`)
    .join('')}</div>`)
  const thumb = $('.thumb', wrap)
  const set = (v, fire) => {
    const i = options.findIndex((o) => o.value === v)
    $$('button', wrap).forEach((b, j) => b.classList.toggle('active', j === i))
    thumb.style.width = `calc((100% - 4px) / ${options.length})`
    thumb.style.transform = `translateX(${i * 100}%)`
    if (fire) { haptic(5); onChange(v) }
  }
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (b) set(b.dataset.v, true)
  })
  set(value, false)
  wrap.setValue = (v) => set(v, false)
  return wrap
}

/* ---------- 彈出視窗（由下往上的 modal sheet） ---------- */
export function modal({ title, left = '取消', right = '', onRight, content }) {
  const back = el('<div class="modal-backdrop"></div>')
  const m = el(`
    <div class="modal" role="dialog" aria-label="${esc(title)}">
      <div class="modal-head">
        <div><button class="nav-btn" data-close>${esc(left)}</button></div>
        <div class="title">${esc(title)}</div>
        <div style="justify-self:end">${right ? `<button class="nav-btn" data-right style="font-weight:600">${esc(right)}</button>` : ''}</div>
      </div>
      <div class="modal-body"></div>
    </div>`)
  const body = $('.modal-body', m)
  if (typeof content === 'string') body.innerHTML = content
  else if (content) body.appendChild(content)
  document.body.append(back, m)
  const close = () => {
    back.classList.add('out'); m.classList.add('out')
    setTimeout(() => { back.remove(); m.remove() }, 380)
    modalStack.splice(modalStack.indexOf(close), 1)
  }
  modalStack.push(close)
  back.addEventListener('click', close)
  $('[data-close]', m).addEventListener('click', close)
  if (onRight) $('[data-right]', m).addEventListener('click', () => onRight(close))
  return { el: m, body, close }
}
export const modalStack = []

/* ---------- iOS 動作表（從底部升起的選單） ---------- */
export function actionSheet({ title, message, options, value }) {
  return new Promise((resolve) => {
    const back = el('<div class="as-backdrop"></div>')
    const sheet = el(`
      <div class="as-wrap" role="dialog">
        <div class="as-group">
          ${title ? `<div class="as-title">${esc(title)}${message ? `<small>${esc(message)}</small>` : ''}</div>` : ''}
          ${options.map((o, i) => `<button class="as-btn${o.value === value ? ' sel' : ''}" data-i="${i}">${o.icon ? icon(o.icon) : ''}${esc(o.label)}${o.value === value ? `<span class="check">${icon('checkmark')}</span>` : ''}</button>`).join('')}
        </div>
        <button class="as-btn as-cancel" data-cancel>取消</button>
      </div>`)
    if (!title) $('.as-btn', sheet).style.borderTop = '0'
    document.body.append(back, sheet)
    haptic(6)
    const close = (v) => {
      back.classList.add('out'); sheet.classList.add('out')
      setTimeout(() => { back.remove(); sheet.remove() }, 300)
      modalStack.splice(modalStack.indexOf(cancel), 1)
      resolve(v)
    }
    const cancel = () => close(undefined)
    modalStack.push(cancel)
    back.addEventListener('click', cancel)
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-cancel]')) return cancel()
      const b = e.target.closest('[data-i]')
      if (b) { haptic(6); close(options[+b.dataset.i].value) }
    })
  })
}

/* ---------- 免責聲明 ---------- */
export const DISCLAIMER = '依官方歷史事故統計提醒注意，不保證路況安全'
export function disclaimer(text = DISCLAIMER) {
  return `<div class="disclaimer">${icon('info')}<span>${esc(text)}。資料來源：內政部警政署 115 年 A2 類交通事故開放資料。</span></div>`
}

export function skeletonList(n = 4) {
  return `<div class="list">${Array.from({ length: n }, () => `
    <div class="cell"><div class="skeleton" style="width:34px;height:34px;border-radius:10px"></div>
    <div class="cell-main"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:11px;width:35%;margin-top:7px"></div></div></div>`).join('')}</div>`
}

export function emptyState(ic, title, sub = '', action = '') {
  return `<div class="empty">${icon(ic)}<div class="t-title3">${esc(title)}</div><div class="t-subhead">${esc(sub)}</div>${action}</div>`
}
