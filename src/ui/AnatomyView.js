/* ============================================================
   AnatomyView · 解剖剖面视图
   ------------------------------------------------------------
   设计取向：不再把整棵树的每一片叶 / 每一条根按器官组做物理位移
   （那样只是把原有模型拆散，看不到任何内部结构）。
   改为独立的「教学标本台」：仅取 3 个最具代表性的横切面
   —— 主干（次生结构）、吸收根（初生结构）、叶片（背腹型叶），
   以分层剖面图 / 分层爆炸图呈现，并用引线标注各层名称。
   所有标注位置固定、引线随所属层移动，因此爆炸展开时不会错位。
   ============================================================ */

const $ = (id) => document.getElementById(id);
const f = (n) => Number(Number(n).toFixed(2));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/** 斜视椭圆标本盘参数（伪 3D：顶面为横切面，下方为切块厚度） */
const DISC = { cx: 448, cy: 372, R: 226, RY: 86, depth: 22 };
/** 叶片横切块参数（左右留出标注通道，文字绝不压在切面上） */
const BLOCK = { x0: 256, x1: 644, shift: 18, drop: 14 };

/* ---------------- 颜色工具 ---------------- */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt > 0 ? 255 : 0, a = Math.abs(amt);
  r = Math.round(r + (t - r) * a);
  g = Math.round(g + (t - g) * a);
  b = Math.round(b + (t - b) * a);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/* ---------------- 标本数据 ---------------- */
