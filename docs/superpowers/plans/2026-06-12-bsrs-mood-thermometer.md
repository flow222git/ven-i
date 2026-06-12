# 心情溫度計 BSRS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans。Steps 用 checkbox。

**Goal:** 新增「心情溫度計（BSRS-5＋自殺念頭題）」自我篩檢工具：作答→計分分級→危機把關→結果比照平台隱私系統加密存成個人趨勢；首頁「認識自己」分組加一張工具卡片進入。

**Architecture:** 新 hub 子資料夾 `jte-platform-2026/bsrs/`（比照 xiaoqi/ven-i，無雙副本）。可測純邏輯抽成 `bsrs/bsrs-score.js`（計分/分級/危機旗標 ＋ 比照 ven-i-privacy.js 的 `toCloudRec`/`mergeCloud`）。記錄走平台 `users/{email}/daily/{date}` linked[]（source:'BSRS'）：可分析層 `{source,ts}` 明文、私密層 `{score,level,answers,item6}` 解鎖才加密、否則只本機。複用已上線的 `jte-crypto.js`/`jte-privacy.js`。

**Tech Stack:** 靜態單頁＋Firebase 9.23 compat＋jte-userbar.js＋jte-crypto.js/jte-privacy.js（hub 共用，相對路徑 `../` 載入）。測試用 `jte-testrun.py`（headless）。

**前置：** 隱私系統 Plan 1–6 已上線。`JtePrivacy` API：`isEnabled/isUnlocked/enable/unlock/changePassphrase/lock/encryptPrivate/decryptPrivate`，測試 seam `_setBackend/_reset/_doEnable`（需 `window.__JTE_PRIVACY_TEST=true`）。`window.showPrivacyInfo` 已可用。

**單一位置**（hub 子資料夾，無雙副本）。全部做完一起 push。

---

## 量表內容（spec §2-4，實作須照字）
引導語：「最近一星期（包括今天），這些問題讓你感到困擾或苦惱的程度？」
選項（0-4）：完全沒有/輕微/中等/厲害/非常厲害。
核心 5 題（計總分）：1 感覺緊張不安｜2 覺得容易苦惱或動怒｜3 感覺憂鬱、心情低落｜4 覺得比不上別人｜5 睡眠困難（難入睡、易醒或早醒）。
附加題（不計總分）：6 有「自殺」的想法。
分級：0-5 良好／6-9 輕度／10-14 中度／15-20 重度。危機觸發：總分≥15 或第6題≥2。
危機資源：安心專線 1925・生命線 1995・張老師 1980；立即危險撥 119／110。
免責：「本量表為情緒困擾的篩檢參考、非診斷工具，僅供參考；若持續困擾請尋求專業協助。」

---

## File Structure
- Create: `jte-platform-2026/bsrs/bsrs-score.js` — 可測純邏輯，掛 `window.BsrsScore`
- Create: `jte-platform-2026/bsrs/bsrs-score.test.html`
- Create: `jte-platform-2026/bsrs/index.html` — 工具單頁（作答／結果／趨勢／啟用解鎖）
- Modify: `jte-platform-2026/index.html` — 首頁「認識自己」加 BSRS 卡片

---

## Task 1: 計分核心（score / 分級 / 危機旗標）

**Files:** Create `bsrs/bsrs-score.js`、`bsrs/bsrs-score.test.html`

- [ ] **Step 1: 建測試頁（assert 框架，載入 `bsrs-score.js`）**

複製既有測試頁的迷你框架（`check/assert/eq/log`、`window.__done`、完成 `fetch('/__result')` 回報）。`<head>` 載入 `bsrs-score.js`。

- [ ] **Step 2: 測項（先紅）**

