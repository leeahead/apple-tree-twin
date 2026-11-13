import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries };

/* ------------------------------------------------------------------ *
 * 确定性随机与噪声（保证每次加载形态一致，便于评审复现）
 * ------------------------------------------------------------------ */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm(x, y, octaves = 4, seed = 0, lacunarity = 2.03, gain = 0.5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 71) * amp;
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smoothstep = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

/* ------------------------------------------------------------------ *
 * 变半径管道：沿任意三维曲线生成连续 UV 的锥形管（枝、根、果柄通用）
 * ------------------------------------------------------------------ */
export function taperedTube(points, opts = {}) {
  const {
    r0 = 0.1, r1 = 0.03, radialSegments = 9, tubularSegments = null,
    uvScaleV = 1, radiusNoise = 0, seed = 1, closedCaps = true,
    power = 1.0, twist = 0
  } = opts;

  const curve = points instanceof THREE.Curve
    ? points
    : new THREE.CatmullRomCurve3(points.map(p => p.isVector3 ? p : new THREE.Vector3(...p)), false, 'centripetal');
  const seg = tubularSegments || Math.max(8, Math.min(160, Math.round(curve.getLength() * 12)));
  const frames = curve.computeFrenetFrames(seg, false);
  const rand = mulberry32(seed);
  const wobble = Array.from({ length: seg + 1 }, () => (rand() - 0.5) * 2);

  const count = (seg + 1) * (radialSegments + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices = [];

  const P = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  const arc = curve.getLength();

  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, P);
    N.copy(frames.normals[i]); B.copy(frames.binormals[i]);
    const baseR = lerp(r0, r1, Math.pow(t, power));
    const nz = radiusNoise
      ? (fbm(t * 7.5, 3.1, 3, seed) - 0.5) * radiusNoise * baseR
      : 0;
    const r = Math.max(0.0015, baseR + nz + wobble[i] * radiusNoise * baseR * 0.35);

    for (let j = 0; j <= radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2 + twist * t;
      const cs = Math.cos(a), sn = Math.sin(a);
      const idx = i * (radialSegments + 1) + j;
      const nx = N.x * cs + B.x * sn, ny = N.y * cs + B.y * sn, nz2 = N.z * cs + B.z * sn;
      positions[idx * 3] = P.x + nx * r;
      positions[idx * 3 + 1] = P.y + ny * r;
      positions[idx * 3 + 2] = P.z + nz2 * r;
      normals[idx * 3] = nx; normals[idx * 3 + 1] = ny; normals[idx * 3 + 2] = nz2;
      uvs[idx * 2] = j / radialSegments;
      uvs[idx * 2 + 1] = t * arc * uvScaleV;
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  // 管壁法线沿锥度略作修正，避免粗枝在强光下出现圆柱感
  const nrm = geo.attributes.normal;
  const slope = (r1 - r0) / Math.max(0.001, arc);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const tangent = curve.getTangentAt(t);
    for (let j = 0; j <= radialSegments; j++) {
      const k = i * (radialSegments + 1) + j;
      const f = Math.min(0.5, Math.abs(slope) * 1.6);
      nrm.setXYZ(k,
        nrm.getX(k) - tangent.x * f,
        nrm.getY(k) - tangent.y * f,
        nrm.getZ(k) - tangent.z * f);
    }
  }
  nrm.needsUpdate = true;
  void closedCaps;
  return geo;
}

/* ------------------------------------------------------------------ *
 * 叶片网格：叶肉 + 锯齿叶缘 + 中脉隆起 + 昼夜形态 morph target
 * 局部坐标：叶基在原点，叶身沿 +Y 伸展，叶面朝向 +Z
 * ------------------------------------------------------------------ */
