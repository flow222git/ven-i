# HRV 進階分析（頻域四指數）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 在已上線的相機 PPG HRV 工具加「進階分析」模式：約 120 秒量測 → 頻域分析（FFT）→ 壓力/放鬆/活力/情緒反應靈活度四指數（0–100 相對分＋高/中/低＋白話）；60 秒快測保留不變。

**Architecture:** 頻域計算抽成可測純模組 `hrv/hrv-freq.js`（resampleRr/fft/bandPowers/indices）。`index.html` 加第二顆入口鈕、依模式決定量測長度、進階結果頁呼叫 HrvFreq。沿用既有 `hrv-analyze.js`（cleanRr/metricsFromRr/signalQuality）。誠實把關：訊號差不出四指數。

**Tech Stack:** 純前端、FFT 自寫（無函式庫）。hub 子資料夾 `jte-platform-2026/hrv/`，單 repo。測試用 `jte-testrun.py`。

**前置：** MVP HRV 已上線（`hrv-analyze.js`、`index.html`）。

---

## File Structure
- Create: `jte-platform-2026/hrv/hrv-freq.js`（`window.HrvFreq`）
- Create: `jte-platform-2026/hrv/hrv-freq.test.html`
- Modify: `jte-platform-2026/hrv/index.html`（入口第二鈕、量測長度、進階結果頁、載入 hrv-freq.js）

---

## Task 1: 重採樣 ＋ FFT（resampleRr / fft）

**Files:** Create `hrv/hrv-freq.js`、`hrv/hrv-freq.test.html`

- [ ] **Step 1: 建測試頁（assert 框架，載入 hrv-freq.js）**

沿用既有測試頁框架（`check/assert/eq/near/log`、`window.__done`、`fetch('/__result')`）。`<head>` 載入 `hrv-freq.js`。

- [ ] **Step 2: 測項（先紅）**

```javascript
  await check('resampleRr：等距 RR → 等間隔序列、值接近原值', async () => {
    var rr=[]; for(var i=0;i<60;i++) rr.push(1000); // 60 拍 ~60 秒
    var out=HrvFreq.resampleRr(rr, 4);
    assert(out.series.length>=200, '4Hz×~60s 應有 ~240 點，實得 '+out.series.length);
    near(out.series[100], 1000, 1, '值接近 1000');
  });
  await check('fft：DC 輸入 → 只有第0 bin有值', async () => {
    var re=[1,1,1,1,1,1,1,1], im=[0,0,0,0,0,0,0,0];
    HrvFreq.fft(re, im);
    near(re[0], 8, 1e-6, 'DC=N'); near(Math.hypot(re[1],im[1]), 0, 1e-6, 'bin1=0');
  });
  await check('fft：bin2 餘弦 → 譜峰在 bin2', async () => {
    var N=16, re=[], im=[]; for(var i=0;i<N;i++){ re.push(Math.cos(2*Math.PI*2*i/N)); im.push(0); }
    HrvFreq.fft(re, im);
    var mag=[]; for(i=0;i<N;i++) mag.push(Math.hypot(re[i],im[i]));
    var pk=1; for(i=1;i<N/2;i++) if(mag[i]>mag[pk]) pk=i;
    eq(pk, 2, '峰在 bin2');
  });
```

- [ ] **Step 3: 跑測試確認紅**　`cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 jte-testrun.py hrv/hrv-freq.test.html`

- [ ] **Step 4: 實作 `hrv-freq.js`（resampleRr + fft）**

