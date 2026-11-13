import * as THREE from 'three';
import { WORLD, PHENO } from './core/constants.js';
import { clamp, smoothstep } from './core/GeometryUtils.js';
import { buildTextureLibrary, buildEnvironment } from './core/TextureFactory.js';
import { MaterialLibrary } from './core/MaterialLibrary.js';
import { SceneManager } from './core/SceneManager.js';
import { TreeRegistry } from './core/TreeRegistry.js';
import { PickingSystem } from './core/PickingSystem.js';
import { CameraDirector } from './core/CameraDirector.js';
import { Highlight } from './core/Highlight.js';
import { TreeBuilder } from './tree/TreeBuilder.js';
import { AIInterpreter } from './services/AIInterpreter.js';
import { KnowledgePanel } from './ui/KnowledgePanel.js';
import { HUD } from './ui/HUD.js';
import { AnatomyView } from './ui/AnatomyView.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');

/* ---------------- 加载屏 ---------------- */
function progress(p, label) {
  $('loader-progress').style.width = `${Math.round(p * 100)}%`;
  $('loader-log').textContent = label;
}

function fatal(err) {
  console.error(err);
  $('loader-log').innerHTML = `<span style="color:#e0806c">初始化失败：${String(err?.message || err)}</span>`;
  $('loader-log').style.maxWidth = '80vw';
}

