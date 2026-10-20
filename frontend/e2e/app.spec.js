// 端對端測試：模擬真人在手機上把每個功能從頭點到尾。
// 執行：powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1（會先確認伺服器在執行，結束後清除測試資料）
import { appendFileSync, mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const E2E_TAG = 'E2E 自動測試'
// 測試環境沒有 GPU 時 MapLibre 可能無法建立 WebGL，這類訊息不算 App 的錯誤
const IGNORED = [/WebGL/i, /webglcontext/i, /Failed to load resource/i, /highway-shield|road_shield/]

/** 收集頁面上的 JS 錯誤，測試結束時必須是 0 個 */
function watchErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function openApp(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-init')) return // 重新整理時保留狀態
    sessionStorage.setItem('e2e-init', '1')
    localStorage.setItem('serverUrl', location.origin)
    localStorage.removeItem('route')
  })
  await page.goto('/')
  await expect(page.locator('.hs-list .hs-cell').first()).toBeVisible()
}

test.beforeEach(async ({ page }, info) => {
  info.jsErrors = watchErrors(page)
})
test.afterEach(async ({}, info) => {
  expect(info.jsErrors, info.jsErrors.join('\n')).toEqual([])
})

test('地圖首頁：Demo 路線與危險路口清單', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.route-q')).toContainText('輔仁大學')
  await expect(page.locator('.route-q')).toContainText('捷運新莊站')
  const n = await page.locator('.hs-list .hs-cell').count()
  expect(n).toBeGreaterThan(5)
  expect(Number(await page.locator('.s-count').textContent())).toBe(n)
  await expect(page.locator('.conn')).toBeHidden() // 連線正常不顯示（不標「即時」，事故資料是歷史統計）
  await expect(page.locator('.ap-card-note')).toContainText('115 年')
  await expect(page.locator('.leaflet-marker-icon .hs-marker')).toHaveCount(n)
})

test('天候與時段模式（iOS 動作表）', async ({ page }) => {
  await openApp(page)
  const before = Number(await page.locator('.s-acc').textContent())
  await page.locator('[data-root="map"] [data-act="weather"]').click()
  await expect(page.locator('.as-wrap')).toBeVisible()
  await page.locator('.as-btn', { hasText: '雨天' }).click()
  await expect(page.locator('.as-wrap')).toHaveCount(0)
  await expect(page.locator('[data-root="map"] [data-act="weather"]')).toContainText('雨天')
  await expect(page.locator('[data-root="map"] [data-act="weather"]')).toHaveClass(/on/)
  await expect(page.locator('.hs-list .skeleton')).toHaveCount(0)
  const rain = Number((await page.locator('.s-acc').textContent()).replace(/,/g, ''))
  expect(rain).toBeLessThan(before)

  await page.locator('[data-root="map"] [data-act="period"]').click()
  await page.locator('.as-btn', { hasText: '夜間' }).click()
  await expect(page.locator('[data-root="map"] [data-act="period"]')).toContainText('20–5 點')
  // 取消不應改變模式
  await page.locator('[data-root="map"] [data-act="period"]').click()
  await page.locator('.as-cancel').click()
  await expect(page.locator('[data-root="map"] [data-act="period"]')).toContainText('20–5 點')
  // 排行頁的模式要同步
  await page.locator('[data-tab="rank"]').click()
  await expect(page.locator('.rank-head')).toContainText('雨天')
  await expect(page.locator('[data-root="rank"] [data-act="weather"]')).toHaveClass(/on/)
  // 在排行頁改時段，地圖頁也要同步
  await page.locator('[data-root="rank"] [data-act="period"]').click()
  await page.locator('.as-btn', { hasText: '早上' }).click()
  await expect(page.locator('.rank-head')).toContainText('6–9 點')
  await page.locator('[data-tab="map"]').click()
  await expect(page.locator('[data-root="map"] [data-act="period"]')).toContainText('6–9 點')
})

