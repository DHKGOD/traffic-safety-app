// 端對端測試設定：測試對象是 start_server.bat 啟動的伺服器（後端同時提供網頁版前端）
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,               // 共用同一個資料庫，依序執行
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8000',
    ...devices['Galaxy S9+'],  // 手機尺寸、觸控
    viewport: { width: 384, height: 854 },  // 接近 S21 FE 的 CSS 尺寸
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    geolocation: { latitude: 25.0478, longitude: 121.5170 },  // 台北車站
    permissions: ['geolocation'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'phone', use: {}, grepInvert: /@layout/ },
    { name: 'tablet-landscape', use: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: true }, grep: /@layout/ },
  ],
})
