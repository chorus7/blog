// 表存储读写与业务规则
// 表结构：PartitionKey 固定为 "danmaku"，RowKey 用倒序时间戳 + 随机串
// （倒序让最新留言排在前面，查询时不必排序整张表）

import { TableClient } from '@azure/data-tables';
import { createHash, randomUUID } from 'node:crypto';

const TABLE = process.env.DANMAKU_TABLE || 'danmaku';
const PARTITION = 'danmaku';

// 内容长度与频率限制
const MAX_LEN = 80;
const MIN_INTERVAL_MS = 20_000; // 同一 IP 20 秒一条
const MAX_PER_HOUR = 10;        // 同一 IP 每小时 10 条
const MAX_PER_DAY = 40;

let client;

function getClient() {
  if (!client) {
    const conn = process.env.AzureWebJobsStorage || process.env.STORAGE_CONNECTION;
    if (!conn) throw new Error('缺少存储连接串');
    client = TableClient.fromConnectionString(conn, TABLE, {
      allowInsecureConnection: conn.includes('UseDevelopmentStorage'),
    });
  }
  return client;
}

export async function ensureTable() {
  try {
    await getClient().createTable();
  } catch (e) {
    // 表已存在会抛 TableAlreadyExists，忽略
    if (e?.statusCode !== 409) throw e;
  }
}

// IP 不存明文，存加盐哈希：既能限频，又不落个人身份信息
function hashIp(ip, salt) {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 24);
}

// RowKey 用「倒序时间戳-随机」：查询时按 RowKey 升序即为最新在前
function makeRowKey(now) {
  const inv = String(9_999_999_999_999 - now.getTime()).padStart(13, '0');
  return `${inv}-${randomUUID().slice(0, 8)}`;
}

// ---- 输入校验 ----
const BAD_PATTERNS = [
  /https?:\/\//i,          // 链接：弹幕不承载导航
  /<\s*script/i,           // 脚本
  /<\/?\s*(iframe|object|embed|svg|style)/i,
];

export function validate({ text, color, name }) {
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, code: 'EMPTY', message: '内容不能为空' };
  if ([...t].length > MAX_LEN) return { ok: false, code: 'TOO_LONG', message: `最多 ${MAX_LEN} 字` };
  // 控制字符（含零宽字符）会破坏飘屏排版，也常被用来绕过过滤
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/.test(t)) {
    return { ok: false, code: 'BAD_CHARS', message: '含有不可见字符' };
  }
  for (const p of BAD_PATTERNS) {
    if (p.test(t)) return { ok: false, code: 'BAD_CONTENT', message: '不能包含链接或脚本' };
  }
  // 全是同一字符（刷屏）：只在短句里判，长句本来就可能是重复用字
  const compact = t.replace(/\s/g, '');
  if (compact.length <= 12 && new Set([...compact]).size <= 1 && compact.length > 4) {
    return { ok: false, code: 'SPAM', message: '内容重复度过高' };
  }

  // 颜色只接受白名单里的色值，防止注入任意 CSS
  const allowedColors = ['', 'pink', 'green', 'yellow', 'blue', 'purple', 'orange'];
  const c = allowedColors.includes(color) ? color : '';

  const n = String(name ?? '').trim().slice(0, 16);

  return { ok: true, value: { text: t, color: c, name: n } };
}

// ---- 限频 ----
export async function checkRate(hash) {
  const now = Date.now();
  const c = getClient();

  // 用一张轻量记录表存每次提交的时间戳，按 IP 哈希分分区便于查询
  const rows = [];
  try {
    for await (const e of c.listEntities({
      queryOptions: { filter: `PartitionKey eq '${PARTITION}' and ip eq '${hash}'` },
    })) {
      rows.push(e);
    }
  } catch { /* 表刚建好、还没数据时查询会空 */ }

  const times = rows.map((r) => Number(r.ts)).filter(Boolean).sort((a, b) => b - a);
  const last = times[0];
  if (last && now - last < MIN_INTERVAL_MS) {
    return { ok: false, message: `慢一点，${Math.ceil((MIN_INTERVAL_MS - (now - last)) / 1000)} 秒后再发` };
  }
  const hourAgo = now - 3_600_000;
  if (times.filter((t) => t > hourAgo).length >= MAX_PER_HOUR) {
    return { ok: false, message: '这一小时说得够多了，歇一会儿' };
  }
  const dayAgo = now - 86_400_000;
  if (times.filter((t) => t > dayAgo).length >= MAX_PER_DAY) {
    return { ok: false, message: '今天已经说很多了，明天再来' };
  }
  return { ok: true };
}

export async function addMessage({ text, color, name }, ipHash) {
  const now = new Date();
  const entity = {
    partitionKey: PARTITION,
    rowKey: makeRowKey(now),
    text,
    color,
    name,
    ip: ipHash,
    ts: now.getTime(),
  };
  await getClient().createEntity(entity);
  return {
    id: entity.rowKey,
    text,
    color,
    name,
    ts: entity.ts,
  };
}

export async function listMessages(limit = 60) {
  const out = [];
  const c = getClient();
  try {
    for await (const e of c.listEntities({
      queryOptions: { filter: `PartitionKey eq '${PARTITION}'` },
    })) {
      out.push(e);
      if (out.length >= limit) break; // RowKey 倒序时间戳，取到即最新
    }
  } catch (e) {
    if (e?.statusCode === 404) return []; // 表还没建
    throw e;
  }
  return out.map((e) => ({
    id: e.rowKey,
    text: e.text,
    color: e.color || '',
    name: e.name || '',
    ts: Number(e.ts) || 0,
  }));
}

export { hashIp };