export function makeLeafGeometry(opts = {}) {
  const {
    length = 0.46, width = 0.255, segY = 16, segX = 10,
    serrations = 13, curl = 0.055, seed = 3
  } = opts;
  const nx = segX * 2, ny = segY;
  const count = (nx + 1) * (ny + 1);
  const pos = new Float32Array(count * 3);
  const mor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const indices = [];
  const cBase = new THREE.Color('#4f8a3e');
  const cEdge = new THREE.Color('#376b31');
  const cVein = new THREE.Color('#a6c878');
  const cTip = new THREE.Color('#6d9c46');
  const tmp = new THREE.Color();

  for (let i = 0; i <= ny; i++) {
    const s = i / ny;
    // 卵形轮廓：最宽处位于叶身中下部
    const outline = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.86)), 0.72) * (1 - 0.16 * s);
    for (let j = 0; j <= nx; j++) {
      const t = (j / nx) * 2 - 1;
      const idx = i * (nx + 1) + j;
      const serr = Math.sin(s * Math.PI * 2 * serrations) * 0.022 * Math.pow(Math.abs(t), 6) * Math.sin(Math.PI * s);
      const halfW = (width * 0.5) * outline + serr;
      const x = t * halfW;
      const ripple = Math.sin(s * Math.PI * 4.2 + seed) * 0.006 * (1 - t * t);
      const midrib = 0.014 * Math.exp(-Math.pow(t * 5.2, 2)) * (1 - s * 0.65);
      const z = curl * t * t * Math.sin(Math.PI * s) * 1.4 + ripple + midrib;
      const y = s * length - 0.018 * t * t * Math.sin(Math.PI * s);

      pos[idx * 3] = x; pos[idx * 3 + 1] = y; pos[idx * 3 + 2] = z;
      uv[idx * 2] = (t + 1) * 0.5; uv[idx * 2 + 1] = s;

      // 夜间：叶片下垂、边缘内卷（就眠运动的教学放大表达）
      mor[idx * 3] = x * 0.90;
      mor[idx * 3 + 1] = y * 0.96 - 0.035 * Math.pow(s, 2);
      mor[idx * 3 + 2] = z + 0.075 * t * t * Math.sin(Math.PI * s) - 0.022 * s;

      tmp.copy(cBase).lerp(cEdge, Math.pow(Math.abs(t), 2.2) * 0.62);
      tmp.lerp(cVein, Math.exp(-Math.pow(t * 7.5, 2)) * 0.55 + Math.exp(-Math.pow((s - 0.5) * 3, 2)) * 0.05);
      tmp.lerp(cTip, smoothstep(0.75, 1, s) * 0.42);
      const shade = 0.92 + fbm(s * 9, t * 5 + 4, 3, seed) * 0.16;
      colors[idx * 3] = tmp.r * shade; colors[idx * 3 + 1] = tmp.g * shade; colors[idx * 3 + 2] = tmp.b * shade;
    }
  }
  for (let i = 0; i < ny; i++) {
    for (let j = 0; j < nx; j++) {
      const a = i * (nx + 1) + j, b = a + nx + 1;
      // 逆时针绕序，使叶面法线朝局部 +Z（与向光朝向计算一致）
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.morphAttributes.position = [new THREE.BufferAttribute(mor, 3)];
  geo.morphTargetsRelative = false;
  geo.computeVertexNormals();
  return geo;
}

/** 叶脉网络：中脉 + 羽状侧脉 + 三级网脉，返回线段顶点数组 */
export function makeLeafVeinLines(opts = {}) {
  const { length = 0.46, width = 0.255, pairs = 7, seed = 1 } = opts;
  const pts = [];
  const outline = (s) => (width * 0.5) * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.86)), 0.72) * (1 - 0.16 * s);
  const zOf = (s, t) => 0.055 * t * t * Math.sin(Math.PI * s) * 1.4 + 0.014 * Math.exp(-Math.pow(t * 5.2, 2)) * (1 - s * 0.65) + 0.004;
  // 中脉
  for (let i = 0; i < 24; i++) {
    const s0 = i / 24, s1 = (i + 1) / 24;
    pts.push(0, s0 * length, zOf(s0, 0), 0, s1 * length, zOf(s1, 0));
  }
  // 羽状侧脉（互生，向叶尖弯曲）
  const rand = mulberry32(seed);
  for (let p = 0; p < pairs; p++) {
    for (const side of [-1, 1]) {
      const s0 = 0.12 + (p / pairs) * 0.76 + (side > 0 ? 0.026 : 0);
      if (s0 > 0.94) continue;
      const w = outline(s0) * 0.92;
      const steps = 7;
      let prev = new THREE.Vector3(0, s0 * length, zOf(s0, 0) + 0.002);
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        const t = side * f * 0.94;
        const s = s0 + f * 0.11 * (1 - s0);
        const x = t * outline(s) * 0.96;
        const cur = new THREE.Vector3(x, s * length, zOf(s, t) + 0.0025);
        pts.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
        prev = cur;
        // 三级细网脉
        if (k > 2 && k < steps && rand() > 0.34) {
          const bx = x * 0.66, bs = s - 0.035;
          pts.push(cur.x, cur.y, cur.z, bx, bs * length, zOf(bs, t * 0.6) + 0.002);
        }
      }
    }
  }
  return new Float32Array(pts);
}

/** 气孔分布点（下表皮，教学放大） */
export function makeStomataPoints(opts = {}) {
  const { length = 0.46, width = 0.255, count = 150, seed = 9 } = opts;
  const rand = mulberry32(seed);
  const p = new Float32Array(count * 3);
  const outline = (s) => (width * 0.5) * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.86)), 0.72) * (1 - 0.16 * s);
  for (let i = 0; i < count; i++) {
    const s = 0.06 + rand() * 0.88;
    const t = (rand() * 2 - 1) * 0.9;
    p[i * 3] = t * outline(s);
    p[i * 3 + 1] = s * length;
    p[i * 3 + 2] = 0.055 * t * t * Math.sin(Math.PI * s) * 1.4 - 0.004;
  }
  return p;
}

/* ------------------------------------------------------------------ *
 * 花瓣：具爪部、圆钝先端、浅碗状凹陷与放射脉
 * ------------------------------------------------------------------ */
