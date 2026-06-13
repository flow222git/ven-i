(function () {
  'use strict';

  var manualVisible = false;
  var feedbackTimer = null;

  // ── Module-level state for category re-interpret ──────────────────────────
  var currentReading = null;
  var currentAnn = null;
  var currentCategory = null;
  var currentTimeCtx = null;

  // ── Interactive casting state ─────────────────────────────────────────────
  var castValues = [];

  // ── Category labels ───────────────────────────────────────────────────────
  var CATEGORY_LABELS = { general: '總體', career: '事業', wealth: '財務', relationship: '感情', health: '健康' };
  var CATEGORY_KEYS = ['general', 'career', 'wealth', 'relationship', 'health'];

  // ── Question examples ─────────────────────────────────────────────────────
  var EXAMPLES = [
    '這個合作案接下來三個月適合推進嗎？',
    '目前最大的卡點是什麼？',
    '這筆收入三個月內能不能落袋？',
    '這段關係下一步怎麼走？',
    '最近身心狀態要先注意什麼？'
  ];

  // ── Helpers ──────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function qs(id) {
    return document.getElementById(id);
  }

  // ── Glossary term wrapping ───────────────────────────────────────────────

  var glossaryTerms = null;
  function getGlossaryTerms() {
    if (!glossaryTerms) {
      glossaryTerms = YiGlossary.all().slice().sort(function (a, b) {
        return b.length - a.length;
      });
    }
    return glossaryTerms;
  }

  var _glossRe = null;
  function wrapGlossTerms(escapedHtml) {
    var terms = getGlossaryTerms();
    if (!terms.length) return escapedHtml;
    if (!_glossRe) {
      var alt = terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
      _glossRe = new RegExp('(' + alt + ')', 'g');
    }
    return escapedHtml.replace(_glossRe, function (m) {
      return '<span class="gloss" data-term="' + m + '">' + m + '</span>';
    });
  }

  // —— 反思筆記（純本機，不上傳）——
  var RKEY = 'jfy_reflections';
  function rload() { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch (e) { return []; } }
  function rsave(rec) {
    var l = rload();
    rec.id = 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    rec.ts = new Date().toISOString();
    l.push(rec); localStorage.setItem(RKEY, JSON.stringify(l));
    return rec;
  }
  function rremove(id) { localStorage.setItem(RKEY, JSON.stringify(rload().filter(function (x) { return x.id !== id; }))); }
  window.YiReflect = { save: rsave, list: rload, remove: rremove };

  // ── Line graphics ─────────────────────────────────────────────────────────

  function lineGraphic(bit, moving, extraClass) {
    var classes = ['yao-line', bit ? 'yang' : 'yin'];
    if (moving) classes.push('moving');
    if (extraClass) classes.push(extraClass);
    return '<span class="' + classes.join(' ') + '" aria-label="' + (bit ? '陽爻' : '陰爻') + '"><i></i><i></i></span>';
  }

  function pendingLineGraphic() {
    return '<span class="yao-line pending" aria-label="待成之爻"><i></i><i></i></span>';
  }

  // ── Cast notice ───────────────────────────────────────────────────────────

  function showCastFeedback(message) {
    window.clearTimeout(feedbackTimer);
    var notice = qs('castNotice');
    notice.textContent = message;
    notice.classList.remove('show');
    void notice.offsetWidth;
    notice.classList.add('show');
    feedbackTimer = window.setTimeout(function () {
      notice.classList.remove('show');
    }, 1800);
  }

  // ── Manual input ──────────────────────────────────────────────────────────

  function renderManualInputs() {
    var container = qs('manualLines');
    var options = Object.values(JingFang.LINE_VALUES)
      .map(function (line) {
        return '<option value="' + line.value + '">' + line.value + ' ' + line.label + '</option>';
      })
      .join('');
    var rows = [5, 4, 3, 2, 1, 0].map(function (index) {
      return '<label class="line-input">' +
        '<span>' + escapeHtml(JingFang.LINE_LABELS[index]) + '</span>' +
        '<select data-line-index="' + index + '">' + options + '</select>' +
        '</label>';
    }).join('');
    container.innerHTML = rows + '<button class="apply-btn" type="button">套用手動六爻</button>';
    container.querySelector('.apply-btn').addEventListener('click', function () {
      applyReading(getManualValues());
    });
  }

  function getManualValues() {
    var values = Array(6).fill(7);
    qs('manualLines').querySelectorAll('select').forEach(function (select) {
      values[Number(select.dataset.lineIndex)] = Number(select.value);
    });
    return values;
  }

  function setManualValues(values) {
    qs('manualLines').querySelectorAll('select').forEach(function (select) {
      select.value = String(values[Number(select.dataset.lineIndex)]);
    });
  }

  // ── Luju Card helpers ─────────────────────────────────────────────────────

  function relativeChipClass(relative) {
    var map = { '官鬼': 'lc-c-guan', '父母': 'lc-c-fu', '兄弟': 'lc-c-xiong', '妻財': 'lc-c-cai', '子孫': 'lc-c-sun' };
    return map[relative] || 'lc-c-fu';
  }

  function buildFuNote(out, reading) {
    var supports = out.layer2.supports || '';
    var blocks = out.layer2.blocks || '';
    var hidden = [];
    var combined = supports + ' ' + blocks;
    var relNames = ['官鬼', '父母', '兄弟', '妻財', '子孫'];
    relNames.forEach(function (r) {
      if (combined.indexOf(r + '沒上卦') !== -1) {
        hidden.push(r);
      }
    });
    if (!hidden.length) {
      return '明面上角色齊全，伏神暫無缺位。';
    }
    return '潛力藏著未現：<b>' + hidden.map(escapeHtml).join('</b>、<b>') + '</b>——這些角色在伏，需主動引出。';
  }

  // 動爻數 → 傳統重點提示
  var MOVING_HINT = [
    '靜卦・看本卦整體',
    '一爻動・重點看動爻的變化',
    '二爻動・以上面的動爻為主',
    '三爻動・本卦變卦並看，本卦為主',
    '四爻動・重心移向變卦',
    '五爻動・看變卦',
    '六爻全變・看變卦'
  ];

  function renderLujuCard(reading, ann, out, timeCtx) {
    var question = qs('question') ? qs('question').value : '';
    var palace = reading.palace;
    var yongshenRelative = out.layer2.yongshen.relative;
    var movingCount = reading.movingIndexes.length;
    var hasMoving = movingCount >= 1;

    // Meta line: 宮 · 世代 | 月建月 · 日辰日 | 空亡
    var metaParts = [
      escapeHtml(palace.palace) + '宮 · ' + escapeHtml(palace.generation)
    ];
    if (timeCtx && timeCtx.monthBranch) {
      metaParts.push(escapeHtml(timeCtx.monthBranch) + '月 · ' + escapeHtml(timeCtx.dayGanzhi || '—') + '日');
    }
    if (timeCtx && timeCtx.voidBranches && timeCtx.voidBranches.length) {
      metaParts.push(escapeHtml(timeCtx.voidBranches.join('')) + ' 空亡');
    }
    // 動爻數重點提示
    var movingHintIdx = Math.min(movingCount, 6);
    metaParts.push(escapeHtml(MOVING_HINT[movingHintIdx]));

    // 六爻 rows — index 5 downto 0 (top to bottom display)
    var POS_LABELS = { 5: '上', 4: '五', 3: '四', 2: '三', 1: '二', 0: '初' };
    var rowsHtml = [5, 4, 3, 2, 1, 0].map(function (i) {
      var line = reading.lineDetails[i];
      var a = ann[i];
      var isYin = line.bit === 0;
      var isShi = line.role.indexOf('世') !== -1;
      var isYing = line.role.indexOf('應') !== -1;
      var isMove = line.moving;
      var isVoid = a.isVoid;
      var isYong = yongshenRelative && line.relative === yongshenRelative;
      var showStrength = isYong || isShi;

      var rowDivClass = 'lc-row' + (isShi ? ' lc-shi' : '');
      var yaoClass = 'lc-yao' + (isYin ? ' lc-yin' : '');
      var yaoInner = isYin
        ? '<div class="lc-seg"></div><div class="lc-gap"></div><div class="lc-seg"></div>'
        : '<div class="lc-seg"></div>';

      var chipClass = 'lc-chip ' + relativeChipClass(line.relative);
      var najiaEsc = escapeHtml(line.najia.text + line.element);

      var tags = '';
      if (isYong) tags += '<span class="lc-tag lc-t-yong">用神</span>';
      if (isMove) tags += '<span class="lc-tag lc-t-move">動</span>';
      if (isShi)  tags += '<span class="lc-tag lc-t-shi">世</span>';
      if (isYing) tags += '<span class="lc-tag lc-t-ying">應</span>';
      if (isVoid) tags += '<span class="lc-tag lc-t-void">空</span>';
      if (showStrength && a.strength) tags += '<span class="lc-tag lc-t-wang">' + escapeHtml(a.strength) + '</span>';

      return '<div class="' + rowDivClass + '">' +
        '<div class="lc-pos">' + escapeHtml(POS_LABELS[i]) + '</div>' +
        '<div class="' + yaoClass + '">' + yaoInner + '</div>' +
        '<div class="lc-role">' +
          '<span class="' + chipClass + '">' + escapeHtml(line.relative) + '</span>' +
          '<span class="lc-najia">' + najiaEsc + '</span>' +
          tags +
        '</div>' +
      '</div>';
    }).join('');

    // Signal
    var signal = out.signal;
    var signalLabel = out.signalLabel || '';
    var lampChar = signalLabel.charAt(0);
    var sigClass = (signal === 'advance' || signal === 'small') ? 'lc-sig-pine'
                 : (signal === 'avoid') ? 'lc-sig-red' : 'lc-sig-gold';

    // Oneliner: out.layer1.situation (with glossary wrapping)
    var onelineEsc = wrapGlossTerms(escapeHtml(out.layer1.situation));
    // Hidden note (with glossary wrapping)
    var fuNoteHtml = wrapGlossTerms(buildFuNote(out, reading));

    // 變卦 hexhead — only show arrow+變卦 when there are moving lines
    var hexheadHtml;
    if (hasMoving) {
      hexheadHtml =
        '<div class="lc-hexhead">' +
          '<div class="lch"><div class="lch-sym">' + escapeHtml(reading.hexagram.symbol) + '</div>' +
            '<div class="lch-nm">' + escapeHtml(reading.hexagram.fullName) + '</div></div>' +
          '<div class="lch-arrow">▶</div>' +
          '<div class="lch"><div class="lch-sym">' + escapeHtml(reading.changedHexagram.symbol) + '</div>' +
            '<div class="lch-nm">' + escapeHtml(reading.changedHexagram.fullName) + '</div></div>' +
        '</div>';
    } else {
      hexheadHtml =
        '<div class="lc-hexhead lc-hexhead-static">' +
          '<div class="lch"><div class="lch-sym">' + escapeHtml(reading.hexagram.symbol) + '</div>' +
            '<div class="lch-nm">' + escapeHtml(reading.hexagram.fullName) + '</div></div>' +
          '<div class="lch-static-note">六爻安靜・本卦未變</div>' +
        '</div>';
    }

    // 斷吉凶 fortune block
    var fortuneData = YiInterpret.judgeFortune(reading, ann, out);
    var fortuneHtml;
    if (fortuneData.mode === 'soft') {
      fortuneHtml =
        '<div class="lc-fortune">' +
          '<div class="lc-fortune-head">🔮 傳統斷法（實驗性・待驗證）</div>' +
          '<div class="lc-fortune-verdict">' + escapeHtml(fortuneData.verdict) + '</div>' +
          '<div class="lc-fortune-warn">⚠️ 這是傳統推斷的「一種可能」，不是保證；之後可回頭驗證準不準。</div>' +
        '</div>';
    } else {
      fortuneHtml =
        '<div class="lc-fortune">' +
          '<div class="lc-fortune-head">🔮 傳統斷法（實驗性・待驗證）</div>' +
          '<div class="lc-fortune-meta">' +
            '<span class="lc-fortune-tend">傾向：' + escapeHtml(fortuneData.label) + '</span>' +
            '<span class="lc-fortune-timing">應期：' + escapeHtml(fortuneData.timing) + '</span>' +
          '</div>' +
          '<div class="lc-fortune-verdict">' + wrapGlossTerms(escapeHtml(fortuneData.verdict)) + '</div>' +
          '<div class="lc-fortune-warn">⚠️ 這是傳統推斷的「一種可能」，不是保證；之後可回頭驗證準不準。</div>' +
        '</div>';
    }

    var html =
      '<div class="luju-card">' +
        '<div class="lc-eyebrow">Jing Fang Yi Gua · 局勢圖</div>' +
        '<div class="lc-title">京房一卦</div>' +
        '<div class="lc-q">問：' + escapeHtml(question || '（未填問題）') + '</div>' +
        hexheadHtml +
        '<div class="lc-meta">' + metaParts.join(' | ') + '</div>' +
        '<div class="lc-stack">' + rowsHtml + '</div>' +
        '<div class="lc-hidden-note">伏（藏著未現）：' + fuNoteHtml + '</div>' +
        '<div class="lc-signal ' + sigClass + '">' +
          '<div class="lc-lamp">' + escapeHtml(lampChar) + '</div>' +
          '<div class="lc-sig-st"><b>' + escapeHtml(signalLabel) + '</b>' +
            '<div>' + escapeHtml(out.layer1.nextStep) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lc-oneliner">' + onelineEsc + '</div>' +
        fortuneHtml +
        '<div class="lc-foot">反思鏡 · 相對參考、非預言 | 哪句打中你？下一步你想怎麼走？</div>' +
      '</div>';

    qs('luju-card').innerHTML = html;
  }

  // ── Coin SVG ──────────────────────────────────────────────────────────────

  function coinSVG(stt) {
    var col = stt === 'yang' ? 'var(--pine)' : (stt === 'yin' ? 'var(--muted)' : 'var(--line)');
    var marks = stt === 'yang'
      ? '<g stroke="' + col + '" stroke-width="2" stroke-linecap="round"><line x1="30" y1="9" x2="30" y2="15"/><line x1="30" y1="45" x2="30" y2="51"/><line x1="9" y1="30" x2="15" y2="30"/><line x1="45" y1="30" x2="51" y2="30"/></g>'
      : (stt === 'yin'
        ? '<g stroke="' + col + '" stroke-width="2" stroke-linecap="round" opacity=".7"><line x1="20" y1="20" x2="24" y2="24"/><line x1="40" y1="20" x2="36" y2="24"/><line x1="20" y1="40" x2="24" y2="36"/><line x1="40" y1="40" x2="36" y2="36"/></g>'
        : '');
    var fill = stt === 'blank' ? 'none' : (stt === 'yang' ? 'var(--surface-2)' : 'var(--surface)');
    return '<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><circle cx="30" cy="30" r="27" fill="' + fill + '" stroke="' + col + '" stroke-width="2.5"/><rect x="22" y="22" width="16" height="16" rx="1.5" fill="var(--surface)" stroke="' + col + '" stroke-width="2.5"/>' + marks + '</svg>';
  }

  // ── Coin toss ─────────────────────────────────────────────────────────────

  function tossLine() {
    var c = [0, 0, 0].map(function () { return Math.random() < 0.5 ? 2 : 3; });
    var sum = c[0] + c[1] + c[2]; // 6..9
    return { coins: c, value: sum };
  }

  var LINE_TOSS_LABELS = { 6: '老陰變', 7: '少陽', 8: '少陰', 9: '老陽變' };

  function initCastArea() {
    var area = qs('castArea');
    area.innerHTML =
      '<div class="coin-wrap">' +
        '<div class="coins" id="coinRow">' +
          '<span class="coin" id="coin0">' + coinSVG('blank') + '</span>' +
          '<span class="coin" id="coin1">' + coinSVG('blank') + '</span>' +
          '<span class="coin" id="coin2">' + coinSVG('blank') + '</span>' +
        '</div>' +
        '<div class="coin-result" id="coinResult"></div>' +
      '</div>' +
      '<div style="text-align:center;margin-top:8px">' +
        '<button id="castThrow" class="primary" type="button">擲第 1 爻</button>' +
      '</div>';
    qs('castThrow').addEventListener('click', onCastThrow);
  }

  function onCastThrow() {
    if (castValues.length < 6) {
      var line = tossLine();
      var throwIndex = castValues.length; // 0-based index of爻 being thrown (bottom-up)

      // Animate coins
      var coinEls = [qs('coin0'), qs('coin1'), qs('coin2')];
      coinEls.forEach(function (el) { el.classList.add('flip'); });
      window.setTimeout(function () {
        coinEls.forEach(function (el, i) {
          el.innerHTML = coinSVG(line.coins[i] === 3 ? 'yang' : 'yin');
          el.classList.remove('flip');
        });
      }, 160);

      // Show result text
      var n = throwIndex + 1;
      qs('coinResult').textContent = '第 ' + n + ' 爻：' + line.value + ' · ' + (LINE_TOSS_LABELS[line.value] || '');

      // Push value
      castValues.push(line.value);

      // Update button label
      if (castValues.length === 6) {
        qs('castThrow').textContent = '看結果';
      } else {
        qs('castThrow').textContent = '擲第 ' + (castValues.length + 1) + ' 爻';
      }
    } else {
      // All 6 done — hide cast area and run reading
      qs('castArea').classList.add('hidden');
      setManualValues(castValues);
      applyReading(castValues);
    }
  }

  // ── applyReading ──────────────────────────────────────────────────────────

  function applyReading(values) {
    var reading = JingFang.analyze(values);
    var timeCtx = JingFang.autoTimeContextForDate(new Date());
    var ann = JingFang.annotateTime(reading, timeCtx);
    var out = YiInterpret.interpret(reading, ann, { question: qs('question').value });
    currentReading = reading;
    currentAnn = ann;
    currentCategory = out.category;
    currentTimeCtx = timeCtx;
    renderResult(reading, ann, out, timeCtx);
  }

  // ── renderResult ──────────────────────────────────────────────────────────

  function renderResult(reading, ann, out, timeCtx) {
    var resultEl = qs('result');
    resultEl.classList.remove('hidden', 'casting');

    // 局勢卡 (replaces hex-head + layer1)
    renderLujuCard(reading, ann, out, timeCtx);

    // Topic pick (category chips)
    renderTopicPick(out.category);

    // Layer 2 — yongshen details
    renderLayer2(out);

    // Layer 3 — line table
    renderLayer3(reading, ann);

    // Reflect / why
    renderReflect(reading);

    // Scroll into view
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Topic pick ────────────────────────────────────────────────────────────

  function renderTopicPick(activeCategory) {
    currentCategory = activeCategory;
    var chips = CATEGORY_KEYS.map(function (cat) {
      var label = escapeHtml(CATEGORY_LABELS[cat] || cat);
      var isOn = cat === activeCategory ? ' on' : '';
      return '<button type="button" class="topic-chip' + isOn + '" data-cat="' + escapeHtml(cat) + '">' + label + '</button>';
    }).join('');
    qs('topicPick').innerHTML =
      '<div class="topic-pick">' +
        '<span class="topic-pick-label">看起來你問的是</span>' +
        chips +
        '<span class="topic-pick-hint">不對？點一下換</span>' +
      '</div>';
  }

  function bindTopicPick() {
    document.addEventListener('click', function (e) {
      var chip = e.target.closest('.topic-chip');
      if (!chip) return;
      var cat = chip.getAttribute('data-cat');
      if (!cat || !currentReading) return;
      var out2 = YiInterpret.interpret(currentReading, currentAnn, {
        question: qs('question').value,
        category: cat
      });
      currentCategory = cat;
      renderTopicPick(cat);
      renderLujuCard(currentReading, currentAnn, out2, currentTimeCtx);
      renderLayer2(out2);
    });
  }

  function renderLayer2(out) {
    var l2 = out.layer2;
    var rows = [
      { label: '用神', text: escapeHtml(l2.yongshen.relative || '世爻') + '（' + escapeHtml(l2.yongshen.state) + '）：' + escapeHtml(l2.yongshen.plain) },
      { label: '世應', text: escapeHtml(l2.worldResponse) },
      { label: '可借力', text: escapeHtml(l2.supports) },
      { label: '要留意', text: escapeHtml(l2.blocks) },
      { label: '天時', text: escapeHtml(l2.timing) }
    ];
    var html = rows.map(function (row) {
      return '<div class="layer2-row"><b>' + escapeHtml(row.label) + '</b><span>' + wrapGlossTerms(row.text) + '</span></div>';
    }).join('');
    qs('layer2body').innerHTML = html;
  }

  function renderLayer3(reading, ann) {
    var movingSet = {};
    (reading.movingIndexes || []).forEach(function (i) { movingSet[i] = true; });

    var thead = '<thead><tr>' +
      '<th>爻位</th><th>爻象</th><th>納甲</th><th>五行</th><th>六親</th><th>旺衰</th><th>空亡</th>' +
      '</tr></thead>';

    var tbody = '<tbody>' + [5, 4, 3, 2, 1, 0].map(function (index) {
      var line = reading.lineDetails[index];
      var a = ann[index];
      var isMoving = !!movingSet[index];
      var isVoid = !!a.isVoid;
      var rowClass = isMoving ? ' class="is-moving"' : (isVoid ? ' class="is-void"' : '');
      return '<tr' + rowClass + '>' +
        '<td>' + escapeHtml(line.label) + '</td>' +
        '<td>' + lineGraphic(line.bit, isMoving) + '</td>' +
        '<td>' + escapeHtml(line.najia.text) + '</td>' +
        '<td>' + escapeHtml(line.element) + '</td>' +
        '<td>' + escapeHtml(line.relative) + '</td>' +
        '<td>' + escapeHtml(a.strength) + '</td>' +
        '<td>' + (isVoid ? '空' : '—') + '</td>' +
        '</tr>';
    }).join('') + '</tbody>';

    qs('layer3body').innerHTML = '<table>' + thead + tbody + '</table>';
  }

  function renderReflect(reading) {
    var reflectEl = qs('reflect');
    if (!reflectEl) return;

    function buildPastList() {
      var all = window.YiReflect.list().slice().reverse();
      if (!all.length) return '';
      var items = all.map(function (r) {
        var date = escapeHtml((r.ts || '').slice(0, 10));
        var hex = escapeHtml(r.hex || '');
        var q = escapeHtml(r.q || '');
        var hit = escapeHtml(r.hit || '');
        var miss = escapeHtml(r.miss || '');
        var plan = escapeHtml(r.plan || '');
        var id = escapeHtml(r.id || '');
        var fields = [];
        if (q) fields.push('<span class="reflect-field"><b>問：</b>' + q + '</span>');
        if (hit) fields.push('<span class="reflect-field"><b>打中：</b>' + hit + '</span>');
        if (miss) fields.push('<span class="reflect-field"><b>不對：</b>' + miss + '</span>');
        if (plan) fields.push('<span class="reflect-field"><b>打算：</b>' + plan + '</span>');
        return '<div class="reflect-card" data-id="' + id + '">' +
          '<div class="reflect-card-head">' +
            '<span class="reflect-card-meta">' + date + ' · ' + hex + '</span>' +
            '<button class="reflect-del" type="button" data-id="' + id + '">刪除</button>' +
          '</div>' +
          '<div class="reflect-card-body">' + fields.join('') + '</div>' +
        '</div>';
      }).join('');
      return '<div class="reflect-past"><h4 class="reflect-past-title">過去的回應</h4>' + items + '</div>';
    }

    var hexName = escapeHtml(reading && reading.hexagram ? reading.hexagram.fullName : '');

    reflectEl.innerHTML =
      '<h3 class="reflect-heading">🪞 你的回應</h3>' +
      '<p class="reflect-hint">選填、可跳過。哪一句打中你？哪一句不對？你打算怎麼做？</p>' +
      '<div class="reflect-form">' +
        '<label class="reflect-label">哪一句打中你？<input class="reflect-input" id="rHit" type="text" placeholder="（選填）" /></label>' +
        '<label class="reflect-label">哪一句不對？<input class="reflect-input" id="rMiss" type="text" placeholder="（選填）" /></label>' +
        '<label class="reflect-label">你打算怎麼做？<textarea class="reflect-input" id="rPlan" rows="2" placeholder="（選填）"></textarea></label>' +
        '<div class="reflect-form-foot">' +
          '<button class="reflect-save-btn" type="button" id="rSave">記下這次</button>' +
          '<span class="reflect-confirm hidden" id="rConfirm">已記下</span>' +
        '</div>' +
      '</div>' +
      '<div id="rPastList">' + buildPastList() + '</div>';

    qs('rSave').addEventListener('click', function () {
      var hit = qs('rHit').value;
      var miss = qs('rMiss').value;
      var plan = qs('rPlan').value;
      var q = qs('question') ? qs('question').value : '';
      window.YiReflect.save({ q: q, hex: hexName, hit: hit, miss: miss, plan: plan });
      qs('rHit').value = '';
      qs('rMiss').value = '';
      qs('rPlan').value = '';
      var conf = qs('rConfirm');
      conf.classList.remove('hidden');
      setTimeout(function () { conf.classList.add('hidden'); }, 1800);
      qs('rPastList').innerHTML = buildPastList();
    });

    reflectEl.addEventListener('click', function (e) {
      var delBtn = e.target.closest('.reflect-del');
      if (delBtn) {
        var id = delBtn.getAttribute('data-id');
        window.YiReflect.remove(id);
        qs('rPastList').innerHTML = buildPastList();
      }
    });
  }

  // ── Glossary popover ──────────────────────────────────────────────────────

  function showGlossPopover(termEl) {
    var term = termEl.getAttribute('data-term');
    var entry = YiGlossary.get(term);
    if (!entry) return;

    var pop = qs('glossPop');
    pop.innerHTML =
      '<span class="gloss-pop-term">' + escapeHtml(term) + '</span>' +
      '<p class="gloss-pop-plain">' + escapeHtml(entry.plain) + '</p>' +
      '<p class="gloss-pop-why">' + escapeHtml(entry.why) + '</p>';

    var rect = termEl.getBoundingClientRect();
    var popW = 280;
    var left = Math.min(rect.left, window.innerWidth - popW - 12);
    var top = rect.bottom + 8;
    if (top + 160 > window.innerHeight) {
      top = rect.top - 8 - 160;
    }
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
    pop.classList.remove('hidden');
  }

  function hideGlossPopover() {
    qs('glossPop').classList.add('hidden');
  }

  // ── Ask examples ──────────────────────────────────────────────────────────

  function renderAskExamples() {
    var container = qs('askExamples');
    if (!container) return;
    container.innerHTML = EXAMPLES.map(function (text) {
      return '<button type="button" class="ask-ex">' + escapeHtml(text) + '</button>';
    }).join('');
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.ask-ex');
      if (btn) {
        qs('question').value = btn.textContent;
      }
    });
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  function bindEvents() {
    // Cast button — start interactive casting
    qs('cast').addEventListener('click', function () {
      castValues = [];
      var resultEl = qs('result');
      resultEl.classList.remove('hidden');
      qs('topicPick').innerHTML = '';
      qs('luju-card').innerHTML = '<p style="color:var(--muted);text-align:center;padding:18px 0;">靜心想著你的問題，由下而上、一爻一爻擲</p>';
      qs('layer2body').innerHTML = '';
      qs('layer3body').innerHTML = '';
      qs('reflect').innerHTML = '';
      var castArea = qs('castArea');
      castArea.classList.remove('hidden');
      initCastArea();
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Manual toggle
    qs('manualToggle').addEventListener('click', function () {
      manualVisible = !manualVisible;
      var container = qs('manualLines');
      if (manualVisible) {
        container.classList.remove('hidden');
        qs('manualToggle').textContent = '收起手動';
      } else {
        container.classList.add('hidden');
        qs('manualToggle').textContent = '手動六爻';
      }
    });

    // Topic chip re-interpret (delegated)
    bindTopicPick();

    // Glossary popover — delegated on document
    document.addEventListener('click', function (e) {
      var glossEl = e.target.closest('.gloss');
      if (glossEl) {
        e.stopPropagation();
        showGlossPopover(glossEl);
        return;
      }
      // Click outside closes popover
      if (!e.target.closest('#glossPop')) {
        hideGlossPopover();
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    renderManualInputs();
    renderAskExamples();
    bindEvents();

    qs('disclaimer').textContent = '京房一卦是傳統易學規則的反思與決策輔助，幫你整理局勢與下一步方向，不預測命運、不替代醫療/法律/投資/心理治療等專業判斷。';
  });

  // ── Public API ────────────────────────────────────────────────────────────

  window.YiApp = { applyReading: applyReading };
  window.__jingfangReady = true;

})();
