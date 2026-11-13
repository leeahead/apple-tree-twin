import * as THREE from 'three';
import { fbm, valueNoise, mulberry32, clamp, lerp, smoothstep } from './GeometryUtils.js';

/* ------------------------------------------------------------------ *
 * 程序化高分辨率 PBR 贴图集
 * 每套包含 albedo / normal / roughness（部分含 displacement height）
 * 全部由 Canvas 2D 离屏生成 → 零外部资源，可完全离线运行
 * ------------------------------------------------------------------ */

const canvasOf = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h === undefined ? w : h;
  return c;
};

function toTexture(canvas, opts = {}) {
  const { srgb = false, wrap = THREE.RepeatWrapping, aniso = 8, flipY = true } = opts;
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = wrap;
  t.anisotropy = aniso;
  t.flipY = flipY;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Sobel 高度场 → 切线空间法线贴图 */
function normalFromHeight(height, size, strength = 2.6, h = size) {
  const c = canvasOf(size, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, h);
  const d = img.data;
  const at = (x, y) => height[((y + h) % h) * size + ((x + size) % size)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
               - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
               - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      let nx = dx * strength, ny = dy * strength, nz = 1;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      d[i] = (nx * il * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * il * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * il * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function heightToRoughness(height, size, lo, hi, h = size) {
  const c = canvasOf(size, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, h);
  for (let i = 0; i < size * h; i++) {
    const v = clamp(lerp(lo, hi, height[i]), 0, 1) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function createSet(ctxs, height, size, cfg) {
  const { srgb = true, normalStrength = 2.4, roughness = [0.95, 0.62], aniso = 8, h = size } = cfg;
  const out = { map: toTexture(ctxs.canvas || ctxs, { srgb, aniso }) };
  out.normalMap = toTexture(normalFromHeight(height, size, normalStrength, h), { aniso });
  out.roughnessMap = toTexture(heightToRoughness(height, size, roughness[0], roughness[1], h), { aniso });
  const hm = heightToRoughness(height, size, 0, 1, h);
  out.heightMap = toTexture(hm, { aniso });
  out.normalScale = new THREE.Vector2(1, 1);
  return out;
}

/* ---------- 1. 树皮：纵向裂纹 + 栓皮脊 + 地衣斑 ---------- */
function buildBark(size = 1024, seed = 17, palette = 'trunk') {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const height = new Float32Array(size * size);
  const rand = mulberry32(seed);

  // 先用矢量笔触绘制裂纹掩膜，避免逐像素 × 裂纹数的昂贵循环
  const cm = canvasOf(size), cx = cm.getContext('2d');
  cx.fillStyle = '#000'; cx.fillRect(0, 0, size, size);
  cx.lineCap = 'round'; cx.strokeStyle = '#fff';
  const cracks = palette === 'branch' ? 54 : 96;
  for (let k = 0; k < cracks; k++) {
    let x = rand() * size;
    const w = (palette === 'branch' ? 0.7 : 1.1) + rand() * (palette === 'branch' ? 2.2 : 5.2);
    const f0 = 0.6 + rand() * 2.6, p0 = rand() * Math.PI * 2;
    const amp = 3 + rand() * 18;
    const y0 = rand() * size * 0.5 - size * 0.25;
    const y1 = size + rand() * size * 0.3;
    cx.beginPath();
    for (let y = y0, first = true; y < y1; y += 5) {
      const xx = x + Math.sin(y / size * Math.PI * 2 * f0 + p0) * amp + Math.sin(y / size * Math.PI * 9.3 + p0 * 2) * amp * 0.22;
      if (first) { cx.moveTo(xx, y); first = false; } else cx.lineTo(xx, y);
    }
    cx.lineWidth = w; cx.globalAlpha = 0.55 + rand() * 0.45;
    cx.stroke();
    // 分叉
    if (rand() > 0.62) {
      cx.beginPath();
      const sy = rand() * size;
      const sx = x + Math.sin(sy / size * Math.PI * 2 * f0 + p0) * amp;
      cx.moveTo(sx, sy);
      cx.quadraticCurveTo(sx + (rand() - 0.5) * 60, sy + 50, sx + (rand() - 0.5) * 95, sy + 110 + rand() * 160);
      cx.lineWidth = w * 0.5; cx.globalAlpha = 0.4; cx.stroke();
    }
  }
  cx.globalAlpha = 1;
  const crackData = cx.getImageData(0, 0, size, size).data;

  const base = palette === 'branch'
    ? [ [78, 61, 43], [128, 105, 72], [166, 142, 103] ]
    : [ [63, 52, 41], [108, 89, 66], [154, 131, 98] ];
  const dark = base[0], mid = base[1], light = base[2];

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      // 纵向拉伸的多尺度起伏（栓皮脊）
      const ridge = fbm(u * 14, v * 2.6, 4, seed) * 0.62 + fbm(u * 42, v * 7.5, 3, seed + 31) * 0.26;
      const fine = valueNoise(u * 190, v * 42, seed + 7) * 0.12;
      const crack = crackData[i * 4] / 255;
      let hgt = ridge + fine - Math.pow(crack, 1.35) * 0.72;
      hgt = clamp(hgt, 0, 1);
      height[i] = hgt;

      const k = clamp(hgt * 1.35, 0, 1);
      let R, G, B;
      if (k < 0.5) { const q = k * 2; R = lerp(dark[0], mid[0], q); G = lerp(dark[1], mid[1], q); B = lerp(dark[2], mid[2], q); }
      else { const q = (k - 0.5) * 2; R = lerp(mid[0], light[0], q); G = lerp(mid[1], light[1], q); B = lerp(mid[2], light[2], q); }
      // 地衣 / 苔藓斑（冷绿灰）
      const lichen = smoothstep(0.62, 0.82, fbm(u * 5.5 + 3, v * 5.5, 3, seed + 91));
      R = lerp(R, 128, lichen * 0.34); G = lerp(G, 143, lichen * 0.34); B = lerp(B, 112, lichen * 0.34);
      // 裂纹内更暗
      const cd = Math.pow(crack, 1.5) * 0.55;
      const grain = (valueNoise(x * 0.7, y * 0.7, seed + 3) - 0.5) * 20;
      d[i * 4] = clamp(R * (1 - cd) + grain, 0, 255);
      d[i * 4 + 1] = clamp(G * (1 - cd) + grain, 0, 255);
      d[i * 4 + 2] = clamp(B * (1 - cd) + grain * 0.8, 0, 255);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return createSet(c, height, size, {
    normalStrength: palette === 'branch' ? 1.7 : 3.3,
    roughness: palette === 'branch' ? [0.93, 0.68] : [0.98, 0.72]
  });
}

/* ---------- 2. 年轮横截面 ---------- */
function buildWood(size = 768) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const height = new Float32Array(size * size);
  const rand = mulberry32(43);
  const rings = 26;
  const phases = Array.from({ length: 9 }, () => rand() * 6.28);
  // 髓射线按方位角分桶，像素采样降为 O(1)
  const RAY_BINS = 1536;
  const rayLenBin = new Float32Array(RAY_BINS);
  const rayAmpBin = new Float32Array(RAY_BINS);
  for (let k = 0; k < 74; k++) {
    const ang = rand() * Math.PI * 2, len = 0.18 + rand() * 0.42;
    const center = Math.floor((ang / (Math.PI * 2)) * RAY_BINS);
    for (let off = -2; off <= 2; off++) {
      const b = (center + off + RAY_BINS) % RAY_BINS;
      const amp = 1 - Math.abs(off) / 3;
      if (len > rayLenBin[b]) rayLenBin[b] = len;
      if (amp > rayAmpBin[b]) rayAmpBin[b] = amp;
    }
  }
  const cx = 0.5 + (rand() - 0.5) * 0.05, cy = 0.5 + (rand() - 0.5) * 0.05;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size - cx, v = y / size - cy;
      const r = Math.sqrt(u * u + v * v);
      const a = Math.atan2(v, u);
      const i = y * size + x;
      // 非正圆年轮：方位扰动
      const wob = Math.sin(a * 3 + phases[0]) * 0.009 + Math.sin(a * 5 + phases[1]) * 0.005
                + Math.sin(a * 9 + phases[2]) * 0.0025 + (fbm(a * 2.2, r * 8, 3, 5) - 0.5) * 0.012;
      const rr = r + wob;
      const ringF = rr / 0.48 * rings;
      const frac = ringF - Math.floor(ringF);
      // 早材宽而浅、晚材窄而深（非对称锯齿）
      const latewood = smoothstep(0.78, 0.93, frac) * (1 - smoothstep(0.96, 1.0, frac));
      const early = 1 - latewood;
      const heart = smoothstep(0.30, 0.16, rr); // 心材色深
      const grain = fbm(u * 26 + 4, v * 26, 3, 19) * 0.16;
      let hgt = 0.32 + early * 0.30 - latewood * 0.34 + grain * 0.3;
      // 髓射线：细放射线
      const an = (a + Math.PI * 2) % (Math.PI * 2);
      const bin = Math.min(RAY_BINS - 1, Math.floor((an / (Math.PI * 2)) * RAY_BINS));
      const ray = (rr < rayLenBin[bin] + 0.09) ? rayAmpBin[bin] * 0.6 : 0;
      hgt += ray * 0.22;
      // 径向干裂
      let split = 0;
      for (const sa of [0.7, 2.9, 4.8]) {
        const da = Math.abs(((a - sa + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (da < 0.012 && rr > 0.12) split = 1 - da / 0.012;
      }
      hgt -= split * 0.6;
      height[i] = clamp(hgt, 0, 1);

      const pale = [206, 173, 126], dark = [126, 88, 56], heartC = [143, 92, 56];
      let R = lerp(dark[0], pale[0], early), G = lerp(dark[1], pale[1], early), B = lerp(dark[2], pale[2], early);
      R = lerp(R, heartC[0], heart * 0.55); G = lerp(G, heartC[1], heart * 0.55); B = lerp(B, heartC[2], heart * 0.55);
      if (rr < 0.022) { R = 96; G = 70; B = 48; } // 髓心
      const shade = 0.9 + grain * 0.5 + ray * 0.22 - split * 0.75;
      d[i * 4] = clamp(R * shade, 0, 255);
      d[i * 4 + 1] = clamp(G * shade, 0, 255);
      d[i * 4 + 2] = clamp(B * shade, 0, 255);
      d[i * 4 + 3] = r > 0.495 ? 0 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const set = createSet(c, height, size, { normalStrength: 1.5, roughness: [0.85, 0.58] });
  for (const t of Object.values(set)) if (t && t.isTexture) {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.flipY = false;
    t.needsUpdate = true;
  }
  return set;
}

/* ---------- 3. 叶片：叶肉斑驳 + 羽状脉 + 下表皮气孔 ---------- */
function buildLeaf(size = 768, back = false) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const height = new Float32Array(size * size);
  const rand = mulberry32(back ? 88 : 21);

  // 预绘叶脉掩膜（教学放大的三级网脉）
  const vm = canvasOf(size), vx = vm.getContext('2d');
  vx.fillStyle = '#000'; vx.fillRect(0, 0, size, size);
  vx.lineCap = 'round';
  const H = size;
  // canvas 顶部 = 叶尖(v=1)
  const drawVein = (path, w, alpha) => {
    vx.beginPath(); path(vx); vx.lineWidth = w; vx.strokeStyle = `rgba(255,255,255,${alpha})`; vx.stroke();
  };
  drawVein(p => { p.moveTo(size * 0.5, H); p.lineTo(size * 0.5, 0); }, size * 0.028, 1);
  for (let k = 0; k < 9; k++) {
    const v0 = 0.10 + k * 0.087;
    for (const side of [-1, 1]) {
      const y0 = H * (1 - v0 - (side > 0 ? 0.02 : 0));
      const endV = v0 + 0.13;
      const y1 = H * (1 - endV);
      const x1 = size * (0.5 + side * 0.44);
      drawVein(p => {
        p.moveTo(size * 0.5, y0);
        p.quadraticCurveTo(size * (0.5 + side * 0.22), y0 - H * 0.028, x1, y1);
      }, size * 0.009, 0.82);
      for (let m = 1; m <= 3; m++) {
        const t = m / 4;
        const bx = size * 0.5 + side * 0.44 * t, by = lerp(y0, y1, t * 0.9);
        drawVein(p => { p.moveTo(bx, by); p.lineTo(bx + side * size * 0.05, by - H * 0.055 - rand() * H * 0.03); }, size * 0.0035, 0.42);
      }
    }
  }
  const veinData = vx.getImageData(0, 0, size, size).data;

  // 下表皮气孔掩膜（预渲染椭圆，教学放大密度）
  const sm = canvasOf(size), sctx = sm.getContext('2d');
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, size, size);
  if (back) {
    for (let k = 0; k < 900; k++) {
      const px = rand(), pv = rand(), pr = 0.7 + rand() * 1.4;
      sctx.fillStyle = `rgba(255,255,255,${0.5 + rand() * 0.5})`;
      sctx.beginPath();
      sctx.ellipse(px * size, (1 - pv) * size, 2.1 * pr, 1.3 * pr, 0, 0, Math.PI * 2);
      sctx.fill();
    }
  }
  const stomMask = sctx.getImageData(0, 0, size, size).data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = 1 - y / size;
      const i = y * size + x;
      const t = (u - 0.5) * 2;
      const meso = fbm(u * 20, v * 22, 4, 11) * 0.6 + valueNoise(u * 95, v * 95, 3) * 0.18;
      const vein = veinData[i * 4] / 255;
      let hgt = 0.38 + meso * 0.34 + vein * 0.28;
      height[i] = clamp(hgt, 0, 1);
      const edge = Math.pow(Math.abs(t), 3) * 0.28;
      const chlor = fbm(u * 7 + 2, v * 7, 3, 41);
      let R = (back ? 104 : 52) + meso * 66 + chlor * 22 - edge * 46;
      let G = (back ? 146 : 112) + meso * 76 + chlor * 22 - edge * 40;
      let B = (back ? 92 : 44) + meso * 46 + chlor * 16 - edge * 24;
      R = lerp(R, 176, vein * 0.52); G = lerp(G, 198, vein * 0.52); B = lerp(B, 128, vein * 0.52);
      // 下表皮气孔：浅色椭圆点
      if (back) {
        const stom = stomMask[i * 4] / 255;
        R = lerp(R, 196, stom * 0.72); G = lerp(G, 210, stom * 0.72); B = lerp(B, 158, stom * 0.72);
      }
      d[i * 4] = clamp(R, 0, 255); d[i * 4 + 1] = clamp(G, 0, 255); d[i * 4 + 2] = clamp(B, 0, 255); d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return createSet(c, height, size, { normalStrength: back ? 1.3 : 1.0, roughness: [0.82, 0.48] });
}

/* ---------- 4. 花瓣：径向脉 + 基部色晕 ---------- */
function buildPetal(size = 512) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = 1 - y / size, i = y * size + x;
      const t = (u - 0.5) * 2;
      const veins = Math.pow(Math.max(0, Math.sin((t * 7 + Math.sin(v * 4) * 0.3) * Math.PI)), 8) * (1 - v * 0.3);
      const grain = fbm(u * 26, v * 20, 3, 71);
      height[i] = clamp(0.5 + veins * 0.22 + grain * 0.12, 0, 1);
      const base = smoothstep(0, 0.34, v);
      let R = lerp(212, 236, base), G = lerp(166, 222, base), B = lerp(174, 226, base);
      R = lerp(R, 232, veins * 0.3); G = lerp(G, 190, veins * 0.5); B = lerp(B, 200, veins * 0.5);
      const edge = Math.pow(Math.abs(t), 5) * 0.5 + smoothstep(0.86, 1, v) * 0.32;
      R = lerp(R, 236, edge * 0.4); G = lerp(G, 166, edge); B = lerp(B, 184, edge);
      const s = 0.95 + grain * 0.1;
      d[i * 4] = clamp(R * s, 0, 255); d[i * 4 + 1] = clamp(G * s, 0, 255); d[i * 4 + 2] = clamp(B * s, 0, 255); d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return createSet(c, height, size, { normalStrength: 0.75, roughness: [0.72, 0.42] });
}

/* ---------- 5. 果实表皮：底色 / 红条纹 / 皮孔 / 蜡质 ---------- */
function buildApple(size = 1024, mature = true) {
  const c = canvasOf(size, size / 2), ctx = c.getContext('2d');
  const W = size, H = size / 2;
  const img = ctx.createImageData(W, H), d = img.data;
  const height = new Float32Array(W * H);
  const rand = mulberry32(mature ? 121 : 122);
  const stripePhase = Array.from({ length: 30 }, () => rand() * 6.28);
  // 皮孔掩膜预渲染：避免逐像素 × 数百点的指数级开销
  const lm = canvasOf(W, H), lctx = lm.getContext('2d');
  lctx.fillStyle = '#000'; lctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 520; k++) {
    const px = rand(), pv = rand(), pr = 0.40 + rand() * 0.9;
    lctx.fillStyle = `rgba(255,255,255,${0.26 + rand() * 0.30})`;
    lctx.beginPath();
    lctx.ellipse(px * W, (1 - pv) * H, 1.05 * pr, 0.68 * pr, 0, 0, Math.PI * 2);
    lctx.fill();
  }
  const lentMask = lctx.getImageData(0, 0, W, H).data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = 1 - y / H; // v=1 顶部（梗洼）
      const i = y * W + x;
      const noise = fbm(u * 14, v * 16, 4, 33);
      // 纵向条纹（沿经线方向的条带）
      let stripe = 0;
      for (let k = 0; k < 13; k++) {
        const center = k / 13
          + Math.sin(v * 4.2 + stripePhase[k]) * 0.010
          + Math.sin(v * 11 + stripePhase[k + 13]) * 0.004;
        const raw = Math.abs(u - center);
        const dd = Math.min(raw, 1 - raw); // 经度环向连续
        const w = 0.0035 + 0.0045 * noise;
        stripe = Math.max(stripe, Math.max(0, 1 - dd / (w * 2.0)));
      }
      const blush = clamp(0.36 + 0.50 * noise + 0.16 * Math.sin(u * 13 + v * 2.2), 0, 1);
      const shoulder = smoothstep(0.08, 0.36, v) * (1 - smoothstep(0.88, 1, v));
      const red = mature ? clamp((blush * 0.72 + stripe * 0.40) * shoulder, 0, 1) : 0;
      const ripe = mature ? clamp(0.15 + noise * 0.5 + shoulder * 0.2, 0, 1) : 0;

      let R = lerp(mature ? 172 : 96, mature ? 216 : 128, ripe);
      let G = lerp(mature ? 196 : 158, mature ? 208 : 176, ripe);
      let B = lerp(mature ? 88 : 66, mature ? 104 : 78, ripe);
      // 花青苷红晕
      R = lerp(R, 198, red); G = lerp(G, 52, red * 0.94); B = lerp(B, 46, red * 0.9);
      R = lerp(R, 236, stripe * red * 0.34); G = lerp(G, 92, stripe * red * 0.3);
      // 萼洼/梗洼附近偏绿
      const cavity = smoothstep(0.16, 0.02, v) + smoothstep(0.86, 1, v);
      R = lerp(R, 162, cavity * 0.34); G = lerp(G, 176, cavity * 0.34); B = lerp(B, 86, cavity * 0.34);
      // 皮孔（由预渲染掩膜采样）
      const lent = lentMask[i * 4] / 255;
      R = lerp(R, 214, lent * 0.40); G = lerp(G, 206, lent * 0.40); B = lerp(B, 158, lent * 0.40);
      const fuzz = mature ? 0 : (valueNoise(u * 420, v * 420, 8) - 0.5) * 16;
      const grain = (valueNoise(u * 260, v * 260, 13) - 0.5) * 12;
      d[i * 4] = clamp(R + grain + fuzz, 0, 255);
      d[i * 4 + 1] = clamp(G + grain + fuzz, 0, 255);
      d[i * 4 + 2] = clamp(B + grain + fuzz, 0, 255);
      d[i * 4 + 3] = 255;
      height[i] = clamp(0.42 + noise * 0.28 + lent * 0.35 + (mature ? grain / 90 : fuzz / 90), 0, 1);
    }
  }
  ctx.putImageData(img, 0, 0);
  return createSet(c, height, W, {
    h: H,
    normalStrength: mature ? 0.85 : 1.5,
    roughness: mature ? [0.34, 0.12] : [0.92, 0.66]
  });
}

/* ---------- 6. 土壤剖面 / 地表 ---------- */
function buildSoilSection(size = 768) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const height = new Float32Array(size * size);
  const rand = mulberry32(301);
  const gm = canvasOf(size), gctx = gm.getContext('2d');
  gctx.fillStyle = '#000'; gctx.fillRect(0, 0, size, size);
  for (let k = 0; k < 240; k++) {
    const px = rand() * size, py = rand() * size, pr = 2 + rand() * 10, tone = 120 + rand() * 90;
    gctx.fillStyle = `rgb(${tone},${tone},${tone})`;
    gctx.beginPath(); gctx.ellipse(px, py, pr, pr * 0.62, rand() * 3, 0, Math.PI * 2); gctx.fill();
  }
  const gritMask = gctx.getImageData(0, 0, size, size).data;
  const layers = [
    { y: 0.00, c: [64, 46, 32] },   // 枯落物 / 腐殖质 O 层
    { y: 0.10, c: [86, 62, 40] },   // A 层 表土
    { y: 0.34, c: [120, 92, 62] },  // E 层 淋溶
    { y: 0.58, c: [146, 106, 70] }, // B 层 淀积
    { y: 0.82, c: [124, 104, 84] }  // C 层 母质
  ];
  for (let y = 0; y < size; y++) {
    const v = y / size;
    let col = layers[layers.length - 1].c;
    for (let k = 0; k < layers.length - 1; k++) {
      if (v >= layers[k].y && v < layers[k + 1].y) {
        const q = smoothstep(layers[k].y, layers[k + 1].y, v);
        col = layers[k].c.map((ch, n) => lerp(ch, layers[k + 1].c[n], q));
        break;
      }
    }
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      const n = fbm(u * 18, v * 26, 4, 61);
      const grit = valueNoise(u * 190, v * 190, 3);
      const band = Math.sin(v * 130 + n * 6) * 4;
      let R = col[0] * (0.72 + n * 0.55) + band + (grit - 0.5) * 22;
      let G = col[1] * (0.72 + n * 0.55) + band + (grit - 0.5) * 18;
      let B = col[2] * (0.72 + n * 0.55) + band + (grit - 0.5) * 14;
      const st = gritMask[i * 4] / 255;
      if (st > 0.02) {
        const tone = 0.62 + st * 0.55;
        R = lerp(R, 158 * tone, st * 0.8); G = lerp(G, 150 * tone, st * 0.8); B = lerp(B, 132 * tone, st * 0.8);
      }
      // 根通道痕迹
      const channel = smoothstep(0.86, 0.98, fbm(u * 6 + 2, v * 9, 3, 77));
      R = lerp(R, 46, channel * 0.5); G = lerp(G, 36, channel * 0.5); B = lerp(B, 28, channel * 0.5);
      d[i * 4] = clamp(R, 0, 255); d[i * 4 + 1] = clamp(G, 0, 255); d[i * 4 + 2] = clamp(B, 0, 255); d[i * 4 + 3] = 255;
      height[i] = clamp(0.3 + n * 0.5 + grit * 0.2 + st * 0.2, 0, 1);
    }
  }
  ctx.putImageData(img, 0, 0);
  return createSet(c, height, size, { normalStrength: 2.2, roughness: [0.98, 0.82] });
}

