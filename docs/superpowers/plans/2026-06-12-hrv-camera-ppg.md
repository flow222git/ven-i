# 手機 HRV 量測（相機 PPG）MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 做一個純網頁 PWA 工具：手指蓋後鏡頭，用相機 PPG 量約 60 秒，算出心率/RMSSD/SDNN 與「放鬆/平衡/緊繃」狀態，存成記錄看趨勢；首頁加卡片。MVP 只做時域指標（四個頻域指數列第二階段）。

**Architecture:** 訊號處理抽成可測純模組 `hrv/hrv-analyze.js`（`window.HrvAnalyze`：beat 偵測、RR、HR/RMSSD/SDNN、狀態分級、訊號品質），用合成訊號 headless 測。相機擷取（getUserMedia→canvas→每影格取中央紅光強度）＋即時波形/心率/品質燈＋結果/趨勢 UI 在 `hrv/index.html`（需手機實機測）。記錄走平台 `users/{email}/daily` linked[]（source:'HRV'，明文一般記錄，不加密）。

**Tech Stack:** 靜態單頁 + getUserMedia + canvas + Firebase 9.23 compat + jte-userbar.js。測試用 `jte-testrun.py`（headless，合成訊號）。**hub 子資料夾 `jte-platform-2026/hrv/`，單一位置、無雙副本。** 做完一起 push。

**前置：** 無新依賴（不需 jte-crypto/privacy——HRV 走一般記錄）。

---

## File Structure
- Create: `jte-platform-2026/hrv/hrv-analyze.js` — 訊號處理純模組（`window.HrvAnalyze`）
- Create: `jte-platform-2026/hrv/hrv-analyze.test.html` — headless 測試頁
- Create: `jte-platform-2026/hrv/index.html` — 工具單頁（說明/量測/結果/趨勢）
- Modify: `jte-platform-2026/index.html` — 首頁「呼吸·回到當下」加 HRV 卡片

---

## Task 1: 指標計算核心（metricsFromRr / classify）

**Files:** Create `hrv/hrv-analyze.js`、`hrv/hrv-analyze.test.html`

- [ ] **Step 1: 建測試頁（assert 框架，載入 hrv-analyze.js）**

複製既有測試頁框架（`check/assert/eq/log`、`window.__done`、完成 `fetch('/__result')` 回報）。加一個近似比較 helper：
```javascript
function near(a,b,tol,m){ if(Math.abs(a-b)>tol) throw new Error((m||'near')+' got '+a+' want '+b+'±'+tol); }
```
`<head>` 載入 `hrv-analyze.js`。

- [ ] **Step 2: 測項（先紅）**

```javascript
  await check('metricsFromRr：等距 RR → hr=60、rmssd=0、sdnn=0', async () => {
    const m = HrvAnalyze.metricsFromRr([1000,1000,1000,1000]);
    near(m.hr,60,0.01,'hr'); near(m.rmssd,0,0.01,'rmssd'); near(m.sdnn,0,0.01,'sdnn');
  });
  await check('metricsFromRr：交替 800/1200 → hr=60、rmssd=400、sdnn=200', async () => {
    const m = HrvAnalyze.metricsFromRr([800,1200,800,1200]);
    near(m.hr,60,0.01,'hr'); near(m.rmssd,400,0.01,'rmssd'); near(m.sdnn,200,0.01,'sdnn');
  });
  await check('classify：rmssd 高→放鬆、中→平衡、低→緊繃', async () => {
    eq(HrvAnalyze.classify({rmssd:60,hr:65}).state,'relaxed','高');
    eq(HrvAnalyze.classify({rmssd:35,hr:70}).state,'balanced','中');
    eq(HrvAnalyze.classify({rmssd:15,hr:80}).state,'tense','低');
    assert(HrvAnalyze.classify({rmssd:60,hr:65}).advice,'有建議文字');
  });
```

- [ ] **Step 3: 跑測試確認紅**　`cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 jte-testrun.py hrv/hrv-analyze.test.html`

- [ ] **Step 4: 實作 `hrv-analyze.js`（指標部分）**