const SPECS = [
  {
    id: 'stem', no: '01', name: '主干横断面', en: 'STEM · SECONDARY GROWTH',
    sub: '多年生木质茎 / 次生结构', kind: 'disc',
    intro: '苹果主干经维管形成层连年活动形成次生结构。自外向内依次为周皮、韧皮部、形成层、木质部与髓：木质部导管向上输导水分与矿质，韧皮部筛管向下输导光合产物，两者之间仅隔一层形成层细胞。',
    meta: [['切面方向', '横切面 T.S.'], ['结构类型', '次生生长'], ['图示尺度', '教学放大 × 8']],
    tip: '形成层是嫁接成活的关键：砧木与接穗的形成层必须紧密贴合才能愈合并重建维管连接。',
    extras: [
      '髓射线：径向贯穿木质部与韧皮部，承担横向运输与养分贮藏。',
      '年轮：早材腔大壁薄、晚材致密，二者交替形成可辨认的生长轮；苹果幼树年轮界限常不清晰。',
      '韧皮部被环状剥皮后会中断向根输送同化物，是环剥促花原理的解剖学基础。'
    ],
    bands: [
      { o: 1.000, i: 0.860, c: '#70543c', s: '#4a3627', tex: 'bark' },
      { o: 0.860, i: 0.700, c: '#c08b57', s: '#8b6038', tex: 'phloem' },
      { o: 0.700, i: 0.652, c: '#d9d68c', s: '#9c9a5c', tex: 'cambium' },
      { o: 0.652, i: 0.240, c: '#c9a369', s: '#8f6b44', tex: 'xylem' },
      { o: 0.240, i: 0.000, c: '#e2d0a7', s: '#b09c76', tex: 'pith' }
    ],
    labels: [
      { no: '01', band: 0, side: 'r', slot: 0, theta: -1.02, c: '#70543c', zh: '周皮 / 树皮', la: 'Periderm', brief: '木栓化保护层 · 皮孔通气', desc: '由木栓层、木栓形成层与栓内层构成，取代表皮承担保护功能。外皮粗糙开裂，皮孔是茎与外界交换气体的通道；老树皮内侧还包含历年累积的死韧皮部。' },
      { no: '02', band: 1, side: 'l', slot: 0, theta: Math.PI + 1.02, c: '#c08b57', zh: '韧皮部', la: 'Phloem', brief: '筛管输送光合产物', desc: '筛管分子与伴胞构成纵向运输通道，把叶片合成的同化物输送至根、果实与生长点。筛板可沉积胼胝质调节流量；韧皮纤维与薄壁细胞兼有支持与贮藏作用。' },
      { no: '03', band: 2, side: 'r', slot: 1, theta: -0.70, c: '#d9d68c', zh: '维管形成层', la: 'Vascular cambium', brief: '向内生木质部 · 向外生韧皮部', desc: '仅一至数层细胞的侧生分生组织，向内分化次生木质部、向外分化次生韧皮部，使茎逐年加粗。春季活动旺盛，形成层易于剥离，是芽接与枝接适宜期的生理依据。' },
      { no: '04', band: 3, side: 'l', slot: 1, theta: Math.PI + 0.70, c: '#c9a369', zh: '木质部', la: 'Xylem', brief: '导管输水 · 年轮 · 机械支持', desc: '由导管、管胞、木纤维与木薄壁组织组成，承担自根向上的水分与矿质运输以及树体机械支持。早材与晚材交替形成生长轮；心材导管常被侵填体堵塞而失去输导能力。' },
      { no: '05', band: 4, side: 'r', slot: 2, theta: -0.38, c: '#e2d0a7', zh: '髓', la: 'Pith', brief: '中央薄壁组织 · 贮藏', desc: '茎最中央的薄壁组织，幼茎期贮藏淀粉与水分，随次生加粗多被挤压、部分木质化。髓与皮层之间通过髓射线保持横向联系。' }
    ]
  },
  {
    id: 'root', no: '02', name: '吸收根横断面', en: 'ROOT · PRIMARY GROWTH',
    sub: '幼嫩吸收根 / 初生结构', kind: 'disc',
    intro: '苹果的吸收根以初生结构为主：表皮特化为根毛区，皮层发达，内皮层以凯氏带强制水分进入共质体，中央中柱内初生木质部呈星芒状外始式，初生韧皮部位于木质部臂之间。',
    meta: [['切面方向', '根毛区横切面'], ['结构类型', '初生生长'], ['图示尺度', '教学放大 × 60']],
    tip: '苹果栽培中真正承担吸收的是白色新生根；其吸收能力高度依赖根际氧气，故忌积水与土壤板结。',
    extras: [
      '凯氏带：内皮层径向壁上的栓质加厚，阻断质外体运输，迫使水与离子经细胞膜选择性进入中柱。',
      '中柱鞘：保留分生能力，是侧根原基的发生位置；侧根由此内生，需穿过皮层与表皮。',
      '外始式：初生木质部由外向内成熟，原生木质部位于星芒尖端，利于短距离横向吸水。'
    ],
    bands: [
      { o: 1.000, i: 0.930, c: '#d8c39c', s: '#a58d68', tex: 'roothair' },
      { o: 0.930, i: 0.600, c: '#b7a175', s: '#837051', tex: 'cortex' },
      { o: 0.600, i: 0.530, c: '#8fae74', s: '#637c50', tex: 'endodermis' },
      { o: 0.530, i: 0.455, c: '#d0c08a', s: '#968a5e', tex: 'pericycle' },
      { o: 0.455, i: 0.320, c: '#c08b57', s: '#8b6038', tex: 'phloem' },
      { o: 0.320, i: 0.000, c: '#c9a369', s: '#8f6b44', tex: 'xylemStar' }
    ],
    labels: [
      { no: '01', band: 0, side: 'r', slot: 0, theta: -1.02, c: '#d8c39c', zh: '根毛 / 表皮', la: 'Rhizodermis', brief: '无角质层 · 扩大吸收面积', desc: '表皮细胞不具角质层，部分细胞向外突起形成根毛，是水分与矿质吸收的主要界面。根毛寿命通常仅数天至数周，随根老化而脱落，吸收功能转由新根承担。' },
      { no: '02', band: 1, side: 'l', slot: 0, theta: Math.PI + 1.02, c: '#b7a175', zh: '皮层', la: 'Cortex', brief: '薄壁细胞 · 通气与贮藏', desc: '由多层大型薄壁细胞构成，胞间隙发达，承担水分横向运输、通气与淀粉贮藏。皮层占幼根横切面积的大部分，是根际缺氧时最先受累的组织之一。' },
      { no: '03', band: 2, side: 'r', slot: 1, theta: -0.70, c: '#8fae74', zh: '内皮层', la: 'Endodermis', brief: '凯氏带 · 选择性屏障', desc: '皮层最内一层细胞，径向壁与横向壁具栓质化的凯氏带，阻断水分沿细胞壁自由进入中柱，使离子必须经细胞膜选择吸收，防止中柱内养分倒流。' },
      { no: '04', band: 3, side: 'l', slot: 1, theta: Math.PI + 0.70, c: '#d0c08a', zh: '中柱鞘', la: 'Pericycle', brief: '侧根发生处', desc: '紧贴内皮层的一至数层薄壁细胞，保留分生潜能：侧根原基由此起始并内生穿过皮层；在次生生长中亦参与形成层与木栓形成层的建立。' },
      { no: '05', band: 4, side: 'r', slot: 2, theta: -0.38, c: '#c08b57', zh: '初生韧皮部', la: 'Primary phloem', brief: '位于木质部臂之间', desc: '成束分布于星芒状木质部的臂间，负责把地上部同化物输送至根尖分生区与根毛区，供根系生长与主动吸收所需能量。' },
      { no: '06', band: 5, side: 'l', slot: 2, theta: Math.PI + 0.38, c: '#c9a369', zh: '初生木质部', la: 'Primary xylem', brief: '星芒状 · 外始式', desc: '横切面呈星芒状，成熟方向由外向内（外始式），原生木质部位于星芒尖端，缩短皮层到输导组织的横向距离。中央少量薄壁组织可形成髓。' }
    ]
  },
  {
    id: 'leaf', no: '03', name: '叶片横断面', en: 'LEAF · DORSOVENTRAL',
    sub: '背腹型叶 / 异面叶', kind: 'rect',
    intro: '苹果叶为典型的背腹型（异面）叶：上表面接受强光，栅栏组织紧密排列、叶绿体密集；下表面胞间隙发达，气孔主要分布于下表皮。叶脉维管束中木质部朝上、韧皮部朝下，与茎的维管系统连续。',
    meta: [['切面方向', '过主脉横切面'], ['结构类型', '背腹型叶'], ['图示尺度', '教学放大 × 200']],
    tip: '苹果为下生气孔型：气孔集中于下表皮，这也是多数叶面肥与叶部病害从叶背侵入更容易的解剖原因。',
    extras: [
      '角质层：覆盖上表皮的蜡质膜，限制非气孔性失水，并影响叶面肥与药剂的润湿展着。',
      '栅栏 / 海绵组织分化受光强调控：树冠内膛弱光叶栅栏组织较薄，是修剪改善冠层光照的解剖依据。',
      '维管束鞘：包裹叶脉的薄壁细胞层，参与韧皮部装载与同化物向叶肉的分配。'
    ],
    bands: [
      { y0: 158, y1: 200, c: '#9fc486', s: '#6b8a58', tex: 'upperEpi' },
      { y0: 200, y1: 292, c: '#5f9c5d', s: '#3f6c3f', tex: 'palisade' },
      { y0: 292, y1: 384, c: '#7fb077', s: '#517a4d', tex: 'spongy' },
      { y0: 384, y1: 426, c: '#9fc486', s: '#6b8a58', tex: 'lowerEpi' }
    ],
    labels: [
      { no: '01', band: 0, side: 'r', slot: 0, ax: 612, ay: 178, c: '#c9e0a8', zh: '角质层 / 上表皮', la: 'Cuticle & upper epidermis', brief: '蜡质膜 · 无气孔', desc: '上表皮为一层排列紧密、无叶绿体的扁平细胞，外侧覆有角质层与蜡质，起保水与防护作用。苹果叶上表皮通常不具气孔，气体交换主要交给叶背。' },
      { no: '02', band: 1, side: 'l', slot: 0, ax: 292, ay: 220, c: '#4f9450', zh: '栅栏组织', la: 'Palisade mesophyll', brief: '柱状细胞 · 主光合场所', desc: '紧贴上表皮的一至二层长柱形薄壁细胞，排列整齐、叶绿体密集，是光合作用的主要场所。其层数与厚度随冠层光照条件变化，可作为树体受光状况的形态指标。' },
      { no: '03', band: 2, side: 'r', slot: 1, ax: 612, ay: 314, c: '#7fb077', zh: '海绵组织', la: 'Spongy mesophyll', brief: '胞间隙发达 · 气体扩散', desc: '形状不规则、排列疏松的薄壁细胞，胞间隙彼此连通并与气孔下室相接，构成二氧化碳扩散与水汽蒸腾的内部通道，也进行一定程度的光合作用。' },
      { no: '04', band: 2, side: 'l', slot: 1, ax: 420, ay: 322, c: '#c9a369', zh: '木质部（叶脉）', la: 'Xylem · vascular bundle', brief: '朝上 · 供水与矿质', desc: '叶脉维管束的上半部，导管把根吸收的水分与矿质送入叶肉，同时为蒸腾流提供通道。与茎、根的木质部连续，构成贯穿全株的输水网络。' },
      { no: '05', band: 2, side: 'r', slot: 2, ax: 492, ay: 360, c: '#c08b57', zh: '韧皮部（叶脉）', la: 'Phloem · vascular bundle', brief: '朝下 · 输出同化物', desc: '叶脉维管束的下半部，筛管与伴胞把叶肉合成的同化物装载后输出至果实、新梢与根系。维管束外包维管束鞘，参与装载与短距离分配。' },
      { no: '06', band: 3, side: 'l', slot: 2, ax: 292, ay: 404, c: '#c9e0a8', zh: '下表皮与气孔器', la: 'Lower epidermis & stomata', brief: '保卫细胞 · 下生气孔', desc: '下表皮细胞间分布气孔器，由一对肾形保卫细胞围成孔隙，下方为孔下室。苹果气孔主要位于下表皮（下生气孔型），通过调节开度平衡二氧化碳吸收与水分散失。' }
    ]
  }
];

