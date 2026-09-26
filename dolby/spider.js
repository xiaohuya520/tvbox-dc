/**
 * TVBox 杜比资源站 — drpy 蜘蛛(spider)
 * =====================================
 * 读取 GitHub 上的 catalog.json（由 crawler.py 生成），把「全部杜比资源」
 * 作为一个 TVBox 资源站提供出来。
 *
 * 加固说明：
 *  - 多镜像兜底：ext 传多个 URL（JSON 数组）时逐个尝试，jsdelivr 挂了自动换 github.io
 *  - 抓取函数自动兜底：优先 req()，没有则用 http.get()，再没有用 fetch()
 *  - search 兼容各壳子签名 search(wd, quick, pg)，关键词自动 URL 解码，
 *    同时匹配片名和备注，支持翻页
 *  - 所有函数 try/catch，绝不让异常挂死界面
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
    if (!catalogUrls.length) { catalogUrls = FALLBACKS; }
    // 把配置的 URL 排前面，镜像兜底追加在后
    for (var i = 0; i < FALLBACKS.length; i++) {
        if (catalogUrls.indexOf(FALLBACKS[i]) < 0) { catalogUrls.push(FALLBACKS[i]); }
    }
    return JSON.stringify({ urls: catalogUrls });
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
    for (var i = 0; i < catalogUrls.length; i++) {
        try {
            var txt = httpGet(catalogUrls[i]);
            var c = JSON.parse(txt);
            if (c && c.list && c.list.length) {
                cache = c;   // 只有抓成功才更新缓存，失败时换下一个镜像
                cacheTime = now;
                return c;
            }
        } catch (e) { /* 换下一个镜像 */ }
    }
    return cache; // 全部失败时用旧缓存
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

function decodeKw(s) {
    try {
        if (s.indexOf('%') >= 0) {
            return decodeURIComponent(s);
        }
    } catch (e) { /* 保持原样 */ }
    return s;
}

function search(wd, quick, pg) {
    pg = parseInt(pg || '1', 10);
    var kw = decodeKw(String(wd || '')).toLowerCase().replace(/^\s+|\s+$/g, '');
    var all = getList();
    var hit = [];
    for (var i = 0; i < all.length && hit.length < 200; i++) {
        var it = all[i];
        var name = String(it.vod_name || '').toLowerCase();
        var remark = String(it.vod_remarks || '').toLowerCase();
        if (kw === '' || name.indexOf(kw) >= 0 || remark.indexOf(kw) >= 0) {
            hit.push(it);
        }
    }
    var per = 30;
    var start = (pg - 1) * per;
    return {
        list: hit.slice(start, start + per).map(mapItem),
        page: pg,
        pagecount: Math.max(1, Math.ceil(hit.length / per)),
        total: hit.length
    };
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
