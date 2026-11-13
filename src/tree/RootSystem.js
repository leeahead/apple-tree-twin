import * as THREE from 'three';
import { WORLD } from '../core/constants.js';
import { taperedTube, curvedPath, mergeGeometries, lerp } from '../core/GeometryUtils.js';

/**
 * 四级根系拓扑：
 *  主根 Radix primaria  → 输导根（木质化骨干根）→ 生长根（延伸根）→ 吸收根（须根 / 根毛）
 * 各级采用不同的半径衰减、弯曲度与 PBR 反射属性。
 * 根系朝土壤剖切剪口方向偏置，保证地下结构可视。
 */
export function buildRootSystem(ctx) {
  const { materials: M, registry: R, groups, rand } = ctx;
  const G = groups.root;
  const cut = Math.atan2(WORLD.defaultCamera.x, WORLD.defaultCamera.z);
  const bias = (spread = 1.35) => cut + (rand() - 0.5) * 2 * spread;
  const hairPts = [];
  const tipGeoms = [];

  /* ---- 主根 ---- */
  const tapPath = curvedPath(
    [0, -0.02, 0], [0.16, -WORLD.soilDepth * 0.82, 0.10],
    0.10, 17, -0.02
  );
  const tap = new THREE.Mesh(
    taperedTube(tapPath, { r0: 0.30, r1: 0.055, radialSegments: 20, uvScaleV: 0.85, radiusNoise: 0.16, seed: 71 }),
    M.get('rootBark')
  );
  tap.castShadow = true; tap.receiveShadow = true;
  G.add(tap);
  R.attach('root-taproot', tap);

  /* ---- 输导根（骨干根） ---- */
  const conducting = [];
  for (let i = 0; i < 7; i++) {
    const a = i < 5 ? bias(1.15) : cut + Math.PI + (rand() - 0.5) * 1.5;
    const drop = 0.45 + i * 0.17;
    const len = lerp(2.7, 4.15, rand());
    const end = new THREE.Vector3(
      Math.sin(a) * len, -drop - rand() * 0.5, Math.cos(a) * len
    );
    const start = new THREE.Vector3(Math.sin(a) * 0.20, -0.16 - i * 0.055, Math.cos(a) * 0.20);
    const path = curvedPath(start.toArray(), end.toArray(), 0.11, 200 + i, -0.05);
    const geo = taperedTube(path, {
      r0: lerp(0.145, 0.09, i / 7), r1: 0.032,
      radialSegments: 12, uvScaleV: 1.0, radiusNoise: 0.2, seed: 210 + i
    });
    const mesh = new THREE.Mesh(geo, M.get('rootConducting'));
    mesh.castShadow = true; mesh.receiveShadow = true;
    G.add(mesh);
    R.attach('root-conducting', mesh);
    conducting.push({ path, angle: a, end, index: i });
  }

  /* ---- 生长根（延伸根）+ 吸收根（须根） ---- */
  conducting.forEach((root, ri) => {
    const growingGeoms = [];
    const absorbingGeoms = [];
    const nGrow = 2 + (ri % 2);
    for (let g = 0; g < nGrow; g++) {
      const t = 0.38 + g * 0.22 + rand() * 0.1;
      const curve = new THREE.CatmullRomCurve3(root.path.map(p => p.clone()));
      const base = curve.getPointAt(Math.min(0.98, t));
      const a = root.angle + (g % 2 ? 1 : -1) * (0.45 + rand() * 0.65);
      const len = 0.95 + rand() * 1.15;
      const drop = 0.25 + rand() * 0.75;
      const end = base.clone().add(new THREE.Vector3(Math.sin(a) * len, -drop, Math.cos(a) * len));
      end.y = Math.max(-WORLD.soilDepth + 0.18, end.y);
      const gPath = curvedPath(base.toArray(), end.toArray(), 0.14, 400 + ri * 10 + g, -0.03);
      growingGeoms.push(taperedTube(gPath, {
        r0: 0.036, r1: 0.012, radialSegments: 7, uvScaleV: 1.3, radiusNoise: 0.12, seed: 430 + ri * 10 + g
      }));

      // 每个生长根上着生 9–14 条吸收根，二叉/三叉细分
      const gCurve = new THREE.CatmullRomCurve3(gPath.map(p => p.clone()));
      const nAbs = 9 + Math.floor(rand() * 6);
      for (let k = 0; k < nAbs; k++) {
        const s = 0.14 + (k / nAbs) * 0.82;
        const bp = gCurve.getPointAt(Math.min(0.99, s));
        const aa = a + (k % 2 ? 1 : -1) * (0.8 + rand() * 1.1);
        const al = 0.22 + rand() * 0.46;
        const ep = bp.clone().add(new THREE.Vector3(
          Math.sin(aa) * al, -(0.10 + rand() * 0.36), Math.cos(aa) * al
        ));
        ep.y = Math.max(-WORLD.soilDepth + 0.09, ep.y);
        const mid = bp.clone().lerp(ep, 0.55).add(new THREE.Vector3((rand() - 0.5) * 0.09, 0, (rand() - 0.5) * 0.09));
        const aPath = [bp, mid, ep];
        absorbingGeoms.push(taperedTube(aPath, {
          r0: 0.0105, r1: 0.0028, radialSegments: 5, uvScaleV: 2.0, seed: 700 + ri * 100 + g * 20 + k
        }));
        // 根毛（教学放大）
        for (let h = 0; h < 5; h++) {
          const hp = bp.clone().lerp(ep, 0.45 + h * 0.11);
          const ha = aa + (h % 2 ? 0.7 : -0.7) + (rand() - 0.5) * 0.6;
          const hl = 0.035 + rand() * 0.055;
          hairPts.push(
            hp.x, hp.y, hp.z,
            hp.x + Math.cos(ha) * hl, hp.y - hl * 0.25, hp.z + Math.sin(ha) * hl
          );
        }
        const tip = new THREE.SphereGeometry(0.013, 6, 5);
        tip.translate(ep.x, ep.y, ep.z);
        tipGeoms.push(tip);
      }
    }
    if (growingGeoms.length) {
      const mesh = new THREE.Mesh(mergeGeometries(growingGeoms, false), M.get('rootGrowing'));
      mesh.castShadow = true;
      G.add(mesh);
      R.attach('root-growing', mesh);
    }
    if (absorbingGeoms.length) {
      const mesh = new THREE.Mesh(mergeGeometries(absorbingGeoms, false), M.get('rootAbsorbing'));
      G.add(mesh);
      R.attach('root-absorbing', mesh);
    }
  });

  // 根毛
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(hairPts, 3));
  const hairs = new THREE.LineSegments(hg, M.get('rootHair'));
  hairs.userData.noHighlight = true;
  G.add(hairs);
  R.attach('root-hair', hairs);

  // 根尖分生区发光点
  if (tipGeoms.length) {
    const tips = new THREE.Mesh(mergeGeometries(tipGeoms, false), M.get('rootTipGlow'));
    tips.userData.noHighlight = true;
    G.add(tips);
  }

  /* ---- 根颈与嫁接口 ---- */
  const collar = new THREE.Group();
  const swell = new THREE.Mesh(
    new THREE.SphereGeometry(0.50, 28, 18), M.get('graftUnion')
  );
  swell.scale.set(1, 0.30, 1);
  swell.position.y = -0.055;
  collar.add(swell);
  // 嫁接愈合环（砧木 / 接穗交界）
  const union = new THREE.Mesh(
    new THREE.TorusGeometry(0.465, 0.035, 10, 40), M.get('rootBark')
  );
  union.rotation.x = Math.PI / 2;
  union.position.y = 0.075;
  collar.add(union);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const bump = new THREE.Mesh(new THREE.SphereGeometry(0.055 + rand() * 0.035, 8, 6), M.get('graftUnion'));
    bump.position.set(Math.sin(a) * 0.46, 0.075, Math.cos(a) * 0.46);
    bump.scale.set(1, 0.55, 1);
    collar.add(bump);
  }
  collar.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  G.add(collar);
  R.attach('root-collar', collar);

  ctx.info.rootHairs = hairs;
}
