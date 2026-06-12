# 加密核心 jte-crypto.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打造一支純前端、無依賴、可獨立測試的信封加密函式庫 `jte-crypto.js`，提供「密語＋恢復碼包鑰」與「私密欄位加解密」，作為全平台私密書寫工具的共用地基。

**Architecture:** 純函式模組，只在 bytes/strings 之間運算 —— **不碰 localStorage、Firestore、DOM**（那些屬於 Plan 2 整合層）。資料金鑰（DEK）為隨機 32 bytes；用 PBKDF2 從「通關密語」與「恢復碼」各導出一把 wrap key，以 AES-GCM 把同一把 DEK 包兩份。私密欄位用 DEK 以 AES-GCM 加密。AES-GCM 為認證加密，**錯密語解包時直接拋例外**，因此不需另存 verifier。

**Tech Stack:** 原生 WebCrypto（SubtleCrypto）、AES-GCM-256、PBKDF2-SHA256（250,000 iters）。檔案放在 hub repo `jte-platform-2026/`，比照 `jte-userbar.js` 以 `https://flow222git.github.io/jte-platform-2026/jte-crypto.js` 共用。測試在瀏覽器執行（無 node/deno/bun），用 `python3 -m http.server` 提供 localhost（secure context）＋ Chrome headless `--dump-dom` 抓結果。

**檔案路徑說明：** 本計畫產生的程式檔都在 hub repo `/Users/chenchiehyi/vscode/jte-platform-2026/`；本計畫文件本身放在 ven-i repo 的 `docs/`（與 spec 同處）。

---

## File Structure

- Create: `/Users/chenchiehyi/vscode/jte-platform-2026/jte-crypto.js` — 加密核心函式庫，掛 `window.JteCrypto`
- Create: `/Users/chenchiehyi/vscode/jte-platform-2026/jte-crypto.test.html` — 瀏覽器自我測試頁（含迷你 assert 框架與全部測項）

無新增 package.json／建置工具。

---

## 模組公開 API（Task 4 完整實作；此處為契約，供測試與後續 Plan 依循）

掛在 `window.JteCrypto`，全部 async：

- `setup(passphrase)` → `{ blob, recoveryCode, dek }`
  - `blob`：可 JSON 序列化、可存 Firestore 的物件 `{ v, salt, kdf, wrapPass, wrapRec }`
  - `recoveryCode`：顯示給使用者的字串，格式 `XXXXX-XXXXX-XXXXX-XXXXX`
  - `dek`：`Uint8Array(32)`，當前 session 的資料金鑰
- `unlockWithPassphrase(passphrase, blob)` → `Uint8Array(32)`（錯密語拋例外）
- `unlockWithRecovery(recoveryCode, blob)` → `Uint8Array(32)`（恢復碼可含/不含分隔線，錯碼拋例外）
- `rewrapPassphrase(dek, newPassphrase, blob)` → 新 `blob`（換密語，`wrapRec` 不變）
- `encryptField(dek, plaintextString)` → `{ iv, ct }`（每次隨機 iv）
- `decryptField(dek, fieldBlob)` → `plaintextString`
- `generateRecoveryCode()` → 字串

---

## Task 1: 測試基礎建設（http server ＋ Chrome headless ＋ 空測試頁）

**Files:**
- Create: `/Users/chenchiehyi/vscode/jte-platform-2026/jte-crypto.test.html`
- Create: `/Users/chenchiehyi/vscode/jte-platform-2026/jte-crypto.js`（先空殼）

- [ ] **Step 1: 建空殼 `jte-crypto.js`**

