/**
 * TVBox 网盘解析蜘蛛（夸克 / 百度）—— 模板
 * ============================================
 * 用途: 把你资源站里「夸克网盘 / 百度网盘」的分享链接，解析成可直接播放/下载的直链。
 * 在 TVBox 里作为「网盘」类型站点添加，key 与资源站里的 play_from 对应
 * （即 "夸克网盘"、"百度网盘"），这样点资源站的网盘资源时，TVBox 会用本蜘蛛拿直链。
 *
 * ★ 必须配置（填你自己的）:
 *   - QUARK_COOKIE : 登录夸克网盘网页版后的 cookie（含 ck 字段）
 *   - BAIDU_BDUSS  : 登录百度网盘后的 BDUSS cookie
 *   没有这俩，网盘有账号校验，解析不了。
 * 也可改用第三方解析接口：把 PARSE_API 填上你的接口地址（见 parseByApi）。
 *
 * 注: 网盘官方接口经常变动，下方夸克/百度的具体请求是「示意骨架」，需要你按自己
 * 账号实测补全（或让助手按你给的接口文档补齐）。采集+打标签部分已可用，这一层
 * 取决于你的凭据，所以先给模板。
 */

var QUARK_COOKIE = '';   // 例: 'ck=xxxx; ...'
var BAIDU_BDUSS  = '';   // 例: 'BDUSS=xxxx; ...'
var PARSE_API    = '';   // 可选第三方网盘解析接口，留空则用上面的 cookie 直连

function init(ext) {
    // ext 可传入 JSON: {"quark":"...","baidu":"..."} 覆盖上面的 cookie
    if (ext) {
        try {
            var cfg = JSON.parse(ext);
            if (cfg.quark) QUARK_COOKIE = cfg.quark;
            if (cfg.baidu) BAIDU_BDUSS = cfg.baidu;
        } catch (e) {}
    }
    return '';
}

function quarkShareId(url) {
    var m = url.match(/pan\.quark\.cn\/s\/([A-Za-z0-9]+)/);
    return m ? m[1] : '';
}

function baiduSurl(url) {
    var m = url.match(/pan\.baidu\.com\/s\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : '';
}

// 夸克: 用 cookie 调官方分享接口拿文件直链（骨架，需按账号实测补全）
function parseQuark(url) {
    if (PARSE_API) return parseByApi(url, 'quark');
    var sid = quarkShareId(url);
    if (!sid) return { url: url, parse: 0 };
    // TODO: 调夸克分享详情 + 下载接口，需要 QUARK_COOKIE
    // 关键接口（示例，以实测为准）:
    //   POST https://drive.quark.cn/1/clouddrive/share/sharepage/token  (拿 stoken)
    //   POST https://drive.quark.cn/1/clouddrive/share/sharepage/detail  (拿 file 列表)
    //   POST https://drive.quark.cn/1/clouddrive/file/download  (拿直链)
    // 返回 { url: 直链 }
    return { url: url, parse: 0 };
}

// 百度: 用 BDUSS 调官方接口拿直链（骨架，需按账号实测补全）
function parseBaidu(url) {
    if (PARSE_API) return parseByApi(url, 'baidu');
    var surl = baiduSurl(url);
    if (!surl) return { url: url, parse: 0 };
    // TODO: 调百度网盘接口需 BAIDU_BDUSS
    //   POST https://pan.baidu.com/api/sharedownload  (需 BDUSS + 签名)
    // 返回 { url: 直链 }
    return { url: url, parse: 0 };
}

// 第三方解析接口约定: GET PARSE_API?type=quark&url=xxx  -> {"url":"直链"}
function parseByApi(url, type) {
    var api = PARSE_API + '?type=' + type + '&url=' + encodeURIComponent(url);
    var txt = fetch(api);
    var j = JSON.parse(txt);
    return { url: j.url || url, parse: 0 };
}

function play(flag, id) {
    if (flag.indexOf('夸克') >= 0) return parseQuark(id);
    if (flag.indexOf('百度') >= 0) return parseBaidu(id);
    return { url: id, parse: 0 };
}
