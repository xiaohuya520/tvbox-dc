/**
 * TVBox 网盘解析蜘蛛（夸克 / 百度）—— 真实解析版
 * ============================================
 * 把资源站里「夸克网盘 / 百度网盘」的分享链接，解析成可直接播放/下载的直链。
 * 在 TVBox 里作为「网盘」类型站点添加，key 分别与资源站里的 play_from 对应
 * （"夸克网盘"、"百度网盘"），这样点资源站的网盘资源时，TVBox 会调本蜘蛛拿直链。
 *
 * ★ 填你的凭据（二选一，推荐用 ext 在 TVBox 里填，不写死在文件里）:
 *   1) 直接改下面两个常量；或
 *   2) 在 TVBox 该网盘站点的 ext 里填 JSON: {"quark":"你的ck","baidu":"你的BDUSS"}
 *   - QUARK_COOKIE : 登录 pan.quark.cn 后 cookie 里的 `ck=...` 整段
 *   - BAIDU_BDUSS  : 登录 pan.baidu.com 后 cookie 里的 `BDUSS=...` 整段
 *
 * 能力说明:
 *   - 夸克: 纯 cookie 走官方分享接口即可拿到在线播放直链（已实装）。
 *   - 百度: 分享下载带签名校验，纯 cookie 在客户端蜘蛛里较脆；已实装接口骨架，
 *           并保留 PARSE_API 作为百度兜底（填了就走第三方解析，最稳）。
 *           若只想要夸克、百度暂不解析，留空 BAIDU 相关即可。
 */

var QUARK_COOKIE = '';     // 夸克 ck
var BAIDU_BDUSS  = '';     // 百度 BDUSS
var PARSE_API    = '';     // 可选：百度解析兜底接口（留空则百度走 cookie 骨架）
var BAIDU_SIGN_KEY = '';   // 百度签名密钥，随版本变化；为空时百度仅走 PARSE_API

var QUARK_DEV = 'tvboxdolby00000001';   // X-Device-Id，固定串即可

function init(ext) {
    if (ext) {
        try {
            var c = JSON.parse(ext);
            if (c.quark) QUARK_COOKIE = c.quark;
            if (c.baidu) BAIDU_BDUSS = c.baidu;
            if (c.parseApi) PARSE_API = c.parseApi;
        } catch (e) {}
    }
    return '';
}

// drpy fetch 的 POST 封装（部分壳子不支持 options 时需改用 shell 自带 post）
function post(url, body, cookie) {
    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'cookie': cookie || '',
            'X-Device-Id': QUARK_DEV,
            'X-Platform': 'web'
        },
        data: JSON.stringify(body)
    });
}

function getJSON(url, cookie, qs) {
    var u = qs ? (url + '?' + qs) : url;
    var txt = fetch(u, { headers: { 'cookie': cookie || '' } });
    return JSON.parse(txt);
}

// ---------------- 夸克网盘 ----------------
function quarkShareId(url) {
    var m = url.match(/pan\.quark\.cn\/s\/([A-Za-z0-9]+)/);
    return m ? m[1] : '';
}

function parseQuark(url) {
    if (!QUARK_COOKIE) return { url: url, parse: 0 };
    var sid = quarkShareId(url);
    if (!sid) return { url: url, parse: 0 };

    // 1) 拿 stoken
    var t = JSON.parse(post(
        'https://drive.quark.cn/1/clouddrive/share/sharepage/token',
        { pwd_id: sid, passcode: '' }, QUARK_COOKIE));
    var stoken = t.data && t.data.stoken;
    if (!stoken) return { url: url, parse: 0 };

    // 2) 拿文件列表
    var d = JSON.parse(post(
        'https://drive.quark.cn/1/clouddrive/share/sharepage/detail',
        { pwd_id: sid, stoken: stoken, pdir_fid: '0', force: 1,
          _page: 1, _size: 100, _sort: 'file_name', _dir: 'asc' }, QUARK_COOKIE));
    var list = (d.data && d.data.list) || [];
    if (!list.length) return { url: url, parse: 0 };
    var f = list[0];

    // 3) 拿在线播放直链
    var p = JSON.parse(post(
        'https://drive.quark.cn/1/clouddrive/file/play',
        { fid: f.fid, fid_token: f.fid_token,
          open_api_ext: { media_bandwidth: '/^$/' },
          res_type: 1, play_type: 'online' }, QUARK_COOKIE));
    var playUrl = (p.data && (p.data.play_url || p.data.video_preview_url)) || '';
    if (playUrl) return { url: playUrl, parse: 0 };

    return { url: url, parse: 0 };
}

// ---------------- 百度网盘 ----------------
function baiduSurl(url) {
    var m = url.match(/pan\.baidu\.com\/s\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : '';
}

function parseBaidu(url) {
    if (PARSE_API) return parseByApi(url, 'baidu');
    if (!BAIDU_BDUSS || !BAIDU_SIGN_KEY) return { url: url, parse: 0 };

    var surl = baiduSurl(url);
    if (!surl) return { url: url, parse: 0 };

    // 1) shareinfo -> sekey(enc)
    var info = getJSON('https://pan.baidu.com/api/shareinfo', BAIDU_BDUSS,
        'surl=' + surl + '&t=' + Date.now());
    var sekey = info.data && info.data.secretkey_enc;
    var shareid = info.data && info.data.shareid;
    if (!sekey) return { url: url, parse: 0 };

    // 2) 签名（百度签名密钥随版本变化，BAIDU_SIGN_KEY 为空则跳过）
    var ts = Math.floor(Date.now() / 1000);
    var sign = baiduSign(surl, sekey, ts);
    if (!sign) return { url: url, parse: 0 };

    // 3) 拿下载直链
    var dl = getJSON('https://pan.baidu.com/api/sharedownload', BAIDU_BDUSS,
        'surl=' + surl + '&shareid=' + shareid + '&sign=' + sign +
        '&timestamp=' + ts + '&sekey=' + encodeURIComponent(sekey));
    var item = dl.data && dl.data.list && dl.data.list[0];
    var durl = item && (item.dlink || (item.list && item.list[0] && item.list[0].dlink));
    if (durl) return { url: durl, parse: 0 };

    return { url: url, parse: 0 };
}

function baiduSign(surl, sekey, ts) {
    if (!BAIDU_SIGN_KEY) return '';
    // 社区常见算法: md5(encodeURIComponent(sekey) + ts + SIGN_KEY)
    // drpy 若未提供 md5，请改用 shell 自带或填 PARSE_API
    if (typeof md5 === 'function') {
        return md5(encodeURIComponent(sekey) + ts + BAIDU_SIGN_KEY);
    }
    return '';
}

// 第三方解析接口约定: GET PARSE_API?type=baidu&url=xxx  -> {"url":"直链"}
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
