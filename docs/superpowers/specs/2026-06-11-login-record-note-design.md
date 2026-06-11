# 問易／卜易 · 登入＋記錄＋筆記 設計

## 背景
ven-i（問易／卜易）目前是純前端原型，結果算完即逝、無法保存。使用者希望能登入、
把每次結果存下來，並在結論下方寫心得筆記，事後可回顧、編輯、刪除。

ven-i 已以「方式 A（子資料夾）」整合進平台 `jte-platform-2026`（同源），而平台早已具備：
- Google 登入（Google Identity Services）+ Firebase/Firestore（`jointoenjoy` 專案）
- 統一記錄庫 `localStorage['jte_daily_v1']`：按日期 key，每天一個物件含 `linked[]`，
  每筆帶 `source`（XiaoQi / BreatheAware / HRVRecord / Activity / TWCT…）
- `fsSync(email, dateKey, data)` 把當日記錄同步到 Firestore `users/{email}/daily/{date}`
- 入口頁「記錄」時間軸依 `source` 渲染各工具卡片
- 既有 helper `jteCheckLoginThenSave(saveFn)`（見 xiaoqi）：未登入先跳 Google 登入、
  存成 pending，登入後執行 save

本設計重用以上基礎建設，不重造登入或雲端。

## 目標
1. 問易與卜易結果頁，結論下方提供「筆記欄 + 存這次／不存」。
2. 存需登入（平常問卦不需登入；按「存這次」才在未登入時跳 Google 登入）。
3. 一筆記錄同時進：平台每日時間軸（`source:'WenYi'`／`'BuYi'`）＋問易內「我的占問歷史」。
4. 記錄可編輯筆記、可刪除整筆，變更同步回 localStorage 與 Firestore。

## 範圍
- **做**：問易 + 卜易 兩種模式（共用同一套機制）。
- **不做**：編輯卦象結果或系統解讀（只編輯使用者自己的筆記）；不新增問易自己的帳號系統。

## 設計

### A. 登入（搬移平台既有機制進 ven-i）
- 在 `<head>` 加入 Google GSI 與 Firebase SDK script（與平台同設定）。
- 移植 `initFirebase()`、Google 登入處理、`jteCheckLoginThenSave(saveFn)`、
  使用者狀態（`localStorage` 的 `jte_user_email/name/picture`）。
- 工具本身免登入可用；登入僅為「存／同步／看歷史」服務。

### B. 存（每次由使用者決定）
- 問易結果頁（約 `index.html` 第 777–976 區段的結論之後）、卜易結果頁（`buyiResult()`
  約 1339 之後）各加一塊「保存區」：
  - 選填 `textarea` 筆記（心得感想）。
  - 按鈕「存這次」／「不存」。
- 「存這次」→ `jteCheckLoginThenSave(() => saveRecord(...))`。

### C. 記錄資料結構（寫入 `linked[]`）
共用欄位：`id`（如 `wy-<ts>` / `by-<ts>`）、`source`、`ts`（ISO）、`note`。
- **問易**（`source:'WenYi'`）：`topic`（主題）、`mainHex`（卦名）、`tri`（三態 好／中性／缺乏）、`summary`（一句狀態摘要）。
- **卜易**（`source:'BuYi'`）：`question`、`ben`（本卦）、`bian`（變卦，可空）、`changing`（動爻陣列）。

### D. 寫入流程
1. 取今日 dateKey → 讀 `jte_daily_v1` → 在當天 `linked[]` push 上述記錄。
2. `localStorage.setItem('jte_daily_v1', …)`。
3. 已登入則 `fsSync(email, dateKey, 當日物件)` 同步 Firestore。

### E. 我的占問歷史（工具內新頁）
- choose 頁／header 增一個入口「我的占問歷史」。
- 讀 `jte_daily_v1`，跨日期攤平 `linked[]`，篩 `source ∈ {WenYi, BuYi}`，依時間倒序列出。
- 每張卡：摘要（卦名／主題或問題、三態或動爻、時間）＋筆記。
- 每張卡操作：**編輯筆記**（inline textarea → 存 → 更新 localStorage + fsSync）、
  **刪除**（移除該 linked 項 → 更新 + fsSync）。
- 需登入才看得到歷史（未登入顯示「登入以查看你的占問歷史」）。

### F. 平台 hub 時間軸渲染（改 `jte-platform-2026/index.html`）
- 在記錄渲染大函式（約 700–760）新增 `source==='WenYi'` 與 `'BuYi'` 兩個分支，
  輸出對應卡片（卦名／主題或問題、三態或動爻、筆記）。

## 開發與維護
- ven-i 在獨立 repo 開發為單一來源；完成後 `cp` 進 `jte-platform-2026/ven-i/`。
- 平台 hub `index.html` 的時間軸分支屬平台專屬，直接在平台 repo 改。
- 兩 repo 各自 commit / push。

## 驗證
1. 平台子站開問易，走完一次 → 結論下方出現筆記欄與「存這次／不存」。
2. 未登入按「存這次」→ 跳 Google 登入 → 登入後該筆已存。
3. 入口頁「記錄」時間軸出現該筆問易卡片（含筆記）。
4. 工具內「我的占問歷史」看得到該筆；編輯筆記後重整仍在；刪除後消失。
5. 卜易重複 1–4。
6. 換瀏覽器以同帳號登入，Firestore 同步的記錄可見（視平台既有同步行為）。
