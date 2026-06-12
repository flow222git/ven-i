# HRV 進階分析（頻域四指數）設計

**日期：** 2026-06-12
**狀態：** 設計定案（使用者已核可），待寫實作計畫
**範圍：** 在已上線的相機 PPG HRV 工具上，新增「進階分析」模式：延長量測至約 2 分鐘、做頻域分析，推導壓力／放鬆／活力／情緒反應靈活度四指數。MVP 的 60 秒快測保留不變。

---

## 1. 目的與定位
讓使用者除了 60 秒快測（HR/RMSSD/狀態），還能做一次**約 2 分鐘的進階量測**，得到四個熟悉的指數（沿用其舊儀器框架）。**定位：相對參考級、看自己趨勢，非舊儀器數值、非醫療診斷。** LF/HF 當「壓力」在學界有爭議、相機 PPG 頻域本就粗，故全程「相對參考」框架。

## 2. 入口與模式
- HRV 說明頁（`renderIntro`）現有「開始量測」鈕之外，新增第二顆「**進階分析（約 2 分鐘）**」鈕。
- 兩模式共用同一套相機擷取/即時回饋/品質把關/鏡頭鎖定/偽差校正，只差**量測長度**與**結果計算**。
- 用 `session.advanced`（bool）標記目前模式。

## 3. 量測
- 進階模式 `MEASURE_SEC = 120`（快測仍 60）。品質燈綠才開始倒數；中途掉訊號處理同 MVP。
- 收集整段樣本，結束交給結果計算。

## 4. 頻域分析（可測純模組 `hrv-freq.js`，`window.HrvFreq`）
純函式、不碰 DOM/相機：
- `resampleRr(rr, fs)`：RR 間隔(ms)→等間隔 tachogram。以累積拍時間建序列，線性內插到 `fs` Hz（預設 4Hz）等距格點，回 `{series, fs}`。
- `fft(re, im)`：就地 radix-2 FFT（長度需 2 的次方）。
- `bandPowers(series, fs)`：去均值＋去線性趨勢→Hanning 窗→補零至 2 次方長度→FFT→週期圖（功率譜密度）→在頻帶積分：
  - `lf`：0.04–0.15 Hz；`hf`：0.15–0.40 Hz；`total`：0.0033–0.40 Hz（VLF+LF+HF）。
  - 回 `{lf, hf, total, lfhf: lf/hf}`。
- `indices(bp, td)`：bp＝bandPowers，td＝時域 `{sdnn, rmssd}`。回四指數，每個 `{score(0-100), level('high'|'mid'|'low'), label('高'|'中'|'低'), advice}`：
  - **relax 放鬆** ← HF（副交感/休息）：`score = scoreLog(hf, 20, 2000)`。
  - **stress 壓力** ← LF/HF（交感主導）：`score = scoreLin(lfhf, 0.5, 4)`。
  - **vitality 活力** ← total（整體自律活性）：`score = scoreLog(total, 100, 8000)`。
  - **flexibility 情緒反應靈活度** ← SDNN（整體變異）：`score = scoreLog(sdnn, 10, 120)`。
  - `scoreLog(x,lo,hi)=clamp(100*(ln(x)-ln(lo))/(ln(hi)-ln(lo)),0,100)`；`scoreLin` 同理線性。level：≥67 高／34–66 中／<34 低。
  - **參考範圍為相對校準的合理估值、非臨床常模**（spec 明列，實作照此）。

## 5. 結果頁（混合式呈現）
- 最上方顯眼**免責卡**：「進階分析為**相對參考**——看自己的趨勢就好，不等於你舊儀器的數值，也非醫療診斷。相機量測受光線/晃動影響，數值會浮動。」
- 四張**指數卡**，每張：指數名＋**分數條(0–100)**＋**高/中/低**標籤＋一句白話 `advice`。
- 也顯示基本：HR、RMSSD（沿用快測的時域）。
- 「再量一次」「看趨勢」。

## 6. 誠實把關（比照 RMSSD）
2 分鐘內若**清理後 RR 太少**（例如 `< 60` 個有效 RR，2 分鐘正常應有 ~120）或**訊號品質太差**（`signalQuality==='red'` 或 HR 不合理）→ **不出四指數**，改顯示「這次訊號不夠穩，給你基本結果（HR＋狀態）＋建議重量」。寧可不給，不給假數字。

## 7. 儲存與趨勢
- 進階結果寫一筆 `{source:'HRV', id, recordId, ts, hr, rmssd, sdnn, state, adv:true, stress, relax, vitality, flexibility}` 到 daily linked[]（明文一般記錄，不加密，沿用 MVP）。
- 趨勢：可看四指數隨時間（沿用既有趨勢頁，進階記錄多畫四指數；或先沿用 RMSSD 折線，四指數列點看）。

## 8. 架構與單元
- Create `hrv/hrv-freq.js`：頻域純模組（§4），headless 可測。
- Modify `hrv/index.html`：入口加第二鈕、量測長度依模式、結果頁進階分支（呼叫 HrvFreq）、載入 hrv-freq.js。
- 沿用既有 `hrv-analyze.js`（detectBeats/rrFromBeats/cleanRr/metricsFromRr/signalQuality）。

## 9. 測試
- `hrv-freq.js` 用**合成 tachogram**測：
  - resampleRr：已知 RR → 等間隔序列長度/值正確。
  - fft：已知餘弦 → 譜峰落正確 bin。
  - bandPowers：合成 0.25Hz 正弦(HF) → HF≫LF；0.10Hz 正弦(LF) → LF≫HF；驗 lfhf。
  - indices：高 HF→放鬆高分；高 LF/HF→壓力高分；邊界與 level 對應。
- 120 秒量測＋UI（相機/Firestore）→ 無法 headless，靠實機 smoke。

## 10. 範圍外／未來
- 5 分鐘標準量測、Lomb-Scargle（免重採樣）、呼吸節律導引、與舊儀器數值校準 → 後續。
