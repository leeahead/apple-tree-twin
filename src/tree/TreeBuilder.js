import * as THREE from 'three';
import { GROUPS, PHENO } from '../core/constants.js';
import { getKnowledge } from '../data/knowledge.js';
import { mulberry32, clamp, lerp } from '../core/GeometryUtils.js';
import { buildRootSystem } from './RootSystem.js';
import { buildTrunk } from './Trunk.js';
import { buildBranches } from './Branches.js';
import { buildLeaves } from './Leaves.js';
import { buildBuds } from './Buds.js';
import { buildFlowers } from './Flowers.js';
import { buildFruits } from './Fruits.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * 每个部位的最佳观赏视角（从目标指向相机的方向）与推近距离。
 * 实际聚焦距离会由 CameraDirector 依据实例包围盒再做自适应。
 */
const PART_DEFS = [
  { id: 'root-taproot',      group: 'root',   viewDir: V(0.9, -0.15, 1.0), distance: 3.0, color: '#c39a74' },
  { id: 'root-conducting',   group: 'root',   viewDir: V(0.8, -0.28, 1.1), distance: 3.8, color: '#c39a74' },
  { id: 'root-growing',      group: 'root',   viewDir: V(0.9, -0.20, 1.0), distance: 2.4, color: '#d8b48d' },
  { id: 'root-absorbing',    group: 'root',   viewDir: V(0.7, -0.30, 1.2), distance: 1.5, color: '#ead6b4' },
  { id: 'root-hair',         group: 'root',   viewDir: V(0.6, -0.15, 1.2), distance: 0.8, color: '#f0e2c6' },
  { id: 'root-collar',       group: 'root',   viewDir: V(0.9, 0.30, 1.1),  distance: 1.1, color: '#c39a74' },

  { id: 'trunk-body',        group: 'trunk',  viewDir: V(0.85, 0.18, 1.0), distance: 4.0, color: '#a98a68' },
  { id: 'trunk-bark',        group: 'trunk',  viewDir: V(0.95, 0.20, 0.85), distance: 0.9, color: '#c2a07a' },
  { id: 'trunk-cambium',     group: 'trunk',  viewDir: V(1.0, 0.15, 0.80), distance: 0.85, color: '#a8cf7a' },
  { id: 'trunk-annualring',  group: 'trunk',  viewDir: V(0.45, 0.88, 0.90), distance: 1.7, color: '#d9b676' },

  { id: 'branch-leader',     group: 'branch', viewDir: V(0.8, 0.35, 1.0), distance: 4.2, color: '#c2a878' },
  { id: 'branch-primary',    group: 'branch', viewDir: V(0.8, 0.40, 1.0), distance: 2.8, color: '#c2a878' },
  { id: 'branch-secondary',  group: 'branch', viewDir: V(0.7, 0.45, 1.0), distance: 2.1, color: '#cbb287' },
  { id: 'branch-tertiary',   group: 'branch', viewDir: V(0.6, 0.50, 1.1), distance: 1.5, color: '#d3bd94' },
  { id: 'branch-shoot',      group: 'branch', viewDir: V(0.5, 0.60, 1.1), distance: 0.95, color: '#d8c69c' },

  { id: 'leaf-blade',        group: 'leaf',   viewDir: V(0.55, 0.65, 1.0), distance: 0.70, color: '#89d6a5' },
  { id: 'leaf-vein',         group: 'leaf',   viewDir: V(0.35, 0.85, 0.9), distance: 0.52, color: '#b7e08a' },
  { id: 'leaf-stomata',      group: 'leaf',   viewDir: V(0.35, -0.55, 1.0), distance: 0.42, color: '#d7efb2', flags: { stomataView: true } },
  { id: 'leaf-petiole',      group: 'leaf',   viewDir: V(0.8, 0.40, 1.0), distance: 0.42, color: '#9fbd68' },

  { id: 'bud-leaf',          group: 'bud',    viewDir: V(0.8, 0.40, 1.0), distance: 0.44, color: '#d8c48d' },
  { id: 'bud-flower',        group: 'bud',    viewDir: V(0.75, 0.45, 1.0), distance: 0.48, color: '#e3b98f' },
  { id: 'bud-scale',         group: 'bud',    viewDir: V(0.6, 0.50, 1.1), distance: 0.34, color: '#e6d4a8' },

  { id: 'flower-petal',      group: 'flower', viewDir: V(0.40, 0.88, 1.0), distance: 1.05, color: '#f2b8c6' },
  { id: 'flower-stamen',     group: 'flower', viewDir: V(0.30, 0.92, 0.9), distance: 0.66, color: '#f2cf78' },
  { id: 'flower-pistil',     group: 'flower', viewDir: V(0.35, 0.92, 0.9), distance: 0.60, color: '#c8dd8f' },
  { id: 'flower-sepal',      group: 'flower', viewDir: V(0.50, -0.55, 1.0), distance: 0.74, color: '#9fc177' },

  { id: 'fruit-body',        group: 'fruit',  viewDir: V(0.7, 0.35, 1.0), distance: 0.90, color: '#e0806c' },
  { id: 'fruit-pedicel',     group: 'fruit',  viewDir: V(0.8, 0.60, 0.9), distance: 0.48, color: '#b99a62' },
  { id: 'fruit-stemcavity',  group: 'fruit',  viewDir: V(0.40, 0.95, 0.8), distance: 0.45, color: '#d8b06a' },
  { id: 'fruit-calyxbasin',  group: 'fruit',  viewDir: V(0.40, -0.92, 0.9), distance: 0.48, color: '#9fb36a' },
  { id: 'fruit-wax',         group: 'fruit',  viewDir: V(0.6, 0.50, 1.0), distance: 0.58, color: '#f3d3b0' },
  { id: 'fruit-seed',        group: 'fruit',  viewDir: V(0.45, 0.88, 0.95), distance: 1.5, color: '#c9a97e' }
];

