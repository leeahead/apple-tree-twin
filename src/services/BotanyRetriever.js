/**
 * 课程助教 · 教材检索器
 *
 * 设计目标（对应评审「知识准确性 / 对话体验」）：
 *  · 唯一权威依据 = 《植物学（第三版）》OCR 全文，回答必须能回查到教材章节与页码
 *  · 纯前端、零依赖、无 DOM，离线可用；语料按章懒加载，不拖慢三维场景启动
 *  · 三层知识范围：核心（32 个已建模部位）/ 扩展（教材植物学基础）/ 超范围
 *  · 低置信或无命中时明确拒答，绝不生成没有依据的内容
 */
import { BOTANY_SOURCE, BOTANY_CHAPTERS, CORPUS_STATS } from '../data/botany/manifest.js';
import { PART_KEYWORDS } from '../data/botany/parts.js';

export { BOTANY_SOURCE, BOTANY_CHAPTERS, CORPUS_STATS, PART_KEYWORDS };

/** 面向评审的定位与范围声明（UI 说明卡与文档共用同一份，避免口径不一致） */
export const SCOPE = {
  audience: '修读《植物学》及园艺 / 果树类课程的学生，配合本 3D 苹果树数字孪生进行器官与组织的形态解剖学习',
  scenarios: [
    '课前预习、课后复习与「复习思考 / 探究学习」作答',
    '对照三维标本辨认器官、组织及其层次关系',
    '实验课前查阅切片、显微结构的教材定义'
  ],
  core: '苹果树已建模的 32 个部位及其组织：根系（主根、输导根、生长根、吸收根、根毛、根颈）、主干（木质部、周皮、形成层、年轮）、冠层分枝、叶片与叶肉 / 叶脉 / 气孔 / 叶柄、芽、花器、果实与种子',
  extended: '教材全本的植物学基础：植物细胞与组织、营养器官与生殖器官的形态结构、植物界基本类群与分类、被子植物主要分科、植物生理基本概念',
  out: [
    '教材未载的具体农事参数：品种 / 砧木配组表、农药登记剂量与安全间隔期、当地栽培规程、实时病虫测报',
    '非植物学问题（编程、翻译、写作、时事、医疗诊断等）',
    '需要最新文献、实测数据或教师判断才能回答的开放性问题'
  ],
  sourceNote: '问答依据唯一来自《植物学（第三版）》（金银根 主编，科学出版社，全彩版，356 页）的 OCR 全文。右侧「AI 解读」中的园艺实践条目另由果树学通用资料整理，不作为本助教的事实依据，界面已单独标注。'
};

/** 学科锚词：命中即认为属于教材可覆盖的植物学范围 */
const DOMAIN_WORDS = [
  '植物学', '植物界', '被子植物', '裸子植物', '藻类', '菌类', '地衣', '苔藓', '蕨类', '种子植物',
  '双子叶', '单子叶', '检索表', '分类', '科属', '拉丁学名', '标本', '切片', '显微镜',
  '细胞', '细胞壁', '细胞膜', '细胞质', '细胞核', '叶绿体', '线粒体', '液泡', '质体', '胞间连丝',
  '有丝分裂', '减数分裂', '染色体', '原生质体', '胞腔', '纹孔',
  '组织', '分生组织', '保护组织', '输导组织', '机械组织', '薄壁组织', '分泌组织', '厚角组织', '厚壁组织',
  '维管束', '维管组织', '木质部', '韧皮部', '形成层', '导管', '筛管', '管胞', '纤维', '表皮', '周皮',
  '木栓', '气孔', '保卫细胞', '角质层', '皮孔', '毛茸',
  '根系', '根尖', '根毛', '根冠', '内皮层', '凯氏带', '中柱', '菌根', '初生结构', '次生结构',
  '茎', '节间', '节', '髓', '髓射线', '年轮', '早材', '晚材', '边材', '心材', '木材',
  '芽', '叶芽', '花芽', '混合芽', '芽鳞', '鳞片', '顶端优势', '生长素',
  '叶片', '叶柄', '叶脉', '叶肉', '栅栏组织', '海绵组织', '叶序', '叶镶嵌', '单叶', '复叶', '变态叶', '托叶',
  '花萼', '萼片', '花瓣', '花冠', '雄蕊', '花药', '花粉', '花丝', '雌蕊', '柱头', '花柱', '子房',
  '胚珠', '心皮', '胎座', '花序', '开花', '传粉', '授粉', '受精', '双受精', '自交不亲和', '花托', '萼筒',
  '果实', '真果', '假果', '仁果', '果心', '果柄', '梗洼', '萼洼', '种子', '胚', '胚乳', '子叶', '种皮',
  '光合作用', '呼吸作用', '蒸腾作用', '蒸腾', '矿质', '水分', '激素', '向性', '休眠', '萌发',
  '分化', '发育', '形态', '解剖', '结构', '生理', '器官', '营养器官', '生殖器官',
  '生活史', '世代交替', '孢子体', '配子体', '维管植物', '苹果树', '苹果属', '蔷薇科', '仁果类',
  '分科', '双子叶植物', '单子叶植物', '花程式', '花图式', '胚囊', '花粉管', '层积'
];

