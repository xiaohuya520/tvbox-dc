/**
 * TVBox 杜比资源站 — drpy 蜘蛛(spider)
 * =====================================
 * 读取 GitHub 上的 catalog.json（由 crawler.py 生成），把「全部杜比资源」
 * 作为一个 TVBox 资源站提供出来。
 *
 * 兼容性说明（针对“转圈加载”做的加固）：
 *  - 抓取函数自动兜底：优先 fetch()，没有则用 req()，再没有用 http.get()
 *  - 所有函数 try/catch，绝不让异常挂死界面
 *  - 实现了 home/homeVod/category/detail/search/play 全套，兼容各壳子
 */

var catalogUrl = '';
var cache = null;
var cacheTime = 0;
var CACHE_MS = 5 * 60 * 1000;

function init(ext) {
    catalogUrl = ext || catalogUrl;
    return catalogUrl;
}

function httpGet(url) {
    if (typeof req === 'function') {
        var r = req(url);
        return typeof r === 'string' ? r : (r.content || r.body || '');
    }
    if (typeof http === 'object' && http && typeof http.get === 'function') {
        var r2 = http.get(url);
        return typeof r2 === 'string' ? r2 : (r2.content || r2.body || '');
    }
    if (typeof fetch === 'function') {
        return fetch(url);
    }
    throw new Error('no http function in this shell');
}

function loadCatalog() {
    var now = Date.now();
    if (cache && (now - cacheTime) < CACHE_MS) {
        return cache;
    }
    var txt = httpGet(catalogUrl);
    var c = JSON.parse(txt);
    if (c && c.list) {
        cache = c;   // 只有抓成功才更新缓存，失败时下次重试
        cacheTime = now;
    }
    return c;
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
    return {
        class: [{ type_id: 'dolby', type_name: '杜比原盘' },
                { type_id: 'quark', type_name: '夸克网盘' },
                { type_id: 'baidu', type_name: '百度网盘' }]
    };
}

function homeVod() {
    var list = getList().slice(0, 20).map(mapItem);
    return { list: list };
}

function category(tid, pg) {
    pg = parseInt(pg || '1', 10);
    var all = getList();
    var list = all;
    if (tid === 'quark') {
        list = all.filter(function (it) { return (it.vod_netdisk || '').indexOf('夸克') >= 0; });
    } else if (tid === 'baidu') {
        list = all.filter(function (it) { return (it.vod_netdisk || '').indexOf('百度') >= 0; });
    }
    var per = 60;
    var start = (pg - 1) * per;
    return {
        list: list.slice(start, start + per).map(mapItem),
        page: pg,
        pagecount: Math.max(1, Math.ceil(list.length / per)),
        total: list.length
    };
}

function search(wd, quick) {
    var kw = (wd || '').toLowerCase();
    var list = getList()
        .filter(function (it) {
            return (it.vod_name || '').toLowerCase().indexOf(kw) >= 0;
        })
        .slice(0, 30)
        .map(mapItem);
    return { list: list };
}

function detail(id) {
    var it = getList().filter(function (x) {
        return String(x.vod_id) === String(id);
    })[0];
    if (!it) {
        return { list: [] };
    }
    return {
        list: [{
            vod_id: it.vod_id,
            vod_name: it.vod_name,
            vod_pic: it.vod_pic || '',
            vod_remarks: it.vod_remarks || '',
            vod_content: it.vod_content || '',
            vod_play_from: it.vod_play_from || '杜比线路',
            vod_play_url: it.vod_play_url || ''
        }]
    };
}

// 播放：id 即播放地址（crawler 已写成 "剧集$url#剧集$url" 形式）
function play(flag, id) {
    return { url: id, parse: 0 };
}

function playerContent(flag, id, vipFlags) {
    return { url: id, parse: 0 };
}
