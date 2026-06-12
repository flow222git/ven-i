# 心理位移加密跨裝置同步 Implementation Plan（Plan 6）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 讓心理位移書寫（writespace）也能跨裝置：使用者開啟「私密同步」後，整筆書寫用平台密語加密上 Firestore，換裝置解鎖即可解密讀回；未啟用則維持「只存本機」。沿用已上線的 `JtePrivacy`（同一把平台 DEK），與卜易共用一組密語。

**Architecture:** 比照卜易 Plan 3。把「記錄↔雲端」加解密與合併抽成可測純模組 `writespace-privacy.js`（`recordToCloud`/`cloudToRecord`/`mergeRecords`）。writespace 記錄幾乎全是私密 → 把私密 payload（`title/entries/analysis/summaryMarkdown`）整包 JSON 後用 `JtePrivacy.encryptPrivate({body:...})` 加密，存 Firestore 專屬集合 `users/{email}/writespace/{id}`（`{id,createdAt,updatedAt,enc:{iv,ct}}`，無明文內容）。解鎖時上傳/讀回；未解鎖不上傳。🔒 提示動態反映狀態。

**Tech Stack:** writespace 獨立 repo `/Users/chenchiehyi/vscode/writespace/`。依賴已上線的 hub `jte-crypto.js`/`jte-privacy.js`（`window.JteCrypto`/`JtePrivacy`，writespace 已載入 jte-privacy.js；需補載 jte-crypto.js）。測試沿用 `jte-testrun.py`（複製進 writespace；測試頁從 live hub URL 載入 jte-crypto/privacy）。

**前置：** Plan 1–5 已上線。`JtePrivacy` API：`isEnabled()/isUnlocked()/enable()/unlock()/changePassphrase()/lock()/encryptPrivate(obj)/decryptPrivate(obj)`，測試 seam `_setBackend/_reset/_doEnable`（需 `window.__JTE_PRIVACY_TEST=true`）。

**單一 repo**（writespace 無雙副本）。做完直接 push（純新增能力＋漸進式，不影響未啟用者）。

---

## writespace 記錄模型（現況）
- `records[]`（localStorage `RECORDS_KEY='position-shift-space-records-v1'`），每筆 `{id,title,createdAt,updatedAt,entries:{topic,iFirst,you,observer,iFinal,action},analysis,summaryMarkdown}`。
- `loadRecords()`(app.js:314)、`saveRecords()`(330)、`saveCurrentRecord()`(428)、`createRecordFromState`(409)、`normalizeRecord`(335)。
- Firebase：`_jteWsDb`/`initFirebase`(1573-1583)、`jteEmail()`(1584)。
- 記錄面板：`renderRecordsPanel`(1093)、`renderRecordsList`(1121)。textarea 🔒 行在 index.html（Plan 4 加）。

---

## File Structure
- Create: `/Users/chenchiehyi/vscode/writespace/writespace-privacy.js` — 純邏輯，掛 `window.WsPrivacy`
- Create: `/Users/chenchiehyi/vscode/writespace/writespace-privacy.test.html`、複製 `jte-testrun.py` 進 writespace
- Modify: `/Users/chenchiehyi/vscode/writespace/app.js`（上傳/讀回/合併接線、動態 🔒）
- Modify: `/Users/chenchiehyi/vscode/writespace/index.html`（補載 jte-crypto.js、🔒 行加 id 供動態更新）

---

## Task 1: 可測模組 `writespace-privacy.js`

**Files:** Create `writespace-privacy.js`、`writespace-privacy.test.html`、複製 `jte-testrun.py`

- [ ] **Step 1: 複製 runner ＋ 建測試頁骨架**

```bash
cp /Users/chenchiehyi/vscode/jte-platform-2026/jte-testrun.py /Users/chenchiehyi/vscode/writespace/jte-testrun.py
```
測試頁 `writespace-privacy.test.html`：沿用 assert 框架（`check/assert/eq`、`window.__done`、`fetch('/__result')`、`makeFakeDb`）。`<head>` **先** inline `window.__JTE_PRIVACY_TEST=true;`，再依序載入 live hub 的 `https://flow222git.github.io/jte-platform-2026/jte-crypto.js`、`.../jte-privacy.js`，最後 `writespace-privacy.js`。

