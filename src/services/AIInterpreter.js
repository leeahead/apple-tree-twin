/**
 * AI 大模型解读服务
 *  · 兼容 OpenAI /chat/completions 协议，支持 SSE 流式输出
 *  · 双通道：浏览器直连（演示用） / 本地服务端代理 /api/ai（推荐，密钥不下发前端）
 *  · 未配置或调用失败时，自动降级为内置离线知识库，并在 UI 明确标注来源
 */

const STORAGE_KEY = 'malus-ai-config-v1';

export const PROVIDERS = {
  custom:    { endpoint: '', model: '', label: '自定义 / OpenAI 兼容' },
  deepseek:  { endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  moonshot:  { endpoint: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', label: 'Moonshot Kimi' },
  dashscope: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', label: '阿里通义千问' },
  openai:    { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  ollama:    { endpoint: 'http://localhost:11434/v1', model: 'qwen2.5:7b', label: '本地 Ollama' },
  proxy:     { endpoint: '/api/ai', model: '', label: '本地服务端代理（推荐）' }
};

const DEFAULT_CONFIG = {
  provider: 'custom',
  endpoint: '',
  model: '',
  apiKey: '',
  stream: true,
  enabled: false
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_CONFIG }; }
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

function systemPrompt() {
  return [
    '你是果树学与园艺学专家，服务于一份苹果树（Malus domestica Borkh.，蔷薇科苹果属）3D 数字孪生参赛作品。',
    '请针对用户指定的器官，给出科学严谨、可操作、有层次的中文解读。',
    '要求：',
    '1. 先给出该结构的规范植物学名称与拉丁术语，说明其解剖归属；',
    '2. 分为「形态解剖」「生理机制」「园艺实践」三个层次，用 Markdown 小标题组织；',
    '3. 园艺实践须具体到修剪、病虫害防治、施肥/水分管理中的相关要点，并说明适用条件；',
    '4. 涉及农药、肥料与植物生长调节剂时，只给通用原则与浓度区间的常见范围，必须提示按当地登记标签、安全间隔期与农技部门意见执行；',
    '5. 明确区分「通用结论」与「随品种、砧木、树龄、土壤、气候而变」的部分，不编造数据、品种配组或文献；',
    '6. 若参考资料中的说法存在版本差异或不确定性，直接指出，不要含糊带过；',
    '7. 总长控制在 500–800 字，使用要点式表达，避免空话。'
  ].join('\n');
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
    return JSON.stringify({
      proxy: c.provider === 'proxy' ? true : false,
      endpoint: c.provider === 'proxy' ? undefined : c.endpoint,
      apiKey: c.provider === 'proxy' ? undefined : c.apiKey,
      model: c.model,
      messages,
      temperature: 0.55,
      max_tokens: 1400,
      stream,
      ...overrides
    });
  }

  buildMessages(part, knowledge) {
    const ctx = [
      `【部位】${part.label}（${part.latin}）`,
      `【所属系统】${part.group}`,
      `【内置知识摘要】${knowledge.summary || ''}`,
      `【形态解剖】${stripHtml(knowledge.botany).slice(0, 700)}`,
      `【生理功能】${stripHtml(knowledge.physiology).slice(0, 600)}`,
      `【园艺要点】${stripHtml(knowledge.horticulture).slice(0, 700)}`,
      `【建模口径】${stripHtml(knowledge.caveat).slice(0, 250)}`
    ].join('\n');
    return [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: `请解读苹果树的「${part.label}」。以下是本系统内置的参考知识，可作为起点，请补充、校正与深化（若发现其中表述需要限定条件，请明确指出）：\n\n${ctx}` }
    ];
  }

  /** 流式解读；onToken(textDelta, accumulated) 逐段回调 */
  async explain(part, knowledge, { onToken, signal } = {}) {
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
        body: this._body(this.buildMessages(part, knowledge), stream),
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

  async _readSSE(body, onToken) {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '', acc = '', done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      buffer += decoder.decode(value || new Uint8Array(), { stream: !d });
      // 兼容 \n\n 与 \n 两种分隔，逐行处理 data: 前缀
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

  /** 离线降级：把内置知识库整理为可读文本 */
  fallback(part, knowledge) {
    const clean = (h) => stripHtml(h);
    return [
      `【${part.label} · ${part.latin}】`,
      part.summary,
      '',
      '■ 形态解剖', clean(knowledge.botany).slice(0, 620),
      '', '■ 生理功能', clean(knowledge.physiology).slice(0, 520),
      '', '■ 园艺要点', clean(knowledge.horticulture).slice(0, 720),
      '', `（来源：系统内置离线知识库 · ${knowledge.refs?.[0] || '果树学通用资料'}）`
    ].join('\n');
  }
}
