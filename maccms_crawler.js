#!/usr/bin/env node
/*
 * maccms_crawler.js —— 我们自己的爬虫程序（纯 JS，无需编译）
 *
 * 作用：自动探测一批「苹果CMS v10 综合影视资源站」哪些在线，
 *       把在线的打包成标准 TVBox 单仓 JSON（mybox-self.json）。
 *
 * 为什么这么做：圈内绝大多数综合影视站底层都是苹果CMS，自带标准
 *       API（/api.php/provide/vod），TVBox 原生 type:1 就能直接抓，
 *       不需要写复杂 spider。所以我们「自己做的单仓」= 自己写的爬虫
 *       去筛选 + 打包这些站，完全可控、随时增删、自动保鲜。
 *
 * 用法：
 *   - 本地：  node maccms_crawler.js
 *   - 云端：  由 .github/workflows/crawl.yml 每天自动跑
 *
 * 想加自己的站？直接往下方 CANDIDATES 里加一行 { key, name, api } 即可。
 */

const fs = require('fs');
const path = require('path');

// ===== 候选综合影视资源站（苹果CMS v10 标准 API）=====
// 这些都是「资源站」，TVBox 用 type:1 直接抓取。全部可控、可随时增删。
// api 填到 /api.php/provide/vod（或 /provide/vod）这一层即可，线路让 TVBox 自己选。
const CANDIDATES = [
  { key: 'hongniu',  name: '红牛资源',   api: 'https://hongniuzy2.com/api.php/provide/vod' },
  { key: 'liangzi',  name: '量子资源',   api: 'https://cj.lziapi.com/api.php/provide/vod' },
  { key: 'wolong',   name: '卧龙资源',   api: 'https://collect.wolongzyw.com/api.php/provide/vod' },
  { key: '360zy',    name: '360资源',    api: 'https://360zyzz.com/api.php/provide/vod' },
  { key: 'jinying',  name: '金鹰资源',   api: 'http://jyzyapi.com/provide/vod' },
  { key: 'guangsu',  name: '光速资源',   api: 'http://api.guangsuapi.com/api.php/provide/vod' },
  { key: 'maoyan',   name: '猫眼资源',   api: 'https://api.maoyanapi.top/api.php/provide/vod' },
  { key: 'yutu',     name: '鱼兔资源',   api: 'https://apiyutu.com/api.php/provide/vod' },
  { key: 'aosika',   name: '奥斯卡资源', api: 'https://aosikazy.com/api.php/provide/vod' },
  { key: 'shandian', name: '闪电资源',   api: 'http://sdzyapi.com/api.php/provide/vod' },
];

const TIMEOUT = 9000;

// 统一拼参数：强制 JSON 返回，方便解析；pagesize=5 只取少量验证在线即可
function buildUrl(api) {
  const sep = api.includes('?') ? '&' : '?';
  return api + sep + 'ac=list&pg=1&at=json&pagesize=5';
}

async function probe(site) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(buildUrl(site.api), {
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const text = await res.text();
    // 优先按 JSON 解析（苹果CMS 加 at=json 即返回 JSON）
    try {
      const j = JSON.parse(text);
      if (j && j.code === 1 && Array.isArray(j.list) && j.list.length > 0) {
        return { ok: true, count: j.total || j.list.length };
      }
      return { ok: false, reason: 'JSON 无有效 list' };
    } catch (e) {
      // 兜底：部分站强制 XML，检查标签
      if (text.includes('<list') && text.includes('<video')) {
        return { ok: true, count: 'xml' };
      }
      return { ok: false, reason: '返回无法解析' };
    }
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`[爬虫] 开始探测 ${CANDIDATES.length} 个候选综合影视资源站...`);
  const sites = [];
  for (const c of CANDIDATES) {
    const r = await probe(c);
    if (r.ok) {
      sites.push({
        key: c.key,
        name: c.name,
        type: 1,            // type:1 = 苹果CMS 原生采集，TVBox 直接抓，无需额外 spider
        api: c.api,
        playUrl: '',
        ext: '',
        searchable: 1,
        quickSearch: 1,
        filterable: 1,
      });
      console.log(`  ✅ ${c.name}  在线 (${r.count})`);
    } else {
      console.log(`  ❌ ${c.name}  离线/失败: ${r.reason}`);
    }
  }

  const box = {
    spider: '',
    sites,
    lives: [],
    parses: [],
    flags: [],
    rules: {},
  };
  const out = path.join(__dirname, 'mybox-self.json');
  fs.writeFileSync(out, JSON.stringify(box, null, 2), 'utf-8');
  console.log(`\n[爬虫] 完成：在线 ${sites.length}/${CANDIDATES.length} 个，已写入 ${out}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