```javascript
// hrv-analyze.js — 相機 PPG 的 HRV 訊號處理（可測純函式）。掛 window.HrvAnalyze。
(function (root) {
  'use strict';
  function mean(a){ var s=0; for(var i=0;i<a.length;i++) s+=a[i]; return a.length?s/a.length:0; }
  function metricsFromRr(rr){
    rr = (rr||[]).filter(function(x){ return x>0; });
    if (rr.length < 2) return { hr:0, rmssd:0, sdnn:0, n:rr.length };
    var mr = mean(rr);
    var sq=0; for(var i=1;i<rr.length;i++){ var d=rr[i]-rr[i-1]; sq+=d*d; }
    var rmssd = Math.sqrt(sq/(rr.length-1));
    var vs=0; for(var j=0;j<rr.length;j++){ var dv=rr[j]-mr; vs+=dv*dv; }
    var sdnn = Math.sqrt(vs/rr.length);
    return { hr: 60000/mr, rmssd: rmssd, sdnn: sdnn, n: rr.length };
  }
  var STATES = {
    relaxed:  { state:'relaxed',  advice:'身體現在偏放鬆，這個狀態很好，記得它的感覺。' },
    balanced: { state:'balanced', advice:'平衡的狀態。要更鬆一點，可以試著放慢吐氣。' },
    tense:    { state:'tense',    advice:'身體有點緊。慢慢深呼吸幾次，吐氣拉長，再看看。' }
  };
  function classify(m){
    var r = (m&&m.rmssd)||0;
    var key = r>=50 ? 'relaxed' : r>=25 ? 'balanced' : 'tense';
    return STATES[key];
  }
  root.HrvAnalyze = { metricsFromRr: metricsFromRr, classify: classify, _mean: mean };
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 5: 跑測試綠 → Commit**　`git add hrv/hrv-analyze.js hrv/hrv-analyze.test.html && git commit -m "hrv：指標計算核心 metricsFromRr/classify"`

---

## Task 2: 脈搏偵測 + RR + 訊號品質（合成訊號測）

**Files:** Modify `hrv/hrv-analyze.js`、`hrv/hrv-analyze.test.html`

- [ ] **Step 1: 測試頁加合成 PPG 產生器與測項（先紅）**

```javascript
  // 合成 PPG：fs Hz、durSec 秒、bpm 心率的正弦（可加雜訊）
  function synthPpg(bpm, durSec, fs, noise){
    fs=fs||30; durSec=durSec||20; noise=noise||0;
    var s=[], f=bpm/60, n=Math.round(durSec*fs);
    for(var i=0;i<n;i++){ var t=i*1000/fs; var v=Math.sin(2*Math.PI*f*t/1000) + (noise?(Math.random()-0.5)*noise:0); s.push({t:t,v:v}); }
    return s;
  }
  await check('detectBeats：60bpm 合成訊號 → hr≈60', async () => {
    var s=synthPpg(60,20,30,0.05);
    var beats=HrvAnalyze.detectBeats(s);
    var rr=HrvAnalyze.rrFromBeats(beats);
    var m=HrvAnalyze.metricsFromRr(rr);
    near(m.hr,60,4,'hr≈60');
  });
  await check('detectBeats：75bpm 合成訊號 → hr≈75', async () => {
    var m=HrvAnalyze.metricsFromRr(HrvAnalyze.rrFromBeats(HrvAnalyze.detectBeats(synthPpg(75,20,30,0.05))));
    near(m.hr,75,5,'hr≈75');
  });
  await check('rrFromBeats 偽差過濾：剔除超出 300-2000ms 的間隔', async () => {
    var beats=[0,1000,2000,2100,3100]; // 2000→2100=100ms（太短）應剔除
    var rr=HrvAnalyze.rrFromBeats(beats);
    assert(rr.indexOf(100)===-1,'100ms 被剔除');
  });
  await check('signalQuality：乾淨脈動→green、平坦雜訊→red', async () => {
    eq(HrvAnalyze.signalQuality(synthPpg(60,8,30,0.05)),'green','乾淨');
    var flat=[]; for(var i=0;i<240;i++) flat.push({t:i*33.3,v:(Math.random()-0.5)*0.02});
    eq(HrvAnalyze.signalQuality(flat),'red','平坦雜訊');
  });
