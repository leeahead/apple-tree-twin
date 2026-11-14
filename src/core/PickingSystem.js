import * as THREE from 'three';

/** 射线拾取：区分点击 / 拖拽，悬停提示，UUID 部位解析 */
export class PickingSystem {
  constructor(sceneManager, registry, callbacks = {}) {
    this.sm = sceneManager;
    this.registry = registry;
    this.cb = callbacks;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line = { threshold: 0.018 };
    this.raycaster.params.Points = { threshold: 0.016 };
    this.pointer = new THREE.Vector2();
    this.canvas = this.sm.canvas;
    this.enabled = true;
    this._roots = [];
    this._down = null;
    this._lastHover = 0;
    this._lastTap = 0;
    this._hovered = null;
    this.refresh();
    this._bind();
  }

  refresh() {
    const isVisible = (o) => {
      let p = o;
      while (p) { if (p.visible === false) return false; p = p.parent; }
      return true;
    };
    this._roots = this.registry.pickRoots.filter(isVisible);
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this._down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    c.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - this._lastHover < 42) return;
      this._lastHover = now;
      this._hover(e);
    });
    c.addEventListener('pointerleave', () => {
      this._hovered = null;
      this.cb.onHover?.(null);
      c.style.cursor = 'grab';
    });
    c.addEventListener('pointerup', e => {
      if (e.button !== 0 || !this._down || !this.enabled) { this._down = null; return; }
      const d = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
      const dt = performance.now() - this._down.t;
      this._down = null;
      if (d > 6 || dt > 650) return;
      const hit = this._intersect(e);
      if (hit) { this._lastTap = 0; this.cb.onPick?.(hit); return; }
      // 触屏浏览器不保证派发 dblclick：用两次轻点空白返回全景
      if (e.pointerType === 'touch') {
        const now = performance.now();
        if (this._lastTap && now - this._lastTap < 340) {
          this._lastTap = 0;
          this.cb.onDoubleClick?.();
        } else {
          this._lastTap = now;
        }
      }
      this.cb.onEmptyClick?.(hit);
    });
    c.addEventListener('dblclick', () => this.cb.onDoubleClick?.());
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.style.cursor = 'grab';
  }

  _setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  _intersect(e) {
    this._setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.sm.camera);
    const hits = this.raycaster.intersectObjects(this._roots, true);
    for (const h of hits) {
      const found = this.registry.fromObject(h.object);
      if (found && found.part) {
        const visible = (() => { let p = h.object; while (p) { if (!p.visible) return false; p = p.parent; } return true; })();
        if (!visible) continue;
        return { part: found.part, object: h.object, root: found.object, point: h.point.clone(), distance: h.distance, x: e.clientX, y: e.clientY };
      }
    }
    return null;
  }

  _hover(e) {
    if (!this.enabled) return;
    const hit = this._intersect(e);
    if (hit) {
      this.canvas.style.cursor = 'pointer';
      if (this._hovered !== hit.part.id) {
        this._hovered = hit.part.id;
        this.cb.onHover?.(hit);
      } else {
        this.cb.onHoverMove?.(hit);
      }
    } else {
      this.canvas.style.cursor = 'grab';
      if (this._hovered !== null) { this._hovered = null; this.cb.onHover?.(null); }
    }
  }
}
