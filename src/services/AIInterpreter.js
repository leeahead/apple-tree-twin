/**
 * AI 大模型解读服务
 *  · 兼容 OpenAI /chat/completions 协议，支持 SSE 流式输出
 *  · 双通道：浏览器直连（演示用） / 本地服务端代理 /api/ai（推荐，密钥不下发前端）
 *  · 课程助教问答：先检索《植物学（第三版）》教材片段，再让模型只依据片段作答（RAG）
 *  · 未配置或调用失败时，自动降级为教材原文摘录，界面明确标注来源，绝不生成无依据内容
 */
import {
  BotanyRetriever, buildOfflineAnswer, cite,
  BOTANY_SOURCE, SCOPE, SUGGESTED_QUESTIONS, CORPUS_STATS
} from './BotanyRetriever.js';
import { BUILTIN_CREDENTIALS, BUILTIN_AI_HINT } from './builtinAI.js';

export { BOTANY_SOURCE, SCOPE, SUGGESTED_QUESTIONS, CORPUS_STATS, cite, buildOfflineAnswer };
export { BUILTIN_CREDENTIALS, BUILTIN_AI_HINT };

/** 全站共享一个语料实例（懒加载一次，之后复用） */
export const botany = new BotanyRetriever();

const STORAGE_KEY = 'malus-ai-config-v3';       // v2 → v3：默认改为浏览器直连，Pages 上也能用 AI
const LEGACY_KEYS = ['malus-ai-config-v2', 'malus-ai-config-v1'];

