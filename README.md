# TVBox 多仓配置聚合

把多个 TVBox 单仓配置地址聚合为一个多仓，导入 TVBox / 影搜 / 影视仓后即可在仓库选择列表里挑源。

## 直接导入链接

- 主链接（raw）：`https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc.json`
- 国内镜像（jsDelivr）：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc.json`

## 格式说明（双兼容）

同一个 `dc.json` 里同时提供两种多仓字段，适配不同壳子：

- `stores`：元素 `{ "name": "源名", "url": "单仓地址" }`（影搜 / 影视仓常用）
- `urls`：元素 `{ "url": "单仓地址", "name": "源名" }`（参考 GitLab 多多类合集写法，部分 TVBox 魔改版只认这个）

两种字段内容完全一致（都是同一批筛选的 93 条单仓），只是字段顺序/命名不同。壳子一般只读自己认识的那个字段，互不影响。

## 说明

- 共 93 条单仓配置（已剔除多仓列表、纯直播源、网页类地址，按 URL 去重）。
- 部分小众个人接口可能已失效，导入后列表里点哪个加载哪个，失效的会报错跳过，不影响其他。

## 更新方法

修改 `dc.json` 里的 `stores` / `urls` 数组后（两个字段保持同步），重新推送到本仓库 `main` 分支即可，导入链接不变。
