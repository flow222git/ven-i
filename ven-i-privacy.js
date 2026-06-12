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