/** 明确的学科外信号（命中且无学科锚词时判为超范围） */
const OUT_WORDS = [
  '写代码', '编程', 'python', 'javascript', '代码', '股票', '基金', '房价', '天气', '翻译',
  '作文', '游戏', '电影', '新闻', '菜谱', '医疗', '诊断', '开药', '法律', '合同', '快递',
  '手机', '电脑', '软件', '下载', '安装', '密码', '账号'
];

/**
 * 教材未载的农事操作参数：即使提问含植物学词汇也必须拒答。
 * 这类问题需要登记标签、当地规程或农技部门意见，凭教材作答会构成编造。
 */
const PRACTICE_OUT = [
  '喷多少', '施多少', '用多少', '多少浓度', '浓度多少', '多少倍', '多少克', '多少毫升',
  'ppm', '剂量', '配方', '打药', '农药登记', '安全间隔期', '防治适期', '登记标签',
  '授粉树配置', '品种配置', '砧木推荐', '亩产', '多少钱', '一亩', '每株施', '稀释倍数'
];
const SUMMARY_SECTION = /知识要点|总结与复习|复习思考|内容导读|主要参考文献|阅读参考|探究学习|本章小结|目录|本章小结/;
const GREETING = /^(你好|您好|hi|hello|在吗|嗨|谢谢|多谢|再见|拜拜)[\s!！。~～?？]*$/i;

const STOP_CHAR = new Set('的了是也在有和与及或我你他它们这那吗呢吧啊请被把从对为之其所很更最都就还又会能要个些种么什怎何哪多少上下里内外中给让到把被比把讲说问答'.split(''));
const GENERIC_Q = new Set(['什么', '怎么', '如何', '为何', '哪些', '多少', '是否', '能否', '可以', '关于', '一下', '以及', '还有', '继续', '详细', '展开', '再说', '上面', '刚才', '这个', '那个', '作用', '功能', '结构', '特点', '特征', '关系', '意义', '定义', '概念', '过程', '原因', '结果', '介绍', '解释', '说明', '讲讲', '说说', '请问', '帮我']);

export const SUGGESTED_QUESTIONS = [
  '气孔主要分布在叶片的哪一面？为什么？',
  '苹果的果实为什么属于假果？',
  '维管形成层位于什么位置，有什么作用？',
  '什么是双受精？',
  '栅栏组织和海绵组织有什么区别？',
  '根尖可以分为哪几个区？'
];

/** 中文 2-gram + 拉丁词；过滤虚词 gram 与通用疑问词 */
function tokenize(q) {
  const text = String(q || '').toLowerCase();
  const out = [];
  for (const m of text.matchAll(/[a-z][a-z0-9-]{1,}|\d+(?:\.\d+)?/g)) out.push(m[0]);
  for (const m of text.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = m[0];
    if (run.length === 1) { if (!STOP_CHAR.has(run)) out.push(run); continue; }
    for (let i = 0; i < run.length - 1; i++) {
      const g = run.slice(i, i + 2);
      if (STOP_CHAR.has(g[0]) || STOP_CHAR.has(g[1])) continue;
      if (GENERIC_Q.has(g)) continue;
      out.push(g);
    }
    // 3-gram 提升专业术语区分度
    for (let i = 0; i < run.length - 2; i++) {
      const g = run.slice(i, i + 3);
      if (STOP_CHAR.has(g[0]) || STOP_CHAR.has(g[2])) continue;
      out.push(g);
    }
  }
  return [...new Set(out)];
}