- [ ] **Step 2: 測項（先紅）**

```javascript
  function unlocked(){ const db=makeFakeDb(); JtePrivacy._reset(); JtePrivacy._setBackend({db,email:'u@x.com'}); sessionStorage.clear(); localStorage.removeItem('jte_dek_u@x.com'); return JtePrivacy._doEnable('pw-12345678'); }
  const sample = { id:'record-1', title:'換工作', createdAt:'2026-06-12T01:00:00Z', updatedAt:'2026-06-12T02:00:00Z',
    entries:{topic:'換工作',iFirst:'我很焦慮',you:'你在猶豫',observer:'他看得很遠',iFinal:'我決定試試',action:'明天投履歷'},
    analysis:{emotions:['焦慮']}, summaryMarkdown:'# 報告' };

  await check('recordToCloud（解鎖）：產出無明文、含 enc 密文、保留 id/時間', async () => {
    await unlocked();
    const c = await WsPrivacy.recordToCloud(sample);
    eq(c.id,'record-1','id 保留'); assert(c.enc&&c.enc.iv&&c.enc.ct,'enc 密文');
    eq(c.entries,undefined,'無明文 entries'); eq(c.summaryMarkdown,undefined,'無明文 summary'); eq(c.title,undefined,'無明文 title');
    assert(JSON.stringify(c).indexOf('焦慮')===-1,'整個雲端物件不含任何明文書寫');
  });
  await check('cloudToRecord（解鎖）：還原整筆書寫', async () => {
    await unlocked();
    const c = await WsPrivacy.recordToCloud(sample);
    const r = await WsPrivacy.cloudToRecord(c);
    eq(r.entries.iFirst,'我很焦慮','還原 entries'); eq(r.summaryMarkdown,'# 報告','還原 summary'); eq(r.title,'換工作','還原 title'); eq(r.id,'record-1','id');
  });
  await check('recordToCloud（未解鎖）：reject，不產生明文上傳物', async () => {
    JtePrivacy.lock(); sessionStorage.clear(); localStorage.removeItem('jte_dek_u@x.com');
    let threw=false; try{ await WsPrivacy.recordToCloud(sample);}catch(e){threw=true;} assert(threw,'未解鎖應 reject');
  });
  await check('cloudToRecord（未解鎖）：回 null（無法解密）', async () => {
    await unlocked(); const c=await WsPrivacy.recordToCloud(sample);
    JtePrivacy.lock(); sessionStorage.clear(); localStorage.removeItem('jte_dek_u@x.com');
    const r=await WsPrivacy.cloudToRecord(c); eq(r,null,'鎖定回 null');
  });
  await check('mergeRecords：依 id 去重、updatedAt 新者勝', async () => {
    const local=[{id:'a',updatedAt:'2026-06-12T05:00:00Z',title:'本機新'},{id:'b',updatedAt:'2026-06-10T00:00:00Z',title:'只本機'}];
    const cloud=[{id:'a',updatedAt:'2026-06-12T01:00:00Z',title:'雲端舊'},{id:'c',updatedAt:'2026-06-11T00:00:00Z',title:'只雲端'}];
    const m=WsPrivacy.mergeRecords(local,cloud);
    const byId={}; m.forEach(r=>byId[r.id]=r);
    eq(Object.keys(byId).sort().join(','),'a,b,c','三筆都在');
    eq(byId.a.title,'本機新','a 取較新的本機版'); eq(byId.c.title,'只雲端','雲端獨有併入');
  });
```

- [ ] **Step 3: 跑測試確認紅**　`cd /Users/chenchiehyi/vscode/writespace && python3 jte-testrun.py writespace-privacy.test.html`

- [ ] **Step 4: 實作 `writespace-privacy.js`**

