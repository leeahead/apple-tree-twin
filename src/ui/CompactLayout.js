/**
 * CompactLayout · 手机横屏 / 低高度视口的布局与交互控制器
 *
 * 设计原则：
 *  1. 三维画布始终全屏，不再被左右常驻面板挤压；
 *  2. 两侧内容退化为「边缘把手 + 按需抽屉」，同一时刻最多展开一个；
 *  3. 抽屉内部再分层：左侧「器官索引 / 生境控制」互斥切换，
 *     右侧「摘要 peek / 详情 full」两档，详情里四个知识标签可左右滑动切换；
 *  4. 抽屉展开时通过 SceneManager.setViewportShift() 把取景中心让开，
 *     保证树体仍完整可见、且拾取坐标与画面一致。
 *
 * 桌面端：body 不加 .compact，本模块所有 DOM 样式与手势均不生效。
 */
const $ = (id) => document.getElementById(id);

/** 横屏小高度（典型手机横屏 844×390），或任何矮而窄的窗口 */
const COMPACT_QUERY =
  '(orientation: landscape) and (max-height: 540px), (max-width: 960px) and (max-height: 460px)';

const KN_TABS = ['botany', 'physiology', 'horticulture', 'ai'];

export class CompactLayout {
  constructor({ sceneManager, knowledge, onAnatomy } = {}) {
    this.sm = sceneManager;
    this.knowledge = knowledge;
    this.onAnatomy = onAnatomy;
    this.mq = window.matchMedia(COMPACT_QUERY);

    this.state = { drawer: 'none', left: 'nav', kn: 'peek', hasPart: false };

    this._shift = 0;        // 当前相机让位（px）
    this._targetShift = 0;
    this._raf = 0;
    this._touch = null;
    this._edge = null;

    this._bindButtons();
    this._bindGestures();
    this._bindEvents();
    this._applyMode();
  }

  isCompact() { return document.body.classList.contains('compact'); }

  /* ---------------- 模式切换 ---------------- */
  _applyMode() {
    const on = this.mq.matches;
    const was = this.isCompact();
    document.body.classList.toggle('compact', on);

    if (!on) {
      if (was) {
        this.state.drawer = 'none';
        this._animateShift(0, true);
      }
      return;
    }
    if (!was) this.state.drawer = 'none';
    this._sync();
  }