export class TreeBuilder {
  constructor(materials, registry, worldGroup) {
    this.materials = materials;
    this.registry = registry;
    this.worldGroup = worldGroup;
    this.groups = {};
    for (const g of GROUPS) {
      const gr = new THREE.Group();
      gr.name = `organ:${g.id}`;
      worldGroup.add(gr);
      this.groups[g.id] = gr;
      registry.registerGroup(g.id, gr, new THREE.Vector3());
    }
    this.ctx = {
      materials, registry, groups: this.groups,
      rand: mulberry32(20261112), info: {}
    };
    this.stage = 'young';
    this.ripeness = 0.35;
  }

  build() {
    // 先注册部位定义，几何模块才能 attach 到对应 UUID
    for (const def of PART_DEFS) {
      const k = getKnowledge(def.id);
      this.registry.register({
        id: def.id, group: def.group,
        label: k.label, latin: k.latin, summary: k.summary,
        tags: k.tags, metrics: k.metrics,
        viewDir: def.viewDir, distance: def.distance,
        flags: def.flags || {}, color: def.color
      });
    }
    buildRootSystem(this.ctx);
    buildTrunk(this.ctx);
    buildBranches(this.ctx);
    buildLeaves(this.ctx);
    buildBuds(this.ctx);
    buildFlowers(this.ctx);
    buildFruits(this.ctx);
    this._computeFoci();
    this.setPheno('young');
    return this.ctx.info;
  }

  _computeFoci() {
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    for (const part of this.registry.all()) {
      box.makeEmpty();
      for (const o of part.objects) {
        if (!o || !o.isObject3D) continue;
        tmp.setFromObject(o);
        if (!tmp.isEmpty()) box.union(tmp);
      }
      if (!box.isEmpty()) box.getCenter(part.focus);
    }
  }

  /* ---------------- 物候 ---------------- */
  setPheno(stage) {
    const p = PHENO[stage] || PHENO.young;
    this.stage = stage;
    const info = this.ctx.info;
    if (info.flowerCluster) info.flowerCluster.visible = p.flowerShow > 0;
    (info.fruitGroups || []).forEach(f => { f.group.visible = p.fruitShow > 0; });
    if (info.fruitSection) info.fruitSection.visible = true;
    const leaf = this.materials.get('leaf');
    leaf.color.setRGB(0.90 + p.leafTint * 0.10, 0.93 + p.leafTint * 0.07, 0.90 + p.leafTint * 0.10);
    const defaultT = stage === 'bloom' ? 0 : (stage === 'mature' ? 1.0 : 0.35);
    this.setRipeness(defaultT);
    return { ...p, defaultRipeness: defaultT };
  }

  setRipeness(t) {
    t = clamp(t, 0, 1);
    this.ripeness = t;
    this.materials.setRipeness(t);
    const scale = lerp(0.42, 1.0, t);
    this.ctx.setFruitGrowth?.(t, this.stage === 'bloom' ? 0.42 : scale);
  }

  /* ---------------- 昼夜 ---------------- */
  setDayNight(night, t = 0) {
    this.ctx.leafDayNight?.(night, t);
    this.materials.setNight(night);
  }

  /* ---------------- 微观观察 ---------------- */
  setStomataView(on) {
    this.materials.setStomataView(on);
    (this.ctx.info.stomataPoints || []).forEach(p => { p.visible = on; });
  }

  get info() { return this.ctx.info; }
}
