// 网盘配置面板前端逻辑
(function () {
  var prov = "quark";
  var pollId = null;
  var pollTimer = null;

  var $ = function (id) { return document.getElementById(id); };

  function api(path, method, body) {
    return fetch(path, {
      method: method || "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }

  function setStatus(text, cls) {
    var s = $("status");
    s.textContent = text || "";
    s.className = "status" + (cls ? " " + cls : "");
  }

  function loadSettings() {
    api("/api/settings").then(function (d) {
      // 填充下拉
      fillSelect("quality", d.quality_options, d.quark.quality);
      fillSelect("threads", d.thread_options, d.quark.threads);
      refreshCookieState(d);
    });
  }

  function fillSelect(id, opts, cur) {
    var sel = $(id);
    sel.innerHTML = "";
    opts.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o; op.textContent = o;
      if (String(o) === String(cur)) op.selected = true;
      sel.appendChild(op);
    });
  }

  function refreshCookieState(d) {
    d = d || window._settings;
    if (!d) return;
    window._settings = d;
    var c = d[prov];
    $("cookieState").textContent = c.set ? ("已登录（" + c.masked + "）") : "未配置";
    // 同步当前网盘的清晰度/线程
    setSelect("quality", c.quality);
    setSelect("threads", c.threads);
  }

  function setSelect(id, val) {
    var sel = $(id);
    for (var i = 0; i < sel.options.length; i++) {
      if (String(sel.options[i].value) === String(val)) { sel.selectedIndex = i; break; }
    }
  }

  function saveSettings() {
    var payload = {};
    payload[prov] = { quality: $("quality").value, threads: parseInt($("threads").value, 10) };
    api("/api/settings", "POST", payload).then(refreshCookieState);
  }

  // 标签切换
  document.querySelectorAll(".tab").forEach(function (t) {
    t.onclick = function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      prov = t.getAttribute("data-prov");
      stopPoll();
      $("qrbox") && resetQr();
      loadSettings();
    };
  });

  function resetQr() {
    var box = document.querySelector(".qrbox");
    box.innerHTML = '<span class="ph">点击「获取二维码」后用对应 App 扫描</span>';
    setStatus("", "");
  }

  // 获取二维码
  $("loginBtn").onclick = function () {
    stopPoll();
    setStatus("正在获取二维码…", "waiting");
    api("/api/qr/start", "POST", { provider: prov }).then(function (r) {
      if (!r.ok) { setStatus("获取失败：" + r.message, "error"); return; }
      pollId = r.pollId;
      var box = document.querySelector(".qrbox");
      if (prov === "quark") {
        box.innerHTML = '<iframe src="' + r.qrUrl + '" scrolling="no"></iframe>';
      } else {
        box.innerHTML = '<img src="' + r.imgUrl + '" alt="qr">';
      }
      setStatus("等待扫码…", "waiting");
      startPoll();
    });
  };

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      api("/api/qr/status?pollId=" + pollId + "&provider=" + prov).then(function (r) {
        setStatus(r.message, r.status);
        if (r.status === "confirmed") {
          stopPoll();
          loadSettings();
        } else if (r.status === "error") {
          stopPoll();
        }
      });
    }, 2000);
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // 手动粘贴
  $("manualBtn").onclick = function () {
    var ck = $("manualCookie").value.trim();
    if (!ck) { setStatus("请先粘贴 cookie", "error"); return; }
    api("/api/qr/manual", "POST", { provider: prov, cookie: ck }).then(function (r) {
      if (r.ok) { setStatus("已保存粘贴的 Cookie", "confirmed"); $("manualCookie").value = ""; loadSettings(); }
      else setStatus("保存失败：" + r.message, "error");
    });
  };

  // 清除
  $("clearBtn").onclick = function () {
    api("/api/cookie/clear", "POST", { provider: prov }).then(function () {
      setStatus("已清除 " + (prov === "quark" ? "夸克" : "百度") + " Cookie", "confirmed");
      loadSettings();
    });
  };

  // 生成 ext
  $("extBtn").onclick = function () {
    api("/api/tvbox-ext", "POST", {}).then(function (r) {
      if (r.ok) $("extBox").textContent = r.ext;
    });
  };

  // 下拉变更即保存
  $("quality").onchange = saveSettings;
  $("threads").onchange = saveSettings;

  // 初始化
  loadSettings();
})();
