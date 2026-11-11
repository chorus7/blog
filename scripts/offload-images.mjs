#!/usr/bin/env node
/**
 * 大图分流：把超过阈值的图片挪到 Azure Blob，正文引用改成 Blob 地址。
 *
 * 为什么不在后台上传时选：Sveltia 内置媒体库只有 default / cloudinary / s3 / uploadcare，
 * 没有 azure-blob，也没有「从 URL 插入」。所以把分流放到构建阶段 ——
 * 后台只管往仓库传图（一套操作），构建时自动把大图搬走（不占仓库体积、不吃 Pages 带宽）。
 *
 * 用法：
 *   node scripts/offload-images.mjs            # 只报告，不改动
 *   node scripts/offload-images.mjs --write    # 真上传并改写
 *
 * 需要的环境变量：
 *   AZURE_STORAGE_CONNECTION  存储账户连接字符串（Actions 里用 secret）
 *   AZURE_BLOB_CONTAINER      容器名，默认 images
 *   AZURE_BLOB_BASE           公开访问前缀，如 https://xxx.blob.core.windows.net/images
 *   IMAGE_OFFLOAD_KB          阈值，默认 300（KB）
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname, relative, basename } from 'node:path';
import { createHash, createHmac } from 'node:crypto';

const ROOT = process.cwd();
const CONTENT = join(ROOT, 'content');
const WRITE = process.argv.includes('--write');
const THRESHOLD = Number(process.env.IMAGE_OFFLOAD_KB || 300) * 1024;

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const CONN = process.env.AZURE_STORAGE_CONNECTION || '';
const CONTAINER = process.env.AZURE_BLOB_CONTAINER || 'images';
const BASE = (process.env.AZURE_BLOB_BASE || '').replace(/\/$/, '');

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

// 解析连接字符串里的账户信息
function parseConn(s) {
  const o = {};
  for (const part of s.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) o[part.slice(0, i)] = part.slice(i + 1);
  }
  return o;
}

// 用共享密钥签一个 PUT 请求（不引 SDK，省依赖）
async function uploadBlob(name, buf, contentType) {
  const { AccountName, AccountKey } = parseConn(CONN);
  if (!AccountName || !AccountKey) throw new Error('连接字符串缺少 AccountName / AccountKey');

  const now = new Date().toUTCString();
  const version = '2021-08-06';
  const blobType = 'BlockBlob';
  const contentLength = buf.length;

  // StringToSign 格式（Azure 文档 SharedKey，字段顺序固定）：
  //   VERB\nContent-Encoding\nContent-Language\nContent-Length\nContent-MD5\n
  //   Content-Type\nDate\nIf-Modified-Since\nIf-Match\nIf-None-Match\n
  //   If-Unmodified-Since\nRange\nCanonicalizedHeaders\nCanonicalizedResource
  // 两个坑（都踩过）：
  //   1. CanonicalizedResource 后面不能再有换行，多一个 \n 签名就对不上
  //   2. 所有 x-ms-* 请求头都要按字典序进签名，包括 x-ms-blob-type
  const canonicalHeaders =
    `x-ms-blob-type:${blobType}\n` +
    `x-ms-date:${now}\n` +
    `x-ms-version:${version}\n`;
  const canonicalResource = `/${AccountName}/${CONTAINER}/${name}`;
  const stringToSign =
    'PUT\n' +          // VERB
    '\n' +             // Content-Encoding
    '\n' +             // Content-Language
    `${contentLength}\n` + // Content-Length
    '\n' +             // Content-MD5
    `${contentType}\n` +   // Content-Type
    '\n' +             // Date
    '\n' +             // If-Modified-Since
    '\n' +             // If-Match
    '\n' +             // If-None-Match
    '\n' +             // If-Unmodified-Since
    '\n' +             // Range
    canonicalHeaders +
    canonicalResource;

  const key = Buffer.from(AccountKey, 'base64');
  const hmac = createHmac('sha256', key).update(stringToSign, 'utf8').digest('base64');

  const url = `https://${AccountName}.blob.core.windows.net/${CONTAINER}/${name}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': blobType,
      'x-ms-date': now,
      'x-ms-version': version,
      'Content-Type': contentType,
      'Content-Length': String(contentLength),
      Authorization: `SharedKey ${AccountName}:${hmac}`,
    },
    body: buf,
  });
  if (!res.ok) {
    const t = await res.text();
    const want = t.match(/Server used following string to sign: '([\s\S]*?)<\/Message>/);
    if (want) {
      throw new Error(
        `上传失败 ${res.status}\n--- 我发的 ---\n${JSON.stringify(stringToSign)}\n--- 服务器要的 ---\n${JSON.stringify(want[1])}`
      );
    }
    throw new Error(`上传失败 ${res.status}: ${t.slice(0, 300)}`);
  }
  return url;
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
};

async function main() {
  const files = await walk(CONTENT);
  const big = [];

  for (const f of files) {
    if (!IMG_EXT.has(extname(f).toLowerCase())) continue;
    const s = await stat(f);
    if (s.size > THRESHOLD) big.push({ path: f, size: s.size });
  }

  if (!big.length) {
    console.log(`没有超过 ${THRESHOLD / 1024}KB 的图片，跳过`);
    return;
  }

  console.log(`超过 ${THRESHOLD / 1024}KB 的图片 ${big.length} 个：`);
  for (const b of big) console.log(`  ${(b.size / 1024).toFixed(0)}KB  ${relative(ROOT, b.path)}`);

  if (!WRITE) {
    console.log('\n只是报告，未上传。加 --write 才真执行。');
    return;
  }
  if (!CONN || !BASE) {
    console.error('\n缺少 AZURE_STORAGE_CONNECTION 或 AZURE_BLOB_BASE，无法上传');
    process.exit(1);
  }

  // 文章 md 文件：把仓库内的相对引用换成 Blob 地址
  const mdFiles = files.filter((f) => extname(f).toLowerCase() === '.md');
  const mdText = new Map();
  for (const m of mdFiles) mdText.set(m, await readFile(m, 'utf8'));

  for (const b of big) {
    const buf = await readFile(b.path);
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    const ext = extname(b.path).toLowerCase();
    // 用内容哈希做文件名：同图不会重复上传，改图自动换地址
    const name = `${hash}${ext}`;
    const url = await uploadBlob(name, buf, MIME[ext] || 'application/octet-stream');
    console.log(`上传 ${relative(ROOT, b.path)} → ${url}`);

    const oldName = basename(b.path);
    const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 只改「图片引用」位置，不碰正文里裸提到的文件名：
    //   Markdown ![...](路径)  /  HTML <img src="路径">
    const mdRe = new RegExp(`(!\\[[^\\]]*\\]\\()\\s*(?:\\./)?(?:[\\w\\-./]*/)?${esc}(\\s*(?:\"[^\"]*\"|'[^']*')?\\s*\\))`, 'g');
    const htmlRe = new RegExp(`(<img\\b[^>]*?\\bsrc\\s*=\\s*[\"'])(?:\\./)?(?:[\\w\\-./]*/)?${esc}([\"'])`, 'gi');

    for (const [m, text] of mdText) {
      if (!text.includes(oldName)) continue;
      const next = text.replace(mdRe, `$1${url}$2`).replace(htmlRe, `$1${url}$2`);
      if (next !== text) {
        mdText.set(m, next);
        console.log(`  改写引用 ${relative(ROOT, m)}`);
      }
    }
  }

  for (const [m, text] of mdText) {
    const orig = await readFile(m, 'utf8');
    if (orig !== text) await writeFile(m, text, 'utf8');
  }

  console.log('\n完成。注意：图片文件仍在仓库里，确认线上没问题后再删，或让 CI 直接跳过。');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
