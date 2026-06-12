# 隱私同步整合層 jte-privacy.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan 1 的純加密庫 `jte-crypto.js` 包成各工具可直接使用的整合層 `jte-privacy.js`：管理「是否啟用」狀態、把包好的金鑰存取於 Firestore、提供設定／解鎖／重設密語的畫面、管理 session DEK 與「記住裝置」、並提供 `encryptPrivate`／`decryptPrivate` 給工具加解密私密欄位。

**Architecture:** 比照 `jte-userbar.js`：單一 IIFE 模組，掛 `window.JtePrivacy`，`<script defer>` 共用載入，讀 `localStorage['jte_user_email']` 取使用者、用全域 `firebase.firestore()` 存取。**安全敏感的核心邏輯（狀態、金鑰存取、DEK 快取、加解密）與 DOM modal 分離**：核心是可注入後端（fake db）的純邏輯函式、可自動測試；modal 只負責收輸入再呼叫核心。包好的金鑰存於 Firestore `users/{email}` doc 的 `crypto` 欄位。

**Tech Stack:** 依賴 Plan 1 的 `window.JteCrypto`（同 hub repo）。Firebase 9.23 compat（各頁已載入）。測試沿用 Plan 1 模式：`python3` stdlib runner ＋ Chrome headless ＋ `POST /__result`（本機無 node）。

**前置依賴：** Plan 1（`jte-crypto.js`）已完成。本計畫所有檔案同在 hub repo `/Users/chenchiehyi/vscode/jte-platform-2026/`；計畫文件放 ven-i repo `docs/`。**不 push**（與 Plan 1 同批，待 Plan 3/4 整套就緒再上線）。

---

## 設計決策（已定，plan 審查可改）

1. **金鑰儲存位置：** Firestore `users/{email}` doc 的 `crypto` 欄位 = Plan 1 `setup()` 產生的 `blob`（`{v,salt,kdf,wrapPass,wrapRec}`）。salt 與包好的金鑰皆非機密，明文存無妨。
2. **啟用＝該使用者在 Firestore 已有 `crypto` blob。** 未登入者不可啟用（沒有 per-user 儲存位置）。
3. **session DEK 快取：** 預設放記憶體變數 ＋ `sessionStorage`（關分頁即失效，需重解鎖）；使用者於解鎖時可勾「記住這台裝置」→ 另寫 `localStorage`（跨 session 免重打）。`lock()` 清掉三者。DEK 以 base64 存。**安全註記：** 「記住這台裝置」等同把 DEK 留在該裝置，XSS／實體存取者可讀 —— 這是標準「記住我」取捨，預設不開、由使用者明確勾選。
4. **漸進式啟用的本機留存規則**由工具端（Plan 3/4）決定；本層只提供 `isEnabled()` 供工具判斷要不要上傳私密欄位。

## 模組公開 API（契約，供 Plan 3/4 依循）

掛 `window.JtePrivacy`：
- `isEnabled()` → Promise<bool>：此使用者 Firestore 是否已有 crypto blob
- `isUnlocked()` → bool：當前 session 是否握有 DEK
- `enable()` → Promise<bool>：開「設定密語」modal（密語×2 → setup → 存 blob → 顯示/下載恢復碼 → 快取 DEK）。resolve(true)；使用者取消 reject
- `unlock()` → Promise<bool>：開「解鎖」modal（輸入密語 → 解鎖 → 快取 DEK；含「忘記密語→恢復碼重設」）。resolve(true)／取消 reject
- `changePassphrase()` → Promise<bool>：開「換密語」modal（需先解鎖）
- `lock()` → void：清 session DEK（記憶體＋sessionStorage＋localStorage 快取）
- `encryptPrivate(obj)` → Promise<{[field]:{iv,ct}}>：用 session DEK 加密各欄位（未解鎖則 throw）
- `decryptPrivate(obj)` → Promise<{[field]:plaintext}>：解密（未解鎖則 throw；個別欄位解失敗回原樣並標記）
- 測試 seam：`_setBackend({db,email})` 注入 fake db／email；`_reset()` 清內部狀態

---

## File Structure

- Create: `/Users/chenchiehyi/vscode/jte-platform-2026/jte-privacy.js` — 整合層，掛 `window.JtePrivacy`
- Create: `/Users/chenchiehyi/vscode/jte-platform-2026/jte-privacy.test.html` — 瀏覽器自我測試頁
- Create: `/Users/chenchiehyi/vscode/jte-platform-2026/jte-testrun.py` — 通用測試 runner（`python3 jte-testrun.py <page.html>`），供本計畫與未來共用

