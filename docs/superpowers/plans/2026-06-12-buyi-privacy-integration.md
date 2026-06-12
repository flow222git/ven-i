# 卜易／問易 隱私整合 Implementation Plan（Plan 3/5）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把卜易（ven-i）的記錄拆成「可分析層（明文上雲）」與「私密層（解鎖才加密上雲、否則只存本機）」，並加上 Firestore→本機讀回，讓已解鎖的使用者跨裝置看到並解密自己的歷史；同時加入啟用/解鎖入口與書寫框的隱私提示。

**Architecture:** 把加解密相關的「記錄轉換」純邏輯抽成可測小檔 `ven-i-privacy.js`（`toCloudRec`／`mergeCloud`／欄位分類），用 Plan 1/2 的 `JteCrypto`/`JtePrivacy`。index.html 只做接線：上傳前過 `toCloudRec`、讀歷史時 `mergeCloud` 把雲端併回本機再渲染。**加密與否的閘門用同步的 `JtePrivacy.isUnlocked()`**：解鎖→私密欄位加密進 `rec.priv`、移除明文；未解鎖→私密欄位不上傳（只留本機）。

**Tech Stack:** 既有 ven-i（單頁 inline JS、Firebase 9.23 compat、Google 登入）＋ Plan 1/2 的 `jte-crypto.js`／`jte-privacy.js`（hub 共用，絕對 URL 載入）。可測核心用 Plan 2 的 `jte-testrun.py`。

**雙副本（重要）：** ven-i 有兩份完全一致的副本——`/Users/chenchiehyi/vscode/jte-platform-2026/ven-i/`（部署版）與 `/Users/chenchiehyi/vscode/ven-i/`（獨立 repo）。**每個檔案改動都要同步到兩份**（改一份 → `cp` 到另一份），兩個 repo 各自 commit。**不 push**（與 Plan 1/2 同批）。

**前置依賴：** Plan 1（`jte-crypto.js`）、Plan 2（`jte-privacy.js`）已完成（hub repo，未 push）。

---

## 欄位分層（依現有 buildRec）

| | 可分析（明文上雲） | 私密（解鎖才加密／否則只本機） |
|---|---|---|
| 共同 | `id`,`recordId`,`source`,`ts` | — |
| BuYi（卜易） | `ben`,`bian`,`changing`,`changingLabel` | `question`,`note` |
| WenYi（問易） | `topic`,`mainHex`,`tone`,`toneLabel`,`summary` | `note` |

`PRIVATE_FIELDS = ['question','note']`（兩工具私密欄位聯集；WenYi 無 question 不影響）。

---

## File Structure

- Create: `jte-platform-2026/ven-i/ven-i-privacy.js` — 可測整合邏輯，掛 `window.VenIPrivacy`
- Create: `jte-platform-2026/ven-i/ven-i-privacy.test.html` — 瀏覽器測試頁
- Modify: `jte-platform-2026/ven-i/index.html` — 載入三支 script、接線上傳/讀回、啟用解鎖 UI、書寫框提示
- 同步：以上三者各 `cp` 一份到 `/Users/chenchiehyi/vscode/ven-i/` 對應路徑

---

## Task 1: 可測整合模組 `ven-i-privacy.js`（toCloudRec / mergeCloud）

**Files:** Create `jte-platform-2026/ven-i/ven-i-privacy.js`、`jte-platform-2026/ven-i/ven-i-privacy.test.html`

- [ ] **Step 1: 建測試頁（載入 jte-crypto.js、jte-privacy.js、ven-i-privacy.js ＋ fake db ＋ assert 框架）**

複製 `jte-privacy.test.html` 的 assert 框架（`check/assert/eq/log`、`window.__done`、完成 `fetch('/__result')` 回報、`makeFakeDb()`）。在載入 `jte-privacy.js` 前設 `window.__JTE_PRIVACY_TEST = true`（要用其測試 seam `_setBackend`）。`<head>` 依序載入（相對路徑，供本機 server）：`../jte-crypto.js`、`../jte-privacy.js`、`ven-i-privacy.js`。