```javascript
// jte-crypto.js — 全平台私密書寫共用加密核心（信封加密）
// 純函式：只在 bytes/strings 間運算，不碰 localStorage/Firestore/DOM。
(function (root) {
  'use strict';
  // 實作於 Task 4 補上
  root.JteCrypto = {};
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 2: 建測試頁 `jte-crypto.test.html`（含迷你 assert 框架，暫無測項）**

```html
<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>jte-crypto tests</title></head>
<body>
<pre id="out">running...</pre>
<script src="jte-crypto.js"></script>
<script>
const out = document.getElementById('out');
let pass = 0, fail = 0;
const lines = [];
function log(s){ lines.push(s); out.textContent = lines.join('\n'); }
function assert(c, m){ if(!c) throw new Error(m || 'assert failed'); }
function eq(a, b, m){ if(a !== b) throw new Error((m||'eq') + ' got['+a+'] want['+b+']'); }
async function check(name, fn){
  try { await fn(); pass++; log('PASS ' + name); }
  catch (e){ fail++; log('FAIL ' + name + ' :: ' + (e && e.message || e)); }
}
async function run(){
  assert(typeof crypto !== 'undefined' && crypto.subtle, 'WebCrypto unavailable (need secure context)');
  // 測項於後續 Task 插入此處 —— 標記：TESTS_HERE
  log('---'); log('DONE pass=' + pass + ' fail=' + fail);
  document.title = fail ? ('FAIL ' + fail) : 'OK';
}
run();
</script>
</body></html>
```

- [ ] **Step 3: 啟動本機 server（背景）並用 Chrome headless 抓結果，確認 harness 本身能跑**

Run（一次貼上；之後每次驗證都用這段）:
```bash
cd /Users/chenchiehyi/vscode/jte-platform-2026
pkill -f "http.server 8765" 2>/dev/null; sleep 1
python3 -m http.server 8765 >/tmp/jte-http.log 2>&1 &
sleep 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox \
  --virtual-time-budget=20000 --dump-dom \
  "http://localhost:8765/jte-crypto.test.html" 2>/dev/null | grep -E "PASS|FAIL|DONE|unavailable"
```
Expected: 一行 `DONE pass=0 fail=0`（harness 正常、WebCrypto 在 localhost 可用）。若看到 `unavailable` 表示 secure context 失敗，需確認是用 `http://localhost` 而非 `file://`。

- [ ] **Step 4: Commit**

```bash
cd /Users/chenchiehyi/vscode/jte-platform-2026
git add jte-crypto.js jte-crypto.test.html
git commit -m "jte-crypto: 加密核心測試基礎建設（空殼＋瀏覽器測試頁）"
```

---

## Task 2: 私密欄位加解密 round-trip（encryptField / decryptField）

**Files:**
- Modify: `jte-crypto.js`
- Modify: `jte-crypto.test.html`

- [ ] **Step 1: 在測試頁 `TESTS_HERE` 標記處插入測項（先紅）**

```javascript
  // --- 欄位加解密 ---
  let _dek1, _dek2;
  await check('setup() 產出 32-byte dek', async () => {
    const s = await JteCrypto.setup('pw-correct-horse');
    _dek1 = s.dek;
    assert(_dek1 instanceof Uint8Array, 'dek 應為 Uint8Array');
    eq(_dek1.length, 32, 'dek 長度');
  });
  await check('encrypt→decrypt 還原中文', async () => {
    const blob = await JteCrypto.encryptField(_dek1, '我該不該換工作？很怕做錯決定。');
    assert(blob && blob.iv && blob.ct, '欄位密文應有 iv/ct');
    const out = await JteCrypto.decryptField(_dek1, blob);
    eq(out, '我該不該換工作？很怕做錯決定。', '還原內容');
  });
  await check('encrypt→decrypt 還原空字串', async () => {
    const blob = await JteCrypto.encryptField(_dek1, '');
    eq(await JteCrypto.decryptField(_dek1, blob), '', '空字串還原');
  });
  await check('同明文兩次加密 iv/ct 不同（隨機 iv）', async () => {
    const a = await JteCrypto.encryptField(_dek1, 'same');
    const b = await JteCrypto.encryptField(_dek1, 'same');
    assert(a.iv !== b.iv, 'iv 應不同');
    assert(a.ct !== b.ct, 'ct 應不同');
  });
  await check('不同 dek 解不開（拋例外）', async () => {
    _dek2 = (await JteCrypto.setup('other')).dek;
    const blob = await JteCrypto.encryptField(_dek1, 'secret');
    let threw = false;
    try { await JteCrypto.decryptField(_dek2, blob); } catch(e){ threw = true; }
    assert(threw, '用錯 dek 應拋例外');
  });
```

- [ ] **Step 2: 跑測試確認紅**

Run: 用 Task 1 Step 3 的驗證指令。
Expected: 出現多筆 `FAIL`（`JteCrypto.setup is not a function` 等），`DONE` 行 `fail>0`。

- [ ] **Step 3: 在 `jte-crypto.js` 實作底層工具與欄位加解密**

