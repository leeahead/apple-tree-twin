import * as THREE from 'three';
import { WORLD } from '../core/constants.js';
import { taperedTube, curvedPath, mergeGeometries, lerp, clamp } from '../core/GeometryUtils.js';

/**
 * 冠层分枝：形态发生学的参数化近似
 *  · 主枝沿黄金角 137.5077° 螺旋排布（叶序 phyllotaxis 的发散角）
 *  · 每级子枝数取斐波那契数（8 主枝 / 5 二级 / 2 三级 / 2 末梢）
 *  · 节间长度按斐波那契级数递推衰减
 * 注意：真实分枝受顶端优势、生长素/细胞分裂素梯度与品种特性调控，
 *       此处是可视化建模规则，不是植物学定律（知识面板中已明确标注）。
 */
export function buildBranches(ctx) {
  const { materials: M, registry: R, groups, rand } = ctx;
  const G = groups.branch;
  const GA = WORLD.goldenAngle;
  const fib = WORLD.fibonacci;
  const twigs = [];       // 末梢：叶片 / 芽 / 花 / 果 的附着点
  const spurs = [];       // 结果枝组（短果枝）
  const budSites = [];

  const internode = (i) => 0.63 * Math.pow(fib[9 - i] / fib[9], 0.32);

  /* ---- 中心领导干 ---- */
  const leaderPath = curvedPath(
    [0.035, WORLD.trunkHeight - 0.03, -0.02],
    [0.10, WORLD.leaderTop, 0.06], 0.022, 811, 0.008
  );
  const leader = new THREE.Mesh(
    taperedTube(leaderPath, {
      r0: WORLD.trunkTopRadius, r1: 0.028, radialSegments: 20,
      tubularSegments: 60, uvScaleV: 0.9, radiusNoise: 0.10, seed: 812
    }),
    M.get('branchBark')
  );
  leader.castShadow = true; leader.receiveShadow = true;
  G.add(leader);
  R.attach('branch-leader', leader);

  /* ---- 八层主枝 ---- */
  let y = 1.86;
  for (let i = 0; i < 8; i++) {
    const a = 0.42 + i * GA;
    const start = new THREE.Vector3(Math.sin(a) * 0.20, y, Math.cos(a) * 0.20);
    // 下部主枝长而开张、上部渐短，形成苹果典型的圆头/纺锤形冠层
    const elev = lerp(0.52, 0.34, i / 7);
    const L = lerp(3.68, 2.06, i / 7) * (0.93 + rand() * 0.14);
    const horiz = Math.cos(elev) * L;
    const end = start.clone().add(new THREE.Vector3(
      Math.sin(a) * horiz, Math.sin(elev) * L * 0.62, Math.cos(a) * horiz
    ));
    const pPath = curvedPath(start.toArray(), end.toArray(), 0.10, 900 + i, 0.035);
    const pGeoms = [taperedTube(pPath, {
      r0: lerp(0.158, 0.088, i / 7), r1: 0.041,
      radialSegments: 12, tubularSegments: 30, uvScaleV: 1.0, radiusNoise: 0.14, seed: 920 + i
    })];
    const pCurve = new THREE.CatmullRomCurve3(pPath.map(p => p.clone()));

    const sGeoms = [], tGeoms = [], shGeoms = [];

    /* 二级侧枝：5 条（斐波那契数） */
    for (let k = 0; k < 5; k++) {
      const t = 0.24 + (k / 5) * 0.68 + rand() * 0.045;
      const sp = pCurve.getPointAt(clamp(t, 0, 1));
      const sa = a + (k % 2 ? 1 : -1) * (0.55 + k * 0.12) + (rand() - 0.5) * 0.28;
      const sL = lerp(1.48, 0.92, k / 5) * (0.86 + rand() * 0.28) * (1 - i * 0.035);
      const sElev = 0.12 + rand() * 0.34;
      const sep = sp.clone().add(new THREE.Vector3(
        Math.sin(sa) * Math.cos(sElev) * sL,
        Math.sin(sElev) * sL,
        Math.cos(sa) * Math.cos(sElev) * sL
      ));
      const sPath = curvedPath(sp.toArray(), sep.toArray(), 0.13, 1000 + i * 20 + k, 0.02);
      sGeoms.push(taperedTube(sPath, {
        r0: 0.050, r1: 0.020, radialSegments: 8, uvScaleV: 1.15,
        radiusNoise: 0.12, seed: 1100 + i * 20 + k
      }));
      const sCurve = new THREE.CatmullRomCurve3(sPath.map(p => p.clone()));
      budSites.push({ point: sCurve.getPointAt(0.34), dir: new THREE.Vector3(Math.sin(sa), 0.3, Math.cos(sa)), level: 2 });

      /* 三级枝 / 结果枝组：2 条 */
      for (let j = 0; j < 2; j++) {
        const tt = 0.48 + j * 0.36 + rand() * 0.06;
        const tp = sCurve.getPointAt(clamp(tt, 0, 1));
        const ta = sa + (j ? 1 : -1) * GA * 0.48 + (rand() - 0.5) * 0.35;
        const tL = (0.62 + rand() * 0.28) * (1 - i * 0.03);
        const tep = tp.clone().add(new THREE.Vector3(
          Math.sin(ta) * tL * 0.85, (0.18 + rand() * 0.30) * tL, Math.cos(ta) * tL * 0.85
        ));
        const tPath = curvedPath(tp.toArray(), tep.toArray(), 0.15, 1300 + i * 50 + k * 4 + j, 0.01);
        tGeoms.push(taperedTube(tPath, {
          r0: 0.022, r1: 0.0095, radialSegments: 6, uvScaleV: 1.4, seed: 1400 + i * 50 + k * 4 + j
        }));
        const tCurve = new THREE.CatmullRomCurve3(tPath.map(p => p.clone()));

        // 约 1/5 三级枝发育为结果枝组（短果枝）
        if ((i + k * 2 + j) % 5 === 0) {
          spurs.push({
            point: tCurve.getPointAt(0.80),
            dir: tCurve.getTangentAt(0.80).clone(),
            normal: new THREE.Vector3(Math.sin(ta), 0.5, Math.cos(ta)).normalize(),
            index: i * 100 + k * 10 + j
          });
        }
        budSites.push({ point: tCurve.getPointAt(0.22), dir: new THREE.Vector3(Math.sin(ta), 0.2, Math.cos(ta)), level: 3 });

        /* 末梢 / 副梢：2 条二叉分枝 */
        for (let m = 0; m < 2; m++) {
          const mp = tCurve.getPointAt(0.72 + m * 0.24);
          const ma = ta + (m ? 1 : -1) * (0.55 + rand() * 0.45);
          const mL = 0.24 + rand() * 0.20;
          const mep = mp.clone().add(new THREE.Vector3(
            Math.sin(ma) * mL, (0.30 + rand() * 0.42) * mL, Math.cos(ma) * mL
          ));
          const mPath = curvedPath(mp.toArray(), mep.toArray(), 0.10, 1600 + i * 100 + k * 20 + j * 4 + m, 0.0);
          shGeoms.push(taperedTube(mPath, {
            r0: 0.010, r1: 0.0038, radialSegments: 5, uvScaleV: 1.8, seed: 1700 + i * 100 + k * 20 + j * 4 + m
          }));
          twigs.push({
            point: mep.clone(),
            base: mp.clone(),
            dir: mep.clone().sub(mp).normalize(),
            azimuth: ma,
            index: i * 1000 + k * 100 + j * 10 + m,
            level: i
          });
        }
      }
    }

    const add = (geoms, partId, mat) => {
      if (!geoms.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(geoms, false), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      G.add(mesh);
      R.attach(partId, mesh);
    };
    add(pGeoms, 'branch-primary', M.get('branchBark'));
    add(sGeoms, 'branch-secondary', M.get('branchBark'));
    add(tGeoms, 'branch-tertiary', M.get('branchBark'));
    add(shGeoms, 'branch-shoot', M.get('branchBark'));

    y += internode(i);
  }

  ctx.info.twigs = twigs;
  ctx.info.spurs = spurs.slice(0, 18);
  ctx.info.budSites = budSites;
  ctx.info.primaryCount = 8;
}