- [ ] **Step 2: 加測項（先紅）**

```javascript
  function unlockedPrivacy(){
    const db = makeFakeDb(); JtePrivacy._reset(); JtePrivacy._setBackend({db, email:'u@x.com'});
    sessionStorage.clear(); localStorage.removeItem('jte_dek_u@x.com');
    return JtePrivacy._doEnable('pw-12345678'); // 啟用即解鎖，回恢復碼
  }
  const sampleBuyi = { id:'by-1', recordId:'by-1', source:'BuYi', ts:'2026-06-12T01:00:00Z',
    ben:'乾為天', bian:'', changing:[], changingLabel:'六爻不變', question:'我該換工作嗎？', note:'想很久了' };

  await check('toCloudRec（已解鎖）：私密欄位加密進 priv、移除明文、保留可分析', async () => {
    await unlockedPrivacy();
    const c = await VenIPrivacy.toCloudRec(sampleBuyi);
    eq(c.ben, '乾為天', '卦象保留'); eq(c.question, undefined, 'question 明文已移除'); eq(c.note, undefined, 'note 明文已移除');
    assert(c.priv && c.priv.question && c.priv.question.iv && c.priv.question.ct, 'priv.question 為密文');
    assert(c.priv.note && c.priv.note.ct, 'priv.note 為密文');
  });
  await check('toCloudRec（未解鎖）：私密欄位整個不上傳、無 priv、保留可分析', async () => {
    JtePrivacy.lock(); sessionStorage.clear(); localStorage.removeItem('jte_dek_u@x.com');
    const c = await VenIPrivacy.toCloudRec(sampleBuyi);
    eq(c.ben, '乾為天', '卦象保留'); eq(c.question, undefined, 'question 未上傳'); eq(c.note, undefined, 'note 未上傳');
    eq(c.priv, undefined, '無 priv');
  });
  await check('mergeCloud：本機明文優先、雲端獨有記錄解密併入、依 recordId 去重', async () => {
    await unlockedPrivacy();
    const cloudRec = await VenIPrivacy.toCloudRec({ ...sampleBuyi, id:'by-2', recordId:'by-2', question:'雲端獨有的問題', note:'' });
    const cloudDays = { '2026-06-12': { linked: [ cloudRec ] } };
    const localAll = { '2026-06-12': { linked: [ sampleBuyi ] } }; // by-1 在本機（明文）
    const merged = await VenIPrivacy.mergeCloud(localAll, cloudDays);
    const flat = []; Object.keys(merged).forEach(d => (merged[d].linked||[]).forEach(r => flat.push(r)));
    const ids = flat.map(r => r.recordId).sort();
    eq(ids.join(','), 'by-1,by-2', '兩筆都在、去重');
    const r2 = flat.find(r => r.recordId === 'by-2');
    eq(r2.question, '雲端獨有的問題', '雲端記錄已解密還原 question');
    const r1 = flat.find(r => r.recordId === 'by-1');
    eq(r1.question, '我該換工作嗎？', '本機記錄保留明文');
  });
  await check('mergeCloud（未解鎖）：雲端獨有記錄併入但私密欄位留空、不覆寫本機明文', async () => {
    await unlockedPrivacy();
    const cloudRec = await VenIPrivacy.toCloudRec({ ...sampleBuyi, id:'by-3', recordId:'by-3', question:'鎖住時看不到' });
    JtePrivacy.lock(); sessionStorage.clear(); localStorage.removeItem('jte_dek_u@x.com');
    const merged = await VenIPrivacy.mergeCloud({}, { '2026-06-12': { linked:[cloudRec] } });
    const r = merged['2026-06-12'].linked.find(x => x.recordId === 'by-3');
    assert(r, '記錄有併入'); assert(!r.question, '未解鎖時 question 留空');
  });
```