const RAINY = {
  available: true, suggested_mode: 'rain', reason: '附近測站過去 1 小時雨量 3.5 mm', raining: true,
  rain_1h_mm: 3.5, pop_percent: 80,
  station: { name: '新莊', id: 'C0ACA0', county: '新北市', town: '新莊區', distance_km: 2.3, obs_time: '2026-10-20T08:30:00+08:00' },
  forecast: { start: '2026-10-20T06:00:00+08:00', end: '2026-10-20T09:00:00+08:00', pop: 80, weather: '短暫陣雨', next: null },
  thresholds: { rain_mm: 0.5, pop_percent: 60 }, source: '中央氣象署開放資料',
}

test('天候自動模式：附近下雨時自動切到雨天，手動選擇會關閉自動', async ({ page }) => {
  let weather = RAINY
  await page.route('**/api/weather/now?**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(weather) }))
  await openApp(page)
  const chip = page.locator('[data-root="map"] [data-act="weather"]')
  const before = Number((await page.locator('.s-acc').textContent()).replace(/,/g, ''))
  await chip.click()
  await expect(page.locator('.as-title small')).toContainText('新莊區 短暫陣雨・降雨機率 80%・1 小時雨量 3.5 mm')
  await page.locator('.as-btn', { hasText: '自動' }).click()
  await expect(chip).toContainText('自動・雨天')
  await expect(chip).toHaveClass(/rain/)
  await expect(page.locator('.toast', { hasText: '已切換雨天模式' })).toBeVisible()
  await expect(page.locator('.hs-list .skeleton')).toHaveCount(0)
  expect(Number((await page.locator('.s-acc').textContent()).replace(/,/g, ''))).toBeLessThan(before)
  // 排行頁同步顯示自動
  await page.locator('[data-tab="rank"]').click()
  await expect(page.locator('[data-root="rank"] [data-act="weather"]')).toContainText('自動・雨天')
  await page.locator('[data-tab="map"]').click()
  // 重新開啟 App：自動模式要保留，且依最新天氣（雨停）切到晴天
  weather = { ...RAINY, suggested_mode: 'clear', reason: '附近沒有下雨，降雨機率 10%', raining: false, rain_1h_mm: 0, pop_percent: 10,
    forecast: { ...RAINY.forecast, pop: 10, weather: '多雲' } }
  await page.reload()
  await expect(chip).toContainText('自動・晴天')
  // 手動選「全部天候」→ 關閉自動
  await chip.click()
  await expect(page.locator('.as-btn.sel')).toContainText('自動')
  await page.locator('.as-btn', { hasText: '全部天候' }).click()
  await expect(chip).not.toContainText('自動')
  await expect(chip).not.toHaveClass(/on/)
  await page.reload()
  await expect(chip).not.toContainText('自動')
})

test('天候自動模式：伺服器沒有氣象署授權碼時不顯示「自動」', async ({ page }) => {
  await page.route('**/api/weather/now?**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ available: false, reason: '伺服器未設定氣象署授權碼' }) }))
  await openApp(page)
  await page.waitForTimeout(500)
  await page.locator('[data-root="map"] [data-act="weather"]').click()
  await expect(page.locator('.as-btn', { hasText: '雨天' })).toBeVisible()
  await expect(page.locator('.as-btn', { hasText: '自動' })).toHaveCount(0)
  await expect(page.locator('.as-title small')).toHaveText('依事故發生時的天候篩選危險路口')
})

test('路口體檢報告：圖表、建議、匯出、返回', async ({ page }) => {
  await openApp(page)
  const first = page.locator('.hs-list .hs-cell').first()
  const name = (await first.locator('.cell-title').textContent()).trim()
  await first.click() // 第一次：選取並在地圖上顯示
  await first.click() // 第二次：開啟報告
  const report = page.locator('.page', { has: page.locator('.report-hero') }).last()
  await expect(report.locator('.report-hero .t-title1')).toHaveText(name)
  await expect(report.locator('.stat-value').first()).toBeVisible()
  await expect(report.locator('.bars').first().locator('.bar')).toHaveCount(24)
  await expect(report.locator('.advice-item').first()).toBeVisible()
  const download = page.waitForEvent('download')
  await report.locator('[data-export]').click()
  expect((await download).suggestedFilename()).toContain('路口體檢報告')
  await report.locator('[data-back]').click()
  await expect(page.locator('.report-hero')).toHaveCount(0)
})

test('AI 情境預測：切換情境會重新預測並記錄模型版本', async ({ page, request }) => {
  await openApp(page)
  const first = page.locator('.hs-list .hs-cell').first()
  await first.click()
  await first.click()
  const card = page.locator('.ai-card')
  await expect(card).toBeVisible()
  await expect(card.locator('.hbar-label')).toHaveCount(5)
  const id1 = Number((await card.locator('.legend').textContent()).match(/#(\d+)/)[1])
  const top1 = await card.locator('.hbar-label span').first().textContent()
  // 改成「雨天」「65 歲以上」
  await card.locator('[data-ai="weather"]').click()
  await page.locator('.as-btn', { hasText: '雨天' }).click()
  await expect(page.locator('.ai-card [data-ai="weather"]')).toContainText('雨天')
  await page.locator('.ai-card [data-ai="age"]').click()
  await page.locator('.as-btn', { hasText: '65 歲以上' }).click()
  await expect(page.locator('.ai-card [data-ai="age"]')).toContainText('65 歲以上')
  const legend = await page.locator('.ai-card .legend').textContent()
  const id2 = Number(legend.match(/#(\d+)/)[1])
  expect(id2).toBeGreaterThan(id1)
  // 從 API 回查這筆預測用的是哪一版模型、輸入了什麼情境
  const rec = await (await request.get(`/api/ai/predictions/${id2}`)).json()
  expect(rec.model_name).toBe('cause_scenario')
  expect(rec.input.scenario).toMatchObject({ weather: 'rain', age: 'senior' })
  expect(top1).toBeTruthy()
})

test('規劃路線：目前位置（台北車站）→ 搜尋「苗栗車站」→ 汽機車', async ({ page }) => {
  test.setTimeout(120_000)
  await openApp(page)
  await page.locator('[data-act="plan"]').click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('.in-from')).toHaveValue('目前位置')
  await modal.locator('.in-to').fill('苗栗車站')
  await expect(modal.locator('.results [data-k="result"]').first()).toBeVisible({ timeout: 20_000 })
  await modal.locator('.results [data-k="result"]').first().click()
  await expect(modal.locator('.in-to')).toHaveValue(/苗栗/)
  await modal.locator('.segmented button', { hasText: '汽機車' }).click()
  await modal.locator('.go').click()
  await expect(modal).toHaveCount(0, { timeout: 45_000 })
  await expect(page.locator('.route-q')).toContainText('苗栗')
  await expect(page.locator('[data-act="demo"]')).toBeVisible()
  await expect(page.locator('.hs-list .hs-cell').first()).toBeVisible({ timeout: 30_000 })
  // 沿路距離要由近到遠
  const subs = await page.locator('.hs-list .cell-sub').allTextContents()
  const km = subs.map((s) => { const m = s.match(/距起點 ([\d.]+) (公里|公尺)/); return m[2] === '公里' ? +m[1] * 1000 : +m[1] })
  expect(km).toEqual([...km].sort((a, b) => a - b))
  // 重新整理後路線要保留
  await page.reload()
  await expect(page.locator('.route-q')).toContainText('苗栗')
  // 回到 Demo 路線
  await page.locator('[data-act="demo"]').click()
  await expect(page.locator('.route-q')).toContainText('輔仁大學')
  await expect(page.locator('[data-act="demo"]')).toBeHidden()
})

test('規劃路線：交換起訖點、取消不改變路線', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-act="plan"]').click()
  const modal = page.locator('.modal')
  await modal.locator('[data-k="demo"]').click()
  await expect(modal).toHaveCount(0)
  await expect(page.locator('.route-q')).toContainText('輔仁大學')
  await page.locator('[data-act="plan"]').click()
  await page.locator('.modal [data-close]').click()
  await expect(page.locator('.modal')).toHaveCount(0)
  await expect(page.locator('.route-q')).toContainText('輔仁大學')
})

test('模擬行走：接近危險路口時出現紅框與提醒', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-act="walk"]').click()
  const panel = page.locator('.walk-panel')
  await expect(panel).toBeVisible()
  await panel.locator('.segmented button', { hasText: '30×' }).click()
  await expect(page.locator('.alert-frame')).toBeVisible({ timeout: 30_000 })
  await expect(panel.locator('.walk-alert')).toContainText('前方危險路口')
  // 點提醒卡片可開報告
  await panel.locator('[data-w="open"]').click()
  await expect(page.locator('.report-hero')).toBeVisible()
  await panel.locator('[data-w="toggle"]').click() // 暫停
  await panel.locator('[data-w="stop"]').click()
  await expect(page.locator('.walk-panel')).toHaveCount(0)
  await expect(page.locator('.alert-frame')).toHaveCount(0)
  // 行走時抽屜收起、結束後恢復
  await expect(page.locator('.map-page')).not.toHaveClass(/walking/)
})

test('模擬行走：開始時收起抽屜、關閉地圖彈出框', async ({ page }) => {
  await openApp(page)
  const first = page.locator('.hs-list .hs-cell').first()
  await first.click()
  await expect(page.locator('.leaflet-popup')).toBeVisible()
  await page.locator('[data-act="walk"]').click()
  await expect(page.locator('.map-page')).toHaveClass(/walking/)
  await expect(page.locator('.leaflet-popup')).toHaveCount(0)
  // 重複按不會開第二個面板
  await page.locator('[data-act="walk"]').click({ force: true })
  await expect(page.locator('.walk-panel')).toHaveCount(1)
  await page.locator('.walk-panel [data-w="stop"]').click()
  await expect(page.locator('.map-page')).not.toHaveClass(/walking/)
})

test('回報差點被撞：送出 → 資料庫 → 動態牆即時出現', async ({ page, request }) => {
  await openApp(page)
  await page.locator('[data-tab="feed"]').click()
  await page.locator('.feed-list').waitFor()
  await page.locator('button[data-new]').last().click()
  const modal = page.locator('.modal')
  await expect(modal.locator('.sub-map .leaflet-marker-pane, .sub-map canvas, .sub-map .leaflet-gl-layer').first()).toBeAttached()
  await expect(modal.locator('.coord')).toContainText('緯度')
  await modal.locator('[data-cat="hazard"]').click()
  await expect(modal.locator('[data-cat="hazard"]')).toHaveClass(/active/)
  const desc = `${E2E_TAG} ${Date.now()}`
  await modal.locator('textarea').fill(desc)
  await modal.locator('[data-send]').click()
  await expect(modal.locator('.success')).toBeVisible()
  const id = Number((await modal.locator('.success').textContent()).match(/#(\d+)/)[1])
  // 後端（資料庫）查得到
  const rows = await (await request.get('/api/reports?limit=5')).json()
  const row = rows.find((r) => r.id === id)
  expect(row?.description).toBe(desc)
  expect(row?.category).toBe('hazard')
  await modal.locator('[data-done]').click()
  // 動態牆出現這筆
  await expect(page.locator('.feed-list .cell', { hasText: desc })).toBeVisible({ timeout: 12_000 })
})

test('另一台裝置的回報會即時出現在地圖與通知', async ({ page, request }) => {
  await openApp(page)
  await page.waitForTimeout(1500)
  const desc = `${E2E_TAG} 其他裝置 ${Date.now()}`
  const res = await request.post('/api/reports', { data: { lat: 25.0362, lon: 121.4400, category: 'near_miss', description: desc, device_id: 'e2e-other' } })
  expect(res.status()).toBe(201)
  await expect(page.locator('.toast', { hasText: '新回報' })).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('[data-tab="feed"] .badge')).toBeVisible()
  await page.locator('[data-tab="feed"]').click()
  await expect(page.locator('.feed-list .cell', { hasText: desc })).toBeVisible()
  await expect(page.locator('[data-tab="feed"] .badge')).toHaveCount(0)
})

test('排行：附近（GPS 目前位置）／全國、開報告', async ({ page }) => {
  await openApp(page) // 測試環境的定位是台北車站（playwright.config）
  await page.locator('[data-tab="rank"]').click()
  const list = page.locator('[data-root="rank"] .rank-list .hs-cell')
  await expect(list.first()).toBeVisible()
  await expect(page.locator('.rank-head')).toContainText('目前位置 2 公里內')
  await expect(page.locator('[data-root="rank"] .cell-sub').first()).toContainText(/中正區|大同區|萬華區|中山區/)
  await expect(page.locator('[data-root="rank"] .cell-sub').first()).toContainText(/公尺|公里/)
  await page.locator('[data-root="rank"] .segmented button', { hasText: '全國' }).click()
  await expect(page.locator('.rank-head')).toContainText('全國')
  await expect(list.first()).toBeVisible()
  await list.first().click()
  await expect(page.locator('[data-root="rank"] .report-hero')).toBeVisible()
})

test('排行：附近範圍選擇（小地圖同步顯示範圍內危險點、套用後保留）', async ({ page, request }) => {
  await openApp(page)
  await page.locator('[data-tab="rank"]').click()
  await expect(page.locator('[data-radius]')).toContainText('2 公里')
  await page.locator('[data-radius]').click()
  await expect(page.locator('.modal .rp-map')).toBeVisible()
  const num = page.locator('.rp-num')
  await expect(num).toHaveText(/^\d+$/, { timeout: 15_000 })
  await page.locator('.modal .segmented button', { hasText: '5km' }).click()
  const n5 = Number(await num.textContent())
  await page.locator('.modal .segmented button', { hasText: '500m' }).click()
  const n05 = Number(await num.textContent())
  expect(n5).toBeGreaterThan(n05)
  const actual = await request.get('/api/hotspots/near?lat=25.0478&lon=121.5170&radius=500&limit=200')
  expect(n05).toBe((await actual.json()).count) // 稠密市區的小範圍也不能漏算低事故數路口
  await expect(page.locator('.modal .rp-levels')).toContainText('高風險')
  await expect(page.locator('.modal .leaflet-overlay-pane path')).toHaveCount(n05 + 1) // 範圍圈＋每個危險點
  await page.locator('.modal [data-right]').click()
  await expect(page.locator('.rank-head')).toContainText('500 公尺內')
  await expect(page.locator('[data-radius]')).toContainText('500 公尺')
  await page.reload()
  await page.locator('[data-tab="rank"]').click()
  await expect(page.locator('[data-radius]')).toContainText('500 公尺')
})

test('排行：移動位置後返回附近會查詢新位置', async ({ page, context }) => {
  await openApp(page)
  await page.locator('[data-tab="rank"]').click()
  await expect(page.locator('[data-root="rank"] .hs-cell').first()).toBeVisible()
  await page.locator('[data-tab="map"]').click()
  await context.setGeolocation({ latitude: 24.1477, longitude: 120.6736 })
  const updated = page.waitForResponse((res) => {
    const url = new URL(res.url())
    return url.pathname === '/api/hotspots/near' && url.searchParams.get('lat') === '24.14770' && url.searchParams.get('lon') === '120.67360'
  }, { timeout: 15000 })
  await page.locator('[data-tab="rank"]').click()
  expect((await updated).ok()).toBeTruthy()
  await expect(page.locator('[data-root="rank"] .hs-cell').first()).toBeVisible()
  await expect(page.locator('[data-root="rank"] .cell-sub').first()).toContainText(/西區|中區|北區|東區|南區/)
})

test('設定：危險通知偏好會保存；開發者選項可直接開始模擬行走', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-tab="settings"]').click()
  await page.locator('[data-pref="level"]').click()
  await page.locator('.as-btn', { hasText: '只有高風險' }).click()
  await expect(page.locator('.pv-level')).toHaveText('只有高風險')
  await page.locator('[data-pref="distance"]').click()
  await page.locator('.as-btn', { hasText: '提早' }).click()
  await page.locator('label:has([data-sw="voice"])').click()
  await expect(page.locator('[data-sw="voice"]')).not.toBeChecked()
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('alertPrefs')))
  expect(prefs).toMatchObject({ level: 'high', distance: 1.3, voice: false, sound: true, vibrate: true })
  await page.reload()
  await page.locator('[data-tab="settings"]').click()
  await expect(page.locator('.pv-level')).toHaveText('只有高風險')
  await expect(page.locator('[data-sw="voice"]')).not.toBeChecked()
  // 網頁版沒有背景服務：給說明不報錯
  await page.locator('[data-dev="bg"]').click()
  await expect(page.locator('.toast', { hasText: '需要安裝 Android App' })).toBeVisible()
  // 開發者選項：模擬行走 30× → 切到地圖並開始
  await page.locator('[data-dev="walk"]').click()
  await page.locator('.as-btn', { hasText: '30×' }).click()
  await expect(page.locator('.walk-panel')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.walk-panel .segmented button.active')).toHaveText('30×')
  await expect(page.locator('[data-tab="map"]')).toHaveClass(/active/)
  // 只提醒高風險：先經過的中風險路口不應出現紅框提醒，第一個提醒必須是高風險
  await expect(page.locator('.walk-alert')).toContainText('高風險', { timeout: 30_000 })
  await page.locator('.walk-panel [data-w="stop"]').click()
})

