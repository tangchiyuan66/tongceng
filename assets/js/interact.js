/* ============================================================
   回声公寓 · 交互补充层
   引擎 → 大模型流式叙事的切换、设置模态框、降级兜底
   ============================================================ */

(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const KEY = 'echo-apartment-llm-v1';
  const NATIVE = window.EchoAppBridge;

  /* 由 app.js 暴露的内部接口（通过自定义事件通信，避免全局污染） */
  const bus = {
    getState: null,
    renderNarration: null,
    syncUI: null,
    getSelected: null
  };

  /* ── 与主控层的交接 ───────────────────────────────── */

  document.addEventListener('echo:bridge', e => {
    Object.assign(bus, e.detail || {});
  });

  /* ══════════════════════════════════════════════════
     设置模态框
     ══════════════════════════════════════════════════ */

  function openSettings() {
    const cfg = EchoLLM.load();
    const modal = $('#modal');
    const kicker = $('#modal-kicker');
    const title = $('#modal-title');
    const body = $('#modal-body');
    const foot = $('#modal-foot');

    kicker.textContent = '叙事引擎 · 接入设置';
    title.textContent = '大模型接口';

    body.innerHTML = `
      <p class="prose" style="margin-bottom:20px">
        主页面支持两种叙事引擎。<b>本地引擎</b>离线可玩，按关键词判断，随时能跑；
        <b>大模型引擎</b>接任意 OpenAI 兼容接口，回应会真正围绕你说的话展开。
        接口密钥只存在你这台机器的 localStorage 里，不会发往除你自己配置的接口之外的任何地方。
      </p>

      <div class="setting-row">
        <label class="setting-label" for="llm-enabled">启用大模型叙事</label>
        <div class="setting-control">
          <label class="switch">
            <input type="checkbox" id="llm-enabled" ${cfg.enabled ? 'checked' : ''}>
            <span class="switch__track"><span class="switch__dot"></span></span>
          </label>
        </div>
      </div>

      <div class="setting-row">
        <label class="setting-label" for="llm-base">接口地址</label>
        <div class="setting-control">
          <input class="field" id="llm-base" type="url" value="${escapeAttr(cfg.baseUrl)}"
                 placeholder="https://api.openai.com/v1/chat/completions" spellcheck="false">
          <p class="field-hint">填到 /chat/completions 为止。兼容 DeepSeek、通义、Kimi、Ollama、LM Studio 等。</p>
        </div>
      </div>

      <div class="setting-row">
        <label class="setting-label" for="llm-model">模型名</label>
        <div class="setting-control">
          <input class="field" id="llm-model" type="text" value="${escapeAttr(cfg.model)}"
                 placeholder="gpt-4o-mini" spellcheck="false">
          <p class="field-hint">必须与接口支持的模型标识完全一致。</p>
        </div>
      </div>

      <div class="setting-row">
        <label class="setting-label" for="llm-key">接口密钥</label>
        <div class="setting-control">
          <input class="field" id="llm-key" type="password" value="${escapeAttr(cfg.apiKey)}"
                 placeholder="sk-..." autocomplete="off" spellcheck="false">
          <p class="field-hint">本地模型（Ollama / LM Studio）可填任意非空字符串。</p>
        </div>
      </div>

      <div class="setting-row">
        <label class="setting-label" for="llm-temp">温度</label>
        <div class="setting-control">
          <input class="field" id="llm-temp" type="number" min="0" max="2" step="0.1" value="${cfg.temperature}">
          <p class="field-hint">怪谈叙事建议 0.8 — 1.0：太低会重复，太高会散。</p>
        </div>
      </div>

      <div class="setting-status" id="llm-status" role="status">当前状态：${EchoLLM.available() ? '已启用大模型叙事' : '使用本地叙事引擎'}</div>
    `;

    foot.innerHTML = '';

    const mk = (label, iconId, primary, handler, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = primary ? 'btn btn--primary' : 'ghost-btn';
      b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${iconId}"></use></svg><span></span>`;
      b.querySelector('span').textContent = label;
      if (disabled) b.disabled = true;
      b.addEventListener('click', handler);
      foot.appendChild(b);
      return b;
    };

    mk('测试连通', 'i-radio', false, async () => {
      const status = $('#llm-status');
      status.textContent = '正在请求…';
      status.className = 'setting-status is-busy';
      collect(cfg);
      if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
        status.textContent = '地址、模型名、密钥三项都要填完才能测试。';
        status.className = 'setting-status is-bad';
        return;
      }
      EchoLLM.save(cfg);
      try {
        const reply = await EchoLLM.test();
        status.textContent = '连通成功。接口回复：' + String(reply).trim().slice(0, 40);
        status.className = 'setting-status is-ok';
      } catch (err) {
        status.textContent = '连通失败：' + err.message;
        status.className = 'setting-status is-bad';
      }
    });

    mk('保存并启用', 'i-check', true, () => {
      collect(cfg);
      EchoLLM.save(cfg);
      const status = $('#llm-status');
      status.textContent = EchoLLM.available()
        ? '已保存。下一条行动开始，叙事由大模型接管。'
        : '已保存，但配置不完整，仍在使用本地引擎。';
      status.className = EchoLLM.available() ? 'setting-status is-ok' : 'setting-status is-bad';
      refreshEngineBadge();
      document.dispatchEvent(new CustomEvent('echo:engine-change'));
    });

    mk('清除配置', 'i-close', false, () => {
      EchoLLM.clear();
      Object.assign(cfg, EchoLLM.DEFAULTS);
      openSettings();
      refreshEngineBadge();
    });

    mk('关闭', 'i-close', false, () => closeModal());

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => $('#llm-enabled').focus());

    function collect(target) {
      target.enabled = $('#llm-enabled').checked;
      target.baseUrl = $('#llm-base').value.trim();
      target.model = $('#llm-model').value.trim();
      target.apiKey = $('#llm-key').value.trim();
      target.temperature = parseFloat($('#llm-temp').value) || 0.9;
    }

    function closeModal() {
      modal.hidden = true;
      document.body.style.overflow = '';
    }
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── 报头上的引擎指示 ── */
  function refreshEngineBadge() {
    const el = $('#engine-badge');
    if (!el) return;
    const on = EchoLLM.available();
    el.classList.toggle('badge--accent', on);
    el.querySelector('span').textContent = on ? '大模型叙事' : '本地叙事';
    el.title = on ? '叙事由已配置的大模型接口生成' : '未配置接口，使用内置本地引擎';
  }

  /* ── 设置入口：报头徽标 + 报头按钮 ── */
  document.addEventListener('DOMContentLoaded', () => {
    refreshEngineBadge();
    const btn = $('#btn-engine');
    if (btn) btn.addEventListener('click', openSettings);
    const badge = $('#engine-badge');
    if (badge) {
      badge.style.cursor = 'pointer';
      badge.addEventListener('click', openSettings);
    }
  });

  document.addEventListener('echo:engine-change', refreshEngineBadge);

  window.EchoSettings = { open: openSettings, refresh: refreshEngineBadge };
})();
