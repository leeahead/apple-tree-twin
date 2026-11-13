import * as THREE from 'three';
import { WORLD } from './constants.js';

/**
 * 运镜：单一平滑弧线直达目标。
 *  · 位置 / 目标点 / 朝向 / 正交 zoom 全用同一条缓动曲线，不再各自为政
 *  · 全程 lookAt 当前目标点，落位即到位，收尾不做任何二次纠正
 *  · 结束时重建 OrbitControls 以清除拖拽阻尼残留，避免最后"闪一下"
 */
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const UP = new THREE.Vector3(0, 1, 0);

export class CameraDirector {
  constructor(sceneManager, callbacks = {}) {
    this.sm = sceneManager;
    this.cb = callbacks;
    this.active = null;
    this.targetPart = null;
    this._box = new THREE.Box3();
    this._size = new THREE.Vector3();
    this._center = new THREE.Vector3();
    this._aim = new THREE.Vector3();
  }

  get isFlying() { return this.active !== null; }

  /** 计算实例的世界包围盒中心与最佳观赏距离 */
  _focusOf(part, root) {
    const box = root && root.isObject3D ? this._box.setFromObject(root) : this._box.makeEmpty();
    if (box.isEmpty()) {
      this._center.copy(part.focus);
      this._size.set(0.3, 0.3, 0.3);
    } else {
      box.getCenter(this._center);
      box.getSize(this._size);
    }
    const maxDim = Math.max(this._size.x, this._size.y, this._size.z);
    return {
      center: this._center.clone(),
      distance: THREE.MathUtils.clamp(Math.max(part.distance, maxDim * 1.28), 0.42, 26)
    };
  }

  /** 单个弧线偏移量：sin(π·e) 包络保证起止偏移严格为 0，端点精确落位 */
  _arcOffset(startPos, endPos, strength = 1) {
    const chord = endPos.clone().sub(startPos);
    const len = chord.length();
    const flat = new THREE.Vector3(chord.x, 0, chord.z);
    const side = new THREE.Vector3(-flat.z, 0, flat.x);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const sign = (startPos.x + startPos.z) >= 0 ? 1 : -1;
    const arc = THREE.MathUtils.clamp(len * 0.085, 0.06, 1.0) * sign * strength;
    const lift = THREE.MathUtils.clamp(len * 0.045, 0.04, 0.6) * strength;
    return side.multiplyScalar(arc).addScaledVector(UP, lift);
  }

  flyTo(part, root, options = {}) {
    const sm = this.sm, cam = sm.camera;
    const { center, distance } = this._focusOf(part, root || {});
    const endPos = center.clone().addScaledVector(part.viewDir.clone().normalize(), distance);
    const startPos = cam.position.clone();
    const startTarget = sm.controls.target.clone();
    const halfAtDist = distance * Math.tan(THREE.MathUtils.degToRad(sm.persp.fov / 2));

    this.active = {
      kind: 'focus', part, root, center, distance,
      startPos, endPos, startTarget,
      offset: this._arcOffset(startPos, endPos),
      startZoom: cam.isOrthographicCamera ? cam.zoom : 1,
      endZoom: THREE.MathUtils.clamp(sm.orthoHalfHeight / Math.max(0.1, halfAtDist), 0.25, 3.4),
      duration: options.duration || 1.55,
      t: 0
    };
    this.targetPart = part;
    sm.setControlsEnabled(false);
    sm.clearFocus();
    this.cb.onStart?.(part, root);
  }

  reset(options = {}) {
    const sm = this.sm, cam = sm.camera;
    const endPos = new THREE.Vector3(WORLD.defaultCamera.x, WORLD.defaultCamera.y, WORLD.defaultCamera.z);
    const endTarget = new THREE.Vector3(WORLD.defaultTarget.x, WORLD.defaultTarget.y, WORLD.defaultTarget.z);
    const startPos = cam.position.clone();

    this.active = {
      kind: 'reset', center: endTarget, distance: startPos.distanceTo(endTarget),
      startPos, endPos, startTarget: sm.controls.target.clone(),
      offset: this._arcOffset(startPos, endPos, 0.75),
      startZoom: cam.isOrthographicCamera ? cam.zoom : 1,
      endZoom: 0.82,
      duration: options.duration || 1.35,
      t: 0
    };
    this.targetPart = null;
    sm.setControlsEnabled(false);
    sm.clearFocus();
    sm.setHighlightLight(new THREE.Vector3(0, 0, 0), 0);
    this.cb.onResetStart?.();
  }

  update(dt) {
    const a = this.active;
    if (!a) return;
    const sm = this.sm, cam = sm.camera;
    a.t = Math.min(1, a.t + dt / a.duration);
    const e = ease(a.t);

    // ① 位置：直线推进 + 一条温和弧线（起止偏移为 0）
    cam.position.copy(a.startPos).lerp(a.endPos, e)
      .addScaledVector(a.offset, Math.sin(Math.PI * e));

    // ② 目标点：同一缓动
    const aim = this._aim.copy(a.startTarget).lerp(a.center, e);
    sm.controls.target.copy(aim);

    // ③ 朝向：全程对准目标，不再独立 slerp，因此落位就是最终视角
    cam.lookAt(aim);

    // ④ 正交缩放与景深，同样跟随 e
    if (cam.isOrthographicCamera) {
      cam.zoom = THREE.MathUtils.lerp(a.startZoom, a.endZoom, e);
      cam.updateProjectionMatrix();
    }
    if (a.kind === 'focus') {
      sm.setFocus(cam.position.distanceTo(a.center), e);
      this.cb.onProgress?.(e, a.part);
    } else {
      sm.setFocus(18, 0);
    }

    if (a.t >= 1) {
      this.active = null;
      // 清掉上次拖拽/滚轮留下的阻尼量，避免 OrbitControls 在启用瞬间纠正相机
      sm.rebuildControls();
      cam.position.copy(a.endPos);
      sm.controls.target.copy(a.center);
      cam.lookAt(a.center);
      if (cam.isOrthographicCamera) { cam.zoom = a.endZoom; cam.updateProjectionMatrix(); }
      sm.setControlsEnabled(true);
      if (a.kind === 'focus') this.cb.onComplete?.(a.part, a.root);
      else this.cb.onResetComplete?.();
    }
  }
}