把 `root.JteCrypto = {};` 整段替換為：

```javascript
  const TE = new TextEncoder();
  const TD = new TextDecoder();
  const ITER = 250000;

  function rand(n){ return crypto.getRandomValues(new Uint8Array(n)); }
  function b64(bytes){ let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
  function ub64(str){ const bin = atob(str); const u = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i); return u; }

  async function importDek(dekBytes){
    return crypto.subtle.importKey('raw', dekBytes, { name: 'AES-GCM' }, false, ['encrypt','decrypt']);
  }
  async function encryptField(dekBytes, plaintext){
    const key = await importDek(dekBytes);
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, TE.encode(plaintext));
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function decryptField(dekBytes, field){
    const key = await importDek(dekBytes);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(field.iv) }, key, ub64(field.ct));
    return TD.decode(pt);
  }

  // setup 暫時版（Task 3 補完整 blob）：先只回傳 dek 供欄位測試
  async function setup(passphrase){
    return { dek: rand(32) };
  }

  root.JteCrypto = { setup, encryptField, decryptField, _b64: b64, _ub64: ub64, _ITER: ITER, _rand: rand };
```

- [ ] **Step 4: 跑測試確認綠**

Run: Task 1 Step 3 的驗證指令。
Expected: 上述 5 筆全 `PASS`，`DONE` 行 `fail=0`。

- [ ] **Step 5: Commit**

```bash
cd /Users/chenchiehyi/vscode/jte-platform-2026
git add jte-crypto.js jte-crypto.test.html
git commit -m "jte-crypto: 私密欄位 AES-GCM 加解密 round-trip"
```

---

## Task 3: 信封 setup ＋ 密語/恢復碼解鎖

**Files:**
- Modify: `jte-crypto.js`
- Modify: `jte-crypto.test.html`

- [ ] **Step 1: 在測試頁 `TESTS_HERE` 區塊末尾（DONE 之前）追加測項（先紅）**

```javascript
  // --- 信封加密：setup / unlock ---
  let _blob, _rec, _setupDek;
  await check('setup() 產出可序列化 blob ＋ 恢復碼', async () => {
    const s = await JteCrypto.setup('my-passphrase');
    _blob = JSON.parse(JSON.stringify(s.blob)); // 模擬存進 Firestore 再讀回
    _rec = s.recoveryCode; _setupDek = s.dek;
    assert(_blob.salt && _blob.wrapPass && _blob.wrapRec, 'blob 應含 salt/wrapPass/wrapRec');
    assert(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(_rec), '恢復碼格式 XXXXX-XXXXX-XXXXX-XXXXX，實得 ' + _rec);
  });
  await check('正確密語解鎖 → 能解開 setup 當下加密的內容', async () => {
    const enc = await JteCrypto.encryptField(_setupDek, '只有我看得到');
    const dek = await JteCrypto.unlockWithPassphrase('my-passphrase', _blob);
    eq(await JteCrypto.decryptField(dek, enc), '只有我看得到', '跨 session 還原');
  });
  await check('錯誤密語解鎖 → 拋例外', async () => {
    let threw = false;
    try { await JteCrypto.unlockWithPassphrase('wrong-pass', _blob); } catch(e){ threw = true; }
    assert(threw, '錯密語應拋例外');
  });
  await check('恢復碼解鎖（含分隔線）→ 可用', async () => {
    const enc = await JteCrypto.encryptField(_setupDek, 'recover-me');
    const dek = await JteCrypto.unlockWithRecovery(_rec, _blob);
    eq(await JteCrypto.decryptField(dek, enc), 'recover-me', '恢復碼還原');
  });
  await check('恢復碼解鎖（去分隔線/小寫）→ 仍可用', async () => {
    const messy = _rec.replace(/-/g, '').toLowerCase();
    const dek = await JteCrypto.unlockWithRecovery(messy, _blob);
    assert(dek instanceof Uint8Array && dek.length === 32, '正規化後仍解得開');
  });
  await check('錯誤恢復碼 → 拋例外', async () => {
    let threw = false;
    try { await JteCrypto.unlockWithRecovery('AAAAA-BBBBB-CCCCC-DDDDD', _blob); } catch(e){ threw = true; }
    assert(threw, '錯恢復碼應拋例外');
  });
  await check('換密語：新密語可解、舊密語失效、恢復碼仍可用', async () => {
    const enc = await JteCrypto.encryptField(_setupDek, 'survives-rewrap');
    const dek0 = await JteCrypto.unlockWithPassphrase('my-passphrase', _blob);
    const blob2 = await JteCrypto.rewrapPassphrase(dek0, 'new-passphrase', _blob);
    const dekNew = await JteCrypto.unlockWithPassphrase('new-passphrase', blob2);
    eq(await JteCrypto.decryptField(dekNew, enc), 'survives-rewrap', '新密語可解');
    let oldThrew = false;
    try { await JteCrypto.unlockWithPassphrase('my-passphrase', blob2); } catch(e){ oldThrew = true; }
    assert(oldThrew, '舊密語應失效');
    const dekRec = await JteCrypto.unlockWithRecovery(_rec, blob2);
    eq(await JteCrypto.decryptField(dekRec, enc), 'survives-rewrap', '恢復碼換密語後仍可用');
  });
```

