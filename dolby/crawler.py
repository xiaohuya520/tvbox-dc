#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TVBox 杜比资源站 — 爬虫
============================
目标：只产出「杜比 / 杜比视界 / 杜比全景声」类资源，输出 MacCMS 兼容的
catalog.json，配合 spider.js 在 TVBox 里当成一个资源站使用。

两种抓取模式（在 config.json 的 sources 里用 type 区分）：
  type=maccms     从苹果CMS(MacCMS)源翻页，按杜比关键词过滤（适合真·原盘站）
  type=dolby_list 以 Dolby 官方杜比视界/全景声院线片单为权威清单，逐片去
                 search_sources 搜真实播放地址（适合综合站，保证“全都是杜比”）

用法:
  python crawler.py            # 按 config.json 里的 sources 真实抓取
  python crawler.py --demo     # 用内置示例数据生成 catalog.json（验证流程用）

MacCMS 标准 API 格式:
  list  : {api}?ac=list&pg=1&limit=30   -> {code,page,pagecount,total,list:[...]}
  detail: {api}?ac=detail&ids={id}      -> {list:[{vod_play_url,vod_play_from,...}]}
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
import ssl
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE, "config.json")
CATALOG_PATH = os.path.join(BASE, "data", "catalog.json")

# 不校验 HTTPS 证书（部分小站证书过期），仅用于抓取，不影响输出
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

# ---------------------------------------------------------------------------
# Dolby 官方片单兜底快照（2024-2026 杜比视界/全景声院线电影，运行时抓页失败用）
# 来源：https://professional.dolby.com/zh-cn/cinema/theatrical-releases
# ---------------------------------------------------------------------------
DOLBY_SNAPSHOT = [
    # 2026
    "野兽之心", "复仇者联盟4：终局之战 重映", "大唐妖探", "逃出绝命街", "奥德赛",
    "欢迎来龙餐馆", "汪汪队立大功大电影3：勇闯恐龙岛", "蜘蛛侠：崭新之日", "群星闪耀时",
    "痴迷", "八仙！", "少林女足", "三国第一部：争洛阳", "海洋奇缘：启航",
    "小黄人与大怪兽", "四渡", "超级少女", "玩具总动员5", "宇宙巨人：希曼崛起",
    "星球大战:曼达洛人与古古", "绵羊侦探团", "真人快打II", "穿普拉达的女王2",
    "迈克尔·杰克逊：巨星之路", "万桐书", "超级马力欧银河大电影", "河狸变身计划",
    "挽救计划", "奇迹梦之队", "呼啸山庄", "洛杉矶劫案", "暗黑新娘！",
    "镖人：风起大漠", "惊蛰无声", "飞驰人生3", "极限审判", "海绵宝宝：深海大冒险",
    # 2025
    "寻秦记", "无名之辈：意义非凡", "阿凡达3:火与烬", "得闲谨制", "猎杀游戏",
    "我的世界没有我", "疯狂动物城2", "鬼灭之刃：无限城篇 第一章 猗窝座再袭 剧场版",
    "铁血战士：杀戮之地", "一战再战", "创：战神", "三国的星空第一部", "刺杀小说家2",
    "731", "死神来了：血脉诅咒", "东极岛", "南京照相馆", "神奇四侠：第一步",
    "长安的荔枝", "你行！你上！", "魔法蓝精灵", "聊斋：兰若寺", "超人",
    "无名之辈：否极泰来", "恶意", "侏罗纪世界：重生", "名侦探柯南：独眼的残像",
    "F1：狂飙飞车", "地球特派员", "酱园弄·悬案", "新·驯龙高手", "功夫梦：融合之道",
    "碟中谍8：最终清算", "星际宝贝史迪奇", "雷霆特攻队", "我的世界", "白雪公主",
    "编号17", "花样年华（25周年导演特别版4K）", "美国队长4", "蛟龙行动",
    "射雕英雄传：侠之大者", "哪吒之魔童闹海", "封神第二部：战火西岐", "唐人街探案1900",
    "刺猬索尼克3",
    # 2024
    "误杀3", "误判", "狮子王：木法沙传奇", "雄狮少年2", "猎人克莱文", "小倩",
    "魔法坏女巫", "海洋奇缘2", "风流一代", "角斗士2", "破·地狱", "红色一号：冬日行动",
    "焚城", "毒液：最后一舞", "小丑2：双重妄想", "只此青绿", "749局", "危机航线",
    "出入平安", "志愿军：存亡之战", "变形金刚：起源", "荒野机器人", "流浪地球2(3D)",
    "伟大征程", "异形：夺命舰", "名侦探柯南：百万美元的五棱星", "重生", "白蛇：浮生",
    "逆行人生", "解密", "异人之下", "死侍与金刚狼", "龙卷风", "抓娃娃", "神偷奶爸4",
    "传说", "寂静之地：入侵日", "海关战线", "援军明日到达", "绝地战警：生死与共",
    "头脑特工队2", "神秘友友", "排球少年！！垃圾场决战", "谈判专家", "疯狂的麦克斯：狂暴女神",
    "美国内战", "猩球崛起4：新世界", "坂本龙一：杰作", "维和防暴队", "九龙城寨之围城",
    "特技狂人", "间谍过家家 代号：白", "中国车手周冠宇", "黄雀在后！",
    "你想活出怎样的人生", "哥斯拉大战金刚2", "功夫熊猫4", "沙丘2", "沙丘1",
    "蜘蛛夫人：超感觉醒", "阿盖尔：神秘特工", "飞驰人生2", "热辣滚烫", "第二十条", "盗月者",
]


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def fetch_json(url, timeout=20, ua="Mozilla/5.0"):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Referer": url})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        raw = r.read().decode("utf-8", "ignore")
    return json.loads(raw)


