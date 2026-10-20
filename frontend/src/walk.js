// 模擬行走：藍點沿目前路線移動，接近危險路口時「語音＋提示音＋紅框」提醒
// （平板常沒有 GPS 與震動，所以用模擬位置與畫面、聲音提醒）
import { App as CapApp } from '@capacitor/app'
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import { isNative } from './api.js'
import { guardianState, handoffWalk, takeBackWalk, walkAlert } from './guardian.js'
import { alertPrefs, levelPasses } from './alerts.js'
import { icon } from './icons.js'
import { L, walkerIcon } from './map-utils.js'
import { $, LEVEL, el, esc, fmt, haptic, segmented } from './ui.js'

const ALERT_M = 70          // 距離路口多少公尺開始提醒
const WALK_MPS = 1.25       // 一般步行速度（公尺/秒）

function cumulative(points) {
  const R = 6371000
  const out = [0]
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const dLat = ((b[0] - a[0]) * Math.PI) / 180
    const dLon = ((b[1] - a[1]) * Math.PI) / 180
    const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
    out.push(out[i - 1] + 2 * R * Math.asin(Math.sqrt(x)))
  }
  return out
}

function positionAt(points, cum, d) {
  let i = cum.findIndex((c) => c >= d)
  if (i <= 0) return points[i === 0 ? 0 : points.length - 1]
  const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
  return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t]
}

let audioCtx
function beep() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)()
    const t0 = audioCtx.currentTime
    ;[0, 0.22].forEach((off) => {
      const o = audioCtx.createOscillator()
      const g = audioCtx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(880, t0 + off)
      o.frequency.exponentialRampToValueAtTime(1320, t0 + off + 0.12)
      g.gain.setValueAtTime(0.0001, t0 + off)
      g.gain.exponentialRampToValueAtTime(0.35, t0 + off + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.18)
      o.connect(g).connect(audioCtx.destination)
      o.start(t0 + off)
      o.stop(t0 + off + 0.2)
    })
  } catch { /* 沒有音效裝置 */ }
}

async function speak(text) {
  try {
    if (isNative()) {
      await TextToSpeech.stop().catch(() => {})
      await TextToSpeech.speak({ text, lang: 'zh-TW', rate: 1.0, pitch: 1.0, volume: 1.0, category: 'ambient' })
    } else if ('speechSynthesis' in window) {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-TW'
      speechSynthesis.speak(u)
    }
  } catch { /* 沒有中文語音時只用提示音與紅框 */ }
}

