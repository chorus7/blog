#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
note_from_notion.py — 从 Notion 数据库拉取「已发布」便签，生成 Hugo 文章 .md

用法:
    python note_from_notion.py --check      只检查连通性与数据库结构
    python note_from_notion.py --preview    打印将生成的 md，不写文件
    python note_from_notion.py --publish    写入 content/posts/ 并记录 state

配置: 同目录 notion.env
    NOTION_TOKEN       Notion Integration Secret
    NOTION_DATABASE_ID 目标数据库 ID

安全默认:
    只拉 状态 == 已发布；草稿与归档永不出现
    已生成过的 page_id 记录在 .notion-state.json，除非 --force 不覆盖
    无 token 或 database id 时直接退出
"""
import argparse, json, os, re, sys, time
import urllib.request, urllib.error
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"




def ensure_network():
    """自动探测本地代理：直连 Notion 在国内常被 SSL 掐断"""
    if os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy"):
        return "env"
    import socket
    for port in (7897, 7890, 10809, 10808, 1080):
        s = socket.socket()
        s.settimeout(0.2)
        try:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                url = "http://127.0.0.1:%d" % port
                os.environ["HTTPS_PROXY"] = url
                os.environ["HTTP_PROXY"] = url
                return url
        except OSError:
            pass
        finally:
            s.close()
    return None

def load_env(path=None):
    path = path or os.path.join(HERE, "notion.env")
    cfg = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip().strip(chr(34)).strip(chr(39))
    for k in ("NOTION_TOKEN", "NOTION_DATABASE_ID", "HUGO_POSTS_DIR"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    return cfg


def die(msg):
    print("错误: " + msg)
    sys.exit(1)


def notion_request(path, token, payload=None, method=None):
    url = API + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"))
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Notion-Version", NOTION_VERSION)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        hint = ""
        if e.code == 401:
            hint = "\n  -> token 无效或已撤销，去 Notion Integrations 重新生成"
        elif e.code == 404:
            hint = "\n  -> 数据库未被授权。请在该数据库页面右上角 ⋯ → Connections → 连接你的 integration（上级页面也要连）"
        elif e.code == 429:
            hint = "\n  -> 触发限流（约 3 次/秒），稍等重试"
        die("Notion API %d\n%s%s" % (e.code, body[:600], hint))
    except urllib.error.URLError as e:
        die("网络不可达: %s\n（中国大陆直连 Notion 常被阻断，需设置 HTTPS_PROXY）" % e.reason)


def _mock_pages(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f).get("results", [])


def query_all(db_id, token):
    """查询 data source。Notion 2025-09-03 版：数据库容器与 data source 分离，
    只有 /data_sources/{id}/query 能直接取行。"""
    out, cursor = [], None
    while True:
        payload = {"page_size": 100}
        if cursor:
            payload["start_cursor"] = cursor
        res = notion_request("/data_sources/%s/query" % db_id, token, payload)
        out.extend(res.get("results", []))
        if not res.get("has_more"):
            break
        cursor = res.get("next_cursor")
        time.sleep(0.34)
    return out


def rich_to_text(rich):
    if not rich:
        return ""
    return "".join(seg.get("plain_text", "") for seg in rich)


def get_prop(page, name):
    props = page.get("properties", {})
    p = props.get(name)
    if p is None:
        for k, v in props.items():
            if k.lower() == name.lower():
                p = v
                break
    return p


def prop_text(page, name):
    p = get_prop(page, name)
    if not p:
        return ""
    t = p.get("type")
    if t == "title":
        return rich_to_text(p.get("title"))
    if t == "rich_text":
        return rich_to_text(p.get("rich_text"))
    if t == "select":
        return (p.get("select") or {}).get("name", "")
    if t == "status":
        return (p.get("status") or {}).get("name", "")
    if t == "multi_select":
        return ",".join(o.get("name", "") for o in p.get("multi_select") or [])
    if t == "date":
        return (p.get("date") or {}).get("start", "") or ""
    if t == "url":
        return p.get("url") or ""
    if t == "number":
        return str(p.get("number") or "")
    if t == "formula":
        f = p.get("formula") or {}
        return str(f.get(f.get("type"), "") or "")
    return ""


def page_blocks_text(page_id, token, depth=0):
    if depth > 4:
        return ""
    lines, cursor = [], None
    while True:
        q = "/blocks/%s/children?page_size=100" % page_id
        if cursor:
            q += "&start_cursor=" + cursor
        res = notion_request(q, token)
        for b in res.get("results", []):
            bt = b.get("type")
            data = b.get(bt, {})
            text = rich_to_text(data.get("rich_text"))
            if bt == "paragraph":
                if text.strip():
                    lines.append(text)
                    lines.append("")
            elif bt == "heading_1":
                lines.extend(["## " + text, ""])
            elif bt == "heading_2":
                lines.extend(["### " + text, ""])
            elif bt == "heading_3":
                lines.extend(["#### " + text, ""])
            elif bt == "bulleted_list_item":
                lines.append("- " + text)
            elif bt == "numbered_list_item":
                lines.append("1. " + text)
            elif bt == "quote":
                lines.extend(["> " + text, ""])
            elif bt == "code":
                lines.extend(["```" + data.get("language", ""), text, "```", ""])
            elif bt == "divider":
                lines.extend(["---", ""])
            elif bt == "image":
                src = (data.get("external") or {}).get("url") or (data.get("file") or {}).get("url", "")
                if src:
                    lines.extend(["![%s](%s)" % (text, src), ""])
                else:
                    lines.append("[图片待补]")
            elif bt == "callout":
                if text.strip():
                    lines.extend([chr(60) + "div class=" + chr(34) + "note" + chr(34) + chr(62), text, chr(60) + "/div" + chr(62), ""])
            elif b.get("has_children"):
                sub = page_blocks_text(b["id"], token, depth + 1)
                if sub.strip():
                    lines.extend([sub, ""])
        if not res.get("has_more"):
            break
        cursor = res.get("next_cursor")
        time.sleep(0.34)
    return "\n".join(lines)


SLUG_BAD = re.compile(r"[\\/:*?\<>|\s#%&{}：，、。；！？]+")


def make_slug(page_id, title, date_str, ascii_only=True):
    day = (date_str or "")[:10].replace("-", "")
    if not day:
        day = datetime.now().strftime("%Y%m%d")
    if ascii_only:
        # 纯日期 slug：与原站风格一致，URL 干净且稳定
        return "%s-%s" % (day, page_id.replace("-", "")[:6])
    base_s = SLUG_BAD.sub("-", (title or "").strip())[:40].strip("-")
    if base_s:
        return "%s-%s" % (day, base_s)
    return "%s-%s" % (day, page_id.replace("-", "")[:6])

def yaml_quote(s):
    return json.dumps(str(s if s is not None else ""), ensure_ascii=False)


def build_front_matter(page_id, date_str, title, slug, cat, tags):
    ts = date_str or datetime.now(timezone.utc).isoformat()
    parts = ["---",
             "title: " + yaml_quote(title or "无题"),
             "date: " + ts,
             "slug: " + yaml_quote(slug),
             "draft: false",
             "source: notion",
             "notion_id: " + yaml_quote(page_id)]
    if cat:
        parts.append("categories: [%s]" % yaml_quote(cat))
    if tags:
        tl = [t.strip() for t in tags.split(",") if t.strip()]
        parts.append("tags: [%s]" % ", ".join(yaml_quote(t) for t in tl))
    parts.extend(["---", ""])
    return "\n".join(parts)


def to_article(page, token, offline=False, slug_title=False):
    pid = page["id"]
    date_str = prop_text(page, "日期") or page.get("created_time", "")
    title = prop_text(page, "标题")
    body_prop = prop_text(page, "正文")
    cat = prop_text(page, "分类")
    tags = prop_text(page, "标签")
    slug_prop = prop_text(page, "slug")
    body = "" if offline else page_blocks_text(pid, token)
    if body_prop.strip():
        body = body_prop.strip() + ("\n\n" + body if body.strip() else "")
    if not title:
        first = [l for l in body.splitlines() if l.strip()]
        title = first[0][:40] if first else "无题"
    slug = slug_prop.strip() or make_slug(pid, title, date_str, ascii_only=not slug_title)
    return slug, build_front_matter(pid, date_str, title, slug, cat, tags) + body.strip() + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--out", default=os.environ.get("HUGO_POSTS_DIR", "content/posts"))
    ap.add_argument("--from-json", default=None, help="离线测试：读本地 JSON 模拟 Notion 返回")
    ap.add_argument("--slug-title", action="store_true", help="slug 用标题（默认用纯日期）")
    args = ap.parse_args()
    if not (args.check or args.preview or args.publish):
        ap.print_help()
        return
    cfg = load_env()
    token = cfg.get("NOTION_TOKEN")
    db = (cfg.get("NOTION_DATABASE_ID") or "").strip()
    if not token:
        die("缺少 NOTION_TOKEN。复制 notion.env.example 为 notion.env 并填写。")
    if not db:
        die("缺少 NOTION_DATABASE_ID。在 Notion 数据库页面 Share -> Copy link，取中间 32 位。")
    masked = token[:4] + "***" + token[-4:] if len(token) > 12 else "(过短)"
    proxy = ensure_network()
    if proxy and proxy != "env":
        print("proxy: " + proxy + " (自动探测)")
    print("token: " + masked)
    print("database: " + db)

    if args.check:
        res = notion_request("/data_sources/" + db, token)
        print("\n[OK] 已连通")
        print("  数据库名: " + (rich_to_text(res.get("title")) or "(无标题)"))
        print("  属性列:")
        for k, v in res.get("properties", {}).items():
            print("    - %-12s %s" % (k, v.get("type")))
        have = [k.lower() for k in res.get("properties", {})]
        miss = [n for n in ("标题", "正文", "日期", "分类", "状态") if n.lower() not in have]
        if miss:
            print("\n  [!] 缺列: " + ", ".join(miss) + "（缺列项会留空，不阻断）")
        return

    if args.from_json:
        pages = _mock_pages(args.from_json)
    else:
        pages = query_all(db, token)
    print("拉到 %d 条记录" % len(pages))
    state_path = os.path.join(HERE, ".notion-state.json")
    state = {}
    if os.path.exists(state_path):
        try:
            state = json.load(open(state_path, encoding="utf-8"))
        except Exception:
            state = {}
    out_dir = args.out or cfg.get("HUGO_POSTS_DIR") or os.path.join(HERE, "content", "posts")
    skipped = written = 0
    for p in pages:
        pid = p["id"]
        status = prop_text(p, "状态") or prop_text(p, "Status")
        if status and status not in ("已发布", "发布", "published", "Published", "Done"):
            skipped += 1
            continue
        if pid in state and not args.force:
            skipped += 1
            continue
        slug, md = to_article(p, token, offline=bool(args.from_json), slug_title=args.slug_title)
        if args.preview:
            print("\n" + "=" * 60)
            print("SLUG: " + slug)
            print("-" * 60)
            print(md[:1200])
            if len(md) > 1200:
                print("... (%d 字符，已截断)" % len(md))
            written += 1
            continue
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, slug + ".md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(md)
        state[pid] = {"slug": slug, "at": datetime.now(timezone.utc).isoformat()}
        print("  [ok] " + os.path.basename(path))
        written += 1
    if args.publish:
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        print("\n写入 %d 篇，跳过 %d 条（未发布/已存在）" % (written, skipped))
        print("下一步: git add content/posts && git commit && git push")
    else:
        print("\n预览 %d 篇，跳过 %d 条。确认后加 --publish 落盘。" % (written, skipped))


if __name__ == "__main__":
    main()