- [ ] **Step 2: 跑測試確認紅**

Run: Task 1 Step 3 驗證指令。
Expected: 新增測項 `FAIL`（`unlockWithPassphrase is not a function` 等）。

- [ ] **Step 3: 在 `jte-crypto.js` 補上信封加密實作**

在 `decryptField` 之後、`setup 暫時版` 之前插入：

```javascript
  function normalizeCode(code){ return String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }

  function generateRecoveryCode(){
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 字元、去除易混的 I O 0 1；32 整除 256 故無 modulo bias
    const r = rand(20);
    let s = '';
    for (let i = 0; i < 20; i++){ s += A[r[i] % A.length]; if (i % 5 === 4 && i < 19) s += '-'; }
    return s;
  }

  async function deriveWrapKey(secret, saltBytes){
    const base = await crypto.subtle.importKey('raw', TE.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: ITER, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  async function wrapDEK(dekBytes, wrapKey){
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, dekBytes);
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function unwrapDEK(wrap, wrapKey){
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(wrap.iv) }, wrapKey, ub64(wrap.ct));
    return new Uint8Array(pt); // 錯鑰匙時 decrypt 直接拋 OperationError
  }
```

- [ ] **Step 4: 用完整版 `setup` 取代 Task 2 的暫時版，並補 unlock/rewrap**

把這段（Task 2 留下的暫時版）：
```javascript
  // setup 暫時版（Task 3 補完整 blob）：先只回傳 dek 供欄位測試
  async function setup(passphrase){
    return { dek: rand(32) };
  }

  root.JteCrypto = { setup, encryptField, decryptField, _b64: b64, _ub64: ub64, _ITER: ITER, _rand: rand };
```
整段替換為：
```javascript
  async function setup(passphrase){
    const dek = rand(32);
    const salt = rand(16);
    const recoveryCode = generateRecoveryCode();
    const passKey = await deriveWrapKey(passphrase, salt);
    const recKey  = await deriveWrapKey(normalizeCode(recoveryCode), salt);
    const blob = {
      v: 1,
      salt: b64(salt),
      kdf: { name: 'PBKDF2', iterations: ITER, hash: 'SHA-256' },
      wrapPass: await wrapDEK(dek, passKey),
      wrapRec:  await wrapDEK(dek, recKey)
    };
    return { blob, recoveryCode, dek };
  }
  async function unlockWithPassphrase(passphrase, blob){
    const key = await deriveWrapKey(passphrase, ub64(blob.salt));
    return unwrapDEK(blob.wrapPass, key);
  }
  async function unlockWithRecovery(recoveryCode, blob){
    const key = await deriveWrapKey(normalizeCode(recoveryCode), ub64(blob.salt));
    return unwrapDEK(blob.wrapRec, key);
  }
  async function rewrapPassphrase(dekBytes, newPassphrase, blob){
    const passKey = await deriveWrapKey(newPassphrase, ub64(blob.salt));
    return Object.assign({}, blob, { wrapPass: await wrapDEK(dekBytes, passKey) });
  }

  root.JteCrypto = {
    setup, unlockWithPassphrase, unlockWithRecovery, rewrapPassphrase,
    encryptField, decryptField, generateRecoveryCode,
    _normalizeCode: normalizeCode
  };
```

- [ ] **Step 5: 跑測試確認全綠**

