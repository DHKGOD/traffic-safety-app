// 設定：伺服器位址（換雲端不必重新打包）、外觀、後台、關於
import { api, deviceId, getServer, isNative, normalize, setServer } from '../api.js'
import { icon } from '../icons.js'
import { emit, startPolling } from '../store.js'
import { $, DISCLAIMER, esc, fmt, makePage, segmented, toast, toastError } from '../ui.js'

export function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  try { localStorage.setItem('theme', t) } catch { /* ignore */ }
  window.dispatchEvent(new Event('themechange'))
}
export const savedTheme = () => { try { return localStorage.getItem('theme') || 'auto' } catch { return 'auto' } }

/** 測試連線，回傳 health 結果 */
export async function testServer(url) {
  return api('/api/health', { server: normalize(url), timeout: 6000 })
}

export function settingsView({ openAdmin }) {
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
          <span class="cell-main server-status c-2">尚未測試</span>
          <button class="btn btn-tinted btn-small" data-test>測試並儲存</button>
        </div>
      </div>
      <div class="section-footer">本機模擬雲端：在電腦執行 start_server.bat，畫面會顯示要輸入的網址（手機需連同一個 Wi-Fi）。搬到雲端主機後，只要在這裡改成新網址即可，不用重新安裝 App。</div>
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
          <span class="cell-main"><span class="cell-title" style="display:block">後台：資料庫狀態</span></span>
          <span class="cell-value db-count"></span><span class="chev">${icon('chevronRight')}</span>
        </button>
        <div class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--purple)">${icon('sparkles')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">AI 模型</span></span>
          <span class="cell-value ai-ver">—</span>
        </div>
        <div class="cell" style="--sep-inset:58px">
          <span class="cell-icon" style="background:var(--gray)">${icon('person')}</span>
          <span class="cell-main"><span class="cell-title" style="display:block">匿名裝置代碼</span></span>
          <span class="cell-value t-footnote">${esc(deviceId())}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="app-icon-hero">
        <div class="app-icon">${icon('warningFill')}</div>
        <div class="t-headline">路口安全通</div>
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
      const active = models.find((m) => m.is_active)
      $('.ai-ver', p.el).textContent = active ? `${active.name} v${active.version}` : '尚未訓練'
    } catch { /* 離線 */ }
  }
  p.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-test]')) test(true)
    if (e.target.closest('[data-admin]')) openAdmin()
  })
  $('.srv', p.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.target.blur(); test(true) } })
  let shown = false
  return { el: p.el, onShow() { if (!shown && getServer()) { shown = true; test(false); refreshInfo() } } }
}
