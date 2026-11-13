import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './GeometryUtils.js';

function pbrSet(set, overrides = {}) {
  return {
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    normalScale: set.normalScale.clone(),
    ...overrides
  };
}

export class MaterialLibrary {
  constructor(lib) {
    this.lib = lib;
    this.m = {};
    this.fruitCanvas = null;
    this.fruitTexture = null;
    this._ripeness = 0.35;
    this._build();
  }

  _build() {
    const L = this.lib, m = this.m;

    /* ---- 轴体与树皮 ---- */
    m.bark = new THREE.MeshPhysicalMaterial(pbrSet(L.bark, {
      color: 0xffffff, roughness: 0.94, metalness: 0.0,
      bumpMap: L.bark.heightMap, bumpScale: 0.045,
      displacementMap: L.bark.heightMap, displacementScale: 0.016, displacementBias: -0.008,
      clearcoat: 0.04, clearcoatRoughness: 0.9,
      envMapIntensity: 0.75
    }));
    m.branchBark = new THREE.MeshPhysicalMaterial(pbrSet(L.branchBark, {
      color: 0xf2e7d4, roughness: 0.86, metalness: 0,
      bumpMap: L.branchBark.heightMap, bumpScale: 0.018,
      envMapIntensity: 0.8
    }));
    m.rootBark = new THREE.MeshStandardMaterial(pbrSet(L.rootBark, {
      color: 0xe6d0b6, roughness: 0.88, metalness: 0,
      bumpMap: L.rootBark.heightMap, bumpScale: 0.02,
      envMapIntensity: 0.7
    }));
    m.rootConducting = new THREE.MeshPhysicalMaterial(pbrSet(L.rootBark, {
      color: 0xd7b493, roughness: 0.82, metalness: 0, clearcoat: 0.12,
      envMapIntensity: 0.7
    }));
    m.rootGrowing = new THREE.MeshPhysicalMaterial({
      color: 0xe8cfa8, roughness: 0.55, metalness: 0,
      clearcoat: 0.35, clearcoatRoughness: 0.35,
      sheen: 0.4, sheenColor: new THREE.Color('#fff0d2'),
      envMapIntensity: 0.9
    });
    m.rootAbsorbing = new THREE.MeshPhysicalMaterial({
      color: 0xf6ead0, roughness: 0.42, metalness: 0,
      sheen: 0.85, sheenColor: new THREE.Color('#fff8e8'), sheenRoughness: 0.55,
      clearcoat: 0.42, clearcoatRoughness: 0.28,
      emissive: new THREE.Color('#5a4626'), emissiveIntensity: 0.12,
      envMapIntensity: 1.15
    });
    m.rootHair = new THREE.LineBasicMaterial({ color: 0xf3e6cc, transparent: true, opacity: 0.55, depthWrite: false });
    m.rootTipGlow = new THREE.MeshBasicMaterial({ color: 0xffe8bb, transparent: true, opacity: 0.32, depthWrite: false });

    m.wood = new THREE.MeshPhysicalMaterial(pbrSet(L.wood, {
      color: 0xffffff, roughness: 0.72, metalness: 0,
      transparent: true, alphaTest: 0.4, side: THREE.DoubleSide,
      bumpMap: L.wood.heightMap, bumpScale: 0.012,
      clearcoat: 0.12, envMapIntensity: 0.8
    }));
    m.cambium = new THREE.MeshStandardMaterial({
      color: 0xd9e8a8, roughness: 0.42, metalness: 0,
      emissive: 0x6a8038, emissiveIntensity: 0.22, side: THREE.DoubleSide
    });
    m.pith = new THREE.MeshStandardMaterial({ color: 0xb99a6a, roughness: 0.95 });
    m.graftUnion = new THREE.MeshStandardMaterial({ color: 0x9d7d58, roughness: 0.9 });

    /* ---- 叶器 ---- */
    m.leaf = new THREE.MeshPhysicalMaterial(pbrSet(L.leaf, {
      color: 0xffffff, roughness: 0.68, metalness: 0,
      side: THREE.DoubleSide,
      sheen: 0.6, sheenColor: new THREE.Color('#b9e08a'), sheenRoughness: 0.6,
      clearcoat: 0.22, clearcoatRoughness: 0.42,
      transmission: 0.0, envMapIntensity: 0.95
    }));
    m.leafBack = new THREE.MeshPhysicalMaterial(pbrSet(L.leafBack, {
      color: 0xdfe9d0, roughness: 0.78, metalness: 0,
      side: THREE.DoubleSide,
      sheen: 0.35, sheenColor: new THREE.Color('#a8c98a'),
      envMapIntensity: 0.8
    }));
    m.vein = new THREE.LineBasicMaterial({ color: 0xb6d18c, transparent: true, opacity: 0.5, depthWrite: false });
    m.veinMid = new THREE.LineBasicMaterial({ color: 0xd0e0a4, transparent: true, opacity: 0.65, depthWrite: false });
    m.stomata = new THREE.PointsMaterial({
      color: 0xd7efb2, size: 0.011, sizeAttenuation: true,
      transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending
    });
    m.petiole = new THREE.MeshStandardMaterial({ color: 0x8fae59, roughness: 0.72, metalness: 0 });

    /* ---- 芽 ---- */
    m.budScale = new THREE.MeshPhysicalMaterial(pbrSet(L.budScale, {
      color: 0xffffff, roughness: 0.86, metalness: 0, side: THREE.DoubleSide,
      sheen: 0.45, sheenColor: new THREE.Color('#e8d2a4'),
      bumpMap: L.budScale.heightMap, bumpScale: 0.006
    }));
    m.budLeaf = new THREE.MeshStandardMaterial({ color: 0x7a8f4c, roughness: 0.82, side: THREE.DoubleSide });
    m.budFlower = new THREE.MeshStandardMaterial({ color: 0xa87a58, roughness: 0.86, side: THREE.DoubleSide });
    m.budHair = new THREE.LineBasicMaterial({ color: 0xe6d6b4, transparent: true, opacity: 0.42, depthWrite: false });

    /* ---- 花器 ---- */
    m.petal = new THREE.MeshPhysicalMaterial({
      map: L.petal.map, normalMap: L.petal.normalMap, normalScale: L.petal.normalScale.clone(),
      roughnessMap: L.petal.roughnessMap,
      vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide,
      sheen: 0.85, sheenColor: new THREE.Color('#ffd9e2'), sheenRoughness: 0.7,
      clearcoat: 0.1, clearcoatRoughness: 0.7,
      emissive: new THREE.Color('#4a2630'), emissiveIntensity: 0.06,
      envMapIntensity: 1.0
    });
    m.sepal = new THREE.MeshPhysicalMaterial({
      color: 0x8fae5c, roughness: 0.78, side: THREE.DoubleSide,
      sheen: 0.4, sheenColor: new THREE.Color('#c8dda0')
    });
    m.filament = new THREE.MeshStandardMaterial({ color: 0xfaf3e2, roughness: 0.6 });
    m.anther = new THREE.MeshPhysicalMaterial({
      color: 0xf2c14a, roughness: 0.55, metalness: 0,
      emissive: 0x8a5c08, emissiveIntensity: 0.35,
      sheen: 0.5, sheenColor: new THREE.Color('#ffe08a')
    });
    m.pollen = new THREE.PointsMaterial({ color: 0xffd873, size: 0.013, sizeAttenuation: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    m.pistil = new THREE.MeshStandardMaterial({ color: 0xe9e2b8, roughness: 0.55 });
    m.stigma = new THREE.MeshPhysicalMaterial({ color: 0xbcd86a, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    m.ovary = new THREE.MeshStandardMaterial({ color: 0x9bb46a, roughness: 0.68 });
    m.receptacle = new THREE.MeshStandardMaterial({ color: 0xb9c77c, roughness: 0.72 });

    /* ---- 果实：动态混合幼果 / 成熟表皮 ---- */
    const yc = L.appleYoung.map.image, mc = L.appleMature.map.image;
    const W = yc.width, H = yc.height;
    this._yData = yc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    this._mData = mc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const blend = document.createElement('canvas');
    blend.width = W; blend.height = H;
    this.fruitCanvas = blend;
    this._blendCtx = blend.getContext('2d');
    this._blendData = this._blendCtx.createImageData(W, H);
    this.fruitTexture = new THREE.CanvasTexture(blend);
    this.fruitTexture.colorSpace = THREE.SRGBColorSpace;
    this.fruitTexture.wrapS = this.fruitTexture.wrapT = THREE.RepeatWrapping;
    this.fruitTexture.anisotropy = 8;

    m.fruit = new THREE.MeshPhysicalMaterial({
      map: this.fruitTexture,
      normalMap: L.appleMature.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: L.appleMature.roughnessMap,
      bumpMap: L.appleMature.heightMap, bumpScale: 0.008,
      roughness: 1.0, metalness: 0,
      clearcoat: 0.52, clearcoatRoughness: 0.16,
      sheen: 0.2, sheenColor: new THREE.Color('#fff0cf'),
      envMapIntensity: 0.92
    });
    m.fruitWax = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, transparent: true, opacity: 0.11,
      roughness: 0.04, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.02,
      envMapIntensity: 1.25, depthWrite: false, side: THREE.FrontSide
    });
    m.pedicel = new THREE.MeshStandardMaterial({ color: 0x8a7042, roughness: 0.86 });
    m.calyx = new THREE.MeshStandardMaterial({ color: 0x6f7d48, roughness: 0.88, side: THREE.DoubleSide });
    m.seed = new THREE.MeshPhysicalMaterial({ color: 0x6b3d22, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.25 });
    m.flesh = new THREE.MeshPhysicalMaterial({
      color: 0xf3ecd2, roughness: 0.82,
      sheen: 0.3, sheenColor: new THREE.Color('#fff5d8'), side: THREE.DoubleSide
    });
    m.core = new THREE.MeshStandardMaterial({ color: 0xd8c9a2, roughness: 0.9, side: THREE.DoubleSide });

    /* ---- 土壤与环境 ---- */
    m.soilTop = new THREE.MeshStandardMaterial(pbrSet(L.soilTop, {
      color: 0xffffff, roughness: 0.98, metalness: 0, side: THREE.DoubleSide,
      bumpMap: L.soilTop.heightMap, bumpScale: 0.035
    }));
    m.soilSection = new THREE.MeshStandardMaterial(pbrSet(L.soilSection, {
      color: 0xffffff, roughness: 0.98, metalness: 0, side: THREE.DoubleSide,
      bumpMap: L.soilSection.heightMap, bumpScale: 0.04
    }));
    m.grass = new THREE.MeshStandardMaterial({ color: 0x6f8c4a, roughness: 0.9, side: THREE.DoubleSide });
    m.fallenLeaf = new THREE.MeshStandardMaterial({ color: 0xa4743c, roughness: 0.95, side: THREE.DoubleSide });
    m.gravel = new THREE.MeshStandardMaterial({ color: 0x8b8574, roughness: 0.95 });

    /* ---- 辅助 / 标注 ---- */
    m.marker = new THREE.MeshBasicMaterial({ color: 0xe0b871, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    m.markerLine = new THREE.LineBasicMaterial({ color: 0xe0b871, transparent: true, opacity: 0.85, depthWrite: false });
    m.glow = new THREE.SpriteMaterial({ color: 0xffd89a, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });

    m.healthBad = new THREE.MeshStandardMaterial({ color: 0x8c5a3c, roughness: 0.95 });

    this.setRipeness(this._ripeness);
  }

  /** 0 = 幼果（青绿、绒毛），1 = 成熟（红条纹 + 蜡质） */
  setRipeness(t) {
    t = clamp(t, 0, 1);
    this._ripeness = t;
    // 幼果阶段保持青绿，着色主要发生在发育中后期
    const k = smoothstep(0.12, 1.0, t);
    const y = this._yData, mm = this._mData, out = this._blendData.data;
    for (let i = 0; i < out.length; i += 4) {
      out[i] = lerp(y[i], mm[i], k);
      out[i + 1] = lerp(y[i + 1], mm[i + 1], k);
      out[i + 2] = lerp(y[i + 2], mm[i + 2], k);
      out[i + 3] = 255;
    }
    this._blendCtx.putImageData(this._blendData, 0, 0);
    this.fruitTexture.needsUpdate = true;
    this.m.fruit.roughness = lerp(2.35, 0.92, k);
    this.m.fruit.clearcoat = lerp(0.08, 0.68, k);
    this.m.fruit.clearcoatRoughness = lerp(0.62, 0.07, k);
    this.m.fruitWax.opacity = lerp(0.0, 0.13, k);
    this.m.fruit.normalScale.setScalar(lerp(1.5, 0.85, k));
  }

  /** 昼夜：夜间降低叶片反射、强化气孔标记的对比 */
  setNight(f) {
    const m = this.m;
    m.leaf.clearcoat = lerp(0.22, 0.08, f);
    m.leaf.sheen = lerp(0.6, 0.3, f);
    m.leaf.envMapIntensity = lerp(0.95, 0.45, f);
    m.petal.emissiveIntensity = lerp(0.06, 0.2, f);
    m.anther.emissiveIntensity = lerp(0.35, 0.6, f);
    m.rootAbsorbing.emissiveIntensity = lerp(0.12, 0.24, f);
  }

  /** 叶表皮观察模式：切换到下表皮气孔贴图 */
  setStomataView(on) {
    this.m.leaf.map = on ? this.lib.leafBack.map : this.lib.leaf.map;
    this.m.leaf.normalMap = on ? this.lib.leafBack.normalMap : this.lib.leaf.normalMap;
    this.m.leaf.roughnessMap = on ? this.lib.leafBack.roughnessMap : this.lib.leaf.roughnessMap;
    this.m.leaf.needsUpdate = true;
    this.m.stomata.opacity = on ? 0.95 : 0.0;
  }

  get(name) { return this.m[name]; }
}