```

- [ ] **Step 2: 跑測試確認紅**

- [ ] **Step 3: 實作 detectBeats / rrFromBeats / signalQuality**

加入 `hrv-analyze.js`：
```javascript
  // 移動平均去基線 → 取 AC，找局部極大（脈搏峰），自適應門檻 + 不應期
  function detectBeats(samples){
    samples = samples||[];
    if (samples.length < 10) return [];
    var v = samples.map(function(s){ return s.v; }), t = samples.map(function(s){ return s.t; });
    var win = 15, ac = [];
    for (var i=0;i<v.length;i++){
      var a=Math.max(0,i-win), b=Math.min(v.length-1,i+win), s=0,c=0;
      for(var k=a;k<=b;k++){ s+=v[k]; c++; }
      ac.push(v[i]-s/c); // 去趨勢
    }
    var mx=0; for(var j=0;j<ac.length;j++) if(ac[j]>mx) mx=ac[j];
    var thr = mx*0.4;
    var beats=[], lastT=-1e9;
    for(var p=1;p<ac.length-1;p++){
      if (ac[p]>thr && ac[p]>=ac[p-1] && ac[p]>ac[p+1] && (t[p]-lastT)>=300){
        beats.push(t[p]); lastT=t[p];
      }
    }
    return beats;
  }
  function rrFromBeats(beats){
    var rr=[];
    for(var i=1;i<beats.length;i++){
      var d=beats[i]-beats[i-1];
      if (d>=300 && d<=2000) rr.push(d); // 偽差過濾
    }
    return rr;
  }
  function signalQuality(samples){
    var beats=detectBeats(samples), rr=rrFromBeats(beats);
    if (rr.length < 3) return 'red';
    // 脈動規律性：RR 變異係數越小越穩
    var m=_mean(rr), vs=0; for(var i=0;i<rr.length;i++){ var d=rr[i]-m; vs+=d*d; }
    var cv=Math.sqrt(vs/rr.length)/m;
    if (cv < 0.15) return 'green';
    if (cv < 0.35) return 'yellow';
    return 'red';
  }
