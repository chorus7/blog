// GET  /api/danmaku  → 取最新留言列表
// POST /api/danmaku  → 发一条

import { app } from '@azure/functions';
import { validate, checkRate, addMessage, listMessages, hashIp, ensureTable } from '../store.js';

// 站点白名单：只有自家页面能跨域调这个接口
const ALLOWED = [
  'https://chorus7.github.io',
  'http://127.0.0.1:8123',
  'http://localhost:8123',
];

function corsHeaders(origin) {
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function clientIp(req) {
  // Azure 前置代理会把真实 IP 放进这两个头
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}

app.http('danmaku', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'danmaku',
  handler: async (req, context) => {
    const origin = req.headers.get('origin') || '';
    const headers = { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' };

    if (req.method === 'OPTIONS') return { status: 204, headers };

    try {
      await ensureTable();

      if (req.method === 'GET') {
        const items = await listMessages(60);
        // 浏览器可缓存 30 秒，减轻函数调用
        return {
          status: 200,
          headers: { ...headers, 'Cache-Control': 'public, max-age=30' },
          jsonBody: { ok: true, items },
        };
      }

      // ---- POST ----
      let body;
      try {
        body = await req.json();
      } catch {
        return { status: 400, headers, jsonBody: { ok: false, message: '请求格式不对' } };
      }

      const v = validate(body ?? {});
      if (!v.ok) {
        return { status: 400, headers, jsonBody: { ok: false, code: v.code, message: v.message } };
      }

      const salt = process.env.IP_SALT || 'pill-danmaku';
      const ipHash = hashIp(clientIp(req), salt);

      const rate = await checkRate(ipHash);
      if (!rate.ok) {
        return { status: 429, headers, jsonBody: { ok: false, message: rate.message } };
      }

      const saved = await addMessage(v.value, ipHash);
      return { status: 201, headers, jsonBody: { ok: true, item: saved } };
    } catch (e) {
      context.error('danmaku error', e);
      return {
        status: 500,
        headers,
        jsonBody: { ok: false, message: '服务器打了个盹，稍后再试' },
      };
    }
  },
});
