// App 入口：分頁列、各分頁的頁面堆疊、Android 返回鍵、首次啟動設定伺服器
import '@fontsource-variable/inter'
import './styles/base.css'
import './styles/components.css'
import './styles/views.css'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { getServer, isNative, setServer } from './api.js'
import { icon } from './icons.js'
import { emit, on, startPolling, state } from './store.js'
import { $, $$, Stack, el, esc, modalStack, toast } from './ui.js'
import { adminView } from './views/admin.js'
import { feedView } from './views/feed.js'
import { mapView } from './views/map.js'
import { rankingView } from './views/ranking.js'
import { reportView } from './views/report.js'
import { applyTheme, savedTheme, settingsView, testServer } from './views/settings.js'
import { openSubmit } from './views/submit.js'
import { startWalk } from './walk.js'
import { initGuardian } from './guardian.js'
import { initWeather } from './weather.js'
import { syncAlertPrefs } from './alerts.js'
import { applyElderMode } from './family.js'
import { familyView } from './views/family.js'

applyTheme(savedTheme())
applyElderMode()
// Android WebView 的毛玻璃不一定有效，App 內改用實色材質（見 views.css html.no-blur）
if (isNative() || !CSS.supports('backdrop-filter', 'blur(2px)')) document.documentElement.classList.add('no-blur')

const TABS = [
  { id: 'map', label: '地圖', icon: 'map', on: 'mapFill' },
  { id: 'rank', label: '排行', icon: 'trophy', on: 'trophyFill' },
  { id: 'feed', label: '回報', icon: 'bubble', on: 'bubbleFill' },
  { id: 'settings', label: '設定', icon: 'gear', on: 'gearFill' },
]

const app = $('#app')
app.innerHTML = `
  <div class="tab-roots">${TABS.map((t) => `<div class="tab-root" data-root="${t.id}"></div>`).join('')}</div>
  <nav class="tabbar">${TABS.map((t) => `<button class="tab" data-tab="${t.id}">${icon(t.icon, 'ic-off')}${icon(t.on, 'ic-on')}<span>${t.label}</span></button>`).join('')}</nav>`

const stacks = Object.fromEntries(TABS.map((t) => [t.id, new Stack($(`[data-root="${t.id}"]`))]))
let current = 'map'

function switchTab(id) {
  if (id === current) {
    while (stacks[id].pop()) { /* 再點一次同分頁：回到最上層 */ }
    return
  }
  current = id
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id))
  $$('.tab-root').forEach((r) => r.classList.toggle('active', r.dataset.root === id))
  stacks[id].pages.at(-1)?.onShow?.()
  if (id === 'feed') { state.unseenReports = 0; updateBadge() }
}

function updateBadge() {
  const tab = $('[data-tab="feed"]')
  $('.badge', tab)?.remove()
  if (state.unseenReports > 0 && current !== 'feed') tab.insertAdjacentHTML('beforeend', `<span class="badge">${Math.min(99, state.unseenReports)}</span>`)
}

const openReport = (h, back) => h && stacks[current].push(reportView(h, { back: back || (current === 'map' ? '地圖' : current === 'rank' ? '排行' : '返回') }))
const mapPage = mapView({
  openReport,
  openSubmit,
  startWalk: (opts) => startWalk({ ...opts, onOpenReport: (h) => openReport(h, '地圖') }),
})
stacks.map.setRoot(mapPage)
stacks.rank.setRoot(rankingView({ openReport }))
stacks.feed.setRoot(feedView({
  openSubmit,
  getCenter: () => { const c = mapPage.map?.getCenter(); return c ? { lat: c.lat, lon: c.lng } : { lat: 25.0358, lon: 121.4420 } },
  focusReport: (r) => { if (!r) return; switchTab('map'); setTimeout(() => mapPage.map?.flyTo([r.lat, r.lon], 18), 50) },
}))
stacks.settings.setRoot(settingsView({
  openAdmin: () => stacks.settings.push(adminView()),
  openFamily: () => stacks.settings.push(familyView({ goMap: () => { while (stacks.settings.pop()) { /* 回到設定首頁 */ } switchTab('map') } })),
  // 開發者選項：切到地圖並以指定倍速開始模擬行走（等地圖與路口載入）
  devWalk: (speed) => {
    switchTab('map')
    const t0 = Date.now()
    const go = () => (mapPage.map && mapPage.hotspots.length) || Date.now() - t0 > 8000 ? mapPage.beginWalk(speed) : setTimeout(go, 200)
    setTimeout(go, 400)
  },
}))