async function boot() {
  /* 1. 程序化 PBR 贴图集 */
  progress(0.01, '初始化渲染管线…');
  const texLib = await buildTextureLibrary(null, progress);

  /* 2. 场景 / 相机 / 光照 / 后处理 */
  progress(0.94, '装配双相机、昼夜光照与景深管线…');
  const sm = new SceneManager(canvas, texLib);
  texLib.environment = buildEnvironment(sm.renderer);
  sm.scene.environment = texLib.environment;
  sm.scene.environmentIntensity = 0.85;

  /* 3. 材质库与土壤环境 */
  progress(0.96, '编译 PBR 材质与土壤剖切体…');
  const materials = new MaterialLibrary(texLib);
  sm.buildEnvironmentGeometry(materials);

  /* 4. 模块化苹果树 */
  progress(0.97, '生成四级根系与斐波那契冠层骨架…');
  const registry = new TreeRegistry();
  const tree = new TreeBuilder(materials, registry, sm.worldGroup);
  tree.build();

  /* 5. 交互系统 */
  const director = new CameraDirector(sm);
  const highlight = new Highlight(sm);
  const ai = new AIInterpreter();
  let knowledge = null;
  let hud = null;
  let picking = null;
  let anatomy = null;
  let currentPart = null;
  let started = false;

  knowledge = new KnowledgePanel(ai, {
    onClose: () => { director.reset(); },
    onRecam: (part) => {
      const root = part.objects[0] || null;
      if (root) director.flyTo(part, root, { duration: 1.7 });
    },
    onAISettings: () => hud?.openModal('modal-ai')
  });

  const selectPart = (part, root) => {
    if (!part || !root) return;
    currentPart = part;
    started = true;
    hud.showHint(false);

    // 微观 / 物候联动，保证被选部位处于可见状态
    if (part.flags.stomataView) { tree.setStomataView(true); picking.refresh(); }
    else if (tree.stage === 'bloom' && part.group === 'fruit') {
      // 花期仍可查看果实结构，保持花簇可见
    }
    if (part.group === 'flower' && tree.stage !== 'bloom') {
      const p = tree.setPheno('bloom');
      hud.setPheno('bloom', p.defaultRipeness);
      picking.refresh();
    } else if (part.group === 'fruit' && tree.stage === 'bloom' && part.id !== 'fruit-seed' && part.id !== 'fruit-pedicel') {
      const p = tree.setPheno('mature');
      hud.setPheno('mature', p.defaultRipeness);
      picking.refresh();
    }
    sm.setSoilVisible(part.group === 'root' ? false : hud.state.soil);

    highlight.select(root, part);
    hud.setNavActive(part.id);
    hud.setSelected(part.label);
    knowledge.el.content.style.opacity = '0.18';
    knowledge.el.content.style.filter = 'blur(2px)';
    director.flyTo(part, root);
  };

  const resetAll = () => {
    if (director.isFlying && director.targetPart === null) return;
    currentPart = null;
    highlight.clear();
    knowledge.hide();
    tree.setStomataView(false);
    picking.refresh();
    sm.setSoilVisible(hud.state.soil);
    hud.clearNavActive();
    hud.setSelected('—');
    director.reset();
  };

  director.cb.onStart = () => { /* 运镜开始：面板保持淡出，结束再展开 */ };
  director.cb.onComplete = (part) => {
    knowledge.el.content.style.opacity = '';
    knowledge.el.content.style.filter = '';
    knowledge.show(part);
  };
  director.cb.onResetStart = () => resetAllStateOnly();
  director.cb.onResetComplete = () => { sm.clearFocus(); hud.showHint(!started); };

  function resetAllStateOnly() {
    currentPart = null;
    highlight.clear();
    knowledge.hide();
    tree.setStomataView(false);
    picking.refresh();
    sm.setSoilVisible(hud.state.soil);
    hud.clearNavActive();
    hud.setSelected('—');
    knowledge.el.content.style.opacity = '';
    knowledge.el.content.style.filter = '';
  }

  /* 6. HUD 绑定 */
  hud = new HUD(registry, ai, {
    onNavigate: (part) => selectPart(part, part.objects[0]),
    onProjection: (mode) => sm.setProjectionMode(mode),
    onDOF: (on) => sm.setDOF(on),
    onBloom: (on) => sm.setBloom(on),
    onAnatomy: () => anatomy?.toggle(),
    onSoil: (on) => sm.setSoilVisible(on),
    onReset: () => resetAll(),
    onTime: (t) => {
      sm.setTimeOfDay(t);
      const night = clamp(Math.max(1 - smoothstep(5.4, 7.4, t), smoothstep(18.2, 20.4, t)), 0, 1);
      tree.setDayNight(night, t);
    },
    onPheno: (stage) => {
      const p = tree.setPheno(stage);
      hud.setPheno(stage, p.defaultRipeness);
      picking.refresh();
    },
    onRipeness: (t) => tree.setRipeness(t),
    onAISettings: () => hud.openModal('modal-ai'),
    onAIConfigSaved: () => knowledge.refreshAIState(),
    onEscape: () => {
      if (anatomy?.active) { anatomy.close(); return; }
      resetAll();
    },
    onResize: () => sm.resize()
  });

  /* 7. 射线拾取 */
  picking = new PickingSystem(sm, registry, {
    onPick: (hit) => selectPart(hit.part, hit.root),
    onHover: (hit) => { if (hit) hud.showPartTooltip(hit); else $('tooltip').classList.add('hidden'); },
    onHoverMove: (hit) => hud.showPartTooltip(hit),
    onEmptyClick: () => {},
    onDoubleClick: () => resetAll()
  });

  /* 7.5 解剖剖面视图：独立的二维标本台，不改动三维树 */
  anatomy = new AnatomyView({
    onOpenChange: (on) => {
      picking.enabled = !on;
      $('tooltip').classList.add('hidden');
      hud.setAnatomy(on);
      if (!on) sm.resize();
    }
  });

  /* 8. 初始环境状态同步 */
  const initialNight = clamp(Math.max(1 - smoothstep(5.4, 7.4, 9), smoothstep(18.2, 20.4, 9)), 0, 1);
  tree.setDayNight(initialNight, 9);
  sm.setTimeOfDay(9);
  sm.setDOF(hud.state.dof);
  sm.setBloom(hud.state.bloom);
  hud.setPheno('young', tree.ripeness);
  hud.setStats(registry.countObjects(), sm.triangleCount(), 60);

  /* 9. 收尾：隐藏加载屏 */
  progress(1, '数字标本就绪');
  await new Promise(r => setTimeout(r, 220));
  $('loader').classList.add('done');
  hud.showHint(true);
  setTimeout(() => { $('loader').style.display = 'none'; }, 1000);

  /* 10. 主循环 */
  let last = performance.now(), fps = 60, statAcc = 0, frames = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    director.update(dt);
    highlight.update(dt, sm.camera);
    if (!anatomy?.active) sm.render(dt);
    fps += ((1 / dt) - fps) * 0.08;
    frames++; statAcc += dt;
    if (statAcc > 0.6) {
      hud.setStats(registry.countObjects(), sm.triangleCount(), Math.min(999, fps));
      statAcc = 0; frames = 0;
    }
  }
  requestAnimationFrame(loop);

  // 暴露给控制台，便于评审检查与调试
  window.__MALUS__ = { sm, tree, registry, director, picking, hud, knowledge, anatomy, ai, materials, THREE, WORLD, PHENO };
}

boot().catch(fatal);