---

## Task 1: 通用測試 runner ＋ 模組骨架 ＋ 後端注入 seam

**Files:**
- Create: `jte-testrun.py`
- Create: `jte-privacy.js`（骨架）
- Create: `jte-privacy.test.html`（骨架，含 fake db）

- [ ] **Step 1: 建通用 runner `jte-testrun.py`**

以 hub repo 既有 `jte-crypto-testrun.py` 為範本，改成接受測試頁參數。行為不變：起隨機埠 http server 服務本目錄＋接 `POST /__result`、真實時間背景啟動 headless Chrome 指向 `http://localhost:<port>/<page>`、輪詢結果檔→印 PASS/FAIL/DONE、kill Chrome＋server、`FAIL`/逾時 exit≠0。逾時給 90s（modal 測試含多次 PBKDF2）。用法註解：`python3 jte-testrun.py jte-privacy.test.html`。

- [ ] **Step 2: 建 `jte-privacy.js` 骨架**

```javascript
// jte-privacy.js — 全平台私密書寫共用「隱私同步整合層」
// 載入：<script defer src="https://flow222git.github.io/jte-platform-2026/jte-privacy.js"></script>
// 依賴 window.JteCrypto（jte-crypto.js）與 firebase（9.23 compat，各頁已載入）。
// 把 DEK 與密語明文留在使用者裝置；Firestore 只存包好的金鑰 blob。
(function (root) {
  'use strict';
  if (root.__jtePrivacyLoaded) return;
  root.__jtePrivacyLoaded = true;

  var _backend = null; // {db, email} —— 測試可注入；正式由 _liveBackend() 取得
  var _dek = null;     // 當前 session 的 DEK（Uint8Array），未解鎖為 null

  function _liveBackend(){
    var email = (root.localStorage.getItem('jte_user_email') || '').toLowerCase().trim();
    var db = (root.firebase && root.firebase.firestore) ? root.firebase.firestore() : null;
    return { db: db, email: email };
  }
  function backend(){ return _backend || _liveBackend(); }

  root.JtePrivacy = {
    _setBackend: function (b){ _backend = b; },
    _reset: function (){ _backend = null; _dek = null; }
    // 其餘 API 於後續 Task 補上
  };
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 3: 建 `jte-privacy.test.html` 骨架（含 fake Firestore db ＋ 迷你 assert 框架）**

沿用 Plan 1 測試頁的 assert 框架（`check/assert/eq/log`、`window.__done`、完成時 `fetch('/__result')` 回報 —— 直接複製該段）。`<head>` 依序載入 `jte-crypto.js`、`jte-privacy.js`。並提供一個 in-memory fake Firestore：

```javascript
// fake Firestore：支援 .collection('users').doc(email).get()/.set(data,{merge})
function makeFakeDb(){
  const store = {}; // email -> doc data
  return {
    _store: store,
    collection(){ return {
      doc(id){ return {
        get(){ return Promise.resolve({ exists: id in store, data(){ return store[id]; } }); },
        set(data, opts){ store[id] = (opts && opts.merge) ? Object.assign({}, store[id], data) : data; return Promise.resolve(); }
      }; }
    }; }
  };
}
```

- [ ] **Step 4: 跑 runner 確認 harness 通**

Run: `cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 jte-testrun.py jte-privacy.test.html`
Expected: `DONE pass=0 fail=0`、exit 0（harness＋fake db 就緒、JteCrypto/JtePrivacy 載入無誤）。

- [ ] **Step 5: Commit**

```bash
cd /Users/chenchiehyi/vscode/jte-platform-2026
git add jte-testrun.py jte-privacy.js jte-privacy.test.html
git commit -m "jte-privacy: 整合層測試基礎建設＋模組骨架＋fake db seam"
```

---

## Task 2: 啟用狀態 ＋ Firestore blob 存取（isEnabled / loadBlob / saveBlob）

**Files:** Modify `jte-privacy.js`、`jte-privacy.test.html`

- [ ] **Step 1: 在測試頁加測項（先紅）**

```javascript
  function freshPrivacy(seedBlob){
    const db = makeFakeDb();
    if (seedBlob) db._store['u@x.com'] = { crypto: seedBlob };
    JtePrivacy._reset();
    JtePrivacy._setBackend({ db: db, email: 'u@x.com' });
    return db;
  }
  await check('未啟用使用者 isEnabled()=false', async () => {
    freshPrivacy(null);
    eq(await JtePrivacy.isEnabled(), false, 'isEnabled');
  });
  await check('已有 crypto blob → isEnabled()=true', async () => {
    const s = await JteCrypto.setup('pw');
    freshPrivacy(s.blob);
    eq(await JtePrivacy.isEnabled(), true, 'isEnabled');
  });
  await check('未登入（email 空）→ isEnabled()=false 不丟例外', async () => {
    JtePrivacy._reset(); JtePrivacy._setBackend({ db: makeFakeDb(), email: '' });
    eq(await JtePrivacy.isEnabled(), false, '空 email');
  });