```javascript
  await check('score 邊界：總分與分級', async () => {
    eq(BsrsScore.score([0,0,0,0,0,0]).total, 0, '全 0 總分');
    eq(BsrsScore.score([1,1,1,1,1,0]).level, 'good', '5 分 good');
    eq(BsrsScore.score([2,1,1,1,1,0]).level, 'mild', '6 分 mild');
    eq(BsrsScore.score([2,2,2,2,1,0]).level, 'mild', '9 分 mild（6-9 上邊界）');
    eq(BsrsScore.score([2,2,2,2,2,0]).level, 'moderate', '10 分 moderate');
    eq(BsrsScore.score([3,3,3,3,2,0]).level, 'moderate', '14 分 moderate');
    eq(BsrsScore.score([3,3,3,3,3,0]).level, 'severe', '15 分 severe');
    eq(BsrsScore.score([4,4,4,4,4,0]).total, 20, '全 4 總分 20');
    eq(BsrsScore.score([4,4,4,4,4,0]).level, 'severe', '20 分 severe');
  });
  await check('score 第6題不計入總分', async () => {
    eq(BsrsScore.score([1,1,1,1,1,4]).total, 5, '附加題不計總分');
  });
  await check('crisis 旗標：總分≥15 或 item6≥2', async () => {
    eq(BsrsScore.score([3,3,3,3,3,0]).crisis, true, '總分15→crisis');
    eq(BsrsScore.score([0,0,0,0,0,2]).crisis, true, 'item6=2→crisis');
    eq(BsrsScore.score([0,0,0,0,0,1]).crisis, false, 'item6=1 不觸發');
    eq(BsrsScore.score([1,1,1,1,1,0]).crisis, false, '低分不觸發');
  });
  await check('score 回傳 levelLabel/advice/item6', async () => {
    const r = BsrsScore.score([3,3,3,3,3,3]);
    assert(r.levelLabel && r.advice, '有分級標籤與建議'); eq(r.item6, 3, 'item6 帶回');
  });
```
- [ ] **Step 3: 跑測試確認紅**　`cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 jte-testrun.py bsrs/bsrs-score.test.html`

- [ ] **Step 4: 實作 `bsrs-score.js`（計分部分）**