function buildSoilTop(size = 768) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const height = new Float32Array(size * size);
  const rand = mulberry32(555);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const n = fbm(u * 12, v * 12, 4, 91);
    const grit = fbm(u * 96, v * 96, 3, 92);
    const moss = smoothstep(0.58, 0.78, fbm(u * 5 + 3, v * 5, 3, 93));
    let R = 62 + n * 52 + grit * 20, G = 50 + n * 42 + grit * 16, B = 36 + n * 30 + grit * 12;
    R = lerp(R, 78, moss * 0.8); G = lerp(G, 108, moss * 0.8); B = lerp(B, 62, moss * 0.8);
    const leaf = smoothstep(0.72, 0.85, fbm(u * 22 + 7, v * 22, 3, 94));
    R = lerp(R, 142, leaf * 0.5); G = lerp(G, 96, leaf * 0.5); B = lerp(B, 52, leaf * 0.5);
    d[i * 4] = clamp(R, 0, 255); d[i * 4 + 1] = clamp(G, 0, 255); d[i * 4 + 2] = clamp(B, 0, 255); d[i * 4 + 3] = 255;
    height[i] = clamp(0.25 + n * 0.5 + grit * 0.3, 0, 1);
  }
  ctx.putImageData(img, 0, 0);
  return createSet(c, height, size, { normalStrength: 2.0, roughness: [0.98, 0.86] });
}

