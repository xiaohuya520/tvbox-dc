#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网盘配置小站（复刻 SUN 网盘配置面板）
====================================
本地运行，浏览器打开后就能像在 SUN 后台一样管理网盘：
  1) 清除 Cookie 按钮
  2) 夸克 / 百度 二维码扫码登录（手机扫一下拿 cookie）
  3) 网盘清晰度选择
  4) 下载/解析线程数（16 / 32 / 64）

用法:
  python server.py            # 默认 http://127.0.0.1:8777
  python server.py --port 9000

说明:
  - 纯 Python 标准库，无第三方依赖。
  - 百度扫码走稳定公开接口，端到端拿 BDUSS。
  - 夸克扫码走公开流程，到「已确认」后尝试自动提取 ck；
    若夸克接口临时调整导致自动提取失败，面板提供「手动粘贴 ck」兜底。
  - 所有 cookie 只存在本地 settings.json，绝不上 GitHub（推送脚本已排除本文件）。
"""
import base64
import json
import os
import re
import sys
import time
import uuid
import urllib.parse
import urllib.request
import urllib.error
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
SETTINGS_PATH = os.path.join(BASE, "settings.json")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# ---------------- 本地设置 ----------------
DEFAULT_SETTINGS = {
    "quark": {"cookie": "", "quality": "原画", "threads": 32},
    "baidu": {"cookie": "", "quality": "原画", "threads": 32},
}

QUALITY_OPTIONS = ["原画", "超清1080P", "高清720P", "标清"]
THREAD_OPTIONS = [16, 32, 64]


def load_settings():
    if not os.path.exists(SETTINGS_PATH):
        return dict(DEFAULT_SETTINGS)
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            d = json.load(f)
        for k in ("quark", "baidu"):
            d.setdefault(k, {})
            for fld in ("cookie", "quality", "threads"):
                d[k].setdefault(fld, DEFAULT_SETTINGS[k][fld])
        return d
    except Exception:
        return dict(DEFAULT_SETTINGS)


def save_settings(d):
    tmp = SETTINGS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, SETTINGS_PATH)


SETTINGS = load_settings()
SETTINGS_LOCK = threading.Lock()

# ---------------- 扫码会话 ----------------
# pollId -> {provider, status, message, cookie, stop, ...}
SESSIONS = {}
SESS_LOCK = threading.Lock()


# ---------------- HTTP 工具 ----------------
def http_get(url, headers=None, timeout=15, capture_cookies=False):
    headers = dict(headers or {})
    headers.setdefault("User-Agent", UA)
    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        code = resp.getcode()
        body = resp.read().decode("utf-8", "ignore")
        cookies = resp.headers.get_all("Set-Cookie") or [] if capture_cookies else []
        return code, body, cookies
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")
        cookies = e.headers.get_all("Set-Cookie") or [] if capture_cookies else []
        return e.code, body, cookies


def http_get_json(url, headers=None, timeout=15):
    code, body, _ = http_get(url, headers, timeout)
    try:
        return json.loads(body)
    except Exception:
        return {"_raw": body, "_code": code}


def cookies_to_str(cookie_list):
    out = []
    for c in cookie_list:
        out.append(c.split(";", 1)[0])
    return "; ".join(out)


# ---------------- 夸克扫码 ----------------
def quark_start():
    request_id = str(uuid.uuid4())
    url = ("https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin"
           "?client_id=532&v=1.2&request_id=" + request_id)
    headers = {
        "Referer": "https://pan.quark.cn/",
        "Origin": "https://pan.quark.cn",
    }
    data = http_get_json(url, headers)
    members = (data.get("data") or {}).get("members") or {}
    token = members.get("token")
    if not token:
        raise RuntimeError("夸克获取 token 失败: " + json.dumps(data, ensure_ascii=False)[:200])
    qr_url = ("https://su.quark.cn/4_eMHBJ?token=%s&client_id=532&ssb=weblogin" % token)
    return {"token": token, "request_id": request_id, "qr_url": qr_url}


def quark_poll_once(token, request_id):
    """返回 'waiting' | 'scanned' | 'confirmed' | 'error' 及可选 serviceTicket"""
    url = ("https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken"
           "?client_id=532&v=1.2&request_id=%s&token=%s" % (request_id, token))
    headers = {"Referer": "https://pan.quark.cn/", "Origin": "https://pan.quark.cn"}
    data = http_get_json(url, headers)
    if data.get("status") != 2000000:
        return "waiting", None
    members = (data.get("data") or {}).get("members") or {}
    new_status = members.get("newStatus", 0)
    # 1=未扫 2=已扫待确认 3=已确认（不同版本字段可能不同，做兼容）
    if new_status >= 3:
        return "confirmed", members.get("serviceTicket")
    if new_status == 2:
        return "scanned", None
    return "waiting", None


def quark_extract_cookie(service_ticket):
    """确认后尝试提取 ck。夸克接口偶尔调整，失败返回空串，交由手动粘贴兜底。"""
    ck = ""
    try:
        # 1) account/info 拿基础 cookie
        code, _, cookies = http_get(
            "https://pan.quark.cn/account/info",
            headers={"Referer": "https://pan.quark.cn/"}, timeout=15, capture_cookies=True)
        if cookies:
            ck = cookies_to_str(cookies)
        # 2) drive-pc 配置接口补全（ll、pdir_fid 等）
        code, _, cookies2 = http_get(
            "https://drive-pc.quark.cn/1/clouddrive/config",
            headers={"Referer": "https://drive-pc.quark.cn/"}, timeout=15, capture_cookies=True)
        if cookies2:
            merged = ck + "; " + cookies_to_str(cookies2) if ck else cookies_to_str(cookies2)
            ck = merged
    except Exception as e:
        print("[quark] 提取cookie异常:", e)
    return ck


# ---------------- 百度扫码 ----------------
def baidu_start():
    gid = str(uuid.uuid4()).upper()
    url = ("https://passport.baidu.com/v2/api/getqrcode"
           "?lp=pc&qrloginfrom=pc&gid=%s&apiver=v3" % gid)
    data = http_get_json(url)
    if data.get("errno") != 0:
        raise RuntimeError("百度获取二维码失败: " + json.dumps(data, ensure_ascii=False)[:200])
    img = data.get("imgurl", "")
    if img.startswith("passport.baidu.com"):
        img = "https://" + img
    elif img.startswith("/"):
        img = "https://passport.baidu.com" + img
    # 新版 getqrcode 不返 uid，channel_id 用 sign（长轮询验证有效）
    return {"gid": gid, "sign": data.get("sign", ""),
            "channel_id": data.get("uid") or data.get("sign", ""), "img_url": img}


def baidu_poll_once(gid, channel_id):
    """返回 'waiting' | 'scanned' | 'confirmed' 及 unicast channel_v"""
    ts = int(time.time() * 1000)
    url = ("https://passport.baidu.com/channel/unicast"
           "?channel_id=%s&tpl=netdisk&gid=%s&apiver=v3&tt=%s" % (channel_id, gid, ts))
    code, body, _ = http_get(url, timeout=30)  # 长轮询，超时调长
    # 可能是 JSONP: callback({...})
    m = re.search(r"\{.*\}", body, re.S)
    if not m:
        return "waiting", None
    try:
        j = json.loads(m.group(0))
    except Exception:
        return "waiting", None
    errno = j.get("errno")
    if errno == 0:
        v = j.get("channel_v") or {}
        if v.get("status") == 0:
            return "confirmed", v
        return "scanned", v
    return "waiting", None


def baidu_extract_bduss(channel_v):
    """已确认后换取 BDUSS。返回 'BDUSS=...' 整段或空串。"""
    vcode = channel_v.get("vcode", "")
    code = channel_v.get("code", "")
    uid = channel_v.get("uid", "")
    gid = channel_v.get("gid") or channel_v.get("callback") or ""
    url = ("https://passport.baidu.com/v3/login/main/qrbdusslogin"
           "?vcode=%s&code=%s&cl_v=%s&gid=%s&dv=%s&u=https%%3A%%2F%%2Fpan.baidu.com%%2F"
           % (urllib.parse.quote(vcode), urllib.parse.quote(code),
              urllib.parse.quote(str(v)), urllib.parse.quote(str(gid)), "win10_2004"))
    try:
        _, _, cookies = http_get(url, timeout=15, capture_cookies=True)
        for c in cookies:
            if c.strip().startswith("BDUSS="):
                return c.split(";", 1)[0]
    except Exception as e:
        print("[baidu] 换BDUSS异常:", e)
    return ""


# ---------------- 后台轮询线程 ----------------
def poll_worker(poll_id):
    sess = SESSIONS.get(poll_id)
    if not sess:
        return
    provider = sess["provider"]
    deadline = time.time() + 150  # 最长 150 秒
    try:
        while time.time() < deadline:
            if sess.get("stop"):
                return
            if provider == "quark":
                st, ticket = quark_poll_once(sess["token"], sess["request_id"])
                if st == "confirmed":
                    ck = quark_extract_cookie(ticket)
                    with SESS_LOCK:
                        sess["status"] = "confirmed"
                        sess["cookie"] = ck
                        sess["message"] = "扫码成功" + ("（已自动提取ck）" if ck else "（请手动粘贴ck）")
                    if ck:
                        _store_cookie("quark", ck)
                    return
                elif st == "scanned":
                    with SESS_LOCK:
                        sess["status"] = "scanned"
                        sess["message"] = "已扫描，请在手机上确认"
                else:
                    with SESS_LOCK:
                        sess["status"] = "waiting"
                        sess["message"] = "等待扫码…"
            else:  # baidu
                st, v = baidu_poll_once(sess["gid"], sess["channel_id"])
                if st == "confirmed":
                    bduss = baidu_extract_bduss(v)
                    with SESS_LOCK:
                        sess["status"] = "confirmed"
                        sess["cookie"] = bduss
                        sess["message"] = "扫码成功" + ("（已自动提取BDUSS）" if bduss else "（请手动粘贴BDUSS）")
                    if bduss:
                        _store_cookie("baidu", bduss)
                    return
                elif st == "scanned":
                    with SESS_LOCK:
                        sess["status"] = "scanned"
                        sess["message"] = "已扫描，请在手机上确认"
                else:
                    with SESS_LOCK:
                        sess["status"] = "waiting"
                        sess["message"] = "等待扫码…"
            time.sleep(2)
    except Exception as e:
        with SESS_LOCK:
            sess["status"] = "error"
            sess["message"] = "轮询异常: " + str(e)
    finally:
        with SESS_LOCK:
            sess["stop"] = True


def _store_cookie(provider, cookie):
    with SETTINGS_LOCK:
        SETTINGS[provider]["cookie"] = cookie
        save_settings(SETTINGS)


# ---------------- 路由 ----------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # 静默

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, rel, ctype):
        path = os.path.join(BASE, rel)
        if not os.path.isfile(path):
            self.send_error(404)
            return
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if p in ("/", "/index.html"):
            return self._send_file("static/index.html", "text/html; charset=utf-8")
        if p == "/static/app.js":
            return self._send_file("static/app.js", "application/javascript; charset=utf-8")
        if p == "/api/settings":
            return self._send_json(self._public_settings())
        if p == "/api/qr/status":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            return self._send_json(self._qr_status(q.get("pollId", [""])[0],
                                                    q.get("provider", [""])[0]))
        self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = {}
        p = self.path.split("?", 1)[0]
        if p == "/api/settings":
            return self._send_json(self._save_settings(payload))
        if p == "/api/cookie/clear":
            return self._send_json(self._clear_cookie(payload))
        if p == "/api/qr/start":
            return self._send_json(self._qr_start(payload))
        if p == "/api/qr/manual":
            return self._send_json(self._qr_manual(payload))
        if p == "/api/tvbox-ext":
            return self._send_json(self._tvbox_ext())
        self.send_error(404)

    # ----- 业务逻辑 -----
    def _public_settings(self):
        out = {}
        for k in ("quark", "baidu"):
            c = SETTINGS[k]["cookie"]
            out[k] = {
                "set": bool(c),
                "masked": (c[:12] + "…" + c[-6:]) if len(c) > 20 else ("已填" if c else ""),
                "quality": SETTINGS[k]["quality"],
                "threads": SETTINGS[k]["threads"],
            }
        out["quality_options"] = QUALITY_OPTIONS
        out["thread_options"] = THREAD_OPTIONS
        return out

    def _save_settings(self, payload):
        with SETTINGS_LOCK:
            for k in ("quark", "baidu"):
                if k in payload:
                    if "quality" in payload[k]:
                        SETTINGS[k]["quality"] = payload[k]["quality"]
                    if "threads" in payload[k]:
                        SETTINGS[k]["threads"] = int(payload[k]["threads"])
            save_settings(SETTINGS)
        return self._public_settings()

    def _clear_cookie(self, payload):
        prov = payload.get("provider", "all")
        with SETTINGS_LOCK:
            if prov in ("all", "quark"):
                SETTINGS["quark"]["cookie"] = ""
            if prov in ("all", "baidu"):
                SETTINGS["baidu"]["cookie"] = ""
            save_settings(SETTINGS)
        return {"ok": True, "provider": prov}

    def _qr_start(self, payload):
        provider = payload.get("provider")
        try:
            if provider == "quark":
                info = quark_start()
            elif provider == "baidu":
                info = baidu_start()
            else:
                return {"ok": False, "message": "未知 provider"}
        except Exception as e:
            return {"ok": False, "message": str(e)}
        poll_id = uuid.uuid4().hex
        sess = {"provider": provider, "status": "waiting", "message": "等待扫码…",
                "cookie": "", "stop": False}
        sess.update(info)
        with SESS_LOCK:
            SESSIONS[poll_id] = sess
        t = threading.Thread(target=poll_worker, args=(poll_id,), daemon=True)
        t.start()
        return {"ok": True, "pollId": poll_id, "provider": provider,
                "qrUrl": info.get("qr_url", ""), "imgUrl": info.get("img_url", "")}

    def _qr_status(self, poll_id, provider):
        with SESS_LOCK:
            sess = SESSIONS.get(poll_id)
            if not sess:
                return {"status": "error", "message": "会话不存在或已过期"}
            return {"status": sess["status"], "message": sess["message"],
                    "cookie": sess.get("cookie", "")}

    def _qr_manual(self, payload):
        provider = payload.get("provider")
        cookie = (payload.get("cookie") or "").strip()
        if provider not in ("quark", "baidu") or not cookie:
            return {"ok": False, "message": "参数缺失"}
        _store_cookie(provider, cookie)
        return {"ok": True}

    def _tvbox_ext(self):
        """生成可直接粘到 TVBox 网盘站点 ext 的 JSON。"""
        ext = {
            "quark": SETTINGS["quark"]["cookie"],
            "baidu": SETTINGS["baidu"]["cookie"],
            "quality": SETTINGS["baidu"]["quality"],
            "threads": SETTINGS["baidu"]["threads"],
        }
        return {"ok": True, "ext": json.dumps(ext, ensure_ascii=False)}


def main():
    port = 8777
    for i, a in enumerate(sys.argv):
        if a == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
    print("网盘配置小站已启动: http://127.0.0.1:%d  (Ctrl+C 退出)" % port)
    print("cookie 仅存本地 settings.json，不会上传 GitHub。")
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")


if __name__ == "__main__":
    main()
