/**
 * 全局尺度、层级定义与物候常量。
 * 世界单位：1 unit ≈ 0.5 m（模型为教学放大表达，微观结构非等比）。
 */

export const WORLD = {
  soilRadius: 5.2,
  soilDepth: 3.6,
  rootSpread: 4.35,
  trunkHeight: 3.05,
  trunkBaseRadius: 0.44,
  trunkTopRadius: 0.245,
  leaderTop: 6.72,
  canopyRadius: 3.55,
  goldenAngle: Math.PI * (3 - Math.sqrt(5)), // 137.5077° 黄金角
  fibonacci: [1, 1, 2, 3, 5, 8, 13, 21, 34, 55],
  defaultCamera: { x: 10.4, y: 5.9, z: 13.6 },
  defaultTarget: { x: 0, y: 2.05, z: 0 }
};

/** 器官分组：顺序即左侧导航顺序 */
export const GROUPS = [
  { id: 'root',    name: '地下根系',  en: 'ROOT SYSTEM',      color: '#c39a74' },
  { id: 'trunk',   name: '主干轴体',  en: 'TRUNK & BARK',     color: '#a98a68' },
  { id: 'branch',  name: '冠层分枝',  en: 'BRANCH HIERARCHY', color: '#c2a878' },
  { id: 'leaf',    name: '叶器',      en: 'FOLIAGE',          color: '#89d6a5' },
  { id: 'bud',     name: '芽',        en: 'BUDS',             color: '#d8c48d' },
  { id: 'flower',  name: '花器',      en: 'FLOWER',           color: '#f2b8c6' },
  { id: 'fruit',   name: '果实',      en: 'POME FRUIT',       color: '#e0806c' }
];

export const PHENO = {
  bloom: {
    label: '盛花期',
    note: '4 月中下旬，中心花先开，全树约 5–7 天盛花；自交不亲和，需授粉品种与传粉昆虫。',
    fruitScale: 0.0, fruitShow: 0, flowerShow: 1, leafTint: 0.82, fruitRipeness: 0
  },
  young: {
    label: '幼果期',
    note: '落花后 20–40 天，幼果细胞分裂与膨大，果面密被绒毛，萼片宿存直立。',
    fruitScale: 0.48, fruitShow: 1, flowerShow: 0, leafTint: 1.0, fruitRipeness: 0.12
  },
  mature: {
    label: '成熟期',
    note: '果实达到品种固有大小，淀粉转糖、酸度下降、花青苷积累，呼吸跃变启动。',
    fruitScale: 1.0, fruitShow: 1, flowerShow: 0, leafTint: 0.94, fruitRipeness: 1.0
  }
};

/** 昼夜光照关键帧：t(h) → 太阳高度角、方位、光色、强度、天空/环境色、雾 */
export const DAY_KEYS = [
  { t: 0,    elev: -0.62, azim: -1.9, sun: '#5573a5', sunI: 0.12, hemiSky: '#3a5878', hemiGround: '#101c22', hemiI: 0.64, bg: '#14253a', fog: '#1a2c40', exposure: 1.06 },
  { t: 5,    elev: -0.10, azim: -1.25, sun: '#b76b52', sunI: 0.25, hemiSky: '#556880', hemiGround: '#18211c', hemiI: 0.54, bg: '#26374a', fog: '#30404a', exposure: 1.02 },
  { t: 6.5,  elev: 0.18,  azim: -1.05, sun: '#ffb06a', sunI: 1.35, hemiSky: '#8fa8b0', hemiGround: '#2d3326', hemiI: 0.72, bg: '#5e7476', fog: '#6b7a70', exposure: 1.08 },
  { t: 9,    elev: 0.68,  azim: -0.62, sun: '#ffe6bd', sunI: 2.25, hemiSky: '#bcd8e2', hemiGround: '#4a5036', hemiI: 0.95, bg: '#8fb2bd', fog: '#b6c9b4', exposure: 1.12 },
  { t: 12,   elev: 1.30,  azim: 0.0,   sun: '#fff5e2', sunI: 2.85, hemiSky: '#c7e2ee', hemiGround: '#556040', hemiI: 1.05, bg: '#9fc2ce', fog: '#c2d2bc', exposure: 1.12 },
  { t: 15,   elev: 0.82,  azim: 0.62,  sun: '#ffdfab', sunI: 2.35, hemiSky: '#bdd6d2', hemiGround: '#4e5337', hemiI: 0.92, bg: '#a4bdb3', fog: '#aebfae', exposure: 1.1 },
  { t: 17.8, elev: 0.16,  azim: 1.12,  sun: '#ff9d5c', sunI: 1.55, hemiSky: '#a48a86', hemiGround: '#3a3127', hemiI: 0.66, bg: '#8a7060', fog: '#8d7665', exposure: 1.08 },
  { t: 19.3, elev: -0.12, azim: 1.35,  sun: '#c26a58', sunI: 0.35, hemiSky: '#6a7490', hemiGround: '#20242a', hemiI: 0.55, bg: '#404a60', fog: '#414c60', exposure: 1.03 },
  { t: 21,   elev: -0.48, azim: 1.6,   sun: '#5c76a8', sunI: 0.14, hemiSky: '#3d5c7e', hemiGround: '#121e22', hemiI: 0.66, bg: '#162a40', fog: '#1d3047', exposure: 1.05 },
  { t: 24,   elev: -0.62, azim: 1.9,   sun: '#5573a5', sunI: 0.12, hemiSky: '#3a5878', hemiGround: '#101c22', hemiI: 0.64, bg: '#14253a', fog: '#1a2c40', exposure: 1.06 }
];

export function timeLabel(t) {
  const h = Math.floor(t) % 24;
  const m = Math.floor((t - Math.floor(t)) * 60);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  let phase = '夜';
  if (t >= 5 && t < 6.6) phase = '日出';
  else if (t >= 6.6 && t < 11) phase = '晨光';
  else if (t >= 11 && t < 14.5) phase = '正午';
  else if (t >= 14.5 && t < 17.5) phase = '午后';
  else if (t >= 17.5 && t < 19.4) phase = '夕照';
  else if (t >= 19.4 && t < 21) phase = '暮色';
  return { time: `${hh}:${mm}`, phase, isNight: t < 5.6 || t > 19.6 };
}

/** 线性插值昼夜关键帧（返回可直接用于材质的颜色与数值） */
export function sampleDay(t) {
  const keys = DAY_KEYS;
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const span = Math.max(1e-6, b.t - a.t);
  const k = Math.max(0, Math.min(1, (t - a.t) / span));
  const s = k * k * (3 - 2 * k); // smoothstep
  const num = (key) => a[key] + (b[key] - a[key]) * s;
  const col = (key, A, B) => ({ A, B, k: s, key });
  return {
    elev: num('elev'), azim: num('azim'), sunI: num('sunI'),
    hemiI: num('hemiI'), exposure: num('exposure'),
    sun: col('sun', a.sun, b.sun),
    hemiSky: col('hemiSky', a.hemiSky, b.hemiSky),
    hemiGround: col('hemiGround', a.hemiGround, b.hemiGround),
    bg: col('bg', a.bg, b.bg),
    fog: col('fog', a.fog, b.fog),
    isNight: t < 5.4 || t > 19.8
  };
}
