// 設定：伺服器位址（換雲端不必重新打包）、外觀、後台、關於
import { api, deviceId, getServer, isNative, normalize, setServer } from '../api.js'
import { icon } from '../icons.js'
import { emit, startPolling, state } from '../store.js'
import { $, DISCLAIMER, actionSheet, esc, fmt, makePage, segmented, toast, toastError } from '../ui.js'
import {
  GUARDIAN_MODES, guardianAvailable, guardianMode, guardianPermissions, guardianState, openNavigation, overlayAllowed,
  requestOverlay, setGuardianMode, startGuardian, stopGuardian, testGuardianAlert,
} from '../guardian.js'
import { ALERT_DISTANCES, ALERT_LEVELS, ALERT_STYLES, alertPrefs, setAlertPrefs } from '../alerts.js'

export function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  try { localStorage.setItem('theme', t) } catch { /* ignore */ }
  window.dispatchEvent(new Event('themechange'))
}
export const savedTheme = () => { try { return localStorage.getItem('theme') || 'auto' } catch { return 'auto' } }

/** 測試連線，回傳 health 結果 */
export async function testServer(url) {
  const h = await api('/api/health', { server: normalize(url), timeout: 6000 })
  // 伺服器有回應但資料庫異常時也算失敗（不要存進去）
  if (h?.status !== 'ok' || !h?.database?.ok) throw new Error(`伺服器有回應，但資料庫異常：${h?.database?.error || '未知錯誤'}`)
  return h
}