def is_dolby(item, dolby_cfg):
    """严格判断一条资源是不是杜比相关。"""
    text = " ".join([
        str(item.get("vod_name", "")),
        str(item.get("vod_remarks", "")),
        str(item.get("vod_content", "")),
    ]).lower()
    keywords = [k.lower() for k in dolby_cfg.get("keywords", [])]
    allow = [t.lower() for t in dolby_cfg.get("also_allow_tags", [])]
    drop = [d.lower() for d in dolby_cfg.get("drop_keywords", [])]
    if any(d in text for d in drop):
        return False
    hit_dolby = any(k in text for k in keywords)
    if dolby_cfg.get("strict", True):
        return hit_dolby
    hit_tag = any(t in text for t in allow)
    return hit_dolby or hit_tag


def detect_netdisk(play_url, netdisk_cfg):
    """从播放地址里识别网盘类型，返回网盘标签列表。"""
    if not netdisk_cfg or not netdisk_cfg.get("enabled", True):
        return []
    labels = netdisk_cfg.get("labels", {})
    found = []
    for part in str(play_url).split("#"):
        seg = part.split("$", 1)[-1] if "$" in part else part
        seg_l = seg.lower()
        for label, domains in labels.items():
            if any(d.lower() in seg_l for d in domains):
                if label not in found:
                    found.append(label)
                break
    return found


def fetch_dolby_official(url):
    """尝试抓取 Dolby 官方杜比视界/全景声片单，失败返回兜底快照。"""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://professional.dolby.com/"},
        )
        html = urllib.request.urlopen(req, timeout=20, context=CTX).read().decode("utf-8", "ignore")
        names = re.findall(r"《([^》]+)》", html)
        names = [n.strip() for n in names if n.strip()]
        if len(names) >= 20:
            print(f"  [info] Dolby 官方页抓到 {len(names)} 部杜比片")
            return names
    except Exception as e:
        print(f"  [warn] Dolby 官方页抓取失败({e})，使用内置快照")
    return DOLBY_SNAPSHOT


def _clean_title(name):
    """清洗片名，去掉常见噪音后缀便于搜索匹配。"""
    n = name.strip()
    return n


def _is_real_movie(title, remarks):
    """排除解说/预告/综艺/电视剧等非正片结果。"""
    bad = ["解说", "预告", "综艺", "电视剧", "纪录片", "花絮", "混剪", "盘点", "盘点", "短剧"]
    t = (title + " " + remarks).lower()
    # 允许片名里自然含“剧”字（如《间谍过家家 代号：白》），但排除明确“电视剧/短剧”
    if "电视剧" in t or "短剧" in t:
        return False
    return not any(b in t for b in bad)


