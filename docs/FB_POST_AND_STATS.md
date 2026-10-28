# 《巷弄尋寶：台灣資收達人》專案數據戰報與社群分享文檔

本文件收錄本次開發的全程時間統計、Token 耗用明細、商業費用對比，以及適合提供給 Gemini Pro 產圖的 Prompt 提示詞。

---

## 📱 一、Facebook 社群貼文草稿（純文字版可直接複製）

```text
常有人問我每個月訂閱那麼多 AI 服務不心痛嗎？
老實說，我現在主力就只訂閱 Google AI Pro，錢真的不要亂花，要花就要好好花在刀口上。

今天下午用 Google 的 Antigravity CLI 搭配開源神級技能「pstack」，隨手搓了一個台灣街頭「撿回收」的手機網頁小遊戲《巷弄尋寶：台灣資收達人》。

剛剛把後台數據拉出來，真的被這套組合的性價比嚇到：

⏱️【今天耗費時間】
• 16:45 需求發起，開始多代理架構競技
• 17:40 完成 TLA+ 數學形式化驗證與後端
• 18:30 Phaser 遊戲完成、紅隊漏洞修復、代碼 0 註解驗收
• 20:30 Cloudflare 正式上線與 GitHub 開源推送
👉 總開發時間：4 小時 33 分鐘（一個下午全端搞定）

📊【今天 Token 狂操用量】
• 總處理 Token 量：94,324,670（約 9,432 萬）
• 快取命中（Cache）：89,426,403（命中率高達 94.8%）
• 實際輸入 Token：4,156,387
• 程式生成輸出：741,880
• 代理人運作：9 組代理、累計 679 個執行步驟

💰【錢花在刀口上的差別】
• 如果走一般商業 API 計費：
  今天這 9,400 萬 Token 大約要噴掉 98 美元（將近 3,150 元台幣）
• 我用 Google AI Pro 方案：
  固定月費約 650 元台幣
👉 光今天一個下午的運算量，就直接把好幾個月的訂閱費賺回來了！

遊戲題材看似很廢：
你要推著阿伯鐵推車在騎樓磨石子路撿紙箱與寶特瓶。誤撿油便當盒會被扣分，看到消防栓 5 公尺紅圈不能推進去（要先停白線格再徒步衝進去撿），小綠人紅燈會被開單，75 秒玩完還幫你洗出一張 880x720 的復古拍立得留念卡。

但背後是 Gemini 4 Argon 搭配 pstack 跑完 13,752 種狀態形式化驗證、紅隊抓漏、25 個檔案強制 0 註解、再加上 Cloudflare Workers 邊緣防作弊。

選對工具，一個月幾百塊的訂閱費就能把軟體做到這種精緻度，真的不用到處亂花錢買一堆噱頭工具。

🎮 免安裝，手機點開直接推車：
https://pstack.tonny.tw

🐙 完整代碼、截圖與驗證規格：
https://github.com/tonnychiulab/taiwan-recycle-hunter

#AntigravityCLI #pstack #Gemini #GoogleAIPro #CloudflareWorkers #Phaser3 #WebGame #撿回收 #省錢開發 #開源
```

---

## 📊 二、產圖用硬核數據表（提供給 Gemini Pro 繪製圖表）

### 1. 核心看板指標 (Key Metrics Card)
- **專案名稱**：《巷弄尋寶：台灣資收達人》（Taiwan Street Recycling Hunter）
- **總開發時間**：4 小時 33 分鐘（2026-10-28 16:45 至 21:18）
- **總處理 Token 數**：94,324,670 Tokens（約 9,432 萬）
- **上下文快取命中量**：89,426,403 Tokens（快取率 94.8%）
- **淨輸入 Token 數**：4,156,387 Tokens
- **模型生成輸出數**：741,880 Tokens
- **多代理人協同**：9 個獨立對話、331 次深度推理、679 個執行步驟
- **程式代碼衛生**：全專案 25 個核心檔案維持 0 註解
- **形式化數學驗證**：TLA+ 窮舉 13,752 狀態無反例，166ms 內 100% 抓出 4/4 違規突變
- **單元測試綠燈數**：22 / 22 測試全數通過（142ms）
- **端到端實機測試**：Playwright iOS WebKit 與 Android Chromium 雙引擎雙視向通過

---

### 2. 六大階段開發時間軸 (Timeline Breakdown)

| 階段 | 時間區段 | 耗時 | 里程碑產出 |
| :--- | :---: | :---: | :--- |
| **Phase 1** | 16:45 - 17:10 | 25 分鐘 | 需求鎖定、雙代理架構競技（Candidate 1 vs 2）與街道資產去背生成 |
| **Phase 2** | 17:10 - 17:40 | 30 分鐘 | 純函式領域狀態機、TLA+ 形式化規格與 Cloudflare Worker 防作弊後端 |
| **Phase 3** | 17:40 - 18:08 | 28 分鐘 | Phaser 3 直橫雙視向引擎、880x720 拍立得合成器與 Playwright 測試 |
| **Phase 4** | 18:08 - 18:30 | 22 分鐘 | 紅隊對抗性審查（修復 5 個真實漏洞）與全代碼庫 0 註解整頓 |
| **Phase 5** | 19:10 - 19:50 | 40 分鐘 | Cloudflare D1 遠端遷移、自訂網域 pstack.tonny.tw 綁定與街景 Favicon |
| **Phase 6** | 19:50 - 20:30 | 40 分鐘 | 直向排版修復、所有開源作者超連結、GitHub 開源倉庫與 README 截圖 |

---

### 3. 多代理模型與 Token 耗用帳本 (Detailed Agent Ledger)