export function settingsView({ openAdmin, openFamily, devWalk }) {
  const p = makePage({ title: '設定' })
  p.body.innerHTML = `
    <div class="section" style="margin-top:4px">
      <div class="section-header">伺服器</div>
      <div class="list">
        <div class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--blue)">${icon('server')}</span>
          <input type="url" inputmode="url" class="srv" placeholder="例如 http://192.168.1.108:8000" value="${esc(getServer())}" autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--green)">${icon('wifi')}</span>
          <span class="cell-main"><span class="server-status c-2">尚未測試</span></span>
        </div>
        <button class="cell tappable" data-test style="justify-content:center;color:var(--blue);font-weight:600">測試連線並儲存</button>
      </div>
      <div class="section-footer">本機模擬雲端：在電腦執行 start_server.bat，畫面會顯示要輸入的網址（手機需連同一個 Wi-Fi）。搬到雲端主機後，只要在這裡改成新網址即可，不用重新安裝 App。</div>
    </div>

    <div class="section">
      <div class="list">
        <button class="cell tappable" data-family style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--teal)">${icon('family')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">家人模式</span>
          <span class="cell-sub" style="display:block">替長輩設定常走路線、長輩模式</span></span>
          <span class="chev">${icon('chevronRight')}</span>
        </button>
      </div>
    </div>

    <div class="section">
      <div class="section-header">危險通知</div>
      <div class="list">
        <button class="cell tappable" data-pref="style" style="--sep-inset:58px">
          <span class="cell-icon" style="background:#000">${icon('sparkles')}</span>
          <span class="cell-main"><span class="cell-title">提醒方式</span></span>
          <span class="cell-value pv-style"></span><span class="chev">${icon('chevronRight')}</span>
        </button>
        <button class="cell tappable" data-pref="level" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--orange)">${icon('warningFill')}</span>
          <span class="cell-main"><span class="cell-title">提醒等級</span></span>
          <span class="cell-value pv-level"></span><span class="chev">${icon('chevronRight')}</span>
        </button>
        <button class="cell tappable" data-pref="distance" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--teal)">${icon('route')}</span>
          <span class="cell-main"><span class="cell-title">提醒時機</span></span>
          <span class="cell-value pv-distance"></span><span class="chev">${icon('chevronRight')}</span>
        </button>
        <label class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--blue)">${icon('speaker')}</span>
          <span class="cell-main"><span class="cell-title">語音播報</span></span>
          <input type="checkbox" class="ios-switch" data-sw="voice">
        </label>
        <label class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--pink, #ff2d55)">${icon('bolt')}</span>
          <span class="cell-main"><span class="cell-title">提示音</span></span>
          <input type="checkbox" class="ios-switch" data-sw="sound">
        </label>
        <label class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--purple)">${icon('hand')}</span>
          <span class="cell-main"><span class="cell-title">震動</span></span>
          <input type="checkbox" class="ios-switch" data-sw="vibrate">
        </label>
        <button class="cell tappable" data-gtest style="justify-content:center;color:var(--blue);font-weight:600">送出測試提醒</button>
      </div>
      <div class="section-footer pv-hint"></div>
    </div>

    <div class="section">
      <div class="section-header">背景守護</div>
      <div class="list">
        <button class="cell tappable" data-gmode style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--blue)">${icon('shield')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">交通方式</span></span>
          <span class="cell-value g-mode"></span><span class="chev">${icon('chevronRight')}</span>
        </button>
        <button class="cell tappable" data-overlay style="--sep-inset:58px">
          <span class="cell-icon" style="background:#000">${icon('sparkles')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">靈動島與護航小圖示權限</span></span>
          <span class="cell-value ov-state">—</span><span class="chev">${icon('chevronRight')}</span>
        </button>
      </div>
      <div class="section-footer">在地圖右側按 ${icon('shield')} 開啟。「靈動島」在螢幕最上方跳出黑色膠囊提醒，不受手機通知彈出設定影響（三星預設的「簡要」通知不會彈出橫幅）；開著 Google 地圖導航時，畫面邊緣會有護航小圖示顯示最近危險路口的距離。「自動判斷」依速度調整提醒距離，搭公車或捷運時可選「不提醒」。</div>
    </div>

    <div class="section">
      <div class="section-header">開發者選項</div>
      <div class="list">
        <button class="cell tappable" data-dev="walk" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--blue)">${icon('walk')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">模擬行走（App 內）</span>
          <span class="cell-sub" style="display:block">沿目前路線走，接近路口跳提醒；按主畫面鍵會轉到背景繼續</span></span>
          <span class="chev">${icon('chevronRight')}</span>
        </button>
        <button class="cell tappable" data-dev="bg" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--indigo)">${icon('shield')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">背景守護模擬</span>
          <span class="cell-sub" style="display:block">原生服務沿路線模擬；切到其他 App 看靈動島與小圖示</span></span>
          <span class="chev">${icon('chevronRight')}</span>
        </button>
        <button class="cell tappable" data-dev="nav" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--green)">${icon('route')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">導航護航模擬</span>
          <span class="cell-sub" style="display:block">模擬沿路線移動，同時打開 Google 地圖導航</span></span>
          <span class="chev">${icon('chevronRight')}</span>
        </button>
        <button class="cell tappable" data-dev="stop" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--gray)">${icon('stop')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">停止所有模擬與守護</span></span>
        </button>
        <div class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--green)">${icon('checkCircle')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">權限狀態</span>
          <span class="cell-sub dev-perm" style="display:block">—</span></span>
        </div>
      </div>
      <div class="section-footer">給開發與展示用：不必真的走路，也能測試提醒、背景執行與 Google 地圖護航。模擬使用地圖頁目前的路線。</div>
    </div>

    <div class="section">
      <div class="section-header">外觀</div>
      <div class="list"><div class="cell"><div class="seg-theme" style="flex:1"></div></div></div>
    </div>

    <div class="section">
      <div class="section-header">資料與系統</div>
      <div class="list">
        <button class="cell tappable" data-admin style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--indigo)">${icon('database')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">資料庫狀態</span></span>
          <span class="cell-value db-count"></span><span class="chev">${icon('chevronRight')}</span>
        </button>
        <div class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--purple)">${icon('sparkles')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">AI 模型</span></span>
          <span class="cell-value ai-ver">—</span>
        </div>
        <div class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--gray)">${icon('person')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">裝置代碼</span></span>
          <span class="cell-value t-footnote">${esc(deviceId())}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="app-icon-hero">
        <div class="app-icon">${icon('warningFill')}</div>
        <div class="t-headline">有路安</div>
        <div class="t-footnote c-2">版本 0.1.0（${isNative() ? 'Android App' : '網頁版'}）</div>
      </div>
      <div class="card t-footnote c-2" style="margin-top:12px;line-height:1.6">
        ${icon('info')} ${DISCLAIMER}。<br>
        資料來源：內政部警政署「即時交通事故資料(A2類)」115 年 1–10 月（政府資料開放平臺）。<br>
        地圖：© OpenStreetMap 貢獻者、© CARTO。<br>
        輔仁大學 資料庫課程專題。
      </div>
    </div>`

  $('.seg-theme', p.el).replaceWith(segmented(
    [{ value: 'auto', label: '自動' }, { value: 'light', label: '淺色', icon: 'sun' }, { value: 'dark', label: '深色', icon: 'moon' }],
    savedTheme(), applyTheme))

  const status = $('.server-status', p.el)
  async function test(save) {
    const url = $('.srv', p.el).value
    status.innerHTML = '測試中…'
    try {
      const h = await testServer(url)
      status.innerHTML = `<span class="live-dot"></span><span style="color:var(--green)">已連線</span><span class="c-2">・資料庫 ${h.database.ok ? '正常' : '異常'}・${h.database.latency_ms} ms</span>`
      if (save) {
        const clean = setServer(url)
        $('.srv', p.el).value = clean
        toast('已儲存伺服器位址')
        emit('server-changed', clean)
        startPolling()
        refreshInfo()
      }
    } catch (e) {
      status.innerHTML = `<span style="color:var(--red)">${icon('warning')} ${esc(e.message)}</span>`
      if (save) toastError('連不到這個位址')
    }
  }
  async function refreshInfo() {
    try {
      const s = await api('/api/admin/stats')
      const acc = s.tables.find((t) => t.table === 'accident')?.rows
      $('.db-count', p.el).textContent = `${fmt.n(acc)} 件事故`
      const models = await api('/api/ai/models')
      // App 的 AI 情境預測使用 cause_scenario（cause_full 只是對照模型）
      const active = models.find((m) => m.is_active && m.name === 'cause_scenario')
      $('.ai-ver', p.el).textContent = active ? `情境預測 v${active.version}` : '尚未訓練'
    } catch { /* 離線 */ }
  }
  const renderMode = () => { $('.g-mode', p.el).textContent = GUARDIAN_MODES.find((m) => m.value === guardianMode()).label }
  async function pickMode() {
    const v = await actionSheet({ title: '背景守護：交通方式', message: '決定多遠開始提醒；搭大眾運輸時不提醒', value: guardianMode(), options: GUARDIAN_MODES })
    if (v) { setGuardianMode(v); renderMode() }
  }
  renderMode()
  async function renderOverlay() {
    try { $('.ov-state', p.el).textContent = (await overlayAllowed()) ? '已開啟' : '未開啟' } catch { /* 網頁版 */ }
  }
  renderOverlay()
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderOverlay(); renderPerms() } }) // 從系統設定頁回來時更新

  /* ---------- 危險通知 ---------- */
  const PREF_OPTS = { style: ALERT_STYLES, level: ALERT_LEVELS, distance: ALERT_DISTANCES }
  const PREF_TITLE = { style: '提醒方式', level: '提醒等級', distance: '提醒時機' }
  function renderPrefs() {
    const pr = alertPrefs()
    for (const k of Object.keys(PREF_OPTS)) {
      $(`.pv-${k}`, p.el).textContent = PREF_OPTS[k].find((o) => o.value === pr[k])?.label.replace('（推薦）', '') || ''
    }
    for (const sw of p.el.querySelectorAll('[data-sw]')) sw.checked = !!pr[sw.dataset.sw]
    const style = ALERT_STYLES.find((o) => o.value === pr.style)
    const quiet = !pr.voice && !pr.sound && !pr.vibrate ? '目前為完全靜音：只有畫面提醒。' : ''
    $('.pv-hint', p.el).textContent = `${style.hint}。${quiet}設定會套用到模擬行走、背景守護與導航護航。`
  }
  async function pickPref(k) {
    const pr = alertPrefs()
    const v = await actionSheet({ title: PREF_TITLE[k], value: pr[k],
      options: PREF_OPTS[k].map((o) => ({ value: o.value, label: o.hint && k === 'distance' ? `${o.label}（${o.hint}）` : o.label })) })
    if (v !== undefined && v !== pr[k]) { await setAlertPrefs({ [k]: v }); renderPrefs() }
  }
  p.el.addEventListener('change', async (e) => {
    const sw = e.target.closest('[data-sw]')
    if (sw) { await setAlertPrefs({ [sw.dataset.sw]: sw.checked }); renderPrefs() }
  })
  renderPrefs()

  /* ---------- 開發者選項 ---------- */
  async function renderPerms() {
    if (!isNative()) { $('.dev-perm', p.el).textContent = '網頁版：背景守護、通知、懸浮視窗需安裝 Android App'; return }
    try {
      const s = await guardianPermissions()
      const ok = (v) => (v === 'granted' || v === true ? '✓' : '✕')
      $('.dev-perm', p.el).textContent = `定位 ${ok(s.location)}・通知 ${ok(s.notifications)}・懸浮視窗 ${ok(s.overlay)}`
    } catch { /* 舊版 App */ }
  }
  renderPerms()
  async function dev(kind) {
    const r = state.route
    // 開發測試用：比實際快約 3 倍，幾十秒內就會經過第一個危險路口
    const sim = { simulate: r.points, simSpeed: r.mode === 'car' ? 28 : r.mode === 'bike' ? 15 : 12, mode: r.mode }
    try {
      if (kind === 'walk') {
        const v = await actionSheet({ title: '模擬行走速度', message: `路線：${r.start.name} → ${r.end.name}`, value: '10',
          options: [{ value: '1', label: '1×（實際步行速度）' }, { value: '4', label: '4×' }, { value: '10', label: '10×' }, { value: '30', label: '30×' }] })
        if (v) devWalk?.(+v)
        return
      }
      if (!guardianAvailable()) { toast('需要安裝 Android App 才能測試背景功能', { icon: 'shield', color: 'var(--blue)' }); return }
      if (kind === 'stop') {
        await stopGuardian()
        document.querySelector('.walk-panel [data-w="stop"]')?.click()
        toast('已停止所有模擬與守護', { icon: 'stop', color: 'var(--gray)' })
        return
      }
      if (guardianState.running) await stopGuardian()
      await startGuardian(sim)
      if (kind === 'bg') {
        toast('背景模擬已開始：按主畫面鍵切到其他 App，接近危險路口時會跳出提醒', { icon: 'shield', color: 'var(--indigo)', ms: 5000 })
      } else {
        toast('模擬已開始，正在打開 Google 地圖導航', { icon: 'route', color: 'var(--green)', ms: 3000 })
        setTimeout(() => openNavigation(r.end, r.mode).catch((err) => toastError(err.message || '無法打開地圖')), 900)
      }
      if (!(await overlayAllowed())) setTimeout(() => toast('懸浮視窗權限未開啟：只會有系統通知，看不到靈動島與小圖示', { icon: 'sparkles', color: '#000', ms: 5000 }), 1200)
    } catch (err) {
      toastError(err.message || '無法開始模擬')
    }
  }

  p.el.addEventListener('click', (e) => {
    const pref = e.target.closest('[data-pref]')?.dataset.pref
    if (pref) return pickPref(pref)
    const d = e.target.closest('[data-dev]')?.dataset.dev
    if (d) return dev(d)
    if (e.target.closest('[data-test]')) test(true)
    if (e.target.closest('[data-admin]')) openAdmin()
    if (e.target.closest('[data-family]')) openFamily()
    if (e.target.closest('[data-gmode]')) pickMode()
    if (e.target.closest('[data-overlay]')) requestOverlay().then((r) => { if (r?.allowed) toast('靈動島提醒已開啟', { icon: 'sparkles', color: '#000' }); else toast('請在接下來的頁面開啟「有路安」的權限，再回到 App', { icon: 'sparkles', color: '#000', ms: 5000 }) }).catch((err) => toastError(err.message))
    if (e.target.closest('[data-gtest]')) testGuardianAlert().then(() => toast('已送出測試通知，請看螢幕上方', { icon: 'shield', color: 'var(--blue)' })).catch((err) => toastError(err.message || '無法送出通知'))
  })
  $('.srv', p.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.target.blur(); test(true) } })
  let shown = false
  return { el: p.el, onShow() { if (!shown && getServer()) { shown = true; test(false); refreshInfo() } } }
}