def crawl_dolby_list(src, crawl_cfg, netdisk_cfg, collected):
    """以 Dolby 官方片单为权威清单，逐片去 search_sources 搜真实播放地址。
    列表接口已直接返回 vod_play_url，无需再拉 detail；用线程池并发提速。
    """
    list_url = src.get("list_url", "https://professional.dolby.com/zh-cn/cinema/theatrical-releases")
    search_sources = src.get("search_sources", [])
    flag = src.get("play_flag", "杜比电影")
    min_year = int(src.get("min_year", 2023))
    ua = crawl_cfg.get("user_agent", "Mozilla/5.0")
    timeout = min(int(crawl_cfg.get("timeout", 20)), 12)
    workers = int(src.get("workers", 4))
    require_netdisk = bool(netdisk_cfg.get("require_netdisk", False)) if netdisk_cfg else False

    names = fetch_dolby_official(list_url)
    # 可选：调试/沙箱环境限制抓取数量，本机全量请删除此行
    if src.get("max_movies"):
        names = names[: int(src["max_movies"])]
    total = len(names)
    print(f"[info] 杜比片单共 {total} 部，开始并发搜源（workers={workers}）")

    def search_one(name):
        for api in search_sources:
            base = api.rstrip("/")
            wd = urllib.parse.quote(name)
            try:
                data = fetch_json(f"{base}?ac=list&wd={wd}&pg=1&limit=10", timeout, ua)
            except Exception:
                continue
            for it in (data.get("list") or []):
                t = str(it.get("vod_name", ""))
                rm = str(it.get("vod_remarks", ""))
                if not _is_real_movie(t, rm):
                    continue
                # 片名主体需匹配（避免“奥德赛”匹配到“尤利西斯：黑暗的奥德赛”）
                if name not in t and t not in name:
                    continue
                return it, base
        return None

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(search_one, n): n for n in names}
        for fut in as_completed(futs):
            name = futs[fut]
            done += 1
            res = fut.result()
            if not res:
                if done % 20 == 0:
                    print(f"  [progress] {done}/{total} 已处理，已收 {len(collected)} 部")
                continue
            it, base = res
            vid = "dolby_" + re.sub(r"\W+", "", name)
            if vid in collected:
                continue
            pic = it.get("vod_pic", "")
            play_url = it.get("vod_play_url", "") or ""
            play_from = it.get("vod_play_from", flag) or flag
            # 极少数站点列表不带地址时，补一次详情
            if not play_url:
                try:
                    d = fetch_json(f"{base}?ac=detail&ids={it.get('vod_id')}", timeout, ua)
                    dl = d.get("list") or []
                    if dl:
                        play_url = dl[0].get("vod_play_url", "") or ""
                        play_from = dl[0].get("vod_play_from", play_from) or play_from
                except Exception:
                    pass
            if not play_url:
                continue
            nk = detect_netdisk(play_url, netdisk_cfg)
            if nk:
                play_from = "$$$".join(nk)
            if require_netdisk and not nk:
                continue
            collected[vid] = {
                "vod_id": vid,
                "vod_name": name,
                "vod_pic": pic,
                "vod_remarks": "杜比视界|杜比全景声" + ("|" + "$$$".join(nk) if nk else ""),
                "vod_year": "",
                "vod_content": "官方认证杜比视界/杜比全景声电影（片源来自%s）" % src.get("name", "综合影视源"),
                "vod_play_from": play_from,
                "vod_play_url": play_url,
                "vod_netdisk": "$$$".join(nk),
            }
            print(f"  [+{len(collected)}] {name}  [{play_from}]")


def crawl_source(src, crawl_cfg, dolby_cfg, netdisk_cfg, collected):
    """从 MacCMS 源翻页，按杜比关键词严格过滤（适合真·原盘/杜比专门站）。"""
    api = src["api"].rstrip("/")
    flag = src.get("play_flag", "杜比线路")
    require_netdisk = bool(netdisk_cfg.get("require_netdisk", False)) if netdisk_cfg else False
    pages = int(crawl_cfg.get("max_pages_per_source", 80))
    delay = float(crawl_cfg.get("request_delay", 1.2))
    ua = crawl_cfg.get("user_agent", "Mozilla/5.0")
    timeout = int(crawl_cfg.get("timeout", 20))
    limit = int(crawl_cfg.get("page_size", 30))

    for pg in range(1, pages + 1):
        url = f"{api}?ac=list&pg={pg}&limit={limit}"
        try:
            data = fetch_json(url, timeout, ua)
        except Exception as e:
            print(f"  [warn] {src['name']} 列表页 {pg} 失败: {e}")
            break

        items = data.get("list") or []
        if not items:
            break

        for it in items:
            if not is_dolby(it, dolby_cfg):
                continue
            vid = str(it.get("vod_id"))
            if vid in collected:
                continue

            name = it.get("vod_name", "")
            pic = it.get("vod_pic", "")
            remarks = it.get("vod_remarks", "")
            year = it.get("vod_year", "")
            content = it.get("vod_content", "")
            play_url = ""
            play_from = flag

            try:
                d = fetch_json(f"{api}?ac=detail&ids={vid}", timeout, ua)
                dl = d.get("list") or []
                if dl:
                    play_url = dl[0].get("vod_play_url", "") or ""
                    play_from = dl[0].get("vod_play_from", flag) or flag
                    content = dl[0].get("vod_content", content) or content
            except Exception as e:
                print(f"  [warn] {src['name']} 详情 {vid} 失败: {e}")

            nk = detect_netdisk(play_url, netdisk_cfg)
            if nk:
                play_from = "$$$".join(nk)
            if require_netdisk and not nk:
                continue

            collected[vid] = {
                "vod_id": vid,
                "vod_name": name,
                "vod_pic": pic,
                "vod_remarks": remarks,
                "vod_year": year,
                "vod_content": content,
                "vod_play_from": play_from,
                "vod_play_url": play_url,
                "vod_netdisk": "$$$".join(nk),
            }

        print(f"  [info] {src['name']} 第{pg}页，已收 {len(collected)} 条杜比")
        time.sleep(delay)
        try:
            if pg >= int(data.get("pagecount", 1)):
                break
        except Exception:
            pass


