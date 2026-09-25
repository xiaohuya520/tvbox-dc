#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TVBox 多仓自动刷新（运行在 GitHub Actions 云端，能正常联网探测）。

流程：
  1. 候选池 sources_pool.json = seed(来自 dc_full.json 的 93 条) + external(外部聚合页抓取)，只增不删
  2. 并发探测池内所有源是否存活（HTTP 可达 + 响应体像 TVBox 配置）
  3. 精选 dc.json 维持 TARGET 个：先保留原精选中存活的，再从可用集按优先级补满
     - 补充优先级：seed(已筛选的高质量源) 优先，external(外部新抓) 兜底
  4. 写回 dc.json（双格式 stores+urls）与 sources_pool.json
外部源地址可在 EXTERNAL_SOURCES 配置；本地无网环境下不要直接运行本脚本（会清空精选）。
"""
import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.abspath(__file__))
CURATED = os.path.join(ROOT, "dc.json")
POOL = os.path.join(ROOT, "sources_pool.json")
SEED = os.path.join(ROOT, "dc_full.json")
TARGET = 20

# 外部「最新源」聚合页（可增删）。best-effort：抓不到也不影响 seed 补充。
EXTERNAL_SOURCES = [
    "https://tvbox.clbug.com/user.php",
]

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
}
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def fetch(url, timeout=10):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.read().decode("utf-8", "ignore"), r.status
    except Exception:
        return None, None


def is_config(text):
    if not text:
        return False
    head = text[:4000].lower()
    return any(k in head for k in (
        '"spider"', '"video"', '"sites"', '"stores"',
        '"urls"', '"lives"', '"rules"',
    ))


def extract_links(html):
    links = set()
    for m in re.findall(r'href=["\'](https?://[^"\']+)["\']', html):
        u = m.split("#")[0].rstrip("/")
        if re.search(r"\.json", u, re.I) or "tvbox" in u.lower():
            links.add(u)
    return links


def check(url):
    text, status = fetch(url)
    return bool(status and status < 400 and is_config(text))


def short_name(meta):
    if meta.get("src") == "external":
        try:
            return urllib.parse.urlparse(meta["url"]).netloc or meta["url"]
        except Exception:
            return meta["url"]
    return meta.get("name") or meta.get("url")


def main():
    # 1) 加载/初始化候选池
    pool = {}
    if os.path.exists(POOL):
        try:
            pool = json.load(open(POOL, encoding="utf-8"))
        except Exception:
            pool = {}
    if os.path.exists(SEED):
        for s in json.load(open(SEED, encoding="utf-8"))["stores"]:
            pool.setdefault(s["url"], {"name": s["name"], "url": s["url"], "src": "seed"})

    # 2) 抓取外部最新源并入池
    new_ext = 0
    for src_url in EXTERNAL_SOURCES:
        html, _ = fetch(src_url)
        if html:
            for link in extract_links(html):
                if link not in pool:
                    pool[link] = {"name": link, "url": link, "src": "external"}
                    new_ext += 1
    print(f"[池] 总数 {len(pool)}，本次新增外部 {new_ext}")

    # 3) 并发探测
    alive = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(check, u): u for u in pool}
        for f in as_completed(futs):
            u = futs[f]
            try:
                if f.result():
                    alive[u] = pool[u]
            except Exception:
                pass
    print(f"[探测] 存活 {len(alive)} / 池 {len(pool)}")

    # 4) 构建精选（维持顺序：原精选存活优先 → seed 补 → external 补）
    curated = json.load(open(CURATED, encoding="utf-8"))["stores"]
    selected, seen = [], set()
    for s in curated:
        u = s["url"]
        if u in alive and u not in seen:
            selected.append(s)
            seen.add(u)
    for u, meta in pool.items():
        if len(selected) >= TARGET:
            break
        if u in seen or u not in alive:
            continue
        selected.append({"name": short_name(meta), "url": u})
        seen.add(u)
    selected = selected[:TARGET]

    # 5) 写回
    stores = selected
    urls = [{"url": s["url"], "name": s["name"]} for s in stores]
    json.dump({"stores": stores, "urls": urls},
              open(CURATED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(pool, open(POOL, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"[精选] 写入 {len(stores)} 条")
    for i, s in enumerate(stores, 1):
        print(f"  {i:2d}. {s['name']}  <-  {s['url']}")


if __name__ == "__main__":
    main()
