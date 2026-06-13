// interpret.js — 京房一卦詮釋核心（純函式、無 DOM）。掛 window.YiInterpret。
(function (root) {
  'use strict';

  // —— 問題意圖：以關鍵詞 + 句式判定五種意圖之一 ——
  var INTENT_RULES = [
    { intent: 'advance', kw: ['適合','可以','能不能','可不可以','要不要','推進','進場','出手','行不行','該不該做'] },
    { intent: 'block',   kw: ['卡點','卡在','阻力','問題在','瓶頸','風險','破口','最大的問題','障礙','難關'] },
    { intent: 'howto',   kw: ['怎麼做','如何做','如何處理','如何應對','該怎麼','下一步','作法','方法','怎麼處理','怎麼互動','怎麼辦'] },
    { intent: 'choice',  kw: ['選哪','取捨','還是','哪一個','哪個','要選','二選一','A 還是 B'] },
    { intent: 'trend',   kw: ['走勢','發展','變化','接下來','未來','後續','趨勢','會怎樣','三個月','這一季'] }
  ];
  var CATEGORY_RULES = {
    wealth: ['財','錢','收入','投資','支出','成本','資金','獲利','賺','薪','股','落袋','報價','開源'],
    career: ['工作','事業','職','合作','專案','主管','老闆','同事','客戶','面試','升遷','離職','轉職','合約','提案'],
    relationship: ['感情','關係','對方','伴侶','曖昧','復合','分手','婚姻','桃花','告白','相處','喜歡','男友','女友'],
    health: ['健康','身體','生病','病','痛','壓力','睡眠','失眠','醫','檢查','復原','休養','身心','疲勞','焦慮']
  };

  function includesAny(text, kws) {
    for (var i = 0; i < kws.length; i++) { if (text.indexOf(kws[i]) !== -1) return true; }
    return false;
  }
  function parseIntent(question) {
    var text = String(question || '').trim();
    var intent = 'trend';                      // 預設：走勢發展
    for (var i = 0; i < INTENT_RULES.length; i++) {
      if (includesAny(text, INTENT_RULES[i].kw)) { intent = INTENT_RULES[i].intent; break; }
    }
    var category = 'general';
    var cats = ['wealth', 'career', 'relationship', 'health'];
    for (var j = 0; j < cats.length; j++) {
      if (includesAny(text, CATEGORY_RULES[cats[j]])) { category = cats[j]; break; }
    }
    return { intent: intent, category: category };
  }

  var YONGSHEN_MAP = {
    wealth:       { primary: '妻財', support: '子孫', foe: '兄弟' },
    career:       { primary: '官鬼', support: '妻財', foe: '子孫' },
    // 感情：以妻財為主用代理；世應位置另在敘述呈現（應爻＝對方）。應爻驅動用神列未來增強。
    relationship: { primary: '妻財', support: '子孫', foe: '兄弟' },
    // 健康：官鬼＝病象/壓力（riskPrimary：越強越糟）；子孫＝解（benefic：旺則助復原）。
    health:       { primary: '官鬼', benefic: '子孫', riskPrimary: true },
    general:      { primary: null }
  };
  function pickYongshen(category, intent) {
    var m = YONGSHEN_MAP[category] || YONGSHEN_MAP.general;
    return {
      primary: m.primary, support: m.support || null,
      foe: m.foe || null, benefic: m.benefic || null, riskPrimary: !!m.riskPrimary
    };
  }
  var STRENGTH_RANK = { '旺': 4, '相': 3, '平': 2, '弱': 1, '陷': 0 };
  function strengthRank(s) { return STRENGTH_RANK[s] != null ? STRENGTH_RANK[s] : 2; }
  // 找某六親在卦上的爻；回 {present, line, index, strength, moving, isVoid, count} 或 {present:false, hidden:true}
  function locateYongshen(reading, annotations, relative) {
    if (!relative) {                                   // general：用世爻所臨
      var wIdx = reading.palace.worldLine - 1;
      var wl = reading.lineDetails[wIdx];
      return { present: true, line: wl, index: wIdx, relative: wl.relative,
        strength: annotations[wIdx].strength, moving: wl.moving, isVoid: annotations[wIdx].isVoid, isWorld: true };
    }
    var hits = [];
    for (var i = 0; i < 6; i++) {
      if (reading.lineDetails[i].relative === relative) {
        hits.push({ index: i, line: reading.lineDetails[i],
          strength: annotations[i].strength, moving: reading.lineDetails[i].moving, isVoid: annotations[i].isVoid });
      }
    }
    if (!hits.length) return { present: false, relative: relative, hidden: true };
    hits.sort(function (a, b) {
      if (a.moving !== b.moving) return a.moving ? -1 : 1;
      return strengthRank(b.strength) - strengthRank(a.strength);
    });
    var top = hits[0];
    return { present: true, relative: relative, line: top.line, index: top.index,
      strength: top.strength, moving: top.moving, isVoid: top.isVoid, count: hits.length };
  }

  var SIGNAL_LABEL = { advance:'推進', small:'小步', clarify:'釐清', shore:'補強', avoid:'避險' };
  // 用詞刻意中性、跨類型都讀得順（財務/事業/感情/健康皆適用）
  var SIGNAL_NEXT = {
    advance:'條件接得住，適合往前推進，把握這一段。',
    small:'條件大致可用，但先別全開，小步試試看。',
    clarify:'局勢還沒明顯偏向，先把狀況看清楚，再決定下一步。',
    shore:'不是不能動，是支撐還不夠——先把條件補好再走。',
    avoid:'壓力和破口偏重，先穩住、降風險，別硬來。'
  };
  function scoreSignal(yong, foeLoc, ys, beneficLoc) {
    if (!yong || yong.present === false) return 'clarify';
    var s = strengthRank(yong.strength);
    var score;
    if (ys && ys.riskPrimary) {
      // 用神本身是「風險／病象」（如健康的官鬼）：越強越糟；子孫（解）越旺越好
      score = (2 - s);
      if (yong.isVoid) score += 1;
      score += yong.moving ? (s >= 3 ? -1 : 1) : 0;
      if (beneficLoc && beneficLoc.present) {
        var b = strengthRank(beneficLoc.strength);
        score += (b >= 3 ? 1 : (b <= 1 ? -1 : 0));
      }
    } else {
      score = s - 2;
      if (yong.isVoid) score -= 1;
      score += yong.moving ? (s >= 3 ? 1 : -1) : 0;
      if (foeLoc && foeLoc.present && strengthRank(foeLoc.strength) >= 3) score -= 1;
    }
    if (score >= 2) return 'advance';
    if (score === 1) return 'small';
    if (score === 0) return 'clarify';
    if (score === -1) return 'shore';
    return 'avoid';
  }
  function strengthPlain(s) { return { '旺':'很有力','相':'有支撐','平':'平平','弱':'偏弱','陷':'受困' }[s] || '平平'; }
  // 爻位（由下而上 1..6）＝事情的進程：越下面越早期、越上面越接近收尾。白話階段：
  var YAO_STAGE = {
    1: { name: '起步', desc: '才剛開始、根基還淺' },
    2: { name: '打底', desc: '慢慢站穩、累積中' },
    3: { name: '難關', desc: '卡在半路、最容易出狀況' },
    4: { name: '接近核心', desc: '快到重點、要做抉擇' },
    5: { name: '正當位', desc: '時機與位置都好、最能發揮' },
    6: { name: '到頂', desc: '差不多到頂、再衝會過頭' }
  };
  function yaoStage(pos) { return YAO_STAGE[pos] || { name: '', desc: '' }; }
  // 「應」代表誰，跟著問題類型變（健康問自己的身體、沒有「對方」）
  var RESPONSE_ROLE = {
    relationship: '對方',
    wealth: '外部／對方（市場、合作方）',
    career: '外部／對方（公司、合作方）',
    health: '外在處境（作息、環境）',
    general: '外部局面'
  };
  function responseRole(category) { return RESPONSE_ROLE[category] || '外部'; }
  // 主敘述用（簡短）：位置＋階段名
  function worldResponseShort(reading, category) {
    var w = reading.palace.worldLine, r = reading.palace.responseLine;
    return '你（世）在' + reading.lineDetails[w-1].label + '・' + yaoStage(w).name
      + '，' + responseRole(category) + '（應）在' + reading.lineDetails[r-1].label + '・' + yaoStage(r).name;
  }
  // 細項用（完整）：位置＋階段名＋白話意義
  function worldResponseText(reading, category) {
    var w = reading.palace.worldLine, r = reading.palace.responseLine;
    var ws = yaoStage(w), rs = yaoStage(r);
    var note = (category === 'health')
      ? '（健康問的是你自己的身體，沒有真正的「對方」，世應僅供參考——主要看病象／復原力。）'
      : '爻位由下而上是事情的進程：越下面越早期、越上面越接近收尾。';
    return '你（世）在' + reading.lineDetails[w-1].label + '＝「' + ws.name + '」（' + ws.desc + '）；'
      + responseRole(category) + '（應）在' + reading.lineDetails[r-1].label + '＝「' + rs.name + '」（' + rs.desc + '）。'
      + note;
  }
  function describeRelative(reading, annotations, relative) {
    var loc = locateYongshen(reading, annotations, relative);
    if (loc.present === false) return relative + '沒上卦（伏）';
    return relative + '在' + loc.line.label + '、' + strengthPlain(loc.strength);
  }
  function timingText(annotations, yong) {
    if (!yong || yong.present === false || yong.index == null) return '時空（月日）對主線的影響：主線不在明面，暫不計。';
    var a = annotations[yong.index];
    var notes = (a.notes && a.notes.length) ? a.notes.join('、') : '無明顯沖合';
    return '此刻天時：用神之爻' + strengthPlain(a.strength) + '（' + notes + '）。';
  }
  function buildWhy(reading, annotations, ys, yong, foeLoc, beneficLoc, signal) {
    var why = [];
    why.push('你問的方向 → 用神取「' + (ys.primary || '世爻') + '」。');
    if (yong.present === false) {
      why.push('用神不上卦 → 這條線此刻在伏、不在明面，所以先釐清而非妄動。');
    } else if (ys.riskPrimary) {
      why.push('健康類：用神「' + ys.primary + '」代表病象／壓力，' + strengthPlain(yong.strength) + (yong.isVoid ? '、逢空（像在消退）' : '') + ' → 越強越要當心。');
      if (beneficLoc && beneficLoc.present) why.push('「' + ys.benefic + '」是解，此刻' + strengthPlain(beneficLoc.strength) + ' → 旺則助復原。');
    } else {
      why.push('用神之爻' + strengthPlain(yong.strength) + (yong.isVoid ? '、逢空' : '') + (yong.moving ? '、在動' : '') + ' → 影響強弱判斷。');
      if (foeLoc && foeLoc.present) why.push('忌神「' + ys.foe + '」' + strengthPlain(foeLoc.strength) + ' → ' + (strengthRank(foeLoc.strength) >= 3 ? '形成壓力。' : '壓力有限。'));
    }
    why.push('綜合 → 方向判為「' + SIGNAL_LABEL[signal] + '」。');
    return why;
  }
  function interpret(reading, annotations, opts) {
    opts = opts || {};
    var pi = parseIntent(opts.question);
    var category = opts.category || pi.category;
    var intent = opts.intent || pi.intent;
    var ys = pickYongshen(category, intent);
    var yong = locateYongshen(reading, annotations, ys.primary);
    var foeLoc = ys.foe ? locateYongshen(reading, annotations, ys.foe) : null;
    var beneficLoc = ys.benefic ? locateYongshen(reading, annotations, ys.benefic) : null;
    var signal = scoreSignal(yong, foeLoc, ys, beneficLoc);

    var hexName = reading.hexagram.fullName;
    var moveTxt = reading.movingIndexes.length
      ? ('動在' + reading.movingIndexes.map(function (i) { return reading.lineDetails[i].label; }).join('、'))
      : '六爻安靜、暫無明顯變動';

    var yongPlain;
    if (yong.present === false) {
      yongPlain = '代表「' + (ys.primary || '主線') + '」的爻這次沒上卦（要看伏神），等於這條線此刻不在明面上';
    } else if (ys.riskPrimary) {
      // 健康類：用病象專屬的強弱字，並直接講出「這次是強/弱、所以…」的結論（不用抽象規則）
      var ill = strengthRank(yong.strength);
      var illWord = { 4:'很盛', 3:'偏盛', 2:'中等', 1:'偏弱', 0:'很弱、快退了' }[ill] || '中等';
      var illVerdict = (ill >= 3)
        ? '——也就是病象／壓力這陣子偏強，要多當心'
        : ((ill <= 1 || yong.isVoid) ? '——也就是病象／壓力不算重，是相對好的訊號' : '——壓力中等，留意但不必慌');
      yongPlain = '代表「壓力／病象」的「' + (yong.relative || ys.primary) + '」此刻' + illWord
        + (yong.isVoid ? '、又逢空（像在消退）' : '')
        + (yong.moving ? '、還在動（變化中）' : '')
        + illVerdict;
    } else {
      yongPlain = '代表「' + (yong.relative || ys.primary) + '」的爻'
        + (yong.isWorld ? '就是你自己（世爻）' : '')
        + '此刻' + strengthPlain(yong.strength)
        + (yong.isVoid ? '、而且正逢空亡（像暫時懸空、還沒落實）' : '')
        + (yong.moving ? '、又在動（正在變化）' : '');
    }

    var situation = '你問的這件事，落在「' + hexName + '」：' + yongPlain + '。' + worldResponseShort(reading, category) + '。';
    var movement = reading.movingIndexes.length === 0
      ? '六爻安靜，本卦「' + hexName + '」保持原局、暫無明顯變動——先看眼前條件，不是立刻大轉向。'
      : '從「' + hexName + '」走向「' + reading.changedHexagram.fullName + '」——' + moveTxt + '，這是局勢正在移動的方向。';
    var nextStep = SIGNAL_NEXT[signal];

    var layer2 = {
      yongshen: { relative: ys.primary, present: yong.present !== false, state: yong.strength || '伏', plain: yongPlain },
      worldResponse: worldResponseText(reading, category),
      supports: (ys.support || ys.benefic) ? ('可借力：' + describeRelative(reading, annotations, ys.support || ys.benefic)) : '—',
      blocks: ys.foe ? ('要留意：' + describeRelative(reading, annotations, ys.foe)) : '—',
      timing: timingText(annotations, yong)
    };
    var why = buildWhy(reading, annotations, ys, yong, foeLoc, beneficLoc, signal);

    return {
      intent: intent, category: category, signal: signal, signalLabel: SIGNAL_LABEL[signal],
      layer1: { situation: situation, movement: movement, nextStep: nextStep },
      layer2: layer2, why: why
    };
  }

  // —— 斷吉凶（judgeFortune）：傳統斷法，實驗性，健康類不斷 ——
  var FORTUNE_SEASON = { '木': '春・寅卯月', '火': '夏・巳午月', '土': '四季末・辰戌丑未月', '金': '秋・申酉月', '水': '冬・亥子月' };
  var SIGNAL_FORTUNE = {
    advance: { label: '偏吉・可成', tendency: '吉' },
    small:   { label: '小吉・緩成', tendency: '小吉' },
    clarify: { label: '未定・宜觀望', tendency: '平' },
    shore:   { label: '偏弱・條件不足', tendency: '弱' },
    avoid:   { label: '偏凶・受阻宜守', tendency: '凶' }
  };

  function judgeFortune(reading, annotations, out) {
    // 健康類不作吉凶斷
    if (out.category === 'health') {
      return { mode: 'soft', verdict: '健康不作吉凶斷——請以身體訊號與醫療專業為準。' };
    }

    var sf = SIGNAL_FORTUNE[out.signal] || SIGNAL_FORTUNE.clarify;
    var label = sf.label;
    var tendency = sf.tendency;

    // 應期：依用神元素判斷
    var ys = out.layer2.yongshen;
    var timing;
    if (!ys.present) {
      timing = '用神不上卦，應期待伏神透出';
    } else {
      // Re-locate to get element and isVoid
      var yongLoc = locateYongshen(reading, annotations, ys.relative);
      if (!yongLoc.present) {
        timing = '用神不上卦，應期待伏神透出';
      } else if (yongLoc.isVoid) {
        timing = '待沖空、出空之時';
      } else {
        var elem = yongLoc.line ? yongLoc.line.element : null;
        if (elem && FORTUNE_SEASON[elem]) {
          timing = '待「' + elem + '」旺之時（' + FORTUNE_SEASON[elem] + '）';
        } else {
          timing = '應期視用神旺衰而定';
        }
      }
    }

    // 斷語（verdict）
    var relName = ys.relative || '世爻';
    var stateDesc = ys.state ? ('（' + strengthPlain(ys.state) + '）') : '';
    var verdictBase;
    if (out.signal === 'advance') verdictBase = '，事有成象，宜把握時機推進。';
    else if (out.signal === 'small') verdictBase = '，事可緩成，宜小步為營勿躁進。';
    else if (out.signal === 'clarify') verdictBase = '，局勢未明，宜靜待觀望再決策。';
    else if (out.signal === 'shore') verdictBase = '，支撐未足，宜先補強條件再行動。';
    else verdictBase = '，壓力偏重，宜守勢降風險、暫勿強行。';

    var verdict = '用神「' + relName + '」' + stateDesc + verdictBase;

    return { mode: 'verdict', label: label, tendency: tendency, verdict: verdict, timing: timing };
  }

  root.YiInterpret = { parseIntent: parseIntent, pickYongshen: pickYongshen, locateYongshen: locateYongshen, interpret: interpret, judgeFortune: judgeFortune, _strengthRank: strengthRank };
})(typeof window !== 'undefined' ? window : this);
