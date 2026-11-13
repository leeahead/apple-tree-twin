import * as THREE from 'three';
import { makeAppleGeometry, makeScaleGeometry, mergeGeometries, mulberry32 } from '../core/GeometryUtils.js';

const Y = new THREE.Vector3(0, 1, 0);

let _dotTex = null;
/** 柔和圆点贴图：让绒毛 / 花粉粒子不再呈方块状 */
function softDot() {
  if (_dotTex) return _dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}

/**
 * 仁果（pome / 假果）：可食部分主要由花托发育而来，子房形成果心。
 * 模型包含果柄、梗洼、萼洼与宿存萼片、表皮角质/蜡质层与皮孔、幼果绒毛。
 */
export function buildFruits(ctx) {
  const { materials: M, registry: R, groups, rand } = ctx;
  const G = groups.fruit;
  const spurs = (ctx.info.spurs || []).slice(0, 16);
  const appleGeo = makeAppleGeometry({ segU: 48, segV: 36, seed: 4 });
  const sepalGeo = makeScaleGeometry({ width: 0.24, height: 0.30, curvature: 0.42, seg: 6 });
  const fruitGroups = [];
  const fuzzPoints = [];

  spurs.forEach((spur, i) => {
    const s0 = 0.255 * (0.90 + rand() * 0.20);
    const tilt = (rand() - 0.5) * 0.34;
    const stemDir = new THREE.Vector3(Math.sin(tilt) * 0.30, 1, Math.cos(tilt) * 0.22).normalize();
    const group = new THREE.Group();
    group.quaternion.setFromUnitVectors(Y, stemDir);
    group.position.copy(spur.point).addScaledVector(stemDir, -1.20 * s0);
    group.scale.setScalar(s0);
    G.add(group);

    /* 果体（含梗洼 / 萼洼的几何凹陷） */
    const body = new THREE.Mesh(appleGeo, M.get('fruit'));
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    R.attach('fruit-body', body);

    /* 表皮蜡质层：略大的高光壳，不参与射线拾取以免遮挡果体 */
    const wax = new THREE.Mesh(appleGeo, M.get('fruitWax'));
    wax.scale.setScalar(1.014);
    wax.renderOrder = 2;
    wax.raycast = () => {};
    wax.userData.noHighlight = true;
    group.add(wax);
    R.attach('fruit-wax', wax);

    /* 果柄：从梗洼中心连至结果枝 */
    const pedicel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.027, 0.61, 7), M.get('pedicel'));
    pedicel.position.y = 0.615 + 0.305;
    pedicel.castShadow = true;
    group.add(pedicel);
    R.attach('fruit-pedicel', pedicel);
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), M.get('pedicel'));
    knuckle.position.y = 1.225;
    group.add(knuckle);
    // 果台：连回结果枝的短枝段，避免果柄视觉上悬空
    const spurTwig = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.030, 0.28, 6), M.get('branchBark'));
    spurTwig.position.y = 1.34;
    spurTwig.rotation.z = 0.20;
    group.add(spurTwig);

    /* 梗洼：凹陷边缘的果肩环与放射状锈纹 */
    const cavityGroup = new THREE.Group();
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.30, 0.011, 6, 40),
      new THREE.MeshStandardMaterial({ color: 0xa8843e, roughness: 0.92, transparent: true, opacity: 0.55 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.635;
    cavityGroup.add(rim);
    const rays = [];
    const rr = mulberry32(500 + i);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const r0 = 0.30, r1 = 0.36 + rr() * 0.13;
      rays.push(Math.sin(a) * r0, 0.637 - rr() * 0.02, Math.cos(a) * r0,
        Math.sin(a) * r1, 0.55, Math.cos(a) * r1);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rays, 3));
    cavityGroup.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9a7438, transparent: true, opacity: 0.42 })));
    group.add(cavityGroup);
    R.attach('fruit-stemcavity', cavityGroup);

    /* 萼洼与宿存萼片：5 枚，萼筒残迹 */
    const calyxGroup = new THREE.Group();
    const basin = new THREE.Mesh(
      new THREE.TorusGeometry(0.25, 0.014, 6, 36),
      new THREE.MeshStandardMaterial({ color: 0x7c8a4c, roughness: 0.9 })
    );
    basin.rotation.x = Math.PI / 2;
    basin.position.y = -0.735;
    calyxGroup.add(basin);
    const sepals = [];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const q = new THREE.Quaternion().setFromAxisAngle(Y, a)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.15));
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.sin(a) * 0.09, -0.74, Math.cos(a) * 0.09), q, new THREE.Vector3(1, 1, 1)
      );
      sepals.push(sepalGeo.clone().applyMatrix4(m));
    }
    const sepMesh = new THREE.Mesh(mergeGeometries(sepals, false), M.get('calyx'));
    calyxGroup.add(sepMesh);
    const styleRemnant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.09, 6), M.get('calyx'));
    styleRemnant.position.y = -0.74;
    calyxGroup.add(styleRemnant);
    group.add(calyxGroup);
    R.attach('fruit-calyxbasin', calyxGroup);

    /* 幼果绒毛（教学放大，随成熟度淡出） */
    const fuzz = [];
    const fr = mulberry32(900 + i);
    for (let k = 0; k < 120; k++) {
      const th = fr() * Math.PI, ph = fr() * Math.PI * 2;
      let r = Math.pow(Math.sin(th), 0.76) * (1 + 0.115 * Math.sin(th));
      r *= 1 + 0.048 * Math.cos(5 * ph) * Math.sin(th);
      r *= 1 - 0.205 * Math.max(0, -Math.cos(th));
      let y = Math.cos(th) * 0.94;
      y -= 0.325 * Math.exp(-Math.pow(th / 0.42, 2));
      y += 0.205 * Math.exp(-Math.pow((Math.PI - th) / 0.38, 2));
      const px = r * Math.cos(ph) * 1.016, py = y * 1.016, pz = r * Math.sin(ph) * 1.016;
      fuzz.push(px, py, pz);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fuzz, 3));
    const fuzzMat = new THREE.PointsMaterial({
      color: 0xd9d6bd, size: 0.014, map: softDot(),
      transparent: true, opacity: 0.36, depthWrite: false
    });
    const pts = new THREE.Points(fg, fuzzMat);
    pts.raycast = () => {};
    pts.userData.noHighlight = true;
    group.add(pts);
    fuzzPoints.push(pts);

    fruitGroups.push({ group, s0, body });
  });

  /* ---- 果实横切面标本：5 心皮果心与种子 ---- */
  const section = new THREE.Group();
  section.position.set(-2.18, 0.86, 1.72);
  section.rotation.set(-0.18, -0.40, 0.12);
  const skinSide = new THREE.MeshPhysicalMaterial({
    color: 0xc9534a, roughness: 0.32, clearcoat: 0.75, clearcoatRoughness: 0.12
  });
  const slice = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.055, 56),
    [skinSide, M.get('flesh'), M.get('flesh')]
  );
  slice.castShadow = true;
  section.add(slice);
  const skin = new THREE.Mesh(
    new THREE.TorusGeometry(0.338, 0.010, 6, 64),
    new THREE.MeshPhysicalMaterial({ color: 0xc4443c, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.12 })
  );
  skin.rotation.x = Math.PI / 2;
  section.add(skin);

  // 心皮边界（五角形果心线）与维管束
  const lines = [];
  for (let k = 0; k < 5; k++) {
    const a0 = (k / 5) * Math.PI * 2, a1 = ((k + 1) / 5) * Math.PI * 2;
    const R = 0.135;
    lines.push(Math.cos(a0) * R, 0.030, Math.sin(a0) * R, Math.cos(a1) * R, 0.030, Math.sin(a1) * R);
    const am = (a0 + a1) / 2;
    lines.push(0, 0.030, 0, Math.cos(am) * 0.31, 0.030, Math.sin(am) * 0.31);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  section.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xc7ad7e, transparent: true, opacity: 0.75 })));

  const seedGroup = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.030, 10, 8), M.get('seed'));
    seed.position.set(Math.cos(a) * 0.085, 0.038, Math.sin(a) * 0.085);
    seed.scale.set(0.72, 0.42, 1.5);
    seed.rotation.y = -a;
    seed.castShadow = true;
    seedGroup.add(seed);
  }
  section.add(seedGroup);
  for (const sx of [-0.22, 0.22]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.017, 0.80, 8), M.get('gravel'));
    leg.position.set(sx, -0.43, 0);
    section.add(leg);
  }
  const secHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.004, 5, 80),
    new THREE.MeshBasicMaterial({ color: 0xe0b871, transparent: true, opacity: 0.42 })
  );
  secHalo.rotation.x = Math.PI / 2.5;
  section.add(secHalo);
  G.add(section);
  R.attach('fruit-seed', section);
  ctx.info.fruitSection = section;

  ctx.info.fruitGroups = fruitGroups;
  ctx.info.fuzzPoints = fuzzPoints;

  /** 果实发育：尺寸、绒毛、蜡质与表皮贴图联动 */
  ctx.setFruitGrowth = (t, phenoScale) => {
    const s = THREE.MathUtils.clamp(phenoScale, 0.05, 1.2);
    for (const f of fruitGroups) f.group.scale.setScalar(f.s0 * s);
    for (const p of fuzzPoints) {
      p.visible = t < 0.62;
      p.material.opacity = 0.36 * (1 - THREE.MathUtils.clamp(t / 0.62, 0, 1));
    }
  };
}