$('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]')
  if (b) switchTab(b.dataset.tab)
})
// 導覽列返回按鈕
app.addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) stacks[current].pop()
})
on((type) => { if (type === 'reports') updateBadge() })

current = null
switchTab('map')

/* ---------- Android 原生整合 ---------- */
if (isNative()) {
  CapApp.addListener('backButton', () => {
    const walk = document.querySelector('.walk-panel [data-w="stop"]')
    if (modalStack.length) modalStack.at(-1)()
    else if (walk) walk.click()
    else if (stacks[current].pop()) { /* 已返回上一頁 */ }
    else if (current !== 'map') switchTab('map')
    else CapApp.minimizeApp()
  })
  const syncBar = () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  }
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  syncBar()
  window.addEventListener('themechange', syncBar)
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncBar)
}

/* ---------- 首次啟動：設定伺服器位址 ---------- */
function onboarding() {
  const o = el(`
    <div class="page" style="z-index:300;position:fixed;overflow-y:auto">
      <div class="onboard">
        <div class="app-icon">${icon('warningFill')}</div>
        <div class="t-large-title">路口安全通</div>
        <div class="t-body c-2" style="margin-top:8px">用官方事故資料，提醒你注意危險路口</div>
        <div class="feature">${icon('map')}<div><div class="t-headline">路線上的危險路口</div><div class="t-subhead c-2">晴天、雨天、不同時段，各有不同的危險路口</div></div></div>
        <div class="feature">${icon('walk')}<div><div class="t-headline">接近時語音提醒</div><div class="t-subhead c-2">語音＋提示音＋紅框，平板沒有 GPS 也能模擬行走</div></div></div>
        <div class="feature">${icon('bubble')}<div><div class="t-headline">回報差點被撞</div><div class="t-subhead c-2">存進資料庫，其他人即時看到</div></div></div>
        <div class="list" style="text-align:left;margin-top:26px">
          <div class="cell"><span style="color:var(--blue)">${icon('server')}</span><input type="url" class="ob-srv" placeholder="伺服器位址，例如 192.168.1.108:8000" autocapitalize="off" spellcheck="false" value="${esc(getServer())}"></div>
        </div>
        <div class="t-footnote c-2 ob-msg" style="text-align:left;padding:8px 4px 0">在電腦執行 start_server.bat 後，畫面會顯示要輸入的網址</div>
        <button class="btn btn-primary btn-block ob-go" style="margin-top:20px">開始使用</button>
        <button class="btn btn-block ob-skip" style="margin-top:6px;color:var(--blue);font-weight:500">稍後再設定</button>
        <div class="t-caption c-2" style="margin-top:22px">依官方歷史事故統計提醒注意，不保證路況安全</div>
      </div>
    </div>`)
  document.body.appendChild(o)
  const go = $('.ob-go', o)
  go.addEventListener('click', async () => {
    go.disabled = true
    go.textContent = '連線中…'
    try {
      await testServer($('.ob-srv', o).value)
      setServer($('.ob-srv', o).value)
      o.style.transition = 'opacity .35s'; o.style.opacity = '0'
      setTimeout(() => o.remove(), 350)
      emit('server-changed')
      startPolling()
      toast('已連上伺服器')
    } catch (e) {
      $('.ob-msg', o).innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`
      go.disabled = false
      go.textContent = '開始使用'
    }
  })
  $('.ob-skip', o).addEventListener('click', () => o.remove())
}

initGuardian().catch(() => { /* 網頁版或外掛未載入 */ })
syncAlertPrefs() // 危險通知設定同步到原生服務
if (!getServer()) onboarding()
else startPolling()
initWeather() // 伺服器變更時會自動重查
