# 心理位移（writespace）隱私整合 Implementation Plan（Plan 4/5）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 堵住心理位移書寫唯一的外洩點（`jtePushWriteSpace` 上傳的 `excerpt`＋使用者 `topic`），讓書寫內容變成乾淨的「只存本機、不上傳」，並在書寫框加上誠實的隱私提示。

**Architecture:** writespace 的書寫全文本來就只存 localStorage、從不上傳；唯一上 Firestore 的是 `jtePushWriteSpace` 的一個時間軸 stub，目前夾帶了 `excerpt`（書寫前 60 字）與使用者自填 `topic`。改成只上傳「使用者數/活動/時間」這類純指標＋一個**通用標籤**（不含使用者文字）。因為內容純本機，**不需要加密**——隱私提示用 B3 式「只存這台裝置」即可，誠實且最強。

**Tech Stack:** writespace 獨立 repo `/Users/chenchiehyi/vscode/writespace/`（`github.com/flow222git/writespace`，部署 `flow222git.github.io/writespace/`）。載入共用 `jte-privacy.js` 只為了之後的 `showPrivacyInfo` 聲明頁連結（Plan 5 提供）。

**前置：** Plan 1/2/3 已上線。**本計畫獨立 repo，做完隨 Plan 5 一起上線或單獨 push（writespace 沒有對外承諾尚未上線的風險，且本改動是「減少上傳」，純收斂、安全）。**

---

## File Structure
- Modify: `/Users/chenchiehyi/vscode/writespace/app.js` — 改 `jtePushWriteSpace` 去除私密欄位
- Modify: `/Users/chenchiehyi/vscode/writespace/index.html` — 載入 `jte-privacy.js`、書寫框加 🔒 提示

（writespace 無雙副本，單一 repo。）

---

## Task 1: 堵 `jtePushWriteSpace` 外洩（app.js）

**Files:** Modify `/Users/chenchiehyi/vscode/writespace/app.js`（約 1590 行）

- [ ] **Step 1: 改寫 `jtePushWriteSpace`，移除 `excerpt` 與使用者 `topic`**

把現有（約 1590 行）：
```javascript
function jtePushWriteSpace(record){
  try{
    if(!record)return;
    if(!jteEmail())return;
    var e=record.entries||{};
    var topic=((e.topic||record.title||'一次書寫')+'').trim();
    var src=((e.iFinal||e.iFirst||e.you||'')+'').trim();
    var excerpt=src?(src.length>60?src.slice(0,60)+'…':src):'';
    jteWriteRecord({
      source:'WriteSpace',
      id:'ws-'+record.id,
      recordId:'ws-'+record.id,
      ts:record.createdAt||new Date().toISOString(),
      topic:topic,
      excerpt:excerpt
    });
  }catch(err){console.warn('WriteSpace 同步失敗',err);}
}
```
改為（**不再讀取/上傳任何書寫文字或使用者主題**，只留時間軸所需的通用標籤）：
```javascript
function jtePushWriteSpace(record){
  try{
    if(!record)return;
    if(!jteEmail())return;
    // 隱私：心理位移書寫全文與主題只存本機，絕不上傳。
    // 上 Firestore 的時間軸 stub 只含「做了一次書寫」這個事實，不含任何使用者文字。
    jteWriteRecord({
      source:'WriteSpace',
      id:'ws-'+record.id,
      recordId:'ws-'+record.id,
      ts:record.createdAt||new Date().toISOString(),
      label:'心理位移書寫'   // 通用標籤，非使用者輸入
    });
  }catch(err){console.warn('WriteSpace 同步失敗',err);}
}
```

- [ ] **Step 2: 靜態自我檢查**

確認：(a) 改後函式不再讀 `record.entries`、`iFinal`/`iFirst`/`you`、`title`；(b) 上傳物件 key 只有 `source/id/recordId/ts/label`，無 `excerpt`、無 `topic`；(c) 書寫儲存（`saveRecords`/`saveState`，本機）完全未動。grep 確認 `jtePushWriteSpace` 是唯一上傳處、檔內無其它 `.set(`/`collection('users')` 夾帶書寫內容。

- [ ] **Step 3: Commit**
```bash
cd /Users/chenchiehyi/vscode/writespace && git add app.js && git commit -m "心理位移：停止上傳 excerpt/topic，書寫只存本機（堵外洩）"
```

---

## Task 2: 書寫框隱私提示（index.html）

**Files:** Modify `/Users/chenchiehyi/vscode/writespace/index.html`

- [ ] **Step 1: 載入共用 `jte-privacy.js`（為 showPrivacyInfo 聲明頁連結，Plan 5 提供）**

在第 14 行 `jte-userbar.js` 的 `<script>` 之後加：
```html
<script defer src="https://flow222git.github.io/jte-platform-2026/jte-privacy.js"></script>
```

- [ ] **Step 2: 書寫框（`#messageInput`，約 98-102 行）上緣加 🔒 提示**

在 `.writing-pad`（約 93 行）內、`#messageInput` 之前插入：
```html
<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#6B7A8D;margin-bottom:8px">
  <span>🔒</span><span>你的書寫只存在這台裝置，不會上傳</span>
  <a href="#" onclick="event.preventDefault();window.showPrivacyInfo&&window.showPrivacyInfo()" style="color:inherit;text-decoration:underline">了解隱私</a>
</div>
```
（文案用 B3 式「只存這台裝置」——因 writespace 內容確實純本機、不上傳，這是最誠實也最強的說法。`showPrivacyInfo` 由 Plan 5 定義，未定義時連結無動作。）

- [ ] **Step 3: 視覺確認（人工，非必須自動）＋ Commit**
```bash
cd /Users/chenchiehyi/vscode/writespace && git add index.html && git commit -m "心理位移：載入隱私聲明＋書寫框加「只存本機」提示"
```

---

## 驗證
- 主要靠靜態審查（牽涉 Firestore，無法 headless 測）：確認 `jtePushWriteSpace` 不再含任何使用者文字。
- 上線後可人工：完成一次書寫 → 開 Firestore 看 `users/{email}/daily/{date}` 的 WriteSpace stub → 確認**無 excerpt、無使用者 topic**，只有 label。

## 未涵蓋
- 心理位移的跨裝置加密同步（內容目前純本機，無此需求；要的話另開 plan）→ 後續
- 共用 `showPrivacyInfo` 聲明頁、admin 不顯示私密、舊記錄遷移 → Plan 5
