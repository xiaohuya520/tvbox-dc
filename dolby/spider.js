/**
 * TVBox 杜比资源站 — drpy 蜘蛛(spider)
 * =====================================
 * 读取 GitHub 上的 catalog.json（由 crawler.py 生成），把「全部杜比资源」
 * 作为一个 TVBox 资源站提供出来。
 *
 * 在 subscribe.json 里这样挂接:
 *   {
 *     "key": "SelfDolby",
 *     "name": "我的杜比资源站",
 *     "type": 3,
 *     "api": "https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dolby/spider.js",
 *     "ext": "https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dolby/catalog.json",
 *     "searchable": 1,
 *     "playable": 1
 *   }
 * TVBox 会把 ext 作为 catalog 地址传给 init()。
 *
 * 网盘支持: crawler 会把夸克/百度等网盘分享链接识别出来，并把 vod_play_from
 * 标记为「夸克网盘/百度网盘」。本蜘蛛原样透传这些链接；真正把分享链接解析成
 * 可播直链，需要在 TVBox 里单独配置「网盘解析」（见 netdisk_parser.js 模板）。
 */

var catalogUrl = '';
var cache = null;
var cacheTime = 0;

function init(ext) {
    // ext 由站点配置的 ext 字段传入，即 catalog.json 的地址
    catalogUrl = ext || catalogUrl;
    return catalogUrl;
}

function loadCatalog() {
    var now = Date.now();
    // 缓存 5 分钟，避免每次请求都拉文件
    if (cache && (now - cacheTime) < 5 * 60 * 1000) {
        return cache;
    }
    var txt = fetch(catalogUrl);
    cache = JSON.parse(txt);
    cacheTime = now;
    return cache;
}

function mapItem(it) {
    return {
        vod_id: it.vod_id,
        vod_name: it.vod_name,
        vod_pic: it.vod_pic || '',
        vod_remarks: it.vod_remarks || ''
    };
}

// 首页推荐：取前 20 条
function homeVod() {
    var c = loadCatalog();
    var list = (c.list || []).slice(0, 20).map(mapItem);
    return { list: list };
}

// 搜索：按片名包含关键词过滤
function search(wd, quick) {
    var c = loadCatalog();
    var kw = (wd || '').toLowerCase();
    var list = (c.list || [])
        .filter(function (it) {
            return (it.vod_name || '').toLowerCase().indexOf(kw) >= 0;
        })
        .slice(0, 30)
        .map(mapItem);
    return { list: list };
}

// 详情：返回播放地址
function detail(id) {
    var c = loadCatalog();
    var it = (c.list || []).filter(function (x) {
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
    return { url: id };
}

// 兜底：部分壳子会调用 home()
function home() {
    return { class: [], list: [] };
}
