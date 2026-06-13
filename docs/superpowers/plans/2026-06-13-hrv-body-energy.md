# HRV「身體能量」指標 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 把 HRV 工具輸出改成「身體能量」hero 分數（lnRMSSD＋靜息 HR vs 個人 baseline，0–100＋顏色＋敘述＋恢復力/平靜細項＋趨勢）；收成單一 ~60 秒流程，移除 LF/HF 四指數與 2 分鐘進階模式。

**Architecture:** 身體能量計算抽成可測純模組 `hrv/hrv-energy.js`（baselineFrom／energyScore，Bayesian 混合先驗讓第一次就有合理分數）。`index.html` 移除進階模式、結果頁改顯示身體能量、趨勢改畫能量。沿用 `hrv-analyze.js`（detectBeats/rrFromGoodWindows/cleanRr/metricsFromRr/signalQuality）。

**Tech Stack:** 純前端。hub 子資料夾 `jte-platform-2026/hrv/`，單 repo。測試用 `jte-testrun.py`。

**前置：** HRV MVP 已上線（相機/品質把關/鏡頭鎖定/偽差校正都在）。

---

## File Structure
- Create: `hrv/hrv-energy.js`（`window.HrvEnergy`）、`hrv/hrv-energy.test.html`
- Modify: `hrv/index.html`（移除進階；結果頁/趨勢改身體能量；載入 hrv-energy.js）
- `hrv/hrv-freq.js`：留檔但不再載入（YAGNI，之後再清）

---

## Task 1: 身體能量純模組 baselineFrom / energyScore

**Files:** Create `hrv/hrv-energy.js`、`hrv/hrv-energy.test.html`

- [ ] **Step 1: 建測試頁（assert 框架＋near，載入 hrv-energy.js）**

沿用既有測試頁框架（`check/assert/eq/near/log`、`window.__done`、`fetch('/__result')`）。`<head>` 載入 `hrv-energy.js`。

- [ ] **Step 2: 測項（先紅）**

```javascript
  await check('baselineFrom 空歷史→回母體先驗、n=0', async () => {
    var b=HrvEnergy.baselineFrom([]);
    near(b.effLnMean,3.6,0.01,'effLnMean'); near(b.effLnSd,0.55,0.01,'effLnSd'); eq(b.n,0,'n');
  });
  await check('energyScore：RMSSD 遠高於常態→高分、recovery 高', async () => {
    var e=HrvEnergy.energyScore({rmssd:100,hr:60}, HrvEnergy.baselineFrom([]));
    assert(e.score>=75,'高分，實得 '+e.score); eq(e.recovery.level,'high','recovery 高');
  });
  await check('energyScore：RMSSD 遠低→低分', async () => {
    var e=HrvEnergy.energyScore({rmssd:15,hr:80}, HrvEnergy.baselineFrom([]));
    assert(e.score<=45,'低分，實得 '+e.score);
  });
  await check('energyScore：約等於常態→~60 平穩', async () => {
    var e=HrvEnergy.energyScore({rmssd:37,hr:70}, HrvEnergy.baselineFrom([]));
    near(e.score,60,8,'~60'); eq(e.level,'mid','平穩');
  });
  await check('confidence 隨 n：<7 building、>=7 ok', async () => {
    var few=[],many=[],i;
    for(i=0;i<3;i++) few.push({rmssd:40,hr:68});
    for(i=0;i<8;i++) many.push({rmssd:40,hr:68});
    eq(HrvEnergy.energyScore({rmssd:40,hr:68},HrvEnergy.baselineFrom(few)).confidence,'building','<7');
    eq(HrvEnergy.energyScore({rmssd:40,hr:68},HrvEnergy.baselineFrom(many)).confidence,'ok','>=7');
  });
  await check('baseline 個人化：常態高的人、量到同樣高值→約中（相對自己）', async () => {
    var hi=[]; for(var i=0;i<14;i++) hi.push({rmssd:80,hr:60});
    var b=HrvEnergy.baselineFrom(hi);
    assert(b.effLnMean>3.9,'baseline 向個人靠攏，實得 '+b.effLnMean.toFixed(2));
    var e=HrvEnergy.energyScore({rmssd:80,hr:60}, b);
    near(e.score,60,13,'對自己常態≈中，實得 '+e.score);
  });
```

