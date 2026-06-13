# HRV「身體能量」指標重新設計

**日期：** 2026-06-13
**狀態：** 設計定案（使用者已核可），待寫實作計畫
**範圍：** 把 HRV 工具的輸出從「LF/HF 四指數」改成「**身體能量** hero 分數」（RMSSD＋靜息 HR，跟個人 baseline 比）；收成單一 ~60 秒流程，移除 2 分鐘進階模式與 LF/HF 四指數。
**依據：** 研究簡報 `2026-06-13-hrv-indices-research-briefing.md`（LF/HF 壓力指標已被推翻；超短時相機 PPG 僅 RMSSD＋HR 可信；競品皆走「個人 baseline 的單一溫暖分數」）。

---

## 1. 目的與定位
給使用者一個**有感、想每天量、能驅動自我照顧**的單一指標：「**身體能量**」（同時含「電量＝今天可用能量」與「恢復力＝儲備/恢復」兩個直覺）。**相對參考、看自己趨勢、非醫療。**

## 2. 流程（收成單一量測）
- **移除** 2 分鐘進階模式與 LF/HF 四指數（`hrv-freq.js` 不再使用）。
- 說明頁只有一顆「開始量測」（約 60 秒）。RMSSD＋HR 在 60 秒已可信，足以算身體能量。
- 量測中即時回饋、鏡頭鎖定（後置超廣角）、`rrFromGoodWindows`/`cleanRr` 偽差校正、品質把關 —— **全部沿用**。

## 3. 結果頁
- **主：身體能量 0–100 hero 卡**（大字分數＋顏色＋一句溫暖敘述）。**一開始就給分**；baseline 未足（< 7 次）時加小字「**信心建立中（n/7）**」。
- **可展開細項**：**恢復力**（RMSSD vs 你的常態，高/中/低）＋**平靜**（靜息 HR vs 你的常態，高/中/低）＋原始 HR、RMSSD 數字。
- 常駐**免責**：「身體能量是跟你自己平常比的相對參考，不是醫療診斷。相機量測會受光線與晃動影響。」
- 「再量一次」「看趨勢」。
- **誠實把關**（沿用）：訊號太差/沒量到穩定心跳 → 不給分數，顯示「這次沒量好，再量一次」。

## 4. 身體能量計算（可測純模組 `hrv-energy.js`，`window.HrvEnergy`）
純函式、不碰 DOM/Firestore：

**個人 baseline（Bayesian 混合，讓第一次就有合理分數、隨次數變個人化）**
- 取使用者過去 HRV 記錄的 `rmssd`、`hr`（近 N=14 次）。用 **lnRMSSD**（研究指定）。
- 母體先驗（弱）：`POP_LN_MEAN`（lnRMSSD≈3.6，RMSSD≈37ms）、`POP_LN_SD≈0.55`；`POP_HR_MEAN≈70`、`POP_HR_SD≈10`。先驗強度 `K=4`。
- 有效平均 `effLnMean = (sumPersonalLn + K*POP_LN_MEAN)/(n+K)`；有效變異同理混合 → `effLnSd`。HR 同理。
- `baselineFrom(history)` → `{ effLnMean, effLnSd, effHrMean, effHrSd, n }`。

**分數**
- `energyScore(today, baseline)`，today＝`{rmssd, hr}`：
  - `zR = (ln(rmssd) - effLnMean) / effLnSd`
  - `zH = (hr - effHrMean) / effHrSd`（HR 越低越好 → 用 `-zH`）
  - `z = 0.75*zR + 0.25*(-zH)`
  - `score = clamp(60 + z*16, 0, 100)`（你的常態≈60「平穩」，明顯高於常態→高分；中心偏樂觀讓「正常日」不顯得差，數值可調，測試只驗方向）
  - `level`：≥75 high（充足）／45–74 mid（平穩）／<45 low（偏低）
  - `confidence`：`n>=7 ? 'ok' : 'building'`（building 時結果帶 n）
  - 細項 `recovery`（由 zR 分高/中/低）、`calm`（由 -zH 分高/中/低）
  - 回 `{ score, level, label, advice, confidence, n, recovery, calm }`，advice 為依 level 的白話（high：能量充足、恢復不錯；mid：和平常差不多、穩穩的；low：能量偏低，今天多留點空間休息）。

## 5. 趨勢（動力核心）
- 趨勢頁改畫**身體能量**隨時間（取代/優先於 RMSSD 折線）。各點顯示當次分數與日期。
- 趨勢資料來源沿用既有 HRV 記錄讀回（本機＋登入時雲端）。

## 6. 儲存
- 每次量測寫 `{source:'HRV', id, recordId, ts, hr, rmssd, sdnn, energy, level, state}`（明文一般記錄；`energy`＝身體能量分數）。沿用既有 `jteWriteRecord`。baseline 由歷史 `rmssd/hr` 即時算，不另存。

## 7. 架構與單元
- Create `hrv/hrv-energy.js`：baseline＋身體能量純邏輯（§4），headless 可測。
- Modify `hrv/index.html`：移除進階模式/第二顆鈕/`renderAdvancedResult`/載入 hrv-freq.js；`renderResult`（60秒）改算並顯示身體能量＋細項；趨勢改畫能量；說明頁文案調整。
- 沿用 `hrv-analyze.js`（detectBeats/rrFromGoodWindows/cleanRr/metricsFromRr/signalQuality）。`hrv-freq.js` 留檔但不載入（或一併移除，實作計畫決定）。

## 8. 測試
- `hrv-energy.js`：
  - `baselineFrom`：空歷史→回先驗；累積後 effMean 向個人靠攏；n 正確。
  - `energyScore`：今天 RMSSD ≫ baseline → 高分/recovery 高；≪ → 低分；等於常態 → ~60；HR 偏低 → 微加分；confidence 隨 n（<7 building、≥7 ok）。邊界與 level 對應。
  - 第一次量測（n=0）→ 用先驗給合理分數＋building。
- index.html 量測/相機/趨勢 → 無法 headless 完整測 → 靜態審查＋實機 smoke。

## 9. 範圍外／未來
- 頻域/LF-HF（已移除，不再做）。
- baseline 進階（時段加權、條件一致性檢查）、能量與睡眠/活動整合、提醒回測 → 後續。
- `hrv-freq.js` 是否實體刪除 → 實作計畫定（預設留檔不載入，YAGNI 之後再清）。