/* ---------------- SVG 几何原语 ---------------- */
const K = 0.55228475;

function ellipseD(cx, cy, rx, ry) {
  if (rx <= 0.1 || ry <= 0.1) return '';
  return `M ${f(cx - rx)} ${f(cy)} ` +
    `C ${f(cx - rx)} ${f(cy - ry * K)} ${f(cx - rx * K)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} ` +
    `C ${f(cx + rx * K)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * K)} ${f(cx + rx)} ${f(cy)} ` +
    `C ${f(cx + rx)} ${f(cy + ry * K)} ${f(cx + rx * K)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} ` +
    `C ${f(cx - rx * K)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * K)} ${f(cx - rx)} ${f(cy)} Z`;
}

function ringD(cx, cy, rx, ry, inx, iny) {
  return ellipseD(cx, cy, rx, ry) + ' ' + ellipseD(cx, cy, inx, iny);
}

function sideD(cx, cy, rx, ry, d) {
  return `M ${f(cx - rx)} ${f(cy)} ` +
    `C ${f(cx - rx)} ${f(cy + ry * K)} ${f(cx - rx * K)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} ` +
    `C ${f(cx + rx * K)} ${f(cy + ry)} ${f(cx + rx)} ${f(cy + ry * K)} ${f(cx + rx)} ${f(cy)} ` +
    `L ${f(cx + rx)} ${f(cy + d)} ` +
    `C ${f(cx + rx)} ${f(cy + d + ry * K)} ${f(cx + rx * K)} ${f(cy + d + ry)} ${f(cx)} ${f(cy + d + ry)} ` +
    `C ${f(cx - rx * K)} ${f(cy + d + ry)} ${f(cx - rx)} ${f(cy + d + ry * K)} ${f(cx - rx)} ${f(cy + d)} Z`;
}