```javascript
// hrv-freq.js — HRV 頻域分析（可測純函式）。掛 window.HrvFreq。
(function (root) {
  'use strict';
  function mean(a){ var s=0; for(var i=0;i<a.length;i++) s+=a[i]; return a.length?s/a.length:0; }
  function clamp(x,lo,hi){ return x<lo?lo:(x>hi?hi:x); }

  // RR 間隔(ms) → fs Hz 等間隔 tachogram（線性內插）
  function resampleRr(rr, fs){
    fs = fs||4;
    rr = (rr||[]).filter(function(v){ return v>0; });
    if (rr.length < 4) return { series:[], fs:fs };
    var x=[], y=[], t=0;
    for (var i=0;i<rr.length;i++){ x.push(t); y.push(rr[i]); t += rr[i]/1000; } // 第 i 拍時間(s)、值=rr[i]
    var T=x[x.length-1], n=Math.floor(T*fs), series=[], j=0;
    for (var k=0;k<n;k++){
      var tt=k/fs;
      while (j<x.length-2 && x[j+1]<tt) j++;
      var x0=x[j], x1=x[j+1], y0=y[j], y1=y[j+1];
      series.push(x1>x0 ? y0+(y1-y0)*(tt-x0)/(x1-x0) : y0);
    }
    return { series:series, fs:fs };
  }

  // 就地 radix-2 FFT（長度需 2 的次方）
  function fft(re, im){
    var n=re.length, i, j, bit;
    for (i=1, j=0; i<n; i++){
      for (bit=n>>1; j&bit; bit>>=1) j^=bit;
      j^=bit;
      if (i<j){ var tr=re[i]; re[i]=re[j]; re[j]=tr; var ti=im[i]; im[i]=im[j]; im[j]=ti; }
    }
    for (var len=2; len<=n; len<<=1){
      var ang=-2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
      for (i=0; i<n; i+=len){
        var cr=1, ci=0;
        for (j=0; j<len/2; j++){
          var ur=re[i+j], ui=im[i+j];
          var vr=re[i+j+len/2]*cr - im[i+j+len/2]*ci;
          var vi=re[i+j+len/2]*ci + im[i+j+len/2]*cr;
          re[i+j]=ur+vr; im[i+j]=ui+vi;
          re[i+j+len/2]=ur-vr; im[i+j+len/2]=ui-vi;
          var ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr;
        }
      }
    }
  }

  root.HrvFreq = { resampleRr:resampleRr, fft:fft, _mean:mean, _clamp:clamp };
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 5: 跑測試綠 → Commit**　`git add hrv/hrv-freq.js hrv/hrv-freq.test.html && git commit -m "hrv-freq：重採樣 resampleRr＋radix-2 FFT"`

---

## Task 2: 頻帶功率 ＋ 四指數（bandPowers / indices）

**Files:** Modify `hrv/hrv-freq.js`、`hrv/hrv-freq.test.html`

- [ ] **Step 1: 測項（先紅）**

```javascript
  function synthTach(freqHz, fs, durSec, amp, base){
    fs=fs||4; durSec=durSec||120; amp=amp||50; base=base||800;
    var s=[], n=Math.round(fs*durSec);
    for(var i=0;i<n;i++) s.push(base + amp*Math.sin(2*Math.PI*freqHz*i/fs));
    return s;
  }
  await check('bandPowers：0.25Hz 振盪 → HF≫LF', async () => {
    var bp=HrvFreq.bandPowers(synthTach(0.25,4,120,50), 4);
    assert(bp.hf > bp.lf*4, 'HF 應遠大於 LF（hf='+bp.hf.toFixed(0)+' lf='+bp.lf.toFixed(0)+'）');
  });
  await check('bandPowers：0.10Hz 振盪 → LF≫HF', async () => {
    var bp=HrvFreq.bandPowers(synthTach(0.10,4,120,50), 4);
    assert(bp.lf > bp.hf*4, 'LF 應遠大於 HF（lf='+bp.lf.toFixed(0)+' hf='+bp.hf.toFixed(0)+'）');
  });
  await check('indices：高 HF→放鬆高/壓力低；高 LF→壓力高/放鬆低', async () => {
    var hfDom=HrvFreq.indices({lf:100,hf:1000,total:1100,lfhf:0.1}, {sdnn:60,rmssd:45});
    var lfDom=HrvFreq.indices({lf:1000,hf:100,total:1100,lfhf:10}, {sdnn:60,rmssd:45});
    assert(hfDom.relax.score >= 60, '高HF→放鬆高'); assert(hfDom.stress.score <= 40, '高HF→壓力低');
    assert(lfDom.stress.score >= 60, '高LF→壓力高'); assert(lfDom.relax.score <= 40, '高LF→放鬆低');
    assert(['high','mid','low'].indexOf(hfDom.relax.level)>=0, 'level 合法');
    assert(hfDom.relax.label && hfDom.relax.advice, '有標籤與建議');
  });
  await check('indices：活力/靈活度隨 total/sdnn 提高而上升', async () => {
    var lo=HrvFreq.indices({lf:50,hf:50,total:120,lfhf:1},{sdnn:12,rmssd:10});
    var hi=HrvFreq.indices({lf:50,hf:50,total:6000,lfhf:1},{sdnn:100,rmssd:80});
    assert(hi.vitality.score > lo.vitality.score, '活力隨 total 升');
    assert(hi.flexibility.score > lo.flexibility.score, '靈活度隨 sdnn 升');
  });