function buildRootBark(size = 512) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const n = fbm(u * 11, v * 4, 4, 141);
    const ring = Math.pow(Math.max(0, Math.sin(v * Math.PI * 34 + n * 4)), 6) * 0.2;
    const hgt = clamp(0.35 + n * 0.5 + ring, 0, 1);
    height[i] = hgt;
    let R = 96 + hgt * 88, G = 70 + hgt * 62, B = 50 + hgt * 40;
    const scar = smoothstep(0.68, 0.82, fbm(u * 9 + 2, v * 12, 3, 142));
    R = lerp(R, 158, scar * 0.5); G = lerp(G, 122, scar * 0.5); B = lerp(B, 82, scar * 0.5);
    d[i * 4] = clamp(R, 0, 255); d[i * 4 + 1] = clamp(G, 0, 255); d[i * 4 + 2] = clamp(B, 0, 255); d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return createSet(c, height, size, { normalStrength: 1.8, roughness: [0.9, 0.58] });
}

function buildBudScale(size = 384) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = 1 - y / size, i = y * size + x;
    const hair = Math.pow(Math.max(0, Math.sin(u * Math.PI * 68 + v * 3)), 10);
    const n = fbm(u * 14, v * 18, 3, 171);
    height[i] = clamp(0.35 + n * 0.38 + hair * 0.2, 0, 1);
    let R = 104 + n * 74 + hair * 28, G = 72 + n * 52 + hair * 24, B = 50 + n * 34 + hair * 20;
    const edge = Math.pow(Math.abs((u - 0.5) * 2), 4) * 0.55;
    R = lerp(R, 226, edge); G = lerp(G, 202, edge); B = lerp(B, 158, edge);
    d[i * 4] = clamp(R, 0, 255); d[i * 4 + 1] = clamp(G, 0, 255); d[i * 4 + 2] = clamp(B, 0, 255); d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return createSet(c, height, size, { normalStrength: 1.2, roughness: [0.94, 0.68] });
}