```javascript
// writespace-privacy.js — 心理位移「記錄↔雲端」加解密與合併（可測純函式）
// 依賴 window.JtePrivacy。掛 window.WsPrivacy。
(function (root) {
  'use strict';
  var PRIV = ['title','entries','analysis','summaryMarkdown']; // 視為私密的欄位

  function recordToCloud(record){
    if (!root.JtePrivacy || !root.JtePrivacy.isUnlocked()) return Promise.reject(new Error('locked'));
    var payload = {}; PRIV.forEach(function(k){ payload[k] = record[k]; });
    return root.JtePrivacy.encryptPrivate({ body: JSON.stringify(payload) }).then(function(enc){
      return { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt, enc: enc.body };
    });
  }
  function cloudToRecord(doc){
    if (!doc || !doc.enc) return Promise.resolve(null);
    if (!root.JtePrivacy || !root.JtePrivacy.isUnlocked()) return Promise.resolve(null);
    return root.JtePrivacy.decryptPrivate({ body: doc.enc }).then(function(plain){
      if (plain.body == null) return null;
      var payload; try { payload = JSON.parse(plain.body); } catch(e){ return null; }
      var rec = { id: doc.id, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
      PRIV.forEach(function(k){ rec[k] = payload[k]; });
      return rec;
    }).catch(function(){ return null; });
  }
  function mergeRecords(localList, cloudList){
    var by = {};
    (localList||[]).forEach(function(r){ by[r.id] = r; });
    (cloudList||[]).forEach(function(r){
      if (!r) return;
      var cur = by[r.id];
      if (!cur) { by[r.id] = r; return; }
      var t1 = new Date(r.updatedAt||r.createdAt||0).getTime();
      var t0 = new Date(cur.updatedAt||cur.createdAt||0).getTime();
      if (t1 > t0) by[r.id] = r; // 新者勝
    });
    return Object.keys(by).map(function(k){ return by[k]; });
  }
  root.WsPrivacy = { recordToCloud: recordToCloud, cloudToRecord: cloudToRecord, mergeRecords: mergeRecords, _PRIV: PRIV };
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 5: 跑測試綠（5 綠）→ Commit**　`git add writespace-privacy.js writespace-privacy.test.html jte-testrun.py && git commit -m "心理位移：可測記錄↔雲端加解密/合併模組"`

---

## Task 2: 上傳接線（app.js）—— 啟用解鎖時把書寫加密上雲

**Files:** Modify `writespace/app.js`、`writespace/index.html`

- [ ] **Step 1: index.html 補載 `jte-crypto.js`**（在 jte-privacy.js 之前），並讓 textarea 🔒 行可動態更新：給該行外層 `<span>` 文案一個 `id="ws-privacy-line"`（保留現有文字當預設）。

- [ ] **Step 2: app.js 新增雲端上傳/刪除工具**

```javascript
function wsFsDoc(id){ var e=jteEmail(); if(!_jteWsDb||!e) return null; return _jteWsDb.collection('users').doc(e.toLowerCase().trim()).collection('writespace').doc(id); }
function wsPushRecord(record){
  try{
    if(!window.WsPrivacy||!window.JtePrivacy||!JtePrivacy.isUnlocked()) return; // 未啟用/未解鎖：只本機
    var ref=wsFsDoc(record.id); if(!ref) return;
    WsPrivacy.recordToCloud(record).then(function(doc){ ref.set(doc); }).catch(function(){});
  }catch(e){console.warn('ws push failed',e);}
}
function wsDeleteRecord(id){ try{ var ref=wsFsDoc(id); if(ref) ref.delete().catch(function(){}); }catch(e){} }
```

- [ ] **Step 3: 在 `saveCurrentRecord`(428) 與記錄編輯儲存路徑後呼叫 `wsPushRecord(record)`；刪除記錄路徑呼叫 `wsDeleteRecord(id)`**（找 app.js 內刪除記錄的函式——`records.filter(... id !==)` 後接 `saveRecords()` 之處）。保持「未解鎖不上傳」。

- [ ] **Step 4: 靜態自我檢查**：未解鎖時 `wsPushRecord` 直接 return（不上傳）；雲端 doc 無明文（靠 Task1 測項保證）；本機 `saveRecords` 不變。Commit。

---

## Task 3: 讀回合併（app.js）—— 解鎖時拉雲端、解密、併本機

**Files:** Modify `writespace/app.js`

- [ ] **Step 1: 新增拉取＋合併**

```javascript
function wsFsLoad(){ var e=jteEmail(); if(!_jteWsDb||!e) return Promise.resolve([]); return _jteWsDb.collection('users').doc(e.toLowerCase().trim()).collection('writespace').get().then(function(s){ var a=[]; s.forEach(function(d){ a.push(d.data()); }); return a; }).catch(function(){ return []; }); }
function wsSyncFromCloud(){
  if(!window.WsPrivacy||!window.JtePrivacy||!JtePrivacy.isUnlocked()) return Promise.resolve(false);
  return wsFsLoad().then(function(docs){ return Promise.all(docs.map(WsPrivacy.cloudToRecord)); }).then(function(cloudRecs){
    cloudRecs=cloudRecs.filter(Boolean).map(normalizeRecord);
    records = WsPrivacy.mergeRecords(records, cloudRecs).sort(sortRecords);
    saveRecords(); renderRecordsPanel();
    return true;
  });
}
```

- [ ] **Step 2: 在解鎖成功後、與（若已解鎖）載入完成後呼叫 `wsSyncFromCloud()`**（見 Task 4 的解鎖流程）。容錯、不阻塞。Commit。

---

## Task 4: 啟用/解鎖 UI ＋ 動態 🔒（app.js）

**Files:** Modify `writespace/app.js`

- [ ] **Step 1: 記錄面板列表頂部加「私密同步」狀態列**

在 `renderRecordsList`(1121) 回傳的 HTML 最前面插入一塊狀態列容器 `<div id="ws-privacy-bar"></div>`，並於 `renderRecordsPanel` 渲染後呼叫 `wsRenderPrivacyBar()` 填入（因 `isEnabled()` 為 async）。四態（比照卜易）：
- 未登入：提示登入。
- 已登入未啟用：「🔒 開啟跨裝置加密同步」→ `JtePrivacy.enable().then(function(){wsSyncFromCloud();wsRefreshPrivacyLine();wsRenderPrivacyBar();})`。
- 已啟用未解鎖：「🔓 解鎖」→ `JtePrivacy.unlock().then(同上)`；「換密語」。
- 已解鎖：「✓ 已加密同步（連我們也解不開）・鎖定」→ `JtePrivacy.lock()` 後刷新。

- [ ] **Step 2: 動態 🔒 行**

```javascript
function wsRefreshPrivacyLine(){
  var el=document.getElementById('ws-privacy-line'); if(!el||!window.JtePrivacy) return;
  if(JtePrivacy.isUnlocked()) el.textContent='已加密同步，連我們也解不開';
  else el.textContent='你的書寫只存在這台裝置，不會上傳';
}
```
於初始、登入、啟用/解鎖/鎖定後呼叫。（未啟用或未解鎖都顯示「只存這台裝置」——誠實：未上傳；啟用且解鎖才顯示「已加密同步」。）

- [ ] **Step 3: 進站若已啟用未解鎖→自動提示解鎖一次（旗標防重複），解鎖後 `wsSyncFromCloud()`**。Commit。

---

## Task 5: 驗證＋上線
- [ ] Task1 測試綠（`python3 jte-testrun.py writespace-privacy.test.html` 5 綠）。
- [ ] headless sanity：載入 writespace 無 JS 例外、書寫框與記錄面板渲染、🔒 行在。
- [ ] push writespace（單 repo）。確認 live `writespace-privacy.js` 可載。
- [ ] 人工 smoke（使用者）：啟用→寫一篇→Firestore 看 `users/{email}/writespace/{id}` 為 `enc` 密文無明文→換裝置解鎖讀回。

---

## 決策註記（已定）
- 整筆書寫加密為單一 `enc` blob（writespace 無有意義的可分析層，毋須逐欄位）。
- 合併用 **updatedAt 新者勝**（支援跨裝置編輯），非單純本機優先。
- 共用平台單一密語（在卜易設過即可解 writespace）。
- 未啟用者完全不受影響（仍純本機、不上傳）。

## 未涵蓋
- 跨裝置刪除的 tombstone（目前刪除會刪雲端 doc；若 A 刪、B 未同步可能 B 又上傳回來——可接受，後續可加 deletedAt 墓碑）。