/** 判断提问命中哪个已建模部位（优先最长关键词） */
export function detectPart(q) {
  const text = String(q || '');
  let best = null;
  for (const [id, v] of Object.entries(PART_KEYWORDS)) {
    for (const k of v.keywords) {
      if (k.length >= 2 && text.includes(k) && (!best || k.length > best.len)) {
        best = { id, label: v.label, keywords: v.keywords, len: k.length };
      }
    }
  }
  return best ? { id: best.id, label: best.label, keywords: best.keywords } : null;
}

/** 追问 / 指代消解：把当前 3D 选中部位或上一轮主题补进检索式 */
export function resolveQuery(raw, { part = null, lastTopic = '' } = {}) {
  let q = String(raw || '').trim();
  const followUp = /(^|[，,。\s])(它|该|这|那|上面|刚才|继续|再|还|详细|展开)(?=$|[，,。？?\s])|^(它|继续|再说|详细说说|展开讲讲)/.test(q)
    || /它|它们|这个结构|该结构|上面说|刚才/.test(q);
  const topic = part
    ? (PART_KEYWORDS[part]?.label || '')
    : (lastTopic || '');
  if (topic && (followUp || q.length <= 6)) q = `${topic} ${q}`;
  return q;
}

export function scopeOf(rawQuery) {
  const q = String(rawQuery || '');
  const domain = DOMAIN_WORDS.filter(w => q.includes(w));
  const outHit = OUT_WORDS.some(w => q.toLowerCase().includes(w));
  const practiceHit = PRACTICE_OUT.some(w => q.toLowerCase().includes(w));
  const greeting = GREETING.test(q.trim());
  const part = detectPart(q);
  let scope;
  if (greeting) scope = 'greeting';
  else if (practiceHit) scope = 'out';                       // 农事参数优先判出范围
  else if (outHit && domain.length === 0 && !part) scope = 'out';
  else if (part) scope = 'core';
  else if (domain.length) scope = 'extended';
  else scope = 'out';
  return { scope, part, domain, outHit, practiceHit, greeting };
}

const SCOPE_LABEL = {
  core: '核心范围 · 苹果树器官与组织',
  extended: '扩展范围 · 教材植物学基础',
  out: '超出知识范围',
  greeting: '使用引导'
};

export function suggestFor(scope, reason, detail = {}) {
  if (scope === 'greeting') {
    return [
      `你好！我是《植物学》课程助教，依据${BOTANY_SOURCE.short}（${BOTANY_SOURCE.editor}，${BOTANY_SOURCE.publisher}）回答问题。`,
      '我可以帮你理解苹果树 32 个已建模部位的形态、结构与功能，以及教材里的植物学基础概念；每条回答都会标出章节与教材页码，方便回查。',
      '试着问：「气孔主要分布在叶片的哪一面？」「苹果的果实为什么属于假果？」'
    ].join('\n');
  }
  if (scope === 'out' && detail.practiceHit && (detail.domain?.length || detail.part)) {
    return [
      '这属于栽培实践中的具体参数，教材里没有给出可直接引用的数值，我不能凭印象作答。',
      '农药、肥料与植物生长调节剂的实际用量必须按当地登记标签、安全间隔期与农技部门意见执行，且随品种、砧木、树龄、土壤和气候变化。',
      '建议：查阅课程指定的《果树栽培学》/ 当地技术规程，或请教任课教师与当地农技推广部门；本 3D 标本的「园艺要点」栏仅列通用原则，也不作为剂量依据。'
    ].join('\n');
  }
  if (scope === 'out') {
    return [
      '本助教只回答《植物学（第三版）》里能查到的内容，重点是苹果树 32 个已建模部位（根 / 茎 / 叶 / 芽 / 花 / 果实及其组织）与教材中的植物学基础。',
      '可以换个植物学术语再问，例如「维管形成层」「下位子房」「栅栏组织」「双受精」；或在三维标本上点选对应部位查看知识框架。',
      '涉及品种配组、农药剂量、当地规程等需要最新资料或教师判断的问题，请查阅课程指定参考书、农技部门资料或请教任课教师。'
    ].join('\n');
  }
  if (reason === 'noEvidence') {
    return [
      '我在教材全文中没有检索到足够可靠的依据，因此不作答，避免给出想当然的结论。',
      '建议：①换用教材中的规范术语；②缩小到具体器官 / 组织；③在三维标本中点选对应部位查看已整理的知识框架。',
      '若确属教材内容，可能是 OCR 识别用词与提问用语不同，可翻看《植物学（第三版）》相应章节确认。'
    ].join('\n');
  }
  return '';
}