| 代理角色 (Agent Role) | 類型標籤 | 驅動模型 | 步驟 | 未快取輸入 | 快取命中 (Cache) | 生成輸出 | 總處理量 |
| :--- | :--- | :--- | ---:| ---:| ---:| ---:| ---:|
| **主編排代理人 (Lead Orchestrator)** | `main` | Gemini 4 Argon (High) | 529 | 2,758,457 | 75,646,331 | 363,466 | **78,768,254** |
| **架構候選人一 (Candidate 1)** | `poteto-agent` | Gemini 4 Argon (High) | 5 | 74,290 | 84,214 | 43,988 | **202,492** |
| **架構候選人二 (Candidate 2)** | `poteto-agent` | Gemini 4 Argon (High) | 6 | 67,969 | 106,003 | 37,644 | **211,616** |
| **街景美術工程師 (Asset Artist)** | `image-generator` | Gemini 4 Argon (High) | 13 | 84,957 | 112,383 | 10,527 | **207,867** |
| **形式驗證工程師 (Formal Verifier)** | `poteto-worker` | Gemini 4 Argon (High) | 46 | 247,719 | 5,899,767 | 123,943 | **6,271,429** |
| **邊緣防作弊工程師 (Edge Engineer)** | `poteto-worker` | Gemini 4 Argon (High) | 28 | 129,891 | 1,737,596 | 57,260 | **1,924,747** |
| **紅隊對抗審查員 (Interrogator)** | `poteto-agent` | Gemini 4 Argon (High) | 21 | 238,486 | 2,816,607 | 68,485 | **3,123,578** |
| **代碼衛生審查員 (Comment Auditor)** | `comment-sicko` | Gemini 4 Argon (High) | 13 | 217,879 | 1,579,867 | 19,459 | **1,817,205** |
| **決策軌跡審查員 (Trail Auditor)** | `poteto-agent` | Gemini 4 Argon (High) | 18 | 336,739 | 1,443,635 | 17,108 | **1,797,482** |
| **全專案總計 (Grand Total)** | **9 組代理** | **Gemini 家族** | **679** | **4,156,387** | **89,426,403** | **741,880** | **94,324,670** |

---

### 4. 費用效益比較 (Cost vs Value)

| 計費模式 | 計算依據 | 折合新台幣 (NTD) | 效益評語 |
| :--- | :--- | :---: | :--- |
| **商業 API 按量計費 (Pay-as-you-go)** | 4.15M 輸入 ＋ 89.4M 快取 ＋ 741K 輸出 | **約 NT$ 3,150 元**（$98.5 USD） | 一個下午的研發運算量就超過三千台幣 |
| **Google AI Pro 訂閱制** | 每月固定費用 | **約 NT$ 650 元 / 月**（$19.99 USD） | **單日狂操 9,400 萬 Token，直接回本好幾個月訂閱費** |

---

## 🎨 三、給 Gemini Pro 的產圖 Prompt 建議

您可以將下列 Prompt 直接貼給 Gemini Pro 或 Imagen 3 來生成精美的社群配圖：

### Prompt 建議 1：極簡科技感戰報資訊圖（Dashboard / Infographic）
```text
A sleek, modern developer tech dashboard infographic with a dark mode cyberpunk aesthetic, neon cyan, gold, and emerald green accents. 
Main prominent headline: "4.5 HOURS · 94.3M TOKENS PROCESSED".
Key metric cards showing:
- "Development Time: 4h 33m (Zero to Production)"
- "Total Tokens: 94,324,670 Tokens (Cache Rate: 94.8%)"
- "Engineering Stack: pstack multi-agent framework + Antigravity CLI"
- "Models: Gemini 4 Argon & Gemini 3.8 Flash"
- "Formal Verification: TLA+ 13,752 States Verified"
- "Value Comparison: Commercial API $98.50 USD vs. Google AI Pro $19.99/mo (Massive ROI)"
Subtle background features Taiwan alley retro arcade elements, pixel art pushcart, green transformer box, and clean monospace typography. High resolution, ultra crisp, data visualization masterpiece.
```

### Prompt 建議 2：阿伯推車撿回收 2.5D 像素街景宣傳封面
```text
A charming 2.5D retro arcade pixel art banner celebrating a Taiwanese indie web game called "Taiwan Street Recycling Hunter". 
Scene depicts a Taiwanese arcade corridor (騎樓) with traditional red brick walls, green terrazzo tile floor, parked retro scooters, a red fire hydrant with a glowing 5-meter red radius circle, a painted green transformer electrical box, and a traditional metal pushcart loaded with neatly bundled cardboard and transparent water bottles. 
A friendly Taiwanese recycling character pushing the cart safely on the pedestrian crosswalk under a green pedestrian crossing signal (小綠人). 
Warm sunset lighting, nostalgic Taiwanese city atmosphere, sharp details, Studio Ghibli meets 16-bit arcade video game aesthetic.
```

### Prompt 建議 3：對比圖「商業 API 狂噴錢 vs. Google AI Pro 爽快回本」
```text
A humorous and witty comparison graphic for software engineers.
Split screen comparison:
On the left: An open wallet blowing away cash receipts labeled "Commercial Pay-As-You-Go API: $98.50 USD (NT$3,150) for an afternoon of 94M tokens".
On the right: A cool developer calmly sipping bubble tea at a clean workstation with Google AI Pro and Antigravity CLI on the screen, labeled "Google AI Pro Fixed Monthly Subscription: NT$650/mo, 94.3M tokens unlimited value!".
Modern flat vector illustration style, clean infographic layout, tech startup humor, emerald green and Google color palette.
```