- [ ] **Step 3: 跑測試確認紅**

**從 hub 根目錄跑、指定子目錄頁面**（runner 服務 hub 根，測試頁用 `../jte-crypto.js` 相對路徑即可解到 hub 根的共用檔）：
Run: `cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 jte-testrun.py ven-i/ven-i-privacy.test.html`
（若 `jte-testrun.py` 尚未支援帶子目錄的頁面參數，於此 Task 一併小修 runner 使其能服務 hub 根、開啟 `localhost:<port>/ven-i/ven-i-privacy.test.html`。）
Expected: 4 筆 FAIL（`VenIPrivacy is not defined`）。

- [ ] **Step 4: 實作 `ven-i-privacy.js`**

```javascript
// ven-i-privacy.js — 卜易/問易「記錄分層」整合邏輯（可測純函式）
// 依賴 window.JtePrivacy（jte-privacy.js）。掛 window.VenIPrivacy。
(function (root) {
  'use strict';
  var PRIVATE_FIELDS = ['question', 'note'];

  // 取一筆記錄中實際存在的私密欄位 → {field: plaintext}
  function _pickPrivate(rec){
    var p = {};
    PRIVATE_FIELDS.forEach(function (f){ if (rec[f] !== undefined && rec[f] !== null && rec[f] !== '') p[f] = String(rec[f]); });
    return p;
  }
  // 產生「可上雲」版本：可分析欄位明文保留；私密欄位→解鎖則加密進 priv、未解鎖則整個略去
  function toCloudRec(rec){
    var out = {};
    Object.keys(rec).forEach(function (k){ if (PRIVATE_FIELDS.indexOf(k) === -1) out[k] = rec[k]; });
    if (!root.JtePrivacy || !root.JtePrivacy.isUnlocked()){ return Promise.resolve(out); }
    var priv = _pickPrivate(rec);
    if (Object.keys(priv).length === 0) return Promise.resolve(out);
    return root.JtePrivacy.encryptPrivate(priv).then(function (enc){ out.priv = enc; return out; });
  }
  // 把雲端 days 併入本機 days：依 recordId 去重（本機優先），雲端獨有者解密 priv 後併入
  function mergeCloud(localAll, cloudDays){
    var result = JSON.parse(JSON.stringify(localAll || {}));
    var seen = {};
    Object.keys(result).forEach(function (d){ (result[d].linked || []).forEach(function (r){ seen[r.recordId || r.id] = true; }); });
    var unlocked = root.JtePrivacy && root.JtePrivacy.isUnlocked();
    var chain = Promise.resolve();
    Object.keys(cloudDays || {}).forEach(function (d){
      (cloudDays[d].linked || []).forEach(function (cr){
        var key = cr.recordId || cr.id;
        if (seen[key]) return; // 本機已有（明文優先）→ 跳過
        seen[key] = true;
        chain = chain.then(function (){
          var rec = {}; Object.keys(cr).forEach(function (k){ if (k !== 'priv') rec[k] = cr[k]; });
          if (unlocked && cr.priv){
            return root.JtePrivacy.decryptPrivate(cr.priv).then(function (plain){ Object.keys(plain).forEach(function (f){ if (plain[f] != null) rec[f] = plain[f]; }); _push(result, d, rec); });
          }
          _push(result, d, rec); // 未解鎖或無 priv：私密欄位留空併入
        });
      });
    });
    return chain.then(function (){ return result; });
  }
  function _push(all, d, rec){ if (!all[d]) all[d] = { linked: [] }; if (!all[d].linked) all[d].linked = []; all[d].linked.push(rec); }

  root.VenIPrivacy = { PRIVATE_FIELDS: PRIVATE_FIELDS, toCloudRec: toCloudRec, mergeCloud: mergeCloud };
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 5: 跑測試確認綠（4 筆 PASS）**

Run: `cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 jte-testrun.py ven-i/ven-i-privacy.test.html`
Expected: `DONE pass=4 fail=0`、exit 0。

- [ ] **Step 6: 同步到獨立 repo 並 commit 兩份**

```bash
cp /Users/chenchiehyi/vscode/jte-platform-2026/ven-i/ven-i-privacy.js /Users/chenchiehyi/vscode/ven-i/ven-i-privacy.js
cp /Users/chenchiehyi/vscode/jte-platform-2026/ven-i/ven-i-privacy.test.html /Users/chenchiehyi/vscode/ven-i/ven-i-privacy.test.html
cd /Users/chenchiehyi/vscode/jte-platform-2026 && git add ven-i/ven-i-privacy.js ven-i/ven-i-privacy.test.html && git commit -m "ven-i 隱私整合：可測記錄分層模組 toCloudRec/mergeCloud"
cd /Users/chenchiehyi/vscode/ven-i && git add ven-i-privacy.js ven-i-privacy.test.html && git commit -m "ven-i 隱私整合：可測記錄分層模組 toCloudRec/mergeCloud（雙副本同步）"
```

---

## Task 2: 接線上傳 —— 載入 script ＋ 上傳前過 toCloudRec

**Files:** Modify `jte-platform-2026/ven-i/index.html`（改完 cp 到獨立 repo）

- [ ] **Step 1: 載入三支 script**

在第 1749 行 `jte-userbar.js` 的 `<script>` **之前**插入：
```html
<script defer src="https://flow222git.github.io/jte-platform-2026/jte-crypto.js"></script>
<script defer src="https://flow222git.github.io/jte-platform-2026/jte-privacy.js"></script>
<script defer src="ven-i-privacy.js"></script>
```
（`ven-i-privacy.js` 用相對路徑：部署在 hub `ven-i/` 子目錄下同層；jte-crypto/privacy 用絕對 hub URL，與 jte-userbar.js 一致。）

- [ ] **Step 2: 改 `jteFsSave`（第 1567-1570 行）上傳前把每筆 linked 過 `toCloudRec`**

把 `jteFsSave(dateKey,day)` 改為先建「雲端安全版 day」再上傳：
```javascript
function jteFsSave(dateKey,day){
 const e=jteEmail();if(!_db||!e)return;
 const linked=day.linked||[];
 Promise.all(linked.map(function(r){return (window.VenIPrivacy?window.VenIPrivacy.toCloudRec(r):Promise.resolve(r));}))
  .then(function(cloudLinked){
    const cloudDay=Object.assign({},day,{linked:cloudLinked});
    return _db.collection('users').doc(e.toLowerCase().trim()).collection('daily').doc(dateKey).set(cloudDay,{merge:true});
  }).catch(function(err){console.warn('Firestore write failed',err);});
}
```
（localStorage 仍存完整明文（呼叫端 `jteWriteRecord`/`_jteMutate` 不變），只有上雲版本被脫敏。）

- [ ] **Step 3: 人工線上 smoke（無法 headless）**

部署前無法完整測 Firestore/GSI；於 Task 6 統一線上驗證。本步驟先靜態自我檢查：確認 `jteWriteRecord`（1573-1580）仍寫完整明文到 localStorage、`jteFsSave` 只動上雲版本。

- [ ] **Step 4: cp 到獨立 repo、兩 repo commit**

```bash
cp /Users/chenchiehyi/vscode/jte-platform-2026/ven-i/index.html /Users/chenchiehyi/vscode/ven-i/index.html
cd /Users/chenchiehyi/vscode/jte-platform-2026 && git add ven-i/index.html && git commit -m "ven-i：載入加密 script＋上傳前脫敏私密欄位"
cd /Users/chenchiehyi/vscode/ven-i && git add index.html && git commit -m "ven-i：載入加密 script＋上傳前脫敏私密欄位（雙副本同步）"
```

---

## Task 3: 讀回 —— jteListRecords 併入雲端、renderHistory 解密顯示

**Files:** Modify `jte-platform-2026/ven-i/index.html`

- [ ] **Step 1: 新增「從 Firestore 抓本帳號 daily」函式**

在 `jteListRecords`（1582 行）附近新增：
```javascript
function jteFsLoadDays(){
 const e=jteEmail();if(!_db||!e)return Promise.resolve({});
 return _db.collection('users').doc(e.toLowerCase().trim()).collection('daily').get()
  .then(function(snap){var days={};snap.forEach(function(doc){days[doc.id]=doc.data();});return days;})
  .catch(function(){return {};});
}
```

- [ ] **Step 2: 新增 async 版讀取：把雲端併回本機後回傳攤平清單**

新增（保留舊同步 `jteListRecords` 給其它呼叫端，新增 async 版供歷史頁）：
```javascript
function jteListRecordsMerged(){
 const localAll=jteAll();
 if(!window.VenIPrivacy)return Promise.resolve(_flattenVenI(localAll));
 return jteFsLoadDays().then(function(cloudDays){
   return window.VenIPrivacy.mergeCloud(localAll,cloudDays);
 }).then(function(mergedAll){
   try{localStorage.setItem(jteKey(),JSON.stringify(mergedAll));}catch(e){} // hydrate 本機（含已解密私密），讓編輯/刪除沿用既有機制
   return _flattenVenI(mergedAll);
 });
}
function _flattenVenI(all){var out=[];Object.keys(all).forEach(function(dk){(all[dk].linked||[]).forEach(function(l){if(l.source==='WenYi'||l.source==='BuYi')out.push(l);});});out.sort(function(a,b){return (b.ts||'').localeCompare(a.ts||'');});return out;}
```
（`jteListRecords` 1582-1598 可改為 `return _flattenVenI(jteAll());` 復用 `_flattenVenI`，行為不變。）

- [ ] **Step 3: `renderHistory`（1680-1727）改用 async 版**

把 `renderHistory` 內 `const recs=jteListRecords();`（約 1691 行）改為先顯示「載入中…」，再 `jteListRecordsMerged().then(function(recs){ ...原渲染邏輯... });`。其餘卡片渲染、編輯筆記、刪除邏輯不變（因已 hydrate 到 localStorage）。

- [ ] **Step 4: 靜態自我檢查 ＋ cp ＋ 兩 repo commit**

確認：未解鎖時 `mergeCloud` 不覆寫本機明文（Task 1 測項已保證）；hydrate 後 `_jteMutate`/`jteDeleteRecord` 仍可運作。
```bash
cp /Users/chenchiehyi/vscode/jte-platform-2026/ven-i/index.html /Users/chenchiehyi/vscode/ven-i/index.html
cd /Users/chenchiehyi/vscode/jte-platform-2026 && git add ven-i/index.html && git commit -m "ven-i：歷史頁讀回 Firestore 併本機、解密顯示"
cd /Users/chenchiehyi/vscode/ven-i && git add index.html && git commit -m "ven-i：歷史頁讀回 Firestore 併本機、解密顯示（雙副本同步）"
```

---

## Task 4: 啟用／解鎖 UI（歷史頁）

**Files:** Modify `jte-platform-2026/ven-i/index.html`

- [ ] **Step 1: 歷史頁標題下加「私密同步」狀態列**

在 `renderHistory` 標題（1684 行「我的占問歷史」）之後、列表之前插入一塊狀態列，依狀態顯示：
- 未登入：不顯示（沿用既有登入提示）。
- 已登入、`JtePrivacy.isEnabled()` 為 false：「🔒 開啟跨裝置私密同步」鈕 → onclick `JtePrivacy.enable().then(renderHistory)`。
- 已啟用但 `isUnlocked()` 為 false：「🔓 輸入密語解鎖私密內容」鈕 → onclick `JtePrivacy.unlock().then(renderHistory)`；另有小字「換密語」→ `JtePrivacy.changePassphrase()`。
- 已解鎖：「✓ 已加密同步（連我們也解不開）・鎖定」，「鎖定」→ `JtePrivacy.lock();renderHistory()`。

因 `isEnabled()` 為 async，狀態列以 `isEnabled().then(...)` 決定要渲染哪個版本。樣式比照頁面既有卡片/膠囊鈕。

- [ ] **Step 2: 進歷史頁時若已啟用未解鎖→自動提示解鎖（一次）**

`renderHistory` 載入後，若 `isEnabled()` 且 `!isUnlocked()`，自動呼叫一次 `JtePrivacy.unlock().then(renderHistory).catch(function(){})`（使用者可取消，取消就維持只顯示可分析層）。用模組旗標避免重複彈出。

- [ ] **Step 3: cp ＋ 兩 repo commit**（"ven-i：歷史頁啟用/解鎖私密同步入口"）

---

## Task 5: 書寫框隱私提示（第 1 層那行字）

**Files:** Modify `jte-platform-2026/ven-i/index.html`

- [ ] **Step 1: 卜易問題框上緣加一行字**

在卜易問題 textarea（第 1343 行）所在容器、textarea 之前插入：
```html
<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#6B7A8D;margin-bottom:8px">
  <span>🔒</span><span>只有你看得到，連我們也解不開</span>
  <a href="#" onclick="event.preventDefault();showPrivacyInfo&&showPrivacyInfo()" style="color:#003D7C">了解隱私</a>
