# 後台脫敏＋隱私聲明頁＋舊記錄遷移＋首次卡片 Implementation Plan（Plan 5/5）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 收尾整個隱私專案：(1) admin 後台不再顯示任何私密內容、只顯示可分析層；(2) 建共用隱私聲明 `showPrivacyInfo`（卜易/心理位移的「了解隱私」連結指向它）；(3) 把使用者**今天以前的舊明文記錄**在其登入解鎖時就地加密遷移（消除 Firestore 殘留明文）；(4) 卜易首次進入顯示一次性隱私卡片。

**Architecture:** 共用聲明做成 `JtePrivacy.showInfo()`（hub `jte-privacy.js`）＋ `window.showPrivacyInfo`，平台共用。admin 改顯示邏輯只用可分析欄位。遷移寄生在 ven-i 既有讀回路徑（`jteListRecordsMerged`）：解鎖時偵測雲端含明文私密的舊記錄→經已驗證的 `toCloudRec` 重新加密上傳（idempotent、只在解鎖時、只動有明文私密的記錄；本機明文副本恆在，遷移失敗最壞只是留著明文而 admin 本就不顯示）。

**Tech Stack:** hub `jte-privacy.js`、`admin.html`、`ven-i/index.html`＋`ven-i/ven-i-privacy.js`（雙副本）。測試沿用 `jte-testrun.py`。

**雙副本：** ven-i 改動同步 `/Users/chenchiehyi/vscode/jte-platform-2026/ven-i/` 與 `/Users/chenchiehyi/vscode/ven-i/`，兩 repo commit。hub 的 jte-privacy.js / admin.html 只在 hub。**全部做完一起 push。**

**前置：** Plan 1–4 已上線。

---

## Task 1: 共用隱私聲明 `showPrivacyInfo`（jte-privacy.js）

**Files:** Modify `jte-platform-2026/jte-privacy.js`、`jte-platform-2026/jte-privacy.test.html`

- [ ] **Step 1: 測項（先紅，放測試旗標區）**

```javascript
  await check('showInfo() 開出隱私聲明 modal、含關鍵承諾文字', async () => {
    var m0 = document.getElementById('jte-privacy-info'); if (m0) m0.remove();
    JtePrivacy.showInfo();
    const m = document.getElementById('jte-privacy-info');
    assert(m, 'modal 應存在');
    assert(/只有你看得到/.test(m.textContent), '含「只有你看得到」');
    assert(/連我們也解不開|不會上傳/.test(m.textContent), '含加密或本機承諾');
    assert(typeof window.showPrivacyInfo === 'function', 'window.showPrivacyInfo 已掛');
    m.remove();
  });
```

- [ ] **Step 2: 跑測試確認紅**　`cd /Users/chenchiehyi/vscode/jte-platform-2026 && python3 jte-testrun.py jte-privacy.test.html`

- [ ] **Step 3: 在 `jte-privacy.js` 實作 `showInfo()`（公開，非測試旗標）並掛 `window.showPrivacyInfo`**

新增一個讀取式 modal（樣式比照既有 modal：白底圓角、遮罩、`_esc` 不需要因內容為固定文案）。內容用以下定稿文案（平台通用，對「加密上雲」與「只存本機」兩種都成立）：

```
🔒 你的私密書寫，只有你看得到

我們從設計上就讓自己「看不到」你的私密內容：

只有你能看到的（我們完全看不到）
・卜卦時打下的問題、你的筆記
・你的心理位移書寫全文
這些預設只留在你的裝置。若你開啟「跨裝置私密同步」，內容會在離開裝置前先用你的通關密語加密，上雲的是一段亂碼，連我們也解不開。

我們看得到的（只有統計，沒有你的內容）
・卦象、你選的問題類型、時間
・有多少人在用、哪些卦較常出現這類整體趨勢
這些幫我們把工具做更好，但沒有任何一句你寫的話。

關於你的通關密語
它只存在你心裡和你的裝置，我們手上沒有副本——這正是「連我們也解不開」的原因。也因此請保存好設定時給你的恢復碼；兩者都遺失，我們也無法幫你救回。

你可以放心地寫。
```
把 `showInfo` 加入**無條件公開**導出（與 enable/unlock 同層），並在模組末 `root.showPrivacyInfo = function(){ root.JtePrivacy.showInfo(); };`（讓既有 inline `onclick="window.showPrivacyInfo&&..."` 生效）。

