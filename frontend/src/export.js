// 匯出路口體檢報告：產生一份獨立的 HTML（可列印成 PDF）。
// App 內用 Capacitor Filesystem + Share 分享；網頁版直接下載。
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNative } from './api.js'
import { esc } from './ui.js'

function bars(items, sum) {
  const max = Math.max(1, ...items.map((i) => i.n))
  return items.map((i) => `<tr><td>${esc(i.name)}</td><td class="bar"><span style="width:${(i.n / max) * 100}%"></span></td><td class="n">${i.n}（${Math.round((i.n / Math.max(1, sum)) * 100)}%）</td></tr>`).join('')
}

export function reportHtml(d) {
  const h = d.hotspot
  const s = d.summary
  const hmax = Math.max(1, ...d.hourly)
  const now = new Date()
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>路口體檢報告－${esc(h.name)}</title>
<style>
body{font-family:-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;color:#1c1c1e;max-width:780px;margin:24px auto;padding:0 20px;line-height:1.5}
h1{font-size:28px;margin:4px 0}h2{font-size:18px;margin:28px 0 10px;border-bottom:1px solid #e5e5ea;padding-bottom:6px}
.k{color:#8e8e93;font-size:13px;letter-spacing:.05em}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.s{background:#f2f2f7;border-radius:12px;padding:12px}.s b{font-size:24px;display:block}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:5px 4px}td.bar{width:45%}td.bar span{display:block;height:9px;border-radius:5px;background:#007aff}
td.n{text-align:right;color:#636366;white-space:nowrap}.hours{display:flex;align-items:flex-end;gap:2px;height:90px}.hours i{flex:1;background:#007aff99;border-radius:3px 3px 0 0}
li{margin:6px 0}.foot{margin-top:30px;font-size:12px;color:#8e8e93;border-top:1px solid #e5e5ea;padding-top:10px}
@media print{body{margin:0}}
</style></head><body>
<div class="k">路口體檢報告</div><h1>${esc(h.name)}</h1>
<div>${esc([h.city, h.district].filter(Boolean).join(' '))}・座標 ${h.lat.toFixed(5)}, ${h.lon.toFixed(5)}・風險分數 ${h.risk_score}</div>
<h2>摘要</h2><div class="grid">
<div class="s">事故<b>${s.accidents} 件</b></div><div class="s">受傷<b>${s.injuries} 人</b></div>
<div class="s">雨天占比<b>${Math.round(s.rain_ratio * 100)}%</b></div><div class="s">夜間占比<b>${Math.round(s.night_ratio * 100)}%</b></div></div>
<h2>時段分布（0–23 時）</h2><div class="hours">${d.hourly.map((n) => `<i style="height:${(n / hmax) * 100}%"></i>`).join('')}</div>
<p>最常發生時段：${s.peak_hour}:00–${s.peak_hour + 1}:00</p>
<h2>主要肇因</h2><table>${bars(d.causes, s.accidents)}</table>
<h2>事故型態</h2><table>${bars(d.collisions, s.accidents)}</table>
<h2>涉入車種</h2><table>${bars(d.vehicles, d.vehicles.reduce((a, b) => a + b.n, 0))}</table>
<h2>改善建議</h2><ul>${d.advice.road_user.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
${d.advice.authority.length ? `<h3>給道路管理單位</h3><ul>${d.advice.authority.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
<div class="foot">${esc(d.disclaimer)}。資料來源：內政部警政署即時交通事故資料(A2類) 115 年。產生時間：${now.toLocaleString('zh-TW')}</div>
</body></html>`
}

export async function exportReport(d) {
  const html = reportHtml(d)
  const name = `路口體檢報告_${d.hotspot.name.replace(/[\\/:*?"<>| ]+/g, '_')}.html`
  if (isNative()) {
    const res = await Filesystem.writeFile({ path: name, data: html, directory: Directory.Cache, encoding: Encoding.UTF8 })
    await Share.share({ title: `路口體檢報告－${d.hotspot.name}`, url: res.uri, dialogTitle: '匯出路口體檢報告' })
    return 'shared'
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  return 'downloaded'
}
