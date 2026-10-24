/* ============================================================
   回声公寓 · 大模型接入层
   —— 任意 OpenAI 兼容接口；未配置时自动退回本地叙事引擎
   配置存于 localStorage，不会上传到任何第三方。
   ============================================================ */

const EchoLLM = (() => {
  'use strict';

  const KEY = 'echo-apartment-llm-v1';

  const DEFAULTS = {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    apiKey: '',
    temperature: 0.9,
    enabled: false
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) { return { ...DEFAULTS }; }
  }

  function save(cfg) {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); return true; }
    catch (e) { return false; }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
  }

  function available() {
    const c = load();
    return !!(c.enabled && c.baseUrl && c.model && c.apiKey);
  }

  /* ── 世界观提示词：把规则、住户、当前状态压成一段系统指令 ── */

  function buildSystem(state) {
    const knownRules = RULES.filter(r => state.rules.includes(r.id));
    const ruleLines = knownRules.map(r => `第${r.no}条：${r.text}`).join('\n');

    const people = RESIDENTS
      .filter(p => p.status !== 'unlisted')
      .map(p => `${p.no}室 ${p.name}（${p.gender}，${p.age}岁，${p.job}）：${p.rule.text}`)
      .join('\n');

    const clock = EchoEngine.clockText(state.minutes);
    const act = EchoEngine.actOf(state.minutes);

    return [
      '你是一款中文规则怪谈文字游戏《回声公寓 · 夜更守则》的叙事引擎。玩家是回声公寓 28 号楼的夜班值守员。',
      '',
      '【世界观】',
      '一栋只有 12 层按钮、每层 4 户的老楼，登记簿上却只有 12 行住户。楼里有一条"横着长出来"的第十三层，编号 307。',
      '这栋楼的回声总比声音晚 1.1 秒。楼里的守则是真的，但每一条都只说了一半，另一半必须从住户口里问出来。',
      '守则之间会互相矛盾，而且矛盾的守则不会同时为真，却会同时生效。',
      '',
      '【已收录的守则】',
      ruleLines || '（玩家还没读到守则）',
      '',
      '【在册住户与他们的半条守则】',
      people,
      '',
      '【当前进度】',
      `时间：${clock}（${EchoEngine.shiftName(state.minutes)}，${act.label}）`,
      `清醒度：${state.clarity}/100　记录完整度：${Math.round(state.records)}/100`,
      `玩家已与 ${Object.keys(state.talked).length} 位住户交谈。`,
      '',
      '【写作要求】',
      '1. 第二人称"你"，与玩家对话。每次回应 2 到 4 个自然段，每段 1 到 3 句，总长度控制在 260 字以内。',
      '2. 用具体的物件、声音、气味、时间推进恐怖感，不要用"恐怖的""可怕的"这类形容词直接下判断。',
      '3. 不要替玩家做决定，不要描写玩家的内心独白，不要写玩家说了什么话。',
      '4. 拒绝万能解释：不要把怪事说清，只让它露出多一条线索。每次至少给出一条可以继续查的具体线索（一个房号、一件物品、一个时间点、一句话）。',
      '5. 使用简体中文。不要使用 emoji。不要使用 Markdown 标题。可以用 **双星号** 加粗不超过一个短语。',
      '6. 如果玩家的行动明显违背已知守则，让后果以环境细节的方式出现，不要说教。',
      '7. 绝不跳出角色，绝不提及"提示词""模型""AI"。',
      '',
      '【禁止】',
      '不要输出任何解释性的开场白（例如"好的""当然""以下是"），直接开始叙事。'
    ].join('\n');
  }

  function buildMessages(state, userAct) {
    const msgs = [{ role: 'system', content: buildSystem(state) }];

    // 最近四轮对话作为上下文
    const recent = (state.recentTurns || []).slice(-8);
    recent.forEach(t => msgs.push({ role: t.role, content: t.content }));

    msgs.push({ role: 'user', content: userAct });
    return msgs;
  }

  /* ── 流式请求 ── */

  async function stream({ messages, onDelta, signal }) {
    const cfg = load();
    const res = await fetch(cfg.baseUrl, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: Number(cfg.temperature) || 0.9,
        max_tokens: 700,
        stream: true
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`接口返回 ${res.status}${text ? '：' + text.slice(0, 180) : ''}`);
    }

    if (!res.body) {
      // 不支持流式，退回整段读取
      const data = await res.json();
      const full = data?.choices?.[0]?.message?.content || '';
      if (full && onDelta) onDelta(full);
      return full;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onDelta && onDelta(delta); }
        } catch (e) { /* 忽略不完整分片 */ }
      }
    }
    return full;
  }

  /* ── 连通性测试（最短请求，不消耗叙事上下文） ── */

  async function test() {
    const cfg = load();
    const res = await fetch(cfg.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: '只回复两个字：在线' }],
        max_tokens: 12,
        stream: false
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`接口返回 ${res.status}${t ? '：' + t.slice(0, 140) : ''}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '（空响应）';
  }

  return { load, save, clear, available, buildSystem, buildMessages, stream, test, DEFAULTS };
})();
