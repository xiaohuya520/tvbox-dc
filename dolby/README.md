# 我的杜比资源站（TVBox 自建源）

一套**自己跑爬虫、只收杜比资源**的 TVBox 资源站方案。爬虫本地运行，把结果
（杜比目录 + 一个 TVBox 蜘蛛 + 订阅入口）推到 GitHub，TVBox 直接订阅这个链接即可，
全程不需要常驻服务器。

## 成品链接（推送后可用）

- 订阅导入：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dolby/subscribe.json`
- 目录数据：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dolby/catalog.json`
- 蜘蛛脚本：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dolby/spider.js`

> 用 jsdelivr 镜像（国内直连稳）。原始地址把 `cdn.jsdelivr.net/gh/` 换成
> `raw.githubusercontent.com/` 即可。

## 工作流程

```
config.json (填你的杜比源)  ──┐
                              ├─► crawler.py ─► data/catalog.json (只有杜比)
subscribe/spider 模板        ──┘                     │
                                                     ▼
                                          push_to_github.py
                                                     │
                                                     ▼
                                     GitHub tvbox-dc/dolby/  ──► TVBox 订阅
```

## 使用步骤

### 1. 配置抓取源
编辑 `config.json` → `sources`，把示例源换成**苹果CMS(MacCMS)格式**的杜比/4K 站点 API 地址：
```json
{
  "name": "某某杜比站",
  "type": "maccms",
  "api": "https://站点域名/api.php/provide/vod",
  "enabled": true,
  "play_flag": "杜比线路"
}
```
> MacCMS 站的特征：能用 `/api.php/provide/vod?ac=list&pg=1` 拿到 JSON 列表。
> 你专注杜比/4K原盘，就挑这类站点填进去，爬虫会自动按关键词只留杜比片。

### 2. 跑爬虫（本地）
```bash
python crawler.py            # 真实抓取
python crawler.py --demo     # 先用示例数据验证流程
```
输出在 `data/catalog.json`，里面 `total` 是杜比资源条数。

### 3. 推送到 GitHub
```bash
python push_to_github.py
```
会覆盖仓库 `dolby/` 目录下的文件。TVBox 端刷新订阅即可看到新资源。

### 4. TVBox 里导入
- 复制订阅链接：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dolby/subscribe.json`
- 在 TVBox 配置里「添加订阅」/「配置订阅」粘贴该链接，或把它并到你已有的 dc.json 里。

## 杜比过滤规则
在 `config.json` → `dolby` 里：
- `keywords`：命中即认定为杜比（杜比/杜比视界/杜比全景声/Dolby/Atmos…）。`strict:true` 时**必须命中其一**才收录。
- `also_allow_tags`：非严格模式下，带 4K/原盘/蓝光 也算。
- `drop_keywords`：枪版/抢先版直接丢弃。
- `require_4k_or_bluray`：设 `true` 则额外要求带 4K/原盘标签（更严）。

## 网盘（夸克/百度）支持

4K原盘几乎都是网盘分享，所以「网盘配置」是刚需。整套分两层：

**① 采集侧（已可用）**
爬虫会自动从播放地址里识别夸克/百度/阿里/天翼/迅雷网盘链接，并把
`vod_play_from` 标记为对应网盘名（如 `夸克网盘`）。`config.json` 的 `netdisk`
段控制识别规则：
```json
"netdisk": {
  "enabled": true,
  "require_netdisk": false,   // 设 true 则只收网盘资源（纯原盘站用）
  "labels": { "夸克网盘": ["pan.quark.cn"], "百度网盘": ["pan.baidu.com"] }
}
```
若你的杜比源全是 4K原盘网盘，`require_netdisk: true` 最干净。

**② 播放侧（需你的网盘凭据）**
网盘分享链接不能直接播，要在 TVBox 里配「网盘解析」。本仓库给了模板
`netdisk_parser.js`（drpy 蜘蛛）：
- 在 TVBox 添加两个「网盘」站点，key 分别填 `夸克网盘`、`百度网盘`，
  `api` 都指向 `netdisk_parser.js`，`ext` 填 `{"quark":"你的夸克cookie","baidu":"你的BDUSS"}`。
- 该蜘蛛把分享链接解析成直链。官方接口需你的 cookie，模板里已留好位置，
  也可直接填 `PARSE_API` 用第三方解析接口。

> 没配网盘解析前，资源站里的网盘链接只会显示、点不开——这是正常的，
> 配好 `netdisk_parser.js` 即恢复播放。

## 文件说明
| 文件 | 作用 |
|------|------|
| `config.json` | 源地址 + 杜比关键词 + GitHub 目标 |
| `crawler.py` | 爬虫，抓 MacCMS 源并严格过滤杜比，输出 catalog.json |
| `spider.js` | TVBox drpy 蜘蛛，读取 catalog.json 当资源站 |
| `subscribe.json` | TVBox 站点导入入口（type:3 + spider） |
| `netdisk_parser.js` | 网盘解析蜘蛛模板（夸克/百度），播放侧需填你的 cookie/接口 |
| `push_to_github.py` | 用 REST API 把 dolby/ 推到 GitHub |
| `data/catalog.json` | 生成的杜比目录（MacCMS 兼容） |

## 注意事项
- 爬虫只在本机运行，不会把你的源泄露到别处；目录推到 GitHub 后**任何人都能看**，
  请勿在 `config.json` 里写带私密令牌的地址。
- 不同 TVBox 壳子对 drpy 蜘蛛支持略有差异，如某壳子不识别，按它的蜘蛛格式微调 `spider.js` 即可。
- 想更新资源，重跑 `crawler.py` 再 `push_to_github.py`。建议写个定时任务每天跑一次。
