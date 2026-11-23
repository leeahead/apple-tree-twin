/**
 * 内置免费 AI 演示接口凭据（浏览器直连用）。
 *
 * 重要：这是用户明确授权的免费演示 key，允许公开；线上 GitHub Pages 没有服务端，
 * 因此密钥必须随前端发布。切勿把生产环境的密钥放进这里 —— 前端代码是公开的。
 *
 * 源码里用 XOR + Base64 做混淆，只是避免明文裸奔 / 被爬虫顺手扫走，
 * **不是加密**，任何人都能反推；真正的边界是「这个 key 本来就可以公开」。
 */
const AI_BOOTSTRAP = 'HgpBFhtUe2JWcFhTUzgPOy5SIEM8ZmZGXwFKFiQFHwkZJT5NPXxqSmAAfQ1VOjU3PyMYCRtZRkBBDAJOBh4MXQwGAhAAAFNZHFVDThFfGRIKDwkGXh4cAB9QQQAUBg==';
const AI_BOOTSTRAP_MASK = 'malus-2026-agnes';

function decodeBootstrap() {
  try {
    const buf = Uint8Array.from(atob(AI_BOOTSTRAP), c => c.charCodeAt(0));
    const out = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
      out[i] = buf[i] ^ AI_BOOTSTRAP_MASK.charCodeAt(i % AI_BOOTSTRAP_MASK.length);
    }
    const [apiKey, baseUrl, model] = new TextDecoder().decode(out).split('|');
    return { apiKey, baseUrl, model };
  } catch { return { apiKey: '', baseUrl: '', model: '' }; }
}

/** { apiKey, baseUrl, model } — 与 server.mjs 内置的是同一份免费凭据 */
export const BUILTIN_CREDENTIALS = Object.freeze(decodeBootstrap());

/** 仅用于 UI 展示，不代表密钥藏在服务端 */
export const BUILTIN_AI_HINT = Object.freeze({
  endpoint: BUILTIN_CREDENTIALS.baseUrl,
  model: BUILTIN_CREDENTIALS.model,
  label: 'Agnes Flash（内置免费 · 线上可用）'
});
