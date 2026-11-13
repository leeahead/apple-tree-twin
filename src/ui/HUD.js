import { GROUPS, PHENO, timeLabel } from '../core/constants.js';
import { PROVIDERS, escapeHtml } from '../services/AIInterpreter.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(registry, ai, callbacks = {}) {
    this.registry = registry;
    this.ai = ai;
    this.cb = callbacks;
    this.state = {
      projection: 'perspective', dof: true, bloom: true, soil: true,
      anatomy: false, time: 9, stage: 'young', ripeness: 0.35
    };
    this._buildNav();
    this._bindToolbar();
    this._bindSliders();
    this._bindModals();
    this._bindKeys();
    this._bindTooltips();
    this._loadAIForm();
    this.setTime(9);
    this.setProjection('perspective', true);
    this._syncToggles();
  }

  /* ---------------- 导航 ---------------- */
  _buildNav() {
    const host = $('nav-scroll');
    let html = '';
    for (const g of GROUPS) {
      const parts = this.registry.groupParts(g.id);
      html += `<div class="nav-group" data-group="${g.id}">
        <button class="nav-group-head" aria-expanded="true">
          <span class="ng-dot" style="background:${g.color}"></span>
          <span class="ng-name">${g.name}</span>
          <span class="ng-num">${parts.length}</span>
          <span class="ng-arrow">▾</span>
        </button>
        <div class="nav-items">`;
      for (const p of parts) {
        html += `<button class="nav-item" data-part="${p.id}" title="${escapeHtml(p.label)} · ${escapeHtml(p.latin)}">
          <span class="ni-zh">${escapeHtml(p.label)}</span>
          <span class="ni-la">${escapeHtml(p.latin)}</span></button>`;
      }
      html += `</div></div>`;
    }
    host.innerHTML = html;
    $('nav-count').textContent = String(this.registry.count());

    host.addEventListener('click', e => {
      const head = e.target.closest('.nav-group-head');
      if (head) {
        head.parentElement.classList.toggle('collapsed');
        head.setAttribute('aria-expanded', String(!head.parentElement.classList.contains('collapsed')));
        return;
      }
      const item = e.target.closest('.nav-item');
      if (item) {
        const part = this.registry.get(item.dataset.part);
        if (part) this.cb.onNavigate?.(part);
      }
    });
  }

  setNavActive(partId) {
    this.el?.active?.classList.remove('active');
    const btn = $('nav-scroll').querySelector(`.nav-item[data-part="${partId}"]`);
    if (btn) {
      btn.classList.add('active');
      const group = btn.closest('.nav-group');
      if (group?.classList.contains('collapsed')) {
        group.classList.remove('collapsed');
        group.querySelector('.nav-group-head')?.setAttribute('aria-expanded', 'true');
      }
      btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      this.el = { ...(this.el || {}), active: btn };
    }
  }

  clearNavActive() { this.el?.active?.classList.remove('active'); this.el = { ...(this.el || {}), active: null }; }

  /* ---------------- 工具栏 ---------------- */
  _bindToolbar() {
    const on = (id, fn) => $(id).addEventListener('click', fn);
    on('btn-persp', () => this.setProjection('perspective'));
    on('btn-ortho', () => this.setProjection('ortho'));
    on('btn-dof', () => { this.state.dof = !this.state.dof; this._syncToggles(); this.cb.onDOF?.(this.state.dof); });
    on('btn-bloom', () => { this.state.bloom = !this.state.bloom; this._syncToggles(); this.cb.onBloom?.(this.state.bloom); });
    on('btn-explode', () => this.cb.onAnatomy?.());
    on('btn-anatomy-entry', () => this.cb.onAnatomy?.());
    on('btn-soil', () => { this.state.soil = !this.state.soil; this._syncToggles(); this.cb.onSoil?.(this.state.soil); });
    on('btn-reset', () => this.cb.onReset?.());
    on('btn-ai-settings', () => this.openModal('modal-ai'));
    on('btn-help', () => this.openModal('modal-help'));
  }

  _syncToggles() {
    const map = {
      'btn-dof': this.state.dof, 'btn-bloom': this.state.bloom,
      'btn-explode': this.state.anatomy, 'btn-soil': this.state.soil
    };
    for (const [id, active] of Object.entries(map)) $(id).classList.toggle('active', active);
  }

  setProjection(mode, silent = false) {
    this.state.projection = mode;
    $('btn-persp').classList.toggle('active', mode === 'perspective');
    $('btn-ortho').classList.toggle('active', mode === 'ortho');
    $('st-proj').textContent = mode === 'perspective' ? 'PERSPECTIVE' : 'ORTHOGRAPHIC';
    if (!silent) this.cb.onProjection?.(mode);
  }

  /* ---------------- 滑块与物候 ---------------- */
  _bindSliders() {
    $('slider-time').addEventListener('input', e => {
      const t = Number(e.target.value);
      this.setTime(t);
      this.cb.onTime?.(t);
    });
    $('slider-fruit').addEventListener('input', e => {
      const v = Number(e.target.value) / 100;
      this.setRipeness(v);
      this.cb.onRipeness?.(v);
    });
    $('pheno-tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-pheno]');
      if (b) { this.setPheno(b.dataset.pheno); this.cb.onPheno?.(b.dataset.pheno); }
    });
  }

  setAnatomy(on) {
    this.state.anatomy = !!on;
    this._syncToggles();
  }

  setTime(t) {
    this.state.time = t;
    const l = timeLabel(t);
    $('slider-time').value = String(t);
    $('out-time').textContent = `${l.time} · ${l.phase}`;
    $('st-light').textContent = l.isNight ? 'MOONLIGHT' : (l.phase === '夕照' || l.phase === '日出' ? 'GOLDEN HOUR' : 'DAYLIGHT');
  }

  setRipeness(v) {
    this.state.ripeness = v;
    $('slider-fruit').value = String(Math.round(v * 100));
    $('out-fruit').textContent = `${Math.round(v * 100)}%`;
  }

  setPheno(stage, defaultRipeness) {
    this.state.stage = stage;
    const p = PHENO[stage] || PHENO.young;
    $('pheno-tabs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.pheno === stage));
    $('pheno-note').textContent = p.note;
    if (typeof defaultRipeness === 'number') this.setRipeness(defaultRipeness);
  }

  /* ---------------- 模态框 ---------------- */
  _bindModals() {
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target.closest('[data-close]')) modal.classList.add('hidden');
      });
    });
    $('ai-provider').addEventListener('change', e => {
      const key = e.target.value, p = PROVIDERS[key] || PROVIDERS.custom;
      if (key === 'proxy') {
        $('ai-endpoint').value = '/api/ai';
        $('ai-model').value = $('ai-model').value || 'server-default';
        $('ai-endpoint').disabled = true;
        $('ai-key').disabled = true;
        $('ai-key').value = '';
      } else {
        $('ai-endpoint').disabled = false;
        $('ai-key').disabled = false;
        if (key !== 'custom') { $('ai-endpoint').value = p.endpoint; $('ai-model').value = p.model; }
      }
      $('ai-status').textContent = '';
    });
    $('ai-save').addEventListener('click', () => {
      const cfg = this._readAIForm();
      this.ai.saveConfig(cfg);
      this.cb.onAIConfigSaved?.(cfg);
      $('modal-ai').classList.add('hidden');
      this.toast(this.ai.isConfigured() ? 'AI 接口配置已保存' : '配置已保存 · 仍需补全接口参数');
    });
    $('ai-test').addEventListener('click', async () => {
      const st = $('ai-status');
      st.className = 'modal-status';
      st.textContent = '正在测试连接…';
      try {
        const r = await this.ai.test(this._readAIForm());
        st.textContent = `连接成功 · 模型回复：${r.reply.slice(0, 40)}`;
      } catch (err) {
        st.className = 'modal-status err';
        st.textContent = `连接失败：${err.message}`;
      }
    });
  }

  _readAIForm() {
    return {
      provider: $('ai-provider').value,
      endpoint: $('ai-endpoint').value.trim(),
      model: $('ai-model').value.trim(),
      apiKey: $('ai-key').value.trim(),
      stream: $('ai-stream').checked
    };
  }

  _loadAIForm() {
    const c = this.ai.getConfig();
    $('ai-provider').value = c.provider || 'custom';
    $('ai-endpoint').value = c.endpoint || '';
    $('ai-model').value = c.model || '';
    $('ai-key').value = c.apiKey || '';
    $('ai-stream').checked = c.stream !== false;
    if (c.provider === 'proxy') {
      $('ai-endpoint').value = '/api/ai';
      $('ai-endpoint').disabled = true;
      $('ai-key').disabled = true;
    }
  }

  openModal(id) { $(id).classList.remove('hidden'); }
  closeModals() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }

  /* ---------------- 键盘 / 提示 ---------------- */
  _bindKeys() {
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const open = document.querySelector('.modal:not(.hidden)');
        if (open) { open.classList.add('hidden'); return; }
        this.cb.onEscape?.();
      }
    });
    window.addEventListener('resize', () => this.cb.onResize?.());
  }

  _bindTooltips() {
    const tip = $('tooltip');
    document.querySelectorAll('[data-tip]').forEach(el => {
      el.addEventListener('mouseenter', e => {
        tip.textContent = el.dataset.tip;
        tip.classList.remove('hidden');
        this._moveTip(e);
      });
      el.addEventListener('mousemove', e => this._moveTip(e));
      el.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    });
  }

  _moveTip(e) {
    const tip = $('tooltip');
    const x = Math.min(e.clientX, window.innerWidth - 260);
    const y = Math.min(e.clientY, window.innerHeight - 60);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  showPartTooltip(hit) {
    if (!hit) { $('tooltip').classList.add('hidden'); return; }
    const tip = $('tooltip');
    tip.innerHTML = `${escapeHtml(hit.part.label)}<small>${escapeHtml(hit.part.latin)}</small>`;
    tip.classList.remove('hidden');
    tip.style.left = `${Math.min(hit.x, window.innerWidth - 200)}px`;
    tip.style.top = `${Math.min(hit.y, window.innerHeight - 60)}px`;
  }

  showHint(show) { $('hint').classList.toggle('hidden', !show); }

  toast(msg) {
    const h = $('hint');
    h.textContent = msg;
    h.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => h.classList.add('hidden'), 2600);
  }

  /* ---------------- 状态栏 ---------------- */
  setSelected(label) { $('st-part').textContent = label || '—'; }
  setStats(objects, tris, fps) {
    $('st-objects').textContent = String(objects);
    $('st-tris').textContent = tris >= 1000 ? `${(tris / 1000).toFixed(1)}k` : String(tris);
    $('st-fps').textContent = String(Math.round(fps));
  }
}
