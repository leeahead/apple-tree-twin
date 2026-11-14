import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WORLD, sampleDay } from './constants.js';
import { mulberry32, lerp, clamp } from './GeometryUtils.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = normalize(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 topColor, horizonColor, bottomColor, sunColor, sunDir;
uniform float sunIntensity, nightMix;
varying vec3 vDir;
float starHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.82, h));
  col = mix(bottomColor, col, smoothstep(-0.42, 0.015, h));
  float sd = max(dot(d, normalize(sunDir)), 0.0);
  float halo = pow(sd, 9.0) * 0.30 + pow(sd, 90.0) * 0.75 + pow(sd, 1600.0) * 2.4;
  col += sunColor * halo * (0.25 + sunIntensity * 0.36);
  col = mix(col, horizonColor, exp(-abs(h) * 8.0) * 0.14);
  if (nightMix > 0.01 && h > 0.02) {
    vec2 cell = floor(d.xz * 420.0 + h * 90.0);
    float s = step(0.9988, starHash(cell)) * step(0.35, starHash(cell + 17.3));
    col += vec3(0.72, 0.80, 1.0) * s * nightMix * 0.65;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const C = (hex) => new THREE.Color(hex);
function mixColor(target, sample) {
  target.set(sample.A).lerp(C(sample.B), sample.k);
  return target;
}

export class SceneManager {
  constructor(canvas, textureLib) {
    this.canvas = canvas;
    this.lib = textureLib;
    this.projection = 'perspective';
    this.dofEnabled = true;
    this.bloomEnabled = true;
    this.postOK = false;
    this.time = 9;
    this._aperture = 0.000015;
    this._apertureTarget = 0.000015;
    this._focus = 18;
    this._focusTarget = 18;
    this._focusStrength = 0;

    this._initRenderer();
    this._initScene();
    this._initCameras();
    this._initLights();
    this._initSky();
    this._initControls();
    this._initComposer();
    this.setTimeOfDay(9);
    this.resize();
  }

  /* -------------------------------------------------------------- */
  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: false,
      powerPreference: 'high-performance', stencil: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = C('#9db8b4');
    this.scene.fog = new THREE.Fog(C('#a8beb3'), 20, 74);
    this.scene.environment = this.lib.environment;
    this.scene.environmentIntensity = 0.85;
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.soilGroup = new THREE.Group();
    this.scene.add(this.soilGroup);
    this.decorGroup = new THREE.Group();
    this.scene.add(this.decorGroup);
    this.focusGroup = new THREE.Group();
    this.scene.add(this.focusGroup);
  }

  _initCameras() {
    const { defaultCamera: p, defaultTarget: t } = WORLD;
    const aspect = Math.max(1, window.innerWidth / Math.max(1, window.innerHeight));
    this.persp = new THREE.PerspectiveCamera(42, aspect, 0.05, 240);
    this.persp.position.set(p.x, p.y, p.z);
    this.persp.lookAt(t.x, t.y, t.z);
    this.orthoHalfHeight = 5.6;
    this.ortho = new THREE.OrthographicCamera(-this.orthoHalfHeight * aspect, this.orthoHalfHeight * aspect,
      this.orthoHalfHeight, -this.orthoHalfHeight, 0.05, 240);
    this.ortho.position.copy(this.persp.position);
    this.ortho.quaternion.copy(this.persp.quaternion);
    this.ortho.zoom = 0.82;
    this.ortho.updateProjectionMatrix();
    this.camera = this.persp;
  }

  _initLights() {
    this.hemi = new THREE.HemisphereLight(0xbcd8dc, 0x4a5036, 0.95);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe6bd, 2.25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    const sc = this.sun.shadow.camera;
    sc.left = -9.5; sc.right = 9.5; sc.top = 10.5; sc.bottom = -9.5;
    sc.near = 1; sc.far = 62;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.022;
    this.sun.shadow.radius = 2.2;
    this.scene.add(this.sun, this.sun.target);
    this.sun.target.position.set(0, 2.2, 0);

    this.fill = new THREE.DirectionalLight(0xa9c9d4, 0.62);
    this.fill.position.set(-8, 6, -9);
    this.scene.add(this.fill);

    this.rim = new THREE.DirectionalLight(0xffd6a0, 0.45);
    this.rim.position.set(4, 3, -11);
    this.scene.add(this.rim);

    this.moon = new THREE.DirectionalLight(0x8fa9e0, 0.0);
    this.moon.position.set(-6, 9, 6);
    this.scene.add(this.moon);

    this.focusLight = new THREE.PointLight(0xffd9a0, 0, 3.6, 2);
    this.scene.add(this.focusLight);
  }

  _initSky() {
    this.skyUniforms = {
      topColor: { value: C('#5b83a8') },
      horizonColor: { value: C('#dfe4d4') },
      bottomColor: { value: C('#39402c') },
      sunColor: { value: C('#ffdda0') },
      sunDir: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() },
      sunIntensity: { value: 2.0 },
      nightMix: { value: 0 }
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(105, 40, 24),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
        side: THREE.BackSide, depthWrite: false, fog: false
      })
    );
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    this.sky = sky;
    this.scene.add(sky);
  }

  _initControls() {
    const c = new OrbitControls(this.persp, this.canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.055;
    c.rotateSpeed = 0.62;
    c.zoomSpeed = 0.85;
    c.panSpeed = 0.7;
    c.screenSpacePanning = true;
    c.minDistance = 0.2;
    c.maxDistance = 46;
    c.minZoom = 0.25;
    c.maxZoom = 4;
    c.maxPolarAngle = Math.PI * 0.985;
    c.minPolarAngle = 0.015;
    c.target.set(WORLD.defaultTarget.x, WORLD.defaultTarget.y, WORLD.defaultTarget.z);
    c.update();
    this.controls = c;
  }

  /** 公开入口：重建轨道控制器，清除拖拽阻尼 / 平移 / 滚轮残留 */
  rebuildControls() { this._rebuildControls(); }

  _rebuildControls() {
    const old = this.controls;
    const target = old ? old.target.clone() : new THREE.Vector3(WORLD.defaultTarget.x, WORLD.defaultTarget.y, WORLD.defaultTarget.z);
    const enabled = old ? old.enabled : true;
    if (old) old.dispose();
    const c = new OrbitControls(this.camera, this.canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.055;
    c.rotateSpeed = 0.62;
    c.zoomSpeed = 0.85;
    c.panSpeed = 0.7;
    c.screenSpacePanning = true;
    c.minDistance = 0.2; c.maxDistance = 46;
    c.minZoom = 0.25; c.maxZoom = 4;
    c.maxPolarAngle = Math.PI * 0.985; c.minPolarAngle = 0.015;
    c.target.copy(target);
    c.enabled = enabled;
    c.update();
    this.controls = c;
  }

  _initComposer() {
    try {
      const composer = new EffectComposer(this.renderer);
      this.renderPass = new RenderPass(this.scene, this.camera);
      composer.addPass(this.renderPass);

      this.bokehPass = new BokehPass(this.scene, this.camera, {
        focus: 18, aperture: 0.000015, maxblur: 0.011
      });
      composer.addPass(this.bokehPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 0.26, 0.58, 0.95
      );
      composer.addPass(this.bloomPass);

      composer.addPass(new OutputPass());
      this.composer = composer;
      this.postOK = true;
      this.setDOF(this.dofEnabled);
      this.setBloom(this.bloomEnabled);
    } catch (err) {
      console.warn('[SceneManager] 后处理不可用，已降级为直接渲染：', err);
      this.postOK = false;
    }
  }

  _updatePostCamera() {
    if (!this.postOK) return;
    this.renderPass.camera = this.camera;
    this.bokehPass.camera = this.camera;
    const defs = this.bokehPass.materialBokeh.defines;
    const want = this.camera.isPerspectiveCamera ? 1 : 0;
    if (defs.PERSPECTIVE_CAMERA !== want) {
      defs.PERSPECTIVE_CAMERA = want;
      // 深度线性化的 shader 片段随投影模式变化，重建 pass 最稳妥
      this.bokehPass.materialBokeh.needsUpdate = true;
    }
    this.bokehPass.uniforms.nearClip.value = this.camera.near;
    this.bokehPass.uniforms.farClip.value = this.camera.far;
    this.bokehPass.uniforms.aspect.value = this.camera.aspect || (window.innerWidth / window.innerHeight);
  }

  /* -------------------------------------------------------------- */
  /** 土壤剖切块 + 外圈地表 + 地被装饰 + 深度标尺 */
  buildEnvironmentGeometry(materials) {
    const R = WORLD.soilRadius, D = WORLD.soilDepth;
    const cutCenter = Math.atan2(WORLD.defaultCamera.x, WORLD.defaultCamera.z);
    const cutHalf = 0.80;
    const thetaStart = cutCenter + cutHalf;
    const thetaLength = Math.PI * 2 - cutHalf * 2;

    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.97, D, 96, 1, false, thetaStart, thetaLength),
      [materials.get('soilSection'), materials.get('soilTop'), materials.get('soilSection')]
    );
    soil.position.y = -D / 2;
    soil.receiveShadow = true;
    soil.castShadow = false;
    soil.userData.soil = true;
    this.soilGroup.add(soil);

    // 两个径向切面
    for (const a of [thetaStart, cutCenter - cutHalf]) {
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const normal = new THREE.Vector3(-Math.cos(a), 0, Math.sin(a));
      const up = new THREE.Vector3(0, 1, 0);
      const basis = new THREE.Matrix4().makeBasis(dir, up, normal);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(R, D, 1, 1), materials.get('soilSection'));
      plane.applyMatrix4(basis);
      plane.position.set(dir.x * R / 2, -D / 2, dir.z * R / 2);
      plane.receiveShadow = true;
      plane.userData.soil = true;
      this.soilGroup.add(plane);
    }

    // 外圈地表（同样避开剪口）
    const outerMat = materials.get('soilTop').clone();
    outerMat.color.set(0x879a72);
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(R, R + 6.2, 96, 1, thetaStart, thetaLength),
      outerMat
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.006;
    outer.receiveShadow = true;
    outer.userData.soil = true;
    this.soilGroup.add(outer);

    // 剪口边缘刻度（土壤发生层深度标尺）
    const marks = [];
    const a = cutCenter - cutHalf + 0.012;
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    for (let d = 0; d <= D; d += 0.25) {
      const major = Math.abs(d % 1) < 0.01;
      const len = major ? 0.34 : 0.16;
      const r0 = R - len;
      marks.push(dir.x * r0, -d, dir.z * r0, dir.x * R, -d, dir.z * R);
      if (major) marks.push(dir.x * R, -d, dir.z * R, dir.x * (R + 0.14), -d, dir.z * (R + 0.14));
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(marks, 3));
    const ruler = new THREE.LineSegments(mg, new THREE.LineBasicMaterial({ color: 0xd9bd88, transparent: true, opacity: 0.62 }));
    ruler.userData.soil = true;
    this.soilGroup.add(ruler);

    // 剪口上沿描边
    const edge = [];
    for (let i = 0; i <= 64; i++) {
      const t = thetaStart + (thetaLength / 64) * i;
      edge.push(new THREE.Vector3(R * Math.sin(t), 0.004, R * Math.cos(t)));
    }
    const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge),
      new THREE.LineBasicMaterial({ color: 0xd9bd88, transparent: true, opacity: 0.5 }));
    rim.userData.soil = true;
    this.soilGroup.add(rim);

    this._buildGroundCover(materials);
  }

  _buildGroundCover(materials) {
    const rand = mulberry32(8821);
    const R = WORLD.soilRadius;
    const cutCenter = Math.atan2(WORLD.defaultCamera.x, WORLD.defaultCamera.z);
    const inCut = (a) => {
      let d = Math.abs(((a - cutCenter + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d < 0.84;
    };
    // 草丛：InstancedMesh 交叉细叶
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.014, 0, 0, 0.014, 0, 0, -0.008, 0.13, 0.006,
      0.014, 0, 0, 0.008, 0.13, 0.006, -0.008, 0.13, 0.006
    ], 3));
    blade.computeVertexNormals();
    const grassCount = 420;
    const grass = new THREE.InstancedMesh(blade, materials.get('grass'), grassCount * 2);
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < grassCount; i++) {
      const a = rand() * Math.PI * 2, r = 0.75 + Math.sqrt(rand()) * (R - 0.95);
      if (inCut(a)) continue;
      for (let k = 0; k < 2; k++) {
        dummy.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
        dummy.rotation.set(0, a + k * 1.2 + rand() * 0.5, (rand() - 0.5) * 0.35);
        const s = 0.6 + rand() * 1.5;
        dummy.scale.set(s, s * (0.7 + rand() * 0.9), s);
        dummy.updateMatrix();
        grass.setMatrixAt(n++, dummy.matrix);
      }
    }
    grass.count = n;
    grass.castShadow = false; grass.receiveShadow = true;
    this.decorGroup.add(grass);

    // 落叶
    const leafGeo = new THREE.PlaneGeometry(0.16, 0.095);
    const leaves = new THREE.InstancedMesh(leafGeo, materials.get('fallenLeaf'), 90);
    let m = 0;
    for (let i = 0; i < 90; i++) {
      const a = rand() * Math.PI * 2, r = 0.8 + Math.sqrt(rand()) * (R - 1.0);
      if (inCut(a)) continue;
      dummy.position.set(Math.sin(a) * r, 0.012 + rand() * 0.008, Math.cos(a) * r);
      dummy.rotation.set(-Math.PI / 2 + (rand() - 0.5) * 0.25, rand() * 6.28, rand() * 6.28);
      const s = 0.7 + rand() * 0.9;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      leaves.setMatrixAt(m++, dummy.matrix);
    }
    leaves.count = m;
    leaves.receiveShadow = true;
    this.decorGroup.add(leaves);

    // 小砾石
    const pebble = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.045, 0), materials.get('gravel'), 130);
    let p = 0;
    for (let i = 0; i < 130; i++) {
      const a = rand() * Math.PI * 2, r = 0.7 + Math.sqrt(rand()) * (R - 0.9);
      if (inCut(a)) continue;
      dummy.position.set(Math.sin(a) * r, 0.018, Math.cos(a) * r);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      const s = 0.5 + rand() * 1.3;
      dummy.scale.set(s, s * 0.5, s);
      dummy.updateMatrix();
      pebble.setMatrixAt(p++, dummy.matrix);
    }
    pebble.count = p;
    pebble.castShadow = true;
    this.decorGroup.add(pebble);
  }

  /* -------------------------------------------------------------- */
  setTimeOfDay(t) {
    this.time = clamp(t, 0, 24);
    const s = sampleDay(this.time);
    const r = 26;
    const dir = new THREE.Vector3(
      Math.cos(s.elev) * Math.sin(s.azim),
      Math.sin(s.elev),
      Math.cos(s.elev) * Math.cos(s.azim)
    ).normalize();
    this.sun.position.copy(dir).multiplyScalar(r);
    this.sun.intensity = s.sunI * 1.12;
    this.sun.color.copy(mixColor(C(), s.sun));
    // 保持投影状态恒定，避免昼夜拖动时反复触发材质重编译
    this.sun.castShadow = true;

    this.hemi.color.copy(mixColor(C(), s.hemiSky));
    this.hemi.groundColor.copy(mixColor(C(), s.hemiGround));
    this.hemi.intensity = s.hemiI;
    const dayK = clamp(s.sunI / 2.8, 0, 1);
    // 夜间保留冷月主光 + 暖色轮廓光，保证器官结构仍可辨识
    this.fill.intensity = lerp(0.34, 0.62, dayK);
    this.rim.intensity = lerp(0.42, 0.55, dayK);
    this.moon.intensity = s.isNight ? 1.25 : 0.0;
    this.moon.color.set(s.isNight ? 0xb7cdf2 : 0x8fa9e0);

    const bg = mixColor(C(), s.bg);
    const fog = mixColor(C(), s.fog);
    this.scene.background.copy(bg);
    this.scene.fog.color.copy(fog);
    this.scene.fog.near = lerp(18, 24, dayK);
    this.scene.fog.far = lerp(62, 82, dayK);
    this.scene.environmentIntensity = lerp(0.48, 0.9, dayK);

    this.skyUniforms.topColor.value.copy(mixColor(C(), s.hemiSky)).multiplyScalar(0.46);
    this.skyUniforms.horizonColor.value.copy(fog).multiplyScalar(0.94);
    this.skyUniforms.bottomColor.value.copy(mixColor(C(), s.hemiGround)).multiplyScalar(0.62);
    this.skyUniforms.sunColor.value.copy(this.sun.color);
    this.skyUniforms.sunDir.value.copy(dir);
    this.skyUniforms.sunIntensity.value = s.sunI;
    this.skyUniforms.nightMix.value = s.isNight ? clamp((Math.abs(this.time - 12) - 6) / 6, 0, 1) : 0;

    this.renderer.toneMappingExposure = s.exposure;
    return s;
  }

  setProjectionMode(mode) {
    if (mode === this.projection) return;
    const old = this.camera;
    const target = this.controls.target.clone();
    const pos = old.position.clone();
    const quat = old.quaternion.clone();

    if (mode === 'ortho') {
      const d = pos.distanceTo(target);
      const halfAtDist = d * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
      this.ortho.zoom = clamp(this.orthoHalfHeight / Math.max(0.1, halfAtDist), 0.25, 3.4);
      this.ortho.position.copy(pos);
      this.ortho.quaternion.copy(quat);
      this.ortho.updateProjectionMatrix();
      this.camera = this.ortho;
    } else {
      const halfH = this.orthoHalfHeight / this.ortho.zoom;
      const d = halfH / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      this.persp.position.copy(target).addScaledVector(fwd, -clamp(d, 0.8, 46));
      this.persp.quaternion.copy(quat);
      this.persp.updateProjectionMatrix();
      this.camera = this.persp;
    }
    this.projection = mode;
    this._rebuildControls();
    this._updatePostCamera();
  }

  setDOF(on) {
    this.dofEnabled = on;
    // 全景时不跑景深的全场景深度预渲染，聚焦运镜时才启用，显著降低常态开销
    if (this.postOK && this.bokehPass) this.bokehPass.enabled = on && this._focusStrength > 0.02;
    if (!on) this._apertureTarget = 0.00001;
  }

  setBloom(on) {
    this.bloomEnabled = on;
    if (this.postOK && this.bloomPass) this.bloomPass.enabled = on;
  }

  setSoilVisible(on) {
    this.soilGroup.visible = on;
  }

  /** 运镜期间的景深联动：focus 为相机到目标的距离，strength 0–1 */
  setFocus(distance, strength = 1) {
    const s = clamp(strength, 0, 1);
    this._focusStrength = s;
    this._focusTarget = clamp(distance, 0.3, 120);
    this._apertureTarget = this.dofEnabled ? lerp(0.000015, 0.00145, s) : 0.00001;
    if (this.postOK && this.bokehPass) this.bokehPass.enabled = this.dofEnabled && s > 0.02;
  }

  clearFocus() {
    this.setFocus(18, 0);
  }

  setHighlightLight(position, intensity) {
    this.focusLight.position.copy(position);
    this.focusLight.intensity = intensity;
  }

  setControlsEnabled(on) {
    if (this.controls) this.controls.enabled = on;
  }

  /**
   * 紧凑模式下抽屉展开时，把取景中心水平让出 shift 像素。
   * 正值 = 画面内容左移（给右侧抽屉让位），负值 = 右移（给左侧抽屉让位）。
   * 使用 Three.js 官方 view offset：投影矩阵变化会同步反映到 Raycaster，
   * 因此拾取坐标与画面始终一致，无需改动任何拾取逻辑。
   */
  setViewportShift(shift = 0) {
    this._viewShift = shift;
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    const dx = Math.round(shift);
    for (const cam of [this.persp, this.ortho]) {
      if (Math.abs(dx) < 1) cam.clearViewOffset();
      else cam.setViewOffset(w, h, dx, 0, w, h);
    }
  }

  resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    const aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    this.ortho.left = -this.orthoHalfHeight * aspect;
    this.ortho.right = this.orthoHalfHeight * aspect;
    this.ortho.top = this.orthoHalfHeight;
    this.ortho.bottom = -this.orthoHalfHeight;
    this.ortho.updateProjectionMatrix();
    if (this.postOK) {
      this.composer.setSize(w, h);
      this.bloomPass.setSize(w, h);
    }
    // 视口变化后重新套用紧凑模式的让位（setViewOffset 依赖 fullWidth/fullHeight）
    if (Math.abs(this._viewShift || 0) >= 1) this.setViewportShift(this._viewShift);
  }

  render(dt) {
    if (this.controls && this.controls.enabled) this.controls.update();
    this.sky.position.copy(this.camera.position);
    if (this.postOK) {
      const k = Math.min(1, dt * 4.2);
      this._aperture = lerp(this._aperture, this._apertureTarget, k);
      this._focus = lerp(this._focus, this._focusTarget, k);
      this.bokehPass.uniforms.aperture.value = this._aperture;
      this.bokehPass.uniforms.focus.value = this._focus;
      this.bokehPass.uniforms.maxblur.value = 0.012;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  triangleCount() {
    let tris = 0;
    this.scene.traverse(o => {
      if (!o.isMesh && !o.isLine && !o.isPoints) return;
      const g = o.geometry;
      if (!g) return;
      if (o.isMesh) tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    });
    return Math.round(tris);
  }
}
