// 家人模式：替長輩設定常走路線（分享代碼存在資料庫）、常用路線、長輩模式
import { Share } from '@capacitor/share'
import { api, isNative } from '../api.js'
import { deleteRoute, elderMode, saveRoute, savedRoutes, setElderMode } from '../family.js'
import { icon } from '../icons.js'
import { MODE_LABEL, on, setRoute, state } from '../store.js'
import { $, actionSheet, el, esc, fmt, haptic, makePage, modal, toast, toastError } from '../ui.js'

export function familyView({ goMap }) {
  const p = makePage({ title: '家人模式', back: '設定' })

  function render() {
    const r = state.route
    const list = savedRoutes()
    p.body.innerHTML = `
      <div class="section" style="margin-top:4px">
        <div class="card" style="display:flex;gap:14px;align-items:flex-start">
          <span class="cell-icon" style="background:var(--teal);width:44px;height:44px;border-radius:12px;font-size:24px">${icon('family')}</span>
          <div style="flex:1">
            <div class="t-headline">替長輩設定常走的路線</div>
            <div class="t-subhead c-2" style="margin-top:2px">在你的手機規劃好路線，產生代碼；長輩的手機輸入代碼就能下載，開啟背景守護後會在危險路口提醒。</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">目前路線</div>
        <div class="list">${r ? `
          <div class="cell" style="--sep-inset:58px">
            <span class="cell-icon" style="background:var(--blue)">${icon('route')}</span>
            <span class="cell-main"><span class="cell-title" style="display:block">${esc(r.start.name)} → ${esc(r.end.name)}</span>
            <span class="cell-sub" style="display:block">${MODE_LABEL[r.mode] || '步行'}・${fmt.dist(r.distance_m)}</span></span>
          </div>
          <button class="cell tappable" data-save style="--sep-inset:58px;color:var(--blue)">${icon('plusCircle')}<span>儲存為常用路線</span></button>
          <button class="cell tappable" data-share style="--sep-inset:58px;color:var(--blue)">${icon('share')}<span>分享給家人（產生代碼）</span></button>` : `
          <div class="cell" style="--sep-inset:58px">
            <span class="cell-icon" style="background:var(--gray)">${icon('map')}</span>
            <span class="cell-main"><span class="cell-title" style="display:block">目前沒有路線（探索模式）</span>
            <span class="cell-sub" style="display:block">先在地圖規劃一條路線，才能儲存或分享</span></span>
          </div>`}
        </div>
        <div class="section-footer">要換路線，回到地圖點搜尋列「規劃路線」。</div>
      </div>

      <div class="section">
        <div class="section-header">收到家人的代碼</div>
        <div class="list">
          <div class="cell">
            <span style="color:var(--teal)">${icon('family')}</span>
            <input type="text" class="code-in" maxlength="6" placeholder="輸入 6 碼代碼" autocapitalize="characters" autocomplete="off" spellcheck="false" style="letter-spacing:.2em;font-weight:600">
            <button class="btn btn-tinted btn-small" data-fetch>下載</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">常用路線</div>
        <div class="list saved">
          ${list.length ? list.map((s, i) => `
            <button class="cell tappable" data-i="${i}" style="--sep-inset:58px">
              <span class="cell-icon" style="background:${s.forElder ? 'var(--teal)' : 'var(--indigo)'}">${icon(s.forElder ? 'family' : 'route')}</span>
              <span class="cell-main"><span class="cell-title" style="display:block">${esc(s.name)}</span>
              <span class="cell-sub" style="display:block">${esc(s.start.name)} → ${esc(s.end.name)}・${fmt.dist(s.distance_m)}</span></span>
              <span class="chev">${icon('chevronRight')}</span>
            </button>`).join('') : '<div class="cell"><span class="cell-sub">還沒有常用路線</span></div>'}
        </div>
      </div>

      <div class="section">
        <div class="section-header">長輩模式</div>
        <div class="list">
          <label class="cell" style="--sep-inset:58px">
            <span class="cell-icon" style="background:var(--orange)">${icon('person')}</span>
            <span class="cell-main"><span class="cell-title" style="display:block">長輩模式</span>
            <span class="cell-sub" style="display:block;white-space:normal">字放大、提早提醒、語音放慢</span></span>
            <input type="checkbox" class="switch elder-sw" ${elderMode() ? 'checked' : ''}>
          </label>
        </div>
        <div class="section-footer">開啟後，背景守護的提醒距離加大 1.3 倍、語音說慢一點，AI 情境預測預設「65 歲以上」。</div>
      </div>`
  }

  async function shareCurrent() {
    const r = state.route
    const name = r.demo ? `${r.start.name} → ${r.end.name}` : r.name || `${r.start.name} → ${r.end.name}`
    try {
      const res = await api('/api/routes', {
        method: 'POST',
        body: { name, mode: r.mode || 'foot', start_name: r.start.name, end_name: r.end.name, points: r.points,
                distance_m: r.distance_m, duration_s: r.duration_s, for_elder: true },
      })
      haptic(15)
      const text = `用「有路安」App →「設定」→「家人模式」輸入代碼 ${res.code}，就能看到我幫你設定的路線：${r.start.name} → ${r.end.name}（30 天內有效）`
      const content = el(`
        <div style="text-align:center;padding:24px 4px">
          <div class="t-subhead c-2">請長輩在 App 輸入這組代碼</div>
          <div class="share-code">${res.code.split('').map((c) => `<span>${c}</span>`).join('')}</div>
          <div class="t-footnote c-2">${esc(r.start.name)} → ${esc(r.end.name)}・30 天內有效・已存進資料庫</div>
          <button class="btn btn-primary btn-block" data-sh style="margin-top:26px">${icon('share')}傳給家人</button>
          <button class="btn btn-gray btn-block" data-cp style="margin-top:10px">複製代碼</button>
        </div>`)
      const m = modal({ title: '分享路線', left: '完成', content })
      $('[data-sh]', content).addEventListener('click', async () => {
        try {
          if (isNative()) await Share.share({ title: '有路安：分享路線', text, dialogTitle: '傳給家人' })
          else if (navigator.share) await navigator.share({ title: '有路安', text })
          else { await navigator.clipboard.writeText(text); toast('已複製分享文字') }
        } catch { /* 使用者取消 */ }
      })
      $('[data-cp]', content).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(res.code); toast('已複製代碼') } catch { toastError('無法複製，請手動記下代碼') }
      })
      return m
    } catch (e) {
      toastError(e.message)
    }
  }

  async function fetchCode() {
    const code = $('.code-in', p.el).value.trim().toUpperCase()
    if (code.length !== 6) return toastError('代碼是 6 個字')
    try {
      const r = await api(`/api/routes/${encodeURIComponent(code)}`)
      const route = {
        name: r.name, start: { name: r.start_name, lat: r.points[0][0], lon: r.points[0][1] },
        end: { name: r.end_name, lat: r.points.at(-1)[0], lon: r.points.at(-1)[1] },
        points: r.points, distance_m: r.distance_m, duration_s: r.duration_s, mode: r.mode, demo: false, forElder: r.for_elder,
      }
      saveRoute(route, r.name)
      setRoute(route)
      if (r.for_elder && !elderMode()) setElderMode(true)
      haptic(15)
      toast(`已下載「${r.name}」${r.for_elder ? '，並開啟長輩模式' : ''}`)
      goMap()
    } catch (e) {
      toastError(e.message)
    }
  }

  p.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-save]')) {
      const r = state.route
      const name = r.demo ? `${r.start.name} → ${r.end.name}` : r.name || `${r.start.name} → ${r.end.name}`
      saveRoute(r, name)
      toast('已儲存為常用路線')
    }
    if (e.target.closest('[data-share]')) shareCurrent()
    if (e.target.closest('[data-fetch]')) fetchCode()
    const item = e.target.closest('.saved [data-i]')
    if (item) {
      const s = savedRoutes()[+item.dataset.i]
      const v = await actionSheet({ title: s.name, message: `${s.start.name} → ${s.end.name}`,
        options: [{ value: 'use', label: '使用這條路線', icon: 'route' }, { value: 'del', label: '刪除' }] })
      if (v === 'use') { setRoute(s); goMap() }
      if (v === 'del') { deleteRoute(s.name); toast('已刪除', { icon: 'xmark', color: 'var(--gray)' }) }
    }
  })
  p.el.addEventListener('change', (e) => {
    if (e.target.classList.contains('elder-sw')) {
      setElderMode(e.target.checked)
      haptic(8)
      toast(e.target.checked ? '已開啟長輩模式' : '已關閉長輩模式', { icon: 'person', color: 'var(--orange)' })
    }
  })
  $('.page-body', p.el).addEventListener('keydown', (e) => { if (e.target.classList.contains('code-in') && e.key === 'Enter') fetchCode() })

  on((type) => { if (type === 'saved-routes' || type === 'route') render() })
  render()
  return { el: p.el, onShow: render }
}
