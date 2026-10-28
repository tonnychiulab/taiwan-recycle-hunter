# 巷弄尋寶：台灣資收達人 (Taiwan Recycle Hunter)

免安裝 HTML5 手機街頭動作遊戲。玩家推著資源回收手推車穿梭台灣騎樓磨石子走廊與紅磚巷弄，在交通號誌、標線、消防栓與彩繪電信箱之間，依台灣交通與資源回收法規撿取「可再利用資源回收物」，避開不可再生的一般髒污垃圾。

## 核心工程特性

- **雙手機平台與直橫無縫切換**。支援 iOS Safari (WebKit) 與 Android Chrome (Blink)。使用 `DualOrientationTracker` 即時重算虛擬搖桿、動作鍵與鏡頭縮放，旋轉螢幕時不重新整理、不重置局內座標與分數。
- **可再利用資收物 vs. 一般髒污垃圾**。嚴格區分透明寶特瓶、鋁罐、鐵罐、瓦楞紙箱、三色玻璃瓶、廢乾電池與廢資訊品（累積「清、分、壓」三連加成與減碳克數），誤撿油膩便當盒、衛生紙、菸蒂或髒塑膠袋則觸發污染扣分。
- **台灣道路法規狀態機**。實作小綠人三態號誌（綠燈通行、閃光綠燈禁入、紅燈禁行）、消防栓 5 公尺禁推車（推車須先停白線格或黃線 3 秒臨停，再徒步快取）、無號誌巷口八角形「停」標誌 0.4 秒停看聽，以及彩繪電信箱人行道側安全取物規範。
- **自動精彩瞬間拍立得留存**。局內透過 `game.renderer.snapshot()` 與 4 秒冷卻 Top-3 精彩度緩衝區自動抓拍，結算時合成 `880x720` 台味拍立得紀念卡，支援 Web Share API、PNG 下載與長按存圖。
- **零個資匿名排行榜與防作弊**。單一 Cloudflare Worker 同時託管靜態資源與 API，搭配 Cloudflare D1 SQLite 儲存排行。採用 HMAC-SHA256 簽章 Session、伺服器端得分與拾取時間軸合理性驗證，以及加鹽 IP 雜湊限流。
- **台灣開源繁體字型**。內建本地端 Justfont 開放粉圓 (`jf-openhuninn-2.1.ttf`, SIL OFL)，搭配 `Noto Sans TC` 與 `JetBrains Mono`。

## 目錄結構

- `src/shared/contracts.ts` 定義前後端共用的 Branded IDs、Zod 邊界驗證 Schema、資收物目錄與法規常數。
- `src/domain/` 純函式領域核心（街道幾何配置、法規轉移狀態機、拍立得精彩度篩選），零瀏覽器與引擎依賴。
- `src/game/` Phaser 3 場景渲染、雙向視窗配置、Web Audio 合成音效、拍立得 Canvas 合成器與結算介面。
- `worker/` Cloudflare Worker API 路由、HMAC 簽章、台灣街頭匿名代號產生器與防作弊驗證器。
- `migrations/0001_leaderboard.sql` Cloudflare D1 資料表與索引定義。
- `verification/` TLA+ 形式化規格 (`legal_pickup.tla`) 與狀態空間窮舉檢查腳本。
- `scripts/` 資產去背處理、形式化驗證、Playwright 雙引擎 E2E 驗證與 Token 統計腳本。

## 本地開發與完整驗證指令

安裝依賴並套用本地 D1 資料庫遷移。

```bash
npm install
npm run db:migrate:local
```

執行型別檢查、單元測試與形式化狀態機窮舉驗證。

```bash
npm run typecheck
npm test
npm run verify:formal
```

建置前端並啟動本地 Cloudflare Worker + D1 預覽伺服器（預設連接埠 `8788`）。

```bash
npm run preview:edge
```

執行跨引擎（Playwright WebKit + Chromium）直橫雙向端對端實機驗證。

```bash
npm run build
npm run db:migrate:local
npm run verify:e2e
```

匯出完整多代理模型與 Token 耗用帳本至 `.audit/token-usage.tsv`。

```bash
npm run report:tokens
```

## 部署至 Cloudflare

1. 建立遠端 D1 資料庫並將回傳的 `database_id` 填入 `wrangler.jsonc`。

```bash
npx wrangler d1 create taiwan-recycle-leaderboard
```

2. 套用遠端 D1 資料表遷移並設定 Session 簽章密鑰。

```bash
npm run db:migrate:remote
npx wrangler secret put SESSION_SECRET
```

3. 建置並發布至 Cloudflare Workers。

```bash
npm run deploy
```
