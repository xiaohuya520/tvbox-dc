# TVBox 多仓配置聚合

把多个 TVBox 单仓配置地址聚合为一个多仓，导入 TVBox / 影搜 / 影视仓后即可在仓库选择列表里挑源。

## 直接导入链接

**自己的单仓 mybox.json（聚合所有好源的站点，导入即出全部站点，不用选仓库，加载最快）** ← 本次主推
- `https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/mybox.json`
- 国内镜像：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/mybox.json`

**精选多仓版（16 条，资源多大仓，推荐日常用）**
- `https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc.json`
- 国内镜像：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc.json`

**极速版（11 条，只留国内托管/较快的源，加载最快，追求速度备用）**
- `https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc_fast.json`
- 国内镜像：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc_fast.json`

**完整版（93 条，备用）**
- `https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc_full.json`
- 国内镜像：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc_full.json`

> 国内访问 `raw.githubusercontent.com` 常常很慢，优先用 jsDelivr 镜像，或试
> `https://gh-proxy.com/https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc.json`。

## 格式说明（双兼容）

`dc.json` / `dc_fast.json` / `dc_full.json` 同一个文件里同时提供两种多仓字段，适配不同壳子：

- `stores`：元素 `{ "name": "源名", "url": "单仓地址" }`（影搜 / 影视仓常用）
- `urls`：元素 `{ "url": "单仓地址", "name": "源名" }`（参考 GitLab 多多类合集写法，部分魔改版只认这个）

两种字段内容完全一致，只是字段顺序/命名不同。壳子一般只读自己认识的那个字段，互不影响。

## 精选版 16 条清单（资源多 + 可用）

> 以用户指定的两个锚点开头，其余全部为圈内资源多、长期维护的大单仓；
> 其中「肥猫 / 讴歌 / 4K影视」借鉴自 Lightconer 影视仓聚合仓库（其他多仓），
> 走 jsDelivr 镜像，国内可直连。

1. 王二小（王小二）— `https://9280.kstore.vip/newwex.json`　★锚点
2. 新潇洒 sun — `https://9877.kstore.space/sun.json`　★锚点
3. 肥猫（借鉴多仓）— `https://cdn.jsdelivr.net/gh/Lightconer/tvbox-ysc-config@main/output/feimao.json`
4. 讴歌（借鉴多仓）— `https://cdn.jsdelivr.net/gh/Lightconer/tvbox-ysc-config@main/output/ouge.json`
5. 4K影视（借鉴多仓）— `https://cdn.jsdelivr.net/gh/Lightconer/tvbox-ysc-config@main/output/4k.json`
6. 饭太硬 — `https://qist.wyfc.qzz.io/fty.json`
7. 潇洒 — `https://qist.wyfc.qzz.io/xiaosa/api.json`
8. 摸鱼儿 — `https://6800.kstore.vip/fish.json`
9. OK影视 — `https://raw.liucn.cc/box/m.json`
10. noimank — `https://gitlab.com/noimank/tvbox/-/raw/main/tvbox1.json`
11. FongMi — `https://cdn.jsdelivr.net/gh/FongMi/CatVodSpider@main/json/config.json`
12. ls660飞猫 — `https://www.ls660.com/TV/feimao.json`
13. 宝盒VIP — `https://cdn.jsdelivr.net/gh/guot55/YGBH@main/vip2.json`
14. PG — `https://www.252035.xyz/p/jsm.json`
15. clun-fun — `https://clun.top/fun.json`
16. 大嗷呜 — `https://9763.kstore.vip/aowu.json`

## 极速版 11 条清单

> 剔除原则：`raw.githubusercontent.com` 直连、`gh-proxy` 二次代理、采集站 API、php 动态接口、
> 中文域名根路径（这些在国内加载慢或根本不是标准单仓）。只留国内托管 / 较快域名的源。

饭太硬 · 潇洒 · OK影视(liucn) · 摸鱼儿 · ls660飞猫 · PG · tv(FongMi) · noimank · 王二小 · 少儿频道 · clun-fun

## 自动刷新（GitHub Actions）

仓库内置定时任务 `.github/workflows/refresh.yml`，每天北京时间 00:00 自动运行 `refresh.py`：

1. 探测候选池内所有源是否存活（HTTP 可达 + 响应体是 TVBox 配置）；
2. **锚点强制保留**：王二小、新潇洒 sun 这两个用户指定源，即使探测失败也留在精选；
3. 精选 `dc.json` 维持 16 个：锚点 → 原精选存活 → **资源多大仓优先**补满；
4. 候选池 `sources_pool.json` = 内置 93 条种子 + 5 条 GitHub 直链单仓 + 借鉴多仓(Lightconer 肥猫/讴歌/4K)
   + 6 个网页聚合页抓取，**只增不删**；
5. 有变化才提交，导入链接不变；
6. 同时自动重建 `mybox.json` 自建单仓：把当次所有存活源的直连站点（type=3）合并去重，
   锚点（王二小 + sun）强制纳入，导入即出全部站点、无需选仓库。

即「删失效 + 补最新 + 保资源多 + 自建单仓自动聚合」全自动。可到仓库 Actions 页手动 `Run workflow` 立即触发。

> 注意：`dc_fast.json` 为手动维护，不在自动刷新范围内（避免自动补入慢源）。

## 更新方法

- 自动：等 Actions 每日刷新，或手动触发。
- 手动：修改对应 json 的 `stores` / `urls` 数组（两字段同步），推到 `main` 即可，导入链接不变。