```
（`_mean` 已導出，detectBeats/rrFromBeats/signalQuality 加入 `root.HrvAnalyze` 導出。）

- [ ] **Step 4: 跑測試綠（Task1+2 共 7 項）→ Commit**

---

## Task 3: 相機擷取 + 即時回饋（hrv/index.html）

**Files:** Create `hrv/index.html`

- [ ] **Step 1: 頁面骨架 + 資源**

`<head>` 載入 tabler-icons、Firebase 9.23 compat。`<body>` 末載入 `jte-userbar.js`（絕對 hub URL）、`hrv-analyze.js`（相對）、自身腳本。風格沿用平台（#003D7C）。三個視圖：說明 / 量測 / 結果。

- [ ] **Step 2: 說明頁 + 開始量測**

說明：「手指輕蓋後鏡頭、保持靜止、正常呼吸；約一分鐘。iPhone 請在光線充足處。」＋免責（spec §6）。「開始量測」鈕。

- [ ] **Step 3: 相機擷取 + 取樣**

```javascript
async function startCamera(){
  const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } });
  const track = stream.getVideoTracks()[0];
  try { await track.applyConstraints({ advanced:[{ torch:true }] }); } catch(e){ /* iPhone：無閃光燈，引導光線 */ }
  // video→canvas 每影格取中央區域平均紅光強度，push {t:performance.now(), v:redMean}
}
```
用 `requestAnimationFrame` 迴圈，每影格把 video 畫到小 canvas、取中央 ~50x50 區域 `getImageData` 的紅色平均值為樣本。維護最近 N 秒樣本。

- [ ] **Step 4: 即時回饋 + 60 秒計時**

每 ~0.5 秒呼叫 `HrvAnalyze.signalQuality(recent)` 更新**品質燈**、`detectBeats→metricsFromRr` 更新**即時心率**、把最近樣本畫成**波形**（canvas 折線）。品質轉 green 才開始 60 秒倒數進度環；中途轉 red 提示調整。倒數結束 → 收集到的樣本交給結果頁。

- [ ] **Step 5: 靜態自我檢查 + headless 載入（頁面渲染、無 JS 例外；相機在 headless 無權限，確認不崩潰即可）+ Commit**

---

## Task 4: 結果 + 儲存 + 趨勢（hrv/index.html）

**Files:** Modify `hrv/index.html`

- [ ] **Step 1: 結果頁**

`HrvAnalyze.metricsFromRr(rrFromBeats(detectBeats(samples)))` → `classify`。顯示：大字**狀態**（放鬆/平衡/緊繃，中文對應 relaxed/balanced/tense）＋ `advice`；可展開**心率/RMSSD/SDNN**；固定**免責**。若 `n` 太少（訊號太差）→ 顯示「這次沒量好，請在光線充足處、手指輕貼鏡頭再試一次」而非硬給數字。「再量一次」「看趨勢」。

- [ ] **Step 2: 存記錄（平台 helper，一般記錄）**

加 `jteEmail/jteKey/jteAll/jteWriteRecord/jteFsSave`（比照其他工具，但 HRV **不加密**、直接 `.set`）。量好後寫一筆 `{source:'HRV',id,recordId,ts,hr:Math.round(hr),rmssd:Math.round(rmssd),sdnn:Math.round(sdnn),state}`（本機 + 登入時上雲）。渲染時所有值用 `Number`/`textContent`，避免注入。

- [ ] **Step 3: 趨勢**

讀本機（登入時可加 Firestore daily 讀回）所有 `source==='HRV'` 記錄依 ts 排序，畫 RMSSD（或 hr）折線（SVG，數值化），點各點看當次狀態。無資料時友善空狀態。

- [ ] **Step 4: 靜態自我檢查 + Commit**

---

## Task 5: 首頁卡片（jte-platform-2026/index.html）

**Files:** Modify `jte-platform-2026/index.html`（「呼吸·回到當下」分組，約 178-188 行）

- [ ] **Step 1: 在該分組 grid 內、xiaoqi 卡片之後加 HRV 卡片**

```html
      <div onclick="location.href='hrv/'" class="v2card">
        <div class="v2ic" style="background:#FDEBEE"><i class="ti ti-heart-rate-monitor" style="color:#D14D5A"></i></div>
        <div class="v2nm">心率變異 HRV</div><div class="v2ds">手指貼鏡頭，一分鐘量身體狀態。</div>
      </div>
```

- [ ] **Step 2: headless sanity（首頁渲染含 HRV 卡片）+ Commit**

---

## Task 6: 驗證 + 上線
- [ ] Task1/2 測試綠（`python3 jte-testrun.py hrv/hrv-analyze.test.html`，7 項）。
- [ ] headless sanity：`hrv/index.html`（無相機權限不崩潰、說明頁渲染、免責在）、首頁含 HRV 卡片。
- [ ] push hub（單 repo）。確認 live `hrv/` 可開、首頁卡片可進入。
- [ ] **手機實機 smoke（最重要，需使用者）**：iPhone＋Android 各試——手指貼鏡頭、品質燈會不會轉綠、即時心率合不合理、量完狀態/數字、趨勢有記錄。**這是評估「相機 PPG 到底行不行」的關鍵。**

---

## 品質/安全要求（審查重點）
- 免責常駐（健康參考、非醫療）。
- 訊號太差時不硬給數字、引導重量。
- getUserMedia 權限被拒 / 無相機 → 友善錯誤，不崩潰。
- 渲染數值用 Number/textContent，無注入。

## 未涵蓋（spec §11-12，第二階段）
- 延長至 2-3 分鐘 + 頻域分析 → 壓力/放鬆/活力/靈活度四指數。
- 呼吸節律導引、HRV 訓練、藍牙心率帶。