/* ---------- 7. 程序化环境球（PBR 反射／高光） ---------- */
function buildEnvironment(renderer) {
  const W = 1024, H = 512;
  const c = canvasOf(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, '#5b83a8');
  g.addColorStop(0.28, '#9fc3cf');
  g.addColorStop(0.48, '#e2e8da');
  g.addColorStop(0.52, '#8e9878');
  g.addColorStop(0.75, '#4b4a38');
  g.addColorStop(1.00, '#2a2d24');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 太阳光斑
  const sun = ctx.createRadialGradient(W * 0.72, H * 0.33, 4, W * 0.72, H * 0.33, 130);
  sun.addColorStop(0, 'rgba(255,250,226,1)');
  sun.addColorStop(0.18, 'rgba(255,238,196,.72)');
  sun.addColorStop(1, 'rgba(255,230,190,0)');
  ctx.fillStyle = sun; ctx.fillRect(W * 0.72 - 140, H * 0.33 - 140, 280, 280);
  // 云带
  const rand = mulberry32(2024);
  for (let k = 0; k < 34; k++) {
    const x = rand() * W, y = H * (0.10 + rand() * 0.30), w = 50 + rand() * 190, h = 8 + rand() * 26;
    const cg = ctx.createRadialGradient(x, y, 1, x, y, w);
    cg.addColorStop(0, `rgba(255,255,250,${0.05 + rand() * 0.12})`);
    cg.addColorStop(1, 'rgba(255,255,250,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
  return env;
}

/* ------------------------------------------------------------------ */

const STEPS = [
  { key: 'bark',        label: '生成树皮裂纹·法线·位移贴图',   fn: () => buildBark(1024, 17, 'trunk') },
  { key: 'branchBark',  label: '生成枝皮与皮孔反射属性',       fn: () => buildBark(512, 29, 'branch') },
  { key: 'rootBark',    label: '生成根皮周皮纹理',             fn: () => buildRootBark(512) },
  { key: 'wood',        label: '生成年轮横截面·髓射线',        fn: () => buildWood(768) },
  { key: 'leaf',        label: '生成叶肉与三级叶脉网络',       fn: () => buildLeaf(768, false) },
  { key: 'leafBack',    label: '生成下表皮气孔分布',           fn: () => buildLeaf(512, true) },
  { key: 'petal',       label: '生成花瓣径向脉与色晕',         fn: () => buildPetal(512) },
  { key: 'appleYoung',  label: '生成幼果绒毛表皮',             fn: () => buildApple(1024, false) },
  { key: 'appleMature', label: '生成成熟果蜡质层与皮孔',       fn: () => buildApple(1024, true) },
  { key: 'budScale',    label: '生成芽鳞绒毛细节',             fn: () => buildBudScale(384) },
  { key: 'soilSection', label: '生成土壤发生层剖面',           fn: () => buildSoilSection(768) },
  { key: 'soilTop',     label: '生成地表覆盖物',               fn: () => buildSoilTop(768) }
];

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

export async function buildTextureLibrary(renderer, onProgress) {
  const lib = {};
  const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 8;
  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    onProgress?.(i / (STEPS.length + 1), step.label);
    await nextFrame();
    const set = step.fn();
    for (const t of Object.values(set)) if (t && t.isTexture) t.anisotropy = aniso;
    lib[step.key] = set;
  }
  if (renderer) {
    onProgress?.(STEPS.length / (STEPS.length + 1), '烘焙 PBR 环境反射球');
    await nextFrame();
    lib.environment = buildEnvironment(renderer);
  } else {
    lib.environment = null;
  }
  onProgress?.(1, '贴图集就绪');
  return lib;
}

export { buildEnvironment };
