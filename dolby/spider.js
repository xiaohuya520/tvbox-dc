/**
 * TVBox 杜比资源站 — drpy 蜘蛛(spider)  [type:3]
 * ===================================================
 * 读取 GitHub 上的 catalog.json（由 crawler.py 生成），把「全部杜比资源」
 * 作为一个可搜索的 TVBox 资源站提供出来。
 *
 * 设计要点（针对各种壳子的兼容性）：
 *  - 所有对外函数一律 return JSON.stringify(...)，兼容 catvod 老实现
 *    （直接 new JSONObject((String)ret)）与新实现（自动序列化对象）。
 *  - search 兼容两种壳子签名：search(wd, quick, pg) 与 search(wd, pg)。
 *  - 多镜像兜底：init 的 ext 可传多个 URL（JSON 数组），逐个尝试，
 *    jsdelivr 挂了自动换 github.io。
 *  - 抓取函数自动兜底：优先 req()，其次 http.get()，再次 fetch()。
 *  - 每个函数 try/catch，绝不把异常抛给壳子导致界面卡死。
 */

var catalogUrls = [];
var cache = null;
var cacheTime = 0;
var CACHE_MS = 5 * 60 * 1000;

var FALLBACKS = [
    'https://xiaohuya520.github.io/tvbox-dc/dolby/catalog.json',
    'https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dolby/catalog.json',
    'https://fastly.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dolby/catalog.json'
];

function init(ext) {
    try {
        catalogUrls = [];
        if (ext) {
            if (typeof ext === 'string') {
                var s = ext.replace(/^\s+|\s+$/g, '');
                if (s.charAt(0) === '{' || s.charAt(0) === '[') {
                    try {
                        var o = JSON.parse(s);
                        if (o.urls) { catalogUrls = o.urls; }
                        else if (o.catalog) { catalogUrls = [o.catalog]; }
                        else { catalogUrls = [s]; }
                    } catch (e) { catalogUrls = [s]; }
                } else {
                    catalogUrls = [s];
                }
            } else if (ext.urls) {
                catalogUrls = ext.urls;
            } else if (ext.catalog) {
                catalogUrls = [ext.catalog];
            }
        }
        if (!catalogUrls.length) { catalogUrls = FALLBACKS.slice(); }
        for (var i = 0; i < FALLBACKS.length; i++) {
            if (catalogUrls.indexOf(FALLBACKS[i]) < 0) { catalogUrls.push(FALLBACKS[i]); }
        }
    } catch (e) {
        catalogUrls = FALLBACKS.slice();
    }
    return JSON.stringify({ urls: catalogUrls });
}

function httpGet(url) {
    try {
        if (typeof req === 'function') {
            var r = req(url);
            return typeof r === 'string' ? r : (r && (r.content || r.body) ? (r.content || r.body) : '');
        }
        if (typeof http === 'object' && http && typeof http.get === 'function') {
            var r2 = http.get(url);
            return typeof r2 === 'string' ? r2 : (r2 && (r2.content || r2.body) ? (r2.content || r2.body) : '');
        }
        if (typeof fetch === 'function') {
            return fetch(url);
        }
    } catch (e) { /* 换下一个镜像 */ }
    return '';
}

function loadCatalog() {
    var now = Date.now();
    if (cache && (now - cacheTime) < CACHE_MS) {
        return cache;
    }
    for (var i = 0; i < catalogUrls.length; i++) {
        try {
            var txt = httpGet(catalogUrls[i]);
            if (!txt) { continue; }
            var c = JSON.parse(txt);
            if (c && c.list && c.list.length) {
                cache = c;
                cacheTime = now;
                return c;
            }
        } catch (e) { /* 换下一个镜像 */ }
    }
    return cache; // 全部失败时用旧缓存兜底
}

function getList() {
    try {
        var c = loadCatalog();
        return (c && c.list) ? c.list : [];
    } catch (e) {
        return [];
    }
}

function mapItem(it) {
    return {
        vod_id: it.vod_id,
        vod_name: it.vod_name,
        vod_pic: it.vod_pic || '',
        vod_remarks: it.vod_remarks || ''
    };
}

function home() {
    try {
        return JSON.stringify({
            class: [
                { type_id: 'dolby', type_name: '杜比原盘' },
                { type_id: 'quark', type_name: '夸克网盘' },
                { type_id: 'baidu', type_name: '百度网盘' }
            ]
        });
    } catch (e) { return JSON.stringify({ class: [] }); }
}