Run: Task 1 Step 3 驗證指令。
Expected: Task 2 ＋ Task 3 全部 `PASS`，`DONE pass=12 fail=0`（5＋7）。`document.title` 應為 `OK`（dump-dom 輸出 `<title>OK</title>`）。

- [ ] **Step 6: Commit**

```bash
cd /Users/chenchiehyi/vscode/jte-platform-2026
git add jte-crypto.js jte-crypto.test.html
git commit -m "jte-crypto: 信封加密 setup＋密語/恢復碼解鎖＋換密語"
```

---

## Task 4: 收尾 —— 標頭驗證、清理、文件

**Files:**
- Modify: `jte-crypto.js`

- [ ] **Step 1: 在測試頁追加「壞資料防呆」測項（先紅）**

於 `TESTS_HERE` 區塊末追加：
```javascript
  await check('decryptField 對被竄改的 ct 拋例外（GCM 驗證）', async () => {
    const s = await JteCrypto.setup('pw');
    const enc = await JteCrypto.encryptField(s.dek, 'tamper-check');
    const bad = Object.assign({}, enc, { ct: enc.ct.slice(0, -4) + (enc.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') });
    let threw = false;
    try { await JteCrypto.decryptField(s.dek, bad); } catch(e){ threw = true; }
    assert(threw, '竄改密文應被 GCM 驗證擋下');
  });
  await check('版本標記 v=1 存在', async () => {
    const s = await JteCrypto.setup('pw');
    eq(s.blob.v, 1, 'blob.v');
  });
```

- [ ] **Step 2: 跑測試**

Run: Task 1 Step 3 驗證指令。
Expected: 若前述實作正確，這兩筆應**直接綠**（功能已具備）。最終 `DONE pass=14 fail=0`。若 `版本標記` 紅，確認 Task 3 Step 4 的 `blob.v=1` 存在。

- [ ] **Step 3: 在 `jte-crypto.js` 檔首補使用說明註解**

把第一行註解區塊替換為：
```javascript
// jte-crypto.js — 全平台私密書寫共用加密核心（信封加密）
// 載入：<script defer src="https://flow222git.github.io/jte-platform-2026/jte-crypto.js"></script>
// 純函式：只在 bytes/strings 間運算，不碰 localStorage/Firestore/DOM（整合屬 Plan 2）。
// API（皆 async，掛 window.JteCrypto）：
//   setup(passphrase) -> { blob, recoveryCode, dek }
//   unlockWithPassphrase(passphrase, blob) -> Uint8Array(32)   // 錯密語拋例外
//   unlockWithRecovery(recoveryCode, blob) -> Uint8Array(32)   // 碼可含/不含分隔線
//   rewrapPassphrase(dek, newPassphrase, blob) -> blob'
//   encryptField(dek, str) -> { iv, ct }   // 每次隨機 iv
//   decryptField(dek, {iv,ct}) -> str
// blob 可 JSON 序列化，安全存 Firestore；DEK 與密語/恢復碼明文絕不離開瀏覽器。
```

- [ ] **Step 4: 最終驗證並關閉 server**

Run:
```bash
cd /Users/chenchiehyi/vscode/jte-platform-2026
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox \
  --virtual-time-budget=20000 --dump-dom \
  "http://localhost:8765/jte-crypto.test.html" 2>/dev/null | grep -E "FAIL|DONE"
pkill -f "http.server 8765" 2>/dev/null
```
Expected: 無任何 `FAIL` 行，僅 `DONE pass=14 fail=0`。

- [ ] **Step 5: Commit**

```bash
cd /Users/chenchiehyi/vscode/jte-platform-2026
git add jte-crypto.js jte-crypto.test.html
git commit -m "jte-crypto: 防呆測項＋使用說明，核心完成（14 綠）"
```

**注意：** 本計畫**不 push**。`jte-crypto.js` 是共用檔但目前無人載入，留待 Plan 2/3/4 接上、整套保護就緒、隱私承諾能成立時，再隨該批一起 push 上線。

---

## 未涵蓋（屬後續 Plan）
- 漸進式啟用狀態、Firestore 存取 blob、解鎖 UI、remember-device、`protect/reveal` 工具介面 → Plan 2
- 卜易整合 → Plan 3；心理位移整合 → Plan 4；後台＋聲明頁＋首次卡片 → Plan 5