```

- [ ] **Step 2: 跑測試確認紅**

- [ ] **Step 3: 實作 bandPowers + indices（加入 hrv-freq.js）**

```javascript
  // 去均值＋Hanning 窗＋補零至 2 次方→FFT→週期圖→頻帶積分。回 {lf,hf,total,lfhf}
  function bandPowers(series, fs){
    fs = fs||4;
    var n0=(series||[]).length;
    if (n0 < 16) return { lf:0, hf:0, total:0, lfhf:0 };
    var m=mean(series), x=new Array(n0);
    for (var i=0;i<n0;i++) x[i]=series[i]-m;
    var winSq=0, re=[], im=[];
    for (i=0;i<n0;i++){ var w=0.5-0.5*Math.cos(2*Math.PI*i/(n0-1)); winSq+=w*w; re.push(x[i]*w); im.push(0); }
    var N=1; while(N<n0) N<<=1;
    while(re.length<N){ re.push(0); im.push(0); }
    fft(re, im);
    var df=fs/N, norm=1/(fs*winSq), lf=0, hf=0, total=0;
    for (var k=1;k<N/2;k++){
      var p=(re[k]*re[k]+im[k]*im[k])*norm, f=k*df;
      if (f>=0.0033 && f<0.40) total+=p*df;
      if (f>=0.04   && f<0.15) lf+=p*df;
      if (f>=0.15   && f<0.40) hf+=p*df;
    }
    return { lf:lf, hf:hf, total:total, lfhf: hf>0 ? lf/hf : 0 };
  }

  function scoreLog(x, lo, hi){ if(x<=0) return 0; return clamp(100*(Math.log(x)-Math.log(lo))/(Math.log(hi)-Math.log(lo)), 0, 100); }
  function scoreLin(x, lo, hi){ return clamp(100*(x-lo)/(hi-lo), 0, 100); }
  function lvl(s){ return s>=67?'high':(s>=34?'mid':'low'); }
  var LBL={high:'高',mid:'中',low:'低'};
  // 四指數的白話建議（依面向＋高低）
  var ADV={
    relax:{high:'副交感活躍，身體偏休息放鬆。',mid:'放鬆程度中等。',low:'放鬆訊號偏低，給自己一點喘息。'},
    stress:{high:'交感偏主導，壓力訊號較明顯，留意休息。',mid:'壓力張力中等。',low:'壓力訊號低，狀態平穩。'},
    vitality:{high:'整體自律神經活性高，活力充沛。',mid:'活力中等。',low:'整體活性偏低，可能累了或需要休息。'},
    flexibility:{high:'心率變化豐富，自律調節有彈性。',mid:'調節彈性中等。',low:'變化偏小，彈性較低。'}
  };
  function mk(face, score){ var l=lvl(score); return { score:Math.round(score), level:l, label:LBL[l], advice:ADV[face][l] }; }
  // 參考範圍＝相對校準的合理估值（非臨床常模）；hfnu/lfhf 為尺度無關較穩健
  function indices(bp, td){
    bp=bp||{}; td=td||{};
    var hfnu = (bp.lf+bp.hf)>0 ? bp.hf/(bp.lf+bp.hf) : 0;        // 副交感占比 0~1
    var relax = mk('relax', hfnu*100);
    var stress = mk('stress', scoreLin(bp.lfhf||0, 0.5, 4));
    var vitality = mk('vitality', scoreLog(bp.total||0, 100, 8000));
    var flexibility = mk('flexibility', scoreLog(td.sdnn||0, 10, 120));
    return { relax:relax, stress:stress, vitality:vitality, flexibility:flexibility };
  }
