/* ============================================================
   回声公寓 · 界面控制层
   视图路由 / 叙事渲染 / 模态框 / 存档
   ============================================================ */

(() => {
  'use strict';

  /* ── 快捷引用 ───────────────────────────────────────── */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svgNS = 'http://www.w3.org/2000/svg';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SAVE_KEY = 'echo-apartment-save-v1';
  const NATIVE_HISTORY = window.history;

  /* ── 应用状态 ───────────────────────────────────────── */
  let S = EchoEngine.newState();
  let feedHistory = [];
  let residentFilter = 'all';
  let itemFilter = 'all';
  let ruleFilter = 'all';
  let lastFocus = null;
  let booting = true;

  const dom = {
    feed: $('#feed'),
    choices: $('#choices'),
    form: $('#acts-form'),
    input: $('#act-input'),
    clockTime: $('#clock-time'),
    clockShift: $('#clock-shift'),
    clockScene: $('#clock-scene'),
    stripTime: $('#strip-time'),
    sceneLabel: $('#scene-label'),
    dialProgress: $('#dial-progress'),
    dialHand: $('#dial-hand'),
    valClarity: $('#val-clarity'),
    barClarity: $('#bar-clarity'),
    valRecords: $('#val-records'),
    barRecords: $('#bar-records'),
    valCount: $('#val-count'),
    valCountSub: $('#val-count-sub'),
    badgeClarity: $('#badge-clarity'),
    badgeClarityText: $('#badge-clarity-text'),
    badgeRulesText: $('#badge-rules-text'),
    liveLog: $('#live-log'),
    residentGrid: $('#resident-grid'),
    itemGrid: $('#item-grid'),
    ruleGroups: $('#rule-groups'),
    timeline: $('#timeline'),
    excerpts: $('#excerpts'),
    modal: $('#modal'),
    modalKicker: $('#modal-kicker'),
    modalTitle: $('#modal-title'),
    modalBody: $('#modal-body'),
    modalFoot: $('#modal-foot'),
    toasts: $('#toasts'),
    tabs: $$('.tab'),
    views: $$('.view')
  };

  /* ══════════════════════════════════════════════════════
     工具
     ══════════════════════════════════════════════════════ */

  function icon(id) {
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svgNS, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  /** 轻量富文本：仅支持 **粗体** 与 %强调% */
  function richText(target, text) {
    const frag = document.createDocumentFragment();
    String(text).split(/(\*\*[^*]+\*\*|%[^%]+%)/g).forEach(part => {
      if (!part) return;
      if (part.startsWith('**') && part.endsWith('**')) {
        const b = document.createElement('strong');
        b.textContent = part.slice(2, -2);
        frag.appendChild(b);
      } else if (part.startsWith('%') && part.endsWith('%')) {
        const em = document.createElement('em');
        em.textContent = part.slice(1, -1);
        frag.appendChild(em);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    });
    target.appendChild(frag);
  }

  const plain = s => String(s).replace(/\*\*/g, '').replace(/%/g, '');

  function scrollFeed() {
    requestAnimationFrame(() => {
      dom.feed.scrollTop = dom.feed.scrollHeight;
    });
  }

  /** 逐字揭示：短文本直接落，长文本分块，1.4 秒兜底 */
  function typeInto(node, text) {
    const t = plain(text);
    if (REDUCED || document.hidden || t.length < 26) {
      node.textContent = t;
      return;
    }
    let i = 0;
    const step = 8;
    node.textContent = '';
    node.classList.add('typing');
    const timer = setInterval(() => {
      i = Math.min(t.length, i + step);
      node.textContent = t.slice(0, i);
      if (i >= t.length) {
        clearInterval(timer);
        node.classList.remove('typing');
        scrollFeed();
      }
    }, 16);
    setTimeout(() => {
      if (i < t.length) {
        clearInterval(timer);
        node.textContent = t;
        node.classList.remove('typing');
        scrollFeed();
      }
    }, 1400);
  }

  /* ══════════════════════════════════════════════════════
     一、叙事流渲染
     ══════════════════════════════════════════════════════ */

  function postShell(kind, meta) {
    const post = el('article', 'post post--' + kind);
    const head = el('header', 'post__meta');
    head.appendChild(el('span', 'post__who', meta.who || '值守室'));
    if (meta.chip) head.appendChild(el('span', 'post__chip', meta.chip));
    head.appendChild(el('span', 'post__time', meta.time || EchoEngine.clockText(S.minutes)));
    post.appendChild(head);
    return post;
  }

  function renderBlock(block, silent) {
    if (!block) return;

    /* — 叙述 — */
    if (block.type === 'narr') {
      const post = postShell('narr', block);
      const body = el('div', 'post__body' + (block.whisper ? ' post__body--whisper' : ''));
      post.appendChild(body);
      const paras = (block.paras || []).filter(Boolean);
      paras.forEach((p, idx) => {
        const last = idx === paras.length - 1;
        const pn = el('p', block.whisper ? 'whisper' : '');
        if (!silent && last) {
          typeInto(pn, p);
        } else {
          richText(pn, p);
        }
        body.appendChild(pn);
      });
      dom.feed.appendChild(post);
      if (!silent) scrollFeed();
      feedHistory.push({ kind: 'block', block });
      return;
    }

    /* — 守则插入 — */
    if (block.type === 'rule') {
      const src = block.rule || block;
      const post = postShell('rule', { who: '守则', chip: '第 ' + src.no + ' 条', time: block.time });
      const body = el('div', 'post__body');
      const line = el('p', 'post__rule-line');
      richText(line, src.text);
      body.appendChild(line);
      body.appendChild(el('span', 'post__src', src.src));
      if (block.extra) body.appendChild(el('span', 'post__src post__src--extra', block.extra));
      post.appendChild(body);
      dom.feed.appendChild(post);
      if (!silent) scrollFeed();
      feedHistory.push({ kind: 'block', block });
      return;
    }

    /* — 系统判定 — */
    if (block.type === 'sys') {
      const post = postShell('sys', { who: '判定', chip: '' });
      if (block.mood === 'ok') post.classList.add('is-ok');
      if (block.mood === 'bad') post.classList.add('is-bad');
      const body = el('div', 'post__body');
      body.appendChild(icon(block.mood === 'ok' ? 'i-check' : block.mood === 'bad' ? 'i-alert' : 'i-bell'));
      body.appendChild(el('span', '', block.text));
      post.appendChild(body);
      dom.feed.appendChild(post);
      if (!silent) scrollFeed();
      feedHistory.push({ kind: 'block', block });
      return;
    }

    /* — 开场印记 — */
    if (block.type === 'stamp') {
      const post = postShell('act', block);
      const body = el('div', 'post__body');
      (block.paras || []).forEach(p => {
        const pn = el('p');
        richText(pn, p);
        body.appendChild(pn);
      });
      post.appendChild(body);
      dom.feed.appendChild(post);
      feedHistory.push({ kind: 'block', block });
      return;
    }

    /* — 结局 — */
    if (block.type === 'ending') {
      const post = el('article', 'post post--ending');
      const head = el('header', 'post__meta');
      head.appendChild(el('span', 'post__who', '交接'));
      head.appendChild(el('span', 'post__chip', '06:00'));
      post.appendChild(head);
      const body = el('div', 'post__body');
      body.appendChild(el('h3', 'ending-title', block.ending.title));
      block.ending.lines.forEach(l => {
        const p = el('p');
        richText(p, l);
        body.appendChild(p);
      });
      post.appendChild(body);
      const wrap = el('div', 'ending-actions');
      const again = el('button', 'btn btn--primary');
      again.type = 'button';
      again.appendChild(icon('i-rewind'));
      again.appendChild(el('span', '', '再值守一晚'));
      again.addEventListener('click', resetNight);
      wrap.appendChild(again);
      post.appendChild(wrap);
      dom.feed.appendChild(post);
      if (!silent) scrollFeed();
      feedHistory.push({ kind: 'block', block });
    }
  }

  function renderPlayerAct(text) {
    const post = postShell('act', { who: '你', chip: '行动' });
    post.appendChild(el('div', 'post__body', text));
    dom.feed.appendChild(post);
    scrollFeed();
    feedHistory.push({ kind: 'act', text });
  }

  function renderResponse(res) {
    res.blocks.forEach(b => renderBlock(b, false));
    const list = (res.choices && res.choices.length) ? res.choices : EchoEngine.choices(S);
    renderChoices(list);
  }

  function renderChoices(list) {
    dom.choices.innerHTML = '';
    (list || []).forEach(c => {
      const btn = el('button', 'choice');
      btn.type = 'button';
      btn.appendChild(icon(c.icon || 'i-chevron'));
      btn.appendChild(el('span', '', c.label));
      btn.addEventListener('click', () => submitAct(c.label));
      dom.choices.appendChild(btn);
    });
  }

  /* ══════════════════════════════════════════════════════
     二、行动提交
     ══════════════════════════════════════════════════════ */

  function submitAct(rawText) {
    const act = String(rawText || '').trim();
    if (!act || S.ending) return;

    const KEYWORDS = /十三|清点|镜|电梯|记录|盐|钥匙|登记簿/;
    renderPlayerAct(act);
    pushTicker(act, KEYWORDS.test(act));

    dom.input.value = '';
    autosize();

    // 用大模型时走异步通道；否则走本地引擎
    if (window.EchoLLM && EchoLLM.available()) {
      runLLMTurn(act, KEYWORDS);
      return;
    }

    runLocalTurn(act, KEYWORDS);
  }

  /* ── 本地引擎回合 ── */
  function runLocalTurn(act, KEYWORDS) {
    const res = EchoEngine.respond(S, act);

    S.timeline = S.timeline || [];
    S.timeline.push({
      time: EchoEngine.clockText(Math.max(0, S.minutes - (res.advanced || 0))),
      text: act,
      key: KEYWORDS.test(act),
      tag: '行动'
    });

    renderResponse(res);
    syncUI();
    save();

    if (res.advanced) {
      pushToast(`夜色推进 ${res.advanced} 分钟 · 现在 ${res.time}`, 'i-clock', '');
    }
  }

  /* ── 大模型回合 ── */
  let llmBusy = false;

  async function runLLMTurn(act, KEYWORDS) {
    if (llmBusy) return;
    llmBusy = true;

    const startedAt = S.minutes;
    const pending = postShell('narr', { who: '值守室', chip: '接收中' });
    const pbody = el('div', 'post__body');
    const pnode = el('p', 'typing');
    pnode.textContent = '';
    pbody.appendChild(pnode);
    pending.appendChild(pbody);
    dom.feed.appendChild(pending);
    scrollFeed();

    const history = S.recentTurns = S.recentTurns || [];
    const messages = EchoLLM.buildMessages(S, act);
    let text = '';

    try {
      text = await EchoLLM.stream({
        messages,
        onDelta: chunk => {
          text += chunk;
          pnode.textContent = plain(text);
          scrollFeed();
        }
      });
    } catch (err) {
      pending.remove();
      // 降级：本地引擎兜底，并明确告诉玩家
      runLocalTurn(act, KEYWORDS);
      pushToast('接口未接通，已用本地引擎继续：' + err.message, 'i-alert', 'warn');
      llmBusy = false;
      return;
    }

    pending.remove();

    const clean = String(text || '').trim();
    if (!clean) {
      runLocalTurn(act, KEYWORDS);
      pushToast('接口返回空内容，已用本地引擎继续。', 'i-alert', 'warn');
      llmBusy = false;
      return;
    }

    history.push({ role: 'user', content: act });
    history.push({ role: 'assistant', content: clean });
    while (history.length > 10) history.shift();

    // 把大模型叙述拆段渲染
    const paras = clean.split(/\n{2,}|\n/).map(x => x.trim()).filter(Boolean);
    renderBlock({ type: 'narr', who: '值守室', chip: '', paras }, false);

    // 引擎继续推进夜色、结算状态
    const res = EchoEngine.respond(S, act);
    // 丢弃本地引擎生成的叙述（已有大模型版），只保留判定与守则块
    const keep = res.blocks.filter(b => b.type === 'sys' || b.type === 'rule' || b.type === 'ending');
    keep.forEach(b => renderBlock(b, false));

    S.timeline = S.timeline || [];
    S.timeline.push({
      time: EchoEngine.clockText(startedAt),
      text: act,
      key: KEYWORDS.test(act),
      tag: '行动'
    });

    renderChoices(EchoEngine.choices(S));
    syncUI();
    save();

    if (res.advanced) {
      pushToast(`夜色推进 ${res.advanced} 分钟 · 现在 ${res.time}`, 'i-clock', '');
    }
    llmBusy = false;
  }

  dom.form.addEventListener('submit', e => {
    e.preventDefault();
    submitAct(dom.input.value);
  });

  dom.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitAct(dom.input.value);
    }
  });

  function autosize() {
    const t = dom.input;
    t.style.height = 'auto';
    t.style.height = Math.min(128, Math.max(26, t.scrollHeight)) + 'px';
  }
  dom.input.addEventListener('input', autosize);

  /* ══════════════════════════════════════════════════════
     三、界面同步
     ══════════════════════════════════════════════════════ */

  function syncUI() {
    const act = EchoEngine.actOf(S.minutes);

    dom.clockTime.textContent = EchoEngine.clockText(S.minutes);
    dom.stripTime.textContent = EchoEngine.clockText(S.minutes);
    dom.clockShift.textContent = EchoEngine.shiftName(S.minutes);
    dom.clockScene.textContent = act.scene;
    dom.sceneLabel.textContent = act.label;

    const pct = Math.min(1, S.minutes / EchoEngine.TOTAL_MINUTES);
    const C = 2 * Math.PI * 66;
    dom.dialProgress.style.strokeDashoffset = String(C * (1 - pct));
    dom.dialHand.style.transform = `rotate(${pct * 360}deg)`;

    dom.valClarity.textContent = String(S.clarity).padStart(2, '0');
    dom.barClarity.style.width = S.clarity + '%';
    dom.valRecords.textContent = String(Math.round(S.records)).padStart(2, '0');
    dom.barRecords.style.width = Math.min(100, S.records) + '%';

    dom.badgeClarityText.textContent = '清醒 ' + S.clarity;
    dom.badgeRulesText.textContent = `守则 ${S.rules.length} / ${RULES.length}`;
    dom.badgeClarity.classList.toggle('badge--accent', S.clarity <= 35);

    const counted = S.flags.counted13 ? '13' : '12';
    dom.valCount.textContent = counted;
    dom.valCountSub.textContent = `最近清点 ${EchoEngine.clockText(S.minutes)} · ${counted} 人`;

    $('#tab-count-rules').textContent = S.rules.length;
    $('#tab-count-residents').textContent = RESIDENTS.length;
    $('#tab-count-items').textContent = ITEMS.filter(i => (S.items[i.id] || 0) > 0).length;

    const rc = $('#rule-known-count');
    if (rc) rc.textContent = S.rules.length;

    renderRules();
    renderResidents();
    renderItems();
    renderTimeline();
  }

  function pushTicker(text, alert) {
    const li = el('li');
    if (alert) li.classList.add('is-alert');
    li.appendChild(el('time', '', EchoEngine.clockText(S.minutes)));
    li.appendChild(el('span', '', text.length > 22 ? text.slice(0, 22) + '…' : text));
    dom.liveLog.prepend(li);
    while (dom.liveLog.children.length > 5) dom.liveLog.lastElementChild.remove();
  }

  /* ══════════════════════════════════════════════════════
     四、在册住户
     ══════════════════════════════════════════════════════ */

  function renderResidents() {
    const grid = dom.residentGrid;
    grid.innerHTML = '';

    const list = RESIDENTS.filter(p => {
      if (residentFilter === 'talked') return !!S.talked[p.id];
      if (residentFilter === 'unlisted') return p.status === 'unlisted';
      return true;
    });

    list.forEach((p, idx) => {
      const card = el('button', 'resident');
      card.type = 'button';
      card.id = 'resident-' + p.id;
      card.style.animationDelay = Math.min(idx * .03, .3) + 's';
      card.setAttribute('aria-label', `查看 ${p.name} 的档案`);

      const top = el('div', 'resident__top');
      top.appendChild(el('div', 'avatar', p.avatar));
      const idw = el('div', 'resident__id');
      const name = el('div', 'resident__name', p.name);
      name.appendChild(el('span', 'resident__no', p.no === '—' ? 'NO. —' : 'NO. ' + p.no));
      idw.appendChild(name);

      const tags = el('div', 'resident__tags');
      p.tags.forEach((t, i) => {
        const cls = p.status === 'unlisted' ? 'tag tag--accent' : i === 0 ? 'tag tag--cool' : 'tag';
        tags.appendChild(el('span', cls, t));
      });
      idw.appendChild(tags);
      top.appendChild(idw);
      card.appendChild(top);

      card.appendChild(el('p', 'resident__line', p.line));

      const foot = el('div', 'resident__foot');
      const talked = !!S.talked[p.id];
      const state = el('span', 'resident__state' + (talked ? ' is-done' : ''));
      state.appendChild(icon(talked ? 'i-check' : 'i-fingerprint'));
      state.appendChild(document.createTextNode(talked ? '已交谈' : '未交谈'));
      foot.appendChild(state);

      const stat = p.status === 'asleep' ? '已休息'
        : p.status === 'out' ? '外出中'
        : p.status === 'unlisted' ? '不在册' : '在屋内';
      foot.appendChild(el('span', 'resident__state' + (p.status === 'unlisted' ? ' is-warn' : ''), stat));
      card.appendChild(foot);

      card.addEventListener('click', () => openResident(p));
      grid.appendChild(card);
    });

    $('#f-count-all').textContent = RESIDENTS.length;
    $('#f-count-talked').textContent = Object.keys(S.talked).length;
    $('#f-count-unlisted').textContent = RESIDENTS.filter(p => p.status === 'unlisted').length;
  }

  function buildKV(rows) {
    const dl = el('dl', 'kv-list');
    rows.forEach(([k, v]) => {
      const kv = el('div', 'kv');
      kv.appendChild(el('dt', '', k));
      kv.appendChild(el('dd', '', v));
      dl.appendChild(kv);
    });
    return dl;
  }

  function openResident(p) {
    const rows = [
      ['性别', p.gender],
      ['年龄', typeof p.age === 'number' ? p.age + ' 岁' : p.age],
      ['职业', p.job],
      ['房号', p.no === '—' ? '登记簿上没有房号' : p.no + ' 室'],
      ['在册', p.status === 'unlisted' ? '不在册（登记簿无此行）' : '在册 · 第 ' + (RESIDENTS.indexOf(p) + 1) + ' 行'],
      ['交谈', S.talked[p.id] ? '今晚已交谈' : '今晚尚未交谈']
    ];

    openModal({
      kicker: '住户档案' + (p.no === '—' ? ' · 无房号' : ' · NO. ' + p.no),
      title: p.name,
      body: (() => {
        const wrap = el('div');

        const head = el('div', 'resident-detail');
        head.appendChild(el('div', 'avatar avatar--lg', p.avatar));
        const info = el('div', 'resident-detail__info');
        info.appendChild(el('div', 'resident-detail__name', p.name));
        const tagRow = el('div', 'resident__tags');
        p.tags.forEach((t, i) => tagRow.appendChild(el('span', i === 0 ? 'tag tag--cool' : 'tag', t)));
        info.appendChild(tagRow);
        head.appendChild(info);
        wrap.appendChild(head);

        wrap.appendChild(el('h3', 'sub-title', '基本资料'));
        wrap.appendChild(buildKV(rows));

        wrap.appendChild(el('h3', 'sub-title', '现场记录'));
        const prose = el('div', 'prose');
        p.detail.forEach(d => prose.appendChild(el('p', '', d)));
        wrap.appendChild(prose);

        wrap.appendChild(el('h3', 'sub-title', '他给你的那半条守则'));
        const box = el('div', 'rule rule--spoken');
        box.appendChild(el('div', 'rule__no', '半'));
        const rc = el('div', 'rule__content');
        rc.appendChild(el('p', 'rule__text', p.rule.text));
        rc.appendChild(el('div', 'rule__src', p.rule.src));
        box.appendChild(rc);
        wrap.appendChild(box);

        const hint = el('p', 'resident-hint');
        hint.appendChild(icon('i-fingerprint'));
        hint.appendChild(document.createTextNode('关键词：' + p.hint));
        wrap.appendChild(hint);

        return wrap;
      })(),
      actions: [
        { label: '在主页面与他说话', icon: 'i-bell', primary: true, onClick: () => {
          closeModal();
          switchView('watch');
          dom.input.value = p.no === '—' ? `去找${p.name}` : `去${p.no}找${p.name}`;
          dom.input.focus();
          autosize();
        } },
        { label: '关闭', icon: 'i-close', onClick: closeModal }
      ]
    });
  }

  /* ══════════════════════════════════════════════════════
     五、物品储藏
     ══════════════════════════════════════════════════════ */

  const KIND_LABEL = { tool: '工具', consume: '消耗品', key: '关键物' };

  function renderItems() {
    const grid = dom.itemGrid;
    grid.innerHTML = '';

    const list = ITEMS.filter(it => itemFilter === 'all' ? true : it.kind === itemFilter.replace('item-', ''));

    list.forEach((it, idx) => {
      const qty = S.items[it.id] || 0;
      const card = el('button', 'item' + (qty === 0 ? ' is-used' : ''));
      card.type = 'button';
      card.id = 'item-' + it.id;
      card.style.animationDelay = Math.min(idx * .025, .25) + 's';
      card.setAttribute('aria-label', `查看 ${it.name}`);

      const head = el('div', 'item__head');
      const ic = el('div', 'item__icon');
      ic.appendChild(icon(it.icon));
      const nm = el('div', 'item__names');
      nm.appendChild(el('div', 'item__name', it.name));
      nm.appendChild(el('div', 'item__kind', KIND_LABEL[it.kind]));
      head.appendChild(ic);
      head.appendChild(nm);
      card.appendChild(head);

      card.appendChild(el('p', 'item__desc', it.desc));

      const bar = el('div', 'item__bar');
      bar.appendChild(el('span', '', qty === 0 ? '已用尽' : '可领用'));
      const q = el('span', 'item__qty');
      q.innerHTML = `存量 <b>${String(qty).padStart(2, '0')}</b> / ${String(it.max).padStart(2, '0')}`;
      bar.appendChild(q);
      card.appendChild(bar);

      card.addEventListener('click', () => openItem(it));
      grid.appendChild(card);
    });

    $('#i-count-all').textContent = ITEMS.length;
  }

  function openItem(it) {
    const qty = S.items[it.id] || 0;
    openModal({
      kicker: '物品档案 · ' + KIND_LABEL[it.kind],
      title: it.name,
      body: (() => {
        const wrap = el('div');
        wrap.appendChild(el('h3', 'sub-title', '登记'));
        wrap.appendChild(buildKV([
          ['类别', KIND_LABEL[it.kind]],
          ['存量', `${qty} / ${it.max}`],
          ['标签', it.tags.join('、')]
        ]));

        wrap.appendChild(el('h3', 'sub-title', '外观与来历'));
        const prose = el('div', 'prose');
        prose.appendChild(el('p', '', it.desc));
        wrap.appendChild(prose);

        wrap.appendChild(el('h3', 'sub-title', '用法'));
        const use = el('div', 'prose');
        use.appendChild(el('p', '', it.use));
        wrap.appendChild(use);
        return wrap;
      })(),
      actions: [
        {
          label: qty > 0 ? '领用到值守台' : '已用尽',
          icon: 'i-check',
          primary: true,
          disabled: qty === 0,
          onClick: () => {
            if ((S.items[it.id] || 0) <= 0) return;
            S.items[it.id] -= 1;
            renderItems();
            pushToast(`已领用：${it.name}（剩余 ${S.items[it.id]}）`, 'i-check', 'ok');
            pushTicker('领用 ' + it.name, false);
            save();
            closeModal();
          }
        },
        { label: '关闭', icon: 'i-close', onClick: closeModal }
      ]
    });
  }

  /* ══════════════════════════════════════════════════════
     六、守则簿
     ══════════════════════════════════════════════════════ */

  const GROUP_META = {
    printed: { title: '墙上印刷', desc: '门厅与楼道里的搪瓷牌、卡纸、油印纸' },
    hand: { title: '红笔补写', desc: '不在墙上，只在某些角度能看见' },
    spoken: { title: '住户口述', desc: '从住户口里问出来的另一半' }
  };

  const CONFLICTS = [
    ['r07', 'r08', '第七条 vs 第八条'],
    ['r03', 'r01', '开门与不锁门'],
    ['r02', 'r12', '电梯停靠规则自相矛盾']
  ];

  function renderRules() {
    const wrap = dom.ruleGroups;
    wrap.innerHTML = '';

    const groups = ruleFilter === 'all' ? ['printed', 'hand', 'spoken'] : [ruleFilter.replace('rule-', '')];

    groups.forEach(g => {
      const meta = GROUP_META[g];
      if (!meta) return;

      const knownInGroup = RULES.filter(r => r.group === g && S.rules.includes(r.id)).length;
      const totalInGroup = RULES.filter(r => r.group === g).length;

      const section = el('section', 'rule-group');
      const head = el('div', 'rule-group__head');
      head.appendChild(el('h3', 'rule-group__title', meta.title));
      head.appendChild(el('span', 'rule-group__meta', `${knownInGroup} / ${totalInGroup} 条已收录`));
      section.appendChild(head);

      const list = el('div', 'rule-list');
      RULES.filter(r => r.group === g).forEach(r => {
        const known = S.rules.includes(r.id);
        const card = el('button', 'rule rule--' + r.group + (known ? '' : ' is-locked'));
        card.type = 'button';
        card.id = 'rule-' + r.id;
        card.appendChild(el('div', 'rule__no', String(r.no).padStart(2, '0')));

        const content = el('div', 'rule__content');
        content.appendChild(el('p', 'rule__text', known ? r.text : '［尚未收录］这条守则还没有进入簿册。'));

        const src = el('div', 'rule__src');
        src.appendChild(el('span', '', known ? r.src : '来源未确认'));
        const conflict = CONFLICTS.find(c => c[0] === r.id || c[1] === r.id);
        if (conflict && known) {
          const cf = el('span', 'rule__conflict');
          cf.appendChild(icon('i-alert'));
          cf.appendChild(document.createTextNode(conflict[2]));
          src.appendChild(cf);
        }
        content.appendChild(src);
        card.appendChild(content);

        card.addEventListener('click', () => openRule(r, known));
        list.appendChild(card);
      });

      section.appendChild(list);
      wrap.appendChild(section);
    });
  }

  function openRule(r, known) {
    const conflict = CONFLICTS.find(c => c[0] === r.id || c[1] === r.id);
    openModal({
      kicker: '守则 · 第 ' + String(r.no).padStart(2, '0') + ' 条',
      title: known ? '守则原文' : '未收录',
      body: (() => {
        const wrap = el('div');
        const box = el('div', 'rule rule--' + r.group);
        box.appendChild(el('div', 'rule__no', String(r.no).padStart(2, '0')));
        const c = el('div', 'rule__content');
        c.appendChild(el('p', 'rule__text', known ? r.text : '［尚未收录］这条守则还没有进入簿册。'));
        c.appendChild(el('div', 'rule__src', known ? r.src : '来源未确认'));
        box.appendChild(c);
        wrap.appendChild(box);

        wrap.appendChild(el('h3', 'sub-title', '出处'));
        wrap.appendChild(buildKV([
          ['类别', GROUP_META[r.group].title],
          ['状态', known ? '已收录' : '待收录'],
          ['条目', String(r.no).padStart(2, '0')]
        ]));

        wrap.appendChild(el('h3', 'sub-title', '值守笔记'));
        const prose = el('div', 'prose');
        prose.appendChild(el('p', '', known ? r.note : '你还不知道这条守则的出处。或许该去问问住户。'));
        wrap.appendChild(prose);

        if (conflict) {
          wrap.appendChild(el('h3', 'sub-title', '冲突提示'));
          const alert = el('p', 'prose');
          alert.innerHTML = `本条与另一条守则<b>互相矛盾</b>：${conflict[2]}。矛盾的守则不会同时为真，却会同时生效。`;
          wrap.appendChild(alert);
        }
        return wrap;
      })(),
      actions: [
        { label: '在主页面引用此条', icon: 'i-scroll', primary: true, onClick: () => {
          closeModal();
          switchView('watch');
          dom.input.value = `关于第${r.no}条守则，我想确认`;
          dom.input.focus();
          autosize();
        } },
        { label: '关闭', icon: 'i-close', onClick: closeModal }
      ]
    });
  }

  /* ══════════════════════════════════════════════════════
     七、值守档案
     ══════════════════════════════════════════════════════ */

  function renderTimeline() {
    const ol = dom.timeline;
    if (!ol) return;
    ol.innerHTML = '';
    const entries = S.timeline || [];
    if (!entries.length) {
      ol.appendChild(el('li', 'tl', '今晚还没有值得记下的事。'));
      return;
    }
    entries.slice().reverse().forEach(e => {
      const li = el('li', 'tl' + (e.key ? ' is-key' : ''));
      li.appendChild(el('div', 'tl__time', e.time));
      const p = el('p', 'tl__text', e.text);
      if (e.tag) p.appendChild(el('span', 'tl__tag', e.tag));
      li.appendChild(p);
      ol.appendChild(li);
    });
  }

  function renderExcerpts() {
    const wrap = dom.excerpts;
    if (!wrap) return;
    wrap.innerHTML = '';
    EXCERPTS.forEach(e => {
      const box = el('article', 'excerpt' + (e.accent ? ' excerpt--accent' : ''));
      const head = el('div', 'excerpt__head');
      head.appendChild(el('b', '', e.label));
      head.appendChild(el('span', '', e.title));
      box.appendChild(head);
      box.appendChild(el('p', 'excerpt__body', e.body));
      wrap.appendChild(box);
    });
  }

  /* ══════════════════════════════════════════════════════
     八、模态框
     ══════════════════════════════════════════════════════ */

  function openModal({ kicker, title, body, actions }) {
    lastFocus = document.activeElement;
    dom.modalKicker.textContent = kicker;
    dom.modalTitle.textContent = title;
    dom.modalBody.innerHTML = '';
    dom.modalBody.appendChild(body);
    dom.modalFoot.innerHTML = '';

    (actions || []).forEach(a => {
      const btn = el('button', a.primary ? 'btn btn--primary' : 'ghost-btn');
      btn.type = 'button';
      btn.appendChild(icon(a.icon || 'i-chevron'));
      btn.appendChild(el('span', '', a.label));
      if (a.disabled) btn.disabled = true;
      btn.addEventListener('click', a.onClick);
      dom.modalFoot.appendChild(btn);
    });

    dom.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => $('#modal-close').focus());
  }

  function closeModal() {
    dom.modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  dom.modal.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (dom.modal.hidden) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Tab') return;
    const f = $$('button:not([disabled]), [href], textarea, input', dom.modal);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ══════════════════════════════════════════════════════
     九、视图路由 + 深链接
     ══════════════════════════════════════════════════════ */

  const VIEWS = ['watch', 'residents', 'storage', 'rules', 'archive'];

  function switchView(name, keepHash) {
    dom.tabs.forEach(t => {
      const on = t.dataset.view === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    dom.views.forEach(v => {
      const on = v.id === 'view-' + name;
      v.classList.toggle('is-active', on);
      v.hidden = !on;
    });
    if (name === 'archive') renderExcerpts();
    if (name === 'watch') setTimeout(() => dom.feed.focus({ preventScroll: true }), 60);
    if (!keepHash) {
      const target = '#/' + name;
      if (location.hash !== target) NATIVE_HISTORY.replaceState(null, '', target);
    }
    window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
  }

  function applyHash() {
    const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    if (!raw) return false;

    if (VIEWS.includes(raw)) { switchView(raw, true); return true; }

    const m = raw.match(/^([rik])-(.+)$/);
    if (m) {
      const kind = m[1], id = m[2];
      switchView(kind === 'r' ? 'residents' : kind === 'i' ? 'storage' : 'rules', true);
      requestAnimationFrame(() => {
        if (kind === 'r') {
          const p = RESIDENTS.find(x => x.id === id);
          if (p) openResident(p);
        } else if (kind === 'i') {
          const it = ITEMS.find(x => x.id === id);
          if (it) openItem(it);
        } else {
          const ru = RULES.find(x => x.id === id);
          if (ru) openRule(ru, S.rules.includes(ru.id));
        }
      });
      return true;
    }
    return false;
  }

  window.addEventListener('hashchange', applyHash);

  dom.tabs.forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  $$('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      const scope = btn.closest('.filter-row');
      $$('.chip', scope).forEach(c => c.classList.toggle('is-on', c === btn));

      if (f.startsWith('item-')) { itemFilter = f; renderItems(); }
      else if (f.startsWith('rule-')) { ruleFilter = f === 'rule-all' ? 'all' : f; renderRules(); }
      else { residentFilter = f; renderResidents(); }
    });
  });

  $$('[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView('watch');
      submitAct(btn.dataset.quick);
    });
  });

  /* ── 重置 ── */
  function resetNight() {
    S = EchoEngine.newState();
    S.timeline = [];
    feedHistory = [];
    dom.feed.innerHTML = '';
    dom.liveLog.innerHTML = '';
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 忽略 */ }
    booting = false;
    bootFeed();
    renderChoices(EchoEngine.choices(S));
    syncUI();
    switchView('watch');
    pushToast('已重置。今晚重新开始。', 'i-rewind', '');
  }
  $('#btn-reset').addEventListener('click', resetNight);

  /* ══════════════════════════════════════════════════════
     十、提示条
     ══════════════════════════════════════════════════════ */

  function pushToast(text, iconId, mood) {
    const t = el('div', 'toast' + (mood ? ' toast--' + mood : ''));
    t.appendChild(icon(iconId || 'i-bell'));
    t.appendChild(document.createTextNode(text));
    dom.toasts.appendChild(t);
    setTimeout(() => {
      t.classList.add('is-out');
      setTimeout(() => t.remove(), 300);
    }, 3200);
  }

  /* ══════════════════════════════════════════════════════
     十一、存档
     ══════════════════════════════════════════════════════ */

  function save() {
    if (booting) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, state: S, history: feedHistory }));
    } catch (e) { /* 存档失败不影响游戏 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1 || !data.state) return false;
      S = Object.assign(EchoEngine.newState(), data.state);
      S.timeline = data.state.timeline || [];
      feedHistory = data.history || [];
      return true;
    } catch (e) { return false; }
  }

  $('#btn-save-archive').addEventListener('click', () => {
    save();
    pushToast('今晚的档案已存入本地。', 'i-save', 'ok');
  });

  /* ══════════════════════════════════════════════════════
     十二、启动
     ══════════════════════════════════════════════════════ */

  function bootFeed() {
    EchoEngine.opening().forEach(b => renderBlock(b, false));
  }

  function replay() {
    feedHistory.forEach(h => {
      if (h.kind === 'act') {
        const post = postShell('act', { who: '你', chip: '行动' });
        post.appendChild(el('div', 'post__body', h.text));
        dom.feed.appendChild(post);
      } else if (h.block) {
        renderBlock(h.block, true);
      }
    });
  }

  function boot() {
    // 表盘刻度
    const ticks = $('#dial-ticks');
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', (80 + Math.cos(a) * 71).toFixed(2));
      line.setAttribute('y1', (80 + Math.sin(a) * 71).toFixed(2));
      line.setAttribute('x2', (80 + Math.cos(a) * 76).toFixed(2));
      line.setAttribute('y2', (80 + Math.sin(a) * 76).toFixed(2));
      ticks.appendChild(line);
    }

    const restored = load();
    S.timeline = S.timeline || [];

    if (restored && feedHistory.length) {
      replay();
      renderChoices(EchoEngine.choices(S));
    } else {
      bootFeed();
      renderChoices(EchoEngine.choices(S));
    }

    syncUI();
    renderExcerpts();
    autosize();
    booting = false;

    if (!applyHash()) switchView('watch', true);

    scrollFeed();
    setTimeout(() => dom.input.focus({ preventScroll: true }), 400);
  }

  boot();
})();
