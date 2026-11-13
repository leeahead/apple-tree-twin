import * as THREE from 'three';
import { makeScaleGeometry, mergeGeometries } from '../core/GeometryUtils.js';
import { WORLD } from '../core/constants.js';

const Y = new THREE.Vector3(0, 1, 0);

/**
 * 芽：叶芽（瘦尖、鳞片少）与花芽（肥大钝圆、鳞片多、密被绒毛）
 * 鳞片为独立可点选部位，绒毛为教学放大的表皮附属物。
 */
export function buildBuds(ctx) {
  const { materials: M, registry: R, groups, rand } = ctx;
  const G = groups.bud;
  const sites = ctx.info.budSites || [];
  const GA = WORLD.goldenAngle;
  const coreGeo = new THREE.SphereGeometry(0.030, 10, 8);
  const scaleGeo = makeScaleGeometry({ width: 0.055, height: 0.090, curvature: 0.42, seg: 6 });
  const buds = [];

  const count = Math.min(sites.length, 52);
  for (let i = 0; i < count; i++) {
    const site = sites[(i * 7 + 3) % sites.length];
    const isFlower = i % 3 === 0;
    const group = new THREE.Group();
    group.position.copy(site.point);
    const dir = site.dir.clone().normalize();
    group.quaternion.setFromUnitVectors(Y, dir);
    G.add(group);

    const scaleK = isFlower ? 1.28 : 0.94;
    group.scale.setScalar(scaleK * (0.88 + rand() * 0.24));

    // 芽轴 / 雏形
    const core = new THREE.Mesh(coreGeo, isFlower ? M.get('budFlower') : M.get('budLeaf'));
    core.scale.set(0.86, isFlower ? 1.35 : 1.72, 0.86);
    core.position.y = 0.042;
    core.castShadow = true;
    group.add(core);

    // 覆瓦状芽鳞：花芽 8 片、叶芽 5 片，黄金角错位
    const nScale = isFlower ? 8 : 5;
    const parts = [];
    const hairPts = [];
    for (let k = 0; k < nScale; k++) {
      const ring = k / nScale;
      const angle = k * GA + (isFlower ? 0.3 : 0);
      const tilt = -0.16 - ring * 0.20;
      const q = new THREE.Quaternion().setFromAxisAngle(Y, angle)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
      const radial = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(Y, angle));
      const r = (isFlower ? 0.026 : 0.021) * (1 - ring * 0.28);
      const pos = radial.multiplyScalar(r).add(new THREE.Vector3(0, -0.012 + ring * 0.020, 0));
      const s = 0.80 + (1 - ring) * 0.42;
      const mat = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s, s * (isFlower ? 0.95 : 1.12), s));
      const g = scaleGeo.clone().applyMatrix4(mat);
      parts.push(g);

      // 绒毛：从鳞片表面放射
      const nh = isFlower ? 7 : 3;
      for (let h = 0; h < nh; h++) {
        const hy = 0.012 + (h / nh) * 0.062 + rand() * 0.012;
        const hx = (rand() - 0.5) * 0.036;
        const local = new THREE.Vector3(hx, hy, 0.026 + rand() * 0.012).applyQuaternion(q).add(pos);
        const out = local.clone().normalize().multiplyScalar(0.018 + rand() * 0.026);
        hairPts.push(local.x, local.y, local.z, local.x + out.x, local.y + out.y + 0.012, local.z + out.z);
      }
    }
    const scales = new THREE.Mesh(mergeGeometries(parts, false), M.get('budScale'));
    scales.castShadow = true;
    group.add(scales);
    R.attach('bud-scale', scales);

    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(hairPts, 3));
    const hairs = new THREE.LineSegments(hg, M.get('budHair'));
    hairs.userData.noHighlight = true;
    group.add(hairs);

    // 芽鳞顶尖（生长点）
    const apex = new THREE.Mesh(
      new THREE.ConeGeometry(isFlower ? 0.016 : 0.012, isFlower ? 0.026 : 0.038, 7),
      isFlower ? M.get('budFlower') : M.get('budLeaf')
    );
    apex.position.y = isFlower ? 0.098 : 0.105;
    group.add(apex);

    R.attach(isFlower ? 'bud-flower' : 'bud-leaf', group);
    buds.push({ group, isFlower });
  }
  ctx.info.buds = buds;
}