export function makePetalGeometry(opts = {}) {
  const { length = 0.30, width = 0.235, nx = 12, ny = 14 } = opts;
  const count = (nx + 1) * (ny + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const indices = [];
  const cClaw = new THREE.Color('#c99a92');
  const cBody = new THREE.Color('#e8dcd8');
  const cEdge = new THREE.Color('#e6bec6');
  const tmp = new THREE.Color();
  for (let i = 0; i <= ny; i++) {
    const s = i / ny;
    const w = width * 0.5 * (0.16 + 0.84 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.72)), 0.62)) * (1 - 0.10 * s);
    for (let j = 0; j <= nx; j++) {
      const t = (j / nx) * 2 - 1;
      const idx = i * (nx + 1) + j;
      const x = t * w;
      const y = s * length;
      const bowl = 0.052 * t * t * Math.sin(Math.PI * s * 0.92) + 0.012 * Math.sin(s * Math.PI);
      const flute = Math.sin(t * Math.PI * 3.2 + s * 2) * 0.004 * Math.sin(Math.PI * s);
      pos[idx * 3] = x; pos[idx * 3 + 1] = y; pos[idx * 3 + 2] = bowl + flute;
      uv[idx * 2] = (t + 1) / 2; uv[idx * 2 + 1] = s;
      tmp.copy(cClaw).lerp(cBody, smoothstep(0.02, 0.55, s));
      tmp.lerp(cEdge, Math.pow(Math.abs(t), 3) * 0.6 + smoothstep(0.8, 1, s) * 0.35);
      colors[idx * 3] = tmp.r; colors[idx * 3 + 1] = tmp.g; colors[idx * 3 + 2] = tmp.b;
    }
  }
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
    const a = i * (nx + 1) + j, b = a + nx + 1;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ *
 * 苹果果实：五心皮棱、梗洼（顶部）、萼洼（底部）、果肩饱满
 * ------------------------------------------------------------------ */
export function makeAppleGeometry(opts = {}) {
  const { segU = 56, segV = 40, seed = 4, dimple = 1 } = opts;
  const count = (segU + 1) * (segV + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const indices = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    const theta = v * Math.PI;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const phi = u * Math.PI * 2;
      const idx = j * (segU + 1) + i;
      let r = Math.pow(Math.sin(theta), 0.76) * (1 + 0.115 * Math.sin(theta));
      r *= 1 + 0.048 * Math.cos(5 * phi) * Math.sin(theta);
      r *= 1 - 0.205 * Math.max(0, -Math.cos(theta));
      const bump = (fbm(u * 9, v * 9, 3, seed) - 0.5) * 0.014 * Math.sin(theta);
      r += bump;
      let y = Math.cos(theta) * 0.94;
      y -= 0.325 * dimple * Math.exp(-Math.pow(theta / 0.42, 2));           // 梗洼
      y += 0.205 * dimple * Math.exp(-Math.pow((Math.PI - theta) / 0.38, 2)); // 萼洼
      y += 0.012 * Math.sin(5 * phi) * Math.pow(Math.sin(theta), 6);
      pos[idx * 3] = r * Math.cos(phi);
      pos[idx * 3 + 1] = y;
      pos[idx * 3 + 2] = r * Math.sin(phi);
      uv[idx * 2] = u; uv[idx * 2 + 1] = v;
    }
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = j * (segU + 1) + i, b = a + segU + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** 球面鳞片（芽鳞、萼片）用简化的曲面片 */
export function makeScaleGeometry(opts = {}) {
  const { width = 0.09, height = 0.14, curvature = 0.35, seg = 6 } = opts;
  const count = (seg + 1) * (seg + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const idx = [];
  for (let j = 0; j <= seg; j++) {
    const v = j / seg;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const k = j * (seg + 1) + i;
      const taper = Math.pow(Math.sin(Math.PI * Math.pow(v, 0.8)), 0.55);
      pos[k * 3] = (u - 0.5) * width * taper;
      pos[k * 3 + 1] = v * height;
      pos[k * 3 + 2] = curvature * width * (1 - Math.pow((u - 0.5) * 2, 2)) * Math.sin(Math.PI * v * 0.9) + 0.02 * v * v;
      uv[k * 2] = u; uv[k * 2 + 1] = v;
    }
  }
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** 把几何体烘焙到指定变换（用于合并分枝段） */
export function bake(geo, matrix) {
  const g = geo.clone();
  g.applyMatrix4(matrix);
  return g;
}

/** 生成一条自然弯曲的三维曲线控制点 */
export function curvedPath(start, end, bend = 0.18, seed = 1, upBias = 0) {
  const rand = mulberry32(seed);
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const pts = [a.clone()];
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const p = a.clone().lerp(b, t);
    p.addScaledVector(side, Math.sin(t * Math.PI) * len * bend * (0.6 + rand() * 0.8));
    p.y += Math.sin(t * Math.PI) * len * upBias + (rand() - 0.5) * len * 0.03;
    pts.push(p);
  }
  pts.push(b.clone());
  return pts;
}
