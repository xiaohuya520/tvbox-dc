#!/usr/bin/env node
/*
 * maccms_crawler.js —— 我们自己的爬虫程序（纯 JS，无需编译）
 *
 * 生成 mybox-self.json，由两部分组成：
 *   A) 探测一批「苹果CMS v10 综合影视资源站」哪些在线 → 打包成 type:1 站点
 *   B) 动态抓取 sun.json（加密配置，AES-CBC）→ 解密 → 提取用户指定的
 *      20 个 type:3 爬虫站点（热播/剧圈/半日/苹果/天堂/茉莉/哔哩/华谊/
 *      三六零/快映/虎斑/王子/闪电/人人/八零/独播/爱看/趣盘/种子），
 *      并带上 sun 的 spider jar（每次取最新，jar 地址变了自动跟随）
 *
 * 用法：
 *   - 本地：  node maccms_crawler.js
 *   - 云端：  由 .github/workflows/crawl.yml 每天自动跑
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'okhttp/3.15';
const TIMEOUT = 9000;

// ===== A. 候选苹果CMS资源站（type:1，TVBox 原生抓取）=====
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

// ===== B. sun.json 及要并入的站点白名单（type:3，依赖 sun 的 spider jar）=====
const SUN_URL = 'https://9877.kstore.space/sun.json';
const SUN_SITE_KEYS = [
  '热播影视', '剧圈99', '半日99', '苹果', '天堂', '华谊', '王子', '茉莉',
  '哔哩视频', '哔哩合集', '三六零', '快映', '闪电', '八零', '虎斑',
  '种子', '人人', '独播影视', '爱看机器人', '趣盘',
];

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA } })
    .finally(() => clearTimeout(timer));
}

// ===== TVBox 加密配置解密（$#key#$ + hex(AES-128-CBC) 格式，尾部26字符为 iv 的 hex）=====
function decryptTvbox(hexText) {
  const decoded = Buffer.from(hexText, 'hex').toString('utf-8');
  const pad = (s) => (s + '0000000000000000').slice(0, 16);
  const key = pad(decoded.substring(decoded.indexOf('$#') + 2, decoded.indexOf('#$')));
  const iv = pad(decoded.slice(-13));
  const bodyHex = hexText.substring(hexText.indexOf('2324') + 4, hexText.length - 26);
  const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf-8'), Buffer.from(iv, 'utf-8'));
  return Buffer.concat([d.update(Buffer.from(bodyHex, 'hex')), d.final()]).toString('utf-8');
}

async function fetchSun() {
  const res = await fetchWithTimeout(SUN_URL, TIMEOUT);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = (await res.text()).trim();
  try {
    return JSON.parse(text); // 明文 JSON
  } catch (e) {
    return JSON.parse(decryptTvbox(text)); // 加密配置
  }
}

// ===== A 的探测逻辑 =====
function buildProbeUrl(api) {
  const sep = api.includes('?') ? '&' : '?';
  return api + sep + 'ac=list&pg=1&at=json&pagesize=5';
}

async function probe(site) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(buildProbeUrl(site.api), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      if (j && j.code === 1 && Array.isArray(j.list) && j.list.length > 0) {
        return { ok: true, count: j.total || j.list.length };
      }
      return { ok: false, reason: 'JSON 无有效 list' };
    } catch (e) {
      if (text.includes('<list') && text.includes('<video')) return { ok: true, count: 'xml' };
      return { ok: false, reason: '返回无法解析' };
    }
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const sites = [];
  let spider = '';
  let sunCount = 0;

  // A) 探测苹果CMS资源站
  console.log(`[爬虫A] 开始探测 ${CANDIDATES.length} 个候选资源站...`);
  for (const c of CANDIDATES) {
    const r = await probe(c);
    if (r.ok) {
      sites.push({
        key: c.key, name: c.name, type: 1, api: c.api,
        playUrl: '', ext: '', searchable: 1, quickSearch: 1, filterable: 1,
      });
      console.log(`  ✅ ${c.name}  在线 (${r.count})`);
    } else {
      console.log(`  ❌ ${c.name}  离线/失败: ${r.reason}`);
    }
  }

  // B) 抓取并解密 sun.json，提取白名单站点
  console.log(`[爬虫B] 抓取 sun.json 并提取 ${SUN_SITE_KEYS.length} 个站点...`);
  try {
    const sun = await fetchSun();
    const all = Array.isArray(sun.sites) ? sun.sites : [];
    const picked = all.filter((s) => SUN_SITE_KEYS.includes(s.key));
    for (const k of SUN_SITE_KEYS) {
      const s = picked.find((x) => x.key === k);
      if (s) {
        sites.push(s);
        console.log(`  ✅ ${s.name}`);
      } else {
        console.log(`  ⚠️ 未找到 key=${k}（sun 可能已更新站点名单）`);
      }
    }
    if (sun.spider) spider = sun.spider;
    sunCount = picked.length;
  } catch (e) {
    console.log(`  ❌ sun.json 获取失败: ${e.message}（本次仅输出资源站）`);
  }

  const box = { spider, sites, lives: [], parses: [], flags: [], rules: {} };
  const out = path.join(__dirname, 'mybox-self.json');
  fs.writeFileSync(out, JSON.stringify(box, null, 2), 'utf-8');
  console.log(`\n[完成] 资源站 ${sites.length - sunCount} + sun站 ${sunCount} = 共 ${sites.length} 个，spider ${spider ? '已带(sun最新)' : '空'}，已写入 ${out}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