```
並把 `bandPowers`/`indices` 加入 `root.HrvFreq` 導出。

- [ ] **Step 4: 跑測試綠（x5 穩定，含 Task1）→ Commit**

---

## Task 3: 入口第二鈕 ＋ 進階量測長度（index.html）

**Files:** Modify `hrv/index.html`

- [ ] **Step 1: 載入 hrv-freq.js**（在 hrv-analyze.js 之後）。

- [ ] **Step 2: 說明頁加「進階分析（約 2 分鐘）」鈕**

`renderIntro` 既有「開始量測」鈕（快測）旁/下，加第二顆「進階分析（約 2 分鐘）」。兩顆都進 `renderMeasure`，但先設 `session.advanced`（快測 false／進階 true）。進階鈕旁小字「更完整的壓力/放鬆/活力分析」。

- [ ] **Step 3: 量測長度依模式**

把固定的 `MEASURE_SEC` 改為依 `session.advanced` 取值：快測 60、進階 120。倒數環/提示沿用。

- [ ] **Step 4: 靜態自我檢查（快測仍 60、進階 120；其餘量測邏輯不變）＋ Commit**

---

## Task 4: 進階結果頁 ＋ 誠實把關 ＋ 儲存（index.html）

**Files:** Modify `hrv/index.html`

- [ ] **Step 1: renderResult 分支：進階模式算四指數**

`renderResult(samples)` 內，若 `session.advanced`：
- 沿用 `detectBeats→rrFromBeats→cleanRr` 得 `rr`；`metricsFromRr(rr)` 得 `{hr,rmssd,sdnn}`；`signalQuality(samples)`。
- **誠實把關**：若 `rr.length < 60` 或 `quality==='red'` 或 hr 不合理 → 顯示「這次訊號不夠穩，給你基本結果」＋HR/狀態＋免責＋「再量一次」（**不出四指數**）。
- 否則：`HrvFreq.indices(HrvFreq.bandPowers(HrvFreq.resampleRr(rr,4).series,4), {sdnn:m.sdnn,rmssd:m.rmssd})` → 四指數。

- [ ] **Step 2: 進階結果頁呈現（混合式）**

最上方免責卡（spec §5 文案）。四張指數卡，每張：名稱＋分數條(0–100，CSS 寬度=score%)＋高/中/低標籤＋`advice`。下方基本：HR、RMSSD。所有動態值經 `_h`/Number。「再量一次」「看趨勢」。

- [ ] **Step 3: 儲存進階記錄**

呼叫既有 `jteWriteRecord({source:'HRV',id,recordId,ts,hr,rmssd,sdnn,state,adv:true,stress,relax,vitality,flexibility})`（四指數存 score 數字；明文一般記錄）。只在有效（非把關擋下）時存。

- [ ] **Step 4: 靜態自我檢查＋headless 載入（頁面無語法錯、說明頁兩顆鈕在）＋ Commit**

---

## Task 5: 驗證 ＋ 上線
- [ ] Task1/2 測試綠（`python3 jte-testrun.py hrv/hrv-freq.test.html`）。
- [ ] headless sanity：`hrv/index.html` 載入無 JS 例外、說明頁有「開始量測」＋「進階分析」兩顆鈕、快測流程未壞。
- [ ] push hub。確認 live `hrv-freq.js` 可載、說明頁兩顆鈕。
- [ ] 人工 smoke（使用者）：進階分析量 2 分鐘 → 出四指數（分數＋高/中/低）；訊號差時顯示「不夠穩」不硬給。

## 安全/品質要求（審查重點）
- 進階免責常駐（相對參考、非舊儀器/醫療）。
- 訊號差不出四指數（誠實把關）。
- 快測 60 秒模式完全不受影響（回歸）。
- FFT/頻帶/指數的方向性正確（測試保證）。

## 未涵蓋（spec §10）
- 5 分鐘標準量測、Lomb-Scargle、與舊儀器數值校準、趨勢四指數視覺化進階版 → 後續。
