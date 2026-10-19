// 端對端測試：模擬真人在手機上把每個功能從頭點到尾。
// 執行：powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1（會先確認伺服器在執行，結束後清除測試資料）
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
  await expect(page.locator('.conn')).toContainText('即時')
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

test('排行：新莊區／全國切換、開報告', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-tab="rank"]').click()
  const list = page.locator('[data-root="rank"] .rank-list .hs-cell')
  await expect(list.first()).toBeVisible()
  await expect(page.locator('[data-root="rank"] .cell-sub').first()).toContainText('新莊區')
  await page.locator('[data-root="rank"] .segmented button', { hasText: '全國' }).click()
  await expect(page.locator('.rank-head')).toContainText('全國')
  await expect(list.first()).toBeVisible()
  await list.first().click()
  await expect(page.locator('[data-root="rank"] .report-hero')).toBeVisible()
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
  // 後台
  await root.locator('[data-admin]').click()
  await expect(root.locator('.stat-value').first()).toHaveText(/\d{3},\d{3}/)
  await expect(root.locator('.er-row').first()).toBeVisible()
  await expect(root.locator('.cell', { hasText: '當事人' }).locator('.cell-value')).toHaveText(/\d{3},\d{3}/)
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