```javascript
// bsrs-score.js — 心情溫度計 BSRS 計分與記錄分層（可測純函式）
// 依賴 window.JtePrivacy（加解密/合併部分）。掛 window.BsrsScore。
(function (root) {
  'use strict';
  var QUESTIONS = [
    { key:'q1', text:'感覺緊張不安' },
    { key:'q2', text:'覺得容易苦惱或動怒' },
    { key:'q3', text:'感覺憂鬱、心情低落' },
    { key:'q4', text:'覺得比不上別人' },
    { key:'q5', text:'睡眠困難，譬如難以入睡、易醒或早醒' },
    { key:'q6', text:'有「自殺」的想法', supplementary:true }
  ];
  var OPTIONS = ['完全沒有','輕微','中等','厲害','非常厲害'];
  var LEVELS = {
    good:     { label:'身心適應狀況良好', advice:'你最近的狀態還不錯，繼續照顧自己。' },
    mild:     { label:'輕度情緒困擾',     advice:'找信任的家人朋友聊聊、抒發一下，會有幫助。' },
    moderate: { label:'中度情緒困擾',     advice:'建議尋求心理諮商或專業協助，陪自己走一段。' },
    severe:   { label:'重度情緒困擾',     advice:'建議尋求精神科治療或心理諮商，你值得被好好接住。' }
  };
  function levelOf(total){ return total<=5?'good':total<=9?'mild':total<=14?'moderate':'severe'; }
  function score(answers){
    var a = (answers||[]).map(function(x){ return Number(x)||0; });
    var total = a[0]+a[1]+a[2]+a[3]+a[4];
    var item6 = a[5]||0;
    var level = levelOf(total);
    var crisis = total>=15 || item6>=2;
    return { total:total, item6:item6, level:level, levelLabel:LEVELS[level].label, advice:LEVELS[level].advice, crisis:crisis };
  }
  root.BsrsScore = { QUESTIONS:QUESTIONS, OPTIONS:OPTIONS, LEVELS:LEVELS, score:score };
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 5: 跑測試綠 → Commit**　`git add bsrs/bsrs-score.js bsrs/bsrs-score.test.html && git commit -m "bsrs：計分核心 score/分級/危機旗標"`

---

## Task 2: 記錄分層（toCloudRec / mergeCloud）—— 比照 ven-i-privacy

**Files:** Modify `bsrs/bsrs-score.js`、`bsrs/bsrs-score.test.html`

- [ ] **Step 1: 測試頁先載入 hub 共用 crypto/privacy（相對路徑）＋ fake db**

在 `bsrs-score.test.html` `<head>`：先 inline `window.__JTE_PRIVACY_TEST=true;`，再依序載入 `../jte-crypto.js`、`../jte-privacy.js`、`bsrs-score.js`；加 `makeFakeDb()`（比照 ven-i-privacy.test.html）。

- [ ] **Step 2: 測項（先紅）**

```javascript
  function unlocked(){ const db=makeFakeDb(); JtePrivacy._reset(); JtePrivacy._setBackend({db,email:'u@x.com'}); sessionStorage.clear(); localStorage.removeItem('jte_dek_u@x.com'); return JtePrivacy._doEnable('pw-12345678'); }
  const sampleBsrs = { id:'bs-1', recordId:'bs-1', source:'BSRS', ts:'2026-06-12T01:00:00Z', score:15, level:'severe', answers:[3,3,3,3,3,2], item6:2 };

  await check('toCloudRec（解鎖）：分數/作答加密進 priv、移除明文、留 source/ts', async () => {
    await unlocked();
    const c = await BsrsScore.toCloudRec(sampleBsrs);
    eq(c.source,'BSRS','source 留'); eq(c.score,undefined,'score 明文移除'); eq(c.answers,undefined,'answers 移除'); eq(c.item6,undefined,'item6 移除'); eq(c.level,undefined,'level 移除');
    assert(c.priv&&c.priv.score&&c.priv.score.iv,'priv.score 密文');
    assert(JSON.stringify(c).indexOf('severe')===-1,'雲端物件不含明文 level');
  });
  await check('toCloudRec（未解鎖）：私密欄位整個不上傳、無 priv', async () => {
    JtePrivacy.lock(); sessionStorage.clear(); localStorage.removeItem('jte_dek_u@x.com');
    const c = await BsrsScore.toCloudRec(sampleBsrs);
    eq(c.source,'BSRS','source 留'); eq(c.score,undefined,'score 未上傳'); eq(c.priv,undefined,'無 priv');
  });
  await check('mergeCloud：本機明文優先、雲端獨有解密併入、依 recordId 去重', async () => {
    await unlocked();
    const cloud = await BsrsScore.toCloudRec({ ...sampleBsrs, id:'bs-2', recordId:'bs-2', score:8, level:'mild', answers:[2,2,1,1,2,0], item6:0 });
    const merged = await BsrsScore.mergeCloud({ '2026-06-12':{linked:[sampleBsrs]} }, { '2026-06-12':{linked:[cloud]} });
    const flat=[]; Object.keys(merged).forEach(d=>(merged[d].linked||[]).forEach(r=>flat.push(r)));
    eq(flat.map(r=>r.recordId).sort().join(','),'bs-1,bs-2','兩筆去重');
    const r2=flat.find(r=>r.recordId==='bs-2'); eq(r2.score,8,'雲端記錄解密還原 score');
  });