/** 椭圆环带内的一点（ratio 为相对外半径，ang 为弧度） */
function polar(ratio, ang) {
  return {
    x: DISC.cx + ratio * DISC.R * Math.cos(ang),
    y: DISC.cy + ratio * DISC.RY * Math.sin(ang)
  };
}

/* ---------------- 组织纹理 ---------------- */
function discTexture(band, i) {
  const rand = lcg(9137 + i * 331);
  const r0 = band.i, r1 = band.o, rm = (r0 + r1) / 2;
  let s = '';

  // 通用：细密的组织颗粒
  const grains = band.tex === 'cambium' || band.tex === 'pericycle' ? 0 : 26;
  for (let k = 0; k < grains; k++) {
    const r = r0 + (r1 - r0) * (0.18 + rand() * 0.64);
    const a = rand() * Math.PI * 2;
    const p = polar(r, a);
    const rr = 1.1 + rand() * 1.9;
    s += `<ellipse cx="${f(p.x)}" cy="${f(p.y)}" rx="${f(rr)}" ry="${f(rr * 0.42)}" fill="${shade(band.c, -0.34)}" opacity=".42"/>`;
  }

  if (band.tex === 'bark') {
    for (let k = 0; k < 52; k++) {
      const a = rand() * Math.PI * 2;
      const p1 = polar(0.965, a), p2 = polar(1.045, a + 0.012);
      s += `<path d="M ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)}" stroke="#3a2a1e" stroke-width="${f(0.8 + rand() * 1.7)}" opacity=".55" stroke-linecap="round"/>`;
    }
  }
  if (band.tex === 'roothair') {
    for (let k = 0; k < 66; k++) {
      const a = rand() * Math.PI * 2;
      const p1 = polar(1.0, a);
      const p2 = polar(1.12 + rand() * 0.09, a + (rand() - 0.5) * 0.05);
      const q = polar(1.07, a + (rand() - 0.5) * 0.07);
      s += `<path d="M ${f(p1.x)} ${f(p1.y)} Q ${f(q.x)} ${f(q.y)} ${f(p2.x)} ${f(p2.y)}" fill="none" stroke="#e0d0ab" stroke-width="1.1" opacity=".72" stroke-linecap="round"/>`;
    }
  }
  if (band.tex === 'phloem') {
    for (let k = 0; k < 64; k++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + (r1 - r0) * (0.2 + rand() * 0.6);
      const p = polar(r, a);
      s += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(1.5 + rand() * 1.7)}" fill="#f0d3a0" opacity=".55"/>`;
    }
  }
  if (band.tex === 'xylem') {
    // 年轮
    for (let k = 1; k <= 4; k++) {
      const r = r0 + (r1 - r0) * (k / 5);
      s += `<path d="${ellipseD(DISC.cx, DISC.cy, r * DISC.R, r * DISC.RY)}" fill="none" stroke="#7d5a37" stroke-width="1.1" opacity=".46"/>`;
    }
    // 导管腔
    for (let k = 0; k < 92; k++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + (r1 - r0) * (0.12 + rand() * 0.78);
      const p = polar(r, a);
      s += `<ellipse cx="${f(p.x)}" cy="${f(p.y)}" rx="${f(2.0 + rand() * 3.1)}" ry="${f(1.0 + rand() * 1.5)}" fill="#6d4c2c" opacity=".52"/>`;
    }
    // 髓射线
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      const p1 = polar(r0 + 0.01, a), p2 = polar(r1 - 0.01, a);
      s += `<path d="M ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)}" stroke="#f0dcae" stroke-width="0.9" opacity=".38"/>`;
    }
  }
  if (band.tex === 'xylemStar') {
    // 星芒状初生木质部（五原型）
    const arms = 5;
    for (let k = 0; k < arms; k++) {
      const a = (k / arms) * Math.PI * 2 - 0.3;
      const w = 0.30;
      const tip = polar(0.315, a);
      const l = polar(0.10, a - w), r = polar(0.10, a + w);
      s += `<path d="M ${f(l.x)} ${f(l.y)} L ${f(tip.x)} ${f(tip.y)} L ${f(r.x)} ${f(r.y)} Z" fill="#8a6138" opacity=".82"/>`;
      s += `<ellipse cx="${f(tip.x)}" cy="${f(tip.y)}" rx="3.2" ry="1.5" fill="#f0d9a8" opacity=".8"/>`;
    }
    s += `<path d="${ellipseD(DISC.cx, DISC.cy, 0.085 * DISC.R, 0.085 * DISC.RY)}" fill="#e3cfa2" opacity=".8"/>`;
  }
  if (band.tex === 'cortex' || band.tex === 'pith') {
    for (let k = 0; k < 46; k++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + (r1 - r0) * (0.14 + rand() * 0.72);
      const p = polar(r, a);
      s += `<ellipse cx="${f(p.x)}" cy="${f(p.y)}" rx="${f(3 + rand() * 4)}" ry="${f(1.4 + rand() * 1.6)}" fill="${shade(band.c, 0.24)}" opacity=".35"/>`;
    }
  }
  if (band.tex === 'endodermis' || band.tex === 'cambium' || band.tex === 'pericycle') {
    for (let k = 0; k < 44; k++) {
      const a = (k / 44) * Math.PI * 2;
      const p1 = polar(r0 + 0.004, a), p2 = polar(r1 - 0.004, a);
      s += `<path d="M ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)}" stroke="${shade(band.c, -0.42)}" stroke-width="0.9" opacity=".6"/>`;
    }
  }
  return s;
}

