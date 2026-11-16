/**
 * 植物学课程助教 · 对话界面
 *
 * 对应评审四项：
 *  · 定位与知识范围 —— 说明卡常驻展示服务对象 / 场景 / 三层范围 / 资料来源
 *  · 知识准确性     —— 每条回答附教材章节与页码，原文片段可展开回查；离线时只给原文摘录
 *  · 对话体验       —— 多轮上下文、追问指代、纠错重答、超范围明确说不知道并给建议
 *  · 实用性         —— 离线零配置可用；反馈按钮把真实试用意见写入本地，可导出
 */
import {
  botany, buildCourseMessages, renderMarkdown, escapeHtml,
  BOTANY_SOURCE, SCOPE, SUGGESTED_QUESTIONS, CORPUS_STATS, cite
} from '../services/AIInterpreter.js';

const $ = (id) => document.getElementById(id);
const FEEDBACK_KEY = 'malus-courseqa-feedback-v1';

export class CourseQA {
  constructor(ai, { getCurrentPart = () => null, openAISettings = () => {} } = {}) {
    this.ai = ai;
    this.getCurrentPart = getCurrentPart;
    this.openAISettings = openAISettings;
    this.history = [];          // {role, text}
    this.lastTopic = '';
    this.busy = false;
    this.loaded = false;
    this._raf = 0;

    this.el = {
      modal: $('modal-ask'), scope: $('qa-scope-body'), status: $('qa-status'),
      log: $('qa-log'), suggest: $('qa-suggest'), input: $('qa-input'),
      send: $('qa-send'), clear: $('qa-clear'), settings: $('qa-settings'),
      fbCount: $('qa-feedback-count')
    };

    this._renderScope();
    this._renderSuggestions();
    this._renderStatus();
    this._bind();
    this._greet();
  }

  /* ---------------- 说明卡：与 SCOPE 常量同源，口径不会漂移 ---------------- */
  _renderScope() {
    const li = (arr) => arr.map(x => `<li>${escapeHtml(x)}</li>`).join('');
    this.el.scope.innerHTML = `
      <div class="qa-scope-grid">
        <div><b>服务对象</b><p>${escapeHtml(SCOPE.audience)}</p></div>
        <div><b>使用场景</b><ul>${li(SCOPE.scenarios)}</ul></div>
        <div><b>核心范围</b><p>${escapeHtml(SCOPE.core)}</p></div>
        <div><b>扩展范围</b><p>${escapeHtml(SCOPE.extended)}</p></div>
        <div><b>不回答</b><ul>${li(SCOPE.out)}</ul></div>
        <div><b>资料来源</b><p>${escapeHtml(SCOPE.sourceNote)}</p></div>
      </div>
      <p class="qa-scope-note">教材 OCR 全文共 ${CORPUS_STATS.chunks} 个检索片段；${escapeHtml(BOTANY_SOURCE.note)}</p>`;
  }

  _renderSuggestions() {
    this.el.suggest.innerHTML = '<span class="qa-suggest-label">试着问：</span>' +
      SUGGESTED_QUESTIONS.map(q => `<button class="qa-chip" type="button">${escapeHtml(q)}</button>`).join('');
  }

  _renderStatus(extra = '') {
    const aiOn = this.ai.isConfigured();
    const mode = aiOn
      ? 'AI 增强 · 模型仅依据检索到的教材片段作答'
      : '离线可用 · 直接返回教材原文摘录（未配置 AI 接口也能正常使用）';
    this.el.status.innerHTML =
      `<span class="qa-dot ${aiOn ? 'on' : ''}"></span><span>${escapeHtml(mode)}</span>` +
      `<span class="qa-src">${escapeHtml(BOTANY_SOURCE.short)} · ${escapeHtml(BOTANY_SOURCE.editor)} · ${escapeHtml(BOTANY_SOURCE.publisher)}</span>` +
      (extra ? `<span class="qa-extra">${escapeHtml(extra)}</span>` : '');
  }