test('排行：自訂地區（選縣市→行政區，重開仍保留）', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-tab="rank"]').click()
  await page.locator('[data-root="rank"] .segmented button', { hasText: '自訂' }).click()
  await page.locator('.modal [data-city]', { hasText: '臺中市' }).click()
  await page.locator('.modal [data-dist]', { hasText: '西屯區' }).click()
  await expect(page.locator('.modal')).toHaveCount(0)
  await expect(page.locator('.rank-head')).toContainText('臺中市西屯區')
  await expect(page.locator('[data-root="rank"] .rank-list .hs-cell').first()).toBeVisible()
  await page.reload()
  await page.locator('[data-tab="rank"]').click()
  await expect(page.locator('[data-root="rank"] .segmented button.active')).toHaveText('自訂')
  await expect(page.locator('.rank-head')).toContainText('臺中市西屯區')
  // 更改地區：整個縣市
  await page.locator('[data-change]').click()
  await page.locator('.modal [data-pick-city]').click()
  await expect(page.locator('.rank-head')).toContainText(/^臺中市・/)
})

test('排行：搜尋地區與地點、設為自訂、清除搜尋', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-tab="rank"]').click()
  await page.locator('.rank-search').click()
  await page.locator('.rs-in').fill('板橋')
  await page.locator('.modal [data-area]', { hasText: '新北市板橋區' }).click()
  await expect(page.locator('.rank-head')).toContainText('新北市板橋區')
  await expect(page.locator('.rank-search')).toContainText('新北市板橋區')
  await page.locator('[data-pin]').click()
  await expect(page.locator('[data-root="rank"] .segmented button.active')).toHaveText('自訂')
  await expect(page.locator('.rank-head')).toContainText('新北市板橋區')
  await expect(page.locator('.rank-search')).toContainText('搜尋地區或地點')
  // 地點搜尋（OpenStreetMap）：顯示該地點 2 公里內
  await page.locator('.rank-search').click()
  await page.locator('.rs-in').fill('台中車站')
  const place = page.locator('.modal [data-place]').first()
  await expect(place).toBeVisible({ timeout: 20_000 })
  await place.click()
  await expect(page.locator('.rank-head')).toContainText('2 公里內')
  await page.locator('[data-clear]').click()
  await expect(page.locator('.rank-head')).toContainText('新北市板橋區')
})

