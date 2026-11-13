import * as THREE from 'three';

let fallback = 0;
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  fallback += 1;
  return `malus-${Date.now().toString(16)}-${fallback.toString(16).padStart(6, '0')}`;
}

/**
 * 器官注册表：每个部位拥有独立 UUID、可交互对象集合、最佳观赏视角与知识键。
 * 一个「部位」可对应多个几何实例（例如 180 片叶），点击具体实例时聚焦该实例。
 */
export class TreeRegistry {
  constructor() {
    this.parts = new Map();
    this.byUuid = new Map();
    this.pickRoots = [];
    this._order = [];
    this.groups = new Map(); // 顶层器官组，用于分层拆解
  }

  registerGroup(groupId, object, basePosition = new THREE.Vector3()) {
    this.groups.set(groupId, { object, base: basePosition.clone() });
  }

  register(def) {
    if (this.parts.has(def.id)) return this.parts.get(def.id);
    const part = {
      id: def.id,
      uuid: uuid(),
      index: this._order.length + 1,
      label: def.label,
      latin: def.latin || '',
      group: def.group,
      summary: def.summary || '',
      tags: def.tags || [],
      metrics: def.metrics || [],
      objects: [],
      focus: def.focus ? def.focus.clone() : new THREE.Vector3(0, 2, 0),
      viewDir: (def.viewDir || new THREE.Vector3(0.7, 0.42, 1)).clone().normalize(),
      distance: def.distance || 2.2,
      flags: def.flags || {},
      color: def.color || '#e0b871',
      explodeGroup: def.group
    };
    this.parts.set(part.id, part);
    this.byUuid.set(part.uuid, part);
    this._order.push(part);
    if (def.objects) def.objects.forEach(o => this.attach(part.id, o));
    return part;
  }

  attach(id, object) {
    const part = this.parts.get(id);
    if (!part || !object) return;
    object.userData.partId = id;
    object.userData.partUuid = part.uuid;
    part.objects.push(object);
    if (!this.pickRoots.includes(object)) this.pickRoots.push(object);
  }

  /** 从射线命中的对象向上查找所属部位 */
  fromObject(object) {
    let o = object;
    while (o) {
      if (o.userData && o.userData.noPick) return null;
      if (o.userData && o.userData.partId) {
        return { part: this.parts.get(o.userData.partId) || null, object: o };
      }
      o = o.parent;
    }
    return null;
  }

  get(id) { return this.parts.get(id); }
  fromUuid(u) { return this.byUuid.get(u); }
  all() { return this._order; }
  count() { return this._order.length; }
  countObjects() { return this.pickRoots.length; }

  groupParts(groupId) { return this._order.filter(p => p.group === groupId); }

}