function homeVod() {
    try {
        var list = getList().slice(0, 20).map(mapItem);
        return JSON.stringify({ list: list });
    } catch (e) { return JSON.stringify({ list: [] }); }
}

function category(tid, pg) {
    try {
        pg = parseInt(pg || '1', 10) || 1;
        var all = getList();
        var list = all;
        if (tid === 'quark') {
            list = all.filter(function (it) { return (it.vod_netdisk || '').indexOf('夸克') >= 0; });
        } else if (tid === 'baidu') {
            list = all.filter(function (it) { return (it.vod_netdisk || '').indexOf('百度') >= 0; });
        }
        var per = 60;
        var start = (pg - 1) * per;
        return JSON.stringify({
            list: list.slice(start, start + per).map(mapItem),
            page: pg,
            pagecount: Math.max(1, Math.ceil(list.length / per)),
            total: list.length
        });
    } catch (e) { return JSON.stringify({ list: [], page: 1, pagecount: 1, total: 0 }); }
}

function decodeKw(s) {
    try {
        if (typeof s === 'string' && s.indexOf('%') >= 0) {
            return decodeURIComponent(s);
        }
    } catch (e) { /* 保持原样 */ }
    return s;
}

// 兼容两种签名：search(wd, quick, pg) 与 search(wd, pg)
function search(wd, quick, pg) {
    try {
        var keyword;
        var page;
        if (typeof pg === 'undefined' && typeof quick === 'number') {
            // 两参数形式：search(wd, pg)
            keyword = wd;
            page = quick;
        } else {
            keyword = wd;
            page = pg;
        }
        page = parseInt(page || '1', 10) || 1;
        var kw = decodeKw(String(keyword || '')).toLowerCase().replace(/^\s+|\s+$/g, '');
        var all = getList();
        var hit = [];
        for (var i = 0; i < all.length && hit.length < 300; i++) {
            var it = all[i];
            if (!kw) { hit.push(it); continue; }
            var name = String(it.vod_name || '').toLowerCase();
            var remark = String(it.vod_remarks || '').toLowerCase();
            var from = String(it.vod_play_from || '').toLowerCase();
            // 中文/英文子串匹配；去掉空格后再比一次，兼容 "泰坦尼克号" vs "泰坦尼克 号"
            var nameNs = name.replace(/\s+/g, '');
            var kwNs = kw.replace(/\s+/g, '');
            if (name.indexOf(kw) >= 0 || remark.indexOf(kw) >= 0 ||
                from.indexOf(kw) >= 0 || nameNs.indexOf(kwNs) >= 0) {
                hit.push(it);
            }
        }
        var per = 30;
        var start = (page - 1) * per;
        return JSON.stringify({
            list: hit.slice(start, start + per).map(mapItem),
            page: page,
            pagecount: Math.max(1, Math.ceil(hit.length / per)),
            total: hit.length
        });
    } catch (e) {
        return JSON.stringify({ list: [], page: 1, pagecount: 1, total: 0 });
    }
}

function firstId(id) {
    if (id === null || typeof id === 'undefined') { return ''; }
    if (typeof id === 'string') {
        // 壳子可能传 "[123]" 或 "123"
        if (id.charAt(0) === '[') {
            try { var a = JSON.parse(id); return a.length ? String(a[0]) : ''; } catch (e) { return id.replace(/[\[\]]/g, ''); }
        }
        return id;
    }
    if (Array.isArray(id)) { return id.length ? String(id[0]) : ''; }
    return String(id);
}

function detail(id) {
    try {
        var fid = firstId(id);
        var it = getList().filter(function (x) {
            return String(x.vod_id) === String(fid);
        })[0];
        if (!it) {
            return JSON.stringify({ list: [] });
        }
        return JSON.stringify({
            list: [{
                vod_id: it.vod_id,
                vod_name: it.vod_name,
                vod_pic: it.vod_pic || '',
                vod_remarks: it.vod_remarks || '',
                vod_content: it.vod_content || '',
                vod_play_from: it.vod_play_from || '杜比线路',
                vod_play_url: it.vod_play_url || ''
            }]
        });
    } catch (e) { return JSON.stringify({ list: [] }); }
}

// 播放：id 即播放地址（crawler 已写成 "剧集$url#剧集$url" 形式）
function play(flag, id) {
    try {
        return JSON.stringify({ url: id, parse: 0 });
    } catch (e) { return JSON.stringify({ url: id, parse: 0 }); }
}

function playerContent(flag, id, vipFlags) {
    try {
        return JSON.stringify({ url: id, parse: 0 });
    } catch (e) { return JSON.stringify({ url: id, parse: 0 }); }
}
