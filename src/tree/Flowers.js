import * as THREE from 'three';
import { makePetalGeometry, makeScaleGeometry, mergeGeometries } from '../core/GeometryUtils.js';

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/**
 * 苹果花：完全花、辐射对称、子房下位
 *  5 萼片 / 5 花瓣 / 雄蕊多数（模型取 20 枚，5 轮）/ 雌蕊 1 枚 5 心皮
 *  伞房花序：中心花先开，周围 4 朵后开
 */
export function buildFlowers(ctx) {
  const { materials: M, registry: R, groups, rand } = ctx;
  const G = groups.flower;
  const cluster = new THREE.Group();
  G.add(cluster);
  const spurs = (ctx.info.spurs || []).slice(0, 7);
  const flowers = [];

  const petalGeo = makePetalGeometry({ length: 0.235, width: 0.185, nx: 12, ny: 14 });
  const sepalGeo = makeScaleGeometry({ width: 0.075, height: 0.10, curvature: 0.5, seg: 6 });
  const filamentGeo = new THREE.CylinderGeometry(0.0020, 0.0032, 1, 4, 1);
  filamentGeo.translate(0, 0.5, 0);
  const antherGeo = new THREE.SphereGeometry(0.0085, 6, 5);
  const styleGeo = new THREE.CylinderGeometry(0.0024, 0.0040, 1, 5, 1);
  styleGeo.translate(0, 0.5, 0);
  const pollenGeo = new THREE.BufferGeometry();

  function makeFlower(pos, up, scale, isCenter) {
    const flower = new THREE.Group();
    flower.position.copy(pos);
    flower.quaternion.setFromUnitVectors(Y, up.clone().normalize());
    flower.scale.setScalar(scale);
    cluster.add(flower);

    /* 花托（子房下位，包埋于花托组织） */
    const receptacle = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.045, 12), M.get('receptacle'));
    receptacle.position.y = 0.006;
    flower.add(receptacle);
    const ovary = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), M.get('ovary'));
    ovary.position.y = 0.004;
    ovary.scale.set(1, 0.7, 1);
    flower.add(ovary);

    /* 5 枚萼片：向外反卷 */
    const sepals = [];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const q = new THREE.Quaternion().setFromAxisAngle(Y, a)
        .multiply(new THREE.Quaternion().setFromAxisAngle(X, 1.95));
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(0, 0.018, 0), q, new THREE.Vector3(1, 1, 1)
      );
      sepals.push(sepalGeo.clone().applyMatrix4(m));
    }
    const sepalMesh = new THREE.Mesh(mergeGeometries(sepals, false), M.get('sepal'));
    sepalMesh.castShadow = true;
    flower.add(sepalMesh);

    const sepalGroup = new THREE.Group();
    sepalGroup.add(receptacle, ovary, sepalMesh);
    flower.remove(receptacle, ovary, sepalMesh);
    flower.add(sepalGroup);
    R.attach('flower-sepal', sepalGroup);

    /* 5 枚花瓣：爪部内收，瓣端外展 */
    const petals = [];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + (isCenter ? 0 : 0.18);
      const open = 1.02 + (k % 2) * 0.06;
      const q = new THREE.Quaternion().setFromAxisAngle(Y, a)
        .multiply(new THREE.Quaternion().setFromAxisAngle(X, open));
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(0, 0.030, 0), q, new THREE.Vector3(1, 1, 1)
      );
      petals.push(petalGeo.clone().applyMatrix4(m));
    }
    const corolla = new THREE.Mesh(mergeGeometries(petals, false), M.get('petal'));
    corolla.castShadow = true; corolla.receiveShadow = true;
    flower.add(corolla);
    R.attach('flower-petal', corolla);

    /* 雄蕊群：20 枚，5 轮（苹果属通常 20 枚左右） */
    const filaments = [], anthers = [];
    const pollen = [];
    for (let k = 0; k < 20; k++) {
      const ring = k < 5 ? 0 : (k < 10 ? 1 : 2);
      const a = (k / 20) * Math.PI * 2 * 2 + ring * 0.31;
      const r = 0.030 + ring * 0.012;
      const len = 0.098 + ring * 0.013 + (rand() - 0.5) * 0.012;
      const lean = 0.20 + ring * 0.13;
      const q = new THREE.Quaternion().setFromAxisAngle(Y, a)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean));
      const origin = new THREE.Vector3(Math.sin(a) * r * 0.4, 0.038, Math.cos(a) * r * 0.4);
      filaments.push(filamentGeo.clone().applyMatrix4(
        new THREE.Matrix4().compose(origin, q, new THREE.Vector3(1, len, 1))
      ));
      const tip = origin.clone().add(new THREE.Vector3(0, len, 0).applyQuaternion(q));
      const an = antherGeo.clone();
      an.scale(1, 1.45, 0.75);
      an.applyMatrix4(new THREE.Matrix4().compose(tip, q, new THREE.Vector3(1, 1, 1)));
      anthers.push(an);
      for (let p = 0; p < 2; p++) {
        pollen.push(tip.x + (rand() - 0.5) * 0.024, tip.y + rand() * 0.018, tip.z + (rand() - 0.5) * 0.024);
      }
    }
    const androecium = new THREE.Group();
    const filMesh = new THREE.Mesh(mergeGeometries(filaments, false), M.get('filament'));
    const anMesh = new THREE.Mesh(mergeGeometries(anthers, false), M.get('anther'));
    androecium.add(filMesh, anMesh);
    const pg = pollenGeo.clone();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pollen, 3));
    const pollenPts = new THREE.Points(pg, M.get('pollen'));
    pollenPts.userData.noHighlight = true;
    androecium.add(pollenPts);
    flower.add(androecium);
    R.attach('flower-stamen', androecium);

    /* 雌蕊：5 心皮，花柱基部合生、上端分离，柱头 5 裂 */
    const gynoecium = new THREE.Group();
    const baseStyle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.055, 8), M.get('pistil'));
    baseStyle.position.y = 0.065;
    gynoecium.add(baseStyle);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const q = new THREE.Quaternion().setFromAxisAngle(Y, a)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.22));
      const origin = new THREE.Vector3(0, 0.088, 0);
      const st = styleGeo.clone().applyMatrix4(
        new THREE.Matrix4().compose(origin, q, new THREE.Vector3(1, 0.052, 1))
      );
      gynoecium.add(new THREE.Mesh(st, M.get('pistil')));
      const tip = origin.clone().add(new THREE.Vector3(0, 0.052, 0).applyQuaternion(q));
      const stigma = new THREE.Mesh(new THREE.SphereGeometry(0.006, 7, 6), M.get('stigma'));
      stigma.position.copy(tip);
      stigma.scale.set(1, 1.3, 1);
      gynoecium.add(stigma);
    }
    flower.add(gynoecium);
    R.attach('flower-pistil', gynoecium);

    flowers.push({ group: flower, isCenter });
  }

  spurs.forEach((spur, si) => {
    const up = spur.normal.clone().add(new THREE.Vector3(0, 0.55, 0)).normalize();
    const right = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 0, 1)).normalize();
    if (right.lengthSq() < 0.01) right.set(1, 0, 0);
    const forward = new THREE.Vector3().crossVectors(right, up).normalize();

    makeFlower(spur.point.clone().addScaledVector(up, 0.06), up, 1.06, true);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + si * 0.4;
      const off = right.clone().multiplyScalar(Math.cos(a) * 0.165)
        .addScaledVector(forward, Math.sin(a) * 0.165)
        .addScaledVector(up, 0.012);
      const p = spur.point.clone().add(off);
      // 花梗
      const ped = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.005, off.length(), 5), M.get('petiole')
      );
      ped.position.copy(spur.point).addScaledVector(off, 0.5);
      ped.quaternion.setFromUnitVectors(Y, off.clone().normalize());
      cluster.add(ped);
      makeFlower(p, up.clone().addScaledVector(right, Math.cos(a) * 0.25), 0.90, false);
    }
  });

  ctx.info.flowerCluster = cluster;
  ctx.info.flowers = flowers;
}
