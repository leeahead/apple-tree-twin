import * as THREE from 'three';
import { WORLD } from '../core/constants.js';
import { taperedTube, curvedPath, fbm, lerp, mulberry32 } from '../core/GeometryUtils.js';

const trunkRadius = (y) => lerp(WORLD.trunkBaseRadius, WORLD.trunkTopRadius,
  Math.min(1, Math.max(0, y / WORLD.trunkHeight))) + 0.012 * Math.sin(y * 3.1);

/** 贴合树干曲面的不规则树皮片 / 剥落观察窗 */
function makeTrunkPatch(y0, y1, a0, a1, opts = {}) {
  const { offset = 0.014, nx = 14, ny = 14, seed = 1, ragged = 0.055, wobble = 0.006 } = opts;
  const rand = mulberry32(seed);
  const pos = [], nor = [], uv = [], idx = [];
  const driftA = Array.from({ length: ny + 1 }, () => (rand() - 0.5) * ragged);
  const driftB = Array.from({ length: ny + 1 }, () => (rand() - 0.5) * ragged);
  for (let j = 0; j <= ny; j++) {
    const v = j / ny, y = lerp(y0, y1, v);
    const aa = a0 + driftA[j], bb = a1 + driftB[j];
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, a = lerp(aa, bb, u);
      const n = fbm(u * 7 + seed, v * 5, 3, seed) - 0.5;
      const r = trunkRadius(y) + offset + n * wobble;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      nor.push(Math.sin(a), 0.08, Math.cos(a));
      uv.push(u, v * (y1 - y0) * 1.4);
    }
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = j * (nx + 1) + i, q = p + nx + 1;
    idx.push(p, q, p + 1, q, q + 1, p + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function buildTrunk(ctx) {
  const { materials: M, registry: R, groups, rand } = ctx;
  const G = groups.trunk;
  const cut = Math.atan2(WORLD.defaultCamera.x, WORLD.defaultCamera.z);

  /* ---- 主干木质轴体（树皮 PBR + 位移） ---- */
  const path = curvedPath([0, 0.02, 0], [0.035, WORLD.trunkHeight, -0.02], 0.025, 91, 0.006);
  const body = new THREE.Mesh(
    taperedTube(path, {
      r0: WORLD.trunkBaseRadius, r1: WORLD.trunkTopRadius,
      radialSegments: 44, tubularSegments: 72, uvScaleV: 0.62,
      radiusNoise: 0.10, seed: 92
    }),
    M.get('bark')
  );
  body.castShadow = true; body.receiveShadow = true;
  G.add(body);
  R.attach('trunk-body', body);

  /* ---- 可交互树皮片：外凸的栓皮鳞块，裂纹法线更强烈 ---- */
  const barkMat = M.get('bark').clone();
  barkMat.normalScale.set(1.9, 1.9);
  barkMat.bumpScale = 0.075;
  barkMat.color.set(0xf0e2cb);
  for (let i = 0; i < 7; i++) {
    const y0 = 0.35 + i * 0.37 + rand() * 0.10;
    const a0 = cut - 0.85 + (i % 3) * 0.52 + rand() * 0.22;
    const patch = new THREE.Mesh(
      makeTrunkPatch(y0, y0 + 0.30 + rand() * 0.22, a0, a0 + 0.38 + rand() * 0.30,
        { offset: 0.022, seed: 130 + i, ragged: 0.09, wobble: 0.014 }),
      barkMat
    );
    patch.castShadow = true; patch.receiveShadow = true;
    G.add(patch);
    R.attach('trunk-bark', patch);
  }

  /* ---- 剥落观察窗：形成层 + 边材 + 木质部层次 ---- */
  const winY = 1.62, winA = cut + 0.22;
  const sapwood = new THREE.Mesh(
    makeTrunkPatch(winY - 0.15, winY + 0.16, winA - 0.25, winA + 0.25,
      { offset: 0.006, seed: 177, ragged: 0.035, wobble: 0.004 }),
    M.get('wood').clone()
  );
  sapwood.material.map = null;
  sapwood.material.transparent = false;
  sapwood.material.alphaTest = 0;
  sapwood.material.color.set(0x8a7050);
  G.add(sapwood);
  // 形成层：薄而湿润的浅绿环带，位于剥落区边缘
  const cambium = new THREE.Mesh(
    makeTrunkPatch(winY - 0.165, winY + 0.175, winA - 0.28, winA - 0.245,
      { offset: 0.020, nx: 4, ny: 18, seed: 178, ragged: 0.01, wobble: 0 }),
    M.get('cambium')
  );
  G.add(cambium);
  const cambium2 = cambium.clone();
  cambium2.geometry = makeTrunkPatch(winY - 0.165, winY + 0.175, winA + 0.245, winA + 0.28,
    { offset: 0.020, nx: 4, ny: 18, seed: 179, ragged: 0.01, wobble: 0 });
  G.add(cambium2);
  const cambiumGroup = new THREE.Group();
  G.remove(cambium, cambium2);
  cambiumGroup.add(cambium, cambium2, sapwood);
  G.add(cambiumGroup);
  R.attach('trunk-cambium', cambiumGroup);

  /* ---- 年轮横截面标本盘：心材 / 边材 / 髓射线 / 早晚材 ---- */
  const disc = new THREE.Group();
  disc.position.set(2.28, 0.86, 1.62);
  disc.rotation.set(-0.22, 0.42, 0.14);

  const woodTop = M.get('wood');
  const discBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.60, 0.60, 0.075, 72, 1, false),
    [M.get('bark'), woodTop, woodTop]
  );
  discBody.castShadow = true; discBody.receiveShadow = true;
  disc.add(discBody);

  // 边材 / 形成层 / 周皮 三层同心标记
  const ringSpecs = [
    { r: 0.585, c: 0x8fa863, o: 0.85, tube: 0.008 },
    { r: 0.535, c: 0xe0b871, o: 0.55, tube: 0.004 },
    { r: 0.205, c: 0xc98b5e, o: 0.5, tube: 0.004 }
  ];
  for (const s of ringSpecs) {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(s.r, s.tube, 6, 72),
      new THREE.MeshBasicMaterial({ color: s.c, transparent: true, opacity: s.o })
    );
    torus.rotation.x = Math.PI / 2;
    torus.position.y = 0.041;
    disc.add(torus);
  }
  // 髓心
  const pith = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), M.get('pith'));
  pith.position.y = 0.043;
  disc.add(pith);
  // 标本支架
  for (const sx of [-0.34, 0.34]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.82, 8), M.get('gravel'));
    leg.position.set(sx, -0.44, 0);
    disc.add(leg);
  }
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.004, 5, 96),
    new THREE.MeshBasicMaterial({ color: 0xe0b871, transparent: true, opacity: 0.42 })
  );
  halo.rotation.x = Math.PI / 2.6;
  disc.add(halo);
  G.add(disc);
  R.attach('trunk-annualring', disc);
  ctx.info.annualDisc = disc;
}
