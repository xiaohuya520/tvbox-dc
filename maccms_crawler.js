#!/usr/bin/env node
/*
 * maccms_crawler.js —— 我们自己的爬虫程序 v3（纯 JS，无需编译）
 *
 * 生成 mybox-self.json（完全去 sun 化，导入后不依赖 sun 的任何链接）：
 *   A) 探测一批「苹果CMS v10 综合影视资源站」哪些在线 → 打包成 type:1 站点
 *   B) 抓取 sun.json（加密配置，AES-CBC）→ 解密 → 提取【全部站点】
 *   C) 下载 sun 的 spider jar（图片伪装）→ 存入本仓库 jar/sun_spider.jar 自托管
 *      → mybox-self.json 的 spider 指向我们自己仓库的 jar 地址
 *
 * 依赖关系说明：sun 仅在「每天构建时」被访问一次；导入 TVBox 后运行时
 * 只依赖我们自己仓库（raw.githubusercontent.com/xiaohuya520/tvbox-dc）。
 * sun 哪天挂了/换地址/加防盗链：自动改用仓库里的 sun_sites_cache.json
 * （最近一次成功解密的站点快照），单仓照常完整重建，不丢站点。
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

// 自托管 jar 的对外地址（导入后的单仓只认这个，不再认 sun 的动态地址）
// 实测（2026-09-26 用户宽带）：raw 超时、jsDelivr 拒载 jar(403)、gh-proxy 1秒拉完 1.8MB → 用 gh-proxy
const SELF_JAR_URL = 'https://gh-proxy.com/https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/jar/sun_spider.jar';

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

// ===== B. sun.json（构建时数据源，运行时不依赖）=====
const SUN_URL = 'https://9877.kstore.space/sun.json';

function fetchWithTimeout(url, ms, binary = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA } })
    .then(async (res) => (binary ? { ok: res.ok, status: res.status, buf: Buffer.from(await res.arrayBuffer()) } : res))
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

// spider 字段形如 "https://xxx/yyy.png;md5;hash" —— 取出纯 URL 和 md5
function parseSpider(s) {
  if (!s) return { url: '', md5: '' };
  const parts = String(s).split(';');
  const url = parts[0];
  let md5 = '';
  const mi = parts.findIndex((p) => p === 'md5');
  if (mi >= 0 && parts[mi + 1]) md5 = parts[mi + 1];
  return { url, md5 };
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

  // B+C) 抓取 sun.json：全部站点 + 自托管 jar
  console.log(`[爬虫B] 抓取 sun.json（全部站点 + jar 自托管）...`);
  try {
    const sun = await fetchSun();
    const all = Array.isArray(sun.sites) ? sun.sites : [];
    sites.push(...all);
    sunCount = all.length;
    // 刷新缓存：把解密后的 sun 站点存进仓库。sun 哪天挂了/消失，下次构建用它兜底
    try {
      fs.writeFileSync(
        path.join(__dirname, 'sun_sites_cache.json'),
        JSON.stringify({ updated: new Date().toISOString(), count: all.length, sites: all }, null, 2),
        'utf-8'
      );
      console.log(`  ✅ 并入 sun 全部站点 ${all.length} 个（已刷新缓存 sun_sites_cache.json）`);
    } catch (ce) {
      console.log(`  ⚠️ 缓存写入失败: ${ce.message}`);
    }

    // 下载 sun 的 spider jar，自托管到本仓库 jar/sun_spider.jar
    const { url: jarUrl, md5: jarMd5 } = parseSpider(sun.spider);
    if (jarUrl) {
      console.log(`[爬虫C] 下载 sun spider jar: ${jarUrl}`);
      const r = await fetchWithTimeout(jarUrl, 30000, true);
      if (r.ok && r.buf.length > 1000) {
        const jarDir = path.join(__dirname, 'jar');
        fs.mkdirSync(jarDir, { recursive: true });
        fs.writeFileSync(path.join(jarDir, 'sun_spider.jar'), r.buf);
        const localMd5 = crypto.createHash('md5').update(r.buf).digest('hex');
        if (jarMd5 && jarMd5 !== localMd5) {
          console.log(`  ⚠️ md5 不一致（sun声明=${jarMd5} 本地=${localMd5}），以本地为准`);
        }
        spider = `${SELF_JAR_URL};md5;${localMd5}`;
        console.log(`  ✅ jar 已自托管 (${r.buf.length} 字节, md5=${localMd5})`);
        console.log(`  ✅ spider 指向: ${SELF_JAR_URL}`);
      } else {
        throw new Error(`jar 下载失败 HTTP ${r.status}`);
      }
    }
  } catch (e) {
    console.log(`  ❌ sun 获取失败: ${e.message}`);
    // 兜底1：用上次缓存的 sun 站点（sun 挂了，单仓照样完整）
    const cacheFile = path.join(__dirname, 'sun_sites_cache.json');
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        const cs = Array.isArray(cached.sites) ? cached.sites : [];
        sites.push(...cs);
        sunCount = cs.length;
        console.log(`  ↩️ 使用缓存的 sun 站点 ${cs.length} 个（缓存于 ${cached.updated || '未知时间'}）`);
      } catch (pe) {
        console.log(`  ⚠️ 缓存读取失败: ${pe.message}`);
      }
    }
    // 兜底2：仓库里已有上次自托管的 jar 就继续用（导入端仍不依赖 sun）
    const localJar = path.join(__dirname, 'jar', 'sun_spider.jar');
    if (fs.existsSync(localJar)) {
      const md5 = crypto.createHash('md5').update(fs.readFileSync(localJar)).digest('hex');
      spider = `${SELF_JAR_URL};md5;${md5}`;
      console.log(`  ↩️ 沿用仓库已自托管的 jar（md5=${md5}），本次仅不更新 sun 站点`);
    }
  }

  const box = { spider, sites, lives: [], parses: [], flags: [], rules: {} };
  const out = path.join(__dirname, 'mybox-self.json');
  fs.writeFileSync(out, JSON.stringify(box, null, 2), 'utf-8');
  console.log(`\n[完成] 资源站 ${sites.length - sunCount} + sun站 ${sunCount} = 共 ${sites.length} 个，spider ${spider ? '自托管OK' : '空'}，已写入 ${out}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