</div>
```
（`showPrivacyInfo` 為 Plan 5 的聲明頁；此處先容錯呼叫，未定義則只是無動作。）

- [ ] **Step 2: 筆記 textarea（第 1659 行）旁同樣加 🔒 小字**（精簡版，無連結）

- [ ] **Step 3: cp ＋ 兩 repo commit**（"ven-i：卜易問題框/筆記加隱私提示那行字"）

---

## Task 6: 線上 smoke test（人工，整合驗證）

部署前最後在本機用 server 起整站做端到端驗證（GSI/Firestore 需線上帳號，此步需使用者協助或在已授權環境）。

- [ ] **Step 1: 本機起站、逐項驗證清單**

```bash
cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 -m http.server 8780 >/tmp/jte.log 2>&1 &
open "http://localhost:8780/ven-i/index.html"
```
（注意：本機載入時 jte-crypto/privacy 走絕對 hub URL，需 hub 已 push 或暫時改相對路徑測試；smoke 清單見下。）

驗證清單：
1. 未登入可正常問卦（私密內容存本機）。
2. 登入後到歷史頁 → 出現「開啟跨裝置私密同步」→ 設密語 → 顯示恢復碼可下載。
3. 啟用後卜一卦 → 開 Firestore console 看 `users/{email}/daily/{date}` → 確認 `question`/`note` 是 `priv:{iv,ct}` 密文、卦象明文。
4. 換另一裝置/無痕視窗登入同帳號 → 歷史頁解鎖 → 看得到並解密出問題與筆記。
5. 鎖定狀態下歷史頁只顯示卦象/類型，私密欄位空白。
6. `pkill -f "http.server 8780"`。

- [ ] **Step 2: 記錄 smoke 結果**

此步驟為人工驗證，無自動測試。把結果回報給控制者。**全部通過前不 push。**

---

## 未涵蓋（後續 Plan）
- 心理位移整合（同模式）→ Plan 4
- admin 後台不顯示私密、共用隱私聲明頁 `showPrivacyInfo`、首次卡片、**整批一起 push 上線** → Plan 5
- 卜易「問題類型」分類欄位（增 BuYi analyzable）→ 之後增強，非本批
- 既有明文舊記錄的遷移（目前停在本機；啟用後是否回填加密）→ 另議