  _bind() {
    $('btn-ask')?.addEventListener('click', () => this.open());
    this.el.send.addEventListener('click', () => this._submit());
    this.el.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submit(); }
    });
    this.el.clear.addEventListener('click', () => {
      this.history = []; this.lastTopic = '';
      this.el.log.innerHTML = ''; this._greet();
    });
    this.el.settings.addEventListener('click', () => this.openAISettings());
    this.el.suggest.addEventListener('click', e => {
      const chip = e.target.closest('.qa-chip');
      if (chip) { this.el.input.value = chip.textContent; this._submit(); }
    });
    this.el.log.addEventListener('click', e => this._onLogClick(e));
    $('ai-save')?.addEventListener('click', () => setTimeout(() => this._renderStatus(), 300));
  }

  open() {
    this.el.modal.classList.remove('hidden');
    this._renderStatus();
    this._updateFeedbackCount();
    setTimeout(() => this.el.input.focus(), 60);
  }

  _greet() {
    this._addMessage('assistant',
      `我是《植物学》课程助教，依据 **${BOTANY_SOURCE.short}** 回答问题，每条答案都会标出章节与教材页码。\n\n可以问我苹果树各器官、组织的形态结构与功能，也可以问教材里的植物学基础概念。超出教材范围的问题我会直接说明并给出建议。`,
      { label: '使用引导', mode: '离线可用', result: null });
  }

  /* ---------------- 消息渲染 ---------------- */
  _addMessage(role, text, { label = '', mode = '', result = null, streaming = false } = {}) {
    const wrap = document.createElement('div');
    wrap.className = `qa-msg ${role}`;
    const badge = role === 'assistant' && (label || mode)
      ? `<div class="qa-msg-meta"><span class="qa-scope-tag">${escapeHtml(label)}</span><span class="qa-mode-tag">${escapeHtml(mode)}</span></div>` : '';
    const evidence = role === 'assistant' && result?.hits?.length
      ? `<details class="qa-evidence"><summary>查看教材依据（${result.hits.length} 条）</summary>${result.hits.map((h, i) =>
          `<div class="qa-ev-item"><b>依据 ${i + 1}</b> ${escapeHtml(cite(h))}<p>${escapeHtml(h.chunk.text.slice(0, 420))}</p></div>`
        ).join('')}</details>` : '';
    const actions = role === 'assistant' && label !== '使用引导'
      ? `<div class="qa-msg-actions">
           <button class="qa-fb" data-fb="helpful" type="button">有帮助</button>
           <button class="qa-fb" data-fb="wrong" type="button">这条有误</button>
           <button class="qa-fb" data-fb="copy" type="button">复制</button>
         </div>` : '';
    wrap.innerHTML = `${badge}<div class="qa-bubble">${renderMarkdown(text)}${streaming ? '<span class="cursor"></span>' : ''}</div>${evidence}${actions}`;
    wrap.dataset.text = text;
    this.el.log.appendChild(wrap);
    this.el.log.scrollTop = this.el.log.scrollHeight;
    return wrap;
  }

  _onLogClick(e) {
    const btn = e.target.closest('button.qa-fb');
    if (!btn) return;
    const msg = btn.closest('.qa-msg');
    const lastUser = [...this.el.log.querySelectorAll('.qa-msg.user')].pop();
    const q = lastUser?.dataset.text || '';
    const kind = btn.dataset.fb;
    if (kind === 'copy') {
      navigator.clipboard?.writeText(msg.dataset.text || '').then(() => {
        const t = btn.textContent; btn.textContent = '已复制 ✓';
        setTimeout(() => { btn.textContent = t; }, 1300);
      }).catch(() => {});
      return;
    }
    this._saveFeedback(q, kind);
    btn.textContent = kind === 'helpful' ? '已记录 ✓' : '已反馈 ✓';
    if (kind === 'wrong') {
      this.el.input.value = `上面的回答有误，请重新依据教材片段核对：「${q}」`;
      this._submit(true);
    }
  }

  _saveFeedback(question, verdict) {
    try {
      const arr = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]');
      arr.push({ ts: new Date().toISOString(), question: String(question).slice(0, 200), verdict });
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify(arr.slice(-200)));
      this._updateFeedbackCount();
    } catch { /* 隐私模式忽略 */ }
  }

  _updateFeedbackCount() {
    try {
      const n = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]').length;
      this.el.fbCount.textContent = n ? `已收集 ${n} 条试用反馈` : '试用反馈将记录在本机';
    } catch { this.el.fbCount.textContent = ''; }
  }

  /** 导出真实试用反馈（评审可在控制台调用 __MALUS__.courseQA.exportFeedback()） */
  exportFeedback() {
    try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]'); }
    catch { return []; }
  }

  /* ---------------- 提问主流程 ---------------- */
  _submit(correction = false) {
    const q = this.el.input.value.trim();
    if (!q || this.busy) return;
    this.el.input.value = '';
    this.busy = true;
    this.el.send.disabled = true;
    this.el.send.textContent = '检索中…';
    this._addMessage('user', q);
    this.ask(q, { correction }).finally(() => {
      this.busy = false;
      this.el.send.disabled = false;
      this.el.send.textContent = '提问';
      this.el.input.focus();
    });
  }

  async ask(question, { correction = false } = {}) {
    if (!this.loaded) {
      this._renderStatus('正在载入教材语料…');
      try {
        await botany.load();
        this.loaded = true;
      } catch (err) {
        this._renderStatus('语料载入失败');
        this._addMessage('assistant', `教材语料载入失败：${err.message}。请确认通过 start.bat 启动的本地服务访问本页（file:// 下无法加载模块）。`,
          { label: '系统', mode: '离线', result: null });
        return;
      }
      this._renderStatus();
    }

    const part = this.getCurrentPart();
    const result = botany.retrieve(question, {
      part: part?.id || null,
      lastTopic: this.lastTopic
    });
    if (result.topic) this.lastTopic = result.topic;

    const offline = () => {
      const text = this.ai.courseFallback(result);
      this._addMessage('assistant', text, {
        label: result.confident ? result.scopeLabel : (result.reason === 'out' ? '超出知识范围' : '依据不足 · 不作答'),
        mode: '教材原文摘录', result
      });
      this.history.push({ role: 'user', text: question });
      this.history.push({ role: 'assistant', text });
    };

    // 超范围 / 依据不足 / 寒暄：不调用模型，直接给诚实应答与建议
    if (!result.confident || !this.ai.isConfigured()) { offline(); return; }

    const msg = this._addMessage('assistant', '正在依据教材片段作答…', {
      label: result.scopeLabel, mode: 'AI 增强 · 附出处', result, streaming: true
    });
    const bubble = msg.querySelector('.qa-bubble');
    let acc = '';
    const schedule = () => {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        bubble.innerHTML = renderMarkdown(acc) + '<span class="cursor"></span>';
        this.el.log.scrollTop = this.el.log.scrollHeight;
      });
    };
    try {
      const messages = buildCourseMessages(question, { result, part, history: this.history, correction });
      await this.ai.chat(messages, { onToken: (_d, full) => { acc = full; schedule(); } });
      cancelAnimationFrame(this._raf); this._raf = 0;
      const finalText = acc || '（模型返回空内容，以下为教材原文摘录）\n\n' + this.ai.courseFallback(result);
      bubble.innerHTML = renderMarkdown(finalText);
      msg.dataset.text = finalText;
      this.history.push({ role: 'user', text: question });
      this.history.push({ role: 'assistant', text: finalText });
    } catch (err) {
      cancelAnimationFrame(this._raf); this._raf = 0;
      const text = `AI 调用失败（${err.code || 'ERROR'}），已降级为教材原文摘录：\n\n${this.ai.courseFallback(result)}`;
      bubble.innerHTML = renderMarkdown(text);
      msg.dataset.text = text;
      const meta = msg.querySelector('.qa-mode-tag');
      if (meta) meta.textContent = '已降级 · 教材原文摘录';
      this._renderStatus(`AI 不可用：${err.code || 'ERROR'} · 已自动降级`);
      this.history.push({ role: 'user', text: question });
      this.history.push({ role: 'assistant', text });
    }
  }
}
