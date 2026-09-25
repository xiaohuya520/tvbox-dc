#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TVBox 多仓自动刷新（运行在 GitHub Actions 云端，能正常联网探测）。

流程：
  1. 候选池 sources_pool.json = seed(来自 dc_full.json 的 93 条) + gh(GitHub 直链单仓)
     + ghagg(GitHub 聚合仓库目录列举) + external(网页聚合页抓取)，只增不删
  2. 并发探测池内所有源是否存活（HTTP 可达 + 响应体像 TVBox 配置）
  3. 精选 dc.json 维持 TARGET 个：先保留原精选中存活的，再从可用集按优先级补满
     - 补充优先级：seed/gh(高质量源) 优先，ghagg 次之，external(外部新抓) 兜底
  4. 写回 dc.json（双格式 stores+urls）与 sources_pool.json
外部源地址可在 EXTERNAL_SOURCES / GITHUB_RAW_SOURCES / GITHUB_AGGREGATORS 配置；
本地无网环境下不要直接运行本脚本（会清空精选）。
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
TARGET = 16

# 补充优先级（越小越优先）
PRIORITY = {"seed": 0, "gh": 0, "ghagg": 1, "external": 2}

# 锚点：用户指定必须保留（即使探测失败也保留，好用源）
ANCHOR_URLS = [
    "https://9280.kstore.vip/newwex.json",   # 王二小
    "https://9877.kstore.space/sun.json",    # 新潇洒 sun
]

# 资源多大仓优先关键字（命中则优先补入精选，保证"资源多"）
BIG_KEYWORDS = [
    "newwex.json", "sun.json", "feimao", "ouge", "4k.json", "fty.json",
    "xiaosa", "fish.json", "liucn.cc", "noimank", "FongMi", "ls660",
    "YGBH", "252035.xyz", "clun.top", "aowu.json", "gaotianliuyun",
    "Yoursmile7", "xiaolong69",
]

# 自建单仓 mybox.json 默认 spider（兜底用，优先复用首个成功源自带的 spider）
SPIDER_DEFAULT = "https://cdn.jsdelivr.net/gh/CatVod/CatVodSpider@main/jar/custom_spider.jar"
SINGLE = os.path.join(ROOT, "mybox.json")

# 借鉴其他多仓（Lightconer 影视仓聚合仓库）的单仓，走 jsDelivr 镜像，国内快
LIGHTCONER_GHAGG = {
    "肥猫(借鉴多仓)": "https://cdn.jsdelivr.net/gh/Lightconer/tvbox-ysc-config@main/output/feimao.json",
    "讴歌(借鉴多仓)": "https://cdn.jsdelivr.net/gh/Lightconer/tvbox-ysc-config@main/output/ouge.json",
    "4K影视(借鉴多仓)": "https://cdn.jsdelivr.net/gh/Lightconer/tvbox-ysc-config@main/output/4k.json",
    "王二小(借鉴多仓)": "https://cdn.jsdelivr.net/gh/Lightconer/tvbox-ysc-config@main/output/wangerxiao.json",
}

# 网页型聚合页（best-effort 抓链接，含中文域名/纯文本 URL）
EXTERNAL_SOURCES = [
    "https://tvbox.clbug.com/user.php",
    "https://tv.wmmfc.com/%E5%BD%B1%E8%A7%86-%E7%9B%B4%E6%92%AD%E6%8E%A5%E5%8F%A3",
    "https://www.ymaoo.cn/2244.html",
    "https://designshidai.com/?p=19467/",
    "https://down.7po.com/article/2191.html",
    "https://www.111cn.net/new/573294.htm",
]

# GitHub 直链单仓（知名维护者，长期稳定，优先补充）
GITHUB_RAW_SOURCES = [
    "https://raw.githubusercontent.com/liu673cn/box/main/m.json",
    "https://raw.githubusercontent.com/FongMi/CatVodSpider/main/json/config.json",
    "https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json",
    "https://raw.githubusercontent.com/Yoursmile7/TVBox/main/XC.json",
    "https://raw.githubusercontent.com/xiaolong69/tv/main/1.json",
]