- [ ] **Step 4: 跑測試綠　→ Commit**（hub）`git commit -m "jte-privacy：共用隱私聲明 showPrivacyInfo/showInfo"`

---

## Task 2: 舊明文記錄加密遷移（ven-i，雙副本）

**Files:** Modify `jte-platform-2026/ven-i/ven-i-privacy.js`、`ven-i-privacy.test.html`、`ven-i/index.html`

- [ ] **Step 1: 在 `ven-i-privacy.js` 加 `needsMigration` 與 `migrateCloud`（測項先紅）**

測項（`ven-i-privacy.test.html`）：
```javascript
  await check('needsMigration：有明文 question 且無 priv → true；已加密 → false', async () => {
    eq(VenIPrivacy.needsMigration({source:'BuYi', question:'明文', ben:'乾'}), true, '明文需遷移');
    eq(VenIPrivacy.needsMigration({source:'BuYi', priv:{question:{iv:'a',ct:'b'}}, ben:'乾'}), false, '已加密不需');
    eq(VenIPrivacy.needsMigration({source:'BuYi', ben:'乾'}), false, '無私密欄位不需');
  });
```
實作（`ven-i-privacy.js`）：
```javascript
  function needsMigration(rec){
    if (!rec) return false;
    for (var i=0;i<PRIVATE_FIELDS.length;i++){ var f=PRIVATE_FIELDS[i]; if (typeof rec[f]==='string' && rec[f]!=='') return true; }
    return false;
  }
```
（`migrateCloud` 的「掃描＋重上傳」因牽涉 Firestore 寫入，放 index.html 端；此處只導出純判斷 `needsMigration` 供測試與呼叫。）導出：`root.VenIPrivacy.needsMigration = needsMigration;`

- [ ] **Step 2: 跑測試綠（ven-i-privacy.test.html 應 6 綠：原 5＋本測 1）**

- [ ] **Step 3: 在 `ven-i/index.html` 的讀回路徑加遷移**

在 `jteListRecordsMerged`（讀到 `cloudDays` 後、解鎖時）加入：掃描 `cloudDays` 各 record，若 `JtePrivacy.isUnlocked() && VenIPrivacy.needsMigration(rec)`，把該天的 day 以 `toCloudRec` 重建 linked 後 `jteFsSave(date, migratedDay)` 重新上傳（覆蓋舊明文為密文）。需 idempotent（已加密者 `needsMigration` 為 false 不重做）、容錯（單筆失敗不影響顯示）。例：
```javascript
function jteMigrateCloudIfNeeded(cloudDays){
 if(!window.JtePrivacy||!JtePrivacy.isUnlocked()||!window.VenIPrivacy)return Promise.resolve();
 var jobs=[];
 Object.keys(cloudDays).forEach(function(dk){
   var linked=(cloudDays[dk]&&cloudDays[dk].linked)||[];
   if(!linked.some(VenIPrivacy.needsMigration))return;
   jobs.push(Promise.all(linked.map(function(r){return VenIPrivacy.needsMigration(r)?VenIPrivacy.toCloudRec(r):Promise.resolve(_stripCloudCarry(r));})).then(function(cl){
     return jteFsSave(dk, Object.assign({}, cloudDays[dk], {linked:cl}));
   }).catch(function(e){console.warn('migrate failed',dk,e);}));
 });
 return Promise.all(jobs);
}
```
（`_stripCloudCarry(r)`：對「已是密文」的雲端記錄原樣保留即可——直接回 `r`。）在 `jteListRecordsMerged` 取得 `cloudDays` 後、`mergeCloud` 之前呼叫 `jteMigrateCloudIfNeeded(cloudDays)`（不必 await 阻塞顯示，但要在背景觸發）。