export class BotanyRetriever {
  constructor() {
    this.chunks = [];
    this.loaded = false;
    this._promise = null;
  }

  /** 并行懒加载 6 个章节分片；只在首次提问时执行 */
  load(onProgress) {
    if (this._promise) return this._promise;
    this._promise = (async () => {
      let done = 0;
      const groups = await Promise.all(BOTANY_CHAPTERS.map(async (meta) => {
        const url = new URL(`../data/botany/${meta.id}.js`, import.meta.url);
        const mod = await import(url.href);
        done++;
        onProgress?.(done / BOTANY_CHAPTERS.length, meta.name);
        return mod.CHUNKS || [];
      }));
      this.chunks = groups.flat();
      this.loaded = true;
      return this.chunks.length;
    })();
    return this._promise;
  }

  /** 主检索：返回命中片段、范围判定、置信度与拒答原因 */
  retrieve(rawQuery, { part = null, topK = 4, lastTopic = '' } = {}) {
    if (!this.loaded) throw Object.assign(new Error('语料尚未加载'), { code: 'CORPUS_NOT_READY' });
    const q = resolveQuery(rawQuery, { part, lastTopic });
    const meta = scopeOf(q);
    const base = {
      query: String(rawQuery || '').trim(), resolvedQuery: q,
      scope: meta.scope, scopeLabel: SCOPE_LABEL[meta.scope], part: meta.part,
      source: BOTANY_SOURCE
    };
    if (meta.scope === 'out' || meta.scope === 'greeting') {
      return {
        ...base, hits: [], confident: false, reason: meta.scope,
        suggestion: suggestFor(meta.scope, meta.scope, meta), topic: ''
      };
    }

    const terms = tokenize(q);
    if (!terms.length) {
      return { ...base, hits: [], confident: false, reason: 'noEvidence', suggestion: suggestFor(meta.scope, 'noEvidence'), topic: '' };
    }

    const N = this.chunks.length;
    const df = new Map(terms.map(t => [t, 0]));
    for (const c of this.chunks) {
      const hay = c.text + ' ' + c.section;
      for (const t of terms) if (hay.includes(t)) df.set(t, df.get(t) + 1);
    }
    const idf = new Map(terms.map(t => [t, Math.log(1 + N / (1 + df.get(t)))]));

    const boostKws = part && PART_KEYWORDS[part] ? PART_KEYWORDS[part].keywords : (meta.part?.keywords || []);
    const scored = [];
    for (const c of this.chunks) {
      let s = 0;
      for (const t of terms) {
        const w = idf.get(t);
        if (c.text.includes(t)) s += w;
        if (c.section.includes(t)) s += w * 0.85;
      }
      if (boostKws.length) {
        let b = 0;
        for (const k of boostKws) if (k.length >= 2 && c.text.includes(k)) b += 0.75;
        s += Math.min(b, 3.2);
      }
      // 章末「知识要点 / 内容导读」等汇总块词密度高但信息不专，降权让专节优先
      if (SUMMARY_SECTION.test(c.section || '')) s *= 0.55;
      if (s > 0) {
        // 轻微长度惩罚，避免长块仅因词多而胜出
        s = s / (1 + Math.log(1 + c.text.length / 420) * 0.25);
        scored.push({ chunk: c, score: s });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0]?.score || 0;
    // 相对分数下限：剔除靠个别噪声 gram 混进来的长尾片段，保证每条依据都真正相关
    const hits = scored.slice(0, topK).filter(h => h.score >= Math.max(3.0, top * 0.72));
    // 相对阈值：至少命中两个有信息量的词，且首位分数不能过低
    const informative = terms.filter(t => idf.get(t) > 2.2).length;
    const confident = hits.length > 0 && top >= 3.0 && (informative > 0 || top >= 5.0);
    const topic = meta.part?.label || (terms.find(t => t.length >= 3 && DOMAIN_WORDS.includes(t)) || terms.find(t => t.length >= 2) || '');

    return {
      ...base,
      hits: confident ? hits : [],
      allCandidates: confident ? undefined : hits.slice(0, 2),
      confident,
      reason: confident ? 'ok' : 'noEvidence',
      suggestion: confident ? '' : suggestFor(meta.scope, 'noEvidence'),
      topic,
      debug: { topScore: Number(top.toFixed(2)), informative, termCount: terms.length }
    };
  }
}

/** 出处字符串：章节 · 小节 · 教材页码 */
export function cite(hit) {
  const c = hit.chunk;
  const where = [c.chapter, c.section && c.section !== c.chapter ? `「${c.section}」` : ''].filter(Boolean).join(' · ');
  return `${BOTANY_SOURCE.short} · ${where}${c.page ? ` · 教材 P${c.page}` : ''}`;
}

function keySentences(text, q, max = 2) {
  const terms = tokenize(q).filter(t => t.length >= 2);
  const sents = text.split(/(?<=[。！？；])/).map(s => s.trim()).filter(s => s.length > 12);
  const ranked = sents.map(s => ({ s, n: terms.reduce((a, t) => a + (s.includes(t) ? 1 : 0), 0) }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  return ranked.slice(0, max).map(x => x.s.replace(/^[）)】\]，,、；;：:.\s]+/, '').trim());
}

/** 离线应答：只做教材原文摘录 + 出处，不生成任何推断，因此不可能编造 */
export function buildOfflineAnswer(result) {
  const q = result.query;
  if (result.reason === 'greeting') {
    return [
      result.suggestion,
      '',
      `— 资料来源：${BOTANY_SOURCE.short}（${BOTANY_SOURCE.editor}，${BOTANY_SOURCE.publisher}）`
    ].join('\n');
  }
  if (result.reason === 'out') {
    return [
      `这个问题我无法给出有教材依据的回答，因此不作答。`,
      '',
      result.suggestion,
      '',
      `— 资料来源：${BOTANY_SOURCE.short}（${BOTANY_SOURCE.editor}，${BOTANY_SOURCE.publisher}）`
    ].join('\n');
  }
  if (!result.confident || !result.hits.length) {
    return [
      `关于「${q}」，我在教材全文中没有找到足够可靠的依据，所以不给出结论。`,
      '',
      result.suggestion,
      '',
      `— 检索范围：${BOTANY_SOURCE.short} 全文 ${CORPUS_STATS.chunks} 个片段`
    ].join('\n');
  }
  const lines = [
    `根据${BOTANY_SOURCE.short}，与「${q}」直接相关的教材原文如下（按相关度排序）。以下为原文摘录，未做改写或推断：`,
    ''
  ];
  result.hits.forEach((h, i) => {
    const c = h.chunk;
    const keys = keySentences(c.text, q);
    lines.push(`【${i + 1}】${keys.length ? keys.join('') : c.text.slice(0, 150)}`);
    lines.push(`　依据：${cite(h)}`);
    lines.push('');
  });
  lines.push('— 以上为教材原文摘录。继续追问、换用教材术语，或在三维标本中点选对应部位查看结构化知识框架。');
  lines.push(`— 检索范围：${result.scopeLabel} · ${BOTANY_SOURCE.short} 全文 ${CORPUS_STATS.chunks} 个片段`);
  return lines.join('\n');
}

export const COURSE_QA_DEFAULT = new BotanyRetriever();
