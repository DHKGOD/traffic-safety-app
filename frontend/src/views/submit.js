// 新增回報（差點被撞）：由下往上的彈出視窗，拖動地圖調整位置
import { api, deviceId } from '../api.js'
import { icon } from '../icons.js'
import { createMap } from '../map-utils.js'
import { pollReports } from '../store.js'
import { $, $$, el, esc, haptic, modal, toastError } from '../ui.js'

const CATS = [
  { v: 'near_miss', label: '差點被撞', ic: 'hand', color: 'var(--red)' },
  { v: 'hazard', label: '路況危險', ic: 'cone', color: 'var(--orange)' },
  { v: 'other', label: '其他', ic: 'ellipsis', color: 'var(--gray)' },
]

export function openSubmit(pos) {
  let cat = 'near_miss'
  const content = el(`
    <div>
      <div class="section" style="margin-top:8px">
        <div class="cat-grid">${CATS.map((c) => `
          <button class="cat${c.v === cat ? ' active' : ''}" data-cat="${c.v}">
            <span class="cat-ic" style="background:${c.color}">${icon(c.ic)}</span>${c.label}</button>`).join('')}
        </div>
      </div>
      <div class="section">
        <div class="section-header">位置（拖動地圖對準地點）</div>
        <div style="position:relative;height:200px;border-radius:14px;overflow:hidden">
          <div class="sub-map" style="position:absolute;inset:0"></div>
          <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-100%);z-index:500;pointer-events:none">
            <div class="pin" style="background:var(--purple)"><span>!</span></div>
          </div>
        </div>
        <div class="section-footer coord"></div>
      </div>
      <div class="section">
        <div class="section-header">發生什麼事？（選填）</div>
        <div class="list"><div class="cell"><textarea maxlength="500" placeholder="例如：右轉車沒有禮讓行人，差點撞到"></textarea></div></div>
      </div>
      <div class="section">
        <button class="btn btn-primary btn-block" data-send>${icon('bubble')}送出回報</button>
        <div class="section-footer" style="text-align:center">回報會即時顯示在其他使用者的地圖上，不會記錄你的身分</div>
      </div>
    </div>`)

  const m = modal({ title: '回報危險', content })
  const map = createMap($('.sub-map', content), { attributionControl: false })
  map.setView([pos.lat, pos.lon], 18)
  const coord = $('.coord', content)
  const showCoord = () => { const c = map.getCenter(); coord.textContent = `緯度 ${c.lat.toFixed(5)}、經度 ${c.lng.toFixed(5)}` }
  map.on('move', showCoord)
  showCoord()
  setTimeout(() => map.invalidateSize(), 450)

  content.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]')
    if (b) {
      cat = b.dataset.cat
      haptic(6)
      $$('[data-cat]', content).forEach((x) => x.classList.toggle('active', x === b))
    }
  })

  const btn = $('[data-send]', content)
  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.innerHTML = '送出中…'
    const c = map.getCenter()
    try {
      const r = await api('/api/reports', {
        method: 'POST',
        body: { lat: c.lat, lon: c.lng, category: cat, description: $('textarea', content).value.trim() || null, device_id: deviceId() },
      })
      haptic(20)
      m.body.innerHTML = `
        <div class="success">
          <div class="check">${icon('checkmark')}</div>
          <div class="t-title2">已送出回報</div>
          <div class="t-subhead c-2" style="margin-top:6px">編號 #${r.id}${r.hotspot_name ? `・已對應到「${esc(r.hotspot_name)}」` : ''}<br>其他裝置會在幾秒內看到</div>
          <button class="btn btn-gray btn-block" data-done style="margin-top:28px">完成</button>
        </div>`
      $('[data-done]', m.body).addEventListener('click', m.close)
      pollReports(false)
    } catch (e) {
      toastError(e.message)
      btn.disabled = false
      btn.innerHTML = `${icon('bubble')}送出回報`
    }
  })
}
