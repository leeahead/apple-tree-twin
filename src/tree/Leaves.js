import * as THREE from 'three';
import {
  makeLeafGeometry, makeLeafVeinLines, makeStomataPoints
} from '../core/GeometryUtils.js';
import { clamp, lerp } from '../core/GeometryUtils.js';

const Y = new THREE.Vector3(0, 1, 0);

/** 每片叶 = 独立 Group：叶肉网格 + 叶脉网络 + 下表皮气孔 + 叶柄 */
export function buildLeaves(ctx) {
  const { materials: M, registry: R, groups, rand } = ctx;
  const G = groups.leaf;
  const twigs = ctx.info.twigs || [];
  // 除末梢叶外，在二级/三级枝节位补充叶丛，形成更饱满的冠层
  const extra = (ctx.info.budSites || [])
    .filter((_, i) => i % 4 === 0).slice(0, 52)
    .map((s, i) => ({ point: s.point.clone(), dir: s.dir.clone(), azimuth: i * 0.7, index: 9000 + i, level: 2 }));
  const leafSites = twigs.concat(extra);

  const LEAF_L = 0.50, LEAF_W = 0.28;
  const bladeGeo = makeLeafGeometry({ length: LEAF_L, width: LEAF_W, seed: 3 });
  const veinGeo = new THREE.BufferGeometry();
  veinGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    makeLeafVeinLines({ length: LEAF_L, width: LEAF_W, pairs: 7, seed: 1 }), 3
  ));
  const stomGeo = new THREE.BufferGeometry();
  stomGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    makeStomataPoints({ length: LEAF_L, width: LEAF_W, count: 170, seed: 9 }), 3
  ));
  const petioleGeo = new THREE.CylinderGeometry(0.0042, 0.0072, 1, 5, 1);
  petioleGeo.translate(0, 0.5, 0);

  const leaves = [];
  const stomataPoints = [];

  for (let n = 0; n < leafSites.length; n++) {
    const tw = leafSites[n];
    const size = 0.82 + rand() * 0.42;
    const leafDir = tw.dir.clone().add(new THREE.Vector3(0, 0.52 + rand() * 0.24, 0)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(Y, leafDir);

    // 就眠/向光：让叶面法线（局部 +Z）尽量朝上，再叠小幅随机扭转
    let best = 0, bestY = -2;
    const probe = new THREE.Vector3();
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      const tq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y, ang));
      probe.set(0, 0, 1).applyQuaternion(tq);
      if (probe.y > bestY) { bestY = probe.y; best = ang; }
    }
    q.multiply(new THREE.Quaternion().setFromAxisAngle(Y, best + (rand() - 0.5) * 1.15));

    const group = new THREE.Group();
    const petioleLen = 0.085 + rand() * 0.045;
    const base = tw.point.clone().addScaledVector(leafDir, petioleLen);
    group.position.copy(base);
    group.quaternion.copy(q);
    group.scale.setScalar(size);
    G.add(group);

    // 叶肉网格（含夜间卷曲 morph target）
    const blade = new THREE.Mesh(bladeGeo, M.get('leaf'));
    blade.castShadow = true;
    blade.receiveShadow = true;
    blade.morphTargetInfluences[0] = 0;
    group.add(blade);
    R.attach('leaf-blade', blade);

    // 三级叶脉网络（与叶面共形，略微抬高避免 z-fighting）
    const veins = new THREE.LineSegments(veinGeo, M.get('vein'));
    veins.position.z = 0.0035;
    veins.userData.noHighlight = false;
    group.add(veins);
    R.attach('leaf-vein', veins);

    // 下表皮气孔（微观结构，默认隐藏，聚焦气孔观察时显示）
    const stomata = new THREE.Points(stomGeo, M.get('stomata'));
    stomata.visible = false;
    stomata.userData.noHighlight = true;
    group.add(stomata);
    R.attach('leaf-stomata', stomata);
    stomataPoints.push(stomata);

    // 叶柄：从枝条节位连到叶基，带叶枕
    const pet = new THREE.Mesh(petioleGeo, M.get('petiole'));
    pet.position.copy(tw.point);
    pet.quaternion.setFromUnitVectors(Y, leafDir);
    pet.scale.set(1, petioleLen, 1);
    pet.castShadow = true;
    G.add(pet);
    R.attach('leaf-petiole', pet);

    const cushion = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 5), M.get('petiole'));
    cushion.position.copy(base);
    cushion.scale.set(1.4, 0.7, 1);
    G.add(cushion);

    const droopAxis = new THREE.Vector3(-leafDir.z, 0, leafDir.x).normalize();
    leaves.push({ group, blade, qDay: q.clone(), droopAxis, phase: rand() * Math.PI * 2 });
  }

  ctx.info.leaves = leaves;
  ctx.info.stomataPoints = stomataPoints;

  /** 昼夜形态：叶片就眠性下垂 + 叶缘内卷 + 气孔开闭 */
  ctx.leafDayNight = (night, t = 0) => {
    const droop = new THREE.Quaternion();
    for (const l of leaves) {
      const n = clamp(night, 0, 1);
      l.blade.morphTargetInfluences[0] = n;
      droop.setFromAxisAngle(l.droopAxis, n * (0.15 + Math.sin(t * 0.6 + l.phase) * 0.012));
      l.group.quaternion.copy(l.qDay).premultiply(droop);
    }
    M.get('stomata').size = lerp(0.0125, 0.0055, night);
  };
}