function rectTexture(band, i) {
  const rand = lcg(4471 + i * 719);
  const { x0, x1 } = BLOCK;
  const y0 = band.y0, y1 = band.y1, h = y1 - y0;
  let s = '';

  if (band.tex === 'upperEpi') {
    s += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="7" fill="#e5edc3" opacity=".72"/>`;
    for (let x = x0 + 4; x < x1 - 20; x += 38) {
      s += `<rect x="${f(x)}" y="${f(y0 + 12)}" width="34" height="${f(h - 18)}" rx="7" fill="#a9cf8d" stroke="#5f8a52" stroke-width=".9" opacity=".9"/>`;
    }
  }
  if (band.tex === 'lowerEpi') {
    for (let x = x0 + 4; x < x1 - 20; x += 38) {
      const isStoma = (Math.round((x - x0) / 38) % 3 === 1);
      if (isStoma) {
        const cx = x + 17, cy = y0 + h / 2;
        // 气孔下室
        s += `<ellipse cx="${f(cx)}" cy="${f(cy + 1)}" rx="13" ry="9" fill="#2c4a32" opacity=".65"/>`;
        // 一对保卫细胞
        s += `<path d="M ${f(cx - 12)} ${f(cy - 1)} Q ${f(cx - 5)} ${f(cy - 12)} ${f(cx - 2)} ${f(cy)} Q ${f(cx - 5)} ${f(cy + 12)} ${f(cx - 12)} ${f(cy + 1)} Z" fill="#b7d99a" stroke="#4d7a45" stroke-width=".8"/>`;
        s += `<path d="M ${f(cx + 12)} ${f(cy - 1)} Q ${f(cx + 5)} ${f(cy - 12)} ${f(cx + 2)} ${f(cy)} Q ${f(cx + 5)} ${f(cy + 12)} ${f(cx + 12)} ${f(cy + 1)} Z" fill="#b7d99a" stroke="#4d7a45" stroke-width=".8"/>`;
      } else {
        s += `<rect x="${f(x)}" y="${f(y0 + 7)}" width="34" height="${f(h - 14)}" rx="7" fill="#a9cf8d" stroke="#5f8a52" stroke-width=".9" opacity=".9"/>`;
      }
    }
  }
  if (band.tex === 'palisade') {
    for (let x = x0 + 8; x < x1 - 12; x += 21) {
      const w = 11 + rand() * 4, hh = h - 16 - rand() * 12;
      s += `<rect x="${f(x)}" y="${f(y0 + 7)}" width="${f(w)}" height="${f(hh)}" rx="5" fill="#4c9149" stroke="#2f6b35" stroke-width=".8" opacity=".92"/>`;
      for (let k = 0; k < 6; k++) {
        s += `<circle cx="${f(x + 3 + rand() * (w - 5))}" cy="${f(y0 + 14 + rand() * (hh - 12))}" r="1.7" fill="#a9d783" opacity=".75"/>`;
      }
    }
  }
  if (band.tex === 'spongy') {
    for (let k = 0; k < 96; k++) {
      const x = x0 + 12 + rand() * (x1 - x0 - 24);
      const y = y0 + 10 + rand() * (h - 20);
      // 中央主脉区域留白
      if (Math.abs(x - 450) < 78 && Math.abs(y - 338) < 48) continue;
      s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(7 + rand() * 8)}" ry="${f(5 + rand() * 6)}" fill="#6ba061" stroke="#3f7843" stroke-width=".8" opacity=".86"/>`;
    }
    // 主脉维管束：束鞘 + 上木质部 / 下韧皮部
    const cx = 450, cy = 338;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="72" ry="43" fill="#d7e2b4" stroke="#7f9a63" stroke-width="1.4" opacity=".94"/>`;
    for (let k = 0; k < 7; k++) {
      const px = cx - 52 + k * 17;
      s += `<ellipse cx="${f(px)}" cy="${cy - 15}" rx="7.6" ry="8.6" fill="#a9793f" stroke="#6d4c2c" stroke-width="1"/>`;
      s += `<ellipse cx="${f(px)}" cy="${cy + 15}" rx="5.6" ry="5.4" fill="#c99a5e" stroke="#8b6038" stroke-width=".9"/>`;
    }
    s += `<path d="M ${cx - 66} ${cy + 2} L ${cx + 66} ${cy + 2}" stroke="#6f8a55" stroke-width="1" stroke-dasharray="3 4" opacity=".8"/>`;
    s += `<text class="ana-inplace" x="${cx}" y="${cy - 30}" text-anchor="middle">木质部 XYLEM</text>`;
    s += `<text class="ana-inplace" x="${cx}" y="${cy + 34}" text-anchor="middle">韧皮部 PHLOEM</text>`;
  }
  return s;
}

/* ---------------- 标注引线 ---------------- */
function anchorOf(spec, label) {
  if (spec.kind === 'rect') return { x: label.ax, y: label.ay };
  const band = spec.bands[label.band];
  return polar((band.o + band.i) / 2, label.theta);
}

function calloutSVG(label, spec, dy, active) {
  const side = label.side;
  const ly = 152 + label.slot * 88;      // 标签在屏幕上的固定 y
  const localLy = ly - dy;                // 抵消所属层的位移 → 标签永不移动
  const a = anchorOf(spec, label);
  const hub = side === 'r' ? 678 : 222;
  const lx = side === 'r' ? 694 : 206;
  const numCx = side === 'r' ? 706 : 194;
  const textX = side === 'r' ? 724 : 174;
  const textAnchor = side === 'r' ? 'start' : 'end';
  const lead = `M ${f(a.x)} ${f(a.y)} L ${f(hub)} ${f(localLy)} L ${f(lx)} ${f(localLy)}`;
  return `<g class="ana-callout${active === label.no ? ' is-on' : ''}" data-no="${label.no}">
    <path class="ana-lead" d="${lead}"/>
    <circle class="ana-lead-dot" cx="${f(a.x)}" cy="${f(a.y)}" r="3.2"/>
    <circle class="ana-num-bg" cx="${numCx}" cy="${f(localLy)}" r="11" style="stroke:${label.c}"/>
    <text class="ana-num" x="${numCx}" y="${f(localLy + 3.6)}" text-anchor="middle">${label.no}</text>
    <text class="ana-lab-zh" x="${textX}" y="${f(localLy - 2)}" text-anchor="${textAnchor}">${esc(label.zh)}</text>
    <text class="ana-lab-la" x="${textX}" y="${f(localLy + 12)}" text-anchor="${textAnchor}">${esc(label.la)}</text>
  </g>`;
}

/* ---------------- 整幅 SVG ---------------- */
function buildSVG(spec, mode, activeNo) {
  const kind = spec.kind;
  const n = spec.bands.length;
  const gap = kind === 'disc' ? 44 : 48;
  const dyOf = (i) => mode === 'exploded'
    ? (kind === 'disc' ? (n - 1) / 2 - i : i - (n - 1) / 2) * gap
    : 0;
  const order = (kind === 'disc' && mode === 'section')
    ? spec.bands.map((_, i) => i).reverse()
    : spec.bands.map((_, i) => i);

  let defs = '';
  spec.bands.forEach((b, i) => {
    defs += `<linearGradient id="ana-g${i}" x1="0" y1="0" x2="0.28" y2="1">
      <stop offset="0" stop-color="${shade(b.c, 0.26)}"/>
      <stop offset="0.52" stop-color="${b.c}"/>
      <stop offset="1" stop-color="${shade(b.c, -0.22)}"/>
    </linearGradient>`;
  });

  let bg = `<g class="ana-backdrop">
    <ellipse cx="450" cy="${kind === 'disc' ? 566 : 470}" rx="${kind === 'disc' ? 250 : 212}" ry="26" fill="#000" opacity=".20"/>
    <path d="M 54 596 H 846" stroke="rgba(159,208,180,.10)" stroke-width="1"/>
    <path d="M 448 588 v 16 M 348 592 v 12 M 548 592 v 12" stroke="rgba(159,208,180,.14)" stroke-width="1"/>
    <text x="54" y="584" class="ana-watermark">T.S. / TRANSVERSE SECTION · ${esc(spec.en)}</text>
    <text x="846" y="584" class="ana-watermark" text-anchor="end">${mode === 'exploded' ? 'EXPLODED LAYERS' : 'SECTION VIEW'}</text>
  </g>`;

  // 爆炸模式的层级参考虚线
  let axis = '';
  if (mode === 'exploded') {
    if (kind === 'disc') {
      axis = `<path class="ana-axis" d="M ${DISC.cx} ${f(DISC.cy - (n - 1) / 2 * gap - 18)} V ${f(DISC.cy + (n - 1) / 2 * gap + 30)}"/>`;
    } else {
      const top = spec.bands[0].y0 - 1.5 * gap - 14;
      const bot = spec.bands[n - 1].y1 + 1.5 * gap + 14;
      axis = `<path class="ana-axis" d="M 226 ${f(top)} V ${f(bot)} M 674 ${f(top)} V ${f(bot)}"/>`;
    }
  }

  let bandsSVG = '';
  order.forEach((bi, orderIndex) => {
    const b = spec.bands[bi];
    const dy = dyOf(bi);
    const labels = spec.labels.filter(l => l.band === bi);
    let shape = '';

    if (kind === 'disc') {
      const rx = b.o * DISC.R, ry = b.o * DISC.RY;
      const inx = b.i * DISC.R, iny = b.i * DISC.RY;
      shape += `<path class="ana-side" d="${sideD(DISC.cx, DISC.cy, rx, ry, DISC.depth)}" fill="${b.s}"/>`;
      if (mode === 'exploded') {
        // 爆炸时每层作为「完整切片盘」抽出：若仍用同心环，内孔会透出背景形成破面
        shape += `<path class="ana-face" d="${ellipseD(DISC.cx, DISC.cy, rx, ry)}" fill="url(#ana-g${bi})" stroke="${shade(b.c, -0.48)}" stroke-width="1"/>`;
        if (b.i > 0.01) {
          shape += `<path d="${ellipseD(DISC.cx, DISC.cy, inx, iny)}" fill="rgba(0,0,0,.20)" stroke="${shade(b.c, -0.55)}" stroke-width="1" stroke-dasharray="4 4" opacity=".8"/>`;
        }
      } else {
        shape += `<path class="ana-face" d="${ringD(DISC.cx, DISC.cy, rx, ry, inx, iny)}" fill="url(#ana-g${bi})" fill-rule="evenodd" stroke="${shade(b.c, -0.48)}" stroke-width="1"/>`;
      }
      shape += `<g class="ana-tex">${discTexture(b, bi)}</g>`;
    } else {
      const { x0, x1, shift, drop } = BLOCK;
      const h = b.y1 - b.y0;
      shape += `<path class="ana-side" d="M ${x1} ${b.y0} l ${shift} ${drop} v ${h} l ${-shift} ${-drop} Z" fill="${b.s}"/>`;
      shape += `<path class="ana-side" d="M ${x0} ${b.y1} h ${x1 - x0} l ${shift} ${drop} h ${-(x1 - x0)} Z" fill="${shade(b.s, -0.18)}"/>`;
      shape += `<rect class="ana-face" x="${x0}" y="${b.y0}" width="${x1 - x0}" height="${h}" fill="url(#ana-g${bi})" stroke="${shade(b.c, -0.45)}" stroke-width="1"/>`;
      shape += `<g class="ana-tex">${rectTexture(b, bi)}</g>`;
    }

    const callouts = labels.map(l => calloutSVG(l, spec, dy, activeNo)).join('');
    bandsSVG += `<g class="ana-band" data-band="${bi}" transform="translate(0 ${f(dy)})" style="animation-delay:${orderIndex * 65}ms">
      ${shape}${callouts}
    </g>`;
  });

  return `<defs>${defs}</defs>${bg}${axis}${bandsSVG}`;
}

/* ============================================================
   视图控制器
   ============================================================ */
export class AnatomyView {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.active = false;
    this.specIndex = 0;
    this.mode = 'section';
    this.activeNo = null;
    this.el = {
      root: $('anatomy'), svg: $('ana-svg'), tabs: $('ana-spec-tabs'),
      legend: $('ana-legend'), detail: $('ana-detail'), extra: $('ana-extra'),
      left: $('ana-left-body'), caption: $('ana-stage-caption'),
      mode: $('ana-mode'), close: $('ana-close')
    };
    this._buildTabs();
    this._bind();
    this._readQuery();
  }

  get spec() { return SPECS[this.specIndex]; }

  _buildTabs() {
    this.el.tabs.innerHTML = SPECS.map((s, i) =>
      `<button class="ana-tab${i === 0 ? ' active' : ''}" data-spec="${i}">
        <span class="ana-tab-no">${s.no}</span>
        <span class="ana-tab-txt"><b>${esc(s.name)}</b><small>${esc(s.en)}</small></span>
      </button>`).join('');
  }

  _bind() {
    this.el.tabs.addEventListener('click', e => {
      const b = e.target.closest('button[data-spec]');
      if (b) this.setSpec(Number(b.dataset.spec));
    });
    this.el.mode.addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (b) this.setMode(b.dataset.mode);
    });
    this.el.close.addEventListener('click', () => this.close());
    this.el.legend.addEventListener('click', e => {
      const b = e.target.closest('.ana-lg-item');
      if (b) this.setActive(b.dataset.no);
    });
    this.el.legend.addEventListener('mouseover', e => {
      const b = e.target.closest('.ana-lg-item');
      if (b) this._highlight(b.dataset.no, true);
    });
    this.el.legend.addEventListener('mouseout', e => {
      const b = e.target.closest('.ana-lg-item');
      if (b) this._highlight(b.dataset.no, false);
    });
  }

  _readQuery() {
    try {
      const p = new URLSearchParams(location.search);
      const sp = p.get('spec'), md = p.get('mode');
      const i = SPECS.findIndex(s => s.id === sp);
      if (i >= 0) this.specIndex = i;
      if (md === 'exploded' || md === 'explode') this.mode = 'exploded';
      if (p.get('view') === 'anatomy') setTimeout(() => this.open(), 60);
    } catch (_) { /* 忽略畸形查询串 */ }
  }

  /* -------- 打开 / 关闭 -------- */
  open() {
    if (this.active) return;
    this.active = true;
    this.el.root.classList.remove('hidden');
    document.body.classList.add('ana-open');
    this.render();
    this.cb.onOpenChange?.(true);
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.el.root.classList.add('hidden');
    document.body.classList.remove('ana-open');
    this.cb.onOpenChange?.(false);
  }

  toggle() { this.active ? this.close() : this.open(); }

  /* -------- 状态设置 -------- */
  setSpec(i) {
    if (i < 0 || i >= SPECS.length) return;
    this.specIndex = i;
    this.activeNo = null;
    this.render();
  }

  setMode(m) {
    if (m !== 'section' && m !== 'exploded') return;
    this.mode = m;
    this.render();
  }

  setActive(no) {
    this.activeNo = this.activeNo === no ? null : no;
    this.render();
  }

  _highlight(no, on) {
    const band = this.spec.labels.find(l => l.no === no);
    if (!band) return;
    const g = this.el.svg.querySelector(`.ana-band[data-band="${band.band}"]`);
    if (g) g.classList.toggle('is-hover', on);
    const item = this.el.legend.querySelector(`.ana-lg-item[data-no="${no}"]`);
    if (item) item.classList.toggle('is-hover', on);
  }

  /* -------- 渲染 -------- */
  render() {
    const s = this.spec;
    this.el.tabs.querySelectorAll('.ana-tab').forEach((b, i) => b.classList.toggle('active', i === this.specIndex));
    this.el.mode.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === this.mode));

    this.el.caption.textContent = `${s.no} / ${s.name} · ${s.sub}`;
    this.el.left.innerHTML = `
      <div class="ana-left-eyebrow">SPECIMEN ${s.no} / 03</div>
      <h3>${esc(s.name)}</h3>
      <div class="ana-left-en">${esc(s.en)}</div>
      <p class="ana-intro">${esc(s.intro)}</p>
      <div class="ana-meta">${s.meta.map(m => `<div><span>${esc(m[0])}</span><b>${esc(m[1])}</b></div>`).join('')}</div>
      <div class="ana-tip"><span>观察要点</span><p>${esc(s.tip)}</p></div>
      <div class="ana-scope">
        <span class="ana-scope-h">代表性切面</span>
        <p>本视图仅选取 主干 / 根 / 叶 各一个代表性横切面，不逐片叶、逐条根展开，以便清晰观察组织分层与标注。</p>
      </div>`;

    this.el.legend.innerHTML = `
      <div class="ana-right-head"><span>STRUCTURE KEY</span><b>结构标注 · ${s.labels.length} 项</b></div>
      ${s.labels.map(l => `
        <button class="ana-lg-item${this.activeNo === l.no ? ' is-active' : ''}" data-no="${l.no}">
          <span class="ana-lg-no" style="--c:${l.c}">${l.no}</span>
          <span class="ana-lg-txt"><b>${esc(l.zh)}</b><small>${esc(l.la)}</small><em>${esc(l.brief)}</em></span>
        </button>`).join('')}`;

    const chosen = s.labels.find(l => l.no === this.activeNo);
    this.el.detail.innerHTML = chosen
      ? `<div class="ana-detail-head"><span class="ana-lg-no" style="--c:${chosen.c}">${chosen.no}</span><b>${esc(chosen.zh)}</b><small>${esc(chosen.la)}</small></div>
         <p>${esc(chosen.desc)}</p>`
      : `<div class="ana-detail-empty">点击上方任一结构，查看详细解剖学说明<br/><span>图中编号与此处一一对应</span></div>`;

    this.el.extra.innerHTML = `<div class="ana-extra-head">补充说明 / NOTES</div>
      <ul>${s.extras.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="ana-disclaimer">图示为模式化教学切面，各层厚度与细胞尺寸均作放大表达，非等比尺度；结构名称依据果树解剖学通用结论整理。</div>`;

    this.el.svg.innerHTML = buildSVG(s, this.mode, this.activeNo);
    // 高亮当前选中层
    if (this.activeNo) {
      const l = s.labels.find(x => x.no === this.activeNo);
      const g = this.el.svg.querySelector(`.ana-band[data-band="${l.band}"]`);
      if (g) g.classList.add('is-active');
    }
  }
}