  _sync() {
    if (!this.isCompact()) return;
    const d = document.body.dataset;
    d.drawer = this.state.drawer;
    d.left = this.state.left;
    d.kn = this.state.kn;
    d.hasPart = this.state.hasPart ? '1' : '0';

    $('rail-nav')?.setAttribute('aria-expanded', String(this.state.drawer === 'left' && this.state.left === 'nav'));
    $('rail-env')?.setAttribute('aria-expanded', String(this.state.drawer === 'left' && this.state.left === 'env'));
    $('rail-kn')?.setAttribute('aria-expanded', String(this.state.drawer === 'right'));
    $('left-drawer-tabs')?.querySelectorAll('button[data-left]').forEach(b => {
      const active = b.dataset.left === this.state.left;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    // 有新知识但抽屉收起时，右把手亮一个提示点
    $('rail-kn-dot')?.classList.toggle('on', this.state.hasPart && this.state.drawer !== 'right');

    this._animateShift(this._computeShift());
  }

  /* ---------------- 抽屉状态机 ---------------- */
  openLeft(section = 'nav') {
    if (!this.isCompact()) return;
    if (this.state.drawer === 'left' && this.state.left === section) { this.close(); return; }
    this.setLeft(section);
  }

  setLeft(section) {
    if (!this.isCompact()) return;
    this.state.left = section;
    this.state.drawer = 'left';
    this._sync();
  }

  openRight(mode = 'peek') {
    if (!this.isCompact()) return;
    if (this.state.drawer === 'right' && this.state.kn === mode) { this.close(); return; }
    this.state.drawer = 'right';
    this.state.kn = this.state.hasPart ? mode : 'peek';
    this._sync();
  }

  setKn(mode) {
    if (!this.isCompact() || !this.state.hasPart) return;
    this.state.kn = mode;
    this.state.drawer = 'right';
    this._sync();
  }

  close() {
    if (this.state.drawer === 'none') return;
    this.state.drawer = 'none';
    this._sync();
  }

  _onKnowledge(e) {
    if (!this.isCompact()) return;
    if (e.detail?.state === 'show') {
      this.state.hasPart = true;
      this.state.kn = 'peek';       // 每次选中新器官回到摘要，详情由用户按需展开
      this.state.drawer = 'right';
    } else {
      this.state.hasPart = false;
      this.state.kn = 'peek';
      if (this.state.drawer === 'right') this.state.drawer = 'none';
    }
    this._sync();
  }

  /* ---------------- 相机让位 ---------------- */
  _computeShift() {
    if (!this.isCompact()) return 0;
    const w = window.innerWidth;
    if (this.state.drawer === 'left') {
      return -Math.round(Math.min(w * 0.42, 292) * 0.46);
    }
    if (this.state.drawer === 'right') {
      const dw = Math.min(w * 0.48, 356);
      return Math.round(dw * (this.state.kn === 'peek' ? 0.24 : 0.46));
    }
    return 0;
  }

  _animateShift(target, immediate = false) {
    this._targetShift = target;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (immediate || typeof this.sm?.setViewportShift !== 'function' ||
        Math.abs(target - this._shift) < 0.7) {
      this._shift = target;
      this.sm?.setViewportShift?.(target);
      return;
    }
    // 按真实时间收敛，而不是按帧数衰减：低帧率设备上一两帧也能到位
    const from = this._shift;
    const start = performance.now();
    const duration = 260;
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      this._shift = from + (this._targetShift - from) * e;
      this.sm.setViewportShift(this._shift);
      if (p < 1) {
        this._raf = requestAnimationFrame(step);
      } else {
        this._shift = this._targetShift;
        this.sm.setViewportShift(this._shift);
        this._raf = 0;
      }
    };
    this._raf = requestAnimationFrame(step);
  }

  _switchTab(dir) {
    if (!this.knowledge || this.state.kn !== 'full') return;
    const i = KN_TABS.indexOf(this.knowledge.tab || 'botany');
    this.knowledge.setTab(KN_TABS[(i + dir + KN_TABS.length) % KN_TABS.length]);
  }

  /* ---------------- 按钮 ---------------- */
  _bindButtons() {
    const on = (id, fn) => $(id)?.addEventListener('click', fn);
    on('rail-nav', () => this.openLeft('nav'));
    on('rail-env', () => this.openLeft('env'));
    on('rail-ana', () => { this.close(); this.onAnatomy?.(); });
    on('rail-kn', () => this.openRight(this.state.kn));
    on('left-drawer-close', () => this.close());
    on('kn-expand', () => this.setKn('full'));
    on('kn-collapse', () => this.setKn('peek'));

    $('left-drawer-tabs')?.querySelectorAll('button[data-left]').forEach(b => {
      b.addEventListener('click', () => this.setLeft(b.dataset.left));
    });
  }

  /* ---------------- 手势 ---------------- */
  _bindGestures() {
    const opts = { passive: false };
    document.addEventListener('touchstart', e => this._touchStart(e), opts);
    document.addEventListener('touchmove', e => this._touchMove(e), opts);
    document.addEventListener('touchend', e => this._touchEnd(e), { passive: true });
    document.addEventListener('touchcancel', () => { this._touch = null; this._edge = null; }, { passive: true });
  }

  _touchStart(e) {
    this._edge = null;
    if (!this.isCompact() || e.touches.length !== 1) { this._touch = null; return; }
    const t = e.touches[0];
    const el = t.target instanceof Element ? t.target : null;
    const inChrome = !!(el && el.closest('.chrome, .compact-rail, .modal, #anatomy'));
    const onInput = !!(el && el.closest('input[type=range], select'));
    this._touch = { x: t.clientX, y: t.clientY, el, inChrome, onInput };
    if (!inChrome && !onInput) {
      if (t.clientX <= 28) this._edge = 'left';
      else if (t.clientX >= window.innerWidth - 28) this._edge = 'right';
    }
  }

  _touchMove(e) {
    if (!this._edge || !this._touch || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - this._touch.x;
    const dy = t.clientY - this._touch.y;
    // 只在明确是「边缘横向滑入」时拦截默认手势，避免干扰正常的 3D 旋转
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.25 && e.cancelable) e.preventDefault();
  }

  _touchEnd(e) {
    const s = this._touch;
    const edge = this._edge;
    this._touch = null;
    this._edge = null;
    if (!s || !this.isCompact() || !e.changedTouches?.length) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    const horiz = Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.3;
    const vert = Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx) * 1.3;

    // 1) 从屏幕边缘滑入：左边缘右滑开索引 / 右边缘左滑开知识
    if (horiz && edge === 'left' && dx > 0) { this.openLeft(this.state.left); return; }
    if (horiz && edge === 'right' && dx < 0) { this.openRight(this.state.kn); return; }

    const inLeft = s.el?.closest?.('#navigator, #environment, #left-drawer-tabs');
    const inRight = s.el?.closest?.('#knowledge');

    // 2) 抽屉内反向横滑收起；详情区横滑切换知识标签
    if (horiz && this.state.drawer === 'left' && inLeft && dx < 0) { this.close(); return; }
    if (horiz && this.state.drawer === 'right' && inRight) {
      if (s.el.closest('.kn-panels, .kn-tabs')) { this._switchTab(dx < 0 ? 1 : -1); return; }
      if (dx > 0) { this.close(); return; }
    }

    // 3) 右抽屉上滑展开详情；在头部区域下滑收回摘要
    if (vert && this.state.drawer === 'right' && inRight && this.state.hasPart) {
      const panels = $('kn-panels');
      if (dy < 0 && this.state.kn === 'peek' && !s.el.closest('.kn-summary')) { this.setKn('full'); return; }
      if (dy > 0 && this.state.kn === 'full' && (!panels || panels.scrollTop <= 2) &&
          !s.el.closest('.kn-panels')) { this.setKn('peek'); return; }
    }
  }

  /* ---------------- 全局事件 ---------------- */
  _bindEvents() {
    window.addEventListener('malus:knowledge', e => this._onKnowledge(e));
    const onMode = () => this._applyMode();
    if (this.mq.addEventListener) this.mq.addEventListener('change', onMode);
    else if (this.mq.addListener) this.mq.addListener(onMode);

    window.addEventListener('resize', () => { if (this.isCompact()) this._sync(); });
    window.addEventListener('orientationchange', () => setTimeout(() => this._applyMode(), 120));
  }
}