```

- [ ] **Step 3: 跑測試確認紅**

- [ ] **Step 4: 在 `bsrs-score.js` 加 `toCloudRec`/`mergeCloud`（比照 ven-i-privacy.js，私密欄位改 BSRS）**

```javascript
  var PRIVATE_FIELDS = ['score','level','answers','item6'];
  function _pickPrivate(rec){ var p={}; PRIVATE_FIELDS.forEach(function(f){ if(rec[f]!==undefined&&rec[f]!==null&&rec[f]!=='') p[f]=(typeof rec[f]==='object')?JSON.stringify(rec[f]):String(rec[f]); }); return p; }
  function toCloudRec(rec){
    var out={}; Object.keys(rec).forEach(function(k){ if(PRIVATE_FIELDS.indexOf(k)===-1) out[k]=rec[k]; });
    if(!root.JtePrivacy||!root.JtePrivacy.isUnlocked()) return Promise.resolve(out);
    var priv=_pickPrivate(rec); if(!Object.keys(priv).length) return Promise.resolve(out);
    return root.JtePrivacy.encryptPrivate(priv).then(function(enc){ out.priv=enc; return out; });
  }
  function _coerce(v){ if(typeof v!=='string') return v; try{ return JSON.parse(v); }catch(e){ return v; } }
  function mergeCloud(localAll, cloudDays){
    var result=JSON.parse(JSON.stringify(localAll||{})), seen={};
    Object.keys(result).forEach(function(d){ (result[d].linked||[]).forEach(function(r){ seen[r.recordId||r.id]=true; }); });
    var unlocked=root.JtePrivacy&&root.JtePrivacy.isUnlocked(), chain=Promise.resolve();
    Object.keys(cloudDays||{}).forEach(function(d){ (cloudDays[d].linked||[]).forEach(function(cr){
      var key=cr.recordId||cr.id; if(seen[key]) return; seen[key]=true;
      chain=chain.then(function(){
        var rec={}; Object.keys(cr).forEach(function(k){ if(k!=='priv') rec[k]=cr[k]; });
        if(unlocked&&cr.priv){ return root.JtePrivacy.decryptPrivate(cr.priv).then(function(p){ Object.keys(p).forEach(function(f){ if(p[f]!=null) rec[f]=(f==='answers')?_coerce(p[f]):(f==='score'||f==='item6')?Number(p[f]):p[f]; }); _push(result,d,rec); }); }
        _push(result,d,rec);
      });
    }); });
    return chain.then(function(){ return result; });
  }
  function _push(all,d,rec){ if(!all[d]) all[d]={linked:[]}; if(!all[d].linked) all[d].linked=[]; all[d].linked.push(rec); }
```
並把 `toCloudRec`/`mergeCloud`/`PRIVATE_FIELDS` 加入 `root.BsrsScore` 導出。

- [ ] **Step 5: 跑測試綠 → Commit**

---

## Task 3: 作答 → 結果 → 危機把關（bsrs/index.html）

**Files:** Create `bsrs/index.html`

- [ ] **Step 1: 建頁面骨架與資源載入**

`<head>` 載入 tabler-icons（比照其他工具）、Firebase 9.23 compat。`<body>` 末載入 `jte-userbar.js`（絕對 hub URL）、`../jte-crypto.js`、`../jte-privacy.js`、`bsrs-score.js`（相對）、最後自身 `<script>`。頁面風格沿用平台（`#003D7C` 主色、卡片圓角）。

- [ ] **Step 2: 作答畫面**

用 `BsrsScore.QUESTIONS`／`OPTIONS` 動態渲染 6 題，每題 5 個 0–4 選項（單選）。引導語、第 6 題標示為附加題。底部「看結果」鈕（需全部作答）。

- [ ] **Step 3: 結果畫面 + 危機把關 + 免責**

呼叫 `BsrsScore.score(answers)`。顯示總分（0–20）、`levelLabel`、`advice`。**若 `result.crisis`** → 在最上方明顯卡片（紅系）顯示 spec §4 的危機文案與資源（1925／1995／1980／119／110）。固定底部免責聲明（spec §4）。提供「再測一次」「看我的趨勢」。

- [ ] **Step 4: 靜態自我檢查 + Commit**　確認危機觸發條件正確（總分≥15 或 item6≥2）、免責常駐。

---

## Task 4: 存記錄 + 趨勢 + 啟用/解鎖（bsrs/index.html）

