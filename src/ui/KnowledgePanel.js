import { getKnowledge } from '../data/knowledge.js';
import {
  renderMarkdown, escapeHtml, botany, BOTANY_SOURCE,
  formatEvidence, cite, buildOfflineAnswer, buildCourseMessages
} from '../services/AIInterpreter.js';

const $ = (id) => document.getElementById(id);
const stripHtml = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export class KnowledgePanel {
  constructor(ai, callbacks = {}) {
    this.ai = ai;
    this.cb = callbacks;
    this.part = null;
    this.knowledge = null;
    this.tab = 'botany';
    this.aiState = 'idle';
    this._aiText = '';
    this._pending = false;
    this._raf = 0;
    // 课本解读里的追问上下文（与课程助教同源，但独立于助教按钮）
    this._aiHistory = [];
    this.lastTopic = '';
    this._followBusy = false;

    this.el = {
      root: $('knowledge'), empty: $('kn-empty'), content: $('kn-content'),
      crumb: $('kn-crumb'), index: $('kn-index'), title: $('kn-title'),
      latin: $('kn-latin'), tags: $('kn-tags'), summary: $('kn-summary'),
      metrics: $('kn-metrics'), tabs: $('kn-tabs'), panels: $('kn-panels'),
      uuid: $('kn-uuid'), recam: $('kn-recam'), close: $('kn-close')
    };

    this.el.close.addEventListener('click', () => { this.hide(); this.cb.onClose?.(); });
    this.el.recam.addEventListener('click', () => {
      if (this.part) this.cb.onRecam?.(this.part);
    });
    this.el.tabs.addEventListener('click', e => {
      const btn = e.target.closest('button[data-tab]');
      if (btn) this.setTab(btn.dataset.tab);
    });
  }

  /** 运镜结束后调用：填充并淡入 */
  show(part) {
    if (!part) return;
    if (this.aiState === 'streaming' || this.aiState === 'loading') this.ai.abort();
    this.part = part;
    this.knowledge = getKnowledge(part.id);
    this.aiState = 'idle';
    this._aiText = '';
    this._aiHistory = [];
    this.lastTopic = '';
    this._followBusy = false;

    this.el.empty.classList.add('hidden');
    this.el.content.classList.remove('hidden');
    this.el.root.classList.add('focus-glow');

    const groupName = {
      root: '地下根系', trunk: '主干轴体', branch: '冠层分枝', leaf: '叶器',
      bud: '芽', flower: '花器', fruit: '果实'
    }[part.group] || '器官';
    this.el.crumb.textContent = `MALUS DOMESTICA / ${groupName} / ${part.index.toString().padStart(2, '0')}`;
    this.el.index.textContent = String(part.index).padStart(2, '0');
    this.el.title.textContent = part.label;
    this.el.latin.textContent = part.latin || '—';
    this.el.tags.innerHTML = (part.tags || []).map((t, i) =>
      `<span class="kn-tag ${i % 3 === 1 ? 'warm' : ''}">${escapeHtml(t)}</span>`).join('');
    this.el.summary.textContent = part.summary || this.knowledge.summary || '';
    this.el.metrics.innerHTML = (part.metrics || []).map(m =>
      `<div class="kn-metric"><b>${escapeHtml(m.k)}</b><span>${escapeHtml(m.v)}</span></div>`).join('');
    this.el.uuid.textContent = `UUID ${part.uuid.slice(0, 8).toUpperCase()} · ${part.objects.length} INSTANCE${part.objects.length === 1 ? '' : 'S'}`;

    this._buildPanels();
    this.setTab('botany');
    // 重新触发入场动画
    this.el.content.style.animation = 'none';
    void this.el.content.offsetHeight;
    this.el.content.style.animation = '';
    window.dispatchEvent(new CustomEvent('malus:knowledge', { detail: { state: 'show', part } }));
  }

  hide() {
    this.el.empty.classList.remove('hidden');
    this.el.content.classList.add('hidden');
    this.el.root.classList.remove('focus-glow');
    this.el.panels.innerHTML = '';
    if (this.aiState === 'streaming' || this.aiState === 'loading') this.ai.abort();
    this.aiState = 'idle';
    window.dispatchEvent(new CustomEvent('malus:knowledge', { detail: { state: 'hide' } }));
  }

  _buildPanels() {
    const k = this.knowledge;
    const warn = k.caveat ? `<div class="kn-warn"><b>建模 / 适用性说明：</b>${escapeHtml(k.caveat)}</div>` : '';
    const refs = (k.refs || []).length
      ? `<div class="kn-refs"><h5>REFERENCE / 参考依据</h5>${k.refs.map(r => `<p>· ${r}</p>`).join('')}</div>` : '';

    this.el.panels.innerHTML = `
      <div class="kn-panel" data-panel="botany">${k.botany || '<p>暂无条目。</p>'}${warn}${refs}</div>
      <div class="kn-panel hidden" data-panel="physiology">${k.physiology || '<p>暂无条目。</p>'}${warn}</div>
      <div class="kn-panel hidden" data-panel="horticulture">${k.horticulture || '<p>暂无条目。</p>'}
        <div class="kn-warn"><b>农事提示：</b>所有农药、肥料与植物生长调节剂均须按当地登记标签、安全间隔期与农技部门意见执行；上述参数为通用范围，需按品种、砧木、树龄、土壤与气候校正。</div>
        ${refs}</div>
      <div class="kn-panel hidden" data-panel="ai">
        <div class="ai-head">
          <div class="ai-state ${this.ai.isConfigured() ? 'on' : ''}" id="ai-state"><i></i><span id="ai-state-text">${this.ai.isConfigured() ? 'AI 接口已就绪 · 依据教材片段' : '离线可用 · 教材原文摘录'}</span></div>
          <button class="btn primary" id="ai-run">生成课本解读</button>
        </div>
        <div class="ai-output" id="ai-output">点击「生成课本解读」，系统会先从 ${escapeHtml(BOTANY_SOURCE.short)} 全文检索本部位对应的教材原文，再据此组织形态、生理与园艺分析；每条结论都标注章节与教材页码。
生成后可在下方继续追问，追问同样只依据教材，并会记住本部位与上一轮对话。</div>
        <div class="ai-thread" id="ai-thread"></div>
        <div class="ai-follow-quick" id="ai-follow-quick">
          <button type="button" data-q="它有什么作用？">它有什么作用？</button>
          <button type="button" data-q="教材哪一节讲到它？">教材哪一节讲到它？</button>
          <button type="button" data-q="举一个相关的代表植物">举一个代表植物</button>
        </div>
        <div class="ai-follow-row">
          <input id="ai-follow-input" type="text" placeholder="继续追问，例如：为什么气孔多在下表皮？" autocomplete="off" />
          <button class="btn primary" id="ai-follow-send" type="button">追问</button>
        </div>
        <div class="ai-actions">
          <button class="btn ghost" id="ai-copy">复制全文</button>
          <button class="btn ghost" id="ai-settings">接口设置</button>
        </div>
        <div class="ai-source" id="ai-source"></div>
      </div>`;

    $('ai-run').addEventListener('click', () => this.runAI());
    $('ai-copy').addEventListener('click', () => this._copy());
    $('ai-settings').addEventListener('click', () => this.cb.onAISettings?.());
    $('ai-follow-send').addEventListener('click', () => {
      const input = $('ai-follow-input');
      this.askFollow(input.value);
      input.value = '';
    });
    $('ai-follow-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.askFollow(e.target.value);
        e.target.value = '';
      }
    });
    $('ai-follow-quick').addEventListener('click', e => {
      const btn = e.target.closest('button[data-q]');
      if (btn) this.askFollow(btn.dataset.q);
    });
  }

  setTab(tab) {
    this.tab = tab;
    this.el.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this.el.panels.querySelectorAll('.kn-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
    this.el.panels.scrollTop = 0;
    if (tab === 'ai' && this.aiState === 'idle' && !this._aiText) {
      // 保持空白，等待用户主动触发
    }
  }

  _setState(state, text) {
    this.aiState = state;
    const badge = $('ai-state'), label = $('ai-state-text'), btn = $('ai-run');
    if (!badge || !label || !btn) return;
    badge.classList.toggle('on', state === 'streaming' || state === 'done' || state === 'ready');
    label.textContent = text;
    btn.disabled = state === 'loading' || state === 'streaming';
    btn.textContent = (state === 'loading' || state === 'streaming') ? '检索教材中…' : '重新解读';
  }

  _renderOutput(text, streaming = false) {
    const out = $('ai-output');
    if (!out) return;
    out.innerHTML = renderMarkdown(text) + (streaming ? '<span class="cursor"></span>' : '');
    out.scrollTop = out.scrollHeight;
  }

  /** 先检索教材：返回该部位对应的课本原文片段（唯一事实依据） */
  async _retrieveTextbook() {
    await botany.load();
    const q = `${this.part.label} 形态结构 功能`;
    return botany.retrieve(q, { part: this.part.id, topK: 4 });
  }

  /** 教材原文摘录 + 出处；无可靠片段时诚实说明，不用内置条目冒充课本 */
  _textbookExtract(result) {
    if (result?.confident && result.hits.length) {
      const lines = [
        `依据 ${BOTANY_SOURCE.short}，教材中与「${this.part.label}」直接相关的原文如下（按相关度排序）：`,
        ''
      ];
      result.hits.forEach((h, i) => {
        lines.push(`【${i + 1}】${h.chunk.text.slice(0, 360)}`);
        lines.push(`　依据：${cite(h)}`);
        lines.push('');
      });
      lines.push('— 以上为教材原文摘录，未做改写。可继续在课程助教中追问此部位。');
      return lines.join('\n');
    }
    return [
      `教材全文中暂未检索到与「${this.part.label}」直接对应的可靠片段，因此不给出解读，避免凭空补充。`,
      '',
      '建议：换用教材中的规范术语（如「维管形成层」「栅栏组织」），或到顶栏「课程助教问答」中提问；涉及具体农事参数请查当地规程或请教老师。'
    ].join('\n');
  }

  /** 在解读面板内追加一条追问消息 */
  _appendFollow(role, text, { meta = '', result = null, streaming = false } = {}) {
    const thread = $('ai-thread');
    if (!thread) return null;
    const wrap = document.createElement('div');
    wrap.className = `ai-follow-msg ${role}`;
    const evidence = role === 'assistant' && result?.hits?.length
      ? `<details class="ai-follow-ev"><summary>教材依据（${result.hits.length}）</summary>${result.hits.map((h, i) =>
          `<p><b>${i + 1}</b> ${escapeHtml(cite(h))}<br>${escapeHtml(h.chunk.text.slice(0, 300))}</p>`).join('')}</details>`
      : '';
    wrap.innerHTML =
      (meta ? `<div class="ai-follow-meta">${escapeHtml(meta)}</div>` : '') +
      `<div class="ai-follow-bubble">${renderMarkdown(text)}${streaming ? '<span class="cursor"></span>' : ''}</div>` +
      evidence;
    wrap.dataset.text = text;
    thread.appendChild(wrap);
    thread.scrollTop = thread.scrollHeight;
    return wrap;
  }

  _followDone() {
    this._followBusy = false;
    const btn = $('ai-follow-send');
    if (btn) { btn.disabled = false; btn.textContent = '追问'; }
  }

  /**
   * 课本解读内的追问：与课程助教共用教材检索 + 同一套提示词规则。
   * 助教按钮与课程助教面板完全独立，互不影响。
   */
  async askFollow(raw) {
    if (!this.part || this._followBusy) return;
    const q = String(raw || '').trim();
    if (!q) return;
    this._followBusy = true;
    const btn = $('ai-follow-send');
    if (btn) { btn.disabled = true; btn.textContent = '检索中…'; }
    this._appendFollow('user', q);

    let result;
    try {
      await botany.load();
      result = botany.retrieve(q, { part: this.part.id, lastTopic: this.lastTopic, topK: 4 });
      // 指代消解后把实际检索式显示出来，让用户看到「它」被理解成了哪个器官
      if (result.resolvedQuery && result.resolvedQuery !== q) {
        const prefix = `<div class="ai-follow-resolve">已理解为：${escapeHtml(result.resolvedQuery)}</div>`;
        const threads = $('ai-thread');
        const last = threads?.lastElementChild;
        if (last) last.innerHTML = prefix + last.innerHTML;
      }
    } catch (err) {
      this._appendFollow('assistant', `教材语料加载失败：${err.message}`, { meta: '系统' });
      this._followDone();
      return;
    }
    if (result.topic) this.lastTopic = result.topic;

    const remember = (text) => {
      this._aiHistory.push({ role: 'user', text: q }, { role: 'assistant', text });
      if (this._aiHistory.length > 12) this._aiHistory = this._aiHistory.slice(-12);
    };
    const history = this._aiHistory.slice();

    // 超范围 / 依据不足：明确不作答，不调用模型
    if (!result.confident) {
      const text = buildOfflineAnswer(result);
      this._appendFollow('assistant', text, {
        meta: result.reason === 'out' || result.scope === 'out' ? '超出范围 · 未作答' : '依据不足 · 未作答'
      });
      remember(text);
      $('ai-source').textContent = `追问 · ${BOTANY_SOURCE.short} · ${result.reason === 'out' ? '超出知识范围，未作答' : '依据不足，未作答'}`;
      this._followDone();
      return;
    }

    // 离线：教材原文摘录 + 出处，零生成
    if (!this.ai.isConfigured()) {
      const text = buildOfflineAnswer(result);
      this._appendFollow('assistant', text, { meta: `${result.scopeLabel} · 教材原文`, result });
      remember(text);
      $('ai-source').textContent = `追问 · ${BOTANY_SOURCE.short} · 教材原文摘录（附章节与页码）`;
      this._followDone();
      return;
    }

    // 在线：只把教材片段交给模型组织表达（与课程助教同一提示词规则）
    const bubble = this._appendFollow('assistant', '正在依据教材片段作答…', {
      meta: `${result.scopeLabel} · 教材依据`, result, streaming: true
    });
    let acc = '';
    const schedule = () => {
      if (this._pending) return;
      this._pending = true;
      this._raf = requestAnimationFrame(() => {
        this._pending = false;
        if (!bubble) return;
        const meta = bubble.querySelector('.ai-follow-meta')?.outerHTML || '';
        const ev = bubble.querySelector('.ai-follow-ev')?.outerHTML || '';
        bubble.innerHTML = meta + `<div class="ai-follow-bubble">${renderMarkdown(acc)}<span class="cursor"></span></div>` + ev;
        const thread = $('ai-thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
      });
    };
    try {
      const messages = buildCourseMessages(q, { result, part: this.part, history });
      await this.ai.chat(messages, {
        onToken: (_delta, full) => { acc = full; schedule(); }
      });
      cancelAnimationFrame(this._raf); this._pending = false;
      const text = acc || buildOfflineAnswer(result);
      if (bubble) {
        const meta = bubble.querySelector('.ai-follow-meta')?.outerHTML || '';
        const ev = bubble.querySelector('.ai-follow-ev')?.outerHTML || '';
        bubble.innerHTML = meta + `<div class="ai-follow-bubble">${renderMarkdown(text)}</div>` + ev;
        bubble.dataset.text = text;
      }
      remember(text);
      $('ai-source').textContent = `追问 · ${BOTANY_SOURCE.short} · 模型仅依据检索片段组织表达`;
    } catch (err) {
      cancelAnimationFrame(this._raf); this._pending = false;
      const text = `AI 调用失败（${err.code || 'ERROR'}），以下改为教材原文摘录：\n\n${buildOfflineAnswer(result)}`;
      if (bubble) {
        const meta = bubble.querySelector('.ai-follow-meta')?.outerHTML || '';
        bubble.innerHTML = meta + `<div class="ai-follow-bubble">${renderMarkdown(text)}</div>`;
        bubble.dataset.text = text;
      }
      remember(text);
      $('ai-source').textContent = `追问 · ${BOTANY_SOURCE.short} · 原文摘录（AI 调用失败：${err.code || 'ERROR'}）`;
    } finally {
      this._followDone();
    }
  }

  async runAI() {
    if (!this.part) return;
    if (this.aiState === 'streaming' || this.aiState === 'loading') { this.ai.abort(); return; }

    const configured = this.ai.isConfigured();
    this._aiText = '';
    this._aiHistory = [];
    this.lastTopic = '';
    const thread = $('ai-thread');
    if (thread) thread.innerHTML = '';
    this._setState('loading', '正在检索教材…');
    this._renderOutput('', true);

    let result = null;
    try {
      result = await this._retrieveTextbook();
    } catch (err) {
      this._aiText = `教材语料加载失败：${err.message}\n请通过本地服务或线上站点访问（file:// 下无法加载模块）。`;
      this._setState('error', '语料加载失败');
      this._renderOutput(this._aiText, false);
      $('ai-source').textContent = `数据源：${BOTANY_SOURCE.short}（未加载成功）`;
      return;
    }

    // 无可靠片段：任何模式都不解读
    if (!result.confident) {
      this._aiText = this._textbookExtract(result);
      this._setState('done', '教材未涵盖 · 不作答');
      this._renderOutput(this._aiText, false);
      this._aiHistory = [
        { role: 'user', text: `请依据教材解读「${this.part.label}」` },
        { role: 'assistant', text: this._aiText }
      ];
      $('ai-source').textContent = `检索范围：${BOTANY_SOURCE.short} 全文 · ${result.reason === 'out' ? '超出知识范围' : '依据不足，未生成内容'}`;
      return;
    }

    // 离线：直接给教材原文摘录，零生成
    if (!configured) {
      this._aiText = this._textbookExtract(result);
      this._setState('done', '教材原文摘录 · 可继续追问');
      this._renderOutput(this._aiText, false);
      this._aiHistory = [
        { role: 'user', text: `请依据教材解读「${this.part.label}」` },
        { role: 'assistant', text: this._aiText }
      ];
      $('ai-source').textContent = `数据源：${BOTANY_SOURCE.short} · 教材原文摘录（附章节与页码，未配置 AI 接口）`;
      return;
    }

    // 在线：只把教材片段交给模型组织表达，不让它自由发挥
    this._setState('loading', '正在依据教材片段组织…');
    const evidence = formatEvidence(result);
    let acc = '';
    const schedule = () => {
      if (this._pending) return;
      this._pending = true;
      this._raf = requestAnimationFrame(() => {
        this._pending = false;
        this._renderOutput(acc, true);
      });
    };
    try {
      const messages = [
        { role: 'system', content: [
          `你是《植物学》课程助教。唯一事实依据是下面提供的 ${BOTANY_SOURCE.short} 教材原文片段。`,
          '硬性规则：只依据片段作答；每个结论后标 [依据：第X章… · 教材 Pxxx]；片段没有的内容（数据、品种、剂量、文献）一律不得补充；内置知识摘要只是辅助线索，不是教材内容；片段不足就明说，不猜测。',
          '按「形态解剖 / 生理机制 / 园艺实践」三层组织，中文 400–600 字，要点式。'
        ].join('\n') },
        { role: 'user', content: [
          '【教材原文片段 · 唯一事实依据】', evidence, '',
          `【当前部位】${this.part.label}（${this.part.latin || ''}） · ${this.part.group || ''}`,
          `【内置知识摘要 · 仅辅助线索】${this.knowledge.summary || ''}`,
          `【园艺要点 · 仅辅助线索】${stripHtml(this.knowledge.horticulture).slice(0, 400)}`,
          '', `请依据片段解读「${this.part.label}」，逐条标注出处。`
        ].join('\n') }
      ];
      await this.ai.chat(messages, {
        onToken: (_delta, full) => {
          acc = full;
          if (this.aiState === 'loading') this._setState('streaming', '依据教材组织中…');
          schedule();
        }
      });
      this._aiText = acc || this._textbookExtract(result);
      this._setState('done', '课本解读完成 · 可继续追问');
      this._renderOutput(this._aiText, false);
      this._aiHistory = [
        { role: 'user', text: `请依据教材解读「${this.part.label}」` },
        { role: 'assistant', text: this._aiText }
      ];
      $('ai-source').textContent = `依据：${BOTANY_SOURCE.short} · 模型仅依据检索片段组织表达（${this.ai.getConfig().model || '服务端默认模型'}）`;
    } catch (err) {
      this._aiText = `${err.message}\n\nAI 调用失败，以下改为教材原文摘录：\n\n${this._textbookExtract(result)}`;
      this._setState('error', '已降级为教材原文');
      this._renderOutput(this._aiText, false);
      $('ai-source').textContent = `数据源：${BOTANY_SOURCE.short} · 原文摘录（AI 调用失败：${err.code || 'ERROR'}）`;
    } finally {
      cancelAnimationFrame(this._raf);
      this._pending = false;
      const btn = $('ai-run');
      if (btn) btn.disabled = false;
    }
  }

  _copy() {
    const thread = $('ai-thread');
    const follow = thread ? [...thread.children].map(m => m.dataset.text || m.textContent).join('\n\n') : '';
    const text = [this._aiText || $('ai-output')?.textContent || '', follow].filter(Boolean).join('\n\n');
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      const btn = $('ai-copy');
      if (btn) { const t = btn.textContent; btn.textContent = '已复制 ✓'; setTimeout(() => { btn.textContent = t; }, 1400); }
    }).catch(() => {});
  }

  refreshAIState() {
    const badge = $('ai-state'), label = $('ai-state-text');
    if (!badge || !label) return;
    const ok = this.ai.isConfigured();
    badge.classList.toggle('on', ok);
    label.textContent = ok ? 'AI 已就绪 · 依据教材片段解读' : '离线可用 · 教材原文摘录';
  }
}