test('地圖抽屜：點把手收到最小只剩標題列、往下拖也能收起', async ({ page }) => {
  await openApp(page)
  const sheet = page.locator('.sheet')
  const peekTop = (await sheet.boundingBox()).y
  await page.locator('.sheet-grabber').click()
  await expect(sheet).toHaveClass(/mini/)
  await page.waitForTimeout(600)
  const miniTop = (await sheet.boundingBox()).y
  expect(miniTop).toBeGreaterThan(peekTop + 100)
  await expect(page.locator('.head-count')).toHaveText(/\d+/)
  await page.locator('.sheet-grabber').click()
  await expect(sheet).not.toHaveClass(/mini/)
  // 從清單上往下拖（以前會被清單捲動吃掉）
  await page.waitForTimeout(600)
  const b = await page.locator('.ap-card').boundingBox()
  await page.mouse.move(b.x + 20, b.y + 10)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 20, b.y + 10 + i * 30)
  await page.mouse.up()
  await expect(sheet).toHaveClass(/mini/)
})

test('設定：測試連線、錯誤位址、後台筆數與資料表關係', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-tab="settings"]').click()
  const root = page.locator('[data-root="settings"]')
  await expect(root.locator('.server-status')).toContainText('已連線')
  // 全形符號也要能接受
  const origin = new URL(page.url()).origin.replace('http://', '').replace(':', '：').replace(/\./g, '．')
  await root.locator('.srv').fill(origin)
  await root.locator('[data-test]').click()
  await expect(root.locator('.server-status')).toContainText('已連線')
  await expect(root.locator('.srv')).toHaveValue(new URL(page.url()).origin)
  // 錯誤位址要顯示錯誤，不可存進去
  await root.locator('.srv').fill('http://127.0.0.1:1')
  await root.locator('[data-test]').click()
  await expect(root.locator('.server-status')).toContainText(/無法連線|逾時/)
  expect(await page.evaluate(() => localStorage.getItem('serverUrl'))).toBe(new URL(page.url()).origin)
  // 伺服器回 200 但資料庫異常：也要判定失敗、不可存（Codex 審查 #4）
  await page.route('http://bad-db.test/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ status: 'error', database: { ok: false, error: 'connection refused' } }) }))
  await root.locator('.srv').fill('http://bad-db.test')
  await root.locator('[data-test]').click()
  await expect(root.locator('.server-status')).toContainText('資料庫異常')
  expect(await page.evaluate(() => localStorage.getItem('serverUrl'))).toBe(new URL(page.url()).origin)
  await root.locator('.srv').fill(new URL(page.url()).origin)
  // 後台
  await root.locator('[data-admin]').click()
  await expect(root.locator('.stat-value').first()).toHaveText(/\d{3},\d{3}/)
  await expect(root.locator('.er-row').first()).toBeVisible()
  await expect(root.locator('.cell', { hasText: '當事人' }).locator('.cell-value')).toHaveText(/\d{3},\d{3}/)
})