**Files:** Modify `bsrs/index.html`

- [ ] **Step 1: 平台記錄 helper（比照 ven-i Plan 3，fail-closed）**

加入 `jteEmail/jteKey/jteAll/jteWriteRecord`，以及上傳前過 `BsrsScore.toCloudRec` 的 `jteFsSave`（模組缺失時 fail-closed：strip 掉 `score/level/answers/item6` 再上傳，**絕不上傳明文分數**）。完成測驗按「儲存」時寫一筆 `{source:'BSRS',id,recordId,ts,score,level,answers,item6}`（本機完整明文 + 上雲脫敏/加密）。未登入則只存本機。

- [ ] **Step 2: 讀回 + 趨勢**

`jteFsLoadDays` 抓 `users/{email}/daily`，`BsrsScore.mergeCloud` 併本機後 hydrate；趨勢頁取所有 `source==='BSRS'` 記錄依 `ts` 排序，畫總分折線（簡單 SVG/canvas 或純 CSS bar），點各點顯示當次分級。未解鎖只顯示本機可得。歷史卡片渲染分數/作答**務必跳脫**（用 textContent 或跳脫函式，比照卜易 `_h`）。

- [ ] **Step 3: 啟用/解鎖 UI（趨勢頁頂部隱私列）**

四態比照卜易：未登入提示；已登入未啟用→「🔒 開啟跨裝置加密同步」(`JtePrivacy.enable`)；已啟用未解鎖→「🔓 解鎖」(`JtePrivacy.unlock`)＋「換密語」；已解鎖→「✓ 已加密同步・鎖定」(`JtePrivacy.lock`)。狀態變更後重繪趨勢。「了解隱私」連結 → `window.showPrivacyInfo`。

- [ ] **Step 4: 靜態自我檢查 + headless sanity（頁面渲染、無 JS 例外）+ Commit**

---

## Task 5: 首頁工具卡片（jte-platform-2026/index.html）

**Files:** Modify `jte-platform-2026/index.html`（約 202-209 行「認識自己」分組）

- [ ] **Step 1: 「認識自己」分組改 2 欄並加 BSRS 卡片**

把（約 203 行）`<div style="margin-bottom:6px">` 容器改為 2 欄 grid（比照「內在」分組 line 191），在 twct 卡片之後加入：
```html
      <div onclick="location.href='bsrs/'" class="v2card">
        <div class="v2ic" style="background:#FDEEF0"><i class="ti ti-temperature" style="color:#D14D5A"></i></div>
        <div class="v2nm">心情溫度計</div><div class="v2ds">一分鐘，看看最近的情緒。</div>
      </div>
```

- [ ] **Step 2: headless sanity（首頁渲染含新卡片）+ Commit**

---

## Task 6: 驗證 + 上線
- [ ] Task1/2 測試綠（`python3 jte-testrun.py bsrs/bsrs-score.test.html`）。
- [ ] headless sanity：`bsrs/index.html`、首頁 `index.html` 載入無 JS 例外、關鍵內容渲染（作答題目、首頁 BSRS 卡片）。
- [ ] push hub（單 repo）。確認 live `bsrs/` 可開、首頁卡片可進入。
- [ ] 人工 smoke（使用者）：做一次測驗→危機情境顯示資源→登入啟用→Firestore 看 `priv` 密文無明文分數→換裝置解鎖看趨勢。

---

## 安全/品質要求（審查重點）
- **危機把關不可漏**：總分≥15 或 item6≥2 必顯示資源；免責常駐。
- **私密分數不外洩**：所有上 Firestore 路徑經 `toCloudRec`；模組缺失 fail-closed（strip 私密）；歷史/趨勢渲染跳脫。
- 未啟用者：結果只存本機、不上傳。

## 未涵蓋（spec §10）
- 完整 BSRS-50、首頁常駐快速入口、回測提醒、趨勢匯出 → 後續。
