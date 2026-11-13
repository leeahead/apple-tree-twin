/**
 * MALUS DOMESTICA · Digital Twin
 * Zero-dependency static server + OpenAI-compatible streaming AI proxy.
 *
 *   node server.mjs
 *   PORT=5173 AI_BASE_URL=... AI_MODEL=... AI_API_KEY=... node server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function sendJSON(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

function resolveChatURL(base) {
  const clean = String(base || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return /\/chat\/completions$/.test(clean) ? clean : `${clean}/chat/completions`;
}

/** POST /api/ai — proxy to any OpenAI-compatible endpoint, SSE streaming supported. */
async function handleAI(req, res) {
  let raw = '';
  try {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1_000_000) throw new Error('request body too large');
    }
  } catch (err) {
    return sendJSON(res, 400, { error: { message: `读取请求失败: ${err.message}` } });
  }

  let body;
  try { body = JSON.parse(raw || '{}'); }
  catch { return sendJSON(res, 400, { error: { message: '无效的 JSON 请求体' } }); }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return sendJSON(res, 400, { error: { message: '缺少 messages 字段' } });
  }

  // In proxy mode the key NEVER leaves the server process.
  const proxyMode = body.proxy === true;
  const base = proxyMode
    ? (process.env.AI_BASE_URL || 'https://api.openai.com/v1')
    : (body.endpoint || process.env.AI_BASE_URL || 'https://api.openai.com/v1');
  const key = proxyMode
    ? (process.env.AI_API_KEY || '')
    : (body.apiKey || process.env.AI_API_KEY || '');
  const model = (proxyMode && process.env.AI_MODEL) ? process.env.AI_MODEL : (body.model || 'gpt-4o-mini');
  const stream = body.stream !== false;

  const payload = {
    model,
    messages: body.messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.55,
    max_tokens: Math.min(Number(body.max_tokens) || 1400, 4096),
    stream
  };

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  let upstream;
  try {
    upstream = await fetch(resolveChatURL(base), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000)
    });
  } catch (err) {
    return sendJSON(res, 502, { error: { message: `上游连接失败: ${err.message}`, hint: '检查接口地址、网络与浏览器 CORS 策略' } });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    let detail = text.slice(0, 900);
    try { const j = JSON.parse(text); detail = j?.error?.message || detail; } catch { /* keep raw */ }
    return sendJSON(res, upstream.status || 502, { error: { message: `上游返回 ${upstream.status}: ${detail}` } });
  }

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    try {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (err) {
      if (!res.writableEnded) res.end(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
    }
  } else {
    try {
      const data = await upstream.json();
      sendJSON(res, 200, data);
    } catch (err) {
      sendJSON(res, 502, { error: { message: `解析上游响应失败: ${err.message}` } });
    }
  }
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname); }
  catch { return sendJSON(res, 400, { error: { message: 'bad url' } }); }

  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJSON(res, 200, {
      ok: true,
      service: 'malus-domestica-digital-twin',
      proxyConfigured: Boolean(process.env.AI_API_KEY),
      proxyModel: process.env.AI_MODEL || null,
      three: '0.187.0 / vendored'
    });
  }
  if (pathname === '/api/ai') {
    if (req.method !== 'POST') return sendJSON(res, 405, { error: { message: 'POST required' } });
    return handleAI(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJSON(res, 405, { error: { message: 'method not allowed' } });
  }

  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(ROOT, `.${pathname}`);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return sendJSON(res, 403, { error: { message: 'forbidden' } });
  }

  let stat;
  try { stat = fs.statSync(target); }
  catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 · 文件不存在'); }
  if (stat.isDirectory()) {
    res.writeHead(302, { Location: `${pathname.replace(/\/$/, '')}/index.html` });
    return res.end();
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(target).pipe(res);
});

server.on('error', (err) => {
  console.error('\n==========================================================');
  if (err.code === 'EADDRINUSE') {
    console.error(`  [启动失败] 端口 ${PORT} 已被占用。`);
    console.error(`  很可能已经有一个服务实例在运行 —— 直接打开 http://${HOST}:${PORT} 即可。`);
    console.error(`  若被其它程序占用，请换端口启动，例如：`);
    console.error(`    set PORT=5174 && node server.mjs`);
    console.error(`    然后访问 http://${HOST}:5174`);
  } else if (err.code === 'EACCES') {
    console.error(`  [启动失败] 无权限绑定端口 ${PORT}，请换一个 1024 以上端口。`);
  } else {
    console.error('  [启动失败] ' + (err.message || String(err)));
  }
  console.error('==========================================================\n');
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log('  MALUS DOMESTICA · 苹果树数字孪生');
  console.log(`  本地地址   http://${HOST}:${PORT}`);
  console.log(`  AI 代理    /api/ai  ${process.env.AI_API_KEY ? '(已配置环境变量密钥)' : '(未配置，可用前端直连或设置 AI_API_KEY)'}`);
  console.log('  按 Ctrl+C 停止服务；关闭本窗口即停止服务');
  console.log(`${line}\n`);
});