- [ ] **Step 4: 靜態自我檢查**：遷移只在 `isUnlocked()` 觸發；`toCloudRec` 已驗證會脫敏＋加密；本機 localStorage 明文不受影響（遷移只動 Firestore）；idempotent。

- [ ] **Step 5: cp 雙副本＋兩 repo commit**（"ven-i：舊明文雲端記錄登入解鎖時自動加密遷移"）

---

## Task 3: admin 不顯示私密內容（admin.html）

**Files:** Modify `jte-platform-2026/admin.html`

- [ ] **Step 1: 改 `jteLinkedCard`（約 618-632 行）只顯示可分析層**

移除對 `l.question`、`l.excerpt`、`l.note` 的顯示；`topic` 僅 WenYi（選單類型，屬可分析）保留，WriteSpace 改顯示固定 `l.label||'心理位移書寫'`。每筆卡片副標只組：
- BuYi：`本卦 ben`（＋`→bian` 若有）＋ `changingLabel`
- WenYi：`topic`（類型）＋ `toneLabel`
- WriteSpace：`label||'心理位移書寫'`
原 `📝 註記`（`l.note`）那段整段移除，改為（若有 `l.priv`||舊 `l.note`）顯示灰字「🔒 私密內容（不顯示）」，否則不顯示。

- [ ] **Step 2: 改 analytics topicMap（約 446-448 行）**

- BuYi：key 由 `l.question` 改為 `l.ben`（卦象）——「最常出現的卦」。
- WenYi：維持 `l.topic`（類型）。
- WriteSpace：由 `l.topic` 改為計數（key 用固定 `'心理位移書寫'`），不讀使用者文字。

- [ ] **Step 3: 靜態自我檢查＋render 檢查**：grep 確認 admin.html 內不再有任何顯示 `l.question`/`l.excerpt`/`l.note` 明文的位置；headless 載入 admin.html 確認頁面不因改動報錯（未登入會停在登入頁，確認無 JS 例外即可）。

- [ ] **Step 4: Commit**（hub）"admin：後台不顯示私密內容，只呈現可分析層（卦象/類型/統計）"

---

## Task 4: 卜易首次隱私卡片（ven-i，雙副本）

**Files:** Modify `ven-i/index.html`

- [ ] **Step 1: 首次進站顯示一次性卡片**

在 app 初始渲染處，若 `!localStorage.getItem('veni_privacy_seen')`，顯示一張置中卡片：標題「你寫的，只有你看得到 🔒」＋兩句（你的問題與筆記只存在你的裝置；開啟跨裝置同步會加密、連我們也解不開）＋「了解隱私」連結（`showPrivacyInfo`）＋「我知道了」鈕（按下 `localStorage.setItem('veni_privacy_seen','1')` 並關閉）。樣式比照既有卡片。

- [ ] **Step 2: 靜態自我檢查（首訪顯示、再訪不顯示）＋ cp 雙副本＋兩 repo commit**（"ven-i：首次進站一次性隱私卡片"）

---

## Task 5: 整批上線

- [ ] **Step 1: 全測試綠**：`jte-privacy.test.html`（Task1 後）、`ven-i/ven-i-privacy.test.html`（Task2 後）皆 `python3 jte-testrun.py ...` 全綠。
- [ ] **Step 2: headless sanity**：ven-i/index.html、admin.html 載入無 JS 例外、關鍵內容渲染。
- [ ] **Step 3: push hub ＋ ven-i 兩 repo**（writespace 已於 Plan 4 上線）。確認 live 站 `showPrivacyInfo` 可用、admin 不再顯示私密。

---

## 完成後人工確認清單（給使用者）
1. admin 後台「全部記錄／使用者詳情」→ 確認看不到任何問題原文/筆記/書寫內容，只有卦象/類型/統計。
2. 卜易/心理位移書寫框「了解隱私」→ 跳出聲明頁。
3. 卜易首次進站 → 看到隱私卡片，按「我知道了」後不再出現。
4. （承 Plan 3）登入解鎖卜易歷史 → 舊的明文記錄應已在 Firestore 變密文。
