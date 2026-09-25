# TVBox 多仓配置聚合

把多个 TVBox 单仓配置地址聚合为一个多仓，导入 TVBox / 影搜 / 影视仓后即可在仓库选择列表里挑源。

## 直接导入链接

**极速版（11 条，只留国内托管/较快的源，加载最快，推荐）**
- `https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc_fast.json`
- 国内镜像：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc_fast.json`

**精选版（20 条，通用）**
- `https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc.json`
- 国内镜像：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc.json`

**完整版（93 条，备用）**
- `https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc_full.json`
- 国内镜像：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc_full.json`

> 国内访问 `raw.githubusercontent.com` 常常很慢，优先用 jsDelivr 镜像，或试
> `https://gh-proxy.com/https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc_fast.json`。

## 格式说明（双兼容）

`dc.json` / `dc_fast.json` / `dc_full.json` 同一个文件里同时提供两种多仓字段，适配不同壳子：

- `stores`：元素 `{ "name": "源名", "url": "单仓地址" }`（影搜 / 影视仓常用）
- `urls`：元素 `{ "url": "单仓地址", "name": "源名" }`（参考 GitLab 多多类合集写法，部分魔改版只认这个）

两种字段内容完全一致，只是字段顺序/命名不同。壳子一般只读自己认识的那个字段，互不影响。

## 极速版 11 条清单

> 剔除原则：`raw.githubusercontent.com` 直连、`gh-proxy` 二次代理、采集站 API、php 动态接口、
> 中文域名根路径（这些在国内加载慢或根本不是标准单仓）。只留国内托管 / 较快域名的源。

饭太硬 · 潇洒 · OK影视(liucn) · 摸鱼儿 · ls660飞猫 · PG · tv(FongMi) · noimank · 王二小 · 少儿频道 · clun-fun

## 精选版 20 条清单

饭太硬 · 潇洒 · ok(liucn) · liu673cn(jsDelivr) · 摸鱼儿 · ls660飞猫 · PG · tv(FongMi) · noimank · 欧歌接口 · 影视仓 · 王二小 · 香雅情 · zy(ZYplayer) · 宝盒VIP · 少儿频道 · 极速 · TvBox单仓 · 我的(CatVodSpider) · clun-fun

## 自动刷新（GitHub Actions）

仓库内置定时任务 `.github/workflows/refresh.yml`，每天北京时间 00:00 自动运行 `refresh.py`：

1. 探测候选池内所有源是否存活（HTTP 可达 + 响应体是 TVBox 配置）；
2. 精选 `dc.json` 维持 20 个：先保留原精选中存活的，再从可用集按优先级补满；
3. 候选池 `sources_pool.json` = 内置 93 条种子 + 5 条 GitHub 直链单仓 + 聚合仓库(ScriptTV/Lightconer 等)
   + 6 个网页聚合页抓取，**只增不删**；
4. 有变化才提交，导入链接不变。

即「删失效 + 补最新」全自动。可到仓库 Actions 页手动 `Run workflow` 立即触发。

> 注意：`dc_fast.json` 为手动维护，不在自动刷新范围内（避免自动补入慢源）。

## 更新方法

- 自动：等 Actions 每日刷新，或手动触发。
- 手动：修改对应 json 的 `stores` / `urls` 数组（两字段同步），推到 `main` 即可，导入链接不变。