test('背景守護：網頁版顯示說明、設定頁可選交通方式', async ({ page }) => {
  await openApp(page)
  await page.locator('.fab[data-act="guardian"]').click()
  await expect(page.locator('.toast', { hasText: '需要安裝 Android App' }).last()).toBeVisible()
  await expect(page.locator('.guardian-pill')).toBeHidden()
  await page.locator('[data-tab="settings"]').click()
  const root = page.locator('[data-root="settings"]')
  await expect(root.locator('.g-mode')).toHaveText('自動判斷（依速度）')
  await root.locator('[data-gmode]').click()
  await page.locator('.as-btn', { hasText: '搭公車／捷運' }).click()
  await expect(root.locator('.g-mode')).toContainText('搭公車')
  expect(await page.evaluate(() => localStorage.getItem('guardianMode'))).toBe('transit')
  await root.locator('[data-gtest]').click()
  await expect(page.locator('.toast', { hasText: '需要安裝 Android App' }).last()).toBeVisible()
  // 設定頁顯示的是 App 實際使用的情境預測模型（Codex 審查 #5）
  await expect(root.locator('.ai-ver')).toContainText('情境預測')
})

test('家人模式：分享代碼 → 用代碼下載 → 長輩模式', async ({ page, request }) => {
  await openApp(page)
  await page.locator('[data-tab="settings"]').click()
  const root = page.locator('[data-root="settings"]')
  await root.locator('[data-family]').click()
  await expect(root.locator('.t-large-title, .nav-title').filter({ hasText: '家人模式' }).first()).toBeAttached()
  // 儲存目前路線
  await root.locator('[data-save]').click()
  await expect(root.locator('.saved [data-i]')).toHaveCount(1)
  // 分享 → 產生 6 碼代碼（存進資料庫）
  await root.locator('[data-share]').click()
  const code = (await page.locator('.share-code').innerText()).replace(/\s/g, '')
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  // 記下測試產生的代碼，結束後只清除這些（不誤刪真實分享）
  mkdirSync('test-results', { recursive: true })
  appendFileSync('test-results/e2e-codes.txt', code + '\n')
  const dbRow = await (await request.get(`/api/routes/${code}`)).json()
  expect(dbRow.end_name).toBe('捷運新莊站')
  await page.locator('.modal [data-close]').click()
  // 模擬「長輩的手機」：清掉常用路線，輸入代碼下載
  await page.evaluate(() => localStorage.removeItem('savedRoutes'))
  await page.reload()
  await page.locator('[data-tab="settings"]').click()
  await root.locator('[data-family]').click()
  await root.locator('.code-in').fill(code.toLowerCase())
  await root.locator('[data-fetch]').click()
  await expect(page.locator('[data-root="map"]')).toHaveClass(/active/)
  await expect(page.locator('.route-q')).toContainText('捷運新莊站')
  expect(await page.evaluate(() => document.documentElement.classList.contains('elder'))).toBe(true)
  // 長輩模式下，AI 情境預測預設 65 歲以上
  const first = page.locator('.hs-list .hs-cell').first()
  await first.click()
  await first.click()
  await expect(page.locator('.ai-card [data-ai="age"]')).toContainText('65 歲以上')
  // 錯誤代碼
  await page.locator('[data-tab="settings"]').click()
  await root.locator('[data-family]').click()
  await root.locator('.code-in').fill('ZZZZZZ')
  await root.locator('[data-fetch]').click()
  await expect(page.locator('.toast', { hasText: '找不到這個代碼' })).toBeVisible()
  // 關閉長輩模式
  await root.locator('.elder-sw').click()
  expect(await page.evaluate(() => document.documentElement.classList.contains('elder'))).toBe(false)
})

test('深色模式切換', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-tab="settings"]').click()
  await page.locator('[data-root="settings"] .segmented button', { hasText: '深色' }).click()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(0, 0, 0)')
  await page.locator('[data-root="settings"] .segmented button', { hasText: '自動' }).click()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined()
})

test('@layout 平板橫式：清單在左側面板、分頁列置中', async ({ page }) => {
  await openApp(page)
  const box = await page.locator('.sheet').boundingBox()
  expect(box.width).toBeLessThan(420)
  expect(box.x).toBeGreaterThan(0)
})