export function startWalk({ map, hotspots, route: ROUTE, onOpenReport, onStop, speed: initialSpeed }) {
  const prefs = alertPrefs() // 設定頁「危險通知」
  const BASE_MPS = { foot: WALK_MPS, bike: 4.5, car: 11 }[ROUTE.mode] || WALK_MPS // 依交通方式的實際速度
  const ALERT_AT = ({ foot: ALERT_M, bike: 120, car: 250 }[ROUTE.mode] || ALERT_M) * prefs.distance // 越快越早提醒
  if (!map || document.querySelector('.walk-panel')) return
  const cum = cumulative(ROUTE.points)
  const total = cum.at(-1)
  let dist = 0
  let speed = [1, 4, 10, 30].includes(initialSpeed) ? initialSpeed : 4
  let playing = true
  let last = performance.now()
  const alerted = new Set()
  let frame = null
  let alertTimer = null
  const marker = L.marker(ROUTE.points[0], { icon: walkerIcon(), zIndexOffset: 2000 }).addTo(map)
  try { map.flyTo(ROUTE.points[0], 17, { duration: 0.8 }) } catch { map.setView(ROUTE.points[0], 17, { animate: false }) }

  const panel = el(`
    <div class="walk-panel" style="position:fixed;left:12px;right:12px;bottom:calc(var(--tabbar-h) + 12px);z-index:60;max-width:560px;margin:0 auto">
      <div class="walk-alert" style="display:none;margin-bottom:10px"></div>
      <div class="glass-card" style="flex-direction:column;align-items:stretch;gap:10px;padding:14px">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="cell-icon" style="background:var(--blue);width:40px;height:40px;border-radius:12px;font-size:22px">${icon('walk')}</span>
          <div style="flex:1;min-width:0">
            <div class="t-headline">模擬${{ foot: '步行', bike: '騎車', car: '行車' }[ROUTE.mode] || '行走'}中</div>
            <div class="t-footnote c-2 walk-next">準備出發</div>
          </div>
          <button class="fab" data-w="toggle" style="border-radius:50%;width:44px;height:44px;background:var(--fill)">${icon('pause')}</button>
          <button class="fab" data-w="stop" style="border-radius:50%;width:44px;height:44px;background:var(--fill);color:var(--red)">${icon('xmark')}</button>
        </div>
        <div class="hbar-track" style="height:6px"><div class="walk-prog" style="height:100%;width:0;background:var(--blue);border-radius:3px"></div></div>
        <div class="seg-speed"></div>
      </div>
    </div>`)
  document.body.appendChild(panel)
  $('.seg-speed', panel).replaceWith(segmented(
    [{ value: '1', label: '1× 實際' }, { value: '4', label: '4×' }, { value: '10', label: '10×' }, { value: '30', label: '30×' }],
    String(speed), (v) => { speed = +v }))

  // 第一次互動時解鎖音效（瀏覽器規定要使用者觸發）
  if (prefs.sound) beep()

  function showAlert(h) {
    if (prefs.vibrate) haptic(300)
    if (prefs.sound) beep()
    const tip = ROUTE.mode === 'car' ? '請減速，注意轉彎車與機車' : ROUTE.mode === 'bike' ? '請減速，注意左右來車與開車門' : '過馬路前左右看，別低頭看手機'
    walkAlert(h, h.__ahead, tip) // App 版：同時跳出靈動島／系統通知（依設定，和背景守護一樣）
    if (prefs.voice) speak(`注意，前方約${Math.round(h.__ahead)}公尺是危險路口，${h.name}，歷史事故${h.filtered_count}件，${tip}`)
    frame?.remove()
    frame = document.body.appendChild(el('<div class="alert-frame"></div>'))
    const box = $('.walk-alert', panel)
    box.style.display = 'block'
    box.innerHTML = `
      <button class="glass-card" data-w="open" style="width:100%;text-align:left;border:2px solid var(--red);animation:pop-in .4s var(--spring)">
        <span class="cell-icon" style="background:var(--red);width:40px;height:40px;border-radius:12px;font-size:22px">${icon('warningFill')}</span>
        <span style="flex:1;min-width:0">
          <span class="t-headline" style="display:block;color:var(--red)">前方危險路口・${LEVEL[h.level].label}</span>
          <span class="t-subhead" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.name)}・${h.filtered_count} 件事故</span>
        </span>
        <span class="chev">${icon('chevronRight')}</span>
      </button>`
    box.firstElementChild.__h = h
    clearTimeout(alertTimer)
    alertTimer = setTimeout(() => { frame?.remove(); frame = null; box.style.display = 'none' }, 6000)
  }

  function tick(now) {
    if (!panel.isConnected) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (playing) {
      dist = Math.min(total, dist + BASE_MPS * speed * dt)
      const pos = positionAt(ROUTE.points, cum, dist)
      marker.setLatLng(pos)
      try {
        if (!map.getBounds().pad(-0.25).contains(pos)) map.panTo(pos, { animate: true, duration: 0.5 })
      } catch { /* MapLibre 動畫中偶爾換算座標失敗：下一格再跟 */ }
      $('.walk-prog', panel).style.width = `${(dist / total) * 100}%`
      const ahead = hotspots.filter((h) => h.along_m >= dist - 10).sort((a, b) => a.along_m - b.along_m)[0]
      if (ahead) {
        const gap = ahead.along_m - dist
        $('.walk-next', panel).textContent = `下一個危險路口：${ahead.name}（${fmt.dist(Math.max(0, gap))}）`
        if (gap <= ALERT_AT && !alerted.has(ahead.id)) {
          alerted.add(ahead.id)
          ahead.__ahead = Math.max(10, gap)
          if (levelPasses(ahead.level, prefs)) showAlert(ahead) // 低於設定等級的路口不提醒
        }
      } else {
        $('.walk-next', panel).textContent = `沒有更多危險路口・剩 ${fmt.dist(total - dist)}`
      }
      if (dist >= total) {
        playing = false
        if (prefs.voice) speak(`已抵達目的地，${ROUTE.end.name}`)
        $('.walk-next', panel).textContent = `已抵達 ${ROUTE.end.name}`
        $('[data-w="toggle"]', panel).innerHTML = icon('refresh')
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  panel.addEventListener('click', (e) => {
    const w = e.target.closest('[data-w]')?.dataset.w
    if (w === 'toggle') {
      if (dist >= total) { dist = 0; alerted.clear() }
      playing = !playing || dist === 0
      last = performance.now()
      e.target.closest('[data-w]').innerHTML = icon(playing ? 'pause' : 'play')
    }
    if (w === 'stop') stop()
    if (w === 'open') onOpenReport?.(e.target.closest('[data-w]').__h)
  })

  /* ---------- 切到背景（按主畫面鍵、開 Google 地圖）：交給原生服務繼續模擬並跳通知 ---------- */
  let handoff = null      // { base: 交出時已走的距離 }
  let handing = null      // 交接中的 Promise（避免切換太快時順序錯亂）
  const listeners = []
  async function onBackground() {
    if (!playing || dist >= total || handoff || guardianState.running) return // 已有實際守護在跑就不搶
    const base = dist
    const rest = [positionAt(ROUTE.points, cum, base), ...ROUTE.points.filter((_, i) => cum[i] > base)]
    if (rest.length < 2) return
    handoff = { base }
    handing = handoffWalk({
      points: rest, speed: BASE_MPS * speed, mode: ROUTE.mode,
      hotspots: hotspots.filter((h) => h.along_m >= base - 10), skip: [...alerted],
    }).catch(() => { handoff = null })
    await handing
  }
  async function onForeground() {
    if (!handoff) return
    await handing
    const h = handoff
    handoff = null
    if (!h) return
    let moved = null
    try { moved = await takeBackWalk() } catch { moved = 0 }
    dist = moved === null ? total : Math.min(total, h.base + moved)
    hotspots.forEach((x) => { if (x.along_m < dist) alerted.add(x.id) }) // 背景已經提醒過
    last = performance.now()
    if (dist >= total) {
      marker.setLatLng(ROUTE.points.at(-1))
      $('.walk-next', panel).textContent = `已抵達 ${ROUTE.end.name}`
      $('.walk-prog', panel).style.width = '100%'
      playing = false
      $('[data-w="toggle"]', panel).innerHTML = icon('refresh')
    }
  }
  if (isNative()) {
    CapApp.addListener('pause', onBackground).then((l) => listeners.push(l)).catch(() => {})
    CapApp.addListener('resume', onForeground).then((l) => listeners.push(l)).catch(() => {})
  }

  function stop() {
    listeners.forEach((l) => l.remove())
    if (handoff) { handoff = null; takeBackWalk().catch(() => {}) }
    panel.remove()
    frame?.remove()
    map.removeLayer(marker)
    clearTimeout(alertTimer)
    try { speechSynthesis?.cancel() } catch { /* ignore */ }
    if (isNative()) TextToSpeech.stop().catch(() => {})
    onStop?.()
  }
  return { stop }
}