export const PROVIDERS = {
  agnes:     { endpoint: BUILTIN_AI_HINT.endpoint, model: BUILTIN_AI_HINT.model, label: BUILTIN_AI_HINT.label },
  custom:    { endpoint: '', model: '', label: '自定义 / OpenAI 兼容' },
  deepseek:  { endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  moonshot:  { endpoint: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', label: 'Moonshot Kimi' },
  dashscope: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', label: '阿里通义千问' },
  openai:    { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  ollama:    { endpoint: 'http://localhost:11434/v1', model: 'qwen2.5:7b', label: '本地 Ollama' },
  proxy:     { endpoint: '/api/ai', model: BUILTIN_AI_HINT.model, label: '本地服务端代理（可选，密钥不出服务端）' }
};

/** 默认浏览器直连：线上 Pages 与本地 start.bat 都能用 AI；内置 key 是公开免费 key */
const DEFAULT_CONFIG = {
  provider: 'agnes',
  endpoint: BUILTIN_AI_HINT.endpoint,
  model: BUILTIN_AI_HINT.model,
  apiKey: BUILTIN_CREDENTIALS.apiKey,
  stream: true,
  enabled: true
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    // 迁移旧版：只保留用户真正自己填过的第三方接口；内置/代理配置一律回落到直连
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      const old = JSON.parse(legacy);
      const userOwn = old && old.endpoint && old.model && old.apiKey &&
        old.endpoint !== '/api/ai' && old.endpoint !== BUILTIN_AI_HINT.endpoint;
      if (userOwn) return { ...DEFAULT_CONFIG, ...old, provider: 'custom' };
    }
  } catch { /* 隐私模式 / 损坏数据：回落到内置配置 */ }
  return { ...DEFAULT_CONFIG };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 极简 Markdown 渲染（先转义再替换，避免模型输出注入 HTML） */
export function renderMarkdown(text) {
  const lines = String(text || '').split('\n');
  let out = '', inList = false;
  const inline = (s) => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+?)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');
  const closeList = () => { if (inList) { out += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    const h = line.match(/^(#{2,5})\s+(.*)$/);
    if (h) { closeList(); out += `<h4>${inline(h[2])}</h4>`; continue; }
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    closeList();
    out += `<p>${inline(line)}</p>`;
  }
  closeList();
  return out;
}

/** 课程助教系统提示词：把「不编造 / 有依据 / 能纠错 / 会拒答」写成硬规则 */
export function courseSystemPrompt() {
  return [
    `你是《植物学》课程助教，服务对象是修读该课程、并使用苹果树（Malus domestica）3D 数字孪生标本学习的学生。`,
    `唯一事实依据 = 下面提供的 ${BOTANY_SOURCE.short}（${BOTANY_SOURCE.editor}，${BOTANY_SOURCE.publisher}）教材原文片段，每条都附有章节与教材页码。`,
    '',
    '硬性规则：',
    '1. 只依据片段作答。片段之外的任何数据、术语、结论、品种、剂量、文献一律不得出现；不要凭常识「补充」「校正」「深化」，也不要把内置知识摘要当作教材内容。',
    '2. 每个结论后用 [依据：第X章… · 教材 Pxxx] 标注来源；没有片段支撑的话就不写。',
    '3. 片段不足以完整回答时，明确说「教材片段未涵盖这一点」，并建议换用教材术语、点选三维标本对应部位或查阅该章节；绝不猜测。',
    '4. 涉及农药剂量、品种砧木配组、当地规程、最新文献等教材未载内容，直接说明不作答并给出合适建议。',
    '5. 用户指出上一轮回答有误时：先明确承认并道歉，重新依据片段核对；若片段无法判定就说无法确认，不要辩解、不要坚持原答案。',
    '6. 追问要联系上文：「它 / 这个 / 接着说 / 再详细些」指代上一轮主题，不要当成新问题重新开场。',
    '7. 中文、要点式，300–500 字，不写空话，不整段复述原文。',
    '8. 教材片段来自 OCR，个别字词可能有识别误差；可顺明显错别字，但不得改动专业含义。'
  ].join('\n');
}

/** 部位解读的系统提示词（与课程助教同一套「只依据教材」口径） */
function systemPrompt() {
  return [
    `你是果树学与植物学课程助教，服务于苹果树（Malus domestica Borkh.）3D 数字孪生参赛作品。`,
    `事实依据只能来自下面提供的 ${BOTANY_SOURCE.short} 教材原文片段。`,
    '要求：',
    '1. 先给出规范植物学名称与拉丁术语，说明解剖归属；',
    '2. 分为「形态解剖」「生理机制」「园艺实践」三层，用 Markdown 小标题组织；',
    '3. 教材片段没有给出的具体数据、品种、剂量、文献一律不得编造；内置知识摘要只是辅助线索，与教材冲突时以教材为准，不得当作教材依据引用；',
    '4. 每个要点后标注 [依据：第X章… · 教材 Pxxx]；片段未涵盖的部分明确说明「教材片段未涵盖」，不猜测；',
    '5. 园艺实践只给通用原则，涉及农药、肥料、调节剂必须提示按当地登记标签、安全间隔期与农技部门意见执行，并说明这不来自教材；',
    '6. 区分「通用结论」与「随品种、砧木、树龄、土壤、气候而变」的部分；',
    '7. 总长 500–800 字，要点式，避免空话。'
  ].join('\n');
}

/** 把检索到的教材片段拼成可注入的上下文 */
export function formatEvidence(result, maxChars = 700) {
  if (!result?.hits?.length) return '';
  return result.hits.map((h, i) =>
    `[${i + 1}] ${h.chunk.text.slice(0, maxChars)}\n（依据：${cite(h)}）`
  ).join('\n\n');
}

/** 课程多轮对话的 messages 构造 */
export function buildCourseMessages(question, { result, part = null, history = [], correction = false } = {}) {
  const evidence = formatEvidence(result);
  const his = history.slice(-6).map(m =>
    `${m.role === 'user' ? '学生' : '助教'}：${String(m.text || '').slice(0, 500)}`
  ).join('\n');
  const blocks = [
    '【教材原文片段 · 唯一事实依据】',
    evidence || '（无）',
    '',
    part ? `【当前三维标本选中部位】${part.label}${part.latin ? `（${part.latin}）` : ''} · ${part.group || ''}` : '',
    result ? `【知识范围】${result.scopeLabel}` : '',
    his ? `【最近对话】\n${his}` : '',
    correction ? '【纠错】学生指出上一轮回答有误，请重新依据片段核对。' : '',
    '',
    `【学生问题】${question}`,
    '',
    '请依据上述片段作答并逐条标注出处；片段不足或超出范围时按规则 3 / 4 / 5 处理。'
  ];
  return [
    { role: 'system', content: courseSystemPrompt() },
    { role: 'user', content: blocks.filter(Boolean).join('\n') }
  ];
}

export class AIInterpreter {
  constructor() {
    this.config = load();
    this._controller = null;
  }

  getConfig() { return { ...this.config }; }

  saveConfig(cfg) {
    this.config = { ...this.config, ...cfg };
    this.config.enabled = Boolean(this.config.endpoint && this.config.model) || this.config.provider === 'proxy';
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config)); } catch { /* 隐私模式下忽略 */ }
    return this.config;
  }

  /** 一键恢复内置免费接口（用户改过配置后可用） */
  resetBuiltin() {
    this.config = { ...DEFAULT_CONFIG };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config)); } catch { /* noop */ }
    return this.config;
  }

  isConfigured() {
    const c = this.config;
    const isProxy = c.provider === 'proxy';
    const hasModel = isProxy || Boolean(c.model);
    const hasEndpoint = isProxy || Boolean(c.endpoint);
    const hasKey = isProxy || c.provider === 'ollama' || Boolean(c.apiKey);
    return Boolean(c.enabled && hasModel && hasEndpoint && hasKey);
  }

  _url() {
    const c = this.config;
    if (c.provider === 'proxy') return '/api/ai';
    const base = String(c.endpoint || '').replace(/\/+$/, '');
    return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  }

  _headers() {
    const c = this.config;
    const h = { 'Content-Type': 'application/json' };
    if (c.apiKey) h['Authorization'] = `Bearer ${c.apiKey}`;
    return h;
  }

  _body(messages, stream, overrides = {}) {
    const c = this.config;
    const payload = {
      model: c.model,
      messages,
      temperature: 0.35,
      max_tokens: 1400,
      stream,
      ...overrides
    };
    // 只有走本地代理时才标记 proxy；浏览器直连不要把 endpoint/apiKey 塞进请求体
    if (c.provider === 'proxy') payload.proxy = true;
    return JSON.stringify(payload);
  }

  /** 检索当前部位的教材片段，返回可直接注入的上下文字符串 */
  async _courseContext(query, part) {
    try {
      await botany.load();
      const r = botany.retrieve(query, { part, topK: 3 });
      return r.confident ? formatEvidence(r) : '';
    } catch { return ''; }
  }

  buildMessages(part, knowledge, courseContext = '') {
    const ctx = [
      courseContext ? `【教材原文片段 · 唯一事实依据】\n${courseContext}` : '【教材原文片段】本次未检索到可用片段，请说明无法依据教材作答，不要凭内置摘要编造。',
      `【部位】${part.label}（${part.latin}）`,
      `【所属系统】${part.group}`,
      `【内置知识摘要 · 仅辅助线索，不是教材依据】${knowledge.summary || ''}`,
      `【形态解剖 · 辅助线索】${stripHtml(knowledge.botany).slice(0, 700)}`,
      `【生理功能 · 辅助线索】${stripHtml(knowledge.physiology).slice(0, 600)}`,
      `【园艺要点 · 辅助线索】${stripHtml(knowledge.horticulture).slice(0, 700)}`,
      `【建模口径】${stripHtml(knowledge.caveat).slice(0, 250)}`
    ].join('\n');
    return [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: `请解读苹果树的「${part.label}」。\n\n${ctx}` }
    ];
  }

  /** 底层请求：explain 与课程问答共用 */
  async _request(messages, { onToken, signal } = {}) {
    this.abort();
    if (!this.isConfigured()) {
      throw Object.assign(new Error('尚未配置可用的 AI 接口'), { code: 'NOT_CONFIGURED' });
    }
    const controller = new AbortController();
    this._controller = controller;
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    const timer = setTimeout(() => controller.abort(), 90000);

    const c = this.config;
    const stream = c.stream !== false;
    try {
      const res = await fetch(this._url(), {
        method: 'POST',
        headers: this._headers(),
        body: this._body(messages, stream),
        signal: controller.signal
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        let msg = txt.slice(0, 300);
        try { const j = JSON.parse(txt); msg = j?.error?.message || msg; } catch { /* keep */ }
        throw Object.assign(new Error(`上游返回 ${res.status}：${msg}`), { code: 'HTTP', status: res.status });
      }
      if (!stream || !res.body) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content || '';
        onToken?.(text, text);
        return text;
      }
      return await this._readSSE(res.body, onToken);
    } catch (err) {
      if (err.name === 'AbortError') throw Object.assign(new Error('请求已取消或超时（90 秒）'), { code: 'ABORT' });
      if (err.code) throw err;
      throw Object.assign(new Error(`网络请求失败：${err.message}。若为浏览器直连，请检查接口地址、密钥与 CORS 策略；推荐改用本地服务端代理。`), { code: 'NETWORK' });
    } finally {
      clearTimeout(timer);
      this._controller = null;
    }
  }

  /** 流式解读；onToken(textDelta, accumulated) 逐段回调 */
  async explain(part, knowledge, { onToken, signal } = {}) {
    const ctx = await this._courseContext(part.label || '', part.id || null);
    return this._request(this.buildMessages(part, knowledge, ctx), { onToken, signal });
  }

  /** 课程助教多轮提问（messages 由 buildCourseMessages 构造） */
  async chat(messages, { onToken, signal } = {}) {
    return this._request(messages, { onToken, signal });
  }

  async _readSSE(body, onToken) {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '', acc = '', done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      buffer += decoder.decode(value || new Uint8Array(), { stream: !d });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith(':') || line.startsWith('event:')) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { done = true; continue; }
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        if (json.error) throw Object.assign(new Error(json.error.message || '上游流式错误'), { code: 'UPSTREAM' });
        const delta = json?.choices?.[0]?.delta?.content
          ?? json?.choices?.[0]?.message?.content
          ?? json?.content ?? '';
        if (delta) { acc += delta; onToken?.(delta, acc); }
      }
    }
    return acc;
  }

  async test(cfg) {
    const saved = this.config;
    this.config = { ...saved, ...cfg };
    try {
      const res = await fetch(this._url(), {
        method: 'POST',
        headers: this._headers(),
        body: this._body([{ role: 'user', content: '请只回复两个字：正常' }], false, { max_tokens: 16 })
      });
      const txt = await res.text();
      if (!res.ok) {
        let msg = txt.slice(0, 240);
        try { msg = JSON.parse(txt)?.error?.message || msg; } catch { /* keep */ }
        throw new Error(`HTTP ${res.status}：${msg}`);
      }
      let data; try { data = JSON.parse(txt); } catch { throw new Error('上游返回的不是 JSON'); }
      return { ok: true, reply: data?.choices?.[0]?.message?.content || '(空回复，但接口连通)' };
    } finally { this.config = saved; }
  }

  abort() {
    if (this._controller) { try { this._controller.abort(); } catch { /* noop */ } this._controller = null; }
  }

  /** 课程问答的离线应答：教材原文摘录 + 出处，不生成任何推断 */
  courseFallback(result) {
    return buildOfflineAnswer(result);
  }

  /** 部位解读的离线降级：明确标注来源不是教材，避免与知识库口径混淆 */
  fallback(part, knowledge) {
    const clean = (h) => stripHtml(h);
    return [
      `【${part.label} · ${part.latin}】`,
      part.summary,
      '',
      '■ 形态解剖', clean(knowledge.botany).slice(0, 620),
      '', '■ 生理功能', clean(knowledge.physiology).slice(0, 520),
      '', '■ 园艺要点', clean(knowledge.horticulture).slice(0, 720),
      '',
      `（来源：系统内置的果树学通用知识条目 · ${knowledge.refs?.[0] || '果树学通用资料'}）`,
      `（注意：本条不是${BOTANY_SOURCE.short}教材内容，仅供辅助参考；课程助教问答只依据教材。）`
    ].join('\n');
  }
}
