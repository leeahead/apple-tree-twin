import * as THREE from 'three';
import { clamp } from './GeometryUtils.js';

/** 选中态：材质自发光提亮 + 仪器式聚焦环 + 局部补光 */
export class Highlight {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.current = null;
    this.saved = [];
    this.ring = null;
    this._pulse = 0;
    this._center = new THREE.Vector3();
    this._offset = new THREE.Vector3();
  }

  _makeRing(radius) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xe0b871, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffe0a2, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
    const r = new THREE.Mesh(new THREE.RingGeometry(radius * 0.992, radius, 96), mat);
    r.renderOrder = 900;
    g.add(r);
    const inner = new THREE.Mesh(new THREE.RingGeometry(radius * 0.60, radius * 0.604, 72), mat.clone());
    inner.material.opacity = 0.24;
    inner.renderOrder = 900;
    g.add(inner);
    const ticks = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const major = i % 4 === 0;
      const r0 = radius * (major ? 1.035 : 1.015), r1 = radius * (major ? 1.11 : 1.055);
      ticks.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    const tl = new THREE.LineSegments(tg, lineMat);
    tl.renderOrder = 901;
    g.add(tl);
    // 中心十字
    const cross = [];
    const c = radius * 0.10;
    cross.push(-c, 0, 0, c, 0, 0, 0, -c, 0, 0, c, 0);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cross, 3));
    const cl = new THREE.LineSegments(cg, lineMat.clone());
    cl.material.opacity = 0.5;
    cl.renderOrder = 901;
    g.add(cl);
    g.userData.noPick = true;
    return g;
  }

  select(root, part) {
    this.clear(true);
    if (!root) return;
    this.current = { root, part };

    // 材质自发光提亮（仅作用于选中实例，克隆后恢复）
    root.traverse(o => {
      if (o.userData.noHighlight || !o.material) return;
      if (!(o.isMesh || o.isLine || o.isLineSegments || o.isPoints)) return;
      const orig = o.material;
      const clone = (m) => {
        const c = m.clone();
        // 高亮使用中性暖白自发光：绝不能用部位主题色，否则会染改器官真实色（如青绿幼果变橙）
        if (c.emissive) {
          c.emissive.set(part.color || '#e0b871').lerp(new THREE.Color('#fff6e0'), 0.82);
          // 必须直接赋值：材质默认 emissiveIntensity 为 1，用 max() 会导致全功率自发光把器官洗白
          c.emissiveIntensity = 0.08;
        } else if (c.color) c.color.lerp(new THREE.Color('#fff0cc'), 0.28);
        if ('opacity' in c && c.transparent) c.opacity = Math.min(1, (c.opacity ?? 1) * 1.25);
        return c;
      };
      const next = Array.isArray(orig) ? orig.map(clone) : clone(orig);
      o.userData._hlOrig = orig;
      o.material = next;
      this.saved.push({ object: o, orig, next });
    });

    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    box.getCenter(this._center);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.2);
    const radius = clamp(maxDim * 0.72, 0.26, 4.6);
    this._radius = radius;
    this.ring = this._makeRing(radius);
    this.ring.position.copy(this._center);
    this.sm.focusGroup.add(this.ring);
    this._pulse = 0;
  }

  clear(silent = false) {
    for (const s of this.saved) {
      s.object.material = s.orig;
      delete s.object.userData._hlOrig;
      const arr = Array.isArray(s.next) ? s.next : [s.next];
      arr.forEach(m => m.dispose());
    }
    this.saved.length = 0;
    if (this.ring) {
      this.ring.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.sm.focusGroup.remove(this.ring);
      this.ring = null;
    }
    if (!silent) {
      this.current = null;
      this.sm.setHighlightLight(new THREE.Vector3(0, 0, 0), 0);
    }
  }

  update(dt, camera) {
    if (!this.current || !this.ring) return;
    this._pulse += dt;
    const p = 0.5 + 0.5 * Math.sin(this._pulse * 2.1);
    this.ring.quaternion.copy(camera.quaternion);
    this.ring.scale.setScalar(1 + p * 0.022);
    const toCam = this._offset.copy(camera.position).sub(this._center).normalize();
    // 近景器官（花、气孔）必须按目标尺度衰减补光，否则白色花瓣会整体过曝
    const falloff = clamp(this._radius / 1.25, 0.10, 1.0);
    const lightPos = this._center.clone().addScaledVector(toCam, 0.35 + this._radius * 0.55);
    this.sm.setHighlightLight(lightPos, (1.1 + p * 0.5) * falloff);
  }
}