# GitHub 聚合仓库（自动列举其输出目录的单仓 json，自带 Actions 更新）
GITHUB_AGGREGATORS = [
    ("Lightconer/tvbox-ysc-config", "output"),
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


def fetch_github_dir(repo, path):
    """列举 GitHub 仓库目录，返回其中的 .json 直链（download_url）。"""
    api = f"https://api.github.com/repos/{repo}/contents/{path}"
    out = []
    try:
        req = urllib.request.Request(api, headers=UA)
        with urllib.request.urlopen(req, timeout=15, context=CTX) as r:
            data = json.loads(r.read().decode("utf-8", "ignore"))
        for item in data:
            if item.get("type") == "file" and item.get("name", "").lower().endswith(".json"):
                dl = item.get("download_url")
                if dl:
                    out.append(dl)
    except Exception as e:
        print(f"[gh-dir] 列举 {repo}/{path} 失败: {e}")
    return out


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
        links.add(m.split("#")[0].rstrip("/"))
    # 纯文本 URL（捕获未包在 href 内的，如聚合页里的接口列表）
    for m in re.findall(r'(?:^|[\s("\'<>])(https?://[^\s"\'<>]+)', html):
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


def build_single(pool, alive, anchors):
    """合并所有存活源的 type=3 直连站点 + 直播，生成一个聚合单仓 mybox.json。
    锚点强制纳入；去重 key 防止冲突。spider 优先复用首个源的，兜底用 CatVod 公用 jar。
    """
    sites, seen_keys = {}, set()
    lives, seen_live = [], set()
    spider_val = None
    urls = list(alive.keys())
    for au in anchors:
        if au not in urls:
            urls.append(au)
    for u in urls:
        text, _ = fetch(u)
        if not text:
            continue
        try:
            d = json.loads(text)
        except Exception:
            continue
        sp = d.get("spider")
        if sp and not spider_val:
            spider_val = sp
        for s in d.get("sites", []):
            t = s.get("type")
            if t is not None and str(t) != "3":
                continue  # 只收直连采集站，跨源通用、冲突最小
            key = s.get("key") or s.get("name")
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            sites[key] = s
        for lv in d.get("lives", []):
            nm = lv.get("name") or lv.get("url")
            if not nm or nm in seen_live:
                continue
            seen_live.add(nm)
            lives.append(lv)
    single = {
        "spider": spider_val or SPIDER_DEFAULT,
        "sites": list(sites.values()),
        "lives": lives,
    }
    json.dump(single, open(SINGLE, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"[单仓] mybox.json 写入 sites={len(sites)} lives={len(lives)}")


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

    # 2.1) GitHub 直链单仓
    for u in GITHUB_RAW_SOURCES:
        if u not in pool:
            pool[u] = {"name": u.rsplit("/", 1)[-1].rsplit(".", 1)[0],
                       "url": u, "src": "gh"}

    # 2.2) GitHub 聚合仓库目录
    for repo, path in GITHUB_AGGREGATORS:
        for dl in fetch_github_dir(repo, path):
            if dl not in pool:
                nm = dl.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                pool[dl] = {"name": nm, "url": dl, "src": "ghagg"}

    # 2.3) 网页型聚合页
    new_ext = 0
    for src_url in EXTERNAL_SOURCES:
        html, _ = fetch(src_url)
        if html:
            for link in extract_links(html):
                if link not in pool:
                    pool[link] = {"name": link, "url": link, "src": "external"}
                    new_ext += 1
    # 2.4) 借鉴其他多仓：Lightconer 影视仓聚合仓库的单仓（走 jsDelivr 镜像）
    for nm, u in LIGHTCONER_GHAGG.items():
        if u not in pool:
            pool[u] = {"name": nm, "url": u, "src": "ghagg"}

    print(f"[池] 总数 {len(pool)}，本次新增外部 {new_ext}")

    # 3) 并发探测
    alive = {}
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = {ex.submit(check, u): u for u in pool}
        for f in as_completed(futs):
            u = futs[f]
            try:
                if f.result():
                    alive[u] = pool[u]
            except Exception:
                pass
    print(f"[探测] 存活 {len(alive)} / 池 {len(pool)}")

    # 4) 构建精选（锚点强制 → 原精选存活 → 资源多大仓优先补满）
    selected, seen = [], set()

    # 4.0 锚点：用户指定必须保留（即使探测失败也保留）
    for au in ANCHOR_URLS:
        if au not in seen:
            meta = pool.get(au, {"name": au.rsplit("/", 1)[-1].rsplit(".", 1)[0],
                                 "url": au, "src": "seed"})
            selected.append({"name": meta.get("name") or "锚点", "url": au})
            seen.add(au)

    # 4.1 原精选中存活的（非锚点）保留
    curated = json.load(open(CURATED, encoding="utf-8"))["stores"]
    for s in curated:
        u = s["url"]
        if u in seen:
            continue
        if u in alive and u not in seen:
            selected.append(s)
            seen.add(u)

    # 4.2 补满：先资源多大仓(BIG)，再按来源优先级
    def rank(u):
        meta = pool.get(u, {})
        big = 0 if any(k in u for k in BIG_KEYWORDS) else 1
        return (big, PRIORITY.get(meta.get("src"), 9))

    rest = sorted([u for u in alive if u not in seen], key=rank)
    for u in rest:
        if len(selected) >= TARGET:
            break
        selected.append({"name": short_name(pool[u]), "url": u})
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

    # 6) 构建"自建聚合单仓" mybox.json（合并活源的直连站点，导入即出全部站点）
    try:
        build_single(pool, alive, ANCHOR_URLS)
    except Exception as e:
        print(f"[单仓] 构建失败: {e}")


if __name__ == "__main__":
    main()
