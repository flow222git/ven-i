(function () {
  'use strict';

  var manualVisible = false;
  var feedbackTimer = null;

  // ── Module-level state for category re-interpret ──────────────────────────
  var currentReading = null;
  var currentAnn = null;
  var currentCategory = null;

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

  // ── Hex stack ─────────────────────────────────────────────────────────────

  function renderHexStack(reading) {
    var movingSet = {};
    (reading.movingIndexes || []).forEach(function (i) { movingSet[i] = true; });
    qs('hexStack').innerHTML = [5, 4, 3, 2, 1, 0].map(function (index) {
      return '<div class="stack-row">' + lineGraphic(reading.lines[index], !!movingSet[index]) + '</div>';
    }).join('');
  }

  function renderCastingStack(casts, activeIndex) {
    if (activeIndex == null) activeIndex = -1;
    qs('hexStack').innerHTML = [5, 4, 3, 2, 1, 0].map(function (index) {
      var cast = casts ? casts[index] : null;
      var lineVal = cast ? JingFang.LINE_VALUES[cast.value] : null;
      var rowClasses = ['stack-row'];
      if (index === activeIndex) rowClasses.push('revealing');
      return '<div class="' + rowClasses.join(' ') + '">' +
        (lineVal
          ? lineGraphic(lineVal.bit, lineVal.moving, index === activeIndex ? 'fresh' : '')
          : pendingLineGraphic()) +
        '</div>';
    }).join('');
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

      // Push value and update stack (index = throwIndex which is 0=初爻)
      castValues.push(line.value);
      var stackCasts = castValues.map(function (v) { return { value: v }; });
      renderCastingStack(stackCasts, throwIndex);

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
    var timeCtx = JingFang.buildTimeContext(JingFang.autoTimeContextForDate(new Date()));
    var ann = JingFang.annotateTime(reading, timeCtx);
    var out = YiInterpret.interpret(reading, ann, { question: qs('question').value });
    currentReading = reading;
    currentAnn = ann;
    currentCategory = out.category;
    renderResult(reading, ann, out);
  }

  // ── renderResult ──────────────────────────────────────────────────────────

  function renderResult(reading, ann, out) {
    var resultEl = qs('result');
    resultEl.classList.remove('hidden', 'casting');

    // Hex stack
    renderHexStack(reading);

    // Hex name and movement
    qs('hexName').textContent = reading.hexagram.symbol + ' ' + reading.hexagram.fullName;
    qs('hexMove').textContent = out.layer1.movement;

    // Topic pick (category chips)
    renderTopicPick(out.category);

    // Layer 1 — situation + signal card
    renderLayer1(out);

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
      renderLayer1(out2);
      renderLayer2(out2);
    });
  }

  function renderLayer1(out) {
    var signal = out.signal;
    var signalLabel = escapeHtml(out.signalLabel);
    var situationEsc = escapeHtml(out.layer1.situation);
    var nextStepEsc = escapeHtml(out.layer1.nextStep);
    var movementEsc = escapeHtml(out.layer1.movement);

    var situationWrapped = wrapGlossTerms(situationEsc);
    var nextStepWrapped = wrapGlossTerms(nextStepEsc);

    var cardHtml =
      '<div class="signal-card ' + 'signal-' + signal + '">' +
        '<div class="signal-badge">' + signalLabel + '</div>' +
        '<div>' +
          '<p class="signal-next">' + nextStepWrapped + '</p>' +
          '<p class="movement-text">' + movementEsc + '</p>' +
        '</div>' +
      '</div>';

    qs('layer1').innerHTML =
      '<p class="situation">' + situationWrapped + '</p>' +
      cardHtml;
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
      qs('layer1').innerHTML = '';
      qs('layer2body').innerHTML = '';
      qs('layer3body').innerHTML = '';
      qs('reflect').innerHTML = '';
      qs('hexName').textContent = '起卦中';
      qs('hexMove').textContent = '靜心想著你的問題，由下而上、一爻一爻擲';
      renderCastingStack([], -1);
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