def demo_seed(collected):
    """内置示例，证明整条链路可用。真实使用请运行真实抓取覆盖本数据。"""
    samples = [
        {"vod_id": "demo1", "vod_name": "【演示】星际穿越 杜比视界版",
         "vod_pic": "", "vod_remarks": "杜比视界|4K|演示样例", "vod_year": "2014",
         "vod_content": "这是演示数据，请运行 python crawler.py 抓取真实杜比资源后覆盖。",
         "vod_play_from": "杜比线路",
         "vod_play_url": "第01集$https://example.com/demo1.m3u8#第02集$https://example.com/demo1b.m3u8"},
        {"vod_id": "demo2", "vod_name": "【演示】沙丘2 杜比全景声 4K原盘",
         "vod_pic": "", "vod_remarks": "杜比全景声|4K原盘|演示样例", "vod_year": "2024",
         "vod_content": "这是演示数据，请运行 python crawler.py 抓取真实杜比资源后覆盖。",
         "vod_play_from": "杜比线路",
         "vod_play_url": "正片$https://example.com/demo2.m3u8"},
        {"vod_id": "demo3", "vod_name": "【演示】奥本海默 杜比视界+全景声",
         "vod_pic": "", "vod_remarks": "杜比视界|杜比全景声|演示样例", "vod_year": "2023",
         "vod_content": "这是演示数据，请运行 python crawler.py 抓取真实杜比资源后覆盖。",
         "vod_play_from": "杜比线路",
         "vod_play_url": "正片$https://example.com/demo3.m3u8"},
        {"vod_id": "demo4", "vod_name": "【演示】阿凡达2 杜比视界 4K原盘",
         "vod_pic": "", "vod_remarks": "杜比视界|4K原盘|夸克网盘", "vod_year": "2022",
         "vod_content": "这是演示数据（网盘示例），请运行 python crawler.py 抓取真实杜比资源后覆盖。",
         "vod_play_from": "夸克网盘",
         "vod_play_url": "正片$https://pan.quark.cn/s/demo-avatars",
         "vod_netdisk": "夸克网盘"},
        {"vod_id": "demo5", "vod_name": "【演示】流浪地球2 杜比全景声 4K原盘",
         "vod_pic": "", "vod_remarks": "杜比全景声|4K原盘|百度网盘", "vod_year": "2023",
         "vod_content": "这是演示数据（网盘示例），请运行 python crawler.py 抓取真实杜比资源后覆盖。",
         "vod_play_from": "百度网盘",
         "vod_play_url": "正片$https://pan.baidu.com/s/1demo-earth",
         "vod_netdisk": "百度网盘"},
    ]
    for s in samples:
        collected[s["vod_id"]] = s


def main():
    demo = "--demo" in sys.argv
    config = load_config()
    collected = {}

    if demo:
        print("[info] 演示模式：生成示例 catalog.json")
        demo_seed(collected)
    else:
        crawl_cfg = config.get("crawl", {})
        dolby_cfg = config.get("dolby", {})
        any_enabled = False
        for src in config.get("sources", []):
            if not src.get("enabled", True):
                print(f"[skip] 未启用: {src.get('name')}")
                continue
            any_enabled = True
            stype = src.get("type", "maccms")
            print(f"[info] 开始抓取({stype}): {src['name']}")
            if stype == "dolby_list":
                crawl_dolby_list(src, crawl_cfg, config.get("netdisk", {}), collected)
            else:
                crawl_source(src, crawl_cfg, dolby_cfg, config.get("netdisk", {}), collected)
        if not any_enabled:
            print("[warn] config.json 里没有 enabled 的源，未抓取任何数据。")

    catalog = {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total": len(collected),
        "list": list(collected.values()),
    }
    os.makedirs(os.path.dirname(CATALOG_PATH), exist_ok=True)
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    print(f"[done] 共 {len(collected)} 条杜比资源 -> {CATALOG_PATH}")


if __name__ == "__main__":
    main()