- [ ] **Step 3: 跑測試確認紅**　`cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 jte-testrun.py hrv/hrv-energy.test.html`

- [ ] **Step 4: 實作 `hrv-energy.js`**

```javascript
// hrv-energy.js — 「身體能量」分數（lnRMSSD + 靜息 HR vs 個人 baseline）。掛 window.HrvEnergy。
// Bayesian 混合弱母體先驗，讓第一次量測就有合理分數、隨次數越來越個人化。相對參考、非醫療。
(function (root) {
  'use strict';
  var POP_LN_MEAN=3.6, POP_LN_SD=0.55, POP_HR_MEAN=70, POP_HR_SD=10, K=4, RECENT=14, CONF_N=7;
  function clamp(x,lo,hi){ return x<lo?lo:(x>hi?hi:x); }
  function sum(a){ var s=0; for(var i=0;i<a.length;i++) s+=a[i]; return s; }
  function mean(a){ return a.length? sum(a)/a.length : 0; }
  function blendSd(vals, popSd){ // 個人樣本變異與母體先驗變異混合（權重 個人 n-1、先驗 K）
    var n=vals.length; if(n<2) return popSd;
    var m=mean(vals), v=0; for(var i=0;i<n;i++){ var d=vals[i]-m; v+=d*d; }
    var pv=v/(n-1);
    return Math.sqrt((pv*(n-1)+popSd*popSd*K)/((n-1)+K));
  }
  // history：[{rmssd,hr,ts}...]（本次之前的過去量測）。取近 RECENT 次。
  function baselineFrom(history){
    var h=(history||[]).filter(function(r){ return r && r.rmssd>0; }).slice(-RECENT);
    var lns=h.map(function(r){ return Math.log(r.rmssd); });
    var hrs=h.filter(function(r){ return r.hr>0; }).map(function(r){ return r.hr; });
    var n=lns.length;
    return {
      effLnMean:(sum(lns)+K*POP_LN_MEAN)/(n+K),
      effLnSd: blendSd(lns, POP_LN_SD) || POP_LN_SD,
      effHrMean:(sum(hrs)+K*POP_HR_MEAN)/(hrs.length+K),
      effHrSd: blendSd(hrs, POP_HR_SD) || POP_HR_SD,
      n:n
    };
  }
  var LBL={high:'高',mid:'中',low:'低'};
  function lvl3(z){ return z>=0.6?'high':(z>=-0.6?'mid':'low'); }
  var ADV={ high:'身體能量充足，恢復得不錯，好好把握今天。', mid:'和你平常差不多，穩穩的。', low:'能量偏低，今天多留點空間給自己休息。' };
  var ELBL={ high:'充足', mid:'平穩', low:'偏低' };
  function energyScore(today, baseline){
    today=today||{}; baseline=baseline||baselineFrom([]);
    var rmssd=today.rmssd>0?today.rmssd:0, hr=today.hr>0?today.hr:0;
    if(!(rmssd>0)) return { score:0, level:'low', label:'偏低', advice:'', confidence:'building', n:baseline.n||0, recovery:null, calm:null };
    var zR=(Math.log(rmssd)-baseline.effLnMean)/baseline.effLnSd;
    var zH=hr>0?(hr-baseline.effHrMean)/baseline.effHrSd:0;
    var z=0.75*zR + 0.25*(-zH);
    var score=Math.round(clamp(60+z*16, 0, 100));
    var level= score>=75?'high':(score>=45?'mid':'low');
    return {
      score:score, level:level, label:ELBL[level], advice:ADV[level],
      confidence:(baseline.n>=CONF_N?'ok':'building'), n:baseline.n||0,
      recovery:{ level:lvl3(zR), label:LBL[lvl3(zR)] },
      calm:{ level:lvl3(-zH), label:LBL[lvl3(-zH)] }
    };
  }
  root.HrvEnergy = { baselineFrom:baselineFrom, energyScore:energyScore, _CONF_N:CONF_N };
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 5: 跑測試綠（x4 穩定）→ Commit**　`git add hrv/hrv-energy.js hrv/hrv-energy.test.html && git commit -m "hrv-energy：身體能量分數 baselineFrom/energyScore（個人 baseline 的 hero 分數）"`

---

## Task 2: 移除進階模式（index.html）

**Files:** Modify `hrv/index.html`

- [ ] **Step 1: 移除進階入口與相關碼**

- 說明頁 `renderIntro`：移除「進階分析（約 2 分鐘）」鈕；只留「開始量測」（設 `session.advanced=false` 可一併移除 advanced 概念）。
- 移除 `renderAdvancedResult` 整個函式、`ADVANCED_SEC`/`measureSec()` 的 advanced 分支（量測固定 ~60 秒；保留常數如 `QUICK_SEC`）。
- `renderResult` 開頭的 `if(session.advanced){...}` 分支移除。
- 移除 `<script ... hrv-freq.js>` 載入（檔案留著不動）。
- grep 確認無殘留 `advanced`/`hrv-freq`/`renderAdvancedResult`/`ADVANCED_SEC` 參照。

- [ ] **Step 2: 載入 hrv-energy.js**（在 hrv-analyze.js 之後）。

- [ ] **Step 3: 靜態自我檢查（量測仍 ~60 秒、流程不破）＋headless 載入無語法錯＋ Commit**

---

## Task 3: 結果頁顯示身體能量（index.html）

**Files:** Modify `hrv/index.html`

- [ ] **Step 1: 取歷史→算 baseline→算身體能量**

`renderResult(samples)`：
- 沿用 `rrFromGoodWindows`(或 detectBeats)→`cleanRr`→`metricsFromRr` 得本次 `{hr,rmssd,sdnn}`、`signalQuality`。
- **誠實把關**（沿用）：訊號太差/沒量到 → 顯示「這次沒量好，再量一次」，不算能量、不存。
- 取**過去** HRV 記錄（不含本次）→ `hist=[{rmssd,hr,ts}...]`（用既有讀記錄機制，過濾 `source==='HRV'`、有 rmssd）。
- `const base=HrvEnergy.baselineFrom(hist); const en=HrvEnergy.energyScore({rmssd:m.rmssd,hr:m.hr}, base);`

- [ ] **Step 2: 身體能量 hero 卡 + 細項**

- hero 卡（顏色依 `en.level`：high 綠/mid 金/low 暖）：大字「身體能量 `en.score`」＋ `en.label`（充足/平穩/偏低）＋ `en.advice`；`en.confidence==='building'` 時加小字「信心建立中（`en.n`/7）」。
- 可展開細項：恢復力 `en.recovery.label`、平靜 `en.calm.label`，＋原始 HR、RMSSD。
- 常駐免責（spec §3 文案）。所有動態值經 `_h`/Number/textContent。

- [ ] **Step 3: 儲存**

`jteWriteRecord({source:'HRV',id,recordId,ts,hr,rmssd,sdnn,energy:en.score,level:en.level,state:A.classify(m).state})`（沿用；加 `energy`/`level`）。只在非把關擋下時存。

- [ ] **Step 4: 靜態自我檢查＋ Commit**

---

## Task 4: 趨勢改畫身體能量（index.html）

**Files:** Modify `hrv/index.html`

- [ ] **Step 1:** `renderTrend`：取 HRV 記錄，優先畫 `energy`（舊記錄無 energy 者可退畫 rmssd 或略過）隨時間折線；各點顯示分數與日期；文案改「你的身體能量趨勢」。無資料友善空狀態。
- [ ] **Step 2: 靜態自我檢查＋ Commit**

---

## Task 5: 驗證＋上線
- [ ] Task1 測試綠（`python3 jte-testrun.py hrv/hrv-energy.test.html`）。
- [ ] headless sanity：`hrv/index.html` 載入無 JS 例外、說明頁只剩一顆「開始量測」、無 advanced 殘留。
- [ ] push hub。確認 live `hrv-energy.js` 可載、頁面正常。
- [ ] 人工 smoke（使用者）：量一次→出身體能量分數＋細項＋「信心建立中」；多量幾次→趨勢出現、baseline 漸個人化。

## 品質/安全要求（審查重點）
- 免責常駐（相對參考、非醫療）。
- 誠實把關保留（訊號差不給分）。
- 身體能量方向性正確（RMSSD 高/低 vs 個人 baseline → 分數高/低；測試保證）。
- 60 秒量測流程不破、無 advanced 殘留。
- 第一次量測（無歷史）用先驗給合理分數＋building。

## 未涵蓋（spec §9）
- 實體刪除 hrv-freq.js、baseline 進階、提醒回測 → 後續。
