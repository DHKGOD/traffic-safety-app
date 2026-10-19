// 模擬行走：藍點沿 Demo 路線移動，接近危險路口時「語音＋提示音＋紅框」提醒
// （平板常沒有 GPS 與震動，所以用模擬位置與畫面、聲音提醒）
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import { isNative } from './api.js'
import { icon } from './icons.js'
import { L, walkerIcon } from './map-utils.js'
import { $, LEVEL, el, esc, fmt, haptic, segmented } from './ui.js'
import ROUTE from './data/demo-route.json'

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

export function startWalk({ map, hotspots, onOpenReport }) {
  if (!map || document.querySelector('.walk-panel')) return
  const cum = cumulative(ROUTE.points)
  const total = cum.at(-1)
  let dist = 0
  let speed = 4
  let playing = true
  let last = performance.now()
  const alerted = new Set()
  let frame = null
  let alertTimer = null
  const marker = L.marker(ROUTE.points[0], { icon: walkerIcon(), zIndexOffset: 2000 }).addTo(map)
  map.flyTo(ROUTE.points[0], 17, { duration: 0.8 })

  const panel = el(`
    <div class="walk-panel" style="position:fixed;left:12px;right:12px;bottom:calc(var(--tabbar-h) + 12px);z-index:60;max-width:560px;margin:0 auto">
      <div class="walk-alert" style="display:none;margin-bottom:10px"></div>
      <div class="route-card" style="flex-direction:column;align-items:stretch;gap:10px;padding:14px">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="cell-icon" style="background:var(--blue);width:40px;height:40px;border-radius:12px;font-size:22px">${icon('walk')}</span>
          <div style="flex:1;min-width:0">
            <div class="t-headline">模擬行走中</div>
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
    [{ value: '1', label: '1× 步行' }, { value: '4', label: '4×' }, { value: '10', label: '10×' }, { value: '25', label: '25×' }],
    String(speed), (v) => { speed = +v }))

  // 第一次互動時解鎖音效（瀏覽器規定要使用者觸發）
  beep()

  function showAlert(h) {
    haptic(300)
    beep()
    const top = h.name
    speak(`注意，前方約${Math.round(h.__ahead)}公尺是危險路口，${top}，歷史事故${h.filtered_count}件，請減速並注意左右來車`)
    frame?.remove()
    frame = document.body.appendChild(el('<div class="alert-frame"></div>'))
    const box = $('.walk-alert', panel)
    box.style.display = 'block'
    box.innerHTML = `
      <button class="route-card" data-w="open" style="width:100%;text-align:left;border:2px solid var(--red);animation:pop-in .4s var(--spring)">
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
      dist = Math.min(total, dist + WALK_MPS * speed * dt)
      const pos = positionAt(ROUTE.points, cum, dist)
      marker.setLatLng(pos)
      if (!map.getBounds().pad(-0.25).contains(pos)) map.panTo(pos, { animate: true, duration: 0.5 })
      $('.walk-prog', panel).style.width = `${(dist / total) * 100}%`
      const ahead = hotspots.filter((h) => h.along_m >= dist - 10).sort((a, b) => a.along_m - b.along_m)[0]
      if (ahead) {
        const gap = ahead.along_m - dist
        $('.walk-next', panel).textContent = `下一個危險路口：${ahead.name}（${fmt.dist(Math.max(0, gap))}）`
        if (gap <= ALERT_M && !alerted.has(ahead.id)) {
          alerted.add(ahead.id)
          ahead.__ahead = Math.max(10, gap)
          showAlert(ahead)
        }
      } else {
        $('.walk-next', panel).textContent = `沒有更多危險路口・剩 ${fmt.dist(total - dist)}`
      }
      if (dist >= total) {
        playing = false
        speak('已抵達目的地，捷運新莊站')
        $('.walk-next', panel).textContent = '已抵達捷運新莊站 🎉'
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

  function stop() {
    panel.remove()
    frame?.remove()
    map.removeLayer(marker)
    clearTimeout(alertTimer)
    try { speechSynthesis?.cancel() } catch { /* ignore */ }
    if (isNative()) TextToSpeech.stop().catch(() => {})
  }
  return { stop }
}