```

- [ ] **Step 2: 跑測試確認紅**（`JtePrivacy.isEnabled is not a function`）

Run: `python3 jte-testrun.py jte-privacy.test.html`

- [ ] **Step 3: 在 `jte-privacy.js` 實作（加在 `root.JtePrivacy = {` 物件內或其上方輔助）**

於骨架的輔助函式區加入：
```javascript
  function loadBlob(){
    var b = backend();
    if (!b.db || !b.email) return Promise.resolve(null);
    return b.db.collection('users').doc(b.email).get()
      .then(function (snap){ return (snap.exists && snap.data() && snap.data().crypto) || null; })
      .catch(function (){ return null; });
  }
  function saveBlob(blob){
    var b = backend();
    if (!b.db || !b.email) return Promise.reject(new Error('no-user'));
    return b.db.collection('users').doc(b.email).set({ crypto: blob }, { merge: true });
  }
```
並在 `root.JtePrivacy` 物件加入：
```javascript
    isEnabled: function (){ return loadBlob().then(function (x){ return !!x; }); },
```

- [ ] **Step 4: 跑測試確認綠**（上述 3 筆 PASS）

- [ ] **Step 5: Commit**

```bash
git add jte-privacy.js jte-privacy.test.html
git commit -m "jte-privacy: 啟用狀態＋Firestore blob 存取"
```

---

## Task 3: session DEK 管理 ＋ 記住裝置 ＋ 核心啟用/解鎖/重設邏輯（非 DOM）

**Files:** Modify `jte-privacy.js`、`jte-privacy.test.html`

把 DOM 無關的核心邏輯做成可測函式：`_doEnable(passphrase)`、`_doUnlock(passphrase, remember)`、`_doRecover(recoveryCode, newPassphrase)`、`_doChange(newPassphrase)`，以及 DEK 快取 `_cacheDek/_loadCachedDek/lock`、`isUnlocked`。

- [ ] **Step 1: 測項（先紅）**

```javascript
  const DEKKEY = 'jte_dek_u@x.com';
  function clearDekStores(){ sessionStorage.removeItem(DEKKEY); localStorage.removeItem(DEKKEY); }
  await check('_doEnable 設定密語→存 blob→isEnabled/isUnlocked 皆 true', async () => {
    const db = freshPrivacy(null); clearDekStores();
    const rec = await JtePrivacy._doEnable('pw-enable');
    assert(typeof rec === 'string' && rec.length >= 20, '應回傳恢復碼供顯示');
    eq(!!db._store['u@x.com'].crypto, true, 'blob 已存');
    eq(JtePrivacy.isUnlocked(), true, '啟用後即解鎖');
  });
  await check('_doUnlock 正確密語→解鎖；私密欄位可加解密', async () => {
    const s = await JteCrypto.setup('pw-x'); freshPrivacy(s.blob); clearDekStores();
    eq(JtePrivacy.isUnlocked(), false, '初始鎖定');
    await JtePrivacy._doUnlock('pw-x', false);
    eq(JtePrivacy.isUnlocked(), true, '解鎖成功');
  });
  await check('_doUnlock 錯密語→reject 且維持鎖定', async () => {
    const s = await JteCrypto.setup('right'); freshPrivacy(s.blob); clearDekStores();
    let threw = false;
    try { await JtePrivacy._doUnlock('wrong', false); } catch(e){ threw = true; }
    assert(threw, '錯密語應 reject');
    eq(JtePrivacy.isUnlocked(), false, '仍鎖定');
  });
  await check('記住裝置：remember=true 寫 localStorage；false 只寫 sessionStorage', async () => {
    const s = await JteCrypto.setup('pw'); freshPrivacy(s.blob); clearDekStores();
    await JtePrivacy._doUnlock('pw', false);
    eq(localStorage.getItem(DEKKEY), null, 'false 不寫 localStorage');
    assert(sessionStorage.getItem(DEKKEY), 'false 有寫 sessionStorage');
    clearDekStores(); JtePrivacy.lock();
    await JtePrivacy._doUnlock('pw', true);
    assert(localStorage.getItem(DEKKEY), 'true 寫 localStorage');
  });
  await check('lock() 清掉所有 DEK 快取且 isUnlocked=false', async () => {
    const s = await JteCrypto.setup('pw'); freshPrivacy(s.blob); clearDekStores();
    await JtePrivacy._doUnlock('pw', true);
    JtePrivacy.lock();
    eq(JtePrivacy.isUnlocked(), false, '鎖定');
    eq(localStorage.getItem(DEKKEY), null, 'localStorage 清掉');
    eq(sessionStorage.getItem(DEKKEY), null, 'sessionStorage 清掉');
  });
  await check('忘記密語：_doRecover 用恢復碼重設密語→新密語可解鎖', async () => {
    const db = freshPrivacy(null); clearDekStores();
    const rec = await JtePrivacy._doEnable('old-pw');
    JtePrivacy.lock(); clearDekStores();
    await JtePrivacy._doRecover(rec, 'brand-new-pw');
    JtePrivacy.lock(); clearDekStores();
    await JtePrivacy._doUnlock('brand-new-pw', false);
    eq(JtePrivacy.isUnlocked(), true, '新密語可解鎖');
  });
```

- [ ] **Step 2: 跑測試確認紅**

- [ ] **Step 3: 在 `jte-privacy.js` 實作核心邏輯**

於模組內加入（`_dekKey()` 依 email 命名，與測試 `DEKKEY` 對齊）：
```javascript
  function _dekKey(){ return 'jte_dek_' + backend().email; }
  function _b64(u){ var s=''; for (var i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s); }
  function _ub64(str){ var bin=atob(str), u=new Uint8Array(bin.length); for (var i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
  function _cacheDek(dek, remember){
    _dek = dek; var k=_dekKey(), v=_b64(dek);
    try { root.sessionStorage.setItem(k, v); if (remember) root.localStorage.setItem(k, v); } catch(e){}
  }
  function _loadCachedDek(){
    if (_dek) return _dek;
    try { var v = root.localStorage.getItem(_dekKey()) || root.sessionStorage.getItem(_dekKey());
          if (v) { _dek = _ub64(v); } } catch(e){}
    return _dek;
  }
  function _doEnable(passphrase){
    return root.JteCrypto.setup(passphrase).then(function (s){
      return saveBlob(s.blob).then(function (){ _cacheDek(s.dek, false); return s.recoveryCode; });
    });
  }
  function _doUnlock(passphrase, remember){
    return loadBlob().then(function (blob){
      if (!blob) return Promise.reject(new Error('not-enabled'));
      return root.JteCrypto.unlockWithPassphrase(passphrase, blob).then(function (dek){ _cacheDek(dek, !!remember); return true; });
    });
  }
  function _doRecover(recoveryCode, newPassphrase){
    return loadBlob().then(function (blob){
      if (!blob) return Promise.reject(new Error('not-enabled'));
      return root.JteCrypto.unlockWithRecovery(recoveryCode, blob).then(function (dek){
        return root.JteCrypto.rewrapPassphrase(dek, newPassphrase, blob).then(function (nb){
          return saveBlob(nb).then(function (){ _cacheDek(dek, false); return true; });
        });
      });
    });
  }
  function _doChange(newPassphrase){
    var dek = _loadCachedDek();
    if (!dek) return Promise.reject(new Error('locked'));
    return loadBlob().then(function (blob){
      return root.JteCrypto.rewrapPassphrase(dek, newPassphrase, blob).then(function (nb){ return saveBlob(nb).then(function (){ return true; }); });
    });
  }
```
（注意：移除上面 `_doRecover` 裡那行 `var blob2 ... placeholder` —— 直接呼叫 `rewrapPassphrase`。）

並在 `root.JtePrivacy` 物件加入：
```javascript
    isUnlocked: function (){ return !!_loadCachedDek(); },
    lock: function (){ _dek = null; try { root.sessionStorage.removeItem(_dekKey()); root.localStorage.removeItem(_dekKey()); } catch(e){} },
    _doEnable: _doEnable, _doUnlock: _doUnlock, _doRecover: _doRecover, _doChange: _doChange,
```

- [ ] **Step 4: 跑測試確認綠**（6 筆 PASS）

- [ ] **Step 5: Commit**

```bash
git add jte-privacy.js jte-privacy.test.html
git commit -m "jte-privacy: session DEK＋記住裝置＋啟用/解鎖/恢復/換密語核心邏輯"
```

---

## Task 4: 私密欄位加解密（encryptPrivate / decryptPrivate）

**Files:** Modify `jte-privacy.js`、`jte-privacy.test.html`

- [ ] **Step 1: 測項（先紅）**

```javascript
  await check('encryptPrivate→decryptPrivate 還原多欄位', async () => {
    const s = await JteCrypto.setup('pw'); freshPrivacy(s.blob); clearDekStores();
    await JtePrivacy._doUnlock('pw', false);
    const enc = await JtePrivacy.encryptPrivate({ question: '我該換工作嗎？', note: '其實已經想很久了' });
    assert(enc.question && enc.question.iv && enc.question.ct, '欄位應為 {iv,ct}');
    const out = await JtePrivacy.decryptPrivate(enc);
    eq(out.question, '我該換工作嗎？', 'question 還原'); eq(out.note, '其實已經想很久了', 'note 還原');
  });
  await check('未解鎖時 encryptPrivate throw', async () => {
    const s = await JteCrypto.setup('pw'); freshPrivacy(s.blob); clearDekStores(); JtePrivacy.lock();
    let threw = false;
    try { await JtePrivacy.encryptPrivate({ a: 'x' }); } catch(e){ threw = true; }
    assert(threw, '鎖定時應 throw');
  });
  await check('decryptPrivate 跳過非 {iv,ct} 欄位（向後相容明文）', async () => {
    const s = await JteCrypto.setup('pw'); freshPrivacy(s.blob); clearDekStores();
    await JtePrivacy._doUnlock('pw', false);
    const out = await JtePrivacy.decryptPrivate({ plain: '舊明文', enc: (await JtePrivacy.encryptPrivate({ x: 'hi' })).x });
    eq(out.plain, '舊明文', '非密文欄位原樣保留'); eq(out.enc, 'hi', '密文欄位解開');
  });
```

- [ ] **Step 2: 跑測試確認紅**

- [ ] **Step 3: 實作**

```javascript
  function encryptPrivate(obj){
    var dek = _loadCachedDek();
    if (!dek) return Promise.reject(new Error('locked'));
    var keys = Object.keys(obj || {}), out = {}, chain = Promise.resolve();
    keys.forEach(function (k){ chain = chain.then(function (){ return root.JteCrypto.encryptField(dek, String(obj[k])).then(function (f){ out[k] = f; }); }); });
    return chain.then(function (){ return out; });
  }
  function decryptPrivate(obj){
    var dek = _loadCachedDek();
    if (!dek) return Promise.reject(new Error('locked'));
    var keys = Object.keys(obj || {}), out = {}, chain = Promise.resolve();
    keys.forEach(function (k){
      var v = obj[k];
      if (v && typeof v === 'object' && v.iv && v.ct){
        chain = chain.then(function (){ return root.JteCrypto.decryptField(dek, v).then(function (p){ out[k] = p; }).catch(function (){ out[k] = null; }); });
      } else { out[k] = v; } // 非密文（向後相容明文）原樣保留
    });
    return chain.then(function (){ return out; });
  }
```
並導出：`encryptPrivate: encryptPrivate, decryptPrivate: decryptPrivate,`

- [ ] **Step 4: 跑測試確認綠**（3 筆 PASS）

- [ ] **Step 5: Commit**

```bash
git add jte-privacy.js jte-privacy.test.html
git commit -m "jte-privacy: 私密欄位 encryptPrivate/decryptPrivate"
```

---

## Task 5: DOM modal（設定／解鎖／重設）串接核心 ＋ 對外 enable/unlock/changePassphrase

**Files:** Modify `jte-privacy.js`、`jte-privacy.test.html`

modal 視覺風格參照 `jte-userbar.js`（白底圓角卡片、`#003D7C` 主色、膠囊鈕、`z-index` 高、固定置中遮罩）。每個對外方法回傳 Promise：使用者完成 resolve、關閉/取消 reject(new Error('cancelled'))。

modal 行為規格：
- `enable()`：輸入密語 ×2（需一致、長度≥8 提示）→ 呼叫 `_doEnable` → **顯示恢復碼**（等寬字、一顆「下載 .txt」鈕、一個「我已保存」勾選後才可關閉）→ resolve(true)。
- `unlock()`：輸入密語 → `_doUnlock(pw, remember)`（含「記住這台裝置」checkbox，預設未勾）→ 成功 resolve；錯誤顯示「密語不對」紅字、可重試；底部「忘記密語？」連結 → 切到恢復畫面：輸入恢復碼＋新密語 ×2 → `_doRecover` → resolve(true)。
- `changePassphrase()`：若 `isUnlocked()` 為 false 先走 `unlock()`；再輸入新密語 ×2 → `_doChange`。
- 下載恢復碼：`Blob(['練息場 私密同步 恢復碼\n\n'+code+'\n\n忘記密語時用它重設；我們沒有副本。'], {type:'text/plain'})` → `URL.createObjectURL` → 觸發 `<a download>`。

- [ ] **Step 1: 在測試頁加「DOM 串接」測項（程式驅動，不靠人手點）**

```javascript
  await check('enable() 開出 modal 且含密語輸入與恢復碼流程節點', async () => {
    freshPrivacy(null); clearDekStores();
    const p = JtePrivacy.enable();               // 不 await（等使用者）
    await new Promise(r => setTimeout(r, 50));
    const modal = document.getElementById('jte-privacy-modal');
    assert(modal, 'modal 應存在');
    assert(modal.querySelector('input[type=password]'), '應有密語輸入');
    // 模擬填入並送出：用 modal 暴露的測試鉤子完成
    assert(typeof JtePrivacy._modalSubmitEnable === 'function', '應提供測試送出鉤子');
    await JtePrivacy._modalSubmitEnable('pw-via-modal', 'pw-via-modal');
    const rec = await p;                          // enable() resolve（恢復碼已在 modal 顯示）
    eq(JtePrivacy.isUnlocked(), true, '啟用後解鎖');
    assert(!document.getElementById('jte-privacy-modal'), 'modal 完成後關閉');
  });
  await check('unlock() 經 modal 鉤子輸入正確密語→解鎖', async () => {
    const s = await JteCrypto.setup('pw-u'); freshPrivacy(s.blob); clearDekStores();
    const p = JtePrivacy.unlock();
    await new Promise(r => setTimeout(r, 50));
    await JtePrivacy._modalSubmitUnlock('pw-u', false);
    await p;
    eq(JtePrivacy.isUnlocked(), true, '解鎖');
  });
```
（為可自動測試，modal 實作需提供 `_modalSubmitEnable(pw1,pw2)`、`_modalSubmitUnlock(pw,remember)`、`_modalSubmitRecover(code,newpw1,newpw2)` 等測試鉤子，等同使用者在 modal 內按送出。）

- [ ] **Step 2: 跑測試確認紅**

- [ ] **Step 3: 實作 modal（注入樣式、建遮罩與卡片、串接核心函式、暴露測試鉤子），並導出 `enable/unlock/changePassphrase`**

依上述行為規格與風格實作。modal 開啟時把當前 resolve/reject 與「送出鉤子」掛到模組變數，`_modalSubmitX` 即呼叫對應 `_doX` 後 resolve 並關閉 modal。樣式參照 `jte-userbar.js` 的 `injectStyles` 寫法。

- [ ] **Step 4: 跑測試確認綠**（2 筆 PASS；全頁總計應為 Task2 3＋Task3 6＋Task4 3＋Task5 2 = 14 綠）

- [ ] **Step 5: 視覺人工確認（非自動）**

Run（背景起 server 後用一般瀏覽器開，肉眼檢查 modal 外觀）:
```bash
cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 -m http.server 8770 >/tmp/jte.log 2>&1 &
open "http://localhost:8770/jte-privacy.test.html"
```
確認 modal 外觀與 jte-userbar 一致、恢復碼可下載；看完 `pkill -f "http.server 8770"`。

- [ ] **Step 6: Commit**

```bash
git add jte-privacy.js jte-privacy.test.html
git commit -m "jte-privacy: 設定/解鎖/重設 modal 串接核心，整合層完成"
```

**不 push。** 與 Plan 1 同批，待 Plan 3/4 把工具實際接上、私密內容真的受保護、隱私承諾成立時再一起上線。

---

## 未涵蓋（屬後續 Plan）
- 卜易實際把 `question`/`note` 改走 `encryptPrivate`、未啟用時本機留存、歷史 `decryptPrivate`、書寫框那行字 → Plan 3
- 心理位移同上、停掉 excerpt 外洩 → Plan 4
- admin 不顯示私密、共用隱私聲明頁、首次卡片 → Plan 5
- 工具頁載入時機：何時提示 `unlock()`（例如進歷史頁且 `isEnabled()` 時）由 Plan 3/4 決定
