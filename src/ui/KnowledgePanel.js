import { getKnowledge } from '../data/knowledge.js';
import { renderMarkdown, escapeHtml } from '../services/AIInterpreter.js';

const $ = (id) => document.getElementById(id);

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
          <div class="ai-state ${this.ai.isConfigured() ? 'on' : ''}" id="ai-state"><i></i><span id="ai-state-text">${this.ai.isConfigured() ? 'AI 接口已就绪' : '未配置 · 使用离线知识库'}</span></div>
          <button class="btn primary" id="ai-run">生成实时解读</button>
        </div>
        <div class="ai-output" id="ai-output">点击「生成实时解读」，由大模型结合本部位的植物学上下文生成更深入的形态、生理与园艺分析。
${this.ai.isConfigured() ? '' : '\n当前未配置接口，将展示系统内置的离线知识库内容。'}</div>
        <div class="ai-actions">
          <button class="btn ghost" id="ai-copy">复制全文</button>
          <button class="btn ghost" id="ai-settings">接口设置</button>
        </div>
        <div class="ai-source" id="ai-source"></div>
      </div>`;

    $('ai-run').addEventListener('click', () => this.runAI());
    $('ai-copy').addEventListener('click', () => this._copy());
    $('ai-settings').addEventListener('click', () => this.cb.onAISettings?.());
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
    btn.textContent = (state === 'loading' || state === 'streaming') ? '生成中…' : '重新生成';
  }

  _renderOutput(text, streaming = false) {
    const out = $('ai-output');
    if (!out) return;
    out.innerHTML = renderMarkdown(text) + (streaming ? '<span class="cursor"></span>' : '');
    out.scrollTop = out.scrollHeight;
  }

  async runAI() {
    if (!this.part) return;
    if (this.aiState === 'streaming' || this.aiState === 'loading') { this.ai.abort(); return; }

    const configured = this.ai.isConfigured();
    this._aiText = '';
    $('ai-source').textContent = configured
      ? `数据源：${this.ai.getConfig().model || '服务端默认模型'} · OpenAI 兼容接口 · 生成内容由模型产生，请与权威资料核对`
      : '数据源：系统内置离线知识库（未配置 AI 接口）';

    if (!configured) {
      this._setState('done', '离线知识库');
      this._aiText = this.ai.fallback(this.part, this.knowledge);
      this._renderOutput(this._aiText, false);
      $('ai-run').textContent = '重新生成';
      return;
    }

    this._setState('loading', '正在连接模型…');
    this._renderOutput('', true);
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
      await this.ai.explain(this.part, this.knowledge, {
        onToken: (_delta, full) => {
          acc = full;
          if (this.aiState === 'loading') this._setState('streaming', '模型输出中…');
          schedule();
        }
      });
      this._aiText = acc || '（模型返回空内容）';
      this._setState('done', '解读完成');
      this._renderOutput(this._aiText, false);
    } catch (err) {
      this._aiText = `${err.message}\n\n以下为系统内置的离线知识库内容：\n\n${this.ai.fallback(this.part, this.knowledge)}`;
      this._setState('error', '已降级到离线知识库');
      this._renderOutput(this._aiText, false);
      $('ai-source').textContent = `数据源：离线知识库（AI 调用失败：${err.code || 'ERROR'}）`;
    } finally {
      cancelAnimationFrame(this._raf);
      this._pending = false;
      const btn = $('ai-run');
      if (btn) btn.disabled = false;
    }
  }

  _copy() {
    const text = this._aiText || $('ai-output')?.textContent || '';
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
    label.textContent = ok ? 'AI 接口已就绪' : '未配置 · 使用离线知识库';
  }
}